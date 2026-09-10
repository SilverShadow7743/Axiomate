import type { WorkspaceState } from '../workspace'
import type { Commitment } from '../capacity'
import { commitmentCounts } from '../availability'
import { holidaySetOf } from '../config'
import { workingDaysBetween, addMonths, startOfMonth, addDays } from '../dates'

/**
 * The leave report — working days taken, month on month. See
 * `docs/plans/2026-09-08-leave-report-design.md` and its 10 Sep resolution of the three open
 * questions: a fixed trailing-6-month window (no picker), no per-project cut, and — the one
 * enforced below at the type level, not just at render time — reason text never appears here at
 * all. Neither row type below carries a `reason` or `note` field; a caller cannot render what
 * was never read into the shape in the first place.
 *
 * Like every other report in this directory, computed live from already-loaded state. Nothing
 * stored, nothing scheduled, nothing that can disagree with the tree behind it.
 */

export interface LeaveSummaryRow {
  person: string
  personId: string | null
  /** 'YYYY-MM' -> working days taken that month, holiday-aware. Only months in `LeaveReport.months`. */
  byMonth: Record<string, number>
  total: number
}

export interface PendingLeaveRow {
  person: string
  startDate: string
  endDate: string
}

export interface LeaveReport {
  /** 'YYYY-MM', oldest first — six months ending at the month `endingMonth` names. */
  months: string[]
  rows: LeaveSummaryRow[]
  pending: PendingLeaveRow[]
}

const round = (n: number) => Math.round(n * 100) / 100

/** The last calendar day of the month `monthStart` (a 'YYYY-MM-01' string) begins. */
function endOfMonth(monthStart: string): string {
  return addDays(addMonths(monthStart, 1), -1)
}

export function buildLeaveReport(state: WorkspaceState, endingMonth: string /* 'YYYY-MM' */): LeaveReport {
  const anchor = startOfMonth(`${endingMonth}-01`)
  const months = Array.from({ length: 6 }, (_, i) => addMonths(anchor, i - 5).slice(0, 7))
  const monthBounds = months.map((m) => ({ month: m, from: `${m}-01`, to: endOfMonth(`${m}-01`) }))
  const holidays = holidaySetOf(state.model)

  const pending: PendingLeaveRow[] = []
  const byPerson = new Map<string, LeaveSummaryRow>()

  const key = (c: Commitment) => c.personId ?? c.person.trim().toLowerCase()
  const rowFor = (c: Commitment): LeaveSummaryRow => {
    const k = key(c)
    const existing = byPerson.get(k)
    if (existing) return existing
    const fresh: LeaveSummaryRow = {
      person: c.person,
      personId: c.personId ?? null,
      byMonth: Object.fromEntries(months.map((m) => [m, 0])),
      total: 0,
    }
    byPerson.set(k, fresh)
    return fresh
  }

  for (const c of Object.values(state.commitments)) {
    if (c.deletedAt || c.kind !== 'Leave') continue

    // Absent means Approved (pre-E1 history, lib/capacity.ts's own doc comment) — only an
    // explicit 'Requested' is pending. 'Returned' falls through to neither branch: declined,
    // nothing to report, matching the design's own line.
    if (c.status === 'Requested') {
      pending.push({ person: c.person, startDate: c.startDate, endDate: c.endDate })
      continue
    }
    if (!commitmentCounts(c)) continue // 'Returned'

    const row = rowFor(c)
    for (const { month, from, to } of monthBounds) {
      const clipFrom = c.startDate > from ? c.startDate : from
      const clipTo = c.endDate < to ? c.endDate : to
      if (clipFrom > clipTo) continue // this commitment does not reach this month
      const days = workingDaysBetween(clipFrom, clipTo, holidays)
      row.byMonth[month] = round(row.byMonth[month] + days)
      row.total = round(row.total + days)
    }
  }

  const rows = [...byPerson.values()].sort((a, b) => b.total - a.total || a.person.localeCompare(b.person))
  pending.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.person.localeCompare(b.person))

  return { months, rows, pending }
}
