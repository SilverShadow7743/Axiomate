import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'
import { can } from '@/lib/access'
import { isOutboundRefusal, sendingMailboxFor } from '@/lib/outbound'
import { sendAsMailbox } from '@/lib/mail'
import type { Action } from '@/lib/workspace'
import type { IssueNote } from '@/lib/notes'

/**
 * The outward door — and the only one of the three that WRITES OUTWARD.
 *
 * Intake's doors create records inside the firm's own workspace; this one sends email to a
 * client as the firm. Its guards are therefore stricter than either:
 *
 *  - **No token path.** A session, verified where identity is established. Intake's bearer
 *    token must not open this door: a machine that can send client mail is the thing the
 *    design refuses. People only, and the send is attributed to the person.
 *  - **Its own permission.** `mail.send`, refused in the gate's own words. Clients receive
 *    what this permission allows.
 *  - **Resolution before composition.** The recipient is the record's claimed sender, the
 *    From is the nearest intake mailbox on the record's own chain — both resolved by
 *    `lib/outbound.ts` and refused at the door when either is missing.
 *
 * On success — and only on success — the sent message becomes a pinned note on the record,
 * dispatched as the person. A failed send records nothing: the record holds what happened.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: { issueId?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'The request could not be read.' }, { status: 400 })
  }

  const issueId = (body.issueId ?? '').trim()
  const text = (body.text ?? '').trim()
  if (!issueId || !text) {
    return NextResponse.json(
      { ok: false, error: 'A record and a message are both needed.' },
      { status: 422 },
    )
  }

  /*
   * The other doors accept the unverified single-operator mode; this one must not. Every
   * other endpoint writes inward, where the worst case is a misattributed record — here the
   * worst case is anything on the network sending real email to a client as the firm.
   */
  if (!identityEstablished()) {
    return NextResponse.json(
      { ok: false, error: 'Writing to clients needs sign-in to be configured for this deployment.' },
      { status: 503 },
    )
  }
  const session = getSession(req)
  if (!session.verified) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to write to a client.', signInRequired: true },
      { status: 401 },
    )
  }

  if (!databaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'No database is configured, so nothing could be recorded.' },
      { status: 503 },
    )
  }

  try {
    const tenantId = currentTenantId()
    const { state } = await loadWorkspace(tenantId)

    const verdict = can(state.model, session.actor, 'mail.send')
    if (!verdict.allowed) {
      return NextResponse.json({ ok: false, error: verdict.reason ?? 'Not permitted.' }, { status: 403 })
    }

    /*
     * Checked BEFORE the send, not discovered after it: a role granted mail.send without
     * note.add would otherwise send real client mail whose record is refused on every try —
     * "sent but never recorded" as a standing configuration rather than a transient fault.
     */
    const noteVerdict = can(state.model, session.actor, 'note.add')
    if (!noteVerdict.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: `A sent message is recorded as a note on the record, and that needs its own grant. ${noteVerdict.reason ?? 'Not permitted.'}`,
        },
        { status: 403 },
      )
    }

    const resolved = sendingMailboxFor(state, issueId)
    if (isOutboundRefusal(resolved)) {
      return NextResponse.json({ ok: false, error: resolved.reason }, { status: 422 })
    }

    /* ---- the send itself, through the shared Graph client ---- */
    const res = await sendAsMailbox(resolved.mailbox.address, resolved.recipient, resolved.subject, text)
    if (!res.ok) {
      // The full error names tenant internals; the caller gets one honest sentence.
      console.error(`mail send refused for ${issueId}: ${res.status} ${res.detail}`)
      return NextResponse.json(
        {
          ok: false,
          error:
            res.status === 401 || res.status === 403
              ? 'Microsoft refused the send. An administrator should check the Mail.Send consent and the application access policy for the sending mailbox.'
              : 'The message could not be sent. Nothing was recorded, and your text is still in the box.',
        },
        { status: 502 },
      )
    }

    /* ---- recorded only because it happened, and as the person ---- */
    const now = new Date().toISOString()
    const noteBody = `Sent to ${resolved.recipient} as ${resolved.mailbox.address}\nSubject: ${resolved.subject}\n\n${text}`
    const note: Action = {
      t: 'addNote',
      issueId,
      body: noteBody,
      noteType: 'Client Communication',
      pinned: true,
      now,
    } as Action
    /*
     * From here on the mail HAS gone, and no failure below may claim otherwise: a thrown
     * database error escaping to the outer catch would report "nothing was sent", the person
     * would naturally retry, and the client would receive the email twice. Whatever the
     * database does after the 2xx, the answer is ok:true — with noteRecorded saying honestly
     * whether the record was made.
     */
    let noteRecorded = false
    let stored: IssueNote | null = null
    try {
      const recorded = await persistActions(tenantId, session.actor, [note])
      noteRecorded = recorded.ok
      if (recorded.ok) {
        /*
         * Read back what was written rather than reconstructing it: the reducer mints the
         * note's id from its own counter, and the browser needs the real record to merge —
         * the same shape as a document upload, the other write that happens server-side
         * first. Matched on the exact timestamp as well as the body, so a concurrent send of
         * identical text from the same record cannot hand back somebody else's note.
         */
        const after = await loadWorkspace(tenantId)
        stored =
          Object.values(after.state.notes)
            .filter(
              (n) => n.issueId === issueId && n.body === noteBody && n.createdAt === now && !n.deletedAt,
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
      }
    } catch (err) {
      console.error(`mail sent for ${issueId} but recording failed: ${describeDbError(err)}`)
    }

    return NextResponse.json({
      ok: true,
      from: resolved.mailbox.address,
      to: resolved.recipient,
      subject: resolved.subject,
      // Reported rather than hidden: the mail went, and a note that failed to write is a
      // different fact from a send that failed.
      noteRecorded,
      note: stored,
    })
  } catch (err) {
    console.error(describeDbError(err))
    return NextResponse.json(
      { ok: false, error: 'The message could not be sent. Nothing was recorded, and your text is still in the box.' },
      { status: 503 },
    )
  }
}
