import type { ApprovalDecision } from './approval'

/**
 * A change to what was contracted, as a record rather than a status.
 *
 * Until now a change request was a work-type string on an issue, and the only commercial trace
 * was `Sow.status` becoming `'Varied'` — which says a variation happened and nothing about what
 * it was or what it was worth. The value on the SOW was edited in place, so the moment somebody
 * agreed a change the original baseline stopped existing.
 *
 * ---------------------------------------------------------------------------
 * A change request is a DELTA. It never rewrites the baseline.
 *
 * `effortHours` and `value` here are *movements* — signed, so a descoping is a negative — and
 * `Sow.effortHours` and `Sow.value` stay exactly as they were signed, forever.
 *
 * That is the whole design, and the alternative is tempting and wrong. Adding the change to the
 * SOW's own figures gives the same current total in one field instead of two, and permanently
 * destroys the answer to the question a delivery review actually asks: *what did we agree, what
 * has been added since, and who approved each piece?* A baseline that moves is not a baseline.
 *
 * So the current commercial position is always `baseline + sum(approved changes)`, computed on
 * read — the same rule that keeps `duration` and `scheduleHealth` out of the schema.
 *
 * ---------------------------------------------------------------------------
 * Only an approved change counts
 *
 * Draft, Submitted, Rejected and Withdrawn contribute nothing to any total. A request that has
 * been asked for is not a change to the contract, and showing a proposed £40k inside the agreed
 * value is how a firm reports revenue it has not won.
 */

export const CHANGE_STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Withdrawn'] as const
export type ChangeStatus = (typeof CHANGE_STATUSES)[number]

/** The statuses whose figures count toward the contracted position. Exactly one. */
export const COUNTING_STATUSES: ChangeStatus[] = ['Approved']

export interface ChangeRequest {
  /** `cr-12`, minted from the durable workspace counter. */
  id: string
  /** The statement of work this varies. A change request without a contract is a conversation. */
  sowId: string
  /**
   * The issue this came from, when it came from one.
   *
   * Nullable and deliberately loose: a change is often raised in the register as an issue of
   * type "Change Request" long before anybody prices it, and forcing the link would mean either
   * inventing an issue or refusing to record a change that arrived by email.
   */
  issueId: string | null
  /** The client's own reference for the change, when they have one. */
  reference: string
  title: string
  status: ChangeStatus
  /**
   * The movement, signed. Negative is a descoping, which is a real thing that happens and which
   * an unsigned field would force somebody to record as a note.
   */
  effortHours: number
  value: number
  currency: string
  /** What changes. */
  scope: string
  /** Why it is being asked for — the part a review reads first. */
  reason: string
  /**
   * When the change takes effect, which is not when it was approved.
   *
   * A change agreed in August that applies from July is ordinary in consulting, and a position
   * computed "as at" a date needs to know which of the two to use.
   */
  effectiveFrom: string | null
  requestedBy: string
  requestedAt: string
  decidedBy: string | null
  decidedAt: string | null
  /** Why it was refused. Required on a rejection, as everywhere else here. */
  decisionNote: string | null
  deletedAt: string | null
}

export interface ChangeProblem {
  field: string
  message: string
}

/** What is wrong with a change request, or null. */
export function checkChange(
  c: Pick<ChangeRequest, 'title' | 'effortHours' | 'value' | 'reason'>,
): ChangeProblem | null {
  if (!c.title.trim()) return { field: 'title', message: 'A change request needs a title.' }
  if (!c.reason.trim()) {
    return { field: 'reason', message: 'A change request needs a reason — an unexplained variation is one nobody can defend to a client.' }
  }
  if (!Number.isFinite(c.effortHours)) return { field: 'effortHours', message: 'Effort must be a number of hours.' }
  if (!Number.isFinite(c.value)) return { field: 'value', message: 'Value must be a number.' }
  /*
   * A change that moves neither effort nor value is refused. It is a scope clarification, and
   * recording it as a variation inflates the count of changes a client is told they asked for.
   */
  if (c.effortHours === 0 && c.value === 0) {
    return { field: 'effortHours', message: 'A change request that moves neither effort nor value is a clarification, not a variation. Record it as a note on the issue.' }
  }
  return null
}

export interface Decider {
  name: string
  /** Whether this actor may decide at all. Resolved by the caller from `change.approve`. */
  mayApprove: boolean
}

/**
 * Why this decision cannot be made, or null.
 *
 * The asker may never be the decider — the same rule as approvals and timesheets, restated here
 * rather than imported for the same reason `lib/timesheet.ts` restates it: `ApprovalRule` gates
 * entry into an issue status for a work type, and a change request has neither.
 */
export function decideChangeProblem(
  change: ChangeRequest | null,
  decision: ApprovalDecision,
  note: string | undefined,
  actor: Decider,
): string | null {
  if (!change || change.deletedAt) return 'That change request no longer exists.'
  if (!actor.mayApprove) return 'Deciding a change request is not something this account may do.'
  if (change.status !== 'Submitted') {
    return change.status === 'Draft'
      ? 'That change request has not been submitted yet.'
      : `That change request is already ${change.status.toLowerCase()}.`
  }
  if (change.requestedBy.trim().toLowerCase() === actor.name.trim().toLowerCase()) {
    return 'A change request is decided by somebody other than the person who raised it. Approving your own variation is not a weaker control, it is the absence of one.'
  }
  if (decision === 'rejected' && !note?.trim()) {
    return 'Refusing a change needs a reason — the person has to know what to change or whether to stop.'
  }
  return null
}

export function statusAfterDecision(decision: ApprovalDecision): ChangeStatus {
  return decision === 'approved' ? 'Approved' : 'Rejected'
}

export interface ContractedPosition {
  /** What was signed, and what stays signed however many changes are agreed. */
  baselineHours: number
  baselineValue: number
  /** The sum of approved movements. Negative when descopings outweigh additions. */
  approvedHours: number
  approvedValue: number
  /** Baseline plus approved. What is contracted today. */
  contractedHours: number
  contractedValue: number
  /** Asked for and not yet decided — reported separately, never added in. */
  pendingHours: number
  pendingValue: number
  approvedCount: number
  pendingCount: number
  currency: string
}

/**
 * What is contracted, as at a date.
 *
 * `asAt` filters on `effectiveFrom`, so a position computed for June does not include a change
 * that takes effect in August — even if it was approved in May. A change with no effective date
 * counts from approval, because that is the only date it has.
 *
 * Pending movements are returned alongside and never inside the contracted figure. A delivery
 * lead needs to see both, and a client-facing total that quietly includes a request nobody has
 * agreed to is the single most damaging thing this module could do.
 */
/** The live priced record linked to an issue, if any. */
export function changeRequestFor(changes: ChangeRequest[], issueId: string): ChangeRequest | null {
  return changes.find((c) => !c.deletedAt && c.issueId === issueId) ?? null
}

export function contractedPosition(
  sow: { id: string; effortHours: number; value: number; currency: string },
  changes: ChangeRequest[],
  asAt?: string,
): ContractedPosition {
  const mine = changes.filter((c) => !c.deletedAt && c.sowId === sow.id)
  const inForce = (c: ChangeRequest) => {
    if (!asAt) return true
    const from = c.effectiveFrom ?? c.decidedAt?.slice(0, 10) ?? null
    return from === null || from <= asAt
  }

  const approved = mine.filter((c) => COUNTING_STATUSES.includes(c.status) && inForce(c))
  const pending = mine.filter((c) => c.status === 'Submitted')

  const sum = (xs: ChangeRequest[], f: (c: ChangeRequest) => number) =>
    Math.round(xs.reduce((t, c) => t + f(c), 0) * 100) / 100

  const approvedHours = sum(approved, (c) => c.effortHours)
  const approvedValue = sum(approved, (c) => c.value)

  return {
    baselineHours: sow.effortHours,
    baselineValue: sow.value,
    approvedHours,
    approvedValue,
    contractedHours: Math.round((sow.effortHours + approvedHours) * 100) / 100,
    contractedValue: Math.round((sow.value + approvedValue) * 100) / 100,
    pendingHours: sum(pending, (c) => c.effortHours),
    pendingValue: sum(pending, (c) => c.value),
    approvedCount: approved.length,
    pendingCount: pending.length,
    currency: sow.currency,
  }
}

/** How a contracted position reads. Leads with the movement, because that is what changed. */
export function describeContracted(p: ContractedPosition): string {
  if (p.approvedCount === 0 && p.pendingCount === 0) {
    return `${p.baselineHours}h · ${p.currency} ${p.baselineValue.toLocaleString()} as signed, with no changes recorded.`
  }
  const moved =
    p.approvedCount === 0
      ? 'nothing approved yet'
      : `${p.approvedCount} approved change${p.approvedCount === 1 ? '' : 's'} moving it by ${p.approvedHours >= 0 ? '+' : ''}${p.approvedHours}h and ${p.approvedValue >= 0 ? '+' : ''}${p.currency} ${p.approvedValue.toLocaleString()}`
  const waiting =
    p.pendingCount === 0
      ? ''
      : ` ${p.pendingCount} more ${p.pendingCount === 1 ? 'is' : 'are'} awaiting a decision, worth ${p.pendingValue >= 0 ? '+' : ''}${p.currency} ${p.pendingValue.toLocaleString()} — not included above.`
  return `Signed at ${p.baselineHours}h · ${p.currency} ${p.baselineValue.toLocaleString()}, with ${moved}. Contracted today: ${p.contractedHours}h · ${p.currency} ${p.contractedValue.toLocaleString()}.${waiting}`
}
