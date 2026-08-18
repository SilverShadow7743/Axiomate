import { issuesUnder } from './engagement'
import { isTerminal } from './schedule'
import type { WorkspaceState } from './workspace'

/**
 * Targets a firm sets for itself, measured from what the workspace already records.
 *
 * ---------------------------------------------------------------------------
 * The one rule that makes this worth having
 *
 * **Nobody types the progress.** Every other tool with a goals feature — Hive's included — lets
 * somebody set a target and then periodically say how far along it is. That number is a claim,
 * made by the person being measured, and it drifts from reality in exactly one direction. A
 * goal at "80%" that has been 80% for a month is the normal state of such a screen.
 *
 * Here a goal names a MEASURE, and the measure is computed from the register on every read. It
 * can be wrong only if the underlying records are wrong, and those are the records the work is
 * actually done in. There is no field to enter progress into, and there will not be one.
 *
 * The consequence is that a measure may only exist if its source can be named. Anything a firm
 * might want to track that cannot be computed is deliberately absent rather than offered with a
 * manual number attached — "we improved client satisfaction" is not a goal this can hold, and
 * pretending otherwise would make every other figure on the screen less trustworthy.
 *
 * ---------------------------------------------------------------------------
 * Scoped to a node, never to a person
 *
 * Every measure is computed over a part of the tree. Time in particular: `TimeEntry` carries an
 * `issueId`, so hours roll up through the tree exactly like everything else — where keying a
 * goal on `TimeEntry.person` would have joined on a display NAME, which is the join already
 * known to fail silently when somebody's directory name differs from the name on their records.
 * A goal that reads zero because of a name mismatch is worse than no goal.
 *
 * ---------------------------------------------------------------------------
 * What is not measured here, and why
 *
 * Milestones accepted, scope agreed and contracted value are all derivable and all absent. They
 * are commercial figures, and there is no read grant for those — see the same note in
 * `lib/portfolio.ts`. Adding them as a goal measure would reintroduce through the back door
 * exactly what was declined at the front.
 */

export type GoalDirection = 'atLeast' | 'atMost'

export interface Measure {
  key: string
  label: string
  /** What it counts, and where the number comes from. Shown on screen, not just in code. */
  what: string
  direction: GoalDirection
  unit: string
  /** True when the measure only counts things inside the goal's window. */
  windowed: boolean
}

/**
 * The four, each with a source that can be pointed at.
 *
 * `atLeast` goals are achievements — a number that should climb. `atMost` goals are ceilings —
 * a number that should stay down. They are not the same shape and are not displayed as one: a
 * ceiling at 40% of its limit is healthy, and an achievement at 40% of its target is behind.
 */
export const MEASURES: Measure[] = [
  {
    key: 'closed',
    label: 'Work closed',
    what: 'Issues beneath this node whose closure date falls inside the window. Counted from the closure date the reducer stamps when a record moves to a closing status — not from when somebody last touched it.',
    direction: 'atLeast',
    unit: 'issues',
    windowed: true,
  },
  {
    key: 'openAtMost',
    label: 'Open work held under',
    what: 'Live issues beneath this node that are not in a closing status, counted as they stand today. A ceiling on the backlog rather than a total to reach.',
    direction: 'atMost',
    unit: 'open',
    windowed: false,
  },
  {
    key: 'unownedAtMost',
    label: 'Unowned work held under',
    what: 'Open issues beneath this node with nobody’s name on them. "Unassigned" is a real stored value here as well as an empty one, and both count.',
    direction: 'atMost',
    unit: 'unowned',
    windowed: false,
  },
  {
    key: 'hoursAtMost',
    label: 'Hours held under',
    what: 'Hours recorded against issues beneath this node with a work date inside the window. Rolled up through the tree from the issue each entry is against, so it never depends on matching a person by name.',
    direction: 'atMost',
    unit: 'hours',
    windowed: true,
  },
]

export const MEASURE_KEYS = MEASURES.map((m) => m.key)

export interface Goal {
  id: string
  name: string
  /** The node this is about. Everything beneath it counts, at any depth. */
  scopeId: string
  measure: string
  target: number
  /** The day it is judged on. */
  by: string
  /** Window start for windowed measures. Ignored by the others. */
  from: string | null
  note: string
  createdBy: string
  createdAt: string
  deletedAt: string | null
}

export interface GoalProgress {
  goal: Goal
  measure: Measure | null
  /** What the register says right now. Null when the measure no longer exists. */
  actual: number | null
  met: boolean
  /** Days until it is judged. Negative once the date has passed. */
  daysLeft: number
  /** One sentence stating the position without a percentage. */
  phrase: string
}

/**
 * Every live goal, with its number computed fresh.
 *
 * Ordered by what is furthest from being met, then by the nearest date — the same shape as the
 * rest of the product: the thing most wanting attention first, and no blended score anywhere.
 */
export function goalProgress(state: WorkspaceState, today: string): GoalProgress[] {
  const goals = Object.values(state.model.goals ?? {}).filter((g) => !g.deletedAt)

  const rows = goals.map((goal) => {
    const measure = MEASURES.find((m) => m.key === goal.measure) ?? null
    const actual = measure ? compute(state, goal, measure) : null
    const met =
      actual === null
        ? false
        : measure!.direction === 'atLeast'
          ? actual >= goal.target
          : actual <= goal.target
    const daysLeft = dayDiff(today, goal.by)

    return { goal, measure, actual, met, daysLeft, phrase: phraseFor(goal, measure, actual, met, daysLeft) }
  })

  return rows.sort((a, b) => {
    // Unmet before met; then whichever is judged soonest.
    if (a.met !== b.met) return a.met ? 1 : -1
    return a.daysLeft - b.daysLeft || a.goal.name.localeCompare(b.goal.name)
  })
}

function compute(state: WorkspaceState, goal: Goal, measure: Measure): number | null {
  // A goal pointed at a node somebody has since removed reports nothing rather than zero: those
  // are different answers, and zero would read as "achieved" on a ceiling.
  if (!state.nodes[goal.scopeId]) return null

  const issues = issuesUnder(state, goal.scopeId)
  const open = issues.filter((i) => !isTerminal(i.status))

  switch (measure.key) {
    case 'closed':
      return issues.filter(
        (i) => i.actualEnd && inWindow(i.actualEnd, goal.from, goal.by),
      ).length

    case 'openAtMost':
      return open.length

    case 'unownedAtMost':
      return open.filter((i) => !i.owner.trim() || i.owner === 'Unassigned').length

    case 'hoursAtMost': {
      const ids = new Set(issues.map((i) => i.id))
      const hours = Object.values(state.timeEntries)
        .filter((t) => !t.deletedAt && ids.has(t.issueId) && inWindow(t.date, goal.from, goal.by))
        .reduce((n, t) => n + t.hours, 0)
      // One decimal. Hours are recorded in fractions and a raw float reads as false precision.
      return Math.round(hours * 10) / 10
    }

    default:
      return null
  }
}

/**
 * The position in words.
 *
 * No percentage, deliberately. "62%" against a ceiling means the opposite of what it means
 * against a target, and one number that flips meaning between rows is worse than none.
 */
function phraseFor(
  goal: Goal,
  measure: Measure | null,
  actual: number | null,
  met: boolean,
  daysLeft: number,
): string {
  if (!measure) return `Its measure “${goal.measure}” no longer exists, so nothing is being counted.`
  if (actual === null) return 'The part of the tree this was set against no longer exists.'

  const when =
    daysLeft > 1 ? `${daysLeft} days left` : daysLeft === 1 ? '1 day left' : daysLeft === 0 ? 'judged today' : `${-daysLeft} days past its date`

  return measure.direction === 'atLeast'
    ? met
      ? `${actual} of ${goal.target} ${measure.unit} — met, with ${when}.`
      : `${actual} of ${goal.target} ${measure.unit}, ${goal.target - actual} short. ${when[0].toUpperCase()}${when.slice(1)}.`
    : met
      ? `${actual} ${measure.unit} against a ceiling of ${goal.target} — inside it, with ${when}.`
      : `${actual} ${measure.unit} against a ceiling of ${goal.target}, over by ${actual - goal.target}. ${when[0].toUpperCase()}${when.slice(1)}.`
}

/**
 * One sentence for the set.
 *
 * Leads with what is not met. A count of goals is a number about ambition; a count of missed
 * ones is a number about delivery, and only the second is worth the top of a screen.
 */
export function describeGoals(rows: GoalProgress[]): string {
  if (!rows.length) {
    return 'No goals set. A goal here names a measure the register can compute, so there is nothing to enter progress into and nothing to keep up to date.'
  }
  const missed = rows.filter((r) => !r.met)
  if (!missed.length) {
    return `${rows.length} ${rows.length === 1 ? 'goal' : 'goals'}, all currently met. Every figure is computed from the register on load — none of it is entered by hand.`
  }
  return `${missed.length} of ${rows.length} ${rows.length === 1 ? 'goal is' : 'goals are'} not currently met. Every figure is computed from the register on load, so these move when the work moves and not before.`
}

/** Inclusive on both ends. A null start means "everything up to the date". */
function inWindow(day: string, from: string | null, to: string): boolean {
  const d = day.slice(0, 10)
  if (from && d < from.slice(0, 10)) return false
  return d <= to.slice(0, 10)
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}
