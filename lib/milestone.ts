/**
 * What was promised, when it lands, and what it is worth.
 *
 * Pure — no clock, no I/O. Every function is given the date it should reason about.
 *
 * ---------------------------------------------------------------------------
 * Delivery and acceptance are two axes, not one lane
 *
 * The obvious model is a single status running Planned → Delivered → Accepted, and it is wrong
 * for the way this firm actually sells. Two of its own pricing models say so:
 *
 *     Fixed fee — 4 milestones (25/35/25/15)
 *     Fixed fee — 50% upfront, 50% credited vs implementation
 *
 * The second bills half the fee before anything is delivered. A single lane cannot hold that
 * without either lying about delivery or refusing the invoice, and collapsing the two also
 * destroys the question the audit says the product cannot answer — *"delivered but not
 * accepted"*. That is a question about two axes by construction: it is exactly the pair
 * (delivery = Delivered, acceptance = Pending).
 *
 * So there is a delivery state with its own date and actor, an acceptance state with its own
 * date and actor, and a separate answer to *when this becomes billable*.
 *
 * ---------------------------------------------------------------------------
 * Not every statement of work has milestones, and that is not a gap
 *
 * A monthly retainer — six of this firm's services are sold that way — is billed by the month
 * and legitimately has none. A model that reported "0 milestones, 0% billed" for one would be
 * reporting a fault that does not exist, and a firm that sees two of those stops reading the
 * third. `milestonePosition` therefore distinguishes *no milestones* from *no progress*.
 */

import type { ContractedPosition } from './changeRequest'
import { workingDaysBetween } from './dates'

/** Where the work has got to. Says nothing about money. */
export const DELIVERY_STATES = ['Planned', 'InProgress', 'Delivered'] as const
export type DeliveryState = (typeof DELIVERY_STATES)[number]

/** What the client has said about it. `Rejected` belongs to this axis and to no other. */
export const ACCEPTANCE_STATES = ['Pending', 'Accepted', 'Rejected'] as const
export type AcceptanceState = (typeof ACCEPTANCE_STATES)[number]

/**
 * What makes this milestone billable.
 *
 * Read straight off the firm's own pricing models rather than invented:
 *
 *   `acceptance`  the ordinary fixed-fee milestone. Nothing is owed until the client accepts.
 *   `signature`   the 50%-upfront advisory shape. Owed on signing, before any delivery.
 *   `delivery`    owed when the work lands, whether or not acceptance has been given — the
 *                 shape used where acceptance is a formality with a long tail.
 *
 * This is deliberately NOT derived from the states above. "When does this become billable" is a
 * commercial term somebody negotiated, and inferring it from a status would make a contract term
 * a consequence of a screen.
 */
export const BILLING_TRIGGERS = ['acceptance', 'signature', 'delivery'] as const
export type BillingTrigger = (typeof BILLING_TRIGGERS)[number]

/** Percentage of the contracted value, or a figure in its own right. */
export const MILESTONE_BASES = ['percentage', 'amount'] as const
export type MilestoneBasis = (typeof MILESTONE_BASES)[number]

export interface Milestone {
  /** `ms-12`, minted from the durable workspace counter. */
  id: string
  sowId: string
  name: string
  description: string
  /** Presentation order, and the order a payment schedule reads in. Not a dependency. */
  sequence: number

  basis: MilestoneBasis
  /** 0–100. Null when `basis` is `amount`. Of the CONTRACTED value — see `milestoneValue`. */
  percentage: number | null
  /** Null when `basis` is `percentage`. */
  amount: number | null
  currency: string
  billOn: BillingTrigger

  plannedDate: string | null

  delivery: DeliveryState
  deliveredAt: string | null
  deliveredBy: string | null

  acceptance: AcceptanceState
  acceptedAt: string | null
  acceptedBy: string | null
  /** Required on a rejection. What has to change before it can be presented again. */
  rejectionNote: string | null

  /**
   * What the milestone was worth at the moment it was accepted.
   *
   * **A derived value deliberately recorded as a fact, and the exception is argued rather than
   * assumed.** A percentage milestone is normally computed from the contracted position, so an
   * approved change request moves it — correctly, for work not yet done. Applying that movement
   * to an ALREADY ACCEPTED milestone would retroactively change what the client agreed to pay
   * for something they have already signed off, which is not a recalculation, it is a different
   * invoice.
   *
   * So acceptance freezes it, exactly as `SowPosition.baselineHours` keeps what was signed
   * beside what is contracted now. Null until accepted, and null forever on a milestone that
   * never is.
   */
  acceptedValue: number | null

  /**
   * The signed acceptance certificate, when the firm holds one.
   *
   * Null is the ordinary state and must stay acceptable: the document library needs a consent
   * that has not been granted yet, and a milestone that could not be accepted without an
   * artefact would make this entity unusable for exactly as long as that takes. What the product
   * owes instead is to say which milestones were accepted without evidence — see
   * `describeMilestone`.
   */
  evidenceDocumentId: string | null

  recordedBy: string
  recordedAt: string
  deletedAt: string | null
}

/* ================================================================== *
 * What one is worth
 * ================================================================== */

/**
 * The value of a milestone, in the currency of its statement of work.
 *
 * A percentage milestone is worth its share of the **contracted** position — baseline plus
 * approved changes — not of the baseline. Measuring against a figure that has been formally
 * varied is the same fault `sowPosition` was corrected for: it reports a number nobody agreed to.
 *
 * Once accepted, the frozen figure wins. See `Milestone.acceptedValue`.
 */
export function milestoneValue(m: Milestone, contracted: ContractedPosition): number | null {
  if (m.acceptedValue !== null) return m.acceptedValue
  if (m.basis === 'amount') return m.amount
  if (m.percentage === null) return null
  return (contracted.contractedValue * m.percentage) / 100
}

export interface MilestonePosition {
  sowId: string
  /**
   * True when this statement of work is not billed by milestone at all.
   *
   * The difference between "nothing has happened yet" and "this is a retainer" — and the reason
   * every figure below is null rather than zero in that case.
   */
  notMilestoneBilled: boolean
  count: number
  /** Sum of the percentages. Reported even when it is not 100 — see `scheduleProblem`. */
  percentageAllocated: number
  delivered: number
  accepted: number
  /** Delivered and not yet accepted. The question the audit says cannot be asked today. */
  awaitingAcceptance: number
  rejected: number
  /** Value of everything whose billing trigger has been met. */
  billableValue: number
  /** Value of everything accepted. Never larger than `billableValue` for the usual trigger. */
  acceptedValue: number
  contractedValue: number
  currency: string
  /** Accepted with no acceptance certificate held. Reported, never blocked. */
  acceptedWithoutEvidence: number
}

export function milestonePosition(
  sowId: string,
  milestones: Milestone[],
  contracted: ContractedPosition,
): MilestonePosition {
  const mine = milestones.filter((m) => m.sowId === sowId && !m.deletedAt)
  const base = {
    sowId,
    contractedValue: contracted.contractedValue,
    // From the contracted position rather than a parameter, so there is one answer to what
    // currency this SOW is in. A milestone carries its own only so a row can be read alone.
    currency: contracted.currency,
    count: mine.length,
  }
  if (!mine.length) {
    return {
      ...base,
      notMilestoneBilled: true,
      percentageAllocated: 0,
      delivered: 0,
      accepted: 0,
      awaitingAcceptance: 0,
      rejected: 0,
      billableValue: 0,
      acceptedValue: 0,
      acceptedWithoutEvidence: 0,
    }
  }

  let billableValue = 0
  let acceptedValue = 0
  for (const m of mine) {
    const value = milestoneValue(m, contracted) ?? 0
    if (isBillable(m)) billableValue += value
    if (m.acceptance === 'Accepted') acceptedValue += value
  }

  return {
    ...base,
    notMilestoneBilled: false,
    percentageAllocated: round(
      mine.filter((m) => m.basis === 'percentage').reduce((n, m) => n + (m.percentage ?? 0), 0),
    ),
    delivered: mine.filter((m) => m.delivery === 'Delivered').length,
    accepted: mine.filter((m) => m.acceptance === 'Accepted').length,
    awaitingAcceptance: mine.filter((m) => m.delivery === 'Delivered' && m.acceptance === 'Pending')
      .length,
    rejected: mine.filter((m) => m.acceptance === 'Rejected').length,
    billableValue: round(billableValue),
    acceptedValue: round(acceptedValue),
    acceptedWithoutEvidence: mine.filter((m) => m.acceptance === 'Accepted' && !m.evidenceDocumentId)
      .length,
  }
}

/**
 * The next position in a statement of work's schedule.
 *
 * Counts withdrawn milestones too, deliberately: reusing a removed milestone's position would
 * put the new one where the old one sat in an audit trail somebody may be reading beside it.
 */
export function nextSequence(milestones: Record<string, Milestone>, sowId: string): number {
  const mine = Object.values(milestones).filter((m) => m.sowId === sowId)
  return mine.reduce((n, m) => Math.max(n, m.sequence), 0) + 1
}

/** Whether the commercial trigger this milestone was sold on has been met. */
export function isBillable(m: Milestone): boolean {
  if (m.acceptance === 'Rejected') return false
  if (m.billOn === 'signature') return true
  if (m.billOn === 'delivery') return m.delivery === 'Delivered'
  return m.acceptance === 'Accepted'
}

const round = (n: number) => Math.round(n * 100) / 100

/* ================================================================== *
 * Rules
 * ================================================================== */

/** Why this milestone cannot be recorded as it stands, or null. */
export function checkMilestone(
  m: Pick<Milestone, 'name' | 'basis' | 'percentage' | 'amount'>,
): string | null {
  if (!m.name.trim()) return 'A milestone needs a name — it is what appears on an invoice line.'
  if (m.basis === 'percentage') {
    if (m.percentage === null || !Number.isFinite(m.percentage)) {
      return 'A percentage milestone needs a percentage.'
    }
    if (m.percentage <= 0 || m.percentage > 100) {
      return 'A milestone is between 0 and 100 percent of the contract.'
    }
  } else {
    if (m.amount === null || !Number.isFinite(m.amount) || m.amount <= 0) {
      return 'A fixed-amount milestone needs an amount greater than zero.'
    }
  }
  return null
}

/**
 * Whether the schedule as a whole adds up, as a sentence, or null.
 *
 * **Reported, never refused.** A firm entering four milestones passes through 25, 60 and 85 on
 * the way to 100, so a reducer that rejected any set not summing to 100 would make the second
 * milestone impossible to save. The check belongs to the set and the set is only ever
 * half-finished while somebody is typing it — so this is the same shape `describeCapacity` uses
 * for an assumed working pattern: shown beside the figure, not enforced against the keystroke.
 *
 * Over 100 is called out more sharply than under, because under-allocation is a normal
 * intermediate state and over-allocation never is.
 */
export function scheduleProblem(position: MilestonePosition): string | null {
  if (position.notMilestoneBilled) return null
  const pct = position.percentageAllocated
  if (pct === 0) return null
  if (pct > 100) {
    return `The milestones add up to ${pct}% of the contract — ${round(pct - 100)}% more than there is to bill.`
  }
  if (pct < 100) {
    return `The milestones add up to ${pct}% of the contract. ${round(100 - pct)}% is not yet allocated to one.`
  }
  return null
}

export type MilestoneRisk = 'overdue' | 'dueSoon'

/**
 * Whether this milestone's date is a live concern, or null.
 *
 * Clears once `Delivered` — the date commitment is met at that point regardless of where
 * acceptance stands, which the row already reports separately. The same shape `lib/schedule.ts`'s
 * `computeHealth` and `lib/watch.ts` use for an issue's own due date: a plain string comparison
 * decides `overdue`, `workingDaysBetween` only sizes the warning window for `dueSoon` — never a
 * score, just a date compared against a date.
 */
export function milestoneRisk(m: Milestone, today: string, warnBeforeDays: number): MilestoneRisk | null {
  if (!m.plannedDate || m.delivery === 'Delivered') return null
  if (m.plannedDate < today) return 'overdue'
  const left = workingDaysBetween(today, m.plannedDate)
  return left >= 0 && left <= warnBeforeDays ? 'dueSoon' : null
}

/** Why this delivery cannot be recorded, or null. */
export function deliverProblem(m: Milestone): string | null {
  if (m.delivery === 'Delivered') return 'That milestone is already delivered.'
  if (m.acceptance === 'Accepted') return 'That milestone has already been accepted.'
  return null
}

/**
 * Why this acceptance decision cannot be made, or null.
 *
 * The rule that matters is the second one, and it is `lib/approval.ts`'s rule in a new place:
 * the person who says the work is done is not the person who says it is acceptable. Acceptance
 * is the client's judgement, and a delivery lead who could sign off their own delivery turns an
 * acceptance certificate into a formality.
 */
export function acceptProblem(
  m: Milestone,
  decision: AcceptanceState,
  note: string | undefined,
  actor: string,
): string | null {
  if (m.acceptance === 'Accepted') return 'That milestone has already been accepted.'
  if (decision === 'Rejected' && !note?.trim()) {
    return 'Returning a milestone needs a reason — what has to change before it can be presented again.'
  }
  if (
    m.deliveredBy &&
    m.deliveredBy.trim().toLowerCase() === actor.trim().toLowerCase()
  ) {
    return `${m.deliveredBy} recorded this as delivered, so somebody else decides whether it is accepted.`
  }
  if (m.billOn !== 'signature' && m.delivery !== 'Delivered') {
    return 'That milestone has not been delivered yet.'
  }
  return null
}

/* ================================================================== *
 * Reading
 * ================================================================== */

/** How one milestone reads, leading with the pair the audit says cannot be asked about. */
export function describeMilestone(m: Milestone, value: number | null): string {
  const worth =
    value === null
      ? 'no value computed'
      : `${m.currency} ${value.toLocaleString()}${m.basis === 'percentage' ? ` (${m.percentage}%)` : ''}`

  if (m.acceptance === 'Rejected') {
    return `Returned — ${m.rejectionNote ?? 'no reason recorded'}. ${worth}, and nothing is billable until it is presented again.`
  }
  if (m.acceptance === 'Accepted') {
    const frozen = m.acceptedValue !== null ? ' The value was fixed at acceptance, so a later change to the contract does not move it.' : ''
    const evidence = m.evidenceDocumentId
      ? ' A signed acceptance is held against it.'
      : ' No signed acceptance is held — the record of it is this entry and the audit trail.'
    return `Accepted by ${m.acceptedBy ?? 'somebody'} on ${m.acceptedAt?.slice(0, 10) ?? 'an unrecorded date'}. ${worth}.${frozen}${evidence}`
  }
  if (m.delivery === 'Delivered') {
    return `Delivered on ${m.deliveredAt?.slice(0, 10) ?? 'an unrecorded date'} and awaiting acceptance. ${worth}${m.billOn === 'delivery' ? ', billable now' : ', not billable until it is accepted'}.`
  }
  if (m.billOn === 'signature') {
    return `Billable on signature rather than on delivery. ${worth}. ${m.delivery === 'InProgress' ? 'In progress.' : 'Not started.'}`
  }
  return `${m.delivery === 'InProgress' ? 'In progress' : 'Not started'}. ${worth}, billable on acceptance.`
}

/** How the schedule reads. Says "not billed this way" rather than reporting zeroes. */
export function describeMilestones(p: MilestonePosition): string {
  if (p.notMilestoneBilled) {
    return 'No milestones are recorded against this statement of work. That is normal for a retainer, which is billed by the month rather than against delivery.'
  }
  const parts = [
    `${p.count} ${p.count === 1 ? 'milestone' : 'milestones'}`,
    `${p.accepted} accepted`,
  ]
  if (p.awaitingAcceptance) parts.push(`${p.awaitingAcceptance} delivered and awaiting acceptance`)
  if (p.rejected) parts.push(`${p.rejected} returned`)

  const money = `${p.currency} ${p.billableValue.toLocaleString()} billable of ${p.currency} ${p.contractedValue.toLocaleString()} contracted`
  const gap = scheduleProblem(p)
  const evidence = p.acceptedWithoutEvidence
    ? ` ${p.acceptedWithoutEvidence} accepted without a signed acceptance on file.`
    : ''
  return `${parts.join(', ')} — ${money}.${gap ? ` ${gap}` : ''}${evidence}`
}
