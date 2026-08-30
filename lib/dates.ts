/**
 * Date helpers. All dates in this app are ISO `YYYY-MM-DD` strings handled in UTC,
 * so that rendering is stable regardless of the viewer's timezone.
 */

const DAY_MS = 86_400_000

export function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`)
}

export function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS)
}

/** Inclusive calendar-day span: same start and end === 1 day. */
export function daysBetween(startIso: string, endIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / DAY_MS) + 1
}

export function isWeekend(iso: string): boolean {
  const d = new Date(toUtc(iso)).getUTCDay()
  return d === 0 || d === 6
}

/**
 * Inclusive count of Mon–Fri days between two dates, minus any listed holidays.
 *
 * `holidays` is optional and absent means none — the same optional-configuration pattern as
 * the tier list: every existing caller keeps byte-identical behaviour until one passes the
 * organisation's list. A holiday that falls on a weekend subtracts nothing, because the day
 * already did not count — the guard against double-subtraction lives here, once, rather than
 * in every caller's list hygiene.
 */
export function workingDaysBetween(
  startIso: string,
  endIso: string,
  holidays?: ReadonlySet<string>,
): number {
  let count = 0
  const end = toUtc(endIso)
  for (let t = toUtc(startIso); t <= end; t += DAY_MS) {
    const d = new Date(t).getUTCDay()
    if (d !== 0 && d !== 6 && !holidays?.has(fromUtc(t))) count++
  }
  return count
}

/** Advance `n` working days from a date (n=0 returns the next working day on/after start).
 *  A listed holiday is not a working day, same optional set as `workingDaysBetween`. */
export function addWorkingDays(startIso: string, n: number, holidays?: ReadonlySet<string>): string {
  const isWorking = (t: number): boolean => {
    const d = new Date(t).getUTCDay()
    return d !== 0 && d !== 6 && !holidays?.has(fromUtc(t))
  }
  let t = toUtc(startIso)
  let remaining = n
  while (!isWorking(t)) t += DAY_MS
  while (remaining > 0) {
    t += DAY_MS
    if (isWorking(t)) remaining--
  }
  return fromUtc(t)
}

export function minIso(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => !!d)
  if (!valid.length) return null
  return valid.reduce((a, b) => (a < b ? a : b))
}

export function maxIso(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => !!d)
  if (!valid.length) return null
  return valid.reduce((a, b) => (a > b ? a : b))
}

export function clampIso(iso: string, lo: string, hi: string): string {
  return iso < lo ? lo : iso > hi ? hi : iso
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "15-Aug-2026" — the format used throughout the issue log. */
export function formatIso(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(toUtc(iso))
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

export function formatShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(toUtc(iso))
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`
}

export function monthLabel(iso: string): string {
  const d = new Date(toUtc(iso))
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function quarterLabel(iso: string): string {
  const d = new Date(toUtc(iso))
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`
}

export function startOfWeek(iso: string): string {
  const t = toUtc(iso)
  const day = new Date(t).getUTCDay()
  // Week starts Monday.
  const offset = day === 0 ? 6 : day - 1
  return fromUtc(t - offset * DAY_MS)
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function startOfQuarter(iso: string): string {
  const d = new Date(toUtc(iso))
  const q = Math.floor(d.getUTCMonth() / 3) * 3
  return `${d.getUTCFullYear()}-${String(q + 1).padStart(2, '0')}-01`
}

export function startOfYear(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`
}

export function addMonths(iso: string, n: number): string {
  const d = new Date(toUtc(iso))
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
