# Automatic Resource Replanning — decision-support, not an invented fix

**Status: approved 2026-08-31** (four AskUserQuestion decisions, recorded below). Fifth
concrete step out of the product-vision pitch. Picked after ruling out the other three
remaining non-AI-blocked candidates by investigation: "Automatic Governance" turned out to be
substantially already shipped (`lib/watch.ts`'s `observe()` engine, wired live to
`app/api/schedule/run` and run daily in production — scenario `Z`'s own stops text is now
stale, unaddressed this pass); "Work Graph" would need a brand-new Prisma model (no issue-to-
issue link exists — `IssueDependency` only links task-level `IssueActivity` rows within one
issue) and was set aside for a future, dedicated brainstorm given the schema-change weight;
"Calendar+Work automatic planning" risks brushing against the already-blocked "AI Daily
Planner" pitch item.

## What changed the shape of this feature

Zero-Entry Timesheet's suggestions worked because a real fact existed to derive an exact number
from — a meeting's actual duration. **No equivalent fact exists here.** Which of a person's
allocations to reduce, and by how much, is a business judgment nobody has recorded anywhere.
Proposing one "optimal" split (even something as neutral-sounding as "reduce every allocation
proportionally") would mean inventing a business rule — the same refusal `lib/portfolio.ts`'s
own header comment states about scores: *"name the concerns, count them, and let the reader do
the weighing."* This feature names the concern (a deficit, and where the hours currently sit)
and stops there.

A second finding, load-bearing for scope: `DEFAULT_ALLOCATION_POLICY` is `{ cap: 'hard' }`
(`lib/capacity.ts`) — under the shipped default, `upsertAllocation` refuses outright, no
override, the instant a write would push someone over capacity. So this feature is not
guarding against a bypass; the state it reacts to arises legitimately, after the fact — a
person's working pattern moves to fewer days, a new commitment or holiday shrinks their
available hours, and allocations that were entirely valid when written are overallocated on a
later read. Capacity is a read-time computation (`availabilityFor`); nothing re-checks existing
allocations when the inputs around them change.

## The four decisions

1. **Produces a computed, reviewable suggestion, not automatic action.** Every application
   goes through the real `upsertAllocation` reducer path, with its existing cap/audit checks —
   nothing is written unattended.
2. **No single number is picked.** Decision-support data only: the deficit, and every
   overlapping allocation's own current contribution, side by side. The person chooses which to
   change and by how much.
3. **Any of the person's allocations, anywhere** — not only the one on the engagement whose
   Portfolio line showed the concern. Matches Project Pulse's own capacity concern, which is
   already checked against total commitment, not one engagement's slice.
4. **Surfaces as a drill-down from Project Pulse's capacity concern** — the phrase that already
   names who and by how much becomes a link. No new nav destination, matching every feature
   built this session.

## What it computes

`replanningFor(state, person, personId, today)` — same `today → today+28d` window Project
Pulse's capacity concern already uses, so the two features can never quietly disagree about the
same person's numbers. Composes:

- `availabilityFor()` for the deficit (`-remainingHours`, only meaningful when `overallocated`).
- A new small helper built on `overlapWorkingDays()` (already exported from
  `lib/availability.ts`) to get each overlapping `Allocation`'s own hours contribution in the
  window — the same per-allocation arithmetic `availabilityFor` already sums internally
  (`days * hoursPerDay * percentage/100`), exposed per-row instead of only as a total.

Every allocation of the person's that overlaps the window is included, workspace-wide, per
decision 3.

## UI

The capacity concern's phrase in `PortfolioPanel.tsx` becomes a link. Clicking it opens a
drawer (the existing `DetailDrawer` pattern from the clean-shell redesign) showing the deficit
in hours and a table: project name, current %, current hours in the window, for every
overlapping allocation. Each row has a field for a new percentage and an **Apply** button, plus
a **Release** button (the existing `removeAllocation` action — the most extreme form of
"reduce"). No row is pre-filled or highlighted as "the one to change."

## Applying a change

Real grounding found while checking this: the existing allocation UI
(`IssueWorkspace.tsx`'s `onAllocate`) only ever *creates* allocations (`id: null` always) —
there is no existing "edit a percentage in place" UI anywhere in this codebase, though
`upsertAllocation` already supports it at the reducer level (confirmed during Project Pulse's
`PP1` work: an `id` naming an existing allocation edits it). **Apply** dispatches
`upsertAllocation` with the existing allocation's `id`, its unchanged `person`/`projectId`/
`startDate`/`endDate`, and the typed percentage — through the exact same cap/audit checks a
manual edit would go through, including a hard-cap refusal or the advisory two-step if the
typed number is itself still too high. This feature is not the authority on whether a number is
acceptable; the reducer still is.

## Testing

One new scenario, `RP1` (working id), pins `replanningFor()` directly: a person over-committed
across two allocations on different engagements gets both listed with correct hours; the
deficit matches `availabilityFor`'s own `remainingHours` for the identical inputs; a person
within capacity produces no deficit and no fabricated row. A second case (extending `RP1` or a
sibling) exercises the apply path: editing an allocation's percentage down via `upsertAllocation`
with an existing `id` correctly reduces the person's total and is auditable, through the same
checks a manual edit already goes through.

## What stays untouched

No schema change. `upsertAllocation`, `removeAllocation`, the allocation cap policy, and
Project Pulse's capacity concern are all read, never redefined. No unattended application of
any kind.

## What would send this back

- If this feature's computed deficit and Project Pulse's own capacity concern ever disagree for
  the same person and window — they must call `availabilityFor` with identical arguments — that
  is the same fact forked into two disagreeing readings, the exact drift this codebase's own
  comments (`WORKING_PATTERN`'s "declared twice" incident) warn about. Surfaces at the new
  scenario if it's built to cross-check both, or the first time a real number visibly disagrees
  once live.
- If `upsertAllocation`'s edit-by-id path turns out to behave differently than expected for a
  field the UI has never exercised before (this codebase's only prior allocation writes are
  create-only) — e.g., if `createdBy`/`createdAt` or the audit trail don't carry through an edit
  the way they do a create — that's a real gap in the reducer's own edit path, not something to
  route around in this feature.
