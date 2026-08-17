import type { FilterState, ScheduleRow } from './types'
import { isGroupRow } from './types'
import { disciplineLabel, kindLabel, resolveLabels } from './config'
import type { IssueRecord, WorkspaceState } from './workspace'
import { computeDurations, computeHealth, isTerminal, rollUp, STATUS_PROGRESS } from './schedule'
import { maxIso, minIso } from './dates'

/**
 * Build the row hierarchy from workspace state.
 *
 * Every tier is a real, addressable record, so any row can be the target of a CRUD,
 * hierarchy, relationship or scheduling operation. Structure comes from explicit parent
 * links rather than being re-derived from issue fields on each render.
 */
export function buildTree(state: WorkspaceState, today: string): ScheduleRow[] {
  const rows: ScheduleRow[] = []

  /**
   * The terms this workspace uses, for the Type column.
   *
   * Resolved once at the organisation default rather than per row, and that is a decision
   * worth stating because the obvious alternative looks more correct at first glance.
   *
   * Terminology can be overridden down the scope chain, so a Process Area under one client
   * could legitimately be called a Workstream under another — which argues for resolving each
   * row where it lives. Against that: the reducer already resolves at the organisation default
   * (`termFor`), and that is what error messages and every audit entry say. Resolving the grid
   * per row would let the Type column read "Workstream" for a record whose own History says
   * "Process Area" — the grid and the trail disagreeing about the same thing, which is worse
   * than one term being less specific than it could be. It also keeps the column sortable:
   * rows of one kind share one value.
   *
   * So the app has two resolution policies and this is the reducer's one. Ambient resolution —
   * following the selection, used by the Add menu and dialogs — is the other. A third would be
   * exactly the sort of divergence the tier consolidation was undoing.
   */
  const terms = resolveLabels(state.model)

  const childNodes = (parentId: string | null) =>
    Object.values(state.nodes)
      .filter((n) => n.parentId === parentId && !n.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name))

  const childIssues = (parentId: string) =>
    Object.values(state.issues)
      .filter((i) => i.parentId === parentId && !i.deletedAt)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))

  const childActivities = (issueId: string) =>
    Object.values(state.activities)
      .filter((a) => a.issueId === issueId && !a.deletedAt)
      .sort((a, b) => a.order - b.order)

  const predecessorsOf = new Map<string, string[]>()
  for (const d of state.dependencies) {
    if (!predecessorsOf.has(d.successorId)) predecessorsOf.set(d.successorId, [])
    predecessorsOf.get(d.successorId)!.push(d.predecessorId)
  }

  /** Depth-first, appending each row then its children, so the flat list reads as a tree. */
  function walkIssue(issue: IssueRecord, depth: number): ScheduleRow {
    const acts = childActivities(issue.id)
    const subIssues = childIssues(issue.id)

    const activityRows: ScheduleRow[] = acts.map((a, i) => {
      const { duration, workingDuration } = computeDurations(a.plannedStartDate, a.plannedEndDate)
      const preds = predecessorsOf.get(a.id) ?? []
      // An archived predecessor cannot block anything — it is no longer part of the plan.
      // Without the deletedAt test, archiving a predecessor would leave its successor
      // permanently Blocked with nothing on screen to explain why.
      const blocked = preds.some((pid) => {
        const p = state.activities[pid]
        return !!p && !p.deletedAt && p.percentComplete < 100
      })
      const row = blank({
        id: a.id,
        parentId: issue.id,
        kind: a.isMilestone ? 'milestone' : 'activity',
        depth: depth + 1,
        displayId: `${issue.id}-${String(i + 1).padStart(2, '0')}`,
        name: String(a.phase),
        // A phase is called what the phase is called; a milestone has a configurable name.
        type: a.isMilestone ? kindLabel(terms, 'Milestone') : String(a.phase),
      })
      row.severity = issue.severity
      row.owner = a.owner
      row.accountable = issue.accountable
      row.scheduleMode = a.scheduleMode
      row.plannedStartDate = a.plannedStartDate
      row.plannedEndDate = a.plannedEndDate
      // Generated lifecycle rows carry synthesised dates and apportioned progress; only a
      // row someone actually edited may claim to be user-entered.
      row.plannedOrigin = a.origin === 'user' ? 'user' : 'derived'
      row.duration = a.isMilestone ? 0 : duration
      row.workingDuration = a.isMilestone ? 0 : workingDuration
      row.percentComplete = a.percentComplete
      row.progressOrigin = a.origin === 'user' ? 'user' : 'status-derived'
      row.isMilestone = a.isMilestone
      row.milestoneDate = a.isMilestone ? a.plannedEndDate : null
      row.predecessorIds = preds
      row.scheduleHealth = computeHealth(
        {
          status: null,
          plannedStartDate: row.plannedStartDate,
          plannedEndDate: row.plannedEndDate,
          percentComplete: row.percentComplete,
          actualEndDate: null,
        },
        today,
        { blockedByDependency: blocked },
      )
      return row
    })

    const row = blank({
      id: issue.id,
      parentId: issue.parentId,
      kind: 'issue',
      depth,
      displayId: issue.id,
      name: issue.subject,
      // An issue whose parent is another issue is a sub-issue, and that has its own
      // configurable name — one the Add menu already offers and the Type column was the last
      // place still ignoring.
      type: kindLabel(terms, state.issues[issue.parentId] ? 'sub-issue' : 'issue'),
    })
    /*
     * The row carries the LABEL and `row.issue` keeps the id — the same split `type` already
     * uses, and it is what lets the grid render "Technical" while the filter compares
     * `DISC_TECHNICAL`. Renaming a discipline then changes what is shown without breaking what
     * matches, which is the whole reason the column stores an id.
     *
     * `disciplineLabel` returns the id when it no longer resolves, so an archived discipline
     * leaves a visible `DISC_OLD` in the grid rather than silently blanking a hundred rows.
     */
    row.discipline = disciplineLabel(state.model, issue.discipline)
    row.status = issue.status
    row.severity = issue.severity
    row.owner = issue.owner
    row.accountable = issue.accountable
    row.nextAction = issue.nextAction
    row.actualStartDate = issue.raised
    row.actualEndDate = issue.actualEnd
    row.actualOrigin = issue.actualEnd ? 'derived' : 'source'

    // Manual dates always win — roll-up never silently overwrites what a user entered.
    if (issue.scheduleMode === 'MANUAL' && issue.plannedStart && issue.plannedEnd) {
      row.scheduleMode = 'MANUAL'
      row.plannedStartDate = issue.plannedStart
      row.plannedEndDate = issue.plannedEnd
      row.plannedOrigin = 'user'
    } else if (activityRows.length) {
      const r = rollUp(activityRows)
      row.scheduleMode = 'AUTO'
      row.plannedStartDate = r.start
      row.plannedEndDate = r.end
      row.plannedOrigin = 'derived'
    } else {
      row.scheduleMode = 'AUTO'
      row.plannedStartDate = issue.plannedStart
      row.plannedEndDate = issue.plannedEnd
      row.plannedOrigin = issue.plannedEnd ? 'user' : null
    }

    const d = computeDurations(row.plannedStartDate, row.plannedEndDate)
    row.duration = d.duration
    row.workingDuration = d.workingDuration

    if (issue.percentOverride != null) {
      row.percentComplete = issue.percentOverride
      row.progressOrigin = 'user'
    } else if (activityRows.length) {
      row.percentComplete = rollUp(activityRows).percentComplete
      row.progressOrigin = 'rolled-up'
    } else {
      row.percentComplete = STATUS_PROGRESS[issue.status] ?? 0
      row.progressOrigin = 'status-derived'
    }

    row.scheduleHealth = computeHealth(row, today)
    row.projectedCompletionDate = row.plannedEndDate
    row.issue = {
      id: issue.id,
      client: issue.client,
      module: issue.module,
      subject: issue.subject,
      description: issue.description,
      type: issue.type,
      sourceType: issue.sourceType,
      discipline: issue.discipline,
      severity: issue.severity,
      status: issue.status,
      owner: issue.owner,
      raisedBy: issue.raisedBy,
      accountable: issue.accountable,
      raised: issue.raised,
      lastActivity: issue.lastActivity,
      age: issue.age,
      daysSinceActivity: issue.daysSinceActivity,
      nextAction: issue.nextAction,
      evidence: issue.evidence,
      evidenceDate: issue.evidenceDate,
      verification: issue.verification,
      source: issue.source,
      reference: issue.reference,
      clientImpact: issue.clientImpact,
    }

    rows.push(row)
    activityRows.forEach((a) => rows.push(a))
    subIssues.forEach((s) => walkIssue(s, depth + 1))
    return row
  }

  function walkNode(nodeId: string, depth: number): ScheduleRow {
    const n = state.nodes[nodeId]
    const row = blank({
      id: n.id,
      parentId: n.parentId,
      kind: n.kind,
      depth,
      displayId: '',
      name: n.name,
      type: kindLabel(terms, n.kind),
    })
    row.owner = n.owner
    rows.push(row)

    const childRows: ScheduleRow[] = []
    for (const c of childNodes(n.id)) childRows.push(walkNode(c.id, depth + 1))
    for (const i of childIssues(n.id)) childRows.push(walkIssue(i, depth + 1))

    const r = rollUp(childRows)
    row.plannedStartDate = r.start
    row.plannedEndDate = r.end
    row.plannedOrigin = r.start ? 'derived' : null
    row.actualStartDate = minIso(childRows.map((c) => c.actualStartDate))
    const allDone = childRows.length > 0 && childRows.every((c) => c.scheduleHealth === 'Completed')
    row.actualEndDate = allDone ? maxIso(childRows.map((c) => c.actualEndDate)) : null
    row.actualOrigin = 'derived'
    row.percentComplete = r.percentComplete
    row.progressOrigin = 'rolled-up'
    const d = computeDurations(row.plannedStartDate, row.plannedEndDate)
    row.duration = d.duration
    row.workingDuration = d.workingDuration
    row.scheduleHealth = allDone
      ? 'Completed'
      : row.plannedEndDate
        ? computeHealth(row, today)
        : 'Unscheduled'
    return row
  }

  for (const root of childNodes(null)) walkNode(root.id, 0)
  // Issues whose parent was archived out from under them still need somewhere to appear.
  for (const i of Object.values(state.issues)) {
    if (i.deletedAt) continue
    const hasParent = state.nodes[i.parentId] || state.issues[i.parentId]
    if (!hasParent) walkIssue(i, 0)
  }

  return rows
}

/**
 * Give each summary row a count of the issues beneath it and how many need attention.
 *
 * Counts only the issues that pass the active filters, so the badges can never disagree with
 * the header counts (spec §12 requires filters to move the grid, the Gantt and the counts
 * together). Counts the whole subtree, not just direct children.
 */
function attachRollups(rows: ScheduleRow[], counted: Set<string>): void {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const acc = new Map<
    string,
    { issues: number; open: number; overdue: number; atRisk: number; blocked: number }
  >()

  for (const r of rows) {
    if (r.kind !== 'issue' || !counted.has(r.id)) continue
    const open = r.scheduleHealth !== 'Completed'
    let p = r.parentId
    while (p) {
      if (!acc.has(p)) acc.set(p, { issues: 0, open: 0, overdue: 0, atRisk: 0, blocked: 0 })
      const a = acc.get(p)!
      a.issues++
      if (open) a.open++
      if (r.scheduleHealth === 'Overdue') a.overdue++
      if (r.scheduleHealth === 'At Risk') a.atRisk++
      if (r.scheduleHealth === 'Blocked') a.blocked++
      p = byId.get(p)?.parentId ?? null
    }
  }

  for (const r of rows) {
    if (!isGroupRow(r.kind)) continue
    r.rollup = acc.get(r.id) ?? { issues: 0, open: 0, overdue: 0, atRisk: 0, blocked: 0 }
  }
}

function blank(
  seed: Pick<ScheduleRow, 'id' | 'parentId' | 'kind' | 'depth' | 'displayId' | 'name' | 'type'>,
): ScheduleRow {
  return {
    ...seed,
    status: null,
    severity: null,
    owner: null,
    // Null, not rolled up. A tier is resolved by whoever its children need; taking the
    // commonest discipline among them would present an average as a fact about the tier.
    discipline: null,
    accountable: null,
    scheduleMode: 'AUTO',
    plannedStartDate: null,
    plannedEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    plannedOrigin: null,
    actualOrigin: null,
    duration: null,
    workingDuration: null,
    percentComplete: 0,
    progressOrigin: 'rolled-up',
    projectedCompletionDate: null,
    scheduleHealth: 'Unscheduled',
    isMilestone: false,
    milestoneDate: null,
    nextAction: null,
    predecessorIds: [],
  }
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

export function facetsOf(state: WorkspaceState) {
  const live = Object.values(state.issues).filter((i) => !i.deletedAt)
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort()
  return {
    clients: uniq(live.map((i) => i.client)),
    types: uniq(live.map((i) => i.type)),
    // Ids, not labels: the filter compares against what is stored, and a discipline renamed
    // mid-session would otherwise stop matching the records that carry it.
    disciplines: uniq(live.map((i) => i.discipline)),
    modules: uniq(live.map((i) => i.module)),
    statuses: uniq(live.map((i) => i.status)),
    severities: ['High', 'Medium', 'Low'],
    owners: uniq(live.map((i) => i.owner)),
    accountables: uniq(live.map((i) => i.accountable)),
    healths: ['On Track', 'At Risk', 'Overdue', 'Blocked', 'Completed', 'Unscheduled'],
  }
}

export function matchesFilters(row: ScheduleRow, f: FilterState): boolean {
  const i = row.issue
  if (!i) return false
  // Finished work is hidden unless asked for. Checked first because it is the broadest cut
  // and the cheapest — no point testing six facets against a record already excluded.
  if (!f.showCompleted && isTerminal(i.status)) return false
  if (f.client !== 'All' && i.client !== f.client) return false
  if (f.type !== 'All' && i.type !== f.type) return false
  /*
   * 'None' is a real choice, not the absence of one. "Everything nobody has classified yet" is
   * the question somebody asks when they sit down to classify a back catalogue of 216, and a
   * filter offering only the fourteen disciplines cannot express it.
   */
  if (f.discipline === 'None' ? Boolean(i.discipline) : f.discipline !== 'All' && i.discipline !== f.discipline) return false
  if (f.module !== 'All' && i.module !== f.module) return false
  if (f.status !== 'All' && i.status !== f.status) return false
  if (f.severity !== 'All' && i.severity !== f.severity) return false
  if (f.owner !== 'All' && i.owner !== f.owner) return false
  if (f.accountable !== 'All' && i.accountable !== f.accountable) return false
  if (f.health !== 'All' && row.scheduleHealth !== f.health) return false
  if (f.search.trim()) {
    const q = f.search.toLowerCase()
    const hay =
      // `type` is in here because it was not: searching "change request" matched nothing
      // while forty-eight of them sat in the grid.
      `${i.id} ${i.subject} ${i.owner} ${i.module} ${i.type} ${i.nextAction} ${i.description}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** Filter at issue level, keep ancestors of survivors, then honour collapse state. */
export function visibleRows(
  all: ScheduleRow[],
  filters: FilterState,
  collapsed: Set<string>,
): ScheduleRow[] {
  const byId = new Map(all.map((r) => [r.id, r]))
  const keep = new Set<string>()
  const matching = new Set<string>()

  for (const row of all) {
    if (row.kind !== 'issue') continue
    if (!matchesFilters(row, filters)) continue
    matching.add(row.id)
    keep.add(row.id)
    let p = row.parentId
    while (p) {
      keep.add(p)
      p = byId.get(p)?.parentId ?? null
    }
    for (const child of all) if (child.parentId === row.id) keep.add(child.id)
  }

  // A structural row with no issues anywhere beneath it has nothing to be filtered out by —
  // it is empty, not excluded. Without this a freshly created Engagement / Project / Process
  // Area would never render, so the user could not select it to add anything underneath.
  const hasIssueDescendant = new Set<string>()
  for (const row of all) {
    if (row.kind !== 'issue') continue
    let p = row.parentId
    while (p) {
      hasIssueDescendant.add(p)
      p = byId.get(p)?.parentId ?? null
    }
  }
  for (const row of all) {
    if (row.kind === 'issue' || row.kind === 'activity' || row.kind === 'milestone') continue
    if (hasIssueDescendant.has(row.id)) continue
    keep.add(row.id)
    let p = row.parentId
    while (p) {
      keep.add(p)
      p = byId.get(p)?.parentId ?? null
    }
  }

  attachRollups(all, matching)

  const out: ScheduleRow[] = []
  for (const row of all) {
    if (!keep.has(row.id)) continue
    let hidden = false
    let p = row.parentId
    while (p) {
      if (collapsed.has(p)) {
        hidden = true
        break
      }
      p = byId.get(p)?.parentId ?? null
    }
    if (!hidden) out.push(row)
  }
  return out
}

export function parentIds(all: ScheduleRow[]): Set<string> {
  const s = new Set<string>()
  for (const r of all) if (r.parentId) s.add(r.parentId)
  return s
}
