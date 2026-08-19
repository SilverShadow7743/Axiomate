import type { ScheduleRow } from './types'

/**
 * The calendar: one month of planned work, with the unscheduled majority carried beside it.
 *
 * The design's whole argument is the reconciliation: of the 247 records live today, 124 have
 * no planned end, and a month grid that quietly rendered only the dated half would be the
 * clipped-summary fault in a new costume. So this module returns the split as first-class
 * data — `dated + undated = every row given` by construction, asserted in the scenario suite —
 * and the screen states it rather than leaving it to be discovered.
 */

export interface CalendarDay {
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  /** Rows whose planned span covers this day. A multi-day span appears on each day it covers. */
  rows: ScheduleRow[]
}

export interface CalendarMonth {
  /** First day of the month, ISO. */
  monthStart: string
  /** Weeks of seven days, Monday first, padded with adjacent-month days carrying empty rows. */
  weeks: CalendarDay[][]
  /** Rows with a planned end somewhere — this month or another. */
  dated: ScheduleRow[]
  /** Rows with no planned end at all. A first-class state, not a failure — see ScheduleHealth. */
  undated: ScheduleRow[]
  /** Of the dated rows, those whose span touches this month. */
  inMonth: number
}

/** `monthIso` is any ISO date inside the wanted month. */
export function calendarMonth(rows: ScheduleRow[], monthIso: string): CalendarMonth {
  const anchor = monthIso.slice(0, 7) // YYYY-MM
  const first = `${anchor}-01`
  const firstDate = new Date(`${first}T00:00:00Z`)
  const daysInMonth = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)).getUTCDate()
  const last = `${anchor}-${String(daysInMonth).padStart(2, '0')}`

  const dated: ScheduleRow[] = []
  const undated: ScheduleRow[] = []
  for (const row of rows) {
    if (row.status === null) continue // structural tiers are not calendar entries, as they are not cards
    ;(row.plannedEndDate ? dated : undated).push(row)
  }

  /*
   * Placement: the planned span, clipped to the month. A row with only an end date is a
   * single-day entry on that date — inventing a start would be a guess rendered as a bar.
   */
  const byDay = new Map<string, ScheduleRow[]>()
  let inMonth = 0
  for (const row of dated) {
    const end = row.plannedEndDate!
    const start = row.plannedStartDate && row.plannedStartDate <= end ? row.plannedStartDate : end
    if (end < first || start > last) continue
    inMonth++
    const from = start < first ? first : start
    const to = end > last ? last : end
    for (let d = new Date(`${from}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10)
      if (iso > to) break
      const list = byDay.get(iso) ?? []
      list.push(row)
      byDay.set(iso, list)
    }
  }

  /* The grid: Monday-first weeks, padded so every week has seven cells. */
  const lead = (firstDate.getUTCDay() + 6) % 7 // Monday = 0
  const cells: CalendarDay[] = []
  for (let i = 0; i < lead; i++) {
    const d = new Date(firstDate)
    d.setUTCDate(d.getUTCDate() - (lead - i))
    cells.push({ date: d.toISOString().slice(0, 10), rows: [] })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${anchor}-${String(day).padStart(2, '0')}`
    cells.push({ date: iso, rows: byDay.get(iso) ?? [] })
  }
  while (cells.length % 7) {
    const prev = new Date(`${cells[cells.length - 1].date}T00:00:00Z`)
    prev.setUTCDate(prev.getUTCDate() + 1)
    cells.push({ date: prev.toISOString().slice(0, 10), rows: [] })
  }
  const weeks: CalendarDay[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return { monthStart: first, weeks, dated, undated, inMonth }
}

/**
 * The header sentence — the split stated, never implied.
 */
export function describeCalendar(m: CalendarMonth): string {
  const total = m.dated.length + m.undated.length
  if (!total) return 'Nothing to show under the current filters.'
  if (!m.undated.length) {
    return `${m.inMonth} of ${m.dated.length} scheduled ${m.dated.length === 1 ? 'item falls' : 'items fall'} in this month, and everything shown carries a planned date.`
  }
  return `${m.inMonth} of ${m.dated.length} scheduled items fall in this month. ${m.undated.length} of ${total} have no planned date and cannot be on any calendar — they are listed beside the grid, not hidden.`
}
