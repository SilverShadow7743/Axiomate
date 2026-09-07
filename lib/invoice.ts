/**
 * Turning a billable milestone into a record.
 *
 * Pure — no clock, no I/O, same discipline as `lib/milestone.ts`. See
 * `docs/plans/2026-09-07-invoicing-design.md` for why this exists and what it deliberately does
 * not do (no tax/VAT, no PDF, no payment processing, no accounting-system integration).
 */

import { isBillable, type Milestone } from './milestone'

export const INVOICE_STATUSES = ['Draft', 'Sent', 'Paid', 'Cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export interface Invoice {
  /** `inv-12`, minted from the durable workspace counter — same convention as `ms-N`. */
  id: string
  sowId: string
  /** The client-facing reference. Free text — a firm's numbering scheme is a negotiated fact,
   *  not this application's to invent. */
  reference: string
  /** Inherited from the SOW at the moment of raising, unconverted — the same rule
   *  `milestonePosition` already applies. Not user-chosen. */
  currency: string
  status: InvoiceStatus

  raisedAt: string
  raisedBy: string
  sentAt: string | null
  paidAt: string | null

  deletedAt: string | null
}

export interface InvoiceLineItem {
  id: string
  invoiceId: string
  /** No FK, like `ChangeRequest.issueId` and `Evidence.documentId` — a milestone later
   *  withdrawn must not silently orphan or cascade-delete a financial record. */
  milestoneId: string | null
  description: string
  amount: number
}

export interface RaiseInvoiceLine {
  milestoneId: string | null
  description: string
  amount: number
}

/**
 * Why this invoice cannot be raised as it stands, or null.
 *
 * A named milestone must exist, belong to the same SOW, and be billable *today* — the same
 * "checked before the write, not discovered after" discipline `/api/mail/send` applies to its
 * own preconditions. A line with no `milestoneId` is a deliberate free-form/adjustment line and
 * is not checked against a milestone at all.
 */
export function checkRaiseInvoice(
  sowId: string,
  lines: RaiseInvoiceLine[],
  milestones: Record<string, Milestone>,
): string | null {
  if (!lines.length) return 'An invoice needs at least one line.'
  for (const line of lines) {
    if (!line.description.trim()) return 'Every invoice line needs a description.'
    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      return 'Every invoice line needs a positive amount.'
    }
    if (line.milestoneId === null) continue
    const m = milestones[line.milestoneId]
    if (!m || m.deletedAt) return 'One of these lines names a milestone that no longer exists.'
    if (m.sowId !== sowId) return 'One of these lines names a milestone from a different SOW.'
    if (!isBillable(m)) return `“${m.name}” is not billable yet.`
  }
  return null
}

const STATUS_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  Draft: ['Sent', 'Cancelled'],
  Sent: ['Paid', 'Cancelled'],
  Paid: [],
  Cancelled: [],
}

/** Why this status change cannot be made, or null. */
export function checkInvoiceStatusChange(from: InvoiceStatus, to: InvoiceStatus): string | null {
  if (from === to) return null
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    return `An invoice cannot move from ${from} to ${to}.`
  }
  return null
}

/* ================================================================== *
 * Position — how much of a SOW has been invoiced, read off the lines
 * ================================================================== */

export interface InvoicePosition {
  sowId: string
  /** Sum of every non-cancelled invoice line's amount, in the SOW's currency. */
  invoiced: number
  /** `milestonePosition(sowId, ...).billableValue` minus `invoiced`, floored at 0. Passed in by
   *  the caller rather than recomputed here — this module does not read milestones for value. */
  stillToInvoice: (billableValue: number) => number
}

export function invoicePosition(
  sowId: string,
  invoices: Invoice[],
  lines: InvoiceLineItem[],
): InvoicePosition {
  const mine = new Set(invoices.filter((i) => i.sowId === sowId && !i.deletedAt && i.status !== 'Cancelled').map((i) => i.id))
  const invoiced = round(
    lines.filter((l) => mine.has(l.invoiceId)).reduce((n, l) => n + l.amount, 0),
  )
  return {
    sowId,
    invoiced,
    stillToInvoice: (billableValue: number) => Math.max(0, round(billableValue - invoiced)),
  }
}

const round = (n: number) => Math.round(n * 100) / 100
