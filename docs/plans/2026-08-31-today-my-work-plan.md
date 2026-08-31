# Today — My Work becomes the real home screen — implementation plan

Follows `docs/plans/2026-08-31-today-my-work-design.md` (approved 2026-08-31). Ordering
principle: pure logic first — `todaysMeetings` is a function with no clock of its own (it takes
`today` as a parameter, like `myWork` already does) and no I/O, so it is provable by a single
scenario before any component references it. The UI addition depends on that function existing
and correct; the landing-rule change depends on neither and is sequenced last specifically
because the design doc names it as the one piece that might need a fast, isolated revert — it
changes what every user sees on sign-in, and nothing else in this plan should be entangled with
that revert if it's ever needed.

Verified against the current files while writing this (all three line ranges below were
confirmed by reading the actual file, not assumed from the design doc's estimates):

- `lib/mywork.ts:185` — `myWork(state, actor, today)`, resolves via
  `directoryPersonFor(state.model, actor)` (imported line 81 from `./access`).
  `REASON_ORDER` at line 88.
- `components/MyWorkPanel.tsx:80-87` — the `list.unrecognised` banner (80-85) sits directly
  above the reason-grouped `.evi-list` (87). The Today section's insertion point is between
  them.
- `components/IssueWorkspace.tsx:696-707` — the landing effect. Current text, confirmed:
  ```ts
  useEffect(() => {
    const stored = loadStoredView()
    if (stored) {
      setViewState(stored)
      return
    }
    // No stored choice: land on what needs you, if anything does. The tree stays the
    // default for an empty queue — structure beats an empty list. Deliberately once, on
    // mount — a landing rule that kept re-firing would yank the view away mid-session.
    if (myWork(state, actor, today).items.length > 0) setViewState('mywork')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  ```
  (Line numbers shifted from the design doc's ~710-721 estimate — the clean-shell phase removed
  panel-sizing state earlier in this file. Re-verify the line range at implementation time in
  case further shell work has landed between now and then; match on the code shown, not the
  numbers.)
- `scripts/scenario-validation.ts` — scenarios are registered with
  `scenario('ID', 'title', 'one-line summary', () => { ...; return { verdict, actual, stops,
  severity, impact } })`, inline in this one file (3300+ lines; `TW2` at line 3327 is a
  representative example of the shape — a scenario driving the real function directly and
  asserting on its real return value, not a mock). The new scenario's id should follow the
  file's existing short-code convention (two-to-four letters plus a number) and not collide
  with an id already in use — grep the file for the chosen id before adding it.

## Steps

### Step 1 — `todaysMeetings` in `lib/mywork.ts`, plus its scenario

Add, beside `myWork` (after it, same file — it shares the person-resolution pattern at
line 186 and belongs next to the function it complements):

```ts
export function todaysMeetings(state: WorkspaceState, actor: Actor, today: string): Meeting[] {
  const person = directoryPersonFor(state.model, actor)
  if (!person) return []
  return Object.values(state.meetings)
    .filter(m => !m.deletedAt && m.attendeeIds.includes(person.id) && m.startAt.slice(0, 10) === today)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
}
```

(`today` is already a `YYYY-MM-DD` string throughout this codebase — `startAt.slice(0, 10)`
matches that convention rather than parsing a `Date`, consistent with how the rest of
`lib/mywork.ts` and `lib/schedule.ts` compare dates as strings.) Import `Meeting` from
`./meetings`.

Add one new scenario to `scripts/scenario-validation.ts`, driving `todaysMeetings` directly
against constructed state (no mock), covering:

1. A meeting today with the signed-in person in `attendeeIds` — included.
2. A meeting today for a different person (not in `attendeeIds`) — excluded.
3. A meeting today with `deletedAt` set — excluded.
4. An actor that doesn't resolve via `directoryPersonFor` — returns `[]`, no throw.
5. Ordering — two included meetings with different `startAt` come back sorted ascending.

**Verify:** `npx tsc --noEmit` (the function compiles and types check) → `npm run
validate:scenarios` — the new scenario's verdict is `PASS`, and the total scenario count in
`data/validation.json` increases by exactly one with no existing scenario's verdict changed
(the CI regression gate this project already runs checks exactly this — reproduce it locally
before moving on: nothing that was PASS may stop being PASS).

**Commit 1** — this step alone. It is fully self-provable (a pure function plus the scenario
that pins it) before anything depends on it, per the ordering principle.

### Step 2 — the Today section in `components/MyWorkPanel.tsx`

Between the `list.unrecognised` block (ends line 85) and the `.evi-list` div (starts line 87),
add:

- Call `todaysMeetings(state, actor, today)` (new import from `@/lib/mywork`, alongside the
  existing `myWork` import).
- Render a labeled section ("Today", with the meeting count) containing one row per meeting —
  time (`.mono`, tabular-nums, formatted from `startAt`), title, and — when `scopeKind`/
  `scopeId` are set — a small scope chip reusing whatever existing chip convention resolves a
  scope reference elsewhere in this codebase (check `component-standards.md`'s Cards/status
  section for the closest existing pattern before adding a new one).
- Empty state when the list is empty: a plain line ("No meetings today"), not styled as an
  error or a warning — per the design doc, this is the common case, not a problem to flag.
- No new prop into `MyWorkPanel` — `state`/`actor`/`today` are already received.

**Verify:** `npx tsc --noEmit` → `npm run audit:a11y` (the new section's markup — labeled
region, no color-only signal on the meeting rows) → `npm run build`. `validate:scenarios`
should show no change from Step 1's count (this step is pure UI, no new domain logic to pin).

**Commit 2** — standalone. Depends on Step 1 existing and correct; nothing after it depends on
this step's exact rendering details, so it doesn't need to be bundled with Step 3.

### Step 3 — the landing-rule change in `components/IssueWorkspace.tsx`

⚠ **The step carrying the most regression risk in this plan.** Every other change here is
additive — a new function nothing calls yet until Step 2 wires it, a new section inside an
already-optional panel. This step changes what EVERY signed-in user sees the first time they
land in the app with no stored view preference — a behavior that currently always succeeds
(lands on Tree) for anyone with an empty work queue, and will now land them on My Work instead.
If Step 2's Today section is empty for them too (no meetings, no urgent work), they land on a
screen that reads as empty where they previously landed on the full structural Tree — this is
the exact "what would send this back" risk the design doc names.

Change (lines 696-707, or wherever they've moved to — match the code shown above, not the line
numbers):

```ts
useEffect(() => {
  const stored = loadStoredView()
  if (stored) {
    setViewState(stored)
    return
  }
  // Always land here now — My Work is the home screen, not a queue-triggered exception.
  // Deliberately once, on mount — a landing rule that kept re-firing would yank the view
  // away mid-session.
  setViewState('mywork')
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

The `myWork(state, actor, today).items.length > 0` condition is deleted entirely — if nothing
else in the file still reads `myWork` at this call site for another purpose, the now-unused
import guard (`myWork` is still used elsewhere in this file per line 744's `myWorkCount`) is
not a concern; only this one call site changes.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios` (this is a UI landing default,
not domain logic — no scenario should reference it; confirm the count is unchanged from Step
2) → `npm run build`. There is no gate script that checks a landing default directly — this
step's real verification is the staged deploy's live walkthrough in Step 4, stated honestly:
the gate proves the code compiles and nothing else regressed, not that the new default reads
well for a real, mostly-empty account.

**Commit 3** — standalone, deliberately separable from Commits 1-2 for the fast-revert reason
stated above.

### Step 4 — staged deploy

This project's established recipe: `git archive` the combined commit → fresh dir → `npm ci` →
`npx prisma generate` → `npm run build` → package via `scripts/package-release.py` → `az webapp
deploy` → health poll until the response BODY (not just HTTP status) shows
`"database":"connected"`.

**Live walkthrough after deploy** (the design doc's own named risk — a scenario passing proves
the code path works, not that real users have real meetings recorded):

1. Sign in as an account with no stored view preference (or clear the stored choice) — confirm
   landing on My Work, not Tree.
2. If that account has a meeting recorded for today (via My Calendar), confirm it appears in
   the Today section, correctly time-ordered if there's more than one.
3. If that account has NO meeting today, confirm the empty state reads as intended ("No
   meetings today") rather than as a broken or empty-looking screen — this is exactly the
   scenario the design doc flagged as worth checking live, not just in the scenario suite.
4. Confirm the existing reason-grouped list below the Today section is completely unchanged in
   content and behavior.

**Commit boundary:** no code change in this step — deploy only, after Commits 1-3 all land.

## Details most likely to be gotten wrong

- **Date comparison** — `today` is a `YYYY-MM-DD` string; `Meeting.startAt` is a full ISO
  datetime. Compare via `startAt.slice(0, 10) === today`, not a `Date` parse/compare — matching
  the string-comparison convention already used throughout `lib/mywork.ts`/`lib/schedule.ts`.
  A `Date`-based comparison risks a timezone-shift bug this codebase has deliberately avoided
  elsewhere.
- **`attendeeIds` holds directory ids, not names** — match against `person.id`
  (`directoryPersonFor`'s return), never `person.name`. This is the opposite convention from
  `myWork()`'s own name-based join (`lib/mywork.ts:187-188`) — don't copy that pattern here by
  reflex; `Meeting.attendeeIds` was deliberately built id-first (per `lib/meetings.ts`'s own
  comment: "Real invitations — each lands on that person's My calendar").
- **The unresolved-person case returns `[]`, not an error** — `MyWorkPanel` already shows the
  `list.unrecognised` banner from `myWork()`'s own resolution; `todaysMeetings` returning an
  empty array silently is correct, a second banner would be redundant.
- **Don't delete `myWork` import from `IssueWorkspace.tsx`** — line 744 (`myWorkCount`) still
  needs it after Step 3; only the landing-effect call site changes.
- **The scope chip in Step 2** — check for an existing pattern before adding new markup; a
  `scopeKind`/`scopeId` reference chip likely already exists somewhere in this codebase (issue
  linking, discussion scope) and should be reused rather than styled fresh.

## What would send the design back

- If Step 4's live walkthrough shows most real accounts have zero meetings recorded (per the
  design doc's own flagged risk), the Today section is real but rarely populated — this doesn't
  invalidate Steps 1-2 (the code is still correct and will earn its keep as meeting-recording
  usage grows), but it does mean Step 3's landing-rule change should be reconsidered:
  surfacing an empty Today section on top of an empty reason-grouped list, every single sign-in,
  for accounts with light queues, may read worse than the previous Tree default did. If this is
  what's found, the fix is likely scoped to Step 3 alone (revert to the conditional landing
  rule, or add a condition that also checks `todaysMeetings` before switching), not a reopening
  of Steps 1-2.
- If the a11y gate in Step 2 finds the meeting rows need a state (correct, since this is new
  markup) but the fix would require a new visual idiom not already in this codebase's component
  library, that's a signal to pause and check `axiomate-ui-design`'s `component-library.md`
  again before improvising one.
