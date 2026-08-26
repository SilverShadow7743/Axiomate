import { addWorkingDays, workingDaysBetween } from './dates'

/**
 * Estimation — effort and timeline, kept apart.
 *
 * The distinction this module exists to enforce: **effort is how much work there is, timeline
 * is how long it takes to do it.** Forty hours is forty hours whether one person spends five
 * days on it or two people spend two and a half. Systems that conflate them produce the
 * classic failure — adding people to a late task and expecting the date to move — so effort
 * and duration are computed by different functions here, from different inputs, and are never
 * derived from each other without capacity in between.
 *
 * ---------------------------------------------------------------------------
 * What is honest here, and what is not yet possible
 *
 * The spec asks for timeline to account for resource availability, existing workload, working
 * calendars, holidays and actual recorded hours. None of those domains exist in this
 * application — Resources & Capacity and Time Management are both absent, which the capability
 * matrix already records. Rather than approximate them and present the result as a
 * calculation, this module:
 *
 *  - takes **capacity as an explicit input** (hours per day × resources × allocation), so the
 *    number is something a person stated rather than something the system inferred from a
 *    resource model it does not have;
 *  - treats **waiting time as entered**, not derived, for the same reason;
 *  - computes working days by skipping weekends only, and says so — there is no holiday
 *    calendar to consult;
 *  - offers **no actual-effort figure at all**, because nothing records hours. A variance
 *    against an unrecorded actual would be arithmetic on a blank.
 *
 * Each of those is surfaced in the UI as a stated assumption rather than left to be inferred
 * from a suspiciously round number.
 */

/* ================================================================== *
 * Complexity
 * ================================================================== */

/**
 * The five dimensions work is assessed on.
 *
 * Held as data rather than five named fields so the form, the totals and the stored record
 * cannot disagree about what the parameters are — the same reason the tier vocabulary is one
 * list. The descriptions are what a scorer actually reads, so they live here beside the keys.
 */
export const COMPLEXITY_PARAMETERS = [
  {
    key: 'business',
    label: 'Business',
    what: 'Business scope, process complexity, rules, stakeholders and functional impact.',
  },
  {
    key: 'technical',
    label: 'Technical',
    what: 'Development, customisation, architecture, technical dependencies and solution complexity.',
  },
  {
    key: 'integration',
    label: 'Integration',
    what: 'APIs, interfaces, external systems, dependencies and integration complexity.',
  },
  {
    key: 'testing',
    label: 'Testing',
    what: 'Unit, functional and regression testing, UAT, scenarios and validation effort.',
  },
  {
    key: 'data',
    label: 'Data',
    what: 'Migration, correction, transformation, validation, volume and data dependencies.',
  },
] as const

export type ComplexityKey = (typeof COMPLEXITY_PARAMETERS)[number]['key']

/**
 * `null` is a dimension nobody has scored yet. `0` is a real score — "None: no meaningful
 * effort in this dimension" — and the two must not collapse into each other, which is why
 * unscored is not represented as a number at all.
 */
export type ComplexityScores = Record<ComplexityKey, number | null>

/** 0–5, and what each means when somebody is choosing. Source: the Axiomate Estimation Model. */
export const COMPLEXITY_LEVELS = [
  { score: 0, label: 'None' },
  { score: 1, label: 'Very low' },
  { score: 2, label: 'Low' },
  { score: 3, label: 'Moderate' },
  { score: 4, label: 'High' },
  { score: 5, label: 'Very high' },
] as const

export const MIN_COMPLEXITY = 0 // all 0s
export const MAX_COMPLEXITY = COMPLEXITY_PARAMETERS.length * 5 // all 5s — 25

export function totalComplexity(s: ComplexityScores): number {
  return COMPLEXITY_PARAMETERS.reduce((sum, p) => sum + (s[p.key] ?? 0), 0)
}

export function emptyScores(): ComplexityScores {
  return { business: null, technical: null, integration: null, testing: null, data: null }
}

/** Whether every parameter has been given a value. A partial score is not a score. */
export function isScored(s: ComplexityScores): boolean {
  return COMPLEXITY_PARAMETERS.every((p) => s[p.key] !== null)
}

/**
 * The raw total (0–25) normalised to the 0–15 band the Axiomate model's size thresholds are
 * actually written against. `NORMALISED_MAX` is a fixed target of that model, not derived from
 * the parameter count — five dimensions today does not mean the band width should follow if a
 * sixth were ever added.
 *
 *     Normalised Score = ROUND( (Raw Total / 25) × 15 )
 *
 * Never compare a raw total against these thresholds directly, and never compare a normalised
 * score against `MAX_COMPLEXITY` — the two scales look similar enough in size to swap by
 * accident, and the Axiomate model's own training material calls this out explicitly: "never
 * mix a 25-point raw score with 15-point thresholds."
 */
export const NORMALISED_MAX = 15

export function normaliseScore(raw: number): number {
  return Math.round((raw / MAX_COMPLEXITY) * NORMALISED_MAX)
}

/* ================================================================== *
 * T-shirt sizing — configuration, never hardcoded
 * ================================================================== */

export const TSHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'] as const
export type TshirtSize = (typeof TSHIRT_SIZES)[number]

/**
 * What a size means in this organisation.
 *
 * Deliberately configuration: story points and hours per size are how a firm calibrates its
 * own delivery, and two firms with the same complexity model will disagree about what an L
 * costs. Hardcoding them on the issue screen — which the requirement explicitly rules out —
 * would bake one firm's calibration into everyone's.
 */
export interface SizeBand {
  size: TshirtSize
  /** Inclusive complexity range that maps to this size. */
  minScore: number
  maxScore: number
  storyPoints: number
  effortHours: number
}

/**
 * The shipped calibration, matching the Axiomate Estimation Model's own threshold table.
 *
 * `minScore`/`maxScore` are on the *normalised* 0–15 scale (`normaliseScore`'s output), not the
 * raw 0–25 total — see `deriveEffort`, which normalises before calling `bandForScore`. XS starts
 * at 0: the model has no separate tier below it. XXL and 3XL are not reachable through scoring
 * at all — a normalised score is capped at exactly 15 (25/25×15) by construction — so their
 * ranges here are nominal, present only so they stay selectable via `Estimate.sizeOverride` and
 * so `bandProblems` has a defined, gap-free upper region to report on. The model's own guidance
 * for anything that would otherwise land above XL is to decompose the work, not to score it into
 * XXL/3XL directly.
 */
export const DEFAULT_SIZE_BANDS: SizeBand[] = [
  { size: 'XS', minScore: 0, maxScore: 3, storyPoints: 1, effortHours: 4 },
  { size: 'S', minScore: 4, maxScore: 6, storyPoints: 2, effortHours: 8 },
  { size: 'M', minScore: 7, maxScore: 9, storyPoints: 3, effortHours: 16 },
  { size: 'L', minScore: 10, maxScore: 12, storyPoints: 5, effortHours: 40 },
  { size: 'XL', minScore: 13, maxScore: 15, storyPoints: 8, effortHours: 80 },
  { size: 'XXL', minScore: 16, maxScore: 20, storyPoints: 13, effortHours: 160 },
  { size: '3XL', minScore: 21, maxScore: 25, storyPoints: 21, effortHours: 320 },
]

/** The band a score falls in, or null when the bands do not cover it. */
export function bandForScore(bands: SizeBand[], score: number): SizeBand | null {
  return bands.find((b) => score >= b.minScore && score <= b.maxScore) ?? null
}

/**
 * Gaps and overlaps in a calibration, reported rather than silently tolerated.
 *
 * A gap means some scores produce no size; an overlap means a score produces two, and which
 * one wins becomes an accident of array order. Both are configuration mistakes that would
 * otherwise only show up as a confusing estimate weeks later.
 *
 * Checked against `0`–`NORMALISED_MAX`, not `MIN_COMPLEXITY`–`MAX_COMPLEXITY` — `bandForScore`
 * is always called with a normalised score (see `deriveEffort`), so that is the range a
 * calibration actually needs to cover. Checking against the raw 0–25 range instead would demand
 * bands reach past 15, which nothing can ever score into.
 */
export function bandProblems(bands: SizeBand[]): string[] {
  const problems: string[] = []
  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore)
  for (const b of sorted) {
    if (b.minScore > b.maxScore) problems.push(`${b.size}: lowest score is above its highest.`)
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.minScore <= prev.maxScore) {
      problems.push(`${prev.size} and ${cur.size} overlap at ${cur.minScore}.`)
    } else if (cur.minScore > prev.maxScore + 1) {
      problems.push(`No size covers ${prev.maxScore + 1}–${cur.minScore - 1}.`)
    }
  }
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first && first.minScore > 0) problems.push(`No size covers 0–${first.minScore - 1}.`)
  if (last && last.maxScore < NORMALISED_MAX) problems.push(`No size covers ${last.maxScore + 1}–${NORMALISED_MAX}.`)
  return problems
}

/* ================================================================== *
 * The estimate
 * ================================================================== */

export const CONFIDENCE_LEVELS = ['High', 'Medium', 'Low'] as const
export type Confidence = (typeof CONFIDENCE_LEVELS)[number]

/**
 * One phase of the work, with what it waits for.
 *
 * `dependsOn` holds the ids of steps that must finish first, which is what makes a timeline
 * something other than a sum. Two steps with the same dependency run together; a step with
 * none starts immediately.
 */
export interface EstimateStep {
  id: string
  activity: string
  effortHours: number
  dependsOn: string[]
}

/**
 * Capacity, stated rather than derived.
 *
 * There is no resource model to read allocation or availability from, so these are inputs. The
 * form says as much: a capacity figure that looks computed but was typed is the kind of number
 * people stop questioning.
 */
export interface Capacity {
  hoursPerDay: number
  resources: number
  allocationPct: number
}

export interface Estimate {
  scores: ComplexityScores
  /** Set when somebody overrides the size the score implies. Null means "use the score". */
  sizeOverride: TshirtSize | null
  /** Set when somebody overrides the hours the size implies. Null means "use the size". */
  approvedEffortHours: number | null
  capacity: Capacity
  plannedStart: string
  /** Waiting on a client, an environment, an approval. Entered, never inferred. */
  waitDays: number
  steps: EstimateStep[]
  confidence: Confidence
  assumptions: string
  notes: string
}

export function emptyEstimate(today: string): Estimate {
  return {
    scores: emptyScores(),
    sizeOverride: null,
    approvedEffortHours: null,
    capacity: { hoursPerDay: 8, resources: 1, allocationPct: 100 },
    plannedStart: today,
    waitDays: 0,
    steps: [],
    confidence: 'Medium',
    assumptions: '',
    notes: '',
  }
}

/* ================================================================== *
 * Derivation
 * ================================================================== */

export interface EffortResult {
  /** Business + Technical + Integration + Testing + Data, unweighted — 0 to `MAX_COMPLEXITY`. */
  rawScore: number
  /** `normaliseScore(rawScore)` — what `band` is actually matched against, 0 to `NORMALISED_MAX`. */
  score: number
  scored: boolean
  band: SizeBand | null
  size: TshirtSize | null
  /** True when the size was chosen by a person rather than by the score. */
  sizeOverridden: boolean
  storyPoints: number | null
  /** What the configuration implies. */
  suggestedHours: number | null
  /** What will actually be used — the override if there is one. */
  effortHours: number | null
  effortOverridden: boolean
  /** Effort broken down by step, when a breakdown exists; it takes precedence. */
  breakdownHours: number | null
}

export function deriveEffort(e: Estimate, bands: SizeBand[]): EffortResult {
  const rawScore = totalComplexity(e.scores)
  const score = normaliseScore(rawScore)
  const scored = isScored(e.scores)
  const scoreBand = scored ? bandForScore(bands, score) : null
  const band = e.sizeOverride ? (bands.find((b) => b.size === e.sizeOverride) ?? scoreBand) : scoreBand
  const suggested = band?.effortHours ?? null
  const breakdownHours = e.steps.length
    ? e.steps.reduce((sum, s) => sum + (Number(s.effortHours) || 0), 0)
    : null

  // Precedence, most specific first: an explicit approval beats a breakdown, and a breakdown
  // beats the size's nominal hours. Somebody who has itemised the work knows more than the
  // band does, and somebody who has approved a number knows more than either.
  const effortHours = e.approvedEffortHours ?? breakdownHours ?? suggested

  return {
    rawScore,
    score,
    scored,
    band,
    size: band?.size ?? null,
    sizeOverridden: Boolean(e.sizeOverride),
    storyPoints: band?.storyPoints ?? null,
    suggestedHours: suggested,
    effortHours,
    effortOverridden: e.approvedEffortHours !== null,
    breakdownHours,
  }
}

/** Hours a day the assigned people can actually give this, per the stated capacity. */
export function dailyCapacity(c: Capacity): number {
  return (Number(c.hoursPerDay) || 0) * (Number(c.resources) || 0) * ((Number(c.allocationPct) || 0) / 100)
}

export interface TimelineResult {
  /** Person-hours of work. */
  effortHours: number | null
  dailyCapacity: number
  /** Effort ÷ capacity — what the work would take if nothing constrained the order. */
  capacityDays: number | null
  /**
   * The longest dependency chain, in days at the same capacity.
   *
   * This is the floor a timeline cannot go below by adding people: steps that must follow one
   * another take as long as they take. Where there is no breakdown there is no known chain,
   * and this is null rather than zero — an unknown constraint is not an absent one.
   */
  criticalPathDays: number | null
  /** The binding one: whichever of the two is longer. */
  workingDays: number | null
  waitDays: number
  start: string
  /** Working days from start, plus waiting time. */
  finish: string | null
  /** True when dependencies, not capacity, decide the duration. */
  dependencyBound: boolean
}

/**
 * The longest chain through the breakdown, in hours.
 *
 * Iterative rather than recursive so a cycle cannot blow the stack: each pass relaxes the
 * finish time of every step, and a run of passes equal to the step count is enough to settle
 * an acyclic graph. If it has not settled by then the steps contain a cycle, and the value is
 * whatever the last pass produced — reported by the caller rather than thrown, because a
 * half-built breakdown is a normal thing to be looking at.
 */
export function criticalPathHours(steps: EstimateStep[]): number {
  if (!steps.length) return 0
  const byId = new Map(steps.map((s) => [s.id, s]))
  const finish = new Map<string, number>(steps.map((s) => [s.id, Number(s.effortHours) || 0]))
  for (let pass = 0; pass < steps.length; pass++) {
    let changed = false
    for (const s of steps) {
      const deps = s.dependsOn.filter((d) => byId.has(d))
      const earliest = deps.length ? Math.max(...deps.map((d) => finish.get(d) ?? 0)) : 0
      const next = earliest + (Number(s.effortHours) || 0)
      if (next > (finish.get(s.id) ?? 0)) {
        finish.set(s.id, next)
        changed = true
      }
    }
    if (!changed) break
  }
  return Math.max(0, ...finish.values())
}

export function deriveTimeline(e: Estimate, effort: EffortResult): TimelineResult {
  const cap = dailyCapacity(e.capacity)
  const hours = effort.effortHours
  const capacityDays = hours !== null && cap > 0 ? hours / cap : null

  /**
   * The chain is converted at **one person's** capacity, not the whole team's.
   *
   * Converting it at team capacity was the first thing this did, and it was wrong in the way
   * the requirement specifically warns about: four people made a strictly sequential
   * fifty-six-hour chain finish in 1.75 days, so the tool would have promised a date shorter
   * than the longest path through the work. Adding people cannot make Analysis finish before
   * Analysis is done.
   *
   * One person per step is an assumption, and a conservative one — two developers really can
   * halve a twenty-hour build. It is the safer direction to be wrong in, and it is stated on
   * screen rather than buried here, so an estimator who knows a step is splittable can say so
   * by breaking it into two steps that do not depend on each other.
   */
  const soloCapacity = (Number(e.capacity.hoursPerDay) || 0) * ((Number(e.capacity.allocationPct) || 0) / 100)
  const chainHours = e.steps.length ? criticalPathHours(e.steps) : null
  const criticalPathDays = chainHours !== null && soloCapacity > 0 ? chainHours / soloCapacity : null

  const workingDays =
    capacityDays === null
      ? null
      : criticalPathDays === null
        ? capacityDays
        : Math.max(capacityDays, criticalPathDays)

  const dependencyBound =
    capacityDays !== null && criticalPathDays !== null && criticalPathDays > capacityDays

  const wait = Number(e.waitDays) || 0
  const finish =
    workingDays === null || !e.plannedStart
      ? null
      : // Rounded up: half a working day of remaining work still occupies a day on a calendar.
        addWorkingDays(e.plannedStart, Math.max(0, Math.ceil(workingDays) + wait - 1))

  return {
    effortHours: hours,
    dailyCapacity: cap,
    capacityDays,
    criticalPathDays,
    workingDays,
    waitDays: wait,
    start: e.plannedStart,
    finish,
    dependencyBound,
  }
}

/**
 * Working days actually elapsed against a plan, once a record is finished.
 *
 * The only half of "estimated versus actual" this system can honestly produce: completion
 * dates are recorded, hours are not. Effort variance is deliberately absent — see the module
 * comment.
 */
export function scheduleVarianceDays(estimatedFinish: string | null, actualEnd: string | null): number | null {
  if (!estimatedFinish || !actualEnd) return null
  return workingDaysBetween(estimatedFinish, actualEnd)
}

/* ================================================================== *
 * Storage and revisions
 * ================================================================== */

/** A compact picture of both halves, for recording what a revision changed. */
export interface EstimateSummary {
  score: number
  size: TshirtSize | null
  storyPoints: number | null
  effortHours: number | null
  workingDays: number | null
  finish: string | null
  confidence: Confidence
}

export function summarise(e: Estimate, bands: SizeBand[]): EstimateSummary {
  const eff = deriveEffort(e, bands)
  const t = deriveTimeline(e, eff)
  return {
    score: eff.score,
    size: eff.size,
    storyPoints: eff.storyPoints,
    effortHours: eff.effortHours,
    workingDays: t.workingDays === null ? null : Math.ceil(t.workingDays),
    finish: t.finish,
    confidence: e.confidence,
  }
}

/**
 * One issue's estimate.
 *
 * `baselinedAt` is what makes a revision a revision: before it is set the estimate is being
 * drafted and edits are just edits; after it, the number has been agreed with somebody and
 * changing it is an event that owes an explanation.
 */
export interface IssueEstimate extends Estimate {
  issueId: string
  baselinedAt: string | null
  baselinedBy: string | null
  updatedAt: string
  updatedBy: string
}

/**
 * What changed to an agreed estimate, and why.
 *
 * Both halves are recorded because they move independently: scope can grow without the date
 * slipping if people are added, and the date can slip with no change in effort at all when a
 * client goes quiet. A revision log that captured only hours would make the second case look
 * like nothing happened.
 */
export interface EstimateRevision {
  id: string
  issueId: string
  at: string
  by: string
  reason: string
  from: EstimateSummary
  to: EstimateSummary
}

/** Did anything a reader would care about actually change? */
export function summariesDiffer(a: EstimateSummary, b: EstimateSummary): boolean {
  return (
    a.score !== b.score ||
    a.size !== b.size ||
    a.effortHours !== b.effortHours ||
    a.workingDays !== b.workingDays ||
    a.finish !== b.finish ||
    a.confidence !== b.confidence
  )
}
