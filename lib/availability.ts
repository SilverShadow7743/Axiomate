import { workingDaysBetween } from './dates'
import type { Allocation, Commitment, ResourceProfile } from './capacity'
import { attends, type Meeting } from './meetings'

/**
 * The availability engine — the ONE place "who has time, when" is computed.
 *
 * Extracted from `capacityFor` (E1; see `2026-08-30-e1-availability-forecast-design.md`),
 * whose arithmetic this preserves verbatim: the same 2dp rounding at every aggregate, the same
 * `Math.max(0, …)` floor on available hours, the same window-average treatment of a short week
 * (a four-day week is four fifths of the calendar's working days — which day is off is a fact
 * this model does not carry), and the same id-or-name person join. `capacityFor`, `planCheck`,
 * the assignment warning, the time-entry day warning and the forecast all consult this;
 * a second engine answering the same question is the drift the parent design forbids.
 *
 * The formula, and where each term stands today:
 *
 *     available = pattern-derived gross
 *               − approved leave and other commitments
 *               − holidays            (via the working-day math's optional set)
 *               − meetings            (E4 — attended live meetings' hours inside the window;
 *                                      the optional param absent means zero, byte-identical
 *                                      to the pre-E4 arithmetic, held by E4A's golden)
 *     remaining = available − allocations
 *
 * **Pending leave never subtracts.** A Requested absence is not a fact about the calendar yet;
 * it is returned as a named conflict for every consumer to surface. That is the parent
 * design's "don't silently change plans" made structural: the plan's numbers hold still, and
 * the person deciding sees the question. A Returned request subtracts nothing and raises no
 * conflict either — it was declined, and its subject edits or withdraws it.
 *
 * A Leave commitment with ABSENT status is Approved: every row written before approval existed
 * is attested history recorded under the old rules. This is the one place that rule is
 * interpreted; the mapper and the UI read the field, they do not re-decide it.
 */

export interface PendingLeave {
  id: string
  startDate: string
  endDate: string
  /** Working days of the request that overlap the asked-about window. */
  days: number
}

export interface AvailabilityPosition {
  workingDays: number
  grossHours: number
  /** Approved leave, holidays-as-commitments, internal time. Pending leave is NOT here. */
  committedHours: number
  /** Attended live meetings' hours inside the window — exactly 0 when no meetings were
   *  handed in, so every pre-E4 caller's arithmetic is untouched (E4A's golden holds it). */
  meetingHours: number
  availableHours: number
  allocatedHours: number
  remainingHours: number
  overallocated: boolean
  utilisationPct: number | null
  basis: 'stated' | 'default'
  /** Requested leave overlapping the window — the conflict every consumer must surface. */
  pendingLeave: PendingLeave[]
}

const round = (n: number) => Math.round(n * 100) / 100

/** Working days two inclusive ranges share, holiday-aware. */
export function overlapWorkingDays(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
  holidays?: ReadonlySet<string>,
): number {
  const from = aFrom > bFrom ? aFrom : bFrom
  const to = aTo < bTo ? aTo : bTo
  if (to < from) return 0
  return workingDaysBetween(from, to, holidays)
}

/**
 * The engine's fourth term (E4): hours of attended, live meetings falling inside the window.
 *
 * The clipping rule, stated and pinned in E4A: the raw hour overlap of the meeting's
 * [startAt, endAt] with [from 00:00:00Z, to 23:59:59.999Z] — a meeting straddling the
 * boundary counts only its inside hours, and a multi-day one clips the same way. Everything
 * parses through Date.parse so an ISO-with-Z start and a date-only window never compare as
 * strings. Ids only: `attends` never falls back to a name — the one clean join, kept clean.
 */
export function meetingHours(
  meetings: Meeting[] | undefined,
  personId: string | null | undefined,
  from: string,
  to: string,
): number {
  if (!meetings?.length || !personId) return 0
  const winFrom = Date.parse(`${from}T00:00:00.000Z`)
  const winTo = Date.parse(`${to}T23:59:59.999Z`)
  let ms = 0
  for (const m of meetings) {
    if (!attends(m, personId)) continue
    const s = Date.parse(m.startAt)
    const e = Date.parse(m.endAt)
    if (Number.isNaN(s) || Number.isNaN(e)) continue
    ms += Math.max(0, Math.min(e, winTo) - Math.max(s, winFrom))
  }
  return round(ms / 3600000)
}

/** Whether a leave-shaped commitment counts against the calendar. Absent status is Approved —
 *  pre-E1 history, recorded under the old rules. */
export function commitmentCounts(c: Commitment): boolean {
  if (c.kind !== 'Leave') return true
  return (c.status ?? 'Approved') === 'Approved'
}

/**
 * The leave-reason redaction, pure so the scenario suite can drive exactly what leaves the
 * server (the same split as `clientView`). Every reader keeps dates, hours and status —
 * availability is the point of the record; the private reason survives only when the reader
 * may decide leave (`mayReadReasons`) or the row is their own (`mine` is their directory id).
 * boot()'s `redactForReader` is the caller; the UI never re-decides this.
 */
export function redactLeaveReasons(
  commitments: Record<string, Commitment>,
  mayReadReasons: boolean,
  mine: string | null,
): Record<string, Commitment> {
  if (mayReadReasons) return commitments
  return Object.fromEntries(
    Object.entries(commitments).map(([id, c]) => {
      if (c.kind !== 'Leave' || !c.reason) return [id, c]
      const own = c.personId && mine ? c.personId === mine : false
      return [id, own ? c : { ...c, reason: null }]
    }),
  )
}

export function availabilityFor(
  person: string,
  profile: ResourceProfile | undefined,
  commitments: Commitment[],
  allocations: Allocation[],
  from: string,
  to: string,
  /** The person's directory id when known — id-joined rows match through a rename. */
  personId?: string | null,
  holidays?: ReadonlySet<string>,
  /** E4's term. Absent means zero — every pre-E4 caller's numbers are untouched. */
  meetings?: Meeting[],
): AvailabilityPosition {
  // 7.5 over 5 mirrors `defaultProfile` in ./capacity, spelled here rather than imported
  // because that import would be a runtime cycle (capacity delegates to this module). The
  // golden-value check is what holds the two spellings together.
  const hoursPerDay = profile?.hoursPerDay ?? 7.5
  const daysPerWeek = profile?.daysPerWeek ?? 5
  // No profile at all is a default just as surely as a profile that says it is one.
  const basis: 'stated' | 'default' = profile?.source === 'stated' ? 'stated' : 'default'
  const calendarWorkingDays = workingDaysBetween(from, to, holidays)
  const workingDays = Math.round(calendarWorkingDays * (daysPerWeek / 5) * 100) / 100
  const grossHours = round(workingDays * hoursPerDay)

  const key = person.trim().toLowerCase()
  const isPerson = (r: { person: string; personId?: string | null }) =>
    r.personId && personId ? r.personId === personId : r.person.trim().toLowerCase() === key

  const live = commitments.filter((c) => !c.deletedAt && isPerson(c))
  const committedHours = round(
    live
      .filter(commitmentCounts)
      .reduce((n, c) => n + overlapWorkingDays(c.startDate, c.endDate, from, to, holidays) * c.hoursPerDay, 0),
  )
  const pendingLeave: PendingLeave[] = live
    .filter((c) => c.kind === 'Leave' && c.status === 'Requested')
    .map((c) => ({
      id: c.id,
      startDate: c.startDate,
      endDate: c.endDate,
      days: overlapWorkingDays(c.startDate, c.endDate, from, to, holidays),
    }))
    .filter((p) => p.days > 0)

  const meetingHrs = meetingHours(meetings, personId ?? null, from, to)
  const availableHours = round(Math.max(0, grossHours - committedHours - meetingHrs))

  const allocatedHours = round(
    allocations
      .filter((a) => !a.deletedAt && isPerson(a))
      .reduce((n, a) => {
        const days = overlapWorkingDays(a.startDate, a.endDate, from, to, holidays)
        return n + days * hoursPerDay * (a.percentage / 100)
      }, 0),
  )

  const remainingHours = round(availableHours - allocatedHours)
  return {
    workingDays,
    grossHours,
    committedHours,
    meetingHours: meetingHrs,
    availableHours,
    allocatedHours,
    remainingHours,
    overallocated: remainingHours < 0,
    utilisationPct: availableHours > 0 ? round((allocatedHours / availableHours) * 100) : null,
    basis,
    pendingLeave,
  }
}
