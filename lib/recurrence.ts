import type { Severity } from './types'

/**
 * Recurring work: a configured rule that raises an issue on a cadence.
 *
 * ---------------------------------------------------------------------------
 * The duplicate guard is a stored fact
 *
 * `lastRaisedOn` records the occurrence a rule last raised for — a fact about what happened,
 * not a derived value, advanced in the same batch as the raise and only when the raise
 * succeeded. Everything else here is arithmetic over it: `dueOccurrence` answers with at most
 * ONE date, the latest occurrence that is strictly after `lastRaisedOn` and on or before
 * today. Two consequences, both deliberate:
 *
 *  - A pass re-running the same morning raises nothing twice.
 *  - A pass that was down for three days raises the missed occurrence once, not once per
 *    missed day — catching up every tick would flood the register with stale checklist copies.
 *
 * ---------------------------------------------------------------------------
 * Two cadences, and day 31 means last-of-month
 *
 * Weekly (a weekday) and monthly (a day-of-month, clamped to the month's length — so 31 is
 * "last day" everywhere, February included). Deliberately absent: cron strings, every-N-hours,
 * and "skip if the previous is still open" — a month-end close is distinct work each month,
 * and an unclosed previous one is a fact for the board to show, not a reason to withhold the
 * next.
 */

export type Cadence =
  | { kind: 'weekly'; /** 0 = Sunday .. 6 = Saturday, as Date.getUTCDay has it. */ weekday: number }
  | { kind: 'monthly'; /** 1..31, clamped to the month's length. */ day: number }

export interface Recurrence {
  id: string
  /** What the raised issue is about — the subject carries this plus the occurrence date. */
  name: string
  /** Where it files. Must be able to hold an issue; checked at upsert AND at raise. */
  scopeId: string
  cadence: Cadence
  /** Work type of the raised issue, in the workspace's own vocabulary. */
  type: string
  severity: Severity
  /** Empty means 'Unassigned' — a real stored value the unowned counts watch. */
  owner: string
  enabled: boolean
  /** The occurrence last raised for — the duplicate guard. Null means never raised. */
  lastRaisedOn: string | null
}

const DAY_MS = 86_400_000

function atUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/**
 * The latest occurrence on or before `date`, or null when the date is malformed.
 *
 * Monthly clamping happens per month, not once: a day-31 rule occurs on Jan 31, Feb 28 and
 * Apr 30, and each month is judged against its own length.
 */
export function occurrenceOnOrBefore(cadence: Cadence, date: string): string | null {
  const d = atUtc(date)
  if (Number.isNaN(d.getTime())) return null

  if (cadence.kind === 'weekly') {
    const back = (d.getUTCDay() - cadence.weekday + 7) % 7
    return toIso(new Date(d.getTime() - back * DAY_MS))
  }

  const clamp = (year: number, month0: number) =>
    Math.min(Math.max(1, Math.floor(cadence.day)), daysInMonth(year, month0))

  const thisMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), clamp(d.getUTCFullYear(), d.getUTCMonth()))
  if (thisMonth <= d.getTime()) return toIso(new Date(thisMonth))

  // This month's occurrence is still ahead; the latest one on or before `date` is last month's.
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()
  const m = (d.getUTCMonth() + 11) % 12
  return toIso(new Date(Date.UTC(y, m, clamp(y, m))))
}

/**
 * The one occurrence a pass should raise for today, or null.
 *
 * Strictly after `lastRaisedOn` — on-or-after would re-raise the same occurrence forever.
 */
export function dueOccurrence(rule: Recurrence, today: string): string | null {
  if (!rule.enabled) return null
  const occ = occurrenceOnOrBefore(rule.cadence, today)
  if (!occ) return null
  if (rule.lastRaisedOn && occ <= rule.lastRaisedOn.slice(0, 10)) return null
  return occ
}

/** "Month-end close — 2026-08-31": two months' issues are distinct records. */
export function subjectFor(rule: Recurrence, occurrence: string): string {
  return `${rule.name} — ${occurrence.slice(0, 10)}`
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The rule in a sentence, for the Configuration screen.
 */
export function describeRecurrence(rule: Recurrence): string {
  const when =
    rule.cadence.kind === 'weekly'
      ? `every ${WEEKDAYS[((rule.cadence.weekday % 7) + 7) % 7]}`
      : rule.cadence.day >= 31
        ? 'on the last day of each month'
        : `on day ${rule.cadence.day} of each month (or the month's last day when shorter)`
  const state = rule.enabled ? '' : ' Currently off — a decision, not a fault.'
  const last = rule.lastRaisedOn
    ? ` Last raised for ${rule.lastRaisedOn.slice(0, 10)}.`
    : ' Never raised yet.'
  return `Raises “${rule.name}” ${when}, filed under its configured scope as ${rule.severity} ${rule.type || 'work'}.${last}${state}`
}
