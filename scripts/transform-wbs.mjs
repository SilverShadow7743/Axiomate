/**
 * Transform the extracted OAPIL/SLG WBS rows into seed actions.
 *
 * Follows `transform-issues.mjs`'s shape: pure, no database access, throws on any `Type` or
 * `Status` value not in the mapping tables below rather than guessing (same rule, same reason
 * — a classification this script does not recognise is a decision for a person).
 *
 * Design: docs/plans/2026-09-02-oapil-slg-wbs-import-design.md
 * Plan:   docs/plans/2026-09-02-oapil-slg-wbs-import-plan.md
 *
 * Judgment calls made here that the design/plan docs did not fully pin down (found while
 * writing this script against the real extracted data, not assumed in advance):
 *
 *   - `sourceType` is set to the raw WBS `Type` UNCONDITIONALLY, for every issue-shaped row —
 *     not only the ones the design doc's table called out as "lossy". This matches
 *     `transform-issues.mjs`'s own unconditional convention (`sourceType: r.type`) and loses
 *     no information for the rows where the mapped type already equals the label.
 *   - Ten of the 13 activity-target rows have `Not Provided`/`To Be Confirmed` for their
 *     planned dates — the design doc did not anticipate this. Falls back to the PARENT issue's
 *     own `raisedDate` for a missing start, and to the resolved start for a missing finish —
 *     never a fabricated date, always an already-real fact belonging to the same record chain.
 *   - Severity has no source column (WBS has `Priority`, not `Severity`, and `Severity` is
 *     `'High' | 'Medium' | 'Low'` — no `Critical`). Priority maps `Critical|High -> High`,
 *     `Medium -> Medium`, `Low|To Be Confirmed -> Medium` (a stated Low is real; an unstated
 *     priority gets the neutral middle value, the same posture as `owner: 'Unassigned'`).
 *   - Owner `'Not Provided'` becomes `'Unassigned'`, matching `transform-issues.mjs`'s own
 *     `r.owner || 'Unassigned'`.
 *   - Meeting `startAt`/`endAt`: the sheet only records a day, not a time, and
 *     `meetingProblem()` requires `endAt` strictly after `startAt`. Where both Planned Start and
 *     Planned Finish are the same calendar day (OAPIL-052), a nominal 09:00-10:00 UTC window is
 *     used so the real single-day fact survives without violating that check. Where they differ
 *     (SLG-007), both are anchored at 09:00 UTC on their real dates.
 *   - Issue ids are the WBS's own ids verbatim (`OAPIL-001`, `SLG-001`, ...) — already in this
 *     app's `CLIENT-NNN` id shape, so no remapping layer is needed anywhere downstream.
 *   - Root issues (no real `Parent`) record which MODULE NAME they belong to, not a node id —
 *     the module nodes don't exist yet when this script runs (Step 7 creates them live, with
 *     reducer-minted ids this offline script cannot predict). The apply script resolves
 *     name -> real id after Step 7 has run.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const raw = JSON.parse(readFileSync(join(root, 'data/wbs.raw.json'), 'utf8'))

// 'NP' appears once (OAPIL-010's Parent) as an evident abbreviation of 'Not Provided' — the
// only other row-count-affecting typo found in the source data (see the design doc's own
// correction note for the three tallying errors this same grounding pass found).
const NOT_PROVIDED = new Set(['Not Provided', 'To Be Confirmed', 'NP', '', null, undefined])
const provided = (v) => !NOT_PROVIDED.has(v)

/** Today, at the moment this transform runs — the user's explicit fallback for the 24 root
 *  rows with no stated date anywhere in their own Parent chain. Computed live, not frozen to
 *  a specific date, since a re-run on a different day should default to that day. */
const TODAY = new Date().toISOString().slice(0, 10)

/** target: 'issue' | 'activity' | 'approval' | 'meeting'. workType only set for 'issue'. */
const TYPE_ROUTE = {
  Task: { target: 'issue', workType: 'WT_TASK' },
  Epic: { target: 'issue', workType: 'WT_EPIC' },
  Decision: { target: 'issue', workType: 'WT_DECISION' },
  Requirement: { target: 'issue', workType: 'WT_REQUEST' },
  CHALLENGE: { target: 'issue', workType: 'WT_ISSUE' },
  Deliverable: { target: 'issue', workType: 'WT_DELIVERABLE' },
  Issue: { target: 'issue', workType: 'WT_ISSUE' },
  Development: { target: 'issue', workType: 'WT_TASK' },
  Dependency: { target: 'issue', workType: 'WT_ISSUE' },
  Risk: { target: 'issue', workType: 'WT_RISK' },
  'Work Package': { target: 'issue', workType: 'WT_TASK' },
  Defect: { target: 'issue', workType: 'WT_DEFECT' },
  Change: { target: 'issue', workType: 'WT_CHANGE_REQUEST' },
  Testing: { target: 'issue', workType: 'WT_TASK' },
  Milestone: { target: 'activity' },
  'Corrective Action': { target: 'activity' },
  Investigation: { target: 'activity' },
  Verification: { target: 'activity' },
  Approval: { target: 'approval' },
  Meeting: { target: 'meeting' },
}

const STATUS_MAP = {
  New: 'Open',
  Planned: 'Open',
  Ready: 'Open',
  Open: 'Open',
  'In Progress': 'In Progress',
  UAT: 'In Progress',
  Testing: 'In Progress',
  'Under Review': 'In Progress',
  Blocked: 'In Progress',
  Waiting: 'In Progress',
  Completed: 'Closed - confirmed',
  Closed: 'Closed - confirmed',
  'Pending Approval': 'Awaiting client confirmation',
  'Submitted — Awaiting OAPIL Confirmation': 'Awaiting client confirmation',
}

const PRIORITY_TO_SEVERITY = {
  Critical: 'High',
  High: 'High',
  Medium: 'Medium',
  Low: 'Medium',
  'To Be Confirmed': 'Medium',
}

const byId = new Map(raw.map((r) => [r.ID, r]))

/** Parent-before-child order. Throws on a cycle or a Parent that resolves to nothing. */
function topoOrder(rows) {
  const visited = new Set()
  const visiting = new Set()
  const out = []

  function visit(row) {
    if (visited.has(row.ID)) return
    if (visiting.has(row.ID)) {
      throw new Error(`Cycle detected in Parent chain at ${row.ID}.`)
    }
    const parentId = provided(row.Parent) ? row.Parent : null
    if (parentId) {
      const parent = byId.get(parentId)
      if (!parent) {
        throw new Error(`${row.ID}'s Parent "${parentId}" does not match any WBS row.`)
      }
      visiting.add(row.ID)
      visit(parent)
      visiting.delete(row.ID)
    }
    visited.add(row.ID)
    out.push(row)
  }

  for (const row of rows) visit(row)
  return out
}

const ordered = topoOrder(raw)

/**
 * `Issue.parentId` may only be a hierarchy node or another ISSUE — never an activity, approval
 * or meeting. The WBS's own `Parent` column doesn't make that distinction; it just names a row
 * id. Where an issue-shaped row's immediate Parent is itself activity/approval/meeting-shaped
 * (confirmed once in the real data: `OAPIL-154`'s Parent is `OAPIL-151`, a Milestone), walk
 * further up until a real issue-shaped ancestor is found, or the chain runs out (a genuine
 * root). This must use the RAW rows' own Type, not the topological pass, since it has to run
 * before that pass's `parentIssueId` values exist.
 */
function resolveIssueParent(rawParentId) {
  let cursor = rawParentId
  while (cursor) {
    const row = byId.get(cursor)
    if (!row) return cursor // topoOrder already refused an unresolved id; unreachable in practice
    const route = TYPE_ROUTE[row.Type]
    if (route?.target === 'issue') return cursor
    cursor = provided(row.Parent) ? row.Parent : null
  }
  return null
}

const moduleNameOf = (workstream) => workstream.split('(')[0].trim()

const modules = new Map() // name -> project
for (const r of raw) {
  if (!provided(r.Parent)) modules.set(moduleNameOf(r.Workstream), r.project)
}

const issues = []
const activities = []
const approvals = []
const meetings = []
const issueById = new Map() // WBS ID -> the built issue record, for parent date fallback

for (const r of ordered) {
  const route = TYPE_ROUTE[r.Type]
  if (!route) throw new Error(`Unmapped WBS Type "${r.Type}" on ${r.ID} — refusing to guess its class.`)

  const status = STATUS_MAP[r.Status]
  if (!status) throw new Error(`Unmapped WBS Status "${r.Status}" on ${r.ID} — refusing to guess its class.`)

  const parentId = provided(r.Parent) ? resolveIssueParent(r.Parent) : null
  const workstreamSub = r.Workstream.includes('(')
    ? r.Workstream.slice(r.Workstream.indexOf('(') + 1, r.Workstream.lastIndexOf(')'))
    : null

  const descriptionParts = [r.Description || r.Title]
  if (workstreamSub) descriptionParts.push(`Workstream detail: ${workstreamSub}.`)
  if (provided(r['Client Stakeholder'])) descriptionParts.push(`Client stakeholder: ${r['Client Stakeholder']}.`)
  descriptionParts.push(`Source status: ${r.Status}.`)
  const description = descriptionParts.join(' ')

  if (route.target === 'issue') {
    const severity = PRIORITY_TO_SEVERITY[r.Priority]
    if (!severity) throw new Error(`Unmapped WBS Priority "${r.Priority}" on ${r.ID}.`)

    // raisedDate is a required field on IssueRecord. Where Planned Start is missing, walk the
    // already-resolved ancestor chain (topological order guarantees every ancestor was built
    // first) for the nearest real date. Where NEITHER the row nor any ancestor has one (24
    // root rows, confirmed against the real data — mostly top-level Epics), fall back to
    // today's date, per the user's explicit direction: "keep it as todays date". Both fallback
    // paths are flagged in the description so neither is ever mistaken for a stated fact.
    let raisedDate = provided(r['Planned Start']) ? r['Planned Start'] : null
    let dateOrigin = raisedDate ? 'stated' : null
    if (!raisedDate) {
      let cursor = parentId
      while (cursor && !raisedDate) {
        const ancestor = issueById.get(cursor)
        raisedDate = ancestor?.raisedDate ?? null
        cursor = ancestor?.parentIssueId ?? null
      }
      if (raisedDate) dateOrigin = 'ancestor'
    }
    if (!raisedDate) {
      raisedDate = TODAY
      dateOrigin = 'today'
    }

    const dateNote =
      dateOrigin === 'ancestor'
        ? ' Raised date not stated in the source — inferred from the nearest dated ancestor.'
        : dateOrigin === 'today'
          ? ` Raised date not stated anywhere in the source's own Parent chain — defaulted to the import date (${TODAY}), per explicit direction, not a fact from the tracker.`
          : ''

    const issue = {
      id: r.ID,
      project: r.project,
      parentIssueId: parentId,
      moduleName: parentId ? null : moduleNameOf(r.Workstream),
      subject: r.Title,
      description: description + dateNote,
      type: route.workType,
      sourceType: r.Type,
      severity,
      status,
      owner: provided(r.Owner) ? r.Owner : 'Unassigned',
      raisedBy: provided(r['Raised By']) ? r['Raised By'] : '',
      accountable: r.project,
      raisedDate,
      raisedDateOrigin: dateOrigin,
      lastActivityDate: provided(r['Planned Finish']) ? r['Planned Finish'] : raisedDate,
    }
    issues.push(issue)
    issueById.set(r.ID, issue)
    continue
  }

  const parentIssue = issueById.get(parentId)
  if (!parentIssue) {
    throw new Error(`${r.ID} (${r.Type}) has Parent "${parentId}", which was not created as an issue.`)
  }

  if (route.target === 'activity') {
    const plannedStartDate = provided(r['Planned Start'])
      ? r['Planned Start']
      : parentIssue.raisedDate
    if (!plannedStartDate) {
      throw new Error(`${r.ID} has no planned start and its parent ${parentId} has no raisedDate to fall back on.`)
    }
    const plannedEndDate = provided(r['Planned Finish']) ? r['Planned Finish'] : plannedStartDate
    activities.push({
      issueId: parentId,
      phase: r.Type,
      isMilestone: r.Type === 'Milestone',
      plannedStartDate,
      plannedEndDate,
      owner: provided(r.Owner) ? r.Owner : 'Unassigned',
      note: description,
    })
    continue
  }

  if (route.target === 'approval') {
    approvals.push({
      subjectId: parentId,
      note: description,
      decide: status === 'Closed - confirmed' ? 'approved' : null,
    })
    continue
  }

  if (route.target === 'meeting') {
    const startDate = provided(r['Planned Start']) ? r['Planned Start'] : null
    const endDate = provided(r['Planned Finish']) ? r['Planned Finish'] : startDate
    if (!startDate || !endDate) {
      throw new Error(`${r.ID} (Meeting) has no usable Planned Start/Finish.`)
    }
    const sameDay = startDate === endDate
    meetings.push({
      title: r.Title,
      startAt: `${startDate}T09:00:00.000Z`,
      endAt: sameDay ? `${startDate}T10:00:00.000Z` : `${endDate}T09:00:00.000Z`,
      note: description,
      scopeKind: 'issue',
      scopeId: parentId,
    })
  }
}

const seed = {
  meta: {
    source: 'OAPIL_SLG_PM_Tracker_STAGED.xlsx — OAPIL WBS + SLG WBS',
    generatedFrom: 'data/wbs.raw.json',
    rowCount: raw.length,
    issueCount: issues.length,
    activityCount: activities.length,
    approvalCount: approvals.length,
    meetingCount: meetings.length,
    moduleCount: modules.size,
  },
  modules: [...modules.entries()].map(([name, project]) => ({ name, project })),
  issues,
  activities,
  approvals,
  meetings,
}

writeFileSync(join(root, 'data/wbs.seed.json'), JSON.stringify(seed, null, 2))

console.log('Wrote data/wbs.seed.json')
console.log(`  issues:     ${issues.length}`)
console.log(`  activities: ${activities.length}`)
console.log(`  approvals:  ${approvals.length}`)
console.log(`  meetings:   ${meetings.length}`)
console.log(`  modules:    ${modules.size}`)
