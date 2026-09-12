import { ISSUE_STATUSES, type IssueStatus, type ScheduleRow } from './types'
import { checkTransition, type StatusPolicy } from './statusPolicy'

/**
 * The board: the register grouped by status, and the rule for what a drag may do.
 *
 * A presentation, not a subsystem. Lanes are computed from the same filtered rows the tree
 * renders, and the one mutation the board offers — dropping a card on another lane — goes
 * through `dropOutcome`, which is `checkTransition` wearing a drag glove. The board never
 * composes its own refusal text and never dispatches anything the grid could not: it is the
 * same lever held sideways.
 */

export interface BoardLane {
  status: IssueStatus
  rows: ScheduleRow[]
}

/**
 * Lanes in `ISSUE_STATUSES` order — the transition graph's own order, not popularity's.
 *
 * Only leaf rows with a status can sit on a board; structural tiers (engagement, project) have
 * `status: null` and are simply not cards. Every lane exists even when empty: a board that
 * hides empty lanes hides where work is allowed to go.
 */
export function boardLanes(rows: ScheduleRow[]): BoardLane[] {
  const byStatus = new Map<IssueStatus, ScheduleRow[]>(ISSUE_STATUSES.map((s) => [s, []]))
  for (const row of rows) {
    if (row.status === null) continue
    byStatus.get(row.status)?.push(row)
  }
  return ISSUE_STATUSES.map((status) => ({ status, rows: byStatus.get(status) ?? [] }))
}

/**
 * What a drop is allowed to do, decided before anything moves.
 *
 *   ok        dispatch the ordinary updateIssue, nothing more to collect
 *   ask       the target status requires a reason — open the closure dialog and dispatch on
 *             submit, exactly as the detail editor does
 *   refused   the move is not allowed as it stands; the card snaps back and the message —
 *             the policy's own words, never composed here — renders at the lane
 *
 * Missing evidence is `refused`, not `ask`: a drop dialog cannot conjure evidence, and the
 * policy's message already names what is missing and why. Making it a dialog would be a form
 * with no valid submission.
 */
export type DropOutcome =
  | { kind: 'ok' }
  | { kind: 'ask'; message: string }
  | { kind: 'refused'; message: string }

export function dropOutcome(
  policy: StatusPolicy,
  row: ScheduleRow,
  to: IssueStatus,
  hasEvidence: boolean,
): DropOutcome {
  if (row.status === to) return { kind: 'ok' }

  // Reason deliberately absent: a drag carries none, and the point of this check is to learn
  // whether one must be collected before dispatch.
  const problem = checkTransition(policy, row.status, to, { hasEvidence })
  if (!problem) return { kind: 'ok' }
  if (problem.kind === 'reason') return { kind: 'ask', message: problem.message }
  return { kind: 'refused', message: problem.message }
}

/**
 * What a bulk drop is allowed to do, decided before anything moves — `dropOutcome` run across
 * every selected row rather than one (12 Sep review, multi-select design). `ask` never appears
 * here: a bulk status change collects one reason unconditionally (`commitCell`'s `'status'`
 * case requires one for every change, not only the ones `checkTransition` itself flags), so
 * there is nothing for the caller to branch on beyond ok-or-refused. A row already at `to` is
 * `dropOutcome`'s own no-op `ok` (`:59` above) and is never refused — the caller skips dispatching
 * for it rather than sending a no-op update, which `bulkStatusChoices` below relies on.
 */
export type BulkDropOutcome =
  | { kind: 'ok' }
  | { kind: 'refused'; refused: { rowId: string; message: string }[] }

export function bulkDropOutcome(
  policy: StatusPolicy,
  rows: ScheduleRow[],
  to: IssueStatus,
  hasEvidence: (rowId: string) => boolean,
): BulkDropOutcome {
  const refused: { rowId: string; message: string }[] = []
  for (const row of rows) {
    const outcome = dropOutcome(policy, row, to, hasEvidence(row.id))
    if (outcome.kind === 'refused') refused.push({ rowId: row.id, message: outcome.message })
  }
  return refused.length ? { kind: 'refused', refused } : { kind: 'ok' }
}

/**
 * Every status a bulk change may offer — the ones `bulkDropOutcome` refuses for no selected
 * row. Not `allowedNext` intersected across the rows: `dropOutcome` already carries the no-op
 * and evidence handling `allowedNext` alone does not, and reusing it here is what keeps the
 * picker and the eventual commit checking the exact same rule.
 */
export function bulkStatusChoices(
  policy: StatusPolicy,
  rows: ScheduleRow[],
  hasEvidence: (rowId: string) => boolean,
): IssueStatus[] {
  return ISSUE_STATUSES.filter((to) => bulkDropOutcome(policy, rows, to, hasEvidence).kind === 'ok')
}

/**
 * One sentence over the board, same discipline as every other panel: counts, no score.
 */
export function describeBoard(lanes: BoardLane[]): string {
  const total = lanes.reduce((n, l) => n + l.rows.length, 0)
  if (!total) return 'Nothing to show under the current filters.'
  const occupied = lanes.filter((l) => l.rows.length)
  return `${total} ${total === 1 ? 'item' : 'items'} across ${occupied.length} of ${lanes.length} statuses. Dragging a card asks the same transition rules as the grid — nothing moves here that could not move there.`
}
