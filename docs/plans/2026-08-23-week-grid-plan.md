# Week grid and bulk approvals — implementation plan

**Design:** `2026-08-23-week-grid-design.md` · **Date:** 2026-08-23

Ordering: the pure aggregation with WG1 driving it before any surface exists, then the
panel, then the plumbing, then the deploy. No reducer, wire, or storage change anywhere —
the arms this panel dispatches all exist and are already proven.

## Steps

**1. `weekGrid` + WG1 — `lib/timesheet.ts` (check endings first), `scripts/scenario-validation.ts` (CRLF).**
`weekGrid(entries, person, week, personId?)` → `{ rows: { issueId, byDay: number[7],
total }[], byDay: number[7], total }`, rounding as `weekTotal` rounds, delegating filtering
to `entriesInWeek`. WG1: two issues with quarter-hour entries across days; an archived
entry excluded; the id-join matched through a rename (personId set, name stale); the bulk
shape — two other people's submitted weeks approved atomically via the dispatchMany
equivalent (sequential `ok` folds over one chain), the approver's own week refused
individually in `decideProblem`'s words and still Submitted after.
*Verify:* `npm run validate:scenarios` → 91 scenarios, 0 FAIL parsed from JSON (python,
utf-8); WG1 PASS.

**2. The panel — `components/TimesheetPanel.tsx` (new, LF).**
Overlay with `useOverlay` + Escape like ArchivePanel. Props: `state`, `actor`, `today`,
`onSubmitWeek`, `onDecideWeek` (both exist on DetailPanel's signature), `onDecideMany:
(ids: string[]) => void` for the batch, `onOpen(issueId)`, `onClose`. My-week half: week
picker state (`weekStarting(today)` initial, ±7 days), `weekGrid` rows, `sheetFor` status
line, Submit gated by `submitProblem`. Approvals half rendered only when
`can(state.model, actor, 'time.approve').allowed`: all Submitted sheets sorted newest,
late entries (justification non-null) listed per row with reasons, Approve / Return with
reason input per row, **Approve all (N)** where N counts sheets whose
`decideProblem(sheet, 'approved', undefined, attester)` is null — THE DETAIL THIS PLAN
EXISTS FOR: `dispatchMany` is atomic and one refused self-approval aborts the whole batch,
so the pre-filter is correctness; the excluded own week gets a one-line note.
*Verify:* `npx tsc --noEmit` clean (the component compiles unused).

**3. Plumbing — `components/IssueWorkspace.tsx` (CRLF, python), `components/FilterBar.tsx`
(check endings), `app/globals.css` (CRLF).
THE STEP CARRYING THE MOST REGRESSION RISK** — it touches the FilterBar every view renders
and the workspace's dispatch plumbing; a wrong prop there blanks the toolbar for everyone.
`timesheetsOpen` state beside `archiveOpen`; FilterBar gains a Timesheets button beside
Archive, its badge counting Submitted sheets ONLY for approvers (computed in
IssueWorkspace, passed as a number-or-null so FilterBar stays dumb); panel wired:
`onSubmitWeek`/`onDecideWeek` reuse the existing dispatches, `onDecideMany` uses
`dispatchMany` of `decideTimesheet` approvals, `onOpen` routes through `revealIssue` +
the Time-tab request the Inbox already uses. Grid CSS beside the inbox-pref styles.
*Verify:* `npx tsc --noEmit && npm run build` clean.

**4. Sweep, deploy, checklist section 27, push.**
Suite parsed, persistence (50 — nothing stored changed), attribution, tenancy. Clean-room
release → deploy → health probe → `git push origin master`. Checklist 27: the button and
badge; the grid gathering a real week; submit from the panel; the approvals queue showing
late-entry reasons; Approve all skipping the approver's own week with the note; browser
half deferred with a stated reason if the Chrome extension is still disconnected.

## Details most likely to be got wrong

- **The Approve-all pre-filter is correctness, not politeness** — `dispatchMany` aborts the
  whole batch on one refusal, and the approver's own submitted week is always refusable.
- **The grid gathers, never edits** — a cell aggregates several entries; routing to the
  Time tab is the edit path, where the grace gate collects justifications.
- **`weekGrid` delegates to `entriesInWeek`** — re-filtering locally would fork the id-join
  rule the ID1 work tightened.
- **The badge is permission-gated in IssueWorkspace, not FilterBar** — FilterBar has no
  `can()` today and should not grow one.
- **FAIL gates parse JSON** — python, utf-8 stdout.

## Commits

Step 1 alone. Steps 2–3 together (a panel nothing renders is meaningless alone).
Step 4 with the checklist.

## What would send the design back

- Cell-level entry wanted — surfaces at the first grid use (step 4); reopens where
  corrections live.
- Per-project approval wanted — surfaces at the approvals queue review; reopens what a
  timesheet is.
