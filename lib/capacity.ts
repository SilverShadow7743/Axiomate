import { workingDaysBetween } from './dates'
import { availabilityFor, overlapWorkingDays } from './availability'
import { valueAt, type Version } from './versioning'

/**
 * How much time a person actually has, and what is already committed against it.
 *
 * ---------------------------------------------------------------------------
 * The subtraction is the point
 *
 * Gross capacity is easy and useless: hours per day multiplied by working days is a number
 * nobody can deliver against. What makes a capacity model worth having is what comes off it —
 * leave, public holidays, and the internal commitments a consulting firm runs on: recruitment,
 * proposals, line management, the practice meeting nobody counts. Until those are records, every
 * capacity figure is gross capacity wearing a different label, and the overallocation warning
 * fires on a number that was never true.
 *
 * So there are three entities here, not one:
 *
 *  - **Resource profile** — what a person's week looks like. Master data, on the operating
 *    model beside the directory, because it is a fact about employment rather than about
 *    delivery.
 *  - **Commitment** — leave, a holiday, or non-project work. A record with a period.
 *  - **Allocation** — that person, committed to a project, for a period, at a percentage.
 *
 * ---------------------------------------------------------------------------
 * What it does not do
 *
 * It does not schedule anybody. Nothing here decides who should do what; it answers whether
 * what has been decided is possible. The distinction matters because an optimiser that
 * reassigns work on capacity grounds would be making delivery decisions from a model that
 * cannot see skill, client relationship, or who was on the call last week.
 */

export interface ResourceProfile {
  /** The person, by directory id. */
  personId: string
  /** A full day for this person. Part-time is expressed here, not as a percentage elsewhere. */
  hoursPerDay: number
  /** Days in a normal week. Four for a compressed week; the calendar still counts five. */
  daysPerWeek: number
  /**
   * The share of that time the firm expects to sell.
   *
   * Not 100 for anybody: a consultant with no slack has no time to write a proposal, mentor
   * anyone, or absorb the day a client system falls over. A firm that sets this to 100 is
   * choosing to have every overrun become an overtime problem, and should do so deliberately.
   */
  billableTargetPct: number
  /**
   * Whether these numbers came from a person or from the shipped default.
   *
   * Every profile carries values from the day it exists, so `capacityFor` never has to guess —
   * and that is exactly why this field is needed. A stored row reading 7.5 hours over 5 days at
   * 80% that nobody has ever opened is still a default, and once it is stored it *looks* stated.
   * Utilisation computed from it is quoted in reviews as though somebody had confirmed the
   * working pattern behind it.
   *
   * So the numbers are always usable and their provenance travels with them, which is the rule
   * this codebase already keeps twice over: `lib/intake.ts` marks a classified field
   * `stated | guessed | default`, and `availabilityOf` answers `unknown` rather than `clear`
   * for somebody nobody has described.
   */
  source: 'stated' | 'default'
}

export function defaultProfile(personId: string): ResourceProfile {
  return { personId, hoursPerDay: 7.5, daysPerWeek: 5, billableTargetPct: 80, source: 'default' }
}

/**
 * The working pattern for one person **as at a date**, rather than as it stands today.
 *
 * This is the join between the effective-dated timeline and everything that computes capacity.
 * A version covering the date wins and is marked `stated`, because somebody recorded it and said
 * when it started. With no version covering the date, the stored profile is returned unchanged —
 * carrying its own `source`, which for every profile in this workspace today is `default`.
 *
 * ---------------------------------------------------------------------------
 * Why this returns a usable profile rather than null
 *
 * `valueAt` returns null for a date nothing was recorded for, and that honesty is the point of
 * the whole mechanism. But `capacityFor` has to answer with a number: it is what refuses an
 * overallocation, and "we do not know" is not an answer a refusal can be built on.
 *
 * So the null does not propagate — the PROVENANCE does. A figure computed from an assumed
 * working pattern is not wrong, it is a different claim from one computed from a confirmed
 * pattern, and `CapacityPosition.basis` carries that difference to wherever the number is shown.
 * That is the resolution the plan named in advance: a `basis` on the position rather than a null
 * nobody can act on.
 *
 * The alternative — every caller re-defaulting on its own — would produce exactly the same
 * numbers while losing the one thing that distinguishes them.
 */
export function profileAt(
  versions: Version[],
  profiles: Record<string, ResourceProfile>,
  personId: string,
  on: string,
): ResourceProfile | undefined {
  const stored = profiles[personId]
  // `Version<unknown>` in, because that is what the store holds — the value is typed by the
  // subject kind and this is the function that knows what this kind means.
  const version = valueAt(versions, WORKING_PATTERN, personId, on)
  if (!version) return stored

  const value = (version.value ?? {}) as WorkingPattern
  /*
   * The VERSION's own values, before any fallback.
   *
   * Merging first and then testing for absence does not work, and the first draft of this did
   * exactly that: `usable(value.hoursPerDay) ?? stored?.hoursPerDay` is never undefined when a
   * stored profile exists, so the guard below never fired and a version carrying `{ note: 'x' }`
   * came back marked `stated` with the stored default's numbers. A figure nobody recorded,
   * wearing the label that says somebody did.
   */
  const statedHours = usable(value.hoursPerDay)
  const statedDays = usable(value.daysPerWeek)
  // A version whose value carries nothing usable is not a working pattern. It resolves to what
  // was stored — keeping that profile's own `source` — rather than to a zero-hour day.
  if (statedHours === undefined && statedDays === undefined) return stored

  const base = stored ?? defaultProfile(personId)
  return {
    ...base,
    hoursPerDay: statedHours ?? base.hoursPerDay,
    daysPerWeek: statedDays ?? base.daysPerWeek,
    // Stated, because a version exists only if somebody recorded one with a reason.
    source: 'stated',
  }
}

/**
 * The same, for every person at once — the shape `planCheck` already takes.
 *
 * Deliberately returns `Record<personId, ResourceProfile>` so `planCheck`'s signature does not
 * change. That function is about plans, not about time, and pushing date-awareness into it would
 * put the timeline in a place nobody would look for it.
 */
export function profilesAt(
  versions: Version[],
  profiles: Record<string, ResourceProfile>,
  on: string,
): Record<string, ResourceProfile> {
  const ids = new Set([
    ...Object.keys(profiles),
    // Somebody with a recorded pattern and no stored profile still has a working pattern.
    ...versions.filter((v) => v.subjectKind === WORKING_PATTERN).map((v) => v.subjectId),
  ])
  const out: Record<string, ResourceProfile> = {}
  for (const id of ids) {
    const resolved = profileAt(versions, profiles, id, on)
    if (resolved) out[id] = resolved
  }
  return out
}

/** The subject kind versions of a working pattern are recorded under. */
export const WORKING_PATTERN = 'person.workingPattern'

interface WorkingPattern {
  hoursPerDay?: unknown
  daysPerWeek?: unknown
}

/** A positive finite number, or nothing. A version's value is opaque and may be anything. */
function usable(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

/**
 * How much of a set of profiles is actually known.
 *
 * For anything that reports utilisation. A figure derived from assumed working patterns is not
 * wrong, but it is a different claim from one derived from confirmed ones, and the difference
 * belongs beside the number rather than in a footnote nobody reads.
 */
export function profileConfidence(
  profiles: Record<string, ResourceProfile>,
  peopleCount: number,
): { stated: number; assumed: number; of: number; note: string } {
  const all = Object.values(profiles)
  const stated = all.filter((p) => p.source === 'stated').length
  const assumed = peopleCount - stated
  return {
    stated,
    assumed,
    of: peopleCount,
    note:
      assumed === 0
        ? 'Every working pattern has been confirmed.'
        : `Based on an assumed working pattern for ${assumed} of ${peopleCount} people.`,
  }
}

export const COMMITMENT_KINDS = ['Leave', 'Public holiday', 'Internal', 'Training'] as const
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number]

export interface Commitment {
  /** `commit-12`, minted from the workspace counter. */
  id: string
  person: string
  /** The directory id, resolved at write time; null when the name did not uniquely resolve. */
  personId?: string | null
  kind: CommitmentKind
  startDate: string
  endDate: string
  /**
   * Hours per working day this takes. A full day for leave; two hours a day for a standing
   * internal commitment. Expressed per day rather than as a total so a period can be extended
   * without recomputing anything.
   */
  hoursPerDay: number
  note: string
  /**
   * Leave only (E1): Requested | Approved | Returned. ABSENT MEANS APPROVED — every row
   * written before approval existed is history recorded under the old rules, and
   * `commitmentCounts` in ./availability is the one place that rule is interpreted.
   * Always null on non-Leave kinds, which are recorded facts with nothing to decide.
   */
  status?: 'Requested' | 'Approved' | 'Returned' | null
  /**
   * Leave only (E1): why, for the approver. PRIVATE — withheld server-side from every reader
   * except the person themselves and leave.approve holders (the rates posture; see
   * redactForReader). `note` above stays what it always was: a visible operational note.
   */
  reason?: string | null
  createdBy: string
  createdAt: string
  deletedAt: string | null
}

export interface Allocation {
  /** `alloc-12`, minted from the workspace counter. */
  id: string
  person: string
  /** The directory id, resolved at write time; null when the name did not uniquely resolve. */
  personId?: string | null
  /** The project node. Allocation is to a project, like a SOW attribution. */
  projectId: string
  startDate: string
  endDate: string
  /** Share of this person's available time, 1–100. */
  percentage: number
  note: string
  createdBy: string
  createdAt: string
  deletedAt: string | null
}

/* ================================================================== *
 * The arithmetic
 * ================================================================== */

export interface CapacityPosition {
  person: string
  from: string
  to: string
  workingDays: number
  /** Hours per day × working days. The number that means nothing on its own. */
  grossHours: number
  /** Leave, holidays and internal commitments. */
  committedHours: number
  /** What is left to sell. */
  availableHours: number
  /** What projects have already claimed. */
  allocatedHours: number
  /** Available minus allocated. Negative is the interesting case. */
  remainingHours: number
  overallocated: boolean
  /** Allocated as a share of available, so 130% reads as clearly as −40 hours. */
  utilisationPct: number | null
  /**
   * Where the working pattern behind these numbers came from.
   *
   * `stated` means somebody recorded a pattern covering this period and said when it started.
   * `default` means the shipped fallback was used — 7.5 hours over 5 days — and every figure
   * above is therefore an assumption wearing the costume of a measurement.
   *
   * It travels on the position rather than being looked up beside it, because the number and
   * its provenance get separated the moment they can be: the figure is quoted in a review and
   * the caveat stays on the screen it came from.
   */
  basis: 'stated' | 'default'
}

/**
 * Where one person stands over a window.
 *
 * Everything is recomputed from the records each time. A stored utilisation figure would be
 * wrong the moment somebody books a day off, and a capacity number that is quietly out of date
 * is worse than none — it is used to make a promise.
 */
/**
 * A consumer of the availability engine since E1 — the arithmetic lives in
 * `lib/availability.ts`, verbatim, and this returns exactly the shape it always returned.
 * Built field-by-field rather than spread so the engine's `pendingLeave` (a conflict for the
 * consumers that ask for it) never silently joins this position's JSON — the golden-value
 * equivalence the extraction was proven against depends on the shape holding still.
 */
export function capacityFor(
  person: string,
  profile: ResourceProfile | undefined,
  commitments: Commitment[],
  allocations: Allocation[],
  from: string,
  to: string,
  /** The person's directory id when known — id-joined rows match through a rename. */
  personId?: string | null,
  holidays?: ReadonlySet<string>,
): CapacityPosition {
  const p = availabilityFor(person, profile, commitments, allocations, from, to, personId, holidays)
  return {
    person,
    from,
    to,
    workingDays: p.workingDays,
    grossHours: p.grossHours,
    committedHours: p.committedHours,
    availableHours: p.availableHours,
    allocatedHours: p.allocatedHours,
    remainingHours: p.remainingHours,
    overallocated: p.overallocated,
    utilisationPct: p.utilisationPct,
    basis: p.basis,
  }
}

/**
 * How a position reads. One sentence, and it leads with the part that is wrong.
 *
 * A default basis is stated at the end rather than left off. The figures are the same either
 * way; what differs is whether anybody has confirmed the working week they rest on, and that is
 * the difference between a measurement and an assumption.
 */
export function describeCapacity(p: CapacityPosition): string {
  const assumed =
    p.basis === 'default'
      ? ' Working pattern assumed — nobody has recorded one covering this period.'
      : ''
  if (p.overallocated) {
    return `${p.person} is committed to ${p.allocatedHours}h against ${p.availableHours}h available — ${Math.abs(p.remainingHours)}h more than exists.${assumed}`
  }
  if (p.availableHours === 0) {
    return `${p.person} has no available time in this window: ${p.grossHours}h gross, all of it committed elsewhere.${assumed}`
  }
  return `${p.person} has ${p.remainingHours}h left of ${p.availableHours}h available (${Math.round(p.utilisationPct ?? 0)}% committed).${assumed}`
}

/* ================================================================== *
 * Can this plan be delivered?
 * ================================================================== */

export interface PlanCheck {
  /** Effort the estimates say the work needs. */
  plannedHours: number
  /** Capacity allocated to the project over the window. */
  allocatedHours: number
  /** Positive means the plan needs more than has been committed to it. */
  shortfallHours: number
  possible: boolean
  /** Work with no estimate, which the plan cannot see. */
  unestimatedCount: number
}

/**
 * Whether the people committed to a project can deliver what is planned.
 *
 * Two numbers that come from different places and are never otherwise compared: what the work
 * is estimated to need, and what has actually been set aside for it. A firm discovers the gap
 * between them in week six, and it was visible in week one.
 */
export function planCheck(
  plannedHours: number,
  unestimatedCount: number,
  allocations: Allocation[],
  profiles: Record<string, ResourceProfile>,
  peopleByName: Record<string, string>,
  projectId: string,
  from: string,
  to: string,
  holidays?: ReadonlySet<string>,
): PlanCheck {
  const allocatedHours = round(
    allocations
      .filter((a) => !a.deletedAt && a.projectId === projectId)
      .reduce((n, a) => {
        const personId = peopleByName[a.person.trim().toLowerCase()]
        const hoursPerDay = profiles[personId]?.hoursPerDay ?? defaultProfile('').hoursPerDay
        const days = overlapWorkingDays(a.startDate, a.endDate, from, to, holidays)
        return n + days * hoursPerDay * (a.percentage / 100)
      }, 0),
  )
  const shortfallHours = round(plannedHours - allocatedHours)
  return {
    plannedHours: round(plannedHours),
    allocatedHours,
    shortfallHours,
    possible: shortfallHours <= 0,
    unestimatedCount,
  }
}

export interface AllocationProblem {
  message: string
  field: 'percentage' | 'dates' | 'person'
}

/**
 * How the workspace treats an over-capacity allocation — the policy over `capacityFor`'s
 * judgement, never the judgement itself.
 *
 * `hard` refuses the commitment outright: nobody can be committed past their capacity, and
 * `acceptOverallocation` stops being an override. `advisory` is the original behaviour —
 * warn once, accept on an explicit second step, and record the acceptance as a deliberate
 * decision. Shipped hard: 100% enforcement is the product's stated rule, and the firm that
 * staffs through go-lives says so once, on the Configuration screen, rather than every
 * allocator deciding under deadline.
 */
export interface AllocationPolicy {
  cap: 'hard' | 'advisory'
}

export const DEFAULT_ALLOCATION_POLICY: AllocationPolicy = { cap: 'hard' }

/** What a stored cap must be to be applied: one of the two modes, nothing else. */
export function allocationPolicyProblem(patch: Partial<AllocationPolicy>): string | null {
  if (patch.cap === undefined) return null
  if (patch.cap !== 'hard' && patch.cap !== 'advisory') {
    return `The allocation cap is either “hard” or “advisory” — received ${JSON.stringify(patch.cap)}.`
  }
  return null
}

export function checkAllocation(a: Pick<Allocation, 'person' | 'startDate' | 'endDate' | 'percentage'>): AllocationProblem | null {
  if (!a.person.trim()) return { field: 'person', message: 'An allocation is of somebody.' }
  if (!a.startDate || !a.endDate) return { field: 'dates', message: 'An allocation needs a start and an end.' }
  if (a.endDate < a.startDate) return { field: 'dates', message: 'The end date falls before the start date.' }
  if (!Number.isFinite(a.percentage) || a.percentage <= 0 || a.percentage > 100) {
    return { field: 'percentage', message: 'A share of somebody’s time is between 1 and 100 per cent.' }
  }
  return null
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
