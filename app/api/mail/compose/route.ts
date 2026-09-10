import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { describeGraphRefusal, sendNewMail } from '@/lib/personalGraph'
import { databaseConfigured } from '@/lib/db/client'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { directoryPersonFor } from '@/lib/access'
import { buildSignatureHtml, plainTextToHtml } from '@/lib/signature'
import { DEFAULT_ORGANIZATION } from '@/lib/config'

export const dynamic = 'force-dynamic'

/**
 * A new message from the SIGNED-IN PERSON'S OWN mailbox — the lower-value, lower-urgency half
 * of the reply/compose pair (see `docs/plans/2026-09-07-personal-connect-write-design.md`: "a
 * new message has no issue context to attach to yet"). Same posture as `/api/mail/reply`:
 * delegated-only, nothing recorded, `saveToSentItems` handles the Sent-Items copy.
 *
 * The signature (`docs/plans/2026-09-08-email-signature-design.md`) needs a workspace read this
 * route never needed before — the org's template/logo and the sender's own title/phone. On the
 * database being unreachable, this falls back to sending the plain, unsigned message exactly as
 * before rather than refusing to send: a missing signature is cosmetic, and personal Graph mail
 * has never depended on this app's own database.
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

  let htmlBody = plainTextToHtml(text)
  try {
    if (databaseConfigured()) {
      const { state } = await loadWorkspace(currentTenantId())
      const org = state.model.organization
      const person = directoryPersonFor(state.model, session.actor)
      htmlBody += buildSignatureHtml(
        org.signatureTemplate ?? DEFAULT_ORGANIZATION.signatureTemplate ?? '',
        { name: person?.name ?? session.actor.name, title: person?.title, org: org.name, phone: person?.phone },
        org.logoDataUri,
      )
    }
  } catch (err) {
    console.error(`signature build skipped for ${session.actor.id}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const res = await sendNewMail(token, { to, subject, body: htmlBody }, 'HTML')
  if (!res.ok) {
    console.error(`mail compose refused for ${session.actor.id}: ${res.status} ${res.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(res, 'send') },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    )
  }
  return NextResponse.json({ ok: true })
}
