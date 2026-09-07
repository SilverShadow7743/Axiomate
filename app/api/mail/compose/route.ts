import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { describeGraphRefusal, sendNewMail } from '@/lib/personalGraph'

export const dynamic = 'force-dynamic'

/**
 * A new message from the SIGNED-IN PERSON'S OWN mailbox — the lower-value, lower-urgency half
 * of the reply/compose pair (see `docs/plans/2026-09-07-personal-connect-write-design.md`: "a
 * new message has no issue context to attach to yet"). Same posture as `/api/mail/reply`:
 * delegated-only, nothing recorded, `saveToSentItems` handles the Sent-Items copy.
 */
export async function POST(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    logAuthRefusal('POST /api/mail/compose', 'not signed in', session.actor)
    return NextResponse.json({ ok: false, error: 'Sign in to send mail.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    to?: string[]
    subject?: string
    body?: string
  } | null
  const to = (body?.to ?? []).map((a) => a.trim()).filter(Boolean)
  const subject = (body?.subject ?? '').trim()
  const text = (body?.body ?? '').trim()
  if (!to.length) {
    return NextResponse.json({ ok: false, error: 'At least one recipient is needed.' }, { status: 422 })
  }
  if (!subject) {
    return NextResponse.json({ ok: false, error: 'A subject is needed.' }, { status: 422 })
  }
  if (!text) {
    return NextResponse.json({ ok: false, error: 'A message is needed.' }, { status: 422 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    return NextResponse.json(
      { ok: false, reconnect: true, error: 'Reconnect your inbox first.' },
      { status: 401 },
    )
  }

  const res = await sendNewMail(token, { to, subject, body: text })
  if (!res.ok) {
    console.error(`mail compose refused for ${session.actor.id}: ${res.status} ${res.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(res, 'send') },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    )
  }
  return NextResponse.json({ ok: true })
}
