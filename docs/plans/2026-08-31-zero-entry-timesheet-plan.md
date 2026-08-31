# Zero-Entry Timesheet — implementation plan

Follows `docs/plans/2026-08-31-zero-entry-timesheet-design.md` (approved 2026-08-31). Ordering
principle: the pure module first — provable alone via its own scenario before either surface
calls it — then the simpler UI wiring (My Week), then the riskier UI wiring (the Time tab) last,
because it touches existing state and an existing effect that already has a job.

## One finding from reading the real code that changes what this plan does

**`TimeTab.tsx` resolves no `personId` anywhere** — grepped the whole file; `sheetFor`,
`weekTotal` and every other timesheet call there run on `person` (a name) alone, with no id
argument. The design's grounding assumed an "equivalent" to `MyWeek.tsx`'s `myId` existed there
to reuse — it doesn't. `directoryIdByName(state.model, person)` (`lib/access.ts:327`, already
used the same way at `lib/workspace.ts:1647` and others) is the right function: it resolves
whatever name is currently in the `person` field — which is editable, defaulting to
`actor.name`, when `time.recordForOthers` is held (line ~560-567) — not `directoryPersonFor`,
which is bound to the signed-in actor and would silently resolve the wrong person the moment
someone records on somebody else's behalf. Step 4 introduces this lookup as new code; it is not
a reuse.

## Steps

### Step 1 — `lib/timesheetSuggestions.ts`, new file

```ts
import type { Meeting } from './meetings'
import { attends } from './meetings'
import type { TimeEntry } from './time'
import { MAX_HOURS_PER_ENTRY } from './time'
import { daysOfWeek, entriesInWeek } from './timesheet'

export interface TimeSuggestion {
  issueId: string
  date: string
  hours: number
  activity: 'Meeting'
  meetingIds: string[]
  titles: string[]
}

export function meetingSuggestions(
  meetings: Meeting[],
  entries: TimeEntry[],
  person: string,
  personId: string | null,
  week: string,
  issueId?: string,
): TimeSuggestion[] {
  const mine = entriesInWeek(entries, person, week, personId)
  const filled = new Set(mine.map((e) => `${e.issueId}|${e.date}`))
  const byCell = new Map<string, { issueId: string; date: string; ms: Meeting[] }>()

  for (const m of meetings) {
    if (m.deletedAt || m.scopeKind !== 'issue' || !m.scopeId) continue
    if (issueId && m.scopeId !== issueId) continue
    if (!attends(m, personId)) continue
    const date = m.startAt.slice(0, 10)
    if (!daysOfWeek(week).includes(date)) continue
    const key = `${m.scopeId}|${date}`
    if (filled.has(key)) continue
    const cell = byCell.get(key) ?? { issueId: m.scopeId, date, ms: [] }
    cell.ms.push(m)
    byCell.set(key, cell)
  }

  return [...byCell.values()]
    .map(({ issueId, date, ms }) => {
      const totalMs = ms.reduce((n, m) => n + (Date.parse(m.endAt) - Date.parse(m.startAt)), 0)
      const rawHours = totalMs / 3_600_000
      const hours = Math.min(MAX_HOURS_PER_ENTRY, Math.round(rawHours * 4) / 4)
      return {
        issueId,
        date,
        hours,
        activity: 'Meeting' as const,
        meetingIds: ms.map((m) => m.id),
        titles: ms.map((m) => m.title),
      }
    })
    .filter((s) => s.hours > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.issueId.localeCompare(b.issueId))
}
```

`m.startAt.slice(0, 10)` is the date-truncation the grounding flagged — `startAt` is a full ISO
datetime, and this is the same slicing convention `TD1`'s own fixtures already assume works
(`${TODAY}T09:00:00.000Z`). `entriesInWeek` already does the id-first join and week-bounding;
this module composes it rather than re-deriving. `filled` keys on `issueId|date`, matching
`issueWeekCells`'s own "never edits a day that already has hours on it" rule exactly.

**Verify:** `npx tsc --noEmit`. No caller yet — proven directly by `ZE1` next, not by being
wired in, per the ordering principle's own allowance for pure logic a harness can reach first.

### Step 2 — `ZE1`, `scripts/scenario-validation.ts`

Grepped the file for the lightest existing fixture pattern for both `Meeting` and `TimeEntry`:
`TD1` (line 4428) constructs `Record<string, Meeting>` directly and splices it in as
`{ ...BASE, meetings }` — no `upsertMeeting` action needed, since nothing here is testing the
reducer's own refusals, only a pure function reading already-materialized state. The
`forecastFor` scenario near line 8218 does the identical thing for `TimeEntry` (a bare object,
not an action). `ZE1` reuses both patterns rather than routing through `upsertMeeting`/`addTime`
actions, which would test the reducer, not `meetingSuggestions`.

Four cases, one scenario, following `TD1`'s own "one scenario, several constructed facts, each
excluded or included for a different named reason" shape:

- Two issue-scoped meetings, same issue, same day, both attended → one suggestion, hours
  summed and rounded to the nearest quarter.
- A project-scoped meeting (`scopeKind: 'project'`) on the same person, same day → produces
  nothing.
- A day that already has a `TimeEntry` for that issue → produces nothing, even with a matching
  meeting still in state.
- A meeting the person is not in `attendeeIds` for → produces nothing.

Import `meetingSuggestions` from `../lib/timesheetSuggestions` at the top of the file, beside
the existing `../lib/mywork` and `../lib/inbox` imports.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: `ZE1` `PASS`, count 196 → 197,
0 FAIL.

### Step 3 — `components/MyWeek.tsx` wiring

A new section, **"From your calendar"**, inserted between the existing `<p className="mw-total">`
block (ends line 222) and the `<section className="mw-form" aria-label="Record hours">` block
(starts line 224) — directly priming the form it precedes, rather than sitting above the day
list where it would be read before the week's actual numbers.

```ts
const meetings = useMemo(() => (state ? Object.values(state.meetings) : []), [state])
const suggestions = useMemo(
  () => (state ? meetingSuggestions(meetings, entries, me, myId, week) : []),
  [state, meetings, entries, me, myId, week],
)
```

Each row shows the issue id, day, hours, and `titles.join(', ')`. Its `onClick` calls the
existing setters — `setIssueId(s.issueId)`, `setDate(s.date)`, `setHours(String(s.hours))`,
`setActivity('Meeting')` — no new state. A `ref` on the "Record hours" `<section>` plus
`ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })` in the same handler moves
focus there; grepped the codebase for an existing scroll-into-view convention and found none, so
this is the first and should stay this plain rather than inventing a helper for one call site.

**Verify:** `npx tsc --noEmit`. UI behavior spot-checked in Step 5's build, not a new scenario —
per the design's own Testing section, the pure function is what's proven; this is wiring over
an already-proven function, matching how `todaysMeetings()`'s panel wiring went unscenario'd
earlier this session.

### Step 4 — `components/TimeTab.tsx` wiring ⚠ riskiest step in this plan

Not the reorder-shaped risk Project Pulse had — this is the step that reads and writes existing
`useState` (`drafts`) and sits beside an existing effect that already owns resetting it
(`useEffect(() => setDrafts({}), [gridWeek, person, issueId])`, lines 202–204). Two independent
effects both writing `drafts` in the same commit is the real hazard: React runs effects in
declaration order within one commit, but a second effect closing over `drafts` reads whatever
that variable was bound to at render time, not necessarily what the first effect just scheduled
— a classic source of drafts either being silently clobbered back to suggestions after someone
starts typing, or a suggestion never appearing because it raced the reset. **The fix is to not
have two effects**: fold the seeding into the existing reset effect so "clear stale drafts" and
"seed fresh suggestion drafts" happen as one atomic write, not two competing ones.

```ts
const meId = directoryIdByName(state.model, person)
const meetings = useMemo(() => Object.values(state.meetings), [state.meetings])
const suggestions = useMemo(
  () => meetingSuggestions(meetings, Object.values(state.timeEntries), person, meId, gridWeek, issueId),
  [meetings, state.timeEntries, person, meId, gridWeek, issueId],
)

useEffect(() => {
  const seeded: Record<string, WeekDraft> = {}
  for (const s of suggestions) {
    seeded[s.date] = { ...EMPTY_DRAFT, hours: String(s.hours), activity: s.activity }
  }
  setDrafts(seeded)
  // Same trigger the existing reset used (gridWeek, person, issueId) plus the suggestions this
  // adds — replaced, not merged with a competing effect, so there is exactly one write to
  // `drafts` per week/person/issue change instead of two racing ones.
}, [gridWeek, person, issueId, suggestions])
```

This changes the existing effect's behavior from "reset to empty" to "reset to empty, then seed
what's suggested" — the empty case (no suggestions) still produces `{}`, byte-identical to
today. `WeekDayCell` gains one new optional prop, `sourceTitles?: string[]`, rendered as a small
caption (`titles.join(', ')`) above the existing hours input when present — not a new component,
per the design's own instruction.

**Verify:** `npx tsc --noEmit`. Manual check in Step 5: typing into a suggested cell and then
switching `gridWeek` and back must not resurrect the typed value with the suggestion silently
reapplied underneath it — the existing reset-on-week-change semantics (start the new week
clean) already cover this, since the merged effect's dependency array is unchanged from the
original's.

### Step 5 — full standing gate

`npx tsc --noEmit` → `npm run validate:scenarios` (197 total, 0 FAIL, unchanged from Step 2) →
`npm run audit:a11y` (**must actually run and pass this time** — both UI steps touch real
markup and text, unlike Project Pulse, which had none) → `npm run build`.

## Commit boundaries

- **Commit 1** — Steps 1–2: `lib/timesheetSuggestions.ts` + `ZE1`. Self-contained and
  meaningful alone — a provably-correct function with no caller yet, exactly the shape the
  ordering principle asks for.
- **Commit 2** — Step 3: `MyWeek.tsx` wiring alone. Low risk, easy to read as its own diff.
- **Commit 3** — Step 4: `TimeTab.tsx` wiring alone, kept separate specifically because it is
  the riskiest step — an isolated commit is a one-line revert if the merged effect misbehaves
  live in a way the gate didn't catch, without touching My Week's already-working suggestion UI.
- **Deploy**: after all three, same staged recipe as the prior three features this session.

## Details most likely to be gotten wrong

- **`directoryIdByName`, not `directoryPersonFor`, in `TimeTab.tsx`** — see the finding above.
  Using `directoryPersonFor(state.model, actor)` there would resolve the *signed-in actor's* id
  regardless of what the editable `person` field says, silently breaking suggestions the moment
  someone with `time.recordForOthers` records on somebody else's behalf.
- **The merged effect must replace `drafts` wholesale, not merge into existing entries** — the
  original effect's whole contract is "the new week/person/issue starts clean"; a version that
  spreads `...prev` before seeding would leak a previous cell's typed value across a week change,
  reintroducing exactly the bug the original reset effect exists to prevent.
- **`m.startAt.slice(0, 10)`** is a string slice, not a timezone-aware date derivation — correct
  only because `Meeting.startAt` is documented as "stored as entered (single-timezone firm)"
  (`lib/meetings.ts`'s own header comment) and `TD1`'s fixtures already rely on the same slicing
  working. Do not swap in a `Date`-object-based derivation, which would reintroduce a timezone
  the rest of this module deliberately has none of.
- **Suggestions must never fire for a cell `issueWeekCells`/`entriesInWeek` would call filled** —
  `meetingSuggestions`'s own `filled` set is what guarantees this; a caller that filters
  suggestions AGAIN by some other "already has an entry" check would be a second, possibly
  disagreeing, join rule for the same fact.
- **`WeekDayCell`'s new caption prop is additive** — a day with no suggestion must render
  byte-identical to today; `sourceTitles` is `undefined` in that case, not an empty array
  rendered as blank space.

## What would send this back

- If folding the seeding into the existing reset effect turns out not to be enough — e.g., if a
  suggestion needs to reappear after the person clears a cell without changing week/person/issue
  (no dependency-array trigger for that) — that's a real gap in this plan's effect design, not a
  detail to patch around with a third effect. Surfaces at Step 4's manual check.
- If `entriesInWeek`'s id-first join and `attends()`'s id-only join ever disagree about who a
  person is for the same `(person, personId)` pair — i.e., a suggestion appears for a cell
  manual entry would already consider filled, or vice versa — that is the person/personId seam
  (`axiomate-domain-analysis`) actually biting, not a bug local to this feature. Surfaces at
  Step 2 if the `ZE1` fixture is built to exercise a name/id mismatch; extend the scenario and
  say so rather than papering over it, per the design's own "what would send this back."
- If, once live, issue-scoped meetings turn out to be rare enough that suggestions almost never
  appear, that's the design's own named risk (dead weight, not a genuine time-saver) — grounds
  to reconsider the signal, not to widen scope into allocation-derived guessing. Surfaces only
  after deployment; the gate cannot catch it.

## Deploy

Same staged recipe as Today, Unified Inbox and Project Pulse this session: `git archive` the
combined commits → fresh dir → `npm ci` → `npx prisma generate` → `npm run build` → `npx prisma
migrate status` (expect: up to date, no schema change) → package via
`scripts/package-release.py` → `az webapp deploy` → health poll on response body → chunk-grep
verification (e.g. `"From your calendar"` or a suggestion phrase in a deployed
`.next/static/chunks/*.js` file, matching the Project Pulse verification shape). **Live
walkthrough**: My Week and the Time tab both sit behind Microsoft sign-in, same limitation as
every UI feature shipped this session — hand off to the user to confirm a suggestion appears for
a real issue-scoped meeting, and that a week/issue with no such meetings shows nothing new.
