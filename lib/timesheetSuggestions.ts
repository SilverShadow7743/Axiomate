import { attends, type Meeting } from './meetings'
import { MAX_HOURS_PER_ENTRY, type TimeEntry } from './time'
import { daysOfWeek, entriesInWeek } from './timesheet'

/**
 * Zero-Entry Timesheet — a meeting-derived starting point, never an invented one.
 *
 * See `docs/plans/2026-08-31-zero-entry-timesheet-design.md`. The only signal used is an
 * issue-scoped `Meeting` (`scopeKind: 'issue'`) the person actually attended — the one fact in
 * this codebase that names a specific issue without guessing. Allocation and Assignment are
 * capacity/ownership, not a record of a particular day's actual work, and turning either into a
 * day's hours would mean guessing which issue — the invention this module exists to refuse.
 *
 * Pure — no clock, no database. Every suggestion is a starting point for a form, never a
 * `TimeEntry` written on its own; the caller decides whether and how it becomes one.
 */

export interface TimeSuggestion {
  issueId: string
  date: string
  hours: number
  activity: 'Meeting'
  /** The meeting(s) this suggestion was summed from, so the UI can say where it came from. */
  meetingIds: string[]
  titles: string[]
}

/**
 * Candidate entries for the open (issueId, date) cells in this week.
 *
 * A cell already holding a `TimeEntry` never gets a suggestion, matching `issueWeekCells`'s own
 * "the grid never edits a day that already has hours on it" rule — this is the same fact, read
 * from the suggestion side rather than the display side, and deliberately not a second,
 * independently-derived check.
 *
 * `issueId` narrows to one issue's meetings when given (the Time tab's call shape, already
 * inside one issue); omitted, every issue the person's meetings touched this week is returned
 * (My Week's call shape, across the whole week).
 */
export function meetingSuggestions(
  meetings: Meeting[],
  entries: TimeEntry[],
  person: string,
  personId: string | null,
  week: string,
  issueId?: string,
): TimeSuggestion[] {
  const mine = entriesInWeek(entries, person, week, personId)
  const filled = new Set(mine.map((e) => `${e.issueId}|${e.date}`))
  const days = new Set(daysOfWeek(week))
  const byCell = new Map<string, { issueId: string; date: string; ms: Meeting[] }>()

  for (const m of meetings) {
    if (m.deletedAt || m.scopeKind !== 'issue' || !m.scopeId) continue
    if (issueId && m.scopeId !== issueId) continue
    if (!attends(m, personId)) continue
    // `startAt` is stored as entered, single-timezone firm (lib/meetings.ts) — a slice, not a
    // Date-object derivation, is the correct read here, matching TD1's own fixtures.
    const date = m.startAt.slice(0, 10)
    if (!days.has(date)) continue
    const key = `${m.scopeId}|${date}`
    if (filled.has(key)) continue
    const cell = byCell.get(key) ?? { issueId: m.scopeId, date, ms: [] }
    cell.ms.push(m)
    byCell.set(key, cell)
  }

  return [...byCell.values()]
    .map(({ issueId, date, ms }) => {
      const totalMs = ms.reduce((n, m) => n + (Date.parse(m.endAt) - Date.parse(m.startAt)), 0)
      const rawHours = totalMs / 3_600_000
      // Quarter hours, same granularity checkEntry enforces; clamped to what one entry may hold.
      const hours = Math.min(MAX_HOURS_PER_ENTRY, Math.round(rawHours * 4) / 4)
      return {
        issueId,
        date,
        hours,
        activity: 'Meeting' as const,
        meetingIds: ms.map((m) => m.id),
        titles: ms.map((m) => m.title),
      }
    })
    .filter((s) => s.hours > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.issueId.localeCompare(b.issueId))
}
