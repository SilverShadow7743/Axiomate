# Design: milestone-level effort attribution

Closes the gap scenario `K` in the validation suite has named since it was written: effort
variance is proven at the issue level (`effortVariance`, `lib/time/time.ts`) and at the SOW level
(`sowPosition`, proven by `RT1`, shown in `CommercialPanel`), but nowhere in between. `Milestone`
carries no relationship to an individual `Issue` today, so a partner asking "which milestone is
actually at risk" inside a multi-milestone SOW has no answer more precise than the whole
contract. Decided in the coverage-audit follow-on (2026-09-20, Nishant): build the relationship,
rather than leave it as an accepted boundary — this document is the design step that decision
calls for, not the migration itself. See `docs/strategy/2026-09-17-product-development-lifecycle-verification.md`
§B row K and the coverage-roadmap artifact this session produced for the fuller context.

## What already does the work

- `effortVariance` (`lib/time/time.ts`) — per-issue, proven by `K` itself.
- `sowPosition` (`lib/commercial/sow.ts`) — sums `varianceHours`/`varianceIssueCount` across every issue
  attributed to a SOW's projects, proven by `RT1`, rendered in `CommercialPanel`'s SOW summary.
- `HierarchyNode.sowId` — the existing attribution path. A **project** names its SOW; every
  issue under it inherits that attribution through the tree, not through a field on `Issue`
  itself. This is why SOW-level rollup exists already and milestone-level does not: a project
  is one thing, a milestone is a slice of one, and nothing today names which slice an issue
  belongs to.

## The shape

**`Issue.milestoneId String?`** — nullable, additive, no foreign key. Same convention as
`InvoiceLineItem.milestoneId` and for the same reason stated there: a milestone later
renegotiated or withdrawn must not silently orphan or cascade-delete a work record that already
has real hours logged against it. Null means "not attributed to a specific milestone" — the
default for every issue today and for any issue whose SOW has only one milestone, where the
distinction carries no information.

**`milestonePosition(milestone, issueIds, estimates, timeEntries, bands): MilestonePosition`**
(new, `lib/commercial/sow.ts`, beside `sowPosition`) — the same computation, filtered to
`issue.milestoneId === milestone.id`. Deliberately NOT a rewrite of `sowPosition`: a milestone's
position is a narrower read of the same rows, not a different kind of fact. `issueIds` stays a
caller-supplied list (as `sowPosition` already takes it) rather than a query the function runs
itself, keeping the pure-function/no-I-O discipline this module already holds to.

**Surface**: `CommercialPanel`'s existing "Payment schedule" table (`#, Milestone, Worth, Due,
Delivery, Acceptance`) gains a `Variance` column, populated only for milestones that have at
least one attributed issue — the same "show nothing rather than a zero that means unknown"
discipline `sowPosition`'s own `unestimatedCount` already follows.

**Where it's set**: a new field on the existing issue-edit surface (`DetailPanel`'s Overview
tab, Classification group, beside `{TIER_MODULE}`) — a select scoped to the issue's own SOW's
milestones, empty option "Not attributed to a milestone." Not a bulk-attribution tool in this
pass; SelectionToolbar's bulk actions are a natural follow-on, not part of this design.

## What this does not do

- Does not require every issue to name a milestone. A SOW with one milestone, or a project not
  yet broken into milestone-scoped work, is unaffected — `sowPosition`'s SOW-level rollup keeps
  working exactly as it does today, counting every issue under the SOW regardless of
  `milestoneId`.
- Does not touch `Milestone`'s own commercial fields (`percentage`/`amount`/`billOn`/
  `acceptedValue`) — those price the milestone; this only reports what was spent delivering the
  work attributed to it. The two stay independent, the same way `P`'s approval/delivery
  separation is deliberate, not an oversight.
- Does not backfill. Every existing issue starts at `milestoneId: null` — a real "not yet
  attributed" state, not a data gap to fix on migration.

## Rejected alternative: a many-to-many join table

Considered and set aside for now: an `IssueMilestone` join table would let one issue's effort
split across milestones (a piece of work that spans a phase boundary). Nothing in the domain
model today evidences that need — a milestone is a payment/delivery checkpoint, not a phase an
issue lives inside, and `ScopeItem`/`ChangeRequest` both already reference exactly one SOW, not
many, which is the closer precedent. A one-to-one `milestoneId` is the smaller, reversible
choice: moving to a join table later is additive (the column becomes the "primary" milestone, a
join table adds the rest), while starting with a join table and later finding it was never used
that way is not. Revisit only if a real SOW surfaces the split-effort case.

## Migration

Additive only: one nullable column on `Issue`, no data change, no backfill, no index needed
until milestone-scoped filtering becomes a real query pattern (it isn't yet — `CommercialPanel`
reads a milestone's issues by filtering the SOW's already-loaded issue list in memory, the same
way `sowPosition`'s caller does today).

## Next step

An implementation plan, per this repo's own design → plan → implementation discipline — not
part of this document. It should cover: the Prisma migration itself; a `setIssueMilestone`
reducer action (permission: the same `sow.edit`/`sow.attribute` gate `attributeToSow` already
uses, since this is the same kind of commercial attribution, one level finer); the
`DetailPanel` field; the `CommercialPanel` column; and a rewritten scenario `K` (or a new `K2`)
that seeds two issues under different milestones of the same SOW and proves the split resolves
correctly — the same shape `IT6`/`IT7` already use to prove `duplicateGroups`, and the same
shape `RT1` uses to prove `sowPosition`.
