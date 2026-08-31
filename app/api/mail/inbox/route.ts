import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { getMailToken } from '@/lib/db/mailTokens'

export const dynamic = 'force-dynamic'

/**
 * The person's own inbox, passed through — never stored. See
 * `docs/plans/2026-08-31-in-mail-design.md`: the delegated token IS the boundary (it can
 * only read its own person's mail), the payload goes only to that person's session, and
 * nothing here touches WorkspaceState, boot, the database or the shared search index.
 */
export async function GET(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json({ ok: false, error: 'Sign in to read your inbox.' }, { status: 401 })
  }

  const token = await getMailToken(session.actor.id)
  if (!token) {
    // Absent or unrefreshable is "reconnect", never an error page — the RAM-only posture's
    // stated cost surfacing exactly where the design said it would.
    return NextResponse.json({ ok: true, reconnect: true, messages: [] })
  }

  const res = await fetch(
    'https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,subject,from,bodyPreview,receivedDateTime,hasAttachments,internetMessageId,conversationId&$orderby=receivedDateTime desc',
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ ok: true, reconnect: true, messages: [] })
  }
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Microsoft refused the inbox read (${res.status}).` },
      { status: 502 },
    )
  }
  const data = (await res.json()) as {
    value?: {
      id: string
      subject?: string
      from?: { emailAddress?: { name?: string; address?: string } }
      bodyPreview?: string
      receivedDateTime?: string
      hasAttachments?: boolean
      internetMessageId?: string
      conversationId?: string
    }[]
  }
  return NextResponse.json({
    ok: true,
    reconnect: false,
    messages: (data.value ?? []).map((m) => ({
      id: m.id,
      subject: m.subject ?? '(no subject)',
      fromName: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? '',
      fromAddress: m.from?.emailAddress?.address ?? '',
      preview: m.bodyPreview ?? '',
      receivedAt: m.receivedDateTime ?? '',
      hasAttachments: Boolean(m.hasAttachments),
      internetMessageId: m.internetMessageId ?? '',
    })),
  })
}
