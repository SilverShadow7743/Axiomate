# Timesheets — implementation plan

Follows `2026-08-17-timesheets-design.md`, approved 17 August 2026.

**Ordering principle: each step is provable before anything depends on it.** Pure rules first,
because they need nothing and a wrong rule is cheapest to find there. The freeze before the
storage that has to survive it. The interface last, because it is the only part no harness can
check.

---

## 1. `lib/timesheet.ts` — the rules, with nothing attached

Pure. No clock, no database, no `Date.now()`. Every function takes what it needs.

    weekStarting(date: string): string          // Monday of the ISO week containing `date`
    weekLabel(weekStarting: string): string     // "week of 17 Aug" — for a refusal a person reads
    entriesInWeek(entries, person, weekStarting): TimeEntry[]
    weekTotal(entries, person, weekStarting): { hours: number; billable: number }
    type TimesheetStatus = 'Submitted' | 'Approved' | 'Rejected'
    isFrozen(sheets, person, date): TimesheetStatus | null   // null when the week is open
    submitProblem(sheets, entries, person, weekStarting, actor): string | null
    decideProblem(sheet, actor, decision): string | null

`isFrozen` returns the *status*, not a boolean, because the refusal has to say which of the two
it is — "awaiting approval" and "already approved" call for different next moves from the person
reading it.

`TimeEntry` comes from `lib/time.ts`, which already exists and already refuses future dates,
entries over twelve hours, and non-quarter-hours. None of that moves.

**Verified by:** `npx tsc --noEmit` clean, then step 2.

## 2. Scenarios U and V — before any wiring

Rewrite both in `scripts/scenario-validation.ts` to drive step 1 directly. They currently return
a hard-coded NOT IMPLEMENTED verdict; they must compute one.

U — submit a week: entries land, the week totals correctly, submitting succeeds, submitting the
same week twice is refused, submitting somebody else's week is refused.

V — reject and recover: a rejection carries a reason, the week becomes editable, an edit lands,
a resubmit succeeds, and an approval by the person who submitted is refused.

**Verified by:** `npm run validate:scenarios` — U and V no longer NOT IMPLEMENTED, and the
numbers in their `actual` text came out of the run rather than being written into it. Expect the
summary to move from 26 PASS / 4 NOT IMPLEMENTED to 28 PASS / 2 NOT IMPLEMENTED.

*Before the reducer, deliberately. If the rules are wrong, this is where it costs nothing.*

## 3. Reducer arms and permissions

Add to `lib/workspace.ts`:

    | { t: 'submitTimesheet'; person: string; weekStarting: string; now: string }
    | { t: 'decideTimesheet'; id: string; decision: ApprovalDecision; reason?: string; now: string }

Add `time.submit` and `time.approve` to the permission list in `lib/access.ts` (the array of
`{ key, label, what }` beginning at line 50), granted to the delivery roles and to neither client
role. Add both arms to the `KINDS` allowlist in `app/api/workspace/route.ts` and to `SHAPES` in
`lib/actionShape.ts` — the endpoint refuses any kind absent from both, which is the behaviour
that makes those files the seam they are.

A rejection requires a reason; an approval does not. "Yes" is complete on its own; "no" is not.

**Verified by:** `npx tsc --noEmit`, then `npm run validate:scenarios` still green now that U and
V run through `apply()` rather than the pure module alone.

## 4. The freeze — the step with the regression risk

**This is the riskiest step in the plan.** It adds a refusal to `addTime`, `updateTime` and
`removeTime` in `lib/workspace.ts` — three arms that today always succeed. A mistake here does
not produce a broken timesheet; it produces a consultant who cannot record time and is not told
why. The breakage lands on the people the feature is for, in their first week of using it.

One call to `isFrozen` at the top of each arm. Three call sites, one implementation, because
three copies of a rule are three chances to disagree about it.

    The week of 17 Aug is submitted and awaiting approval. Hours cannot be changed
    until it is approved or returned to you.

**Verified by:** a scenario asserting both directions — refused inside a submitted week, and
still allowed in every other week, for every other person, and after a rejection. A guard that
only ever refuses is indistinguishable from a broken feature.

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

Mapper pair in `lib/db/map.ts`, one arm in `lib/db/persist.ts`, one read added to the
`Promise.all` in `loadWorkspace` in `lib/db/repo.ts`, `timesheets` added to `WorkspaceState`, and
`prisma.timesheet.deleteMany` added to `scrub()` in `scripts/persistence-proof.ts` — which will
otherwise fail its own completeness check, by design, because the tenant delete is `Restrict`.

Migration generated with `prisma migrate diff --from-schema <committed> --to-schema <current>`.
`--to-schema-datamodel` was removed in Prisma 7 and will error.

**Verified by:** `npm run db:migrate` then `npm run db:check` reporting three migrations applied
and 24 tables.

## 6. The persistence proof

Two checks in `scripts/persistence-proof.ts`:

- A timesheet round trip: submit, reload through `loadWorkspace`, find the same status, person,
  week and reason.
- **The freeze survives a reload.** Submit, reload, attempt an edit inside the week, be refused.
  A guard that holds only in the browser's copy of state is not a guard, and this repository has
  already shipped one thing that was true in memory and false in Postgres.

**Verified by:** `npm run audit:persistence` at 28 of 28.

## 7. `components/TimeTab.tsx`

No new screen. The existing tab gains the week's total, its status, a Submit control, and — for
somebody holding `time.approve` — Approve and Return. A returned week shows its reason.

The control is absent rather than disabled when the permission is missing. A disabled button
invites a person to find out why, and the answer is never encouraging.

**Verified by:** opening it in a browser. The `est-block` defect earlier in this project rendered
three panels as a run of unstyled text, and neither the typecheck, the build, nor the scenario
harness could see it — every scenario drives the reducer and none opens a page.

## 8. Ship

`npm run build`, package the standalone bundle **with `tar`** — `Compress-Archive` writes
backslash path separators that Linux reads as filenames, which cost three failed deploys — grep
the bundle for a string only this build contains, deploy, and confirm against the live URL.

---

## The details most likely to be got wrong

**The approval module does not fit, and the design's prose overstates it.** The design says
"reuse `lib/approval.ts`". Only half of that is available. `Approval` is genuinely generic — its
`subjectId` carries the comment *"Issues today; the shape does not assume that"* — but
`ApprovalRule` gates entry into an `IssueStatus` for a `workType`, and a timesheet has neither.
The design's own schema settles it: `decidedBy`, `decidedAt` and `reason` live on the timesheet
row, so no `Approval` record is created at all. What is genuinely reused is the `ApprovalDecision`
type and the asker ≠ decider rule, reimplemented in `decideProblem`. **Do not wire `ApprovalRule`
in.** An implementer following the prose rather than the schema loses a morning to it.

**Deciders come from the permission, not from a rule.** The design named Engagement Leader and
Platform Administrator as defaults; in practice that means whoever holds `time.approve`. There is
no rule table to configure.

**`updateTime` and `removeTime` must check the entry's *stored* date, not the incoming one.**
Otherwise an entry escapes a frozen week by editing the very field the freeze exists to hold.
Where a patch changes the date, both the old week and the new one must be open.

**The week is Monday-based and stored as an ISO date string.** Not a week number, which differs
between ISO and US conventions and is unreadable in a database row.

**An empty week is submittable.** "I was on leave" is a claim, and refusing it would leave the
one person with nothing to report unable to report it.

## Commit boundaries

Steps 1–4 are **one commit**. The rules and the arms are meaningless apart, and a half-landed
freeze is worse than none: hours that refuse to save with no timesheet able to release them.

Step 5 stands **alone**, because it carries a migration and a migration that lands with unrelated
changes cannot be reverted independently.

Steps 6, 7 and 8 are separate commits.

## What would send the design back

Named in advance, because each is cheaper to admit where it surfaces than at step 7.

- **Per-entry rather than per-week freezing** — surfaces at step 4. If some entries in a week must
  stay editable while others are frozen, the period is not the right unit and the model is wrong.
- **Approval genuinely needs to be per engagement** — surfaces at step 3, when the arm is written
  and a week spanning OAPIL and SLG has to name one decider. The design rejected this explicitly;
  if it is needed, the rejected alternative was right.
- **A timesheet has to own its lines after all** — surfaces at step 6. If the round trip cannot
  reproduce a submitted week's total because entries have since moved or been archived, then
  computing the total from live entries is unsound and the copied-lines model the design turned
  down is the correct one.

None is expected. All three are decidable from the steps that surface them, without guessing.
