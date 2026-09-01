import type { Actor } from './actor'
import { issuesUnder } from './engagement'
import { sowCostOf, type CostOfWork, type PersonRate } from './rates'
import type { WorkspaceState } from './workspace'

/**
 * A point-in-time copy of what a project or engagement's issues looked like — planned dates and
 * (when the taker held `rate.view`) cost. Never changes once taken. See
 * docs/plans/2026-09-01-project-snapshot-design.md.
 */
export interface SnapshotEntry {
  issueId: string
  /** Captured at the time — a later rename doesn't rewrite history. */
  subject: string
  plannedStart: string | null
  plannedEnd: string | null
}

export interface Snapshot {
  id: string
  nodeId: string
  nodeKind: 'project' | 'engagement'
  /** Captured at the time, same reasoning as SnapshotEntry.subject. */
  nodeName: string
  takenAt: string
  takenBy: string
  entries: SnapshotEntry[]
  /**
   * `sowCostOf()`'s own output, frozen. Null for one of two reasons, and the record does not
   * distinguish them: the taker lacked `rate.view` at the time (never computed — the same
   * "null entirely, never computed-then-hidden" rule CommercialPanel's own cost block already
   * follows), or the node's issues carried no priced time. Never re-checked on view — this
   * field records what WAS captured, not what could be computed now.
   */
  cost: CostOfWork | null
  deletedAt: string | null
}

/**
 * Composes three already-proven primitives; reimplements none of them. `rates` is the caller's
 * decision — pass `[]` for an actor without `rate.view` and `cost` comes back exactly as
 * `sowCostOf` already answers "no rates available": `cost: null, unratedHours: <all>`. This
 * function takes no permission decision itself; that is the reducer arm's job.
 *
 * `id` is a parameter rather than minted here, matching this codebase's own convention: identity
 * is tied to `state.seq`, which only the reducer arm advances (the same reason `rel-`/`dep-`/
 * `cr-` ids are computed inline in `apply()`'s arms, never inside a pure lib module that has no
 * business deciding when the counter moves).
 */
export function takeSnapshot(
  state: WorkspaceState,
  id: string,
  nodeId: string,
  rates: PersonRate[],
  actor: Actor,
  now: string,
): Snapshot {
  const node = state.nodes[nodeId]
  const issues = issuesUnder(state, nodeId)
  const entries: SnapshotEntry[] = issues.map((i) => ({
    issueId: i.id,
    subject: i.subject,
    plannedStart: i.plannedStart,
    plannedEnd: i.plannedEnd,
  }))
  /*
   * Collapsed to the bare `null` the interface promises, not a `CostOfWork` whose own `.cost`
   * field happens to be null — `sowCostOf([], ...)` (no rate.view) and `sowCostOf(rates, ...)`
   * over entirely unrated hours produce the identical shape, and the design is explicit that
   * the record must not distinguish them: "both read the same to a later viewer: nothing to
   * show."
   */
  const priced = sowCostOf(rates, issues.map((i) => i.id), state.timeEntries)
  const cost = priced.cost === null ? null : priced

  return {
    id,
    nodeId,
    nodeKind: node?.kind === 'engagement' ? 'engagement' : 'project',
    nodeName: node?.name ?? '',
    takenAt: now,
    takenBy: actor.name,
    entries,
    cost,
    deletedAt: null,
  }
}
