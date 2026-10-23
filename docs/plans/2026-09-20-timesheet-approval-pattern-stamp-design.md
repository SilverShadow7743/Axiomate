# Design: stamp the working pattern at timesheet approval

Closes the one gap left in scenarios `HV1`/`TW2` after they were corrected this session — see
the coverage-audit follow-on and the two validation-suite commits immediately before this one.
**This document is narrower than either scenario's name suggests.** Both were badly stale:
working-pattern versioning (`lib/versioning.ts`) turned out to already be wired end to end —
`recordVersion`/`correctVersion` have a real UI call site, real persistence (the Prisma
`Version` model already exists), `lib/capacity/capacity.ts` already reads it for capacity figures, and
`lib/workspace.ts`'s `dayWarning` already applies the daily cap live on every `addTime` call.
The only piece with no application caller anywhere is `stamp()` — this document is the design
step for that one piece, not for the versioning mechanism, which does not need designing: it
already exists.

## The gap, precisely

A working pattern can be corrected (`correctVersion`) after time has already been recorded and
a week has already been approved against it. Nothing today takes a frozen copy of the pattern a
week was judged against, so a later correction would retroactively change what an
already-approved week's figures recompute to — silently, with no record that anything moved.
`lib/versioning.ts`'s own `Stamped<T>` interface and `stamp()` function exist specifically to
prevent this class of problem (the same pattern `EstimateRevision` and `Milestone.acceptedValue`
already use elsewhere in this schema: a derived figure that must not move once committed, held
as its own value rather than recomputed on read). It is simply never called.

## The shape

**`Timesheet.workingPatternStamp Json?`** (new column) — holds a `Stamped<{hoursPerDay,
daysPerWeek}>` shaped value: `{ value, stampedFrom, stampedAt }`, the same shape `stamp()`
already returns. Null on a rejected timesheet (nothing was committed, nothing to freeze) and
null on an approval for a person with no working pattern recorded at all — the same "null is
the feature" discipline `valueAt` already established, not a default of eight hours pretending
to be a fact.

**Where it's set**: `decideTimesheet`'s approval arm (`lib/workspace.ts`), only on
`a.decision === 'approved'`. Reads the person's current pattern via
`valueAt(state.versions, WORKING_PATTERN, personId, weekStarting)`, calls `stamp()` on it, and
writes the result onto the `Timesheet` row being decided. No new permission — this rides on
`time.approve`, already the gate on this whole action.

**Where it's read**: nowhere new, yet. This design only closes the write side — a figure worth
computing from the stamp (a quarter-close utilisation report that must not drift when a pattern
is corrected after the fact) is the actual business reason this exists, but is its own report,
not implied by storing the stamp. Storing it now and reading it later is the same order
`EstimateRevision` was built in.

**Correction UX**: `correctVersion`'s existing `correctionImpact()` already reports which stamps
reference the version being corrected, in the words of what they describe (`StampReference.
describes`) — the mechanism to warn "this correction affects 3 approved weeks" already exists
and needs only a caller supplying real `StampReference[]` built from `Timesheet.
workingPatternStamp` rows. Out of scope for this document; named so the next step doesn't
reinvent it.

## What this does not do

- Does not change what `dayWarning`/`dailyCap` check against — that already reads the live
  timeline at the work date, correctly, and should keep doing so: the daily cap is a
  point-in-time check, not a committed figure, and has no reason to be stamped.
- Does not add a report. A quarter-close or utilisation view that reads
  `workingPatternStamp` is real, separate work with its own design question (which report, what
  it shows when the stamp is null) — not implied by this column existing.
- Does not touch `correctVersion` itself, which already refuses nothing and only reports impact
  — the right behaviour, per `lib/versioning.ts`'s own stated design ("reported, never blocked").

## Migration

Additive only: one nullable JSON column on `Timesheet`, no backfill. Every existing timesheet —
approved or not — starts at `null`, an honest "this predates the stamp," not a gap to fix.

## Next step

An implementation plan covering: the migration; the `decideTimesheet` write, gated on approval
only; a `timesheetToRow`/`timesheetFromRow` mapper update in `lib/db/map.ts`; and a rewritten
scenario `HV1` that proves the full round trip through the reducer (record a pattern, approve a
week, correct the pattern, assert the timesheet's stamped value is unchanged) rather than
calling `lib/versioning.ts` directly — the same shift scenario `E` made this session, from
proving a pure function in isolation to proving the reducer path that actually uses it.
