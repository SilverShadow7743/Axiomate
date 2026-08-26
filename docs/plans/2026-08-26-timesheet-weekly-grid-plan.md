# Weekly timesheet grid for a ticket's Time tab — implementation plan

Follows `docs/plans/2026-08-26-timesheet-weekly-grid-design.md`, approved by the user.
Quotes below are that design's constraints, not restated from memory.

## What already exists and is reused, not rebuilt

Reading `lib/timesheet.ts` and `components/TimesheetPanel.tsx` (the person-wide,
cross-issue, **read-only** week gatherer built for the 2026-08-23 week-grid design)
surfaced precedent this plan follows rather than reinvents:

- `daysOfWeek(week)` already returns the 7 ISO dates Monday–Sunday. No new date-math is
  needed for the grid's columns.
- `entriesInWeek(entries, person, week, personId)` already does the id-first,
  name-fallback join and week-bounds filter `weekGrid` builds on. It is not scoped to one
  issue — this plan filters its result to `issueId` locally, the same way `weekGrid`
  groups its result by `issueId` for its own rows.
- **The independent-week-state pattern already exists and is proven.** `TimesheetPanel`
  holds its own `useState(() => weekStarting(today))`, moved by `addDays(week, ±7)` with
  a "This week" reset — entirely decoupled from any other date picker on the page. This
  settles an ambiguity the design left open: the new grid's week must **not** reuse
  `TimeTab`'s existing `week = weekStarting(date)` (the value `sheetPanel` already reads
  off the Quick Record date). It gets its own `gridWeek` state, following
  `TimesheetPanel`'s established shape. `sheetPanel` keeps reading Quick Record's `date` s
  week exactly as today — the design's "stays exactly as-is below both modes" is only true
  if grid navigation cannot move what `sheetPanel` shows.
- **Multiple `TimeEntry` rows can exist for the same person+date+issue.** `weekGrid`
  sums them (`row[slot] += e.hours`) rather than assuming one — confirmed by scenario
  `WG1`'s fixture, where `t1` and `t2` are two entries on `OAPIL-1` on the same day and
  the grid reports their sum. The design's "grid is a new way to populate entries, not a
  new way to read them back" therefore has one gap it didn't address: what a day cell
  does when entries already exist for it. This plan closes it (Step 2) rather than
  reopening the design: such a cell shows the existing summed hours, read-only, the same
  aggregate-not-edit stance `TimesheetPanel` already takes ("it GATHERS... it never
  edits"). Save Week only ever writes to a cell that starts empty.

## Step 1 — Pure helpers and their scenarios

**Files:** `lib/timesheet.ts`, `scripts/scenario-validation.ts`.

Add two functions to `lib/timesheet.ts`, beside `weekGrid`:

```ts
/** One issue's week, as 7 cells — existing hours (summed, read-only) or null (open to entry). */
export function issueWeekCells(
  entries: TimeEntry[], issueId: string, person: string, week: string, personId?: string | null,
): { date: string; hours: number | null }[]

/** The first reason Save Week cannot fire, or null. Client-side gate — see Step 2's regression note. */
export function gridSaveProblem(
  cells: { date: string; hours: number; justification?: string }[], // filled cells only
  today: string,
  sheets: Timesheet[], person: string, week: string, personId: string | null | undefined,
): string | null
```

`issueWeekCells` reuses `entriesInWeek` + `daysOfWeek`, filters to `issueId`, and sums
duplicate-day entries the same way `weekGrid` does — a cell with any existing entry
reports its summed `hours` and is never `null`. `gridSaveProblem` reuses `isFrozen` /
`frozenMessage` for the week-frozen case, then `checkEntry` per cell (imported from
`lib/time.ts`, same as `TimeTab.tsx` already does) for each filled cell, and treats a
cell whose `backdated(date, today, allowanceDays).justificationRequired` is true but
whose `justification` is blank as its own blocking reason — the same rule
`TimeTab.tsx`'s single form already enforces, made checkable over a set of cells instead
of one.

**Verify:** `npx tsc --noEmit`, then new scenarios `TG1`–`TG4` in
`scripts/scenario-validation.ts` (id prefix confirmed unused —
`grep -n "'TG" scripts/scenario-validation.ts` currently returns nothing), run with
`npm run validate:scenarios`:

- `TG1` — `issueWeekCells` on a week with entries on 2 of 7 days, one of those days
  holding two entries (reuse `WG1`'s two-entries-same-day fixture): the two remaining
  days report `null`, the two populated days report `hours` as their sum, not their
  count.
- `TG2` — `issueWeekCells` excludes another person's entries and a deleted entry, and
  resolves by `personId` across a stale display name — same three guards `WG1` already
  proves for `weekGrid`, restated for the issue-scoped function so a regression in either
  can't hide behind the other's passing test.
- `TG3` — `gridSaveProblem` returns the frozen-week message when `sheetFor` reports
  `Submitted`, before it looks at any cell.
- `TG4` — `gridSaveProblem` returns null for a set of valid filled cells, returns a
  reason when one cell exceeds `MAX_HOURS_PER_ENTRY`, and returns a reason when one cell
  is backdated past the allowance with no justification — three sub-cases in one
  scenario, matching this file's existing style of one scenario asserting several related
  booleans at once (see `WG1`, `OM2`).

This step needs nothing that isn't already provable without a browser: `expect: PASS` on
`npm run validate:scenarios` is the whole of its verification, and it stands alone even
before any component calls either function.

## Step 2 — Wire the grid into `TimeTab.tsx`

**File:** `components/TimeTab.tsx`.

- A `mode` state (`'quick' | 'week'`), defaulting to `'quick'`, rendered as two buttons
  above "Record time" — the existing form is untouched when `mode === 'quick'`.
- A `gridWeek` state seeded from `weekStarting(date)` on first render, then moved only by
  Previous/Next (`addDays(gridWeek, ∓7)`, mirroring `TimesheetPanel`'s exact pattern
  including its "This week" button) — never re-derived from `date` after that, per the
  precedent note above.
- The grid itself: `daysOfWeek(gridWeek)` for columns, `issueWeekCells(...)` for
  pre-fill. A day with `hours !== null` renders read-only (the summed total, styled like
  the existing entries table's `mono` cells). A day with `hours === null` renders
  hours/activity/billable/note inputs, each validated on change with `checkEntry` (same
  call the Quick Record form already makes) and, when `backdated(...).justificationRequired`
  is true for that date, its own inline reason input — not a shared box.
- **Save Week**, gated by `gridSaveProblem` over every currently-filled cell — disabled
  whenever it returns non-null, with that string as the button's `title`, matching this
  file's existing "refusal as a note, not a mystery disabled button" convention
  (`cannotSubmit`, `cannotApprove` above already do this).
- On click, Save Week calls `onAdd` **once per filled cell, sequentially, awaiting each
  call's boolean result before starting the next.** If a call returns `false`, the loop
  stops immediately — remaining filled cells are not attempted — and the cells already
  written are shown as written (their `hours !== null` state now, from the next render's
  `issueWeekCells`), the failed cell keeps its input and its error, and the rest of the
  week's inputs are left exactly as typed so nothing entered is lost.

### The regression-risk step, named

This is it. `TimeTab.tsx` is the live component every time-recording user interacts with
today, and this step is the only one touching it. The specific risk: **`onAdd` has no
transaction or batch form — it is `N` independent reducer calls**, so "either all filled
cells save or none do," which the design states as a requirement, is not something the
grid can *guarantee* — only make very unlikely. `gridSaveProblem` validates every filled
cell client-side before any `onAdd` fires, which is the strongest guarantee available
with the existing signature (never call `onAdd` for anything unless every filled cell
already passed the same checks the reducer itself applies). What it cannot rule out is a
state change *between* the client check and the sequence completing — the week becoming
frozen mid-sequence because someone else submits it in the few hundred milliseconds the
loop takes, or `today` rolling over past midnight mid-sequence turning a valid date
backdated. Both are rare and both are handled by the stop-immediately-on-first-failure
behavior above rather than by pretending they can't happen. True atomicity would need a
new batch reducer arm, which the design explicitly does not include — this is a stated,
accepted limitation, not a bug to chase in this step.

**Verify:** `npx tsc --noEmit` and `npm run build` (this component is part of the
production bundle; a build failure here is the cheapest place to catch a type error
before it reaches the browser step). No new scenario-suite entries here — the logic
worth scenario-testing already moved into Step 1's pure functions; this step is JSX and
wiring, which the suite cannot exercise.

This step is one commit. The grid, its state, and the Save Week handler are meaningless
split apart — a grid with no way to save, or a save handler with no grid calling it, is
not a working intermediate state worth its own commit.

## Step 3 — Interactive verification

**No files changed.** Start the dev server, and — following this session's established
single-operator verification pattern from the client-pack work (`AXIOMATE_ENTRA_CLIENT_ID`
blanked for that one dev-server process only, `.env` itself untouched) — use Chrome
automation against a real ticket with existing time entries to confirm what no test
harness can:

- Switching to Weekly Timesheet shows the current week with any existing days correctly
  read-only and summed, others open.
- Filling 2–3 empty days and clicking Save Week records exactly that many entries, visible
  immediately in the existing entries table below, and those days now render read-only on
  the grid.
- Next Week / Previous Week moves the grid without moving `sheetPanel`'s status line or
  the Quick Record form's date.
- A day past the backdating allowance shows its inline reason field and blocks Save Week
  until filled; a week already Submitted renders every cell read-only.

Print/PDF automation froze the tab earlier this session (`docs/plans/2026-08-25-client-pack-plan.md`'s
step-2 note) — nothing here calls `window.print()`, so that failure mode does not apply,
but if any click unexpectedly triggers a native browser dialog or the tab stops
responding, close the tab and open a fresh one rather than retrying against a frozen one.

## What would send the design back

- **If entries commonly split across several activities on the same day for the same
  issue** (not the occasional correction-plus-original case `WG1` models, but a routine
  pattern), the read-only "summed total" cell hides which activities compose it and gives
  nobody a way to add a fourth without leaving the grid. Surfaces while writing `TG1`'s
  fixture in Step 1 if realistic sample data turns out to look like this — if so, the
  single-cell-per-day model itself is wrong, not just incomplete, and the design needs
  a per-activity row, not a patch.
- **If `onAdd` turns out to have any per-call side effect unsafe under a tight sequential
  loop** — an id-minting collision, a rate limit, anything that assumes calls are spaced
  by real user think-time — Step 2's Save Week becomes unsafe no matter how carefully
  client-side validation is done. Surfaces in Step 3's browser verification, since it is
  the first point real sequential calls actually fire. If found, this goes back to
  design: it would mean "call onAdd N times" is the wrong shape and a real batch arm is
  needed.
- **If another component reads `TimeTab`'s current `week`/`date` expecting it to reflect
  "what week is this screen showing" as a single value** (checked via
  `grep -rn "week" components/ | grep -i TimeTab` before Step 2's commit) — introducing a
  second, independent `gridWeek` would then desynchronize something outside this file
  that the design didn't account for. Cheap to check before writing any code; expensive
  to discover after.
