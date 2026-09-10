# A leave report, month on month

**Status: approved, 10 September 2026** (all three open questions resolved below). User's direct
request — *"I would be needing leave report month on month."* Not yet built.

## What exists today, and the gap

`Commitment` (`lib/capacity.ts`) already records every leave request — person, dates, hours per
day, status (`Requested`/`Approved`/`Returned`, absent meaning `Approved` per pre-E1 history),
and a private reason. `lib/availability.ts`'s `commitmentCounts` already draws the line on what
"taken" means (`Approved` only), and `redactLeaveReasons` already draws the line on who may see
*why* (`mayReadReasons`; everyone else keeps dates, hours, status). Neither line is invented
here — both are read from where they already live.

What doesn't exist: nothing reads `Commitment` for reporting. `lib/reports/finance.ts` — the
closest existing report — explicitly excludes leave by name (its own header: *"nothing from
leave"*), because the finance report answers a different question (billable hours) and leave was
deliberately kept out of that answer. This is a new, fifth report, not an extension of finance.

## Shape

`lib/reports/leave.ts`, pure, following the same rule every report in this directory already
follows: computed live from loaded state, nothing stored, nothing that can disagree with the
tree behind it.

```
buildLeaveReport(state, months: string[] /* ['2026-06', '2026-07', ...] */)
  → { months, rows: LeaveSummaryRow[], pending: PendingLeaveRow[] }

LeaveSummaryRow { person: string; personId: string | null; byMonth: Record<string, number> /* working days taken, holiday-aware */; total: number }
PendingLeaveRow { person: string; startDate: string; endDate: string; status: 'Requested' }
```

**"Month on month" means a grid, not a period picker.** Unlike the finance report's single
`from`/`to`, this shows one row per person and one column per month across a trailing window —
the shape the request actually describes. Each cell is **working days** taken that month,
holiday-aware via `holidaySetOf(state.model)` and `workingDaysBetween` — the same machinery I13
already threads everywhere else, not new date math.

**Only `Approved` leave counts toward the grid**, via the existing `commitmentCounts` predicate —
consistent with how every other capacity number in this codebase already treats leave.
`Requested` (pending) leave is real information a manager needs but is not yet a fact about the
calendar (`lib/availability.ts`'s own doctrine), so it surfaces separately, in `pending`, not
blended into the taken-days grid. `Returned` (declined) leave appears nowhere in this report —
it was declined, nothing to report.

**Reason text is never in this report**, full stop — not gated behind `mayReadReasons` the way
the Capacity tab shows it. A report is downloaded and handed to whoever finance/HR sends it to,
which is a wider and less controllable audience than a screen gated per-viewer; the finance
report's own precedent (money/rates never leave the system, full stop, no permission gate)
argues the same way here. Named as a decision, not a default — see the open question below if
this reads too strict.

**Output**: the same export shell as the finance report — off the `Export` menu, a preview on
screen, then Download (.xlsx, exceljs) and Print/save-as-PDF, sharing the branded header
component already built for the other four report surfaces. No new UI pattern.

## Non-goals

Leave *balance* or accrual (how many days someone has left against a policy) — this codebase has
no leave-entitlement concept anywhere (`Commitment` records requests, not a balance), and
inventing one would be exactly the kind of invented information the operating principles forbid.
This report shows days taken, not days remaining. Scheduled/emailed delivery — same non-goal the
finance report already carries, revisit together later. Leave-type breakdown (sick vs. vacation
vs. other) — `CommitmentKind` has no such subdivision today; every leave is just `'Leave'`.

## Decided, 10 September 2026

1. **Which months?** Trailing 6 months from today, rolling — no date picker, always current.
2. **Reason text** — never shown, full stop, as this draft recommended.
3. **Firm-wide, per-person** — no per-project cut. Matches the request as stated; `Commitment`
   does not carry a project reference today, and adding one would be new modeling this pass
   does not need.

Status: **approved, moving to an implementation plan.**
