# Financial dimensions, and what Axiomate owns of them

**Status:** recorded 17 August 2026. Not yet approved for build.
**Source:** a dimension model proposed against Dynamics 365 Finance design principles —
four core dimensions plus a financial context layer, phased to three active dimensions now.

## The model as proposed

Accounting core, used for posting:

    MAIN ACCOUNT + LEGAL ENTITY + COST CENTER + FINANCIAL PROJECT + BUSINESS UNIT*

    * only where the unit is managed as a real P&L with its own revenue target,
      cost budget, headcount plan and accountable leader — not as a technology label.

Financial context, used for intelligence and derived rather than posted:

    Financial Project → Client, Engagement, Contract (SOW / CR / Retainer),
                        Service Line, Delivery Owner, Account Owner,
                        Billing Model, Estimated Revenue, Estimated Cost, Target Margin

The governing rule, and the reason the model is right: **a financial dimension should exist only
when the value materially changes how you account, control, budget, allocate or manage financial
performance.** Everything else is context, derived for reporting. The stated conclusion — invest
the complexity in the derivation engine rather than in a longer GL dimension string — is the
correct instinct and it is the one this system is already shaped for.

## The distinction this design has to make first

**Axiomate is not a general ledger and should not become one.**

The accounting core belongs in Dynamics 365. Main Account, Legal Entity and Cost Center are
posting constructs, governed by an account structure, and reproducing them here would create a
second set of books free to disagree with the first — which is the same failure this codebase
already refuses in smaller forms: two stores that can disagree about the same record, where the
loser is whichever one nobody looked at.

What Axiomate owns is **Model B**. It is the system where delivery actually happens, so it is
the only place that can produce governed, attributable actuals for the accounting core to post
against. The split is therefore:

| Layer | Owner | Why |
|---|---|---|
| Main Account, Legal Entity, Cost Center | D365 | Posting constructs under an account structure. |
| **Financial Project** | **Shared** | Declared in D365, *originated* in Axiomate — see below. |
| Business Unit | D365, derived where possible | A label until it has a budget and a leader. |
| Client, Engagement, Contract, Service Line, owners, margin targets | **Axiomate** | This is the delivery record. Nothing else has it. |

## What already exists here

More of the context layer is built than the proposal assumes.

- **The hierarchy is the context tree.** `Company ▸ Client ▸ Engagement ▸ Project ▸ Process Area
  ▸ Issue`, with `ALLOWED_PARENTS` in `lib/workspace.ts` enforcing the shape. Client and
  Engagement are not fields on a transaction; they are ancestors of it.
- **The contract exists.** `lib/sow.ts` models a statement of work with a contracted baseline in
  **both effort and value**, statuses `Draft → Signed → Active → Varied → Closed`, and
  `sowPosition` / `describePosition` reporting consumption against it.
- **Attribution to a contract exists.** The `attributeToSow` action links a project node to a
  SOW; `HierarchyNode.sowId` carries it, under a `Restrict` foreign key so a live contract
  cannot be archived out from under the work delivered against it.
- **Derivation already works the way the proposal wants.** A consultant logs hours against an
  issue and selects nothing else. Client, engagement and process area follow from where the
  issue sits. The proposal's example — *the consultant does not select six dimensions, the
  system does* — is already true of everything except cost.

## The gap, and it is not the model

**There are zero Project nodes and zero SOWs in the live workspace.** Forty-one process areas,
three engagements, three clients, one company, no contracts.

So the dimension called "your most valuable" has no instances, and the contract that would carry
revenue, estimated cost and target margin has none either. This is not a modelling problem — the
tiers exist, `project` is a creatable kind, and the menu offers it under an engagement. It is
that the imported issue log had no project tier and no commercial data, so process areas hang
directly off engagements and nothing has ever been attributed to a contract.

Two consequences, both real:

1. **`CapacityPanel` is unreachable in practice.** It renders only for `row.kind === 'project'`.
   No project exists, so a fully built panel — allocations, commitments, planned versus actual
   capacity — cannot be opened by anybody.
2. **`CommercialPanel` opens and is empty.** It renders on an engagement, which does exist, and
   shows the statements of work, of which there are none.

The commercial and resourcing half of the product is therefore invisible, and it is invisible for
want of data rather than for want of code.

## What is genuinely missing

- **Cost rate.** No rate exists on a person, a role or an engagement. Until one does, every
  figure stops at hours: `TimeEntry.billable` is a boolean with no monetary consequence, and
  `sowPosition` can report effort consumption but not margin. This is the same gap the timesheet
  design deferred, for the same reason — attest the hours first.
- **Revenue type and cost type.** Distinguishing SOW from CR from warranty from retainer exists
  as a concept in the proposal and nowhere in the model.
- **Legal entity.** Single-entity today; the tenant is the boundary.

## What this means for sequencing

The proposal's phasing — Cost Center, Financial Project, Business Unit now, more only when a real
financial control requirement emerges — is sound, and it is a D365 configuration exercise more
than an Axiomate one.

The Axiomate work it implies is narrower and more useful:

1. **Give the project tier instances.** Without projects there is no Financial Project to map to,
   and one built panel stays unreachable.
2. **Give engagements contracts.** A SOW carries the value, the estimated cost and the target
   margin the context layer needs.
3. **Then rates**, which turn hours into cost and make `sowPosition` able to answer margin
   rather than only consumption.

None of that is blocked by the timesheet work already planned, and step 3 is the piece that
design deliberately deferred.

## Open question

Whether Financial Project maps one-to-one to an Axiomate project node, or whether several
delivery projects roll into one financial project. The proposal says explicitly that not every
Axiomate project should become a Financial Project, which implies the latter — and that means a
field on the node rather than an assumption that the two are the same thing. Deciding it later
is cheap; assuming they are identical and discovering otherwise is not.
