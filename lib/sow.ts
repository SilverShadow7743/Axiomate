import type { IssueEstimate, SizeBand } from './estimation'
import { deriveEffort } from './estimation'
import type { TimeEntry } from './time/time'
import { hoursOn, effortVariance } from './time/time'
import { contractedPosition, type ChangeRequest } from './changeRequest'
import type { Milestone } from './milestone'

/**
 * What has been contracted, and how much of it is left.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes, and the one it does not
 *
 * Until now `EngagementDetail.sowReference` was a text field: a string naming a document
 * nobody could compute anything against. Scope leakage was undetectable by construction —
 * there was no boundary for a request to be outside of, so the product could not do the one
 * thing a delivery firm most needs it for.
 *
 * A SOW here carries a baseline: agreed effort and agreed value. Against that, two figures are
 * now real rather than notional, because both of their sources exist — *planned* consumption
 * from the estimates on the work, and *actual* consumption from recorded hours. The difference
 * between them and the baseline is scope position, and it is arithmetic rather than opinion.
 *
 * What this cannot do is read the scope statement and decide whether a particular request is
 * inside it. That is a judgement, and pretending otherwise would be the worst kind of feature:
 * a machine answer to a commercial question, wrong occasionally and confidently. What the
 * product can do — and now does — is make the *consequence* visible: this SOW is 40 hours over
 * its agreed effort, this project is attached to no SOW at all, and here is the change-request
 * path if the answer is that the work is genuinely extra.
 */

export const SOW_STATUSES = ['Draft', 'Signed', 'Active', 'Varied', 'Closed'] as const
export type SowStatus = (typeof SOW_STATUSES)[number]

/** Statuses under which work may legitimately be delivered against it. */
export const LIVE_SOW_STATUSES: SowStatus[] = ['Signed', 'Active', 'Varied']

export interface Sow {
  /** `sow-12`, minted from the workspace counter. */
  id: string
  /** The engagement node it belongs to. A SOW is always under one engagement. */
  engagementId: string
  /** The client's own reference, e.g. "SOW-2026-014". */
  reference: string
  title: string
  status: SowStatus
  signedOn: string | null
  startDate: string | null
  endDate: string | null

  /**
   * The agreed baseline.
   *
   * Effort and value both, because they answer different questions and move independently: a
   * fixed-price SOW can be on budget and badly over on effort, which is precisely the case a
   * firm needs to see before the next one is priced the same way.
   */
  effortHours: number
  value: number
  currency: string

  /** What was agreed, in the words of the document. Read by people, not by code. */
  scope: string
  exclusions: string
  acceptanceCriteria: string

  createdBy: string
  createdAt: string
  updatedBy: string | null
  updatedAt: string | null
  deletedAt: string | null
}

export interface SowProblem {
  field: 'reference' | 'title' | 'effortHours' | 'value' | 'dates'
  message: string
}

export function checkSow(s: Pick<Sow, 'reference' | 'title' | 'effortHours' | 'value' | 'startDate' | 'endDate'>): SowProblem | null {
  if (!s.reference.trim()) return { field: 'reference', message: 'A statement of work needs its reference — the number on the document.' }
  if (!s.title.trim()) return { field: 'title', message: 'A statement of work needs a title.' }
  if (!Number.isFinite(s.effortHours) || s.effortHours < 0) {
    return { field: 'effortHours', message: 'Agreed effort cannot be negative.' }
  }
  if (!Number.isFinite(s.value) || s.value < 0) {
    return { field: 'value', message: 'Agreed value cannot be negative.' }
  }
  if (s.startDate && s.endDate && s.endDate < s.startDate) {
    return { field: 'dates', message: 'The end date falls before the start date.' }
  }
  return null
}

/* ================================================================== *
 * Consumption
 * ================================================================== */

export interface SowPosition {
  sowId: string
  /** Work attributed to this SOW — every issue under a project that names it. */
  issueIds: string[]
  /**
   * What was signed, and what stays signed however many changes are approved.
   *
   * Kept beside the contracted figure rather than replaced by it, because "what did we
   * originally agree" is a question a delivery review asks and an overwritten field cannot
   * answer. See `ChangeRequest`.
   */
  baselineHours: number
  /** Approved movements. Signed — negative when descopings outweigh additions. */
  approvedChangeHours: number
  /**
   * Baseline plus approved changes: what is actually contracted today.
   *
   * **Consumption is measured against this, not against the baseline.** Measuring against a
   * figure that has been formally varied reports an overrun on work somebody agreed to pay
   * for — an alarm that fires when nothing is wrong, and a firm that sees two of those stops
   * reading the third.
   */
  contractedHours: number
  /** Asked for and not yet decided. Reported, never counted. */
  pendingChangeHours: number
  /** Sum of the estimates on that work. What the firm currently thinks it will take. */
  plannedHours: number
  /** Sum of the hours recorded against it. What it has taken so far. */
  actualHours: number
  /** Baseline minus actual. Negative is over. */
  remainingHours: number
  /** How much of the baseline the actuals have used, as a percentage. Null when there is no baseline. */
  consumedPct: number | null
  /** Planned against baseline — the forecast overrun, visible before the hours are spent. */
  forecastPct: number | null
  /** True when the plan already exceeds what was agreed, whatever has been spent. */
  forecastOverrun: boolean
  /** Work with an estimate is the only work the plan can see. Stated, so the figure is readable. */
  estimatedCount: number
  unestimatedCount: number
  /**
   * Signed sum of `effortVariance` across issues whose estimate has been baselined. Positive is
   * a net overrun. An issue not yet baselined contributes nothing — the same "an overrun against
   * a draft is not yet news" rule `effortVariance` itself states, applied here rather than
   * reinvented.
   */
  varianceHours: number
  /** How many issues contributed to `varianceHours` — the exclusion made visible, the same role
   *  `estimatedCount`/`unestimatedCount` already play for `plannedHours`. */
  varianceIssueCount: number
}

/**
 * Where a SOW stands.
 *
 * `plannedHours` counts only work that has been estimated, and `unestimatedCount` says how much
 * work it could not see. A forecast that silently treats unestimated work as zero is the
 * reason a project looks fine until the week it does not.
 */
/**
 * Effort and variance over a set of issues — the loop `sowPosition` and `milestoneEffortPosition`
 * both need, factored out so a milestone's narrower read cannot silently drift from what the
 * SOW-level figure it is a slice of already does.
 */
function effortAndVariance(
  issueIds: string[],
  estimates: Record<string, IssueEstimate>,
  timeEntries: Record<string, TimeEntry>,
  bands: SizeBand[],
) {
  let plannedHours = 0
  let estimatedCount = 0
  let unestimatedCount = 0
  let varianceHours = 0
  let varianceIssueCount = 0

  for (const id of issueIds) {
    const estimate = estimates[id]
    const hours = estimate ? deriveEffort(estimate, bands).effortHours : null
    if (hours === null) {
      unestimatedCount += 1
      continue
    }
    estimatedCount += 1
    plannedHours += hours

    if (estimate!.baselinedAt) {
      const v = effortVariance(timeEntries, id, estimate, bands)
      if (v.varianceHours !== null) {
        varianceHours += v.varianceHours
        varianceIssueCount += 1
      }
    }
  }

  const actualHours = issueIds.reduce((n, id) => n + hoursOn(timeEntries, id), 0)

  return { plannedHours, estimatedCount, unestimatedCount, varianceHours, varianceIssueCount, actualHours }
}

export function sowPosition(
  sow: Sow,
  issueIds: string[],
  estimates: Record<string, IssueEstimate>,
  timeEntries: Record<string, TimeEntry>,
  bands: SizeBand[],
  /**
   * Every change request in the workspace; this filters to its own.
   *
   * Defaulted to none so a caller that has not been updated still compiles AND still gets the
   * old answer rather than a wrong one — with no changes recorded, contracted equals baseline
   * and every figure below is exactly what it was before this parameter existed.
   */
  changes: ChangeRequest[] = [],
): SowPosition {
  const { plannedHours, estimatedCount, unestimatedCount, varianceHours, varianceIssueCount, actualHours } =
    effortAndVariance(issueIds, estimates, timeEntries, bands)
  const baselineHours = sow.effortHours

  /*
   * The contracted figure is what everything below is measured against.
   *
   * This read `sow.effortHours` directly, and that was right until change requests existed:
   * with a formally approved variation on record, consuming against the original number
   * reports an overrun on work the client has agreed to pay for.
   */
  const contracted = contractedPosition(sow, changes)
  const contractedHours = contracted.contractedHours

  return {
    sowId: sow.id,
    issueIds,
    baselineHours,
    approvedChangeHours: contracted.approvedHours,
    contractedHours,
    pendingChangeHours: contracted.pendingHours,
    plannedHours: round(plannedHours),
    actualHours: round(actualHours),
    remainingHours: round(contractedHours - actualHours),
    consumedPct: contractedHours > 0 ? round((actualHours / contractedHours) * 100) : null,
    forecastPct: contractedHours > 0 ? round((plannedHours / contractedHours) * 100) : null,
    forecastOverrun: contractedHours > 0 && plannedHours > contractedHours,
    estimatedCount,
    unestimatedCount,
    varianceHours: round(varianceHours),
    varianceIssueCount,
  }
}

/**
 * Where a single milestone's EFFORT stands — a narrower read of exactly what `sowPosition`
 * already sums, filtered to the issues attributed to this one milestone rather than to the
 * whole SOW. No baseline, contracted or pending-change figures here: those are the SOW's own
 * contractual facts (and, separately, a milestone's `percentage`/`amount` price it) — this only
 * reports what was spent delivering the work attributed to it. See
 * docs/plans/2026-09-20-milestone-issue-attribution-design.md.
 *
 * Named `MilestoneEffortPosition`, not `MilestonePosition` — that name is already taken, by a
 * genuinely different thing: `lib/milestone.ts`'s `MilestonePosition` is a SOW-wide rollup of
 * every milestone's delivery/acceptance/billing state (`delivered`, `accepted`, `billableValue`,
 * …), computed across the whole schedule. This is effort for exactly one milestone. A design
 * doc proposed the collision without checking; caught at the first `npx tsc --noEmit` this
 * session ran after writing it, not left for a later build to catch.
 */
export interface MilestoneEffortPosition {
  milestoneId: string
  /** Issues attributed to this milestone specifically — a subset of the SOW's own `issueIds`. */
  issueIds: string[]
  plannedHours: number
  actualHours: number
  estimatedCount: number
  unestimatedCount: number
  /** Same rule as `SowPosition.varianceHours`: signed, and only from baselined estimates. */
  varianceHours: number
  varianceIssueCount: number
}

/**
 * `issueIds` is the caller's own pre-filtered list (every issue with `milestoneId` equal to
 * this one) — this function does not query `state.issues` itself, the same no-I-O discipline
 * `sowPosition` already holds to.
 */
export function milestoneEffortPosition(
  milestone: Milestone,
  issueIds: string[],
  estimates: Record<string, IssueEstimate>,
  timeEntries: Record<string, TimeEntry>,
  bands: SizeBand[],
): MilestoneEffortPosition {
  const { plannedHours, estimatedCount, unestimatedCount, varianceHours, varianceIssueCount, actualHours } =
    effortAndVariance(issueIds, estimates, timeEntries, bands)

  return {
    milestoneId: milestone.id,
    issueIds,
    plannedHours: round(plannedHours),
    actualHours: round(actualHours),
    estimatedCount,
    unestimatedCount,
    varianceHours: round(varianceHours),
    varianceIssueCount,
  }
}

/**
 * How a position reads, in one sentence.
 *
 * Written here rather than in the component because two screens show it and a figure that
 * reads differently in two places is a figure nobody trusts.
 */
export function describePosition(p: SowPosition): string {
  if (!p.contractedHours) {
    return `No agreed effort recorded, so consumption cannot be measured — ${p.actualHours}h spent so far.`
  }
  /*
   * Against the CONTRACTED figure, saying so whenever the two differ. A sentence reading
   * "320h of 400h" when 80 of those hours were formally added invites somebody to go looking
   * for an overrun that was agreed months ago.
   */
  const varied =
    p.approvedChangeHours === 0
      ? ''
      : ` (${p.baselineHours}h signed ${p.approvedChangeHours > 0 ? '+' : '−'} ${Math.abs(p.approvedChangeHours)}h approved)`
  const spent = `${p.actualHours}h of ${p.contractedHours}h used${varied} (${Math.round(p.consumedPct ?? 0)}%)`
  if (p.forecastOverrun) {
    return `${spent}, and the current plan needs ${p.plannedHours}h — ${round(p.plannedHours - p.baselineHours)}h more than was agreed.`
  }
  if (p.unestimatedCount) {
    return `${spent}. The plan covers ${p.estimatedCount} of ${p.estimatedCount + p.unestimatedCount} records; the rest are unestimated and invisible to the forecast.`
  }
  return `${spent}, with the plan inside the baseline.`
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
