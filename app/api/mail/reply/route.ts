import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { describeGraphRefusal, draftReply, replyToMessage } from '@/lib/personalGraph'
import { databaseConfigured } from '@/lib/db/client'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { directoryPersonFor } from '@/lib/access'
import { buildSignatureHtml, plainTextToHtml } from '@/lib/signature'
import { DEFAULT_ORGANIZATION } from '@/lib/config'

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
 * person's own Sent Items always would. No workspace PERMISSION applies — but the signature
 * (`docs/plans/2026-09-08-email-signature-design.md`) does need a workspace READ now, the same
 * database-optional fallback `/api/mail/compose` uses: on the database being unreachable, send
 * the plain, unsigned reply exactly as before rather than refuse to reply.
 *
 * `mode: 'draft'` (11 Sep, `docs/plans/2026-09-08-scheduled-reply-design.md` Option C) runs the
 * same sequence minus the send: the signed reply is left in the person's own Drafts for them to
 * finish or schedule in Outlook. Same route on purpose — one signature build, one refusal
 * shape, one place a reply is composed — and the default stays `'send'` so nothing that posted
 * here before behaves differently.
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
    mode?: 'send' | 'draft'
  } | null
  const messageId = (body?.messageId ?? '').trim()
  const comment = (body?.comment ?? '').trim()
  const mode = body?.mode === 'draft' ? 'draft' : 'send'
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

  let htmlContent = plainTextToHtml(comment)
  try {
    if (databaseConfigured()) {
      const { state } = await loadWorkspace(currentTenantId())
      const org = state.model.organization
      const person = directoryPersonFor(state.model, session.actor)
      htmlContent += buildSignatureHtml(
        org.signatureTemplate ?? DEFAULT_ORGANIZATION.signatureTemplate ?? '',
        { name: person?.name ?? session.actor.name, title: person?.title, org: org.name, phone: person?.phone },
        org.logoDataUri,
      )
    }
  } catch (err) {
    console.error(`signature build skipped for ${session.actor.id}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (mode === 'draft') {
    const draft = await draftReply(token, messageId, htmlContent, Boolean(body?.replyAll))
    if (!draft.ok) {
      console.error(`mail draft refused for ${session.actor.id}: ${draft.status} ${draft.detail}`)
      return NextResponse.json(
        { ok: false, error: describeGraphRefusal(draft, 'save the draft') },
        { status: draft.status === 401 || draft.status === 403 ? 401 : 502 },
      )
    }
    return NextResponse.json({ ok: true, draft: draft.data })
  }

  const res = await replyToMessage(token, messageId, htmlContent, Boolean(body?.replyAll))
  if (!res.ok) {
    console.error(`mail reply refused for ${session.actor.id}: ${res.status} ${res.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(res, 'reply') },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    )
  }
  return NextResponse.json({ ok: true })
}
