/**
 * File-a-mail — the pure mapping from a Graph message to the actions the reducer already
 * owns. See `docs/plans/2026-08-31-in-mail-design.md`.
 *
 * Pinned by IM1 against the real `create` arm before any auth or network existed: the
 * mapper's draft must be a draft the reducer ACCEPTS, not merely a plausible one. HTML is
 * stripped by a local stripper — the richText helpers parse RichDoc, not HTML.
 *
 * `type` and `severity` come from `draftFor` (`lib/intake.ts`) — the same rule-matching and
 * severity/type guessing a routed mailbox gets — rather than the invented `'Request'`/`'Medium'`
 * constants this used to hardcode (principle 2: never invent information). `draftFor` is called
 * directly, not `classify`, because `classify` resolves a mailbox from `message.to`, and a
 * personal inbox's `to` is the filer's own address — essentially never a configured shared
 * intake mailbox — so it would refuse `no-mailbox` for nearly every message filed this way.
 */

import type { OperatingModel } from './config'
import { draftFor } from './intake'

export interface GraphMessageLike {
  subject?: string | null
  from?: { emailAddress?: { name?: string | null; address?: string | null } | null } | null
  bodyPreview?: string | null
  body?: { contentType?: string | null; content?: string | null } | null
  receivedDateTime?: string | null
  internetMessageId?: string | null
  conversationId?: string | null
}

export interface MailFileResult {
  createDraft: Record<string, string>
  inboundMailFields: {
    mailbox: string
    from: string
    subject: string
    body: string
    messageId: string
    receivedAt: string
    conversationId: string | null
  }
}

const SUBJECT_CAP = 300
const BODY_CAP = 2000

/** Re:/Fw:/Fwd: prefixes, stripped repeatedly — "Re: Fw: Re: x" is about x. */
export function cleanSubject(raw: string | null | undefined): string {
  let s = (raw ?? '').trim()
  for (;;) {
    const next = s.replace(/^(re|fw|fwd)\s*:\s*/i, '')
    if (next === s) break
    s = next.trim()
  }
  if (!s) return '(no subject)'
  return s.length > SUBJECT_CAP ? s.slice(0, SUBJECT_CAP - 1).trimEnd() + '…' : s
}

/** Graph HTML to readable text: tags out, entities the mail bodies actually use, whitespace collapsed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

export function mapGraphMessage(
  msg: GraphMessageLike,
  filer: { name: string; email: string },
  opts: { module: string; discipline?: string },
  model: OperatingModel,
): MailFileResult {
  const subject = cleanSubject(msg.subject)
  const senderName = msg.from?.emailAddress?.name?.trim() || msg.from?.emailAddress?.address?.trim() || 'Unknown sender'
  const senderAddress = msg.from?.emailAddress?.address?.trim() || ''

  const rawBody =
    msg.body?.contentType?.toLowerCase() === 'html'
      ? htmlToText(msg.body?.content ?? '')
      : (msg.body?.content ?? msg.bodyPreview ?? '').trim()
  const bodyText = rawBody || (msg.bodyPreview ?? '').trim()
  const capped = bodyText.length > BODY_CAP ? bodyText.slice(0, BODY_CAP - 1).trimEnd() + '…' : bodyText

  // scopeId is thrown away below — mapGraphMessage doesn't own placement, the route's own
  // `parentId` does. Only draftFor's guessed `type`/`severity` are taken from this call.
  const classified = draftFor(
    'unscoped',
    { to: filer.email, from: senderName, subject, body: capped, messageId: msg.internetMessageId ?? '', receivedAt: msg.receivedDateTime ?? '', conversationId: msg.conversationId ?? null },
    model,
  )

  return {
    createDraft: {
      name: subject,
      type: classified.type,
      severity: classified.severity,
      raisedBy: senderName,
      module: opts.module,
      discipline: opts.discipline ?? 'Functional',
      description: capped
        ? `${capped}\n\n— Filed from ${filer.name}'s inbox; sent by ${senderName}${senderAddress ? ` <${senderAddress}>` : ''}.`
        : `Filed from ${filer.name}'s inbox; sent by ${senderName}${senderAddress ? ` <${senderAddress}>` : ''}.`,
    },
    inboundMailFields: {
      /* Honest provenance: this arrived at the FILER's own mailbox, not the intake address. */
      mailbox: filer.email,
      from: senderAddress || senderName,
      subject,
      body: capped,
      messageId: msg.internetMessageId ?? '',
      receivedAt: msg.receivedDateTime ?? '',
      conversationId: msg.conversationId ?? null,
    },
  }
}
