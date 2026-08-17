# Timesheets — implementation plan

Follows `2026-08-17-timesheets-design.md`, approved 17 August 2026.

The ordering principle: **each step is provable before the next one depends on it.** The pure
rules come first because they need nothing, the freeze comes before the storage that has to
survive it, and the interface comes last because it is the only part that cannot be checked
without a browser.

---

## 1. `lib/timesheet.ts` — the rules, with nothing attached

Pure. No clock, no database, no `Date.now()`. Every function takes what it needs.

    weekStarting(date: string): string          // Monday of the ISO week containing `date`
    weekLabel(weekStarting: string): string     // "week of 17 Aug" — for refusals a person reads
    entriesInWeek(entries, person, weekStarting): TimeEntry[]
    weekTotal(entries, person, weekStarting): { hours: number; billable: number }
    type TimesheetStatus = 'Submitted' | 'Approved' | 'Rejected'
    isFrozen(sheets, person, date): TimesheetStatus | null   // null when the week is open
    submitProblem(sheets, entries, person, weekStarting, actor): string | null
    decideProblem(sheet, actor, decision): string | null

`isFrozen` returns the *status* rather than a boolean, because the refusal has to say which of
the two it is — "awaiting approval" and "already approved" call for different next moves from
the person reading it.

**Verified by:** `npx tsc --noEmit`, and step 2.

## 2. Scenarios U and V — before any wiring

Rewrite both in `scripts/scenario-validation.ts` to drive step 1 directly. They currently return
a hard-coded NOT IMPLEMENTED; they must compute their verdict.

U — submit a week: entries land, the week totals correctly, submitting succeeds, submitting the
same week twice is refused, submitting somebody else's week is refused.

V — reject and recover: a rejection carries a reason, the week becomes editable again, an edit
lands, a resubmit succeeds, and an approval by the person who submitted is refused because
`lib/approval.ts` already says asker ≠ decider.

**Verified by:** `npx tsx --conditions=react-server scripts/scenario-validation.ts` showing U and
V no longer NOT IMPLEMENTED, with numbers in their `actual` text that came out of the run.

*Doing this before the reducer is deliberate. If the rules are wrong, this is where it is cheap
to find out.*

## 3. Reducer arms and permissions

Add to `lib/workspace.ts`:

    | { t: 'submitTimesheet'; person: string; weekStarting: string; now: string }
    | { t: 'decideTimesheet'; id: string; decision: 'approved' | 'rejected'; reason?: string; now: string }

Add `time.submit` and `time.approve` to `lib/access.ts`, granted to the delivery roles and to
neither client role. `time.submit` is not sufficient on its own — the arm compares `actor` to
`person` and refuses a submission on somebody else's behalf, because a permission that let one
consultant attest to another's hours would make the attestation worthless.

A rejection requires a reason. An approval does not: "yes" is complete on its own, "no" is not.

**Verified by:** typecheck, and U and V still passing now that they run through `apply()`.

## 4. The freeze — the step with the regression risk

One call to `isFrozen` at the top of `addTime`, `updateTime` and `removeTime`. Three call sites,
one implementation, because three copies of a rule are three chances to disagree about it.

    The week of 17 Aug is submitted and awaiting approval. Hours cannot be changed
    until it is approved or returned to you.

`updateTime` and `removeTime` check the entry's **stored** date, not the incoming one — otherwise
an entry can be moved out of a frozen week by editing the very field the freeze is meant to hold.
When a patch changes the date, both the old and the new week must be open.

**Verified by:** a scenario asserting both directions — refused inside a submitted week, and
still allowed in every other week, for every other person, and after a rejection.

## 5. Storage

    model Timesheet {
      tenantId     String
      id           String
      person       String
      weekStarting String    // ISO date, always a Monday
      status       String
      submittedAt  DateTime
      submittedBy  String
      decidedAt    DateTime?
      decidedBy    String?
      reason       String?   @db.Text
      @@id([tenantId, id])
      @@unique([tenantId, person, weekStarting])
    }

Mapper pair in `lib/db/map.ts`, one arm in `lib/db/persist.ts`, one read in `lib/db/repo.ts`,
`timesheets` added to `WorkspaceState` and to the proof's `scrub()` — which will otherwise fail
its own completeness check, by design.

Migration written with `prisma migrate diff --from-schema <committed> --to-schema <current>`;
`--to-schema-datamodel` was removed in Prisma 7.

**Verified by:** `npm run db:migrate` against Azure, then `npm run db:check`.

## 6. The persistence proof

Two checks in `scripts/persistence-proof.ts`:

- A timesheet round trip: submit, reload the workspace, and find the same status, person, week
  and reason.
- **The freeze survives a reload.** Submit, reload, then attempt an edit inside the week and be
  refused. A guard that holds only in the browser's copy of state is not a guard, and this
  repository has already shipped one thing that was true in memory and false in Postgres.

**Verified by:** `npm run audit:persistence` at 28 of 28.

## 7. The Time tab

No new screen. The existing tab gains the week's total, its status, a Submit control, and — for
somebody holding `time.approve` — Approve and Return. A returned week shows its reason.

The control is absent rather than disabled when the permission is missing: a disabled button
invites a person to find out why, and the answer is never encouraging.

**Verified by:** opening it in a browser. The `est-block` defect earlier in this project rendered
three panels as a run of unstyled text, and neither the typecheck, the build, nor the scenario
harness could see it — every scenario drives the reducer and none opens a page.

## 8. Ship

`npm run build`, package the standalone bundle **with `tar`** — `Compress-Archive` writes
backslash separators that Linux reads as filenames, which cost three failed deploys — verify the
new strings are in the bundle, deploy, and confirm against the live URL.

---

## Order of merge

Steps 1–4 are one commit: the rules and the arms are meaningless apart, and a half-landed freeze
is worse than none. Step 5 is its own commit because it carries a migration. Steps 6–8 follow
individually.

## What would make me stop and re-open the design

- If the freeze turns out to need per-entry rather than per-week granularity, the model is wrong
  and the period is not the right unit.
- If approval genuinely has to be per engagement, one approver per person-week is wrong and the
  design's own rejected alternative was right.

Neither is expected. Both are cheaper to admit at step 4 than at step 7.
