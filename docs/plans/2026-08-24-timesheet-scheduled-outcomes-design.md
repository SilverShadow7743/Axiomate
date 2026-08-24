# Timesheet: scheduled outcomes for the week — design

## What this answers

`components/TimesheetPanel.tsx`'s weekly grid (`lib/timesheet.ts`'s `weekGrid`) is built entirely
from `TimeEntry` rows that already exist — it answers "what have I logged," never "what was I
staffed to work on." A consultant opening their week sees only what they already typed in; there
is nothing on screen prompting them toward real, open work they have not logged yet. The user's
own words: *"Every week timesheet should include the list of outcome which is scheduled for that
week."*

## Why this is not simply "issues with planned dates overlapping the week"

That was the first design here, and it did not survive contact with the real data. Checked before
writing a line of implementation: only 4 of 254 issues in the live tenant carry a direct
`plannedStart`/`plannedEnd`, and none carry activity-only planned dates either. Building against
that field would have shipped a feature that shows almost nothing. `Allocation` records — who is
staffed on which project, over what date range — are the opposite: only 6 exist, but all 6 cover
the current date. Checked next: does "every open issue under the allocated project" work as the
row list? No — the two currently-allocated projects are real client delivery work (`D365
Implementation`, 77 open issues; `POS Programme`, 18 open), so that scope would dump dozens of
someone else's rows onto a person 50% allocated to the project. Narrowing to issues the person
also **owns** brought real per-person counts back down to 0–24 — sane, and personal, matching what
someone would actually expect to see as theirs to log.

## What this is

`weekGrid` gains two more inputs — the person's allocations and their own issues — and adds a
zero-hour row for any issue where:

- the issue's `owner` matches the person the timesheet belongs to (the same id-first,
  name-fallback join `entriesInWeek` already uses),
- the issue sits under a project (or one of its descendant nodes) the person has an
  `Allocation` for whose `startDate`/`endDate` covers the week being viewed,
- the issue's status is not terminal (`isTerminal`, the same test the Tree view uses),
- and it is not already present from a logged entry, so one issue's rows never duplicate.

Shown for any week being browsed, past or future — a past week with owned, allocated, open work
that was never logged is exactly the gap worth surfacing, not something to hide once the week has
passed.

Clicking a scheduled-but-unlogged row opens the issue the same way a logged row already does
(`onOpen`).

## What this deliberately is not

**Not per-week granularity below the allocation itself.** An allocation typically spans months,
so the same set of owned, open issues under it will read the same across every week inside that
span — there is no finer-grained "this issue specifically, this particular week" signal in the
data model to draw on. This is staffing-level "what's mine to work on right now," not a true
weekly schedule.

**Not a new scheduling computation, and not the Tree/Schedule view's planned dates.** No `buildTree`
dependency, no rollup. Genuinely dropped, not deferred — the real data showed the field this would
have read from is essentially empty.

**Not a change to the approver's queue**, and **not per-activity** — same reasoning as before:
time is logged per issue, and the queue reads already-submitted sheets.

## Verification

A `weekGrid` scenario (or a small set) proving: an owned, open issue under a currently-active
allocation appears as a zero row; an owned issue under a project with NO active allocation for
that week does not; an owned issue under an allocated project that is terminal-status does not; an
issue under an allocated project owned by somebody else does not; an issue with both allocation
coverage AND logged entries appears once, with its real hours, not twice.

## What would send this back

- If, once built, the row counts in practice turn out noisier than the 0–24 sampled here — an
  allocation covering a large project with many issues this person happens to own — that is a
  finding about whether ownership alone narrows enough, not something to patch around with an
  arbitrary cap.
