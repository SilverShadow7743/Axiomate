import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { describeGraphRefusal, replyToMessage } from '@/lib/personalGraph'

export const dynamic = 'force-dynamic'

/**
 * Reply or reply-all to a message in the SIGNED-IN PERSON'S OWN inbox — see
 * `docs/plans/2026-09-07-personal-connect-write-design.md`. Sequenced before compose in that
 * design because a reply already has a message (and, when filed, an issue) to attach
 * provenance to; a cold compose does not.
 *
 * Distinct from `POST /api/mail/send`: that route sends AS THE FIRM, from an engagement
 * mailbox, app-only, gated on `mail.send` and recorded as a client-visible note. This one
 * sends as the SIGNED-IN PERSON, from their own mailbox, delegated-only, and — like `in-mail`'s
 * read side — records nothing: Graph's own `saveToSentItems` already puts the reply where the
 * person's own Sent Items always would. No workspace permission applies because nothing here
 * touches workspace data.
 */
export async function POST(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    logAuthRefusal('POST /api/mail/reply', 'not signed in', session.actor)
    return NextResponse.json({ ok: false, error: 'Sign in to reply.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    messageId?: string
    comment?: string
    replyAll?: boolean
  } | null
  const messageId = (body?.messageId ?? '').trim()
  const comment = (body?.comment ?? '').trim()
  if (!messageId || !comment) {
    return NextResponse.json({ ok: false, error: 'A message and a reply are both needed.' }, { status: 422 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    return NextResponse.json(
      { ok: false, reconnect: true, error: 'Reconnect your inbox first.' },
      { status: 401 },
    )
  }

  const res = await replyToMessage(token, messageId, comment, Boolean(body?.replyAll))
  if (!res.ok) {
    console.error(`mail reply refused for ${session.actor.id}: ${res.status} ${res.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(res, 'reply') },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    )
  }
  return NextResponse.json({ ok: true })
}
