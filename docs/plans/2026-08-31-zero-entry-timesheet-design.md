# Zero-Entry Timesheet — a meeting-derived fill, not an invented one

**Status: approved 2026-08-31** (four AskUserQuestion decisions, recorded below). Fourth
concrete step out of the product-vision pitch, and the strongest non-AI-blocked candidate
remaining — five of the eight leftover pitch items are blocked on Anthropic credits (task
#113).

## What the pitch asked for, and what this actually builds

The pitch's "Zero-Entry Timesheet" imagines a week that mostly fills itself, so a consultant
isn't reconstructing five days from memory on Friday. Built literally — filling hours from
*plans* (Allocation percentages, Assignment) — this would mean inventing a claim nobody
attested to, which is precisely what `lib/timeWindow.ts` and `lib/timesheet.ts` go out of their
way to refuse everywhere else in this codebase: `dailyCap` reports **unenforced** rather than
defaulting to eight hours; `windowOpening` refuses to infer a start date; `TimeEntry` is
documented as "the actual-level record, never a projection" (CLAUDE.md). A timesheet is an
attestation — "I claim this week is complete and correct" — and a system that pre-writes hours
nobody confirmed doing would be inventing the thing it exists to record honestly.

There is exactly one real signal in this codebase that names a *specific issue* without
guessing: a `Meeting` can carry `scopeKind: 'issue'` + `scopeId` (`lib/meetings.ts`) — a real,
dated, attendee-scoped record of "this meeting was about that issue." Everything else
(Allocation, Assignment) is project-or-issue-level *capacity or ownership*, not a record of a
particular day's actual work, and turning either into a specific day's hours means guessing
which issue — exactly the kind of invented plan this codebase's other modules refuse.

**This pass builds meeting-derived suggestions only.** A pre-filled, always-editable, must-be-
confirmed starting point — never an auto-created `TimeEntry`. Allocation-derived suggestions are
explicitly deferred; there is no design yet for which issue an allocation-only day should name.

## The four decisions

1. **Signal: issue-scoped meetings only**, not allocation-derived fill-in. The one signal that
   names a specific issue without guessing.
2. **Confirmation: pre-fill the form, not one-tap accept.** Accepting a suggestion populates the
   existing entry form's fields; the person still reviews every field and presses the existing
   Record/Save control themselves — the same review moment as typing it by hand, just started
   for them.
3. **Surfaces: both My Week and the per-issue Time tab.** `TimesheetPanel.tsx` is explicitly
   gather-only ("it GATHERS and it decides; it never edits") and stays untouched.
4. **Architecture: one new pure module**, `lib/timesheetSuggestions.ts`, called from both
   surfaces — not duplicated per-component logic, and not bolted onto `weekGrid`/
   `issueWeekCells`, whose contract is deliberately aggregate-only.

## What it computes

`meetingSuggestions(meetings, entries, person, personId, week, issueId?)` returns one candidate
per (issue, day) where:

- The person attended (`attends()`, id-first per `lib/meetings.ts`) a meeting with
  `scopeKind: 'issue'` on that day, in the given week.
- No `TimeEntry` already exists for that issue on that day — an already-filled cell is never
  touched, matching `issueWeekCells`'s own "the grid never edits a day that already has hours on
  it" rule.

Multiple issue-scoped meetings for the same issue on the same day sum their durations. Hours
round to the nearest quarter (`checkEntry`'s own rule) and clamp to `MAX_HOURS_PER_ENTRY` (12).
Default activity is `'Meeting'` — already a real `TimeActivity`. **No ownership filter**:
attending an issue-scoped meeting is itself the evidence, independent of who owns the issue; if
the person isn't permitted to log against it, the existing `addTime`/`time.recordForOthers`
check refuses exactly as it does for a manual entry today — this module doesn't re-derive that
rule.

`issueId` is optional and present only for the Time tab's per-issue call; My Week calls it
without one, across every issue the person's meetings touched that week.

## UI — My Week

A new section, **"From your calendar"**, between the day list and "Record hours" — rendered
only when there are candidates for the visible week. Each row names the issue, day, hours, and
which meeting(s) it came from. Tapping a row pre-fills the Record form's Work item / Day / Hours
(activity defaults to `'Meeting'`) and moves focus there; nothing is written until the person
taps the existing **Record** button. A row disappears once its cell is no longer open.

## UI — Time tab (per-issue weekly grid)

In "Weekly timesheet" mode, an open day (`issueWeekCells`, `hours === null`) with a matching
suggestion initializes its `WeekDayCell` draft with the suggested hours and `'Meeting'` activity
already filled in, plus a small caption naming the source meeting — instead of starting blank.
The person can accept, edit, or clear it before **Save week**, same as any other draft cell. A
day with no suggestion is unchanged from today.

## Testing

One new scenario, `ZE1` (working id), pins `meetingSuggestions()` directly: two issue-scoped
meetings on the same issue/day sum into one rounded suggestion; a project-scoped (not
issue-scoped) meeting produces nothing; a day already holding a `TimeEntry` for that issue
produces nothing even with a matching meeting; a meeting the person didn't attend produces
nothing. No new scenario for the UI wiring itself — the pure function is what's proven, matching
how `todaysMeetings()`/`decisionItems()` were tested this session rather than the panels that
render them.

## What stays untouched

No schema change — everything is computed fresh from `meetings` and `timeEntries` already in
the boot payload; no draft/pending `TimeEntry` state is introduced. `addTime`, the freeze rule,
and `checkEntry` are unchanged. `TimesheetPanel.tsx` (gather-only) is untouched. Allocation-
derived suggestions are out of scope.

## What would send this back

- If `meetingSuggestions()` cannot be made to only-ever-suggest-open-cells without a second,
  disagreeing join rule from `entriesInWeek`'s own id-first logic (i.e., if the id/name seam
  produces a suggestion for a cell that manual entry would consider already filled, or vice
  versa) — that's a real gap in the seam this feature must not paper over with a second rule.
- If, once live, meeting-derived suggestions turn out to be rare enough (few issue-scoped
  meetings actually exist in practice) that the feature reads as dead weight rather than a
  genuine time-saver — that's grounds to reconsider the signal, not to widen scope into
  allocation-derived guessing to compensate.
