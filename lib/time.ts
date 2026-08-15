import type { IssueEstimate, SizeBand } from './estimation'
import { deriveEffort } from './estimation'

/**
 * Hours actually spent, recorded against the work they were spent on.
 *
 * ---------------------------------------------------------------------------
 * Why the entry, and not the timesheet
 *
 * A timesheet is a week of somebody's entries presented for approval. It is a *view* with a
 * decision attached, and treating it as the record produces the classic defect: an entry
 * edited after approval silently changes an approved total, because the approval was attached
 * to a container rather than to the things inside it. So the entry is the record here, and a
 * timesheet — when it arrives — will be a query over entries plus an approval that names
 * exactly which ones it covered.
 *
 * ---------------------------------------------------------------------------
 * What this unlocks, and what it deliberately does not
 *
 * Five things the product could not compute at all are functions of this one record: actual
 * effort, effort variance against an estimate, cost, utilisation, and how much of a fixed-price
 * engagement has been consumed. Only the first two are derivable *here*. Cost needs a rate,
 * utilisation needs capacity, and consumption needs a SOW — none of which exist yet, and each
 * of which will read from this module rather than keeping its own copy of the hours.
 *
 * Nothing in this file stores a derived total. `hoursOn` recomputes from the entries every
 * time it is asked, for the same reason schedule health is not a column: a stored total is one
 * more thing that can disagree with the rows underneath it.
 */

/**
 * What the hours were spent doing.
 *
 * Deliberately short, and deliberately not the lifecycle phases. A phase is where the work sat
 * in its plan; this is what the person was doing, and the two come apart constantly —
 * investigating during Corrective Action is normal. Configurable later if a firm needs it;
 * fixed now because inventing a configuration surface for five values nobody has asked to
 * change is how a product grows screens instead of capability.
 */
export const TIME_ACTIVITIES = [
  'Investigation',
  'Resolution',
  'Testing',
  'Client communication',
  'Documentation',
  'Meeting',
] as const
export type TimeActivity = (typeof TIME_ACTIVITIES)[number]

export interface TimeEntry {
  /** `time-12`, minted from the workspace counter. */
  id: string
  issueId: string
  /** Who did the work, by name — the same join the rest of the product uses until people have real keys. */
  person: string
  /** The day the work happened, `YYYY-MM-DD`. Not when it was typed in. */
  date: string
  hours: number
  activity: TimeActivity
  /**
   * Whether this time is chargeable.
   *
   * Recorded on the entry rather than derived from the engagement, because the exceptions are
   * the point: rework after a mistake of ours is non-billable on a time-and-materials job, and
   * a goodwill fix is non-billable on any job. A derivation could not know either.
   */
  billable: boolean
  note: string
  createdBy: string
  createdAt: string
  updatedBy: string | null
  updatedAt: string | null
  deletedAt: string | null
}

/** A single entry can never be a whole day and a half. */
export const MAX_HOURS_PER_ENTRY = 12

export interface TimeProblem {
  message: string
  field: 'hours' | 'date' | 'person'
}

/**
 * Whether an entry is recordable.
 *
 * `today` is a parameter rather than read from the clock, so the same check runs in the
 * browser, in the reducer and in a test without three answers.
 */
export function checkEntry(
  e: { hours: number; date: string; person: string },
  today: string,
): TimeProblem | null {
  if (!Number.isFinite(e.hours) || e.hours <= 0) {
    return { field: 'hours', message: 'Hours must be more than zero.' }
  }
  if (e.hours > MAX_HOURS_PER_ENTRY) {
    return {
      field: 'hours',
      message: `${MAX_HOURS_PER_ENTRY} hours is the most one entry can hold. A longer day is more than one piece of work.`,
    }
  }
  // Quarter hours. Finer than that is a false precision nobody reconstructs accurately.
  if (Math.round(e.hours * 4) !== e.hours * 4) {
    return { field: 'hours', message: 'Record time in quarter hours.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
    return { field: 'date', message: 'A date is needed, and it is the day the work happened.' }
  }
  if (e.date > today) {
    return { field: 'date', message: 'Time cannot be recorded for a day that has not happened.' }
  }
  if (!e.person.trim()) {
    return { field: 'person', message: 'Time belongs to somebody.' }
  }
  return null
}

/** Live entries against one issue, newest first. */
export function entriesFor(all: Record<string, TimeEntry>, issueId: string): TimeEntry[] {
  return Object.values(all)
    .filter((e) => e.issueId === issueId && !e.deletedAt)
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
}

/** Hours on one issue. Recomputed, never stored. */
export function hoursOn(all: Record<string, TimeEntry>, issueId: string): number {
  return round(entriesFor(all, issueId).reduce((n, e) => n + e.hours, 0))
}

export interface TimeSummary {
  hours: number
  billable: number
  nonBillable: number
  people: string[]
  first: string | null
  last: string | null
  byActivity: { activity: TimeActivity; hours: number }[]
}

export function summariseTime(all: Record<string, TimeEntry>, issueId: string): TimeSummary {
  const entries = entriesFor(all, issueId)
  const byActivity = TIME_ACTIVITIES.map((activity) => ({
    activity,
    hours: round(entries.filter((e) => e.activity === activity).reduce((n, e) => n + e.hours, 0)),
  })).filter((x) => x.hours > 0)

  const dates = entries.map((e) => e.date).sort()
  return {
    hours: round(entries.reduce((n, e) => n + e.hours, 0)),
    billable: round(entries.filter((e) => e.billable).reduce((n, e) => n + e.hours, 0)),
    nonBillable: round(entries.filter((e) => !e.billable).reduce((n, e) => n + e.hours, 0)),
    people: [...new Set(entries.map((e) => e.person))].sort(),
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    byActivity,
  }
}

/**
 * Estimated against actual.
 *
 * `estimated` is null when nothing has been estimated, and that is not the same as zero: an
 * issue with 14 hours on it and no estimate is not 14 hours over, it is unestimated. The
 * Estimation tab said exactly this while there was no actual side to compare against, and the
 * distinction matters more now that there is one.
 */
export interface EffortVariance {
  estimated: number | null
  actual: number
  /** actual − estimated. Positive is over. */
  varianceHours: number | null
  variancePct: number | null
  /** True once the estimate has been agreed — an overrun against a draft is not yet news. */
  againstBaseline: boolean
}

export function effortVariance(
  all: Record<string, TimeEntry>,
  issueId: string,
  estimate: IssueEstimate | undefined,
  bands: SizeBand[],
): EffortVariance {
  const actual = hoursOn(all, issueId)
  const estimated = estimate ? deriveEffort(estimate, bands).effortHours : null
  const varianceHours = estimated === null ? null : round(actual - estimated)
  return {
    estimated,
    actual,
    varianceHours,
    variancePct: estimated ? round((varianceHours! / estimated) * 100) : null,
    againstBaseline: Boolean(estimate?.baselinedAt),
  }
}

/** Two decimal places, which is as fine as quarter hours ever need. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}
