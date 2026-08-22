import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'
import { can } from '@/lib/access'
import { isOutboundRefusal, sendingMailboxFor } from '@/lib/outbound'
import { entraConfig } from '@/lib/auth/entra'
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

let cached: { token: string; expiresAt: number } | null = null

async function graphToken(): Promise<string> {
  const entra = entraConfig()
  if (!entra) throw new Error('Entra is not configured.')
  const now = Date.now()
  if (cached && cached.expiresAt > now + 60_000) return cached.token

  const res = await fetch(`https://login.microsoftonline.com/${entra.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: entra.clientId,
      client_secret: entra.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Microsoft rejected this application's credentials (${res.status}). An administrator should check the client secret and that admin consent for Mail.Send is still granted.`,
    )
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return json.access_token
}

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

  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
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

    const resolved = sendingMailboxFor(state, issueId)
    if (isOutboundRefusal(resolved)) {
      return NextResponse.json({ ok: false, error: resolved.reason }, { status: 422 })
    }

    /* ---- the send itself ---- */
    const token = await graphToken()
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(resolved.mailbox.address)}/sendMail`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: resolved.subject,
            body: { contentType: 'Text', content: text },
            toRecipients: [{ emailAddress: { address: resolved.recipient } }],
          },
          saveToSentItems: true,
        }),
      },
    )
    if (!res.ok) {
      // The full error names tenant internals; the caller gets one honest sentence.
      console.error(`mail send refused for ${issueId}: ${res.status} ${await res.text()}`)
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
    const recorded = await persistActions(tenantId, session.actor, [note])

    /*
     * Read back what was written rather than reconstructing it: the reducer mints the note's
     * id from its own counter, and the browser needs the real record to merge — the same
     * shape as a document upload, the other write that happens server-side first.
     */
    let stored: IssueNote | null = null
    if (recorded.ok) {
      const after = await loadWorkspace(tenantId)
      stored =
        Object.values(after.state.notes)
          .filter((n) => n.issueId === issueId && n.body === noteBody && !n.deletedAt)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    }

    return NextResponse.json({
      ok: true,
      from: resolved.mailbox.address,
      to: resolved.recipient,
      subject: resolved.subject,
      // Reported rather than hidden: the mail went, and a note that failed to write is a
      // different fact from a send that failed.
      noteRecorded: recorded.ok,
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
