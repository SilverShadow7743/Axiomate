/**
 * A lightweight to-do list within a task.
 *
 * Pure — no clock, no I/O, same discipline as `lib/notes.ts`. See
 * `docs/plans/2026-09-07-checklist-design.md` for why this exists and how it differs from a real
 * subtask (`Issue.parentIssueId`/`subIssues`): no status, no owner, no dates. A checklist item
 * that needs any of those is a subtask, not this.
 */

export interface ChecklistItem {
  /** `chk-12`, minted from the durable workspace counter. */
  id: string
  issueId: string
  text: string
  done: boolean
  /** Presentation order. Not a dependency — same rule as `Milestone.sequence`. */
  sequence: number

  doneAt: string | null
  doneBy: string | null

  recordedBy: string
  recordedAt: string
  deletedAt: string | null
}

/** Next position, counting removed items too — same reasoning as `nextSequence` in
 *  `lib/milestone.ts`: reusing a removed item's position would put a new one where an old one
 *  sits in an audit trail somebody may be reading beside it. */
export function nextChecklistSequence(items: Record<string, ChecklistItem>, issueId: string): number {
  const mine = Object.values(items).filter((i) => i.issueId === issueId)
  return mine.reduce((n, i) => Math.max(n, i.sequence), 0) + 1
}

/** Live items for one issue, in presentation order. */
export function checklistFor(items: Record<string, ChecklistItem>, issueId: string): ChecklistItem[] {
  return Object.values(items)
    .filter((i) => i.issueId === issueId && !i.deletedAt)
    .sort((a, b) => a.sequence - b.sequence)
}

/** A count you can read, never a percentage stored as fact — see the design doc's own rule. */
export function checklistCount(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length }
}

export function checkChecklistItem(text: string): string | null {
  if (!text.trim()) return 'A checklist item needs text.'
  return null
}
