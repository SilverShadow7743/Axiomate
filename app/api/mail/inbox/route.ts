import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'

export const dynamic = 'force-dynamic'

/**
 * The person's own inbox, passed through — never stored. See
 * `docs/plans/2026-08-31-in-mail-design.md`: the delegated token IS the boundary (it can
 * only read its own person's mail), the payload goes only to that person's session, and
 * nothing here touches WorkspaceState, boot, the database or the shared search index.
 *
 * Folders, priority and search — `docs/plans/2026-09-08-in-mail-outlook-parity-design.md` —
 * read under the same `Mail.Read` grant, live per request, nothing new stored. `?listFolders=1`
 * returns the folder list instead of messages; `?q=` searches the mailbox (Graph's own
 * relevance order, `$orderby` dropped — the two are mutually exclusive on this endpoint);
 * `?folderId=` scopes to one folder, defaulting to Inbox when neither is given.
 */

const SELECT =
  'id,subject,from,bodyPreview,receivedDateTime,hasAttachments,internetMessageId,conversationId,inferenceClassification,categories'

export async function GET(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json({ ok: false, error: 'Sign in to read your inbox.' }, { status: 401 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    // Absent or unrefreshable is "reconnect", never an error page — the RAM-only posture's
    // stated cost surfacing exactly where the design said it would.
    return NextResponse.json({ ok: true, reconnect: true, messages: [] })
  }
  const auth = { authorization: `Bearer ${token}` }

  const url = new URL(req.url)
  if (url.searchParams.get('listFolders') === '1') {
    const res = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders?$top=50&$select=id,displayName,unreadItemCount',
      { headers: auth },
    )
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: true, reconnect: true, folders: [] })
    }
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Microsoft refused the folder list (${res.status}).` },
        { status: 502 },
      )
    }
    const data = (await res.json()) as {
      value?: { id: string; displayName?: string; unreadItemCount?: number }[]
    }
    return NextResponse.json({
      ok: true,
      reconnect: false,
      folders: (data.value ?? []).map((f) => ({
        id: f.id,
        name: f.displayName ?? '(unnamed)',
        unreadCount: f.unreadItemCount ?? 0,
      })),
    })
  }

  const q = url.searchParams.get('q')?.trim()
  const folderId = url.searchParams.get('folderId')?.trim()

  // $search and $orderby cannot both be present on this endpoint — Graph refuses the request.
  // A search is ordered by Microsoft's own relevance score instead, which is the right order
  // for "find this", not "what's newest".
  const messagesUrl = q
    ? `https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=${SELECT}&$search=${encodeURIComponent(`"${q}"`)}`
    : `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId || 'inbox')}/messages?$top=25&$select=${SELECT}&$orderby=receivedDateTime desc`

  const res = await fetch(messagesUrl, { headers: auth })
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
      inferenceClassification?: string
      categories?: string[]
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
      // Microsoft's own Focused Inbox field — read, never computed here.
      focused: m.inferenceClassification !== 'other',
      categories: m.categories ?? [],
    })),
  })
}
