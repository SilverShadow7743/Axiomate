import type {
  IssueDependency,
  IssueStatus,
  ScheduleHealth,
  ScheduleRow,
  Severity,
  SlaPolicy,
} from './types'
import { addWorkingDays, daysBetween, maxIso, minIso, toUtc, workingDaysBetween } from './dates'

/**
 * Status -> % complete.
 *
 * This is a *stated convention*, not data from the issue log. The log records a lifecycle
 * status but no progress figure, so any percentage shown against an un-decomposed issue is
 * derived from this table. Rows carrying it are tagged `progressOrigin: 'status-derived'`
 * and the UI labels them, so a derived number is never mistaken for a reported one.
 */
export const STATUS_PROGRESS: Record<IssueStatus, number> = {
  Open: 0,
  'Needs clarification': 10,
  'In Progress': 50,
  'Awaiting client confirmation': 80,
  'Closed - confirmed': 100,
  'Closed - no defect': 100,
  Superseded: 100,
}

/** Statuses that mean the issue is finished, whatever the reason. */
export const TERMINAL_STATUSES: IssueStatus[] = [
  'Closed - confirmed',
  'Closed - no defect',
  'Superseded',
]

/**
 * Statuses that mean work is halted pending someone outside the delivery team.
 * Spec §10 defines Blocked as "blocked by a dependency or external decision" — these
 * two statuses are exactly that, recorded in the source log.
 */
export const BLOCKED_STATUSES: IssueStatus[] = [
  'Awaiting client confirmation',
  'Needs clarification',
]

export function isTerminal(status: IssueStatus | null): boolean {
  return !!status && TERMINAL_STATUSES.includes(status)
}

/**
 * Schedule health (spec §10).
 *
 * Deliberately NOT computed from percentage alone. Inputs: today, planned start/end,
 * completion, blocked status, and unmet predecessors.
 *
 * `Unscheduled` is returned when there is no planned end date. The imported log carries no
 * due dates, so this is the honest answer for an un-planned issue — calling it "On Track"
 * would assert a schedule that does not exist.
 */
export function computeHealth(
  row: Pick<
    ScheduleRow,
    'status' | 'plannedEndDate' | 'plannedStartDate' | 'percentComplete' | 'actualEndDate'
  >,
  today: string,
  opts: { blockedByDependency?: boolean } = {},
): ScheduleHealth {
  if (isTerminal(row.status) || row.percentComplete >= 100) return 'Completed'
  if (opts.blockedByDependency) return 'Blocked'
  if (row.status && BLOCKED_STATUSES.includes(row.status)) return 'Blocked'
  if (!row.plannedEndDate) return 'Unscheduled'

  if (row.plannedEndDate < today) return 'Overdue'

  // At Risk: inside the final third of the window with progress lagging elapsed time.
  if (row.plannedStartDate && row.plannedStartDate <= today) {
    const total = daysBetween(row.plannedStartDate, row.plannedEndDate)
    const elapsed = daysBetween(row.plannedStartDate, today)
    const elapsedPct = total > 0 ? (elapsed / total) * 100 : 0
    if (elapsedPct >= 66 && row.percentComplete < elapsedPct - 15) return 'At Risk'
  }
  return 'On Track'
}

/**
 * Roll a parent's schedule up from its children (spec §4).
 *
 * Returns the derived values only. The caller decides whether to apply them: a row in
 * MANUAL mode keeps its own dates, so manually entered dates are never overwritten
 * without confirmation.
 */
export function rollUp(children: ScheduleRow[]): {
  start: string | null
  end: string | null
  percentComplete: number
} {
  const scheduled = children.filter((c) => c.plannedStartDate || c.plannedEndDate)
  const start = minIso(scheduled.map((c) => c.plannedStartDate))
  const end = maxIso(scheduled.map((c) => c.plannedEndDate))

  // Duration-weighted progress only when EVERY child is sized.
  //
  // Substituting a weight of 1 for an unscheduled child would make it almost weightless
  // beside a scheduled sibling spanning weeks — and since the imported log has no dates,
  // mixed sets are the normal case here. A module with one 30-day open issue and nine closed
  // unscheduled ones would report 23% instead of 90%. When sizes are unknown, every child
  // counts equally.
  let percentComplete = 0
  if (children.length) {
    const allSized = children.every((c) => c.duration != null && c.duration > 0)
    if (allSized) {
      const weights = children.map((c) => c.duration as number)
      const totalWeight = weights.reduce((a, b) => a + b, 0)
      percentComplete = Math.round(
        children.reduce((sum, c, i) => sum + c.percentComplete * weights[i], 0) / totalWeight,
      )
    } else {
      percentComplete = Math.round(
        children.reduce((s, c) => s + c.percentComplete, 0) / children.length,
      )
    }
  }
  return { start, end, percentComplete }
}

/**
 * Propose a target completion date from the SLA policy (working days from the raised date).
 *
 * This is a *suggestion*. It is surfaced as `plannedOrigin: 'proposed'` and drawn as a
 * hollow bar; it only becomes a planned date when a user commits it. The source log
 * contains no due dates, so proposing is the only way to get a forward-looking view —
 * but a proposal must never be presented as a recorded commitment.
 */
export function proposeTargetDate(
  raised: string,
  severity: Severity,
  policy: SlaPolicy,
): string {
  return addWorkingDays(raised, policy[severity])
}

/** Recompute duration fields for a row with planned dates. */
export function computeDurations(start: string | null, end: string | null): {
  duration: number | null
  workingDuration: number | null
} {
  if (!start || !end || end < start) return { duration: null, workingDuration: null }
  return { duration: daysBetween(start, end), workingDuration: workingDaysBetween(start, end) }
}

/* ------------------------------------------------------------------ *
 * Critical Resolution Path (spec §11)
 * ------------------------------------------------------------------ */

export interface CrpNode {
  rowId: string
  earliestStart: string
  earliestFinish: string
  isCritical: boolean
  slackDays: number
}

export interface CrpResult {
  /** True only when there was enough dependency + date data to compute anything. */
  sufficient: boolean
  reason?: string
  /** Ordered chain of row ids that determines the resolution date. */
  chain: string[]
  projectedResolutionDate: string | null
  /** Positive = later than the issue's planned end (slipping). */
  scheduleVarianceDays: number | null
  /** The dependency edge that is driving the date, if any. */
  criticalBlockingDependency: { predecessorId: string; successorId: string } | null
  nodes: Record<string, CrpNode>
}

/**
 * Forward-pass critical path over an issue's lifecycle activities.
 *
 * Returns `sufficient: false` rather than guessing when the activities lack dates or
 * dependencies — spec §11 explicitly forbids fabricating a path for incomplete data.
 */
export function criticalResolutionPath(
  activities: ScheduleRow[],
  dependencies: IssueDependency[],
  plannedEnd: string | null,
): CrpResult {
  const empty: CrpResult = {
    sufficient: false,
    chain: [],
    projectedResolutionDate: null,
    scheduleVarianceDays: null,
    criticalBlockingDependency: null,
    nodes: {},
  }

  if (activities.length < 2) {
    return { ...empty, reason: 'Issue has fewer than two scheduled activities.' }
  }
  const undated = activities.filter((a) => !a.plannedStartDate || !a.plannedEndDate)
  if (undated.length) {
    return {
      ...empty,
      reason: `${undated.length} of ${activities.length} activities have no planned dates.`,
    }
  }
  const ids = new Set(activities.map((a) => a.id))
  const edges = dependencies.filter((d) => ids.has(d.predecessorId) && ids.has(d.successorId))
  if (!edges.length) {
    return { ...empty, reason: 'No scheduling dependencies defined between these activities.' }
  }

  // Topological order.
  const indeg = new Map<string, number>()
  const succ = new Map<string, IssueDependency[]>()
  activities.forEach((a) => {
    indeg.set(a.id, 0)
    succ.set(a.id, [])
  })
  edges.forEach((e) => {
    indeg.set(e.successorId, (indeg.get(e.successorId) ?? 0) + 1)
    succ.get(e.predecessorId)!.push(e)
  })

  const queue = activities.filter((a) => (indeg.get(a.id) ?? 0) === 0).map((a) => a.id)
  const order: string[] = []
  const workIndeg = new Map(indeg)
  while (queue.length) {
    const id = queue.shift()!
    order.push(id)
    for (const e of succ.get(id) ?? []) {
      const n = (workIndeg.get(e.successorId) ?? 0) - 1
      workIndeg.set(e.successorId, n)
      if (n === 0) queue.push(e.successorId)
    }
  }
  if (order.length !== activities.length) {
    return { ...empty, reason: 'Dependency cycle detected — cannot compute a resolution path.' }
  }

  const byId = new Map(activities.map((a) => [a.id, a]))
  const es = new Map<string, string>()
  const ef = new Map<string, string>()
  /** Which predecessor drove this row's earliest start. */
  const driver = new Map<string, string | null>()

  for (const id of order) {
    const a = byId.get(id)!
    let start = a.plannedStartDate!
    let drivenBy: string | null = null
    // Days this activity occupies beyond its start. A milestone has duration 0 but still
    // takes the day it falls on, so `?? 1` is not enough — 0 is not nullish, and using it
    // raw pushes FF/SF successors a day late.
    const span = Math.max(1, a.duration ?? 1) - 1
    const incoming = edges.filter((e) => e.successorId === id)
    for (const e of incoming) {
      const p = byId.get(e.predecessorId)!
      const pStart = es.get(p.id)!
      const pFinish = ef.get(p.id)!
      let candidate: string
      switch (e.dependencyType) {
        case 'FS':
          candidate = shiftIso(pFinish, 1 + e.lagDays)
          break
        case 'SS':
          candidate = shiftIso(pStart, e.lagDays)
          break
        case 'FF':
          // Successor must finish no earlier than predecessor finish; express via its own span.
          candidate = shiftIso(pFinish, e.lagDays - span)
          break
        case 'SF':
          candidate = shiftIso(pStart, e.lagDays - span)
          break
      }
      if (candidate > start) {
        start = candidate
        drivenBy = p.id
      } else if (candidate === start && drivenBy === null) {
        // A predecessor that lands exactly on this activity's planned start is still the
        // thing determining that start. Without this, a plan whose dates already satisfy
        // every dependency would report a one-link chain and no critical path at all.
        drivenBy = p.id
      }
    }
    es.set(id, start)
    ef.set(id, shiftIso(start, span))
    driver.set(id, drivenBy)
  }

  // The project finish is the latest earliest-finish.
  let finishId = order[0]
  for (const id of order) if (ef.get(id)! > ef.get(finishId)!) finishId = id
  const projected = ef.get(finishId)!

  // Walk the driver chain backwards from the finishing activity.
  const chain: string[] = []
  let cursor: string | null = finishId
  const guard = new Set<string>()
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor)
    chain.unshift(cursor)
    cursor = driver.get(cursor) ?? null
  }

  const criticalSet = new Set(chain)
  const nodes: Record<string, CrpNode> = {}
  for (const id of order) {
    nodes[id] = {
      rowId: id,
      earliestStart: es.get(id)!,
      earliestFinish: ef.get(id)!,
      isCritical: criticalSet.has(id),
      slackDays: Math.round((toUtc(projected) - toUtc(ef.get(id)!)) / 86_400_000),
    }
  }

  const lastEdge =
    chain.length >= 2
      ? { predecessorId: chain[chain.length - 2], successorId: chain[chain.length - 1] }
      : null

  return {
    sufficient: true,
    chain,
    projectedResolutionDate: projected,
    scheduleVarianceDays: plannedEnd
      ? Math.round((toUtc(projected) - toUtc(plannedEnd)) / 86_400_000)
      : null,
    criticalBlockingDependency: lastEdge,
    nodes,
  }
}

function shiftIso(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * 86_400_000).toISOString().slice(0, 10)
}

/* ------------------------------------------------------------------ *
 * Validation for drag-scheduling (spec §8)
 * ------------------------------------------------------------------ */

export interface Violation {
  severity: 'error' | 'warning'
  message: string
}

/** Validate a proposed date change against dependencies and parent constraints. */
export function validateChange(
  row: ScheduleRow,
  next: { start: string; end: string },
  all: Map<string, ScheduleRow>,
  dependencies: IssueDependency[],
): Violation[] {
  const out: Violation[] = []
  if (next.end < next.start) {
    out.push({ severity: 'error', message: 'End date cannot fall before the start date.' })
  }

  for (const dep of dependencies.filter((d) => d.successorId === row.id)) {
    const pred = all.get(dep.predecessorId)
    if (!pred?.plannedEndDate) continue
    if (dep.dependencyType === 'FS') {
      const earliest = shiftIso(pred.plannedEndDate, 1 + dep.lagDays)
      if (next.start < earliest) {
        out.push({
          severity: 'error',
          message: `Violates ${dep.dependencyType}${dep.lagDays ? `+${dep.lagDays}d` : ''} from "${pred.name}" — cannot start before ${earliest}.`,
        })
      }
    }
  }

  const parent = row.parentId ? all.get(row.parentId) : null
  if (parent && parent.scheduleMode === 'MANUAL' && parent.plannedStartDate && parent.plannedEndDate) {
    if (next.start < parent.plannedStartDate || next.end > parent.plannedEndDate) {
      out.push({
        severity: 'warning',
        message: `Falls outside the manually scheduled parent "${parent.name}" (${parent.plannedStartDate} → ${parent.plannedEndDate}).`,
      })
    }
  }
  return out
}
