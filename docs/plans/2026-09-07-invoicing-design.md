# Invoicing — turning a billable milestone into a record

*7 September 2026. A design, not an increment — I2c in `docs/pending-actions.md` says both
dependencies (rates, milestones) now exist. Checked directly (7 Sep): that's slightly generous.
`Invoice` isn't schema-only and unwired — it doesn't exist anywhere. No model, no reducer arm, no
API route, no UI. This design is from zero, not from a partial build.*

**Status: built, 7 September 2026**, same day as the design — schema (migration
`20260907000002_invoicing`), `raiseInvoice`/`updateInvoiceStatus` reducer arms, and an Invoices
section in `CommercialPanel.tsx` below the payment schedule. Five scenarios (INV1–INV5) drive the
real reducer; all PASS, alongside all 231 pre-existing scenarios. `tsc --noEmit`, `npm run build`
and `npm run audit:tenancy` all clean. Built exactly as designed — nothing changed shape.

## What already exists, and is the actual foundation

`lib/milestone.ts` already answers "is this billable" precisely, from the firm's own negotiated
terms rather than inferred:

- **`isBillable(m: Milestone): boolean`** (`lib/milestone.ts:240-245`) — true when the milestone's
  own `billOn` trigger (`acceptance` | `signature` | `delivery`) has been met, false on
  `Rejected` regardless of trigger.
- **`milestonePosition(sowId, milestones, contracted)`** (`lib/milestone.ts:173-226`) — already
  aggregates `billableValue` (sum of everything billable) and `acceptedValue` (sum of everything
  accepted) per SOW, in the SOW's own currency, distinguishing "no milestones" (a retainer) from
  "no progress" so neither reads as the other.
- **`Milestone.acceptedValue`** (`prisma/schema.prisma:1590-1595`) — the value frozen at
  acceptance, immune to a later change request moving the contracted position retroactively.

So the modelling work — what counts as billable, and what it's worth — is done. What's missing is
purely the record: nothing turns "this milestone is billable" into "an invoice was raised for it."

## The gap, precisely

A milestone can sit `isBillable() === true` indefinitely with nothing marking that anyone has
acted on it. Two different SOWs' `billableValue` cannot be told apart as "invoiced" vs.
"outstanding" — the number is the same whether an invoice went out yesterday or never.

## Schema

```prisma
model Invoice {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  /// `inv-12`, minted from the durable workspace counter — same convention as Milestone's `ms-N`,
  /// never a sequential number a client-facing document would read as a count of invoices raised
  /// across every client (see the identity-ids migration's own reasoning against exposing counts).
  id       String
  sowId    String
  sow      Sow    @relation(fields: [tenantId, sowId], references: [tenantId, id], onDelete: Restrict)

  /// The client-facing reference — separate from `id` because a firm's numbering scheme (a
  /// sequence per fiscal year, a prefix per client) is a negotiated/accounting-system fact, not
  /// this application's to invent. Free text, uniqueness NOT enforced at this layer.
  reference String

  currency String
  /// Draft | Sent | Paid | Cancelled — see "Status lifecycle" below for why not more.
  status   String

  raisedAt  DateTime
  raisedBy  String
  sentAt    DateTime?
  paidAt    DateTime?

  deletedAt DateTime?

  lines InvoiceLineItem[]

  @@id([tenantId, id])
  @@index([tenantId, sowId])
}

model InvoiceLineItem {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  id        String
  invoiceId String
  invoice   Invoice @relation(fields: [tenantId, invoiceId], references: [tenantId, id], onDelete: Cascade)

  /// The milestone this line bills. No FK, like ChangeRequest.issueId and Evidence.documentId —
  /// same reasoning: a milestone that is later withdrawn must not silently orphan or cascade-
  /// delete a financial record that already went to a client.
  milestoneId String?
  description String  @db.Text
  amount      Decimal @db.Decimal(14, 2)

  @@id([tenantId, id])
}
```

**Why line items reference a milestone loosely, and why an invoice isn't just `Milestone.invoiced:
boolean`.** A single invoice covering several milestones (common at a payment-schedule boundary)
and a milestone split across two invoices (a partial payment negotiated after the fact) are both
real, and a boolean on `Milestone` can represent neither. The line item is where "which milestone,
how much, in this specific invoice" lives; `Milestone` itself is untouched by this design.

## Status lifecycle

**Draft → Sent → Paid**, plus **Cancelled** from either Draft or Sent. Deliberately not more:

- No **Overdue** state — that's a computed fact (`sentAt` + payment terms vs. today), the same
  discipline the schema comment on `schedule` already states elsewhere in this codebase
  ("derived values are never stored as fact"). A view can compute it; the record shouldn't.
- No partial-payment tracking. A part-paid invoice is either a second, corrected invoice (this
  design's shape) or a real accounting-system feature this application is not becoming — see
  "What this does not do."

## The reducer arm

`raiseInvoice`: takes `sowId`, `reference`, one or more `{ milestoneId, description, amount }`
lines. Refuses if any named `milestoneId` is not `isBillable()` today — the same "checked before
the write, not discovered after" discipline `/api/mail/send` already applies to its own
preconditions. Does **not** refuse a milestone already covered by a prior invoice's line item —
splitting and re-invoicing are real, and the refusal-worthy case (double-billing by accident) is
a UI warning (surface the milestone's existing invoice references before submit), not a hard
block a legitimate partial re-bill would fight.

`updateInvoiceStatus`: Draft→Sent, Sent→Paid, either→Cancelled. Gated on a `invoice.manage`
permission — new, following the existing per-domain permission convention (`rate.view`/
`rate.edit`, `sow.edit`) rather than reusing `rate.edit`, since raising an invoice and setting a
rate are different authorities a firm may want to split.

## Where it surfaces

`CommercialPanel.tsx`, alongside the existing milestone list — an "Invoice this" action on any
row where `isBillable(m)` is true and no invoice line currently references it, and an Invoices
section listing what's been raised per SOW, reusing `milestonePosition`'s `billableValue` as the
"still to invoice" figure (`billableValue` minus the sum of non-cancelled invoice lines).

## What this does not do

Tax/VAT — no rate, no jurisdiction logic; `amount` is what's billed, full stop. No PDF generation,
no email delivery, no external accounting-system integration (Xero, QuickBooks) — this records
that an invoice was raised, in the same spirit `lib/mail.ts`'s outward door records that a mail
was sent, not a replacement for the systems that actually run a firm's books. No payment
processing. No multi-currency conversion — an invoice inherits its SOW's currency, unconverted,
the same rule `milestonePosition` already applies.

## What would send this back

- If invoices commonly need to split a single milestone's value across several invoices with
  different amounts (not just reference it from several) — `InvoiceLineItem.amount` needs to
  answer "how much of this milestone" rather than assuming a full-value line, which changes the
  refusal logic in `raiseInvoice`.
- If a real accounting-system integration becomes a near-term need — this design's `Invoice`
  becomes the local mirror of an external record rather than the record itself, which is a
  different sync-and-conflict design, not an extension of this one.
