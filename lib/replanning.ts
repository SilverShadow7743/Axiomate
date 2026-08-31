import { availabilityFor, overlapWorkingDays } from './availability'
import { profileAt } from './capacity'
import { holidaySetOf } from './config'
import { addDays } from './dates'
import type { WorkspaceState } from './workspace'

/**
 * Decision support for an over-committed person — never an invented fix.
 *
 * See docs/plans/2026-08-31-resource-replanning-design.md. There is no fact to derive "which
 * allocation to cut, and by how much" from — that is a business judgment nobody has recorded
 * anywhere, unlike Zero-Entry Timesheet's meeting-duration fact. So this names the deficit and
 * shows every overlapping allocation's own hours, workspace-wide for the person, and picks
 * none of them. Applying a change is the caller's job, through the real reducer.
 */

export interface ReplanningAllocationRow {
  id: string
  projectId: string
  projectName: string
  percentage: number
  startDate: string
  endDate: string
  hoursInWindow: number
}

export interface ReplanningView {
  person: string
  personId: string | null
  windowFrom: string
  windowTo: string
  deficitHours: number
  allocations: ReplanningAllocationRow[]
}

/**
 * `null` when the person is not overallocated in this window — a deficit with nothing to show
 * is not a real case, matching the same window `lib/portfolio.ts`'s capacity concern reads:
 * `today -> today+28d`, the same `profileAt`/`holidaySetOf` resolution. Not a stylistic echo —
 * this is what makes `deficitHours` here provably equal to the capacity concern's own
 * `-remainingHours` for the identical person, rather than a second, possibly-disagreeing
 * reading of the same fact.
 */
export function replanningFor(
  state: WorkspaceState,
  person: string,
  personId: string | null,
  today: string,
): ReplanningView | null {
  const holidays = holidaySetOf(state.model)
  const commitments = Object.values(state.commitments)
  const allocations = Object.values(state.allocations)
  const versions = Object.values(state.versions)
  const windowFrom = today
  const windowTo = addDays(today, 28)

  const profile = personId ? profileAt(versions, state.model.resourceProfiles, personId, today) : undefined
  const pos = availabilityFor(person, profile, commitments, allocations, windowFrom, windowTo, personId, holidays)
  if (!pos.overallocated) return null

  // Mirrors availabilityFor's own default — see its header comment on why 7.5/5 is spelled
  // here rather than imported (a runtime cycle: capacity delegates to availability).
  const hoursPerDay = profile?.hoursPerDay ?? 7.5
  const key = person.trim().toLowerCase()
  const mine = allocations.filter(
    (a) => !a.deletedAt && (a.personId && personId ? a.personId === personId : a.person.trim().toLowerCase() === key),
  )

  const rows: ReplanningAllocationRow[] = mine
    .map((a) => {
      const days = overlapWorkingDays(a.startDate, a.endDate, windowFrom, windowTo, holidays)
      const hoursInWindow = Math.round(days * hoursPerDay * (a.percentage / 100) * 100) / 100
      return {
        id: a.id,
        projectId: a.projectId,
        projectName: state.nodes[a.projectId]?.name ?? a.projectId,
        percentage: a.percentage,
        startDate: a.startDate,
        endDate: a.endDate,
        hoursInWindow,
      }
    })
    .filter((r) => r.hoursInWindow > 0)
    .sort((x, y) => y.hoursInWindow - x.hoursInWindow)

  return {
    person,
    personId,
    windowFrom,
    windowTo,
    deficitHours: -pos.remainingHours,
    allocations: rows,
  }
}
