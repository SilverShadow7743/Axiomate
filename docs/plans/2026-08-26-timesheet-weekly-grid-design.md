# Weekly timesheet grid for a ticket's Time tab

## Problem

`TimeTab.tsx`'s "Record time" form takes one day at a time: date, hours, activity,
billable, note, Record. Somebody who worked the same ticket for most of a week has to
repeat that five times. Everything the week needs already exists underneath — one
`TimeEntry` per `{person, date, activity, hours, billable, note}`, and a week-level
submit/approve flow in `lib/timesheet.ts` (`weekStarting`, `weekLabel`, `weekTotal`,
`sheetFor`, `submitProblem`, `decideProblem`) already wired into `sheetPanel`. What's
missing is a way to fill several days at once against that same model.

## Decisions

Three things were settled before design, because each would have reshaped the rest:

1. **Scope: per-ticket, not per-person.** The grid stays inside the ticket's Time tab —
   open a ticket, see and enter that ticket's week. A person's hours-across-all-tickets
   view is a materially different feature (new aggregation, new route) and is out of
   scope here.
2. **No new "Draft" state.** There is no save-without-recording concept in this app today
   — `Record` writes a real, attributed `TimeEntry` immediately. The grid keeps that:
   "Save Week" writes real entries the moment it's clicked, one `onAdd` per filled cell.
   The week's own status (Open → Submitted → Approved/Rejected, via `sheetPanel`) is
   untouched.
3. **Per-cell late/frozen handling, not week-level.** The existing single form shows a
   reason box only for the one date that needs it, and disables entirely when the week is
   already submitted. The grid does the same per cell, not with one shared box for the
   whole week — an approver reading a reason back later needs to know which day it
   explains.

## Architecture

`TimeTab.tsx` gains a two-mode toggle above "Record time":

- **Quick Record** — the existing single-day form, unchanged.
- **Weekly Timesheet** — new. A 7-day (Mon–Sun) grid for the currently selected `person`
  and a `week` value that starts at the Quick Record form's date's week, then moves
  independently via **◀ Previous / Next ▶**, using the same `weekLabel(week)` already used
  in `sheetPanel`.

Both modes write through the same `onAdd` prop `TimeTab` already receives — no new API
route, no new reducer arm, no batch endpoint. The entries table and `sheetPanel` below
both modes are unchanged; the grid is only a new way to populate entries, not a new way to
read them back.

## Grid cells and save

Each day column holds hours / activity / billable / note, validated per cell with the
same `checkEntry` the single form already uses. **Save Week** calls `onAdd` once per
filled-in cell (empty cells are skipped) — sequential calls against the existing arm, not
a new one. If any filled cell currently fails validation, Save Week is disabled entirely,
matching the "can't act while something's broken" pattern already used for Submit/Approve
in `sheetPanel`. There is no partial save: either every filled cell is valid and all are
recorded, or none are.

## Frozen and late cells

If `sheetFor(sheets, person, week)` for the displayed week is `Submitted` or `Approved`,
every cell in that grid renders read-only — the same condition that already disables the
Quick Record form for a frozen week. For a cell whose date is past
`state.model.timePolicy.backdatingAllowanceDays` (via the existing `backdated()` check),
an inline reason field appears in that cell only, not as a shared week-level box.

## Deliberately cut (YAGNI)

- **Copy previous week** — not built. Can be added later without touching this design.
- **Activity inherited across days with per-day override** — not built. Each cell sets
  its own activity independently; inheritance would add a second interaction mode for a
  value that's one click to set directly.
- **Person-wide, cross-ticket weekly view** — out of scope per the scope decision above.

## Testing

New scenario-suite cases, added alongside the existing time/timesheet scenarios:

- Filling 3 of 7 day cells and clicking Save Week records exactly 3 `TimeEntry` rows, no
  more.
- A cell inside an already-`Submitted` week renders read-only; Save Week cannot write to
  it.
- A cell past the backdating allowance blocks Save Week until that cell's reason is
  filled in; other valid cells in the same grid are not blocked by it individually, but
  the whole Save Week action still doesn't fire until the invalid state clears.
- Previous/Next week re-keys which entries the grid displays and re-evaluates the
  frozen/late state for the newly displayed week.
