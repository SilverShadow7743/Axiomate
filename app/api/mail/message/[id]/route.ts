import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'

export const dynamic = 'force-dynamic'

/**
 * One message's real content, fetched on open — see
 * `docs/plans/2026-09-08-email-body-view-design.md`. The 25-message list
 * (`/api/mail/inbox`) never asks Graph for `body`, only the truncated `bodyPreview`; this route
 * is the one place the full content is read, one message at a time, under the same `Mail.Read`
 * grant and the same RAM-only, never-stored posture as the rest of `in-mail` — the response
 * reaches only the requesting person's own session and touches nothing else.
 *
 * The caller is responsible for rendering `contentType: 'html'` inside a sandboxed surface
 * (no `allow-scripts`) — this route does not sanitize the markup, it only fetches it.
 */

const SELECT = 'subject,from,receivedDateTime,body'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json({ ok: false, error: 'Sign in to read your mail.' }, { status: 401 })
  }

  const messageId = id.trim()
  if (!messageId) {
    return NextResponse.json({ ok: false, error: 'No message id.' }, { status: 422 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    return NextResponse.json({ ok: true, reconnect: true })
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=${SELECT}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ ok: true, reconnect: true })
  }
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Microsoft refused the message read (${res.status}).` },
      { status: 502 },
    )
  }
  const data = (await res.json()) as {
    subject?: string
    from?: { emailAddress?: { name?: string; address?: string } }
    receivedDateTime?: string
    body?: { contentType?: string; content?: string }
  }
  return NextResponse.json({
    ok: true,
    reconnect: false,
    subject: data.subject ?? '(no subject)',
    fromName: data.from?.emailAddress?.name ?? data.from?.emailAddress?.address ?? '',
    receivedAt: data.receivedDateTime ?? '',
    contentType: data.body?.contentType === 'html' ? 'html' : 'text',
    content: data.body?.content ?? '',
  })
}
