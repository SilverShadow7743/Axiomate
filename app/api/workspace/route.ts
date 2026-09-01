/**
 * The workspace write endpoint.
 *
 * Takes one `Action` — the exact value the browser dispatched — and replays it against stored
 * state through the same reducer. The client has already applied it optimistically, so this
 * is a confirmation, not a round trip the UI waits on. What it can still do is disagree: if
 * the reducer rejects the action here (because stored state moved on), the response says so
 * and the client refetches rather than drifting.
 */

import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError, isPermanentDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { sendAsMailbox } from '@/lib/mail'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'
import type { Action } from '@/lib/workspace'
import { keyProblem, type SubmittedAction } from '@/lib/idempotency'
import { batchProblem } from '@/lib/actionShape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A queue drain should never be unbounded; anything larger is a client bug, not a workload. */
const MAX_BATCH = 200

/** Action kinds the endpoint will replay. Anything else is refused rather than guessed at. */
const KINDS = new Set([
  'create',
  'duplicate',
  'updateNode',
  'updateIssue',
  'updateActivity',
  'softDelete',
  'restore',
  'move',
  'link',
  'unlink',
  'setDates',
  'addDependency',
  'removeDependency',
  'addEvidence',
  'updateEvidence',
  'removeEvidence',
  'addNote',
  'updateNote',
  'removeNote',
  'setEstimate',
  'baselineEstimate',
  'addTime',
  'updateTime',
  'removeTime',
  'requestApproval',
  'decideApproval',
  'requestDocumentReview',
  'decideDocumentReview',
  'withdrawDocumentReview',
  'setDocumentVisibility',
  'markNotificationRead',
  'setNotificationPref',
  'updateCareerProfile',
  'upsertSow',
  'archiveSow',
  'attributeToSow',
  'upsertAllocation',
  'removeAllocation',
  'upsertCommitment',
  'decideLeave',
  'removeCommitment',
  'upsertMeeting',
  'cancelMeeting',
  'recordVersion',
  'correctVersion',
  'removeVersion',
  'upsertChangeRequest',
  'withdrawChangeRequest',
  'decideChangeRequest',
  'recordRate',
  'correctRate',
  'recordPersonSkill',
  'correctPersonSkill',
  'removePersonSkill',
  'recordDocument',
  'removeDocument',
  'upsertScopeItem',
  'removeScopeItem',
  'decideScopeItem',
  'upsertMilestone',
  'removeMilestone',
  'deliverMilestone',
  'decideMilestone',
  'submitTimesheet',
  'decideTimesheet',
  // `notify` is deliberately absent. Notifications are raised by rules, and the server plans
  // the same rules the browser does — so a notify action arriving over the wire could only be
  // one the client invented.
  'buildLifecycle',
  'clearLifecycle',
  'config',
  'setAssignment',
  'updateEngagement',
  'addProjectMember',
  'updateProjectMember',
  'removeProjectMember',
  'addPersonalEvent',
  'updatePersonalEvent',
  'removePersonalEvent',
])

export async function POST(req: Request) {
  // The request is validated BEFORE the database is considered.
  //
  // Reversing these reads better but is wrong: a malformed body is a client bug whether or not
  // a database exists, and answering it with "no database is configured" reports the wrong
  // fault. It also makes the validation unreachable — and therefore untestable — on any
  // deployment without a database, which is the mode this app ships in by default.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  // Accepts one action or an ordered batch. The client autosaves through a serial queue and
  // sends whatever has accumulated, so a batch is the normal case rather than the exception.
  const raw = body as { action?: unknown; actions?: unknown }
  const list = Array.isArray(raw.actions) ? raw.actions : raw.action ? [raw.action] : []

  if (!list.length) {
    return NextResponse.json({ ok: false, error: 'No action was sent.' }, { status: 400 })
  }
  if (list.length > MAX_BATCH) {
    return NextResponse.json({ ok: false, error: 'Too many actions in one request.' }, { status: 413 })
  }
  if (!list.every((a) => a && typeof a === 'object' && KINDS.has((a as Action).t))) {
    return NextResponse.json({ ok: false, error: 'Unrecognised action.' }, { status: 400 })
  }

  /**
   * The kind check above says which reducer arm will run. It says nothing about what that arm
   * will be handed.
   *
   * `Action` is a TypeScript union, and TypeScript is not present at runtime — the cast on the
   * line above is a promise the compiler made about our own code, not one the network made to
   * the server. Several reducer arms build their record with `{ ...existing, ...a.patch }`, so
   * an undeclared key does not bounce off: it is copied into stored state and saved back out.
   * A declared field that never arrived is the same problem read backwards — `a.now.slice(0, 10)`
   * on `undefined` answers a client's malformed request with a 500 about the server.
   *
   * So the payload is checked against the shape its kind declares: every required field present
   * and of the right type, and no field the union has never heard of. `lib/actionShape.ts` holds
   * that table and is pure, which is what lets the rule be driven from the scenario harness with
   * hand-built hostile objects rather than inferred from this file's source.
   *
   * Placed here, before the idempotency key is examined and well before the database is
   * considered, for the reason given at the top of this function: a malformed body is a client
   * bug whether or not a database exists, and it stays reachable — and therefore testable — on a
   * deployment that has none.
   */
  const shape = batchProblem(list)
  if (shape) return NextResponse.json({ ok: false, error: shape }, { status: 400 })

  /**
   * The idempotency key is client-supplied and becomes half of a primary key, so it is
   * checked here rather than trusted.
   *
   * Refused rather than ignored. A key of the wrong shape means the client believes it is
   * protected against redelivery and is not — dropping it quietly would leave the request
   * working and its only safeguard silently switched off, which is worse than a 400 the
   * developer sees immediately.
   */
  for (const a of list as SubmittedAction[]) {
    const problem = keyProblem(a.key)
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 })
  }

  if (!databaseConfigured()) {
    // Not an error: running from the seed file with no database is a supported mode, and the
    // client is already keeping this session in its own mirror. Saying so lets the queue stop
    // rather than retrying something that cannot work.
    return NextResponse.json({ ok: false, disabled: true, error: 'No database is configured.' })
  }

  try {
    /**
     * Both the tenant and the actor are resolved here, from the server's own configuration —
     * never from the request body.
     *
     * That is the whole point of the seam. A client-supplied tenant id would let anyone read
     * and write any firm's workspace by changing one field, which is worse than having no
     * tenancy at all: it would look like isolation while being an open door. The same
     * argument applies to attribution, and `Action` has no actor field precisely so that the
     * browser has nothing to forge. When authentication arrives, both calls learn to read the
     * session; the request body still never gets a say.
     */
    /**
     * With an identity provider configured, an unverified request is refused.
     *
     * Without one, this deployment has a single operator and refusing them would refuse
     * everything — so the check is on the provider being present rather than on a flag that
     * would always be false. That distinction is the whole reason `identityEstablished` exists
     * separately from `verified`.
     */
    const session = getSession(req)
    if (identityEstablished() && !session.verified) {
      return NextResponse.json(
        { ok: false, error: 'Sign in to make changes.', signInRequired: true },
        { status: 401 },
      )
    }

    const result = await persistActions(
      currentTenantId(),
      session.actor,
      list as SubmittedAction[],
    )

    /**
     * A resolution notice, sent after the save has already committed — never inside it.
     *
     * `persistActions`'s own transaction closed when it returned above; `lib/db/schedule.ts`
     * gives the reason this has to happen out here rather than alongside the write, verbatim:
     * "Graph HTTP inside a Serializable transaction would hold locks through network I/O and
     * race its 30s timeout." The same rule applies to this call, which is why it is not inside
     * `persistActions` itself.
     *
     * Failure here must never turn a successful save into an error response — the save already
     * happened, and whoever made it is owed that success regardless of whether a reviewer gets
     * emailed about it. The try/catch is deliberately its own, inside the route's outer one:
     * without it, a thrown Graph error would fall through to the outer `catch` below and answer
     * a successful save with a 500.
     */
    if (result.ok && result.notify) {
      try {
        for (const n of result.notify.notices) {
          const subject = `Ready to tell the client — ${n.issueId}`
          const text =
            `${n.issueId} — ${n.subject} — moved to Awaiting client confirmation for ${n.clientName}.` +
            (n.suggestedContact ? `\n\nSuggested contact: ${n.suggestedContact}` : '')
          const sent = await sendAsMailbox(result.notify.mailbox, result.notify.dest, subject, text)
          if (!sent.ok) {
            console.error(`resolution notice failed for ${n.issueId}: ${sent.status} ${sent.detail}`)
          }
        }
      } catch (err) {
        console.error('resolution notice failed:', err instanceof Error ? err.message : String(err))
      }
    }

    /**
     * `notify` never reaches the browser. It carries an internal mailbox address, an internal
     * reviewer's address and, via `suggestedContact`, a client contact's email — none of it
     * secret, none of it something the frontend reads or should see in its own network tab.
     */
    const { notify, ...publicResult } = result
    return NextResponse.json(publicResult, { status: result.ok ? 200 : 409 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: describeDbError(err), permanent: isPermanentDbError(err) },
      { status: 500 },
    )
  }
}
