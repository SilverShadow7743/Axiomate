# Timesheet approval pattern stamp — implementation plan

Follows `2026-09-20-timesheet-approval-pattern-stamp-design.md`. **Ordering principle:** the
domain type first, because everything downstream is typed against it. The reducer write before
storage, so a wrong stamp is caught by the scenario before it ever reaches Postgres. Storage
last, proven against the real local database rather than assumed.

## 1. `lib/timesheet.ts` — the domain type

Add one field to `Timesheet`:

    workingPatternStamp: Stamped<{ hoursPerDay: number; daysPerWeek?: number }> | null

Import `Stamped` from `./versioning`. Null is the ordinary state — every existing timesheet,
and any approval for a person with no working pattern recorded.

**Verified by:** `npx tsc --noEmit` — every existing construction site of a `Timesheet` object
(the mapper, any fixture) now needs the field, so this step surfaces every one of them before
any logic changes.

## 2. `lib/workspace.ts` — `decideTimesheet`'s approval arm

One addition, gated on `a.decision === 'approved'` only — a rejection commits nothing:

    const pattern = next.personId
      ? valueAt(state.versions, WORKING_PATTERN, next.personId, next.weekStarting)
      : null
    const workingPatternStamp = a.decision === 'approved' ? stamp(pattern, a.now) : sheet!.workingPatternStamp

Read at `weekStarting` (the Monday the week claims to cover), not at `a.now` (the moment of
approval) — the pattern that governed the work, not the pattern true on whatever day somebody
got round to approving it. `stamp()` and `valueAt` both already exist in `lib/versioning.ts`;
import `WORKING_PATTERN` from wherever `lib/capacity.ts` already does, rather than redeclaring
the string literal a second place.

A rejected or already-decided sheet keeps whatever stamp it already had (`sheet!.
workingPatternStamp`) rather than clearing it — `decideTimesheet` can be called again after a
correction to the decision itself in ways that should not silently erase a prior approval's
stamp. In practice today only a fresh approval sets one; this just avoids a needless null on a
path nothing currently takes.

**Verified by:** step 3's scenario, before anything is wired to storage.

## 3. Scenario `HV1` — through the reducer, not around it

Rewrite to drive `recordVersion` → `addTime` → `decideTimesheet` → `correctVersion`, the same
shift scenario `E` made this session (from proving a pure function in isolation to proving the
reducer path that actually calls it):

1. `recordVersion` a pattern for a seeded person, `hoursPerDay: 7.5`.
2. `addTime` an entry for them in the pattern's window, then `submitTimesheet`.
3. `decideTimesheet` it `approved`. Assert `workingPatternStamp?.value.hoursPerDay === 7.5` and
   `stampedFrom` names the version just recorded.
4. `correctVersion` the same version to `hoursPerDay: 6` (a real, permitted correction —
   `overlapProblem` allows correcting a period against itself).
5. Re-read the same timesheet. Assert the stamp is **unchanged** — still 7.5, still naming the
   original version — proving the one thing this whole document exists for: the correction moved
   the timeline and did not move the committed figure.
6. A second scenario arm: approve a timesheet for a person with **no** recorded pattern at all.
   Assert `workingPatternStamp === null` — the same "null is the feature" property `valueAt`
   itself already tests, now proven at the one new call site that could have quietly defaulted
   it to something plausible.

Keep the existing boundary-arithmetic assertions (null-before-anything, exclusive `validTo`,
overlap/gap rules) — they test `lib/versioning.ts` itself and remain correct and necessary. Add
the above as new assertions in the same scenario rather than a second one; `HV1` earns a PASS
only once both the pure rules and the reducer path that now uses them hold.

**Verified by:** `npm run validate:scenarios` — HV1 reads PASS, nothing else regresses.

## 4. `prisma/schema.prisma` — the column

    /// A Stamped<{hoursPerDay, daysPerWeek}> (lib/versioning.ts), frozen at approval so a later
    /// correction to the pattern cannot retroactively move an already-approved week's figures.
    /// Null on a rejected sheet, and null on an approval for a person with no pattern recorded —
    /// both real states, not gaps. See docs/plans/2026-09-20-timesheet-approval-pattern-stamp-design.md.
    workingPatternStamp Json?

Added to `model Timesheet`, after `reason`. Additive, nullable, no backfill.

**Verified by:** `npx prisma migrate dev --name add_timesheet_pattern_stamp` against the local
database (`prisma.config.ts`'s default, `localhost:5432/axiomate_tms`) — a new file appears
under `prisma/migrations/`, committed alongside this plan.

## 5. `lib/db/map.ts` — the mapper pair

`timesheetToRow`: add `workingPatternStamp: t.workingPatternStamp ?? Prisma.JsonNull` — `Json?`
needs the explicit sentinel the same way every other nullable `Json` column in this file already
does; a bare `null` would write the SQL value `NULL` where Prisma expects `Prisma.JsonNull` or
`Prisma.DbNull` and either throws or silently disagrees with what a later read expects, depending
on the client version. Check an existing nullable-`Json` mapper in this file (`ChangeRequest` or
similar) for the exact sentinel this schema already uses, rather than guessing between
`JsonNull`/`DbNull` — the two mean different things to Postgres and only one will be right here.

`timesheetFromRow`: `workingPatternStamp: (r.workingPatternStamp as Stamped<{ hoursPerDay: number; daysPerWeek?: number }>) ?? null`
— cast, not validated; the value only ever arrives here having been written by `stamp()` on the
way in, the same trust boundary every other `Json` column in this mapper already keeps.

**Verified by:** `npx tsc --noEmit`.

## 6. Ship

`npm run db:migrate:dev` (or `db:push` if iterating locally before the migration is final) to
apply, `npm run audit:persistence` — add nothing new to it; the existing timesheet round-trip
check already exercises every field on the row including this one, which is exactly the value
of a mapper-completeness proof that reads the type rather than a hand-maintained field list.
Then `npm run validate:scenarios` once more against the migrated schema, `npx eslint
components app`, and a final `npx tsc --noEmit`.

---

## The detail most likely to be got wrong

**`weekStarting` vs. `a.now` as the date `valueAt` reads.** An approval that happens days after
the week ends must still read the pattern *as it stood during the week being approved*, not
whatever the timeline says today. Getting this backwards produces a stamp that looks correct in
every scenario built around approving promptly and is silently wrong for every late approval,
which is most of them.
