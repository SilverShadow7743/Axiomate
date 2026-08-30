import { availabilityFor, type PendingLeave } from './availability'
import { deriveEffort, type Estimate, type SizeBand } from './estimation'
import { hoursOn, type TimeEntry } from './time'
import { formatIso } from './dates'
import type { Allocation, Commitment, ResourceProfile } from './capacity'
import type { Meeting } from './meetings'

/**
 * Forecast v1 — can this land by the target date, given who is actually available?
 *
 *     remaining = max(0, estimate-derived hours − recorded actuals)
 *     available = the owner's remaining hours, today → due date, from the ONE availability
 *                 engine (gross − approved commitments − holidays − allocations; the meetings
 *                 term is zero until E4)
 *
 * Computed at read time, never stored — a stored forecast would be wrong the moment somebody
 * books a day off, which is the same rule capacity already keeps. The verdict is a union
 * rather than a number because the honest answers differ in KIND: most live records carry no
 * estimate or no due date, and "nothing to forecast against" is a real answer, not a zero.
 *
 * Deliberately not schedule health. `computeHealth` reads the schedule's past and present;
 * this reads its future — folding them would overload a vocabulary every screen and scenario
 * already depends on (the E1 design says exactly this, and the separation is the point).
 *
 * The engine's pending-leave conflicts ride the verdict: a Requested absence has not moved
 * these numbers — that is the "don't silently change plans" rule — but the reader deciding
 * whether the date holds is exactly the person who should see the question.
 */

export type Forecast =
  | { kind: 'no-estimate' }
  | { kind: 'unscheduled'; remainingHours: number }
  | ForecastComputed

export interface ForecastComputed {
  kind: 'achievable' | 'short'
  remainingHours: number
  /** The owner's remaining capacity over the window, floored at zero for the comparison —
   *  an overallocated owner has nothing spare to give this work, not negative hours. */
  availableHours: number
  /** Positive spare on 'achievable'; positive shortfall on 'short'. */
  deltaHours: number
  from: string
  to: string
  /** Whether the working pattern behind the numbers was stated or assumed — carried, exactly
   *  as `describeCapacity` carries it, because the claim differs even when the number doesn't. */
  basis: 'stated' | 'default'
  pendingLeave: PendingLeave[]
}

export function forecastFor(args: {
  issueId: string
  owner: string
  ownerId?: string | null
  plannedEnd: string | null
  /** The pure estimate half — the derivation needs scores, steps and overrides, never the
   *  row's persistence fields, so callers can hand either shape. */
  estimate: Estimate | undefined
  bands: SizeBand[]
  timeEntries: Record<string, TimeEntry>
  profile: ResourceProfile | undefined
  commitments: Commitment[]
  allocations: Allocation[]
  today: string
  holidays?: ReadonlySet<string>
  /** E4's term. Absent means zero — E1D's baselines hold untouched. */
  meetings?: Meeting[]
}): Forecast {
  const estimated = args.estimate ? deriveEffort(args.estimate, args.bands).effortHours : null
  if (estimated === null) return { kind: 'no-estimate' }

  const remainingHours = Math.max(0, Math.round((estimated - hoursOn(args.timeEntries, args.issueId)) * 100) / 100)
  if (!args.plannedEnd) return { kind: 'unscheduled', remainingHours }

  const p = availabilityFor(
    args.owner,
    args.profile,
    args.commitments,
    args.allocations,
    args.today,
    args.plannedEnd,
    args.ownerId,
    args.holidays,
    args.meetings,
  )
  const availableHours = Math.max(0, p.remainingHours)
  const short = remainingHours > availableHours
  return {
    kind: short ? 'short' : 'achievable',
    remainingHours,
    availableHours,
    deltaHours: Math.round(Math.abs(remainingHours - availableHours) * 100) / 100,
    from: args.today,
    to: args.plannedEnd,
    basis: p.basis,
    pendingLeave: p.pendingLeave,
  }
}

/**
 * The verdict as one sentence — built in exactly one place so the Schedule tab and the
 * Portfolio line can never disagree about the same record's future.
 */
export function describeForecast(f: Forecast, owner: string): string {
  if (f.kind === 'no-estimate') {
    return 'Nothing estimated, so nothing to forecast against. Score the work on the Estimation tab and this becomes an answer.'
  }
  if (f.kind === 'unscheduled') {
    return `Needs ${f.remainingHours}h and has no due date — no target to test. Give it a planned end and this becomes an answer.`
  }
  const pending = f.pendingLeave.length
    ? ` ${f.pendingLeave.reduce((n, l) => n + l.days, 0)} requested leave day(s) overlap this window and are not counted until decided.`
    : ''
  const assumed =
    f.basis === 'default' ? ' Working pattern assumed — nobody has recorded one for this period.' : ''
  const head = `Needs ${f.remainingHours}h; ${owner || 'the owner'} has ${f.availableHours}h before ${formatIso(f.to)}`
  return f.kind === 'short'
    ? `${head} — short by ${f.deltaHours}h.${pending}${assumed}`
    : `${head} — achievable with ${f.deltaHours}h spare.${pending}${assumed}`
}
