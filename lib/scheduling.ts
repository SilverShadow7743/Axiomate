import { addDays, workingDaysBetween } from './dates'
import { commitmentCounts, meetingHours } from './availability'
import type { Commitment, ResourceProfile } from './capacity'
import type { Meeting } from './meetings'

/**
 * Find-a-slot — E4's "intelligence", deliberately day-granular.
 *
 * For each working day in the range, each attendee's free hours are their pattern day minus
 * that day's meeting hours, zeroed outright by an approved leave day (or the org holiday /
 * weekend skip). A day is a candidate when EVERY attendee clears the asked duration. The
 * answer never forces a pick: an empty range says so, and every non-candidate day carries its
 * NAMED blockers ("Sam on leave", "Priya has 1h free of the 2h asked").
 *
 * Requested leave follows the engine's own posture: it blocks nothing — an unapproved
 * absence is not a fact about the calendar — but it rides the day as a named CAVEAT, because
 * the person choosing the slot is exactly who should see the question. Mornings and
 * afternoons wait for a time grid that does not exist; a day is the honest unit this model
 * can promise.
 */

export interface DayCandidate {
  date: string
  ok: boolean
  /** Why this day fails — one entry per blocked attendee, in words. Empty when ok. */
  blockers: string[]
  /** Requested-leave overlaps — never blocking, always named. */
  caveats: string[]
}

export function suggestDays(args: {
  attendeeIds: string[]
  durationHours: number
  from: string
  to: string
  meetings: Meeting[]
  commitments: Commitment[]
  holidays?: ReadonlySet<string>
  profiles: Record<string, ResourceProfile>
  /** Directory names for the sentences — blockers name people, not ids. */
  nameOf: Record<string, string>
}): DayCandidate[] {
  const out: DayCandidate[] = []
  const attendees = [...new Set(args.attendeeIds)]
  const name = (id: string) => args.nameOf[id] ?? id

  for (let d = args.from; d <= args.to; d = addDays(d, 1)) {
    // Weekend or org holiday: not a working day for anyone — skipped, not listed as blocked.
    if (workingDaysBetween(d, d, args.holidays) !== 1) continue

    const blockers: string[] = []
    const caveats: string[] = []
    for (const id of attendees) {
      const onDay = args.commitments.filter(
        (c) => !c.deletedAt && c.personId === id && c.startDate <= d && d <= c.endDate,
      )
      // Approved leave (absent status included — pre-E1 history) zeroes the day outright.
      if (onDay.some((c) => c.kind === 'Leave' && commitmentCounts(c))) {
        blockers.push(`${name(id)} on leave`)
        continue
      }
      if (onDay.some((c) => c.kind === 'Leave' && c.status === 'Requested')) {
        caveats.push(`${name(id)} has leave requested for this day — not yet decided`)
      }
      const patternDay = args.profiles[id]?.hoursPerDay ?? 7.5
      const booked = meetingHours(args.meetings, id, d, d)
      const free = Math.round((patternDay - booked) * 100) / 100
      if (free < args.durationHours) {
        blockers.push(`${name(id)} has ${Math.max(0, free)}h free of the ${args.durationHours}h asked`)
      }
    }
    out.push({ date: d, ok: blockers.length === 0, blockers, caveats })
  }
  return out
}
