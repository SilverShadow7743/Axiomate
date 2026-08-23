# Week grid and bulk approvals — design

**Date:** 2026-08-23 · **Register item:** #6 · **Status:** approved (batch go)

## The gap

Every timesheet mechanism exists — `submitTimesheet`, `decideTimesheet`, the freeze, the
asker-cannot-decide rule, `entriesInWeek`/`weekTotal`/`sheetFor`/`decideProblem` — but the
only surface is one issue's Time tab. Scenario U's original words: "nothing gathers a week
of entries to put in front of it." A consultant attests a week they can only see one issue
at a time; an approver decides weeks one issue-tab at a time and has no queue.

## The design

**No reducer or storage change.** This item is a surface over arms that already exist and
already refuse correctly. Two halves, one overlay panel.

### 1. The pure aggregation

`weekGrid(entries, person, week, personId?)` in `lib/timesheet.ts`, beside its siblings:
rows per issue carrying `byDay: number[7]` (Mon–Sun, rounded as `weekTotal` rounds) and a
`total`; plus column totals and the week total. Aggregation only — `entriesInWeek` already
owns the filtering and the id-first join.

### 2. The panel

`components/TimesheetPanel.tsx`, an overlay like ArchivePanel (same `useOverlay`/Escape
contract), opened from a **Timesheets** button on the FilterBar beside Archive — with a
count badge of submitted weeks awaiting decision, shown only to holders of `time.approve`.

- **My week**: a week picker (‹ today ›), the grid — one row per issue with hours that
  week, seven day columns, totals row and column — the week's status line (`sheetFor`),
  and Submit/Resubmit gated by `submitProblem` exactly as the Time tab gates it. A row
  navigates to that issue's Time tab: recording and correcting stay with the entry, where
  the grace gate collects its justifications. The grid GATHERS; it does not edit.
- **Approvals** (rendered only with `time.approve`): every Submitted timesheet, any person
  any week, newest first — person, week, total hours, and the week's late entries with
  their justifications (the reading the time-grace design assigned to this moment).
  Per row: Approve, and Return with its required reason. **Approve all (N)** decides every
  listed week EXCEPT the approver's own — `decideProblem` refuses self-approval per row,
  and `dispatchMany` is atomic, so one refused week would abort the whole batch; the
  pre-filter is therefore correctness, not politeness, and the button's label counts only
  what it will actually decide, with the excluded own-week said in a note.

### 3. Proof

Scenario **WG1**: the grid math (two issues, quarter hours across days, an archived entry
excluded, the id-join surviving a rename); and the bulk shape — two people's submitted
weeks plus the approver's own, `dispatchMany` of the two decidable approvals succeeding
atomically while the self-week stays Submitted, then the self-week refused individually in
`decideProblem`'s words.

## Out of scope, stated

- **Editing hours in grid cells** — corrections carry justifications and belong on the
  entry; a cell aggregates several entries and editing an aggregate is a lie.
- **A submission deadline** — still a different policy (named in the time-grace design).

## What would send this back

- Cell-level entry wanted after all — reopens where corrections and justifications live.
- Approvals wanted per-project rather than per-person-week — reopens what a timesheet is.
