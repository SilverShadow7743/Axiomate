# Leave report, month on month — implementation plan

Follows `docs/plans/2026-09-08-leave-report-design.md` (approved 10 Sep — trailing 6 months, no
per-project cut, reason text never shown). Ordering: the pure report builder first, proven by a
scenario before any UI exists, then the dialog and print view — a near-exact structural copy of
`FinanceReportDialog.tsx`/`FinanceReportView.tsx`, the closest and most complete precedent in the
codebase for this exact shape (period picker → live preview → .xlsx download → print view, one
`build*Report` call feeding all three so they cannot disagree) — then the Export-menu wiring last.

## Steps

**1. `lib/reports/leave.ts` (new) — `buildLeaveReport`, pure.**

```ts
export interface LeaveSummaryRow {
  person: string
  personId: string | null
  byMonth: Record<string, number> // 'YYYY-MM' -> working days taken, holiday-aware
  total: number
}
export interface PendingLeaveRow {
  person: string
  startDate: string
  endDate: string
}
export interface LeaveReport {
  months: string[] // ['YYYY-MM', ...], oldest first
  rows: LeaveSummaryRow[]
  pending: PendingLeaveRow[]
}

export function buildLeaveReport(state: WorkspaceState, endingMonth: string /* 'YYYY-MM' */): LeaveReport
```

- `months`: the 6 `'YYYY-MM'` strings ending at `endingMonth`, computed via `lib/dates.ts`'s
  existing `addMonths`/`startOfMonth` — `Array.from({length: 6}, (_, i) => addMonths(startOfMonth(`${endingMonth}-01`), i - 5).slice(0, 7))`
  or equivalent, oldest first so the grid reads left-to-right chronologically like every other
  time-series table in this codebase.
- Iterate `Object.values(state.commitments)` (no `deletedAt` filter needed — check whether
  `Commitment` carries soft-delete the way other records do; if it does, exclude deleted the same
  way `finance.ts`'s `inRange` filter does for `TimeEntry`). For each `kind === 'Leave'`:
  - `status === 'Requested'` (or `undefined` is never `'Requested'` — absent means `'Approved'`
    per `Commitment`'s own doc comment, `lib/capacity.ts:217-220` — so only an EXPLICIT
    `'Requested'` lands in `pending`) → push `{person, startDate, endDate}` to `pending`, skip
    the grid entirely for this commitment.
  - `commitmentCounts(c)` true (i.e. `status` absent or `'Approved'`) → this one counts. For each
    month in `months` whose `[monthStart, monthEnd]` overlaps `[c.startDate, c.endDate]`, clip
    the commitment's range to that month's boundaries and add
    `workingDaysBetween(clippedFrom, clippedTo, holidaySetOf(state.model))` to that person's
    `byMonth[month]`. A commitment spanning three months contributes to all three, same as
    `PC3`'s own precedent for a multi-day span clipped per period — reuse that reasoning, not a
    new clipping rule.
  - `status === 'Returned'` → excluded entirely, matches the design's own "declined, nothing to
    report" line.
- Person key: id-first with a name fallback, the identical join `finance.ts`'s `weeks` Map
  already uses (`e.personId ?? e.person.trim().toLowerCase()`) — do not invent a second join
  rule for the same problem.
- **No `reason` field exists anywhere in `LeaveSummaryRow`/`PendingLeaveRow` — not omitted at
  render time, absent from the type itself.** This is the "never shown, full stop" decision
  enforced at the type level: a caller cannot accidentally render what was never read into the
  shape in the first place. `commitment.reason`/`commitment.note` are never referenced in this
  file at all.
- Sort `rows` by `total` descending (busiest first, matching `byOwner`'s own "busiest first"
  convention elsewhere in `lib/analytics.ts`) — or alphabetically if that reads oddly for a
  leave report; a small, low-stakes call to make at write time, not worth a design detour.

**Verify:** `npx tsc --noEmit` — no harness reaches this until step 2.

**2. New scenario, working id `LV1`, in `scripts/scenario-validation.ts`.**

Proves, in one scenario per this file's convention of covering a feature's several claims
together: an `Approved` (and a status-absent, pre-E1-shaped) leave commitment's working days land
in the correct month(s) of `byMonth`, holiday-aware (reuse `HOL1`'s holiday-declaration setup
rather than inventing a second one); a commitment spanning two months contributes to both, clipped
correctly at the boundary; a `Requested` commitment appears in `pending` and contributes nothing
to any `byMonth`; a `Returned` commitment appears nowhere in the report at all; and — the type-
level guarantee from step 1, pinned as a runtime assertion too — `JSON.stringify(report)` contains
neither the word from a commitment's `reason` nor its `note`, so a future edit that accidentally
threads either back in fails the suite immediately rather than being caught only by re-reading the
source.

**Verify:** `npx tsx scripts/scenario-validation.ts` — `LV1 PASS`, scenario count 261 → 262, no
regressions.

**3. `components/LeaveReportView.tsx` (new) — the print half.**

Structural copy of `FinanceReportView.tsx`: `.pack-scrim`/`.pack-toolbar`/`.pack-page`,
`ReportHeader` for the branded title/period/generated-on block, `window.print()` for the
Print/Save-as-PDF button. Body is a person × month grid (`report.months` as columns,
`report.rows` as rows, `total` as a final column) rather than finance's three sections — the one
real structural difference from the precedent, everything else (empty-state handling, the toolbar,
the scrim) copied as-is rather than re-decided.

**4. `components/LeaveReportDialog.tsx` (new) — the picker + preview + download half.**

Structural copy of `FinanceReportDialog.tsx`, with the period picker replaced by nothing at all —
the design's own resolution is a fixed trailing-6-months window, so there is no mode/week/month/
custom picker to build; `buildLeaveReport(state, today.slice(0, 7))` is the only call, memoized
on `state`/`today` the same way finance's `report` memo is. `downloadXlsx` follows the identical
dynamic-`exceljs`-import shape (a static import would still put a spreadsheet engine in the main
chunk for every visitor, the same reason finance's own comment gives) — one worksheet, `Person`
+ one column per month + `Total`, plus a second "Pending" worksheet listing `pending` rows. Reuses
`org.logoDataUri` embedding exactly as `FinanceReportDialog` does — same firm branding, not a
second implementation of "how does a logo get into an xlsx file."

**Verify (steps 3-4 together):** `npx tsc --noEmit`, `npm run build`,
`npx eslint components/LeaveReportView.tsx components/LeaveReportDialog.tsx`. No new scenario —
display/export wiring over `buildLeaveReport`, already proven pure in step 2, the same posture
`FinanceReportDialog`/`FinanceReportView` themselves have (no scenario references either file).

**5. Wire into the Export menu — `components/IssueWorkspace.tsx`.**

Mirrors the existing `financeReportOpen` wiring exactly (`:245`, `:2280-2289`, `:3041`): a new
`leaveReportOpen` state, a new `menu-item` button in the Export dropdown right after "Finance
timesheet…" (`"Leave report…" / "Working days taken, trailing 6 months — no reasons, no
balances"`), and the dialog rendered conditionally the same way `FinanceReportDialog` is. No
permission gate beyond whatever already gates the Export menu itself — `FinanceReportDialog`
carries none either, for the same reason this report never carries reason text or rates: nothing
in it is more sensitive than what any Export-menu holder can already see spread across
Capacity tabs and the tree.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/IssueWorkspace.tsx`. No
new scenario for this step either — pure menu wiring.

## Commits

**Commit 1 — steps 1-2.** The pure report builder and its scenario, zero UI, zero production
behavior change — provable in isolation before anything depends on it.

**Commit 2 — steps 3-5.** The dialog, the print view, and the Export-menu wiring, built together
since none of the three is independently useful without the others (a dialog with nowhere to
open from, a print view nothing renders, a menu item with no dialog to open).

## What would send this back to the design

- **If `Commitment` turns out to carry a soft-delete field this plan's step 1 didn't account
  for** — surfaces immediately at `tsc` (an unused-filter lint) or, worse, silently at step 2 if
  a deleted commitment's days leak into the grid; the scenario's own assertions would need a
  deleted-commitment case added before this ships, not after.
- **If clipping a commitment to a month boundary produces an off-by-one at the boundary itself**
  (a commitment ending exactly on the last day of a month, or starting exactly on the first) —
  this is exactly the class of bug `HOL3` already caught once for a different date-math site in
  this codebase (a working-day computation silently wrong at an edge, not in the middle); the
  scenario in step 2 deliberately includes a commitment spanning a month boundary for this reason,
  not as an afterthought.

## Live verification (last, matching the design's own no-goals — no scheduled/emailed delivery to
verify, since none exists)

Open Export → "Leave report…" against production. Confirm the grid renders with real data (if any
approved leave exists in the live register today — per I14's own live-verify note, it may not,
matching that same "nothing recorded in this window" honest-empty-state as Capacity). Download the
.xlsx and open it to confirm the branding/columns match the preview. Confirm Print/Save as PDF
opens the `LeaveReportView` correctly. No test data needs creating or reverting — this report only
reads.
