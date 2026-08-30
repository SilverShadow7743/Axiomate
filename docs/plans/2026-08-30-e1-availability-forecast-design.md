# E1 — Leave, holidays, Availability v1, Forecast v1

## What this is

Phase E1 of the platform evolution (`2026-08-29-work-platform-evolution-design.md`): the
availability layer. The parent design's constraints, restated because they bound everything
here: Leave is minimal — dated absence + approval + privacy, existing purely to feed
Availability, with no balances, accruals or entitlement policy; Availability is derived, never
stored, by one engine that scheduling, forecasting and capacity all consult; Forecast v1
answers "can this land by the target date, given who is actually available".

Settled with the user during this design's own conversation, each through an explicit choice:

1. **Leave extends Commitment** — a Leave-kind commitment gains approval and a private reason;
   no second absence entity. One calendar of absence, already wired into capacity and
   My calendar.
2. **Approval is grant-based, timesheet-style** — a new `leave.approve` permission; the asker
   cannot decide. Not the reporting line: the org chart is sparsely populated today, and a
   request whose only possible approver is absent from the directory is a request nobody can
   grant. Manager-first routing is a later, additive refinement.
3. **Holidays are one org-wide list** on the operating model, subtracted once for everyone by
   the working-day math. Per-region calendars are later and additive.
4. **Forecast v1 surfaces on the Schedule tab and the Portfolio line** — the per-record verdict
   where the question is asked of one record, the worst shortfall where it is asked of an
   engagement.
5. **The slice stays boot-shipped.** Leave extends commitments, which already live in the
   workspace payload; the parent design's server-queried rule was written for chat/meeting-scale
   domains and E3+ honors it. Recorded as a deliberate scoping of that rule, not an exception
   discovered later.

## The engine: generalisation, not invention

`lib/capacity.ts`'s `capacityFor` already computes `gross − commitments − allocations` over a
window — the availability formula minus holidays and minus the meetings term. E1 does not build
a second engine beside it (two answers to "who has time" is the drift the parent design
forbids); it extracts the one engine out of it:

- `lib/availability.ts` exports `availabilityFor(person, window, deps)`, grown from
  `capacityFor`'s arithmetic. `capacityFor` becomes its first consumer; `planCheck`, the
  assignment-availability warning, the day-warning on time entry, and the new forecast all
  consult the same function.
- The window-average approximation stays (a four-day week is four fifths of the calendar's
  working days; which day is off is a fact the model does not carry). Per-day availability
  curves over effective-dated patterns (`profileAt`) are deferred, not refused — the deferral
  is this design's Approach C, rejected for v1 weight, and it would slot in behind the same
  function signature.
- The meetings term is explicitly zero until E4, stated in the engine's own documentation
  rather than pretended away.

## Leave

`Commitment` (Leave kind only) gains:

- `status: 'Requested' | 'Approved' | 'Returned'` — the timesheet vocabulary, deliberately.
  Requesting is self-service (My calendar and the Capacity panel, wherever leave is recorded
  today). Deciding requires the new `leave.approve` grant, and the reducer refuses a decision
  by the requester — the same asker-cannot-decide rule `decideTimesheet` enforces, in the same
  words.
- `reason?: string | null` — private, distinct from the existing `note` (which stays what it
  is: a visible operational note, "out Thursday" class). The reason is what the approver reads.
- Non-Leave kinds (`Public holiday`, `Internal`, `Training`) are untouched: recorded facts,
  no approval state, no private field.
- Migration: existing Leave rows become `Approved`. They were recorded by people holding
  capacity-edit rights under the old rules; re-litigating recorded history helps nobody, and
  the audit trail already says who recorded them.

**Pending leave never subtracts from availability.** An unapproved request is not a fact about
the calendar yet; it surfaces from the engine as a named conflict ("2 requested days overlap
this window") wherever availability is consulted. This is the parent design's "don't silently
change plans" principle doing its job: the conflict is a query result a person sees, not a
number that quietly moved.

## Privacy

`reason` is withheld server-side in `boot()`'s redaction — the rates posture, applied again:
everyone sees leave *dates and hours* (availability is the point of the record), but the reason
reaches only the person themselves and holders of `leave.approve`. Enforced where the payload
is built, never merely hidden in the UI. Client views already drop commitments wholesale
(`clientView` empties them), so nothing new is needed on that boundary.

The browser mirror caveat is acknowledged: a reader entitled to a reason holds it in their
local workspace copy, as entitled readers of any withheld-by-grant field do. The guarantee is
about who the server sends it to.

## Holidays

`model.holidays: { date: string; name: string }[]` on the operating model, edited in
Configuration beside the other org-level policies (SLA, time policy). `workingDaysBetween` and
`addWorkingDays` accept an optional holiday set; the engine, SLA date proposals, capacity and
forecast all pass the configured list, so a holiday is subtracted once for everyone rather
than entered as N per-person commitment rows. The `Public holiday` commitment kind survives for
the person-specific case (a regional holiday one person observes) and for existing data.

## Forecast v1

Per record, computed at read time, never stored:

    remaining = max(0, estimated hours − recorded actuals)
    available = availabilityFor(owner, today → due date).remainingHours
    verdict   = remaining ≤ available ? achievable : short by (remaining − available)

Surfaced as one sentence on the Schedule tab — "needs 32h; Priya has 19h before 12 Sep — short
by 13h" — and as the worst shortfall on each engagement's Portfolio line. The verdict is honest
about its inputs, in the codebase's established manner: no estimate → "nothing estimated, so
nothing to forecast against"; no due date → "unscheduled — no target to test"; owner
unresolved in the directory → the availability basis is named as assumed, exactly as
`describeCapacity` already does. Pending-leave conflicts ride along ("…and 2 requested leave
days overlap this window").

Schedule health (`computeHealth`) is deliberately untouched: health reads the past and present
of the schedule; forecast reads its future. Folding the two would overload a vocabulary that
scenario coverage and every screen already depend on.

## Out of scope, stated

Meetings (E4). Per-day availability curves. Manager-routed approval. Per-region holiday
calendars. Leave balances of any kind. Forecast rollups beyond the Portfolio line's worst
shortfall. Any stored forecast or availability number.

## What would send this back

- If extracting `availabilityFor` out of `capacityFor` cannot keep the Capacity screens'
  numbers byte-identical (scenario- and eyeball-checked), the extraction is wrong or the old
  arithmetic was — either way the engine section reopens before anything consumes it.
- If the timesheet-style status on Commitment turns out to fight the existing `upsertCommitment`
  arm's semantics (it rebuilds rows field-by-field; a status a requester can overwrite by
  re-upserting would make approval decorative) — the write path needs its own arm, and the
  Leave section's "extension, not new entity" premise gets re-examined.
- If the forecast sentence cannot be made honest for the majority of live records (most carry
  no estimate and no due date today), the surface choice reopens — a Schedule tab that says
  "nothing to forecast" on four records in five is telling us the feature landed before its
  inputs exist, and Portfolio-only would have been the truer v1.
