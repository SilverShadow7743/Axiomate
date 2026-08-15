import { workingDaysBetween } from './dates'
import { computeHealth, isTerminal } from './schedule'
import { summarise } from './estimation'
import { planCheck } from './capacity'
import { sowPosition } from './sow'
import { buildTree } from './tree'
import type { WorkspaceState } from './workspace'

/**
 * What became true while nobody was doing anything.
 *
 * ---------------------------------------------------------------------------
 * Why this needs its own mechanism
 *
 * The automation engine reacts to change, and it works by comparing the state before an action
 * with the state after. That covers everything a person does and nothing that time does. An
 * issue going at-risk, an SLA about to breach, a plan that no longer fits the people committed
 * to it — none of those are changes anybody made. They are yesterday's facts read against
 * today's date, and there is no action to hang them on.
 *
 * So this module produces the missing half: an **observation** of the temporal conditions
 * currently true, which the scheduled pass compares against the observation it took last time.
 * The difference is a list of events, and from there everything is ordinary — the same rules,
 * the same reducer, the same audit trail.
 *
 * ---------------------------------------------------------------------------
 * The problem this exists to avoid
 *
 * A daily job that emails "OAPIL-14 is overdue" every morning for six weeks trains people to
 * ignore it, and then the seventh week's genuinely new breach is ignored too. That is the real
 * failure mode of scheduled alerting, and it is not solved by being clever about the message.
 *
 * It is solved by only reporting a condition **the first time it is true**. Comparing two
 * observations does that by construction: a condition present in both is not news. It also
 * handles the case that makes naive de-duplication wrong — a condition that clears and returns
 * *is* news again, because somebody moved a date and it slipped anyway, and the observation
 * records the clearing as faithfully as it records the onset.
 */

export const WATCH_CONDITIONS = [
  { key: 'overdue', label: 'Past its due date', event: 'issue.overdue' },
  { key: 'atRisk', label: 'At risk of missing its date', event: 'issue.atRisk' },
  { key: 'dueSoon', label: 'Due within the warning window', event: 'issue.dueSoon' },
  { key: 'stale', label: 'Nothing has happened on it for too long', event: 'issue.stale' },
  { key: 'planImpossible', label: 'Planned work exceeds the people committed to it', event: 'project.planImpossible' },
  { key: 'sowOverConsumed', label: 'More effort spent than was contracted', event: 'sow.overConsumed' },
] as const

export type ConditionKey = (typeof WATCH_CONDITIONS)[number]['key']

/**
 * Thresholds, in the operating model rather than here.
 *
 * "Too long without activity" is fourteen days in one firm and three in another, and a run
 * that hard-coded either would be describing somebody else's delivery. `enabled` exists so a
 * firm can stop the pass without unsetting a cron somewhere they cannot see.
 */
export interface WatchPolicy {
  enabled: boolean
  /** Days of no activity before an open record is called stale. */
  staleAfterDays: number
  /** How many working days before a due date counts as "due soon". */
  warnBeforeDays: number
  /** Which conditions to look for at all. A firm that does not want stale notices turns it off. */
  conditions: ConditionKey[]
}

export function defaultWatchPolicy(): WatchPolicy {
  return {
    enabled: true,
    staleAfterDays: 14,
    warnBeforeDays: 3,
    conditions: WATCH_CONDITIONS.map((c) => c.key),
  }
}

/**
 * The conditions true right now, keyed by the record they are true of.
 *
 * Stored between runs. Deliberately small — a set of keys per subject, not a snapshot of the
 * workspace — because it is compared, not read: anything else in it would be a second copy of
 * data that has a home already, free to disagree with it.
 */
export type Observation = Record<string, ConditionKey[]>

export interface WatchFinding {
  subjectId: string
  condition: ConditionKey
  /** What to say about it, written once here so two screens cannot word it differently. */
  detail: string
}

/* ================================================================== *
 * Observing
 * ================================================================== */

export function observe(
  state: WorkspaceState,
  today: string,
  policy: WatchPolicy,
): { observation: Observation; findings: WatchFinding[] } {
  const observation: Observation = {}
  const findings: WatchFinding[] = []
  const wanted = new Set(policy.conditions)

  const add = (subjectId: string, condition: ConditionKey, detail: string) => {
    if (!wanted.has(condition)) return
    observation[subjectId] = [...(observation[subjectId] ?? []), condition]
    findings.push({ subjectId, condition, detail })
  }

  const rows = buildTree(state, today)

  /* ---- work items ---- */
  for (const row of rows) {
    if (row.kind !== 'issue') continue
    const issue = state.issues[row.id]
    if (!issue || issue.deletedAt || isTerminal(row.status)) continue

    const health = computeHealth(row, today)
    if (health === 'Overdue') {
      add(row.id, 'overdue', `Due ${row.plannedEndDate}, and ${workingDaysBetween(row.plannedEndDate!, today)} working days have passed.`)
    } else if (health === 'At Risk') {
      add(row.id, 'atRisk', `Due ${row.plannedEndDate} and ${row.percentComplete}% complete with most of the window gone.`)
    } else if (row.plannedEndDate) {
      const left = workingDaysBetween(today, row.plannedEndDate)
      if (left >= 0 && left <= policy.warnBeforeDays) {
        add(row.id, 'dueSoon', `Due ${row.plannedEndDate} — ${left} working day${left === 1 ? '' : 's'} left.`)
      }
    }

    // Staleness is about attention rather than about dates, so it is checked whatever the
    // health says: an issue can be comfortably inside its window and abandoned.
    const idle = workingDaysBetween(issue.lastActivity, today)
    if (idle >= policy.staleAfterDays) {
      add(row.id, 'stale', `Nothing recorded on it for ${idle} working days — last activity ${issue.lastActivity}.`)
    }
  }

  /* ---- projects: does the plan still fit the people? ---- */
  const peopleByName: Record<string, string> = {}
  for (const p of Object.values(state.model.people)) peopleByName[p.name.toLowerCase()] = p.id

  for (const node of Object.values(state.nodes)) {
    if (node.kind !== 'project' || node.deletedAt) continue
    const row = rows.find((r) => r.id === node.id)
    const from = row?.plannedStartDate ?? today
    const to = row?.plannedEndDate
    // Without an end date there is no window to check a plan against, and inventing one would
    // produce a shortfall that is an artefact of the guess.
    if (!to) continue

    const issueIds = issuesUnder(state, node.id)
    let planned = 0
    let unestimated = 0
    for (const id of issueIds) {
      const estimate = state.estimates[id]
      const hours = estimate ? summarise(estimate, state.model.sizeBands).effortHours : null
      if (hours === null) unestimated += 1
      else planned += hours
    }
    if (!planned) continue

    const check = planCheck(
      planned,
      unestimated,
      Object.values(state.allocations),
      state.model.resourceProfiles,
      peopleByName,
      node.id,
      from,
      to,
    )
    if (!check.possible) {
      add(
        node.id,
        'planImpossible',
        `Needs ${check.plannedHours}h between ${from} and ${to}; ${check.allocatedHours}h are committed to it — ${check.shortfallHours}h short.`,
      )
    }
  }

  /* ---- statements of work ---- */
  for (const sow of Object.values(state.sows)) {
    if (sow.deletedAt || !sow.effortHours) continue
    const projects = Object.values(state.nodes).filter((n) => n.sowId === sow.id && !n.deletedAt)
    const ids = projects.flatMap((p) => issuesUnder(state, p.id))
    const position = sowPosition(sow, ids, state.estimates, state.timeEntries, state.model.sizeBands)
    if (position.remainingHours < 0) {
      add(
        sow.id,
        'sowOverConsumed',
        `${sow.reference}: ${position.actualHours}h spent against ${position.baselineHours}h agreed — ${Math.abs(position.remainingHours)}h over.`,
      )
    }
  }

  return { observation, findings }
}

/** Every issue beneath a node, however many tiers down. */
function issuesUnder(state: WorkspaceState, nodeId: string): string[] {
  const wanted = new Set<string>([nodeId])
  let grew = true
  while (grew) {
    grew = false
    for (const n of Object.values(state.nodes)) {
      if (!n.deletedAt && n.parentId && wanted.has(n.parentId) && !wanted.has(n.id)) {
        wanted.add(n.id)
        grew = true
      }
    }
  }
  return Object.values(state.issues)
    .filter((i) => !i.deletedAt && wanted.has(i.parentId))
    .map((i) => i.id)
}

/* ================================================================== *
 * Comparing
 * ================================================================== */

export interface WatchDiff {
  /** Conditions true now that were not true last time. These are what gets raised. */
  onset: WatchFinding[]
  /**
   * Conditions that were true and no longer are.
   *
   * Not raised as events, deliberately: "OAPIL-14 is no longer overdue" is not news anybody
   * needs at seven in the morning. They are returned because the *count* is worth reporting on
   * the configuration screen — a pass that clears more than it raises is a good week, and a
   * pass that clears nothing for a month is worth looking at.
   */
  cleared: { subjectId: string; condition: ConditionKey }[]
  /** True in both observations. Counted, never repeated — this is the fatigue this avoids. */
  continuing: number
}

export function diffObservations(previous: Observation, current: Observation, findings: WatchFinding[]): WatchDiff {
  const onset: WatchFinding[] = []
  const cleared: { subjectId: string; condition: ConditionKey }[] = []
  let continuing = 0

  for (const finding of findings) {
    const before = previous[finding.subjectId] ?? []
    if (before.includes(finding.condition)) continuing += 1
    else onset.push(finding)
  }

  for (const [subjectId, conditions] of Object.entries(previous)) {
    const now = current[subjectId] ?? []
    for (const condition of conditions) {
      if (!now.includes(condition)) cleared.push({ subjectId, condition })
    }
  }

  return { onset, cleared, continuing }
}

/** The event an onset condition becomes, so the rules can subscribe to it. */
export function eventTypeFor(condition: ConditionKey): string {
  return WATCH_CONDITIONS.find((c) => c.key === condition)?.event ?? ''
}

/** How a run reads in one line, for the operator who wants to know it did something. */
export function describeRun(diff: WatchDiff, raised: number): string {
  const parts = [
    `${diff.onset.length} new`,
    `${diff.continuing} continuing`,
    `${diff.cleared.length} cleared`,
    `${raised} message${raised === 1 ? '' : 's'} raised`,
  ]
  return parts.join(' · ')
}
