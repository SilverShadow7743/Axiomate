import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { classify, provenanceNote, type InboundMessage, htmlToText, alreadyReceived, matchingIssue } from '@/lib/intake'
import type { Action } from '@/lib/workspace'
import { INTAKE_ACTOR } from '@/lib/actor'
import { secretProblem, secretValue } from '@/lib/secrets'
import { wrapPlainText } from '@/lib/richText'

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

/**
 * The shared secret, read through the guard rather than straight from the environment.
 *
 * An unresolved Key Vault reference would otherwise *become* the token: the endpoint compares
 * the header against whatever this holds, so the accepted bearer would be a string published in
 * the deployment templates. Refusing it leaves intake closed, which is the right way to fail
 * for a door that creates records from the internet.
 */
const TOKEN = secretValue('AXIOMATE_INTAKE_TOKEN')

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
          `Intake is closed. ${secretProblem('AXIOMATE_INTAKE_TOKEN') ?? ''} An endpoint that creates records from the internet does not run without a usable shared secret.`,
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
    /*
     * Converted at the boundary, once, so everything downstream sees text: the empty-message
     * refusal, the classifier's keyword matching, the description that reaches a consultant, and
     * the duplicate check. Client mail arrives as HTML by design — see `htmlToText` — and until
     * this line existed, issues were created with raw markup in them.
     */
    body: typeof message.body === 'string' ? htmlToText(message.body) : '',
    messageId: message.messageId,
    receivedAt:
      typeof message.receivedAt === 'string' ? message.receivedAt : new Date().toISOString(),
    /*
     * Exchange's thread id, mapped through by `infra/intake.bicep`'s trigger action. Absent for
     * the intake-form path (a different endpoint) and for anything sent by a connector that
     * has not been redeployed since this was added — both read as "no thread to match", the
     * same as any other unrecognised message.
     */
    conversationId: typeof message.conversationId === 'string' ? message.conversationId : null,
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
     *
     * Checked directly against `InboundMail.messageId` rather than the substring search over
     * note bodies this used before that table existed — still run before `classify()`, in the
     * same place: a redelivered message that would now classify differently (routing rules
     * changed since the first delivery) must still be recognised as the same arrival, not
     * treated as a new one.
     */
    const seen = alreadyReceived(state, full.messageId)
    if (seen) {
      return NextResponse.json({ ok: true, duplicate: true, message: 'Already received.' })
    }

    const result = classify(full, state.model)
    if ('refused' in result) {
      /*
       * Logged before the response, not after — a thrown error from this write must not
       * silently turn "refused and logged" into "refused and lost". Its own failure does not
       * change what the caller is told: the message really was refused, and a logging failure
       * is a different, secondary fact that gets recorded server-side rather than escalated,
       * the same resilience the success path's `noteRecorded` already practises below.
       */
      try {
        await persistActions(tenantId, INTAKE_ACTOR, [
          {
            t: 'recordInboundMail',
            mailbox: full.to,
            from: full.from,
            subject: full.subject,
            body: full.body,
            messageId: full.messageId,
            receivedAt: full.receivedAt,
            issueId: null,
            refusalReason: result.refused.reason,
            conversationId: full.conversationId,
            now: new Date().toISOString(),
          } as Action,
        ])
      } catch (err) {
        console.error(`intake refused for ${full.messageId} but logging it failed: ${describeDbError(err)}`)
      }
      return NextResponse.json({ ok: false, error: result.refused.reason }, { status: 422 })
    }
    const { draft } = result
    const now = new Date().toISOString()

    /**
     * A reply on a thread this workspace has already seen attaches to the issue it belongs to,
     * rather than creating a second one. See
     * `docs/plans/2026-08-25-intake-reply-threading-design.md`. Checked here, after `classify()`
     * has already resolved a mailbox and a draft — a message with nowhere to file was refused
     * above regardless of whether it is a reply, and a match still records exactly what
     * `classify()` decided the message was, even though that decision is not what gets built.
     */
    const matched = matchingIssue(state.inboundMail, state.issues, full.conversationId)

    if (matched) {
      const follow: Action[] = [
        {
          t: 'addNote',
          issueId: matched,
          body: wrapPlainText(`${provenanceNote(full, draft)}\n\nMessage id: ${full.messageId}`),
          noteType: 'Client Communication',
          pinned: true,
          now,
        },
        {
          t: 'recordInboundMail',
          mailbox: full.to,
          from: full.from,
          subject: full.subject,
          body: full.body,
          messageId: full.messageId,
          receivedAt: full.receivedAt,
          issueId: matched,
          refusalReason: null,
          conversationId: full.conversationId,
          now,
        } as Action,
      ]
      const result2 = await persistActions(tenantId, INTAKE_ACTOR, follow)
      if (!result2.ok) {
        return NextResponse.json({ ok: false, error: result2.error }, { status: 409 })
      }
      return NextResponse.json({
        ok: true,
        issueId: matched,
        matched: true,
        matchedOn: draft.matchedOn,
        confidence: draft.confidence,
        noteRecorded: true,
      })
    }

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
     * It carries the sender's message id in words, for the consultant reading the issue — the
     * duplicate check above no longer reads it back out of here; it queries `InboundMail`
     * directly. The note still says in words what was decided by a rule and what was guessed,
     * so the consultant who picks this up knows which fields to distrust.
     */
    const follow: Action[] = [
      {
        t: 'addNote',
        issueId,
        body: wrapPlainText(`${provenanceNote(full, draft)}\n\nMessage id: ${full.messageId}`),
        noteType: 'Client Communication',
        pinned: true,
        now,
      },
      {
        t: 'recordInboundMail',
        mailbox: full.to,
        from: full.from,
        subject: full.subject,
        body: full.body,
        messageId: full.messageId,
        receivedAt: full.receivedAt,
        issueId,
        refusalReason: null,
        conversationId: full.conversationId,
        now,
      } as Action,
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
