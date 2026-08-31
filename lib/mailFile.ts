/**
 * File-a-mail — the pure mapping from a Graph message to the actions the reducer already
 * owns. See `docs/plans/2026-08-31-in-mail-design.md`.
 *
 * Pinned by IM1 against the real `create` arm before any auth or network existed: the
 * mapper's draft must be a draft the reducer ACCEPTS, not merely a plausible one. HTML is
 * stripped by a local stripper — the richText helpers parse RichDoc, not HTML.
 */

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

  return {
    createDraft: {
      name: subject,
      type: 'Request',
      severity: 'Medium',
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
