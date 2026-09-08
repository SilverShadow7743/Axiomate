# Holiday- and leave-aware scheduling — threading a model that already exists into the engine that doesn't use it

**Status: built (parts 1 and 2), 8 September 2026.** Scoped from Nishant's own words comparing
Hive's planning: *"one thing which i liked is planning it better [through] calendar like
holiday calendar, weekend, leaves."* Two of the three open questions were approved and built
the same day; the third (per-person leave in due-date math) is scoped separately below as its
own follow-up, not folded into this build.

## Build summary

**Part 1 — thread org holidays into the mechanical call sites.** `lib/dates.ts`'s
`workingDaysBetween`/`addWorkingDays` already took an optional `holidays` set; every caller
now passes `holidaySetOf(state.model)`. Beyond the sites named in the draft
(`proposeTargetDate`, `computeDurations`, `watch.ts`'s three checks, `milestoneRisk`), the same
pass found and fixed the identical gap in `lib/estimation.ts` (`deriveTimeline`'s finish-date
projection, `scheduleVarianceDays`'s working-days-late count — a different, working-day-based
function from `criticalResolutionPath`'s own calendar-day `scheduleVarianceDays` field, which
is a distinct, pre-existing name collision left as found), `lib/analytics.ts`'s `byAgeBucket`,
and the inline overdue/dueSoon day-counts rendered directly in `CommercialPanel.tsx`'s
milestone table — all reached the same way, `state.model` already in scope at every site.

**Part 2 — `criticalResolutionPath` becomes weekend- and holiday-aware.** A new
`shiftWorkingDays(iso, days, holidays)` in `lib/dates.ts` — `shiftIso`'s bidirectional working-
day counterpart, since FF/SF dependency offsets are routinely negative and `addWorkingDays`
only advances forward. Applied to the four dependency-candidate computations in
`criticalResolutionPath` (FS/SS/FF/SF) and to `validateChange`'s own FS-lag check, so a
drag-schedule can no longer satisfy a calendar-day lag the critical path itself would reject.
**Deliberately left as calendar-day**: the activity's own earliest-finish-from-its-own-span
computation (`ef.set(id, shiftIso(start, span))`) — that reproduces an already-fixed planned
duration, not a fresh gap, and conflating the two would silently redefine what an activity's
duration means. `scheduleVarianceDays`/`slackDays` stayed calendar-day diffs between two
(now correctly holiday-adjusted) dates — a meaningful "how many calendar days late," not a
second working-day count layered on top.

**A real defect, caught before commit, not after.** The first pass applied
`shiftWorkingDays(pFinish, lagDays - span, holidays)` to FF/SF exactly as it did to FS/SS. That
is wrong: `span` is a calendar-day quantity (it feeds `ef.set(id, shiftIso(start, span))`,
deliberately calendar-day per above), so folding it into a working-day shift consumes it as
working days too, and a large enough span could make the successor finish *before* the
predecessor — exactly the ordering an FF/SF edge exists to forbid. An advisor review caught
this before anything shipped; `HOL3` reproduces the discriminating case (a single-day
predecessor finishing on a Monday, FF+0 to a 3-calendar-day successor) and would have failed
under the first version. The fix: shift only the lag in working days, then apply the span in
calendar days afterward — `shiftIso(shiftWorkingDays(pFinish, lagDays, holidays), -span)` — so
the two quantities never mix units.

**Verification**: three new scenarios. `HOL1` (SLA target and working-duration both skip a
declared holiday), `HOL2` (an FS dependency with no lag now lands on the following Monday, not
Saturday, and a declared holiday on that Monday pushes it to Tuesday; `validateChange` refuses
a drag that would violate the same rule), `HOL3` (the FF/SF unit-mismatch regression test
above). Clean `tsc`, 256 scenarios (+3, zero regressions — before HOL1/HOL2/HOL3 were added,
`data/validation.json` was byte-identical to the pre-change baseline, confirming no existing
fixture carries a declared holiday or exercises FF/SF), clean build, clean tenancy/attribution/
restore/estimation audits.

## A tracking correction, stated plainly

This was called "I9 finding 1" in conversation while triaging the backlog. That was wrong.
`docs/plans/2026-09-08-automation-actions-design.md`'s actual finding 1 is a different thing —
a bare calendar-interval *trigger* for automation rules ("every Monday at 9am," with no single
issue to act on). This doc is not that. It is tracked as **I13** in `docs/pending-actions.md`;
I9's own row is unchanged.

## What Axiomate already has — more than the comparison assumed

Before assuming a gap, the codebase was checked, and the holiday/weekend/leave model is
**already built**, and already correctly wired into the *capacity and availability* side of
this product:

- `lib/config.ts:810-843` — `Holiday { date, name }`, stored on `OperatingModel.holidays`.
  `holidaySetOf(model)` is the one reader. `setHolidays` is a real config op
  (`lib/workspace.ts:1545, 8162-8182`) — a firm can already declare its own holiday calendar
  today, through Configuration.
- `lib/dates.ts:25-68` — `isWeekend` (Sat/Sun), and `workingDaysBetween`/`addWorkingDays` both
  already take an **optional** `holidays?: ReadonlySet<string>` — the exact shape this doc
  proposes threading further, not inventing.
- Leave is a `Commitment` (kind `'Leave'`, approved/pending/returned) — `lib/availability.ts`.
  Approved leave zeroes a day outright; pending leave is surfaced as a named conflict rather
  than silently subtracted. Consumed by `capacityFor`/`availabilityFor`.
- **Already threaded correctly**: `lib/portfolio.ts:222`, `lib/replanning.ts:50`,
  `lib/assist.ts:70`, `lib/forecast.ts:65`, and `lib/workspace.ts:7053` all call
  `holidaySetOf(state.model)` and pass it into `availabilityFor`/`overlapWorkingDays`. The
  capacity/availability/forecast/replanning subsystem — "who has time, when" — already accounts
  for holidays and leave. This is not the gap.

## The actual gap — the scheduling and due-date engine never receives it

`lib/schedule.ts`, `lib/watch.ts`, and `lib/milestone.ts` compute due dates, overdue/at-risk/
due-soon status, and the dependency-chain project schedule using the *same*
`workingDaysBetween`/`addWorkingDays` functions above — but every call site omits the
`holidays` argument. A declared org holiday is silently treated as an ordinary working day for
every one of these:

- `lib/schedule.ts:165` `proposeTargetDate` — the SLA target date from an issue's raised date.
  Called from `lib/sla.ts:97` (the plan-and-commit-dates flow), `components/DetailPanel.tsx:891`,
  and three sites in `components/IssueWorkspace.tsx`.
- `lib/schedule.ts:174` `computeDurations`'s `workingDuration` — the working-day count shown on
  planned rows (`lib/tree.ts:68,171,249`).
- `lib/watch.ts:138,142,150` — the overdue/dueSoon/stale detection `observe()` runs on every
  scheduled pass.
- `lib/milestone.ts:312` `milestoneRisk` — a milestone's own due-soon window.
- `lib/workspace.ts:2391, 3548-3549` — `addWorkingDays` calls while building a schedule from a
  template's phase weights.

All of these already have `state`/`state.model` in scope at the call site (confirmed by
reading each), so `holidaySetOf(state.model)` is a one-line addition at every one of them —
mechanical, not a redesign, and the exact pattern `lib/portfolio.ts`/`lib/replanning.ts`/
`lib/assist.ts`/`lib/forecast.ts` already proved safe. `milestoneRisk` alone needs a new
parameter threaded from its caller, since it currently receives no model at all.

## The harder case — `criticalResolutionPath` has no calendar awareness at all

The actual dependency-chain project-schedule projection (`lib/schedule.ts:209-359`, spec §11)
does not use `workingDaysBetween`/`addWorkingDays` — it uses its own `shiftIso`
(`lib/schedule.ts:361-363`), which is **pure calendar-day arithmetic**: not even the plain
weekend skip the SLA math already has, let alone holidays. Every `lagDays`/span computed
through the dependency graph currently assumes Saturdays and Sundays are ordinary working days.

This is a bigger change than the mechanical threading above, because `criticalResolutionPath`'s
output already reaches numbers people read as commitments: its own `scheduleVarianceDays` field
(shown in `components/DetailPanel.tsx:1258-1263`) and `slackDays` on every CRP node. Making
`shiftIso` weekend/holiday-aware changes what "2 days of lag" means for every dependency
already entered — existing variance and slack numbers move, for engagements that have
dependencies configured today. That is a real, visible change to a number people already look
at, not a silent internals fix, and belongs in its own decision rather than folded into the
mechanical pass.

## What this doc does not propose

**Per-person leave in due-date math.** Once org holidays are threaded through, no scheduling
call site above would yet read an individual assignee's own approved leave — only the org-wide
`holidaySetOf`. Leave already exists (`lib/availability.ts`'s `Commitment`) and already affects
*capacity* (how many hours someone has), but nothing computes "this issue's own due date should
move because its owner is on leave next week." That is a materially different question — whose
leave counts (the current owner only? every future assignee?), and whether a due date silently
moving because of one person's calendar is a good idea versus a visible flag instead — and is
named here as a real gap, not folded into this doc's proposal.

## Open questions for Nishant — resolved 8 September 2026

1. **Thread `holidaySetOf(state.model)` into the mechanical call sites** — approved, built (see
   Build summary above).
2. **Should `criticalResolutionPath` become weekend/holiday-aware too**, accepting that
   existing slack/variance numbers move for engagements with dependencies already entered? —
   approved, built.
3. **Should an issue's own due-date math consult its assignee's approved leave**, not just org
   holidays? — approved to scope, **not built**. This needs its own design pass: whose leave
   counts (current owner only? every future assignee?), and whether a due date should shift
   silently or surface as a visible flag instead. Tracked as its own follow-up, not bundled into
   this build — see `docs/pending-actions.md`.
