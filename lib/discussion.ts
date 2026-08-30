import { mentionsIn, type Mention } from './mentions'
import type { InboundMail } from './intake'

/**
 * The Discussion domain, pure half — E3 (`2026-08-30-e3-discussion-design.md`).
 *
 * Work-linked communication: one thread per work record, one per project, internal-only.
 * This module is everything that can be proven without I/O: who a post notifies, who a
 * thread's birth auto-follows, and how a record's mail exchange groups into conversations.
 * The server half (`lib/db/discussion.ts`) owns storage and permissions; it consumes these
 * rules, it does not restate them.
 *
 * Deliberately imports NOTHING from `./chat` — that module is the ASSISTANT (find/propose,
 * never writes), and its ChatMessage wire type has no business here. The name collision is
 * why this domain is called Discussion.
 */

/* ================================================================== *
 * Shapes — plain interfaces; the Prisma rows translate through lib/db/map.ts
 * ================================================================== */

export const DISCUSSION_SCOPES = ['issue', 'project'] as const
export type DiscussionScopeKind = (typeof DISCUSSION_SCOPES)[number]

export interface DiscussionThread {
  id: string
  scopeKind: DiscussionScopeKind
  /** The issue id or the project node id. At most one live thread per scope — the DB's
   *  unique index enforces it; check-then-insert races. */
  scopeId: string
  createdAt: string
  createdBy: string
}

export interface DiscussionMessage {
  id: string
  threadId: string
  /** Display name at write time; the id is the durable join. */
  author: string
  authorId: string | null
  /** Plain text. Mentions are parsed with the note parser, so highlight and ping agree. */
  body: string
  createdAt: string
  /** Soft — a removed message leaves a "removed" stub, like notes. */
  deletedAt: string | null
}

export interface DiscussionFollow {
  threadId: string
  personId: string
  createdAt: string
}

/* ================================================================== *
 * Who a post reaches
 * ================================================================== */

/**
 * The notification split for one post. Two kinds, one record per person per message:
 *
 *   - a parsed @mention gets the `mention` kind — being summoned beats subscription, so a
 *     mentioned FOLLOWER appears here and NOT under chat;
 *   - every other follower gets the `chat` kind (the per-thread-subscribe decision);
 *   - the author gets nothing on either list, however they follow or name themselves.
 *
 * Pure, so scenario E3A can pin the rule before any storage exists. The caller resolves the
 * people list (the directory) and the follower ids; prefs (mute / in-app / in-app+email) are
 * NOT consulted here — the notify arm owns them, per recipient, at the mint.
 */
export function recipientsFor(args: {
  followerIds: string[]
  authorId: string | null
  body: string
  people: { id: string; name: string }[]
}): { mentions: Mention[]; chat: string[] } {
  const mentions = mentionsIn(args.body, args.people).filter((m) => m.id !== args.authorId)
  const mentioned = new Set(mentions.map((m) => m.id))
  const chat = [...new Set(args.followerIds)].filter(
    (id) => id !== args.authorId && !mentioned.has(id),
  )
  return { mentions, chat }
}

/**
 * Who a thread's birth signs up, before anyone chooses: the author always (posting IS
 * following — you asked a question, you hear the answer), and on an ISSUE scope the record's
 * owner (their record is being discussed; they can unfollow). A project thread auto-follows
 * only its first author — a project's whole staff conscripted at birth would make the chat
 * kind loud precisely where the design chose subscribe for quiet.
 *
 * Takes resolved directory ids — the caller does the name join (directory id first, trimmed
 * name fallback, the rule everywhere) — and returns them distinct, nulls dropped.
 */
export function autoFollowsAt(args: {
  scopeKind: DiscussionScopeKind
  authorId: string | null
  ownerId?: string | null
}): string[] {
  const ids = [args.authorId, args.scopeKind === 'issue' ? (args.ownerId ?? null) : null]
  return [...new Set(ids.filter((x): x is string => Boolean(x)))]
}

/* ================================================================== *
 * The record's mail exchange, threaded
 * ================================================================== */

export interface MailEntry {
  kind: 'inbound' | 'outbound'
  id: string
  /** receivedAt for inbound; the note's createdAt for outbound. */
  at: string
  /** The sender for inbound; the sent-note headline ("Sent to …") carries it for outbound. */
  from: string
  subject: string
  body: string
  conversationId: string | null
}

export interface MailConversation {
  /** Null for the singleton group of an entry that carries no conversation id. */
  conversationId: string | null
  entries: MailEntry[]
}

/**
 * Whether a note's plain text is a recorded outbound reply. Outbound mail has NO table of its
 * own — `outboundNoteBody` (lib/outbound.ts) records every send as an issue note whose body
 * is fully determined: `Sent to <recipient> as <mailbox>\nSubject: …`. The prefix is the
 * discriminator, beside the note type, because a person can also FILE a Client Communication
 * note by hand and that one is commentary, not a send.
 */
export function isOutboundReplyText(plain: string): boolean {
  return plain.startsWith('Sent to ') && plain.includes('\nSubject: ')
}

/**
 * One record's exchange, in order. Inbound rows for the issue plus its recorded outbound
 * replies, sorted by time — one timeline, because a record rarely has more than one
 * conversation and the reader wants the exchange as it happened. The conversationId rides
 * each entry so the view can chip it when a record genuinely carries several threads.
 */
export function issueMailTimeline(
  inbound: InboundMail[],
  notes: { id: string; issueId: string; noteType: string; plainText: string; createdAt: string }[],
  issueId: string,
): MailEntry[] {
  const rows: MailEntry[] = []
  for (const m of inbound) {
    if (m.issueId !== issueId) continue
    rows.push({
      kind: 'inbound',
      id: m.id,
      at: m.receivedAt,
      from: m.from,
      subject: m.subject,
      body: m.body,
      conversationId: m.conversationId,
    })
  }
  for (const n of notes) {
    if (n.issueId !== issueId || n.noteType !== 'Client Communication') continue
    if (!isOutboundReplyText(n.plainText)) continue
    const lines = n.plainText.split('\n')
    const subject = lines.find((l) => l.startsWith('Subject: '))?.slice('Subject: '.length) ?? ''
    rows.push({
      kind: 'outbound',
      id: n.id,
      at: n.createdAt,
      from: lines[0] ?? 'Sent',
      subject,
      // The body proper starts after the blank line the recorder writes.
      body: n.plainText.split('\n\n').slice(1).join('\n\n'),
      conversationId: null,
    })
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
}

/**
 * The Mail log's grouping: entries sharing a conversationId become one conversation, ordered
 * inside by time; every null-conversation row stays its OWN singleton (the intake form writes
 * no conversation id, and inventing a shared "no conversation" bucket would thread strangers
 * together). Conversations order by their latest entry, newest first — a log's reading order.
 */
export function groupByConversation(entries: MailEntry[]): MailConversation[] {
  const byId = new Map<string, MailEntry[]>()
  const singles: MailConversation[] = []
  for (const e of entries) {
    if (!e.conversationId) {
      singles.push({ conversationId: null, entries: [e] })
      continue
    }
    const list = byId.get(e.conversationId) ?? []
    list.push(e)
    byId.set(e.conversationId, list)
  }
  const grouped: MailConversation[] = [...byId.entries()].map(([conversationId, list]) => ({
    conversationId,
    entries: list.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
  }))
  const latest = (c: MailConversation) => c.entries[c.entries.length - 1]?.at ?? ''
  return [...grouped, ...singles].sort((a, b) => latest(b).localeCompare(latest(a)))
}
