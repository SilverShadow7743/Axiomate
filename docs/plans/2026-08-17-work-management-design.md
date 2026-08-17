# Row actions, inline editing, and the time entry window

*Design, 17 August 2026. Direction set by the user; this records it, names what already exists,
and resolves the six places where the proposal collides with a rule this codebase already
enforces.*

The framing is the valuable part and it is adopted whole:

    Tree        what work exists
    Gantt       when work happens
    Calendar    when I work
    Timesheet   what I actually worked
    Commercial  what that work costs

Everything below serves that. It supersedes nothing in
`2026-08-17-timesheets-design.md`; it sits above it and changes where time entry is *started*
from, not what a timesheet is or how it is approved.

---

## Three parts already exist

Worth saying first, because they are proposed as new work and are not.

**The three dates are already on the issue.** `raisedDate`, `plannedStartDate` and
`plannedEndDate` — `prisma/schema.prisma:229,230,235`. Nothing needs adding to carry
Created / Start / Due.

**Backdating is already representable.** `TimeEntry.date` is the day the work happened and
`TimeEntry.createdAt` is the day it was typed in; the schema comment says so in as many words.
What is missing is not the two dates. It is the *justification* and the *approval* that attach
when they differ by more than the allowance.

**Approval machinery exists.** `lib/approval.ts` encodes "a rule names the decider roles, and
the asker cannot be the decider". The timesheets design already commits to reusing it rather
than growing a second approval concept free to disagree with the first. A window extension is
an approval, not a new mechanism.

---

## Six collisions, and how each resolves

### 1. Maximum Daily Hours does not belong to the issue

The proposal puts `Maximum Daily Hours [8.0]` in per-issue time-recording configuration. That
figure is a property of **the person on the day they worked**, not of the issue they worked on.

Two problems follow from storing it on the issue. A consultant on a four-day week has an
eight-hour issue cap that is wrong for them, and nothing reconciles the two. And a person
splitting a day across three issues gets three caps of eight, which permits twenty-four hours in
a day — the cap that matters is the one across issues, which no issue can see.

It also breaks the rule this codebase is built on: a derived value is never stored as fact. Eight
is a copy of something already known.

**Resolves to:** the daily cap is the person's working pattern on the work date —
`valueAt(versions, 'person.workingPattern', person, workDate)`. This is exactly what the
effective-dating work exists for, and it means a cap applied to time logged in June uses June's
pattern even if the person moved to a four-day week in July.

`valueAt` returns null when no pattern was recorded for that date. That is the feature, not a
gap: the answer is "we do not know what their day was then", and the entry is accepted with the
cap unenforced and labelled, rather than silently checked against a fabricated eight.

The issue keeps a cap of its own, but a different one: **remaining effort** — estimate minus
hours already logged. That is genuinely issue-level and it is the number a delivery lead
actually wants a warning on.

### 2. The fallback start date must say it is a fallback

> If Start Date is missing: `Timesheet Start = Created/Raised Date`

Sensible, and it is the pattern the effective-dating design refused: substituting a default for
an absence and presenting the result as though it were recorded.

The vocabulary for this already exists — `lib/intake.ts` carries `stated | guessed | default`
for exactly this reason. The window is derived, so it is free to fall back; it is not free to be
silent about it.

**Resolves to:** the window carries its own provenance and the UI shows it.

    Time entry window   29 Jul → 20 Aug
                        opens at the raised date — no start date set

not

    Time entry window   29 Jul → 20 Aug

### 3. Work date and entry date are bitemporal, and here that is right

Recording both "when the work happened" and "when it was claimed" is a second time axis.
Bitemporality was considered and **rejected** during the effective-dating design, in favour of a
single valid-time axis plus `stampedFrom`.

That rejection was scoped to versions and should not be read as a ban. For attested hours the
second axis is the point: "when did you say you worked this" is a question an auditor asks and a
single axis cannot answer. The columns already exist.

### 4. The window should follow the issue's state, not only its dates

The proposal closes the window at the due date and offers an extension flow when the issue is
still open. The flow is right; the default is the wrong way round.

Every issue that runs past its due date — which is most of the ones that need attention — would
generate an extension request before anybody could log the time they are genuinely spending. The
predictable result is that extensions become a formality people click through, and the audit
trail fills with approvals nobody read. A control that fires on the common case stops being a
control.

**Resolves to:** the window closes when the **issue** closes, not when its due date passes. The
due date drives a *warning* on the entry and a flag on the issue —

> Logged 3 days after the due date. Still open.

— which is information a delivery lead can act on, and which does not require a person to ask
permission to record something true. Extension-with-reason is kept for the case that genuinely
warrants it: logging time against an issue that is **already closed**.

### 5. Duplicate must record that it is a duplicate

`Duplicate` is on the proposed row menu. This register carried 48 issues that were the same
points re-circulated on two spreadsheets, and they were removed today because nothing recorded
that they were copies.

**Resolves to:** `Duplicate` mints a `DUPLICATE_OF` relationship from the copy to the original,
always. The relationship type already exists in the schema. A copy that does not know what it
copied is how a register grows a second version of the truth.

### 6. Inline editing has to answer the reason question

Every mutation here is attributed, and the ones that change a commitment carry a reason. A
click-to-edit Status cell with no reason box either bypasses that discipline or writes empty
reasons into the trail, and an empty reason is worse than none — it makes the field look
answered.

**Resolves to:** two tiers, decided by whether the change is one somebody may later be asked to
justify.

| Field | Inline | Reason |
|---|---|---|
| Owner | yes | no |
| Planned start, due date | yes | no |
| Severity | yes | no |
| **Status** | yes | **yes — a short one, inline** |
| Subject, description | no — opens the editor | — |

Status is the field a client reads as a commitment, and "moved to Done on Tuesday, because …"
is the entry that makes the trail worth keeping.

---

## Row actions

A `⋮` menu on every tree line, from the existing `SelectionToolbar` verbs plus three new ones:

| Action | Existing action | Note |
|---|---|---|
| Add child / Add sibling | `create` | Sibling is the same arm with the parent of the selection |
| Edit | opens `DetailPanel` | |
| Move | `move` | |
| Duplicate | new | mints `DUPLICATE_OF` — §5 |
| Link | `link` | |
| **Log time** | `addTime` | new dialog, prefilled with today and the issue |
| Schedule | selects in `GanttChart` | |
| More | archive, close, convert | |

`components/TreeGrid.tsx` grows the menu; `components/SelectionToolbar.tsx` keeps its verbs, so
the toolbar and the row menu call the same reducer arms and cannot drift into doing different
things under the same name.

## The calendar as a timesheet workspace

A per-person month grid of issue × day, with a day cell opening the same Log time dialog. It
reads `TimeEntry` and writes through `addTime` / `updateTime` — no new storage, and the existing
freeze rule (a submitted week refuses edits) applies unchanged because it lives in the reducer
rather than in a screen.

**My timesheet** — the person's own week, with daily totals, expected hours from their working
pattern at that date, and the variance — is the same data grouped the other way, and is where
`Submit week` lives.

## The rule, stated once

    timeEntryAllowed(issue, person, workDate) =
        issue is open
        AND person is the owner, or holds time.logForOthers
        AND workDate is not before the window opens
        AND the week is not already submitted or approved

    backdated(workDate, entryDate) = entryDate - workDate > allowance
        → justification required, approval required

    dailyCap(person, workDate) = valueAt(person.workingPattern, workDate)?.hoursPerDay ?? unenforced

Pure, in `lib/timeWindow.ts`, no clock and no I/O — so it can be driven directly before anything
depends on it, and so a refusal can be shown on screen before the user tries to save.

Not a stored `TimesheetEnabled` boolean, for the same reason nothing else derived is stored: a
flag and the dates it was computed from are free to disagree, and only one of them is true.

---

## What this does not build

Rates and money — deferred until hours are attested, which is the timesheets design's own
condition. Partial approval of a week. Delegated submission. Per-issue billable defaults; the
entry carries `billable` already.

## Order

1. `lib/timeWindow.ts` — pure, driven directly, no callers.
2. Row menu on `TreeGrid` over existing actions — no new reducer arms, so it is provable against
   the suite as it stands.
3. Inline editing, with the two tiers of §6.
4. Log time dialog + the window rule wired to `addTime`.
5. Calendar grid, then My timesheet.
6. The timesheets plan as already written — submission, freeze, approval.

Steps 1–3 touch no storage. Step 4 is the one carrying regression risk: it puts a refusal in
front of `addTime`, an arm that currently always succeeds, and the person it lands on is a
consultant at the end of a week with hours to record.
