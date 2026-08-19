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
 * One sentence over the board, same discipline as every other panel: counts, no score.
 */
export function describeBoard(lanes: BoardLane[]): string {
  const total = lanes.reduce((n, l) => n + l.rows.length, 0)
  if (!total) return 'Nothing to show under the current filters.'
  const occupied = lanes.filter((l) => l.rows.length)
  return `${total} ${total === 1 ? 'item' : 'items'} across ${occupied.length} of ${lanes.length} statuses. Dragging a card asks the same transition rules as the grid — nothing moves here that could not move there.`
}
