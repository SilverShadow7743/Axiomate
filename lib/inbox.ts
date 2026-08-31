/**
 * One place for what needs a decision, what's waiting on somebody else, and what the rules
 * have told this person — the unified inbox (`docs/plans/2026-08-31-unified-inbox-design.md`).
 *
 * Composes three already-real sources rather than computing a fourth thing:
 *
 *   needsAction — `decisionItems` (`lib/mywork.ts`), the same five collections `myWork`'s own
 *                  `decide` group reads. Deliberately NOT deduplicated against My Work's list —
 *                  see the design's "known, accepted overlap."
 *   waiting     — this file's own `waitingItems`, the requester's-eye mirror of four of
 *                  `decisionItems`' five sources (approvals/timesheets/milestones/changes).
 *                  Scope items are excluded — see `waitingItems`'s own comment.
 *   fyi         — `inboxFor` (`lib/notifications.ts`), unchanged, the same list `Inbox.tsx`
 *                  already renders.
 */

import { directoryPersonFor } from './access'
import { inboxFor, type Notification } from './notifications'
import { decisionItems, type WorkItem } from './mywork'
import type { Actor } from './actor'
import type { WorkspaceState } from './workspace'

/**
 * The requester's-eye mirror of four of `decisionItems`' five sources: not "is this mine to
 * decide" but "did I raise it, and is it still somebody else's to decide."
 *
 * Recomputes its own `person`/`isMe`/`isMine` for the same reason `decisionItems` does — a
 * standalone exported function has no closure to share.
 *
 * Scope items are deliberately absent. `decisionItems`' scope-to-agree source has no requester
 * field to flip — every pending line is offered to anyone holding `scope.approve`, with no
 * record of who typed it — so there is nothing honest to mirror here. Not a gap to fill later
 * without first deciding whether `ScopeItem` should carry a requester at all.
 */
export function waitingItems(state: WorkspaceState, actor: Actor): WorkItem[] {
  const person = directoryPersonFor(state.model, actor)
  const name = (person?.name ?? actor.name ?? '').trim()
  const mine = name.toLowerCase()
  const isMe = (who: string | null | undefined) => (who ?? '').trim().toLowerCase() === mine
  const isMine = (who: string | null | undefined, whoId?: string | null): boolean =>
    whoId ? person?.id === whoId : isMe(who)
  const items: WorkItem[] = []

  for (const a of Object.values(state.approvals)) {
    if (a.decision || !isMe(a.requestedBy)) continue
    items.push({
      key: `appr:${a.id}`,
      reason: 'decide',
      severity: null,
      subjectId: a.subjectId,
      title: a.question || 'Approval',
      why: `Asked on ${a.requestedAt.slice(0, 10)}, and not yet decided.`,
      when: a.requestedAt.slice(0, 10),
    })
  }

  for (const t of Object.values(state.timesheets)) {
    if (t.status !== 'Submitted' || !isMine(t.person, t.personId)) continue
    items.push({
      key: `ts:${t.id}`,
      reason: 'decide',
      severity: null,
      subjectId: null,
      title: `Your week of ${t.weekStarting}`,
      why: 'Submitted and awaiting approval.',
      when: t.submittedAt.slice(0, 10),
    })
  }

  for (const m of Object.values(state.milestones)) {
    if (m.deletedAt || m.delivery !== 'Delivered' || m.acceptance !== 'Pending' || !isMe(m.deliveredBy)) continue
    items.push({
      key: `ms:${m.id}`,
      reason: 'decide',
      severity: null,
      subjectId: m.sowId,
      title: `Milestone: ${m.name}`,
      why: `Delivered on ${m.deliveredAt?.slice(0, 10) ?? 'an unrecorded date'}, awaiting acceptance.`,
      when: m.deliveredAt?.slice(0, 10) ?? null,
    })
  }

  for (const c of Object.values(state.changes)) {
    if (c.deletedAt || c.status !== 'Submitted' || !isMe(c.requestedBy)) continue
    items.push({
      key: `cr:${c.id}`,
      reason: 'decide',
      severity: null,
      subjectId: c.sowId,
      title: `Change: ${c.title}`,
      why: `Raised by you. ${c.effortHours > 0 ? '+' : ''}${c.effortHours}h, awaiting a decision.`,
      when: c.requestedAt.slice(0, 10),
    })
  }

  return items
}

export interface UnifiedInboxLists {
  needsAction: WorkItem[]
  waiting: WorkItem[]
  fyi: Notification[]
}

export function unifiedInbox(state: WorkspaceState, actor: Actor): UnifiedInboxLists {
  const person = directoryPersonFor(state.model, actor)
  return {
    needsAction: decisionItems(state, actor),
    waiting: waitingItems(state, actor),
    fyi: inboxFor(state.notifications, actor.name, person?.id ?? null),
  }
}
