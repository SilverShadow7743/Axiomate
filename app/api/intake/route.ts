import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { classify, provenanceNote, type InboundMessage } from '@/lib/intake'
import type { Action } from '@/lib/workspace'
import { INTAKE_ACTOR } from '@/lib/actor'

/**
 * Where work arrives from outside.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 *
 * It is the intake pipeline: a message goes in, the configured mailboxes and routing rules are
 * applied, and a work item comes out under the right scope with a note saying how it got there.
 * Everything downstream — the transition graph, permissions, automation, the audit trail —
 * applies exactly as it does to a person typing the same thing, because the record is created
 * through the same reducer.
 *
 * It is **not** a mail server, and does not pretend to be. Nothing here connects to a mailbox,
 * holds credentials, or polls anything: something else has to receive the mail and POST it
 * here. That last mile is a connector — a forwarding rule, a Graph subscription, a webhook from
 * whatever already handles the firm's mail — and it is deliberately outside this application,
 * because a half-built poller with no credentials would be the same inert configuration this
 * endpoint exists to replace.
 *
 * ---------------------------------------------------------------------------
 * The token
 *
 * This is the only endpoint that accepts content from outside the firm, so it is the only one
 * that needs a shared secret — and it refuses everything when none is configured. An open
 * intake endpoint is a way to create records in somebody's workspace from the internet, and
 * "we will add auth later" is how that ships.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Long enough that guessing is not a strategy. Absent means the endpoint is closed. */
const TOKEN = process.env.AXIOMATE_INTAKE_TOKEN

/*
 * The actor comes from `lib/actor.ts`, and the reason is worth keeping.
 *
 * A local constant of the same name lived here and shadowed the shared one. The ids differed
 * by the single prefix that matters: `isMachineActor` matches `machine:`, so this route's
 * actor was not recognised as a machine, fell through to the fallback role, and ran as
 * Administrator — the exact accident the machine role was added to prevent. It would have got
 * worse the day somebody followed the advice to empty `defaultRoleIds`: intake would then hold
 * no roles at all and refuse every message, with an error pointing at role assignment rather
 * than at a duplicated constant.
 */

export async function POST(req: Request) {
  if (!TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Intake is closed. Set AXIOMATE_INTAKE_TOKEN and send it as a bearer token — an endpoint that creates records from the internet does not run without one.',
      },
      { status: 503 },
    )
  }

  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${TOKEN}`) {
    return NextResponse.json({ ok: false, error: 'Not authorised.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const message = body as Partial<InboundMessage>
  if (
    typeof message.to !== 'string' ||
    typeof message.from !== 'string' ||
    typeof message.messageId !== 'string' ||
    !message.messageId.trim()
  ) {
    return NextResponse.json(
      { ok: false, error: 'A message needs to, from and messageId.' },
      { status: 400 },
    )
  }

  const full: InboundMessage = {
    to: message.to,
    from: message.from,
    subject: typeof message.subject === 'string' ? message.subject : '',
    body: typeof message.body === 'string' ? message.body : '',
    messageId: message.messageId,
    receivedAt:
      typeof message.receivedAt === 'string' ? message.receivedAt : new Date().toISOString(),
  }

  if (!databaseConfigured()) {
    // Unlike the workspace endpoint, this cannot fall back to a browser mirror: there is no
    // browser here. Saying so plainly is better than accepting the message and losing it.
    return NextResponse.json(
      { ok: false, error: 'No database is configured, so an arriving message has nowhere to go.' },
      { status: 503 },
    )
  }

  try {
    const tenantId = currentTenantId()
    const { state } = await loadWorkspace(tenantId)

    /**
     * The same message twice is the normal failure of every mail integration ever built —
     * retries, forwarding loops, a connector restarting mid-batch. Refused on the sender's own
     * id, and reported as a success, because the caller did nothing wrong and retrying is
     * exactly what it should have done.
     */
    const seen = Object.values(state.notes).some((n) => n.body.includes(full.messageId))
    if (seen) {
      return NextResponse.json({ ok: true, duplicate: true, message: 'Already received.' })
    }

    const result = classify(full, state.model)
    if ('refused' in result) {
      return NextResponse.json({ ok: false, error: result.refused.reason }, { status: 422 })
    }
    const { draft } = result

    const now = new Date().toISOString()
    const actions: Action[] = [
      {
        t: 'create',
        parentId: draft.parentId,
        kind: 'issue',
        draft: {
          name: draft.subject,
          description: draft.description,
          type: draft.type,
          severity: draft.severity,
          raisedBy: draft.raisedBy,
          // Status is deliberately the entry state, whatever the rules guessed about severity.
          // A machine may file work; it may not decide it is being worked on.
          status: 'Open',
        },
        now,
      },
    ]

    const first = await persistActions(tenantId, INTAKE_ACTOR, actions)
    if (!first.ok) {
      return NextResponse.json({ ok: false, error: first.error }, { status: 409 })
    }
    const issueId = first.createdId
    if (!issueId) {
      return NextResponse.json({ ok: false, error: 'The record was not created.' }, { status: 500 })
    }

    /**
     * The provenance note is a second write on purpose.
     *
     * It carries the sender's message id, which is what makes the duplicate check above work,
     * and it says in words what was decided by a rule and what was guessed — so the consultant
     * who picks this up knows which fields to distrust.
     */
    const follow: Action[] = [
      {
        t: 'addNote',
        issueId,
        body: `${provenanceNote(full, draft)}\n\nMessage id: ${full.messageId}`,
        noteType: 'Client Communication',
        pinned: true,
        now,
      },
      ...draft.assignments.map(
        (a): Action => ({
          t: 'setAssignment',
          issueId,
          responsibilityId: a.responsibilityTypeId,
          values: [a.value],
          now,
        }),
      ),
    ]
    const second = await persistActions(tenantId, INTAKE_ACTOR, follow)

    return NextResponse.json({
      ok: true,
      issueId,
      matchedOn: draft.matchedOn,
      confidence: draft.confidence,
      // Reported rather than hidden: the record exists either way, and a caller that knows the
      // note failed can say so instead of assuming the trail is complete.
      noteRecorded: second.ok,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: describeDbError(err) }, { status: 500 })
  }
}
