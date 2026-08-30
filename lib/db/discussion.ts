import 'server-only'
import { randomUUID } from 'crypto'
import { withTenant } from './client'
import { loadModelOnly } from './repo'
import { persistActions } from './persist'
import { discussionMessageFromRow, discussionThreadFromRow } from './map'
import { autoFollowsAt, recipientsFor, type DiscussionMessage, type DiscussionScopeKind, type DiscussionThread } from '../discussion'
import { can, directoryIdByName, directoryPersonFor } from '../access'
import type { Actor } from '../actor'
import type { Action } from '../workspace'
import type { TenantId } from '../tenant'

/**
 * The Discussion domain's server half — E3 (`2026-08-30-e3-discussion-design.md`).
 *
 * This module deliberately BYPASSES the reducer and `persistSteps`: discussion rows never
 * enter `WorkspaceState`, so `persistActions` could not carry them (it replays the reducer
 * over state, and the E2 lesson — an arm whose rows the writer drops persists nothing — is
 * why `scripts/discussion-proof.ts` lands in the same commit as this file and is this
 * domain's only net). Three postures carry over unchanged from the reducer world:
 *
 *   - the ACTOR IS A PARAMETER — attribution is stamped from whoever the server resolved,
 *     never accepted from a payload; it is also what lets the proof drive multiple people;
 *   - every query runs under `withTenant` AND names the tenant at the call site, because the
 *     tenancy audit is a text scan and a reader should see the scoping without following a
 *     variable;
 *   - `internal.view` gates reading AND posting — a discussion is internal collaboration,
 *     and the model for that check comes from `loadModelOnly`, not `loadWorkspace`, because
 *     this path is polled.
 *
 * The one crossing BACK into the workspace domain is the mint: a post dispatches ordinary
 * `notify` actions through `persistActions`, so preferences (mute / in-app / in-app+email),
 * the mute-audit line and the email drain apply to discussion traffic exactly as they do to
 * every rule's. `recipientsFor` (pure, scenario E3A) decides who: followers-minus-author
 * under the `chat` kind, mentions under `mention` — one record per person per message.
 */

export interface ThreadView {
  thread: DiscussionThread | null
  messages: DiscussionMessage[]
  /** Whether the CALLER follows it — the only follow state a reader needs. */
  following: boolean
  /** How many people follow — the tab shows it beside the toggle. */
  followerCount: number
}

const PAGE = 50

function scopeProblem(scopeKind: string, scopeId: string): string | null {
  if (scopeKind !== 'issue' && scopeKind !== 'project') {
    return `A discussion belongs to an issue or a project — received ${JSON.stringify(scopeKind)}.`
  }
  if (!scopeId.trim()) return 'A discussion needs the record it is about.'
  return null
}

async function readGate(tenantId: TenantId, actor: Actor): Promise<{ model: Awaited<ReturnType<typeof loadModelOnly>>; error?: string }> {
  const model = await loadModelOnly(tenantId)
  const verdict = can(model, actor, 'internal.view')
  if (!verdict.allowed) {
    return { model, error: verdict.reason ?? 'Discussions are internal — this sign-in cannot read them.' }
  }
  return { model }
}

export async function listThread(
  tenantId: TenantId,
  actor: Actor,
  scopeKind: DiscussionScopeKind,
  scopeId: string,
  before?: string,
): Promise<ThreadView | { error: string }> {
  const bad = scopeProblem(scopeKind, scopeId)
  if (bad) return { error: bad }
  const gate = await readGate(tenantId, actor)
  if (gate.error) return { error: gate.error }
  const meId = directoryPersonFor(gate.model, actor)?.id ?? null

  return withTenant(tenantId, async (tx) => {
    const threadRow = await tx.discussionThread.findUnique({
      where: { tenantId_scopeKind_scopeId: { tenantId, scopeKind, scopeId } },
    })
    if (!threadRow) return { thread: null, messages: [], following: false, followerCount: 0 }
    const rows = await tx.discussionMessage.findMany({
      where: {
        tenantId,
        threadId: threadRow.id,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE,
    })
    const follows = await tx.discussionFollow.findMany({ where: { tenantId, threadId: threadRow.id } })
    return {
      thread: discussionThreadFromRow(threadRow),
      messages: rows.map(discussionMessageFromRow).reverse(),
      following: Boolean(meId && follows.some((f) => f.personId === meId)),
      followerCount: follows.length,
    }
  })
}

export async function postMessage(
  tenantId: TenantId,
  actor: Actor,
  scopeKind: DiscussionScopeKind,
  scopeId: string,
  body: string,
  /** The record owner's name when the caller knows it (issue scope) — resolved to a directory
   *  id here for the birth auto-follow; irrelevant after the thread exists. */
  ownerName?: string | null,
): Promise<{ message: DiscussionMessage } | { error: string }> {
  const bad = scopeProblem(scopeKind, scopeId)
  if (bad) return { error: bad }
  const text = body.trim()
  if (!text) return { error: 'Say something — an empty message is not a message.' }
  if (text.length > 4000) return { error: 'Keep a message under 4,000 characters — a longer thought is a note.' }
  const gate = await readGate(tenantId, actor)
  if (gate.error) return { error: gate.error }
  const model = gate.model
  const authorId = directoryPersonFor(model, actor)?.id ?? null
  const now = new Date()

  const result = await withTenant(tenantId, async (tx) => {
    /* Lazy thread creation, race-safe: the unique (tenant, scopeKind, scopeId) index decides
     * between two first-posts; the loser re-reads and appends (P2002 is the index working). */
    let threadRow = await tx.discussionThread.findUnique({
      where: { tenantId_scopeKind_scopeId: { tenantId, scopeKind, scopeId } },
    })
    let born = false
    if (!threadRow) {
      try {
        threadRow = await tx.discussionThread.create({
          data: { tenantId, id: randomUUID().replace(/-/g, ''), scopeKind, scopeId, createdAt: now, createdBy: actor.name },
        })
        born = true
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err
        threadRow = await tx.discussionThread.findUnique({
          where: { tenantId_scopeKind_scopeId: { tenantId, scopeKind, scopeId } },
        })
        if (!threadRow) throw err
      }
    }

    /* Birth auto-follows: the author always; the record's owner on issue scope (E3B). */
    const followIds = born
      ? autoFollowsAt({
          scopeKind,
          authorId,
          ownerId: ownerName ? directoryIdByName(model, ownerName) : null,
        })
      : autoFollowsAt({ scopeKind, authorId, ownerId: null })
    for (const personId of followIds) {
      await tx.discussionFollow.upsert({
        where: { tenantId_threadId_personId: { tenantId, threadId: threadRow.id, personId } },
        create: { tenantId, id: randomUUID().replace(/-/g, ''), threadId: threadRow.id, personId, createdAt: now },
        update: {},
      })
    }

    const messageRow = await tx.discussionMessage.create({
      data: {
        tenantId,
        id: randomUUID().replace(/-/g, ''),
        threadId: threadRow.id,
        author: actor.name,
        authorId,
        body: text,
        createdAt: now,
        deletedAt: null,
      },
    })
    const follows = await tx.discussionFollow.findMany({ where: { tenantId, threadId: threadRow.id } })
    return { messageRow, followerIds: follows.map((f) => f.personId) }
  })

  /* The mint — ordinary notify actions through the ordinary funnel, AFTER the write
   * transaction so a Microsoft-speed lock never wraps a message insert. */
  const people = Object.values(model.people).map((p) => ({ id: p.id, name: p.name }))
  const split = recipientsFor({ followerIds: result.followerIds, authorId, body: text, people })
  const nameOf = (id: string) => model.people[id]?.name ?? id
  const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text
  const nowIso = now.toISOString()
  const mints: Action[] = [
    ...split.chat.map(
      (personId) =>
        ({
          t: 'notify',
          to: nameOf(personId),
          channel: 'in-app',
          subject: `New message on ${scopeId}`,
          body: `${actor.name}: “${preview}” — a discussion you follow.`,
          aboutId: scopeId,
          ruleId: 'discussion-message',
          kind: 'chat',
          now: nowIso,
        }) as Action,
    ),
    ...split.mentions.map(
      (m) =>
        ({
          t: 'notify',
          to: m.name,
          channel: 'in-app',
          subject: `${actor.name} mentioned you on ${scopeId}`,
          body: `${actor.name}: “${preview}”`,
          aboutId: scopeId,
          ruleId: 'discussion-message',
          kind: 'mention',
          now: nowIso,
        }) as Action,
    ),
  ]
  if (mints.length) await persistActions(tenantId, actor, mints)

  return { message: discussionMessageFromRow(result.messageRow) }
}

export async function setFollow(
  tenantId: TenantId,
  actor: Actor,
  scopeKind: DiscussionScopeKind,
  scopeId: string,
  follow: boolean,
): Promise<{ following: boolean } | { error: string }> {
  const bad = scopeProblem(scopeKind, scopeId)
  if (bad) return { error: bad }
  const gate = await readGate(tenantId, actor)
  if (gate.error) return { error: gate.error }
  const meId = directoryPersonFor(gate.model, actor)?.id ?? null
  if (!meId) return { error: 'Following needs a directory entry, and this sign-in matches none.' }

  return withTenant(tenantId, async (tx) => {
    const threadRow = await tx.discussionThread.findUnique({
      where: { tenantId_scopeKind_scopeId: { tenantId, scopeKind, scopeId } },
    })
    if (!threadRow) return { error: 'Nothing has been said here yet — the first message starts the thread.' }
    if (follow) {
      await tx.discussionFollow.upsert({
        where: { tenantId_threadId_personId: { tenantId, threadId: threadRow.id, personId: meId } },
        create: { tenantId, id: randomUUID().replace(/-/g, ''), threadId: threadRow.id, personId: meId, createdAt: new Date() },
        update: {},
      })
    } else {
      await tx.discussionFollow.deleteMany({ where: { tenantId, threadId: threadRow.id, personId: meId } })
    }
    return { following: follow }
  })
}

export async function removeOwn(
  tenantId: TenantId,
  actor: Actor,
  messageId: string,
): Promise<{ removed: true } | { error: string }> {
  const gate = await readGate(tenantId, actor)
  if (gate.error) return { error: gate.error }
  const meId = directoryPersonFor(gate.model, actor)?.id ?? null

  return withTenant(tenantId, async (tx) => {
    const row = await tx.discussionMessage.findUnique({ where: { tenantId_id: { tenantId, id: messageId } } })
    if (!row || row.deletedAt) return { error: 'That message no longer exists.' }
    const own = row.authorId ? row.authorId === meId : row.author.trim().toLowerCase() === actor.name.trim().toLowerCase()
    if (!own) return { error: 'Only the person who said it can take it back.' }
    await tx.discussionMessage.update({
      where: { tenantId_id: { tenantId, id: messageId } },
      data: { deletedAt: new Date() },
    })
    return { removed: true as const }
  })
}
