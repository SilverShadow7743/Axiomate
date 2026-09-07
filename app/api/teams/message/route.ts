import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { describeGraphRefusal, sendChatMessage, startOneOnOneChat } from '@/lib/personalGraph'

export const dynamic = 'force-dynamic'

/**
 * A Teams chat message, as the signed-in person, to one other person by their work address.
 * See `docs/plans/2026-09-07-personal-connect-write-design.md` — sequenced last of the four
 * write capabilities, and ranked most sensitive in the design this extends
 * (`2026-08-18-connected-workspace-design.md` §4: "Chat is the most personal of the three").
 *
 * `Chat.Create` resolves the existing 1:1 chat if one already exists rather than making a
 * duplicate (Microsoft's own behaviour for `POST /chats`), so this is safe to call on every
 * send rather than needing its own "find or create" branch.
 */
export async function POST(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    logAuthRefusal('POST /api/teams/message', 'not signed in', session.actor)
    return NextResponse.json({ ok: false, error: 'Sign in to send a Teams message.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { to?: string; text?: string } | null
  const to = (body?.to ?? '').trim()
  const text = (body?.text ?? '').trim()
  if (!to || !text) {
    return NextResponse.json({ ok: false, error: 'A recipient and a message are both needed.' }, { status: 422 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    return NextResponse.json(
      { ok: false, reconnect: true, error: 'Reconnect your inbox first.' },
      { status: 401 },
    )
  }

  const chat = await startOneOnOneChat(token, session.actor.id, to)
  if (!chat.ok) {
    console.error(`teams chat-start refused for ${session.actor.id} -> ${to}: ${chat.status} ${chat.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(chat, 'chat with that address') },
      { status: chat.status === 401 || chat.status === 403 ? 401 : 502 },
    )
  }

  const sent = await sendChatMessage(token, chat.data.id, text)
  if (!sent.ok) {
    console.error(`teams message refused for ${session.actor.id}: ${sent.status} ${sent.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(sent, 'message') },
      { status: sent.status === 401 || sent.status === 403 ? 401 : 502 },
    )
  }
  return NextResponse.json({ ok: true })
}
