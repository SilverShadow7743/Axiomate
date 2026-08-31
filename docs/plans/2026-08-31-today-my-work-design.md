# Today — My Work becomes the real home screen

**Status: approved 2026-08-31** (three AskUserQuestion decisions, recorded below). First
concrete step toward the product-vision pitch — one feature, not the whole roadmap: this is
"My Work as home screen" (⭐⭐⭐ in that pitch), scoped down to what's buildable today without
new AI capability or new calendar integration.

## The three decisions

1. **Scope: a single glance at what needs me today, not an hour-by-hour schedule.** No
   time-blocking of work items, no Outlook/Graph sync required for this pass — both real,
   larger efforts deferred.
2. **Landing: My Work becomes the unconditional default.** Every sign-in lands here, not only
   when the reason-grouped list is non-empty. Tree stops being the fallback default.
3. **Approach: extend the existing docked My Work view in place**, over building a separate
   Today route or just flipping the landing rule alone.

## What's already real, that this design builds on rather than invents

- `MyWorkPanel` — the existing docked view, reason-grouped (`decide → overdue → blocked →
  attest → due → open`, per `REASON_ORDER` in `lib/mywork.ts`), ranked and self-explaining.
- `Meeting` (`lib/meetings.ts`) — a real, live reducer-backed domain concept from the E4
  meetings phase: `startAt`/`endAt` (ISO datetimes), `attendeeIds` (directory ids — real
  invitations, each lands on that person's My calendar), optional `scopeKind`/`scopeId` linking
  a meeting to the work it's about, soft-deleted via `deletedAt`.
- `directoryPersonFor(state.model, actor)` — the one function every person-resolution in this
  app already uses (`lib/mywork.ts`, `Inbox.tsx`, notification routing in `IssueWorkspace.tsx`).

## The addition

A new "Today" section renders above the existing reason-grouped list, inside the same docked
`MyWorkPanel` — no new view, no new route, no new sidebar entry.

**Data:** a new pure function (`lib/mywork.ts`, alongside `myWork()`) —
`todaysMeetings(state, actor, today)` — filters `state.meetings` to rows where `deletedAt` is
null, `attendeeIds` includes the resolved person's id, and `startAt` falls on `today`; sorted by
`startAt` ascending. No new props into `MyWorkPanel` — it already receives `state`/`actor`/
`today`.

**What it does NOT do:** due-today work items are not duplicated into this section — they
already surface in the existing `due` reason group below. Meetings and ranked work stay as two
things shown together, not merged into one timeline (that merge is the hour-by-hour version,
explicitly out of scope here).

**The "needs attention" framing** the product vision asked for is already substantially met by
the existing list: `decide`/`overdue`/`blocked` already lead `REASON_ORDER` with their own tag
colors (`.mywork-tag`). No new callout component — the Today section sits above that list, the
list's own ordering does the rest.

**No personalized greeting.** Decorative, not information-bearing — against Principle 1
(enterprise clarity over visual decoration), confirmed with the product owner.

## Component sketch

```
MyWorkPanel
├── header (unchanged: "My work", describeWork(list) summary)
├── NEW: Today section
│     "Today" label + count
│     ├── meeting row × N (time, title, attendees or scope chip if scopeKind/scopeId set)
│     └── empty state: "No meetings today" (not an error — the common case for many days)
└── existing reason-grouped list (unchanged)
```

Meeting rows follow the existing chip/row conventions from `axiomate-ui-design`'s component
library — no new visual idiom. `.mono` + tabular-nums on the time, per Principle 6.

## Error handling

Reuses `list.unrecognised` (the existing "work is found by name, and the name isn't in the
directory" banner) — if the signed-in person doesn't resolve, `todaysMeetings` can't resolve
`attendeeIds` either, so it renders nothing extra to explain; the existing banner already covers
this failure mode. An empty `state.meetings` (nobody has ever recorded a meeting) renders the
same empty state as "no meetings today," not a distinct error.

## Landing rule change

`IssueWorkspace.tsx`'s mount effect currently reads:

```ts
if (myWork(state, actor, today).items.length > 0) setViewState('mywork')
```

Becomes an unconditional `setViewState('mywork')` inside the same "no stored choice" branch —
the stored-view override (`loadStoredView()`) still wins when present; this only changes the
COLD default.

## Testing

One new scenario, pinning the real `todaysMeetings` function (not a mock), covering: a meeting
today for the signed-in person (included), a meeting today for someone else (excluded — not in
`attendeeIds`), a cancelled meeting today (excluded via `deletedAt`), and the unresolved-person
case (empty result, no error). Existing `myWork()` scenarios are untouched — this is additive.

## What would send this back

- If `state.meetings` turns out to have near-zero real production data (nobody actually
  records meetings today), the Today section would be empty for most users most days — worth
  a quick live check before or immediately after shipping, not a blocker to building it.
- If the landing-rule change surfaces a real workflow complaint (someone who deliberately relied
  on landing on Tree when their queue was empty), that's a fast, isolated revert — the landing
  rule is one line, not entangled with the rest of this design.
