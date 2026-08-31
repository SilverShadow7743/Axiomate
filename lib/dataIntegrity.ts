import { canParent, kindOf, type WorkspaceState } from './workspace'
import type { Allocation } from './capacity'
import { tiersOf } from './config'
import { ISSUE_STATUSES } from './types'

/**
 * Referential integrity over already-stored records — never a fix, only a finding.
 *
 * See `.claude/skills/axiomate-data-integrity/SKILL.md`, whose seven risk areas this module
 * implements. Pure and read-only: every check takes the already-loaded `WorkspaceState` (the
 * same shape every reducer, scenario and screen already reads) and returns findings, nothing
 * more. `scripts/integrity-audit.ts` is the only caller that touches a database, and only to
 * read — this module never has to know a database exists.
 *
 * **`kind: 'error'` vs `'review'`**: an error is definitely wrong — a dangling foreign key, an
 * end before a start. A review finding may be a deliberate decision already recorded elsewhere
 * (over-allocation, for instance, ships with its own `acceptOverallocation` audit trail) — this
 * module surfaces it rather than silently passing it, and never rules on it.
 */

export interface IntegrityFinding {
  /** The record this is about, so a reader can go find it. */
  subject: string
  message: string
}

export interface IntegrityCheckResult {
  key: string
  label: string
  kind: 'error' | 'review'
  findings: IntegrityFinding[]
}

/** All seven, in the order the skill lists them. */
export function runIntegrityChecks(state: WorkspaceState): IntegrityCheckResult[] {
  return [
    personSeamCheck(state),
    hierarchyPlacementCheck(state),
    danglingAllocationProjectCheck(state),
    orphanedTimeEntryCheck(state),
    dateConsistencyCheck(state),
    corruptedStatusCheck(state),
    capacityOverlapCheck(state),
  ]
}

/* ================================================================== *
 * 1 — the person/personId seam
 * ================================================================== */

interface PersonBearing {
  id: string
  person: string
  personId?: string | null
  deletedAt?: string | null
}

/**
 * A row whose `person` string no longer matches any live directory entry — the exact failure
 * mode the seam has already produced once in this project's history (a rename that only
 * updated the name field, leaving every joined-by-name row pointing at nobody). Checked on the
 * name, not the id: a row WITH a resolved `personId` can still carry a `person` string that has
 * since drifted from that person's current name, and a reader scanning by name would not find
 * it either.
 */
export function personSeamCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []
  const people = Object.values(state.model.people)
  const byName = new Set(people.map((p) => p.name.trim().toLowerCase()))
  const byId = new Set(people.map((p) => p.id))

  const sources: { table: string; rows: PersonBearing[] }[] = [
    { table: 'Allocation', rows: Object.values(state.allocations) },
    { table: 'Commitment', rows: Object.values(state.commitments) },
    { table: 'TimeEntry', rows: Object.values(state.timeEntries) },
    { table: 'Timesheet', rows: Object.values(state.timesheets) },
  ]

  for (const { table, rows } of sources) {
    for (const row of rows) {
      if (row.deletedAt) continue
      if (!byName.has(row.person.trim().toLowerCase())) {
        findings.push({
          subject: `${table} ${row.id}`,
          message: `person "${row.person}" does not match any live directory entry.`,
        })
      }
      if (row.personId && !byId.has(row.personId)) {
        findings.push({
          subject: `${table} ${row.id}`,
          message: `personId "${row.personId}" does not resolve to a live directory entry.`,
        })
      }
    }
  }

  return { key: 'personSeam', label: 'Person/personId seam', kind: 'error', findings }
}

/* ================================================================== *
 * 2 — hierarchy placement
 * ================================================================== */

/**
 * Every live node and issue, re-checked against `canParent()` and the tenant's CURRENT tiers —
 * not what was valid when it was written. `create`/`move` already enforce this at write time,
 * so a violation here means either the tiers changed underneath existing placements, or a
 * migration/direct write bypassed the reducer.
 */
export function hierarchyPlacementCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []
  const tiers = tiersOf(state.model)

  for (const node of Object.values(state.nodes)) {
    if (node.deletedAt || !node.parentId) continue
    const parentKind = kindOf(state, node.parentId)
    if (!parentKind || !canParent(node.kind, parentKind, tiers)) {
      findings.push({
        subject: `${node.kind} ${node.id} ("${node.name}")`,
        message: parentKind
          ? `a ${node.kind} may not sit under a ${parentKind}, per the tenant's current tiers.`
          : `its parent ${node.parentId} does not exist.`,
      })
    }
  }

  for (const issue of Object.values(state.issues)) {
    if (issue.deletedAt) continue
    const parentKind = kindOf(state, issue.parentId)
    if (!parentKind || !canParent('issue', parentKind, tiers)) {
      findings.push({
        subject: `Issue ${issue.id}`,
        message: parentKind
          ? `an issue may not sit under a ${parentKind}, per the tenant's current tiers.`
          : `its parent ${issue.parentId} does not exist.`,
      })
    }
  }

  return { key: 'hierarchyPlacement', label: 'Hierarchy placement', kind: 'error', findings }
}

/* ================================================================== *
 * 3 — dangling Allocation.projectId
 * ================================================================== */

export function danglingAllocationProjectCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []
  for (const a of Object.values(state.allocations)) {
    if (a.deletedAt) continue
    const project = state.nodes[a.projectId]
    if (!project || project.deletedAt || project.kind !== 'project') {
      findings.push({
        subject: `Allocation ${a.id} (${a.person})`,
        message: `projectId "${a.projectId}" does not resolve to a live project — this person reads as committed to capacity with nowhere to go.`,
      })
    }
  }
  return { key: 'danglingAllocationProject', label: 'Dangling allocation project', kind: 'error', findings }
}

/* ================================================================== *
 * 4 — TimeEntry without a valid issue
 * ================================================================== */

export function orphanedTimeEntryCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []
  for (const e of Object.values(state.timeEntries)) {
    if (e.deletedAt) continue
    const issue = state.issues[e.issueId]
    if (!issue || issue.deletedAt) {
      findings.push({
        subject: `TimeEntry ${e.id} (${e.person}, ${e.hours}h)`,
        message: `issueId "${e.issueId}" does not resolve to a live issue — effort recorded against nothing, invisible to utilisation.`,
      })
    }
  }
  return { key: 'orphanedTimeEntry', label: 'TimeEntry without a valid issue', kind: 'error', findings }
}

/* ================================================================== *
 * 5 — date consistency
 * ================================================================== */

export function dateConsistencyCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []

  for (const a of Object.values(state.allocations)) {
    if (a.deletedAt) continue
    if (a.endDate < a.startDate) {
      findings.push({ subject: `Allocation ${a.id} (${a.person})`, message: `ends ${a.endDate}, before it starts ${a.startDate}.` })
    }
  }
  for (const c of Object.values(state.commitments)) {
    if (c.deletedAt) continue
    if (c.endDate < c.startDate) {
      findings.push({ subject: `Commitment ${c.id} (${c.person})`, message: `ends ${c.endDate}, before it starts ${c.startDate}.` })
    }
  }
  for (const i of Object.values(state.issues)) {
    if (i.deletedAt) continue
    if (i.plannedStart && i.plannedEnd && i.plannedEnd < i.plannedStart) {
      findings.push({ subject: `Issue ${i.id}`, message: `planned end ${i.plannedEnd} is before planned start ${i.plannedStart}.` })
    }
  }

  return { key: 'dateConsistency', label: 'Date consistency', kind: 'error', findings }
}

/* ================================================================== *
 * 6 — corrupted status
 * ================================================================== */

/**
 * Whether a status was ever legitimately REACHED is deliberately not asked — the status
 * transition graph's own comment (`lib/statusPolicy.ts`) says it "governs changes, not the
 * past", and imported history sits in combinations the graph would never produce on purpose.
 * What IS checked: is the stored value one this application's type even recognises. `status` is
 * a plain `String` column, not a database enum, so nothing stops a string that isn't a real
 * `IssueStatus` from landing there — a migration or a direct write, never the reducer, which
 * only ever assigns from `ISSUE_STATUSES`.
 */
export function corruptedStatusCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []
  const valid = new Set<string>(ISSUE_STATUSES)
  for (const i of Object.values(state.issues)) {
    if (i.deletedAt) continue
    if (!valid.has(i.status)) {
      findings.push({ subject: `Issue ${i.id}`, message: `status "${i.status}" is not one this workspace's type recognises.` })
    }
  }
  return { key: 'corruptedStatus', label: 'Corrupted status value', kind: 'error', findings }
}

/* ================================================================== *
 * 7 — capacity overlaps
 * ================================================================== */

/**
 * Not necessarily wrong — deliberate over-allocation is a real, recordable decision
 * (`acceptOverallocation`, Project Pulse's own capacity concern). Reported as a review finding,
 * never an error, so it is seen rather than silently passed — the skill's own instruction.
 *
 * A sweep over each person's live allocations: at every boundary date (every start, and the day
 * after every end), sum the percentage of allocations covering that date. Pairwise comparison
 * would miss three allocations of 40% each that never pairwise exceed 100% but sum to 120%
 * together — the sweep catches that, a pairwise check would not.
 */
export function capacityOverlapCheck(state: WorkspaceState): IntegrityCheckResult {
  const findings: IntegrityFinding[] = []
  const byPerson = new Map<string, Allocation[]>()
  for (const a of Object.values(state.allocations)) {
    if (a.deletedAt) continue
    const key = a.personId ?? a.person.trim().toLowerCase()
    const list = byPerson.get(key) ?? []
    list.push(a)
    byPerson.set(key, list)
  }

  for (const [, allocs] of byPerson) {
    if (allocs.length < 2) continue
    const boundaries = new Set<string>()
    for (const a of allocs) {
      boundaries.add(a.startDate)
      boundaries.add(dayAfter(a.endDate))
    }
    const sorted = [...boundaries].sort()
    let worst: { date: string; total: number; ids: string[] } | null = null
    for (const date of sorted) {
      const covering = allocs.filter((a) => a.startDate <= date && date <= a.endDate)
      const total = covering.reduce((n, a) => n + a.percentage, 0)
      if (total > 100 && (!worst || total > worst.total)) {
        worst = { date, total, ids: covering.map((a) => a.id) }
      }
    }
    if (worst) {
      findings.push({
        subject: `${allocs[0].person} (${worst.ids.join(', ')})`,
        message: `${worst.total}% allocated on ${worst.date} — over 100%, worth a look even if deliberate.`,
      })
    }
  }

  return { key: 'capacityOverlap', label: 'Capacity overlaps', kind: 'review', findings }
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
