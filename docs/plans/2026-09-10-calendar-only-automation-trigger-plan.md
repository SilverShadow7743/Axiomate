# Calendar-only automation trigger — implementation plan

Follows `docs/plans/2026-09-10-calendar-only-automation-trigger-design.md` (approved). Ordering
principle: pure logic first (the new type and the new planner function, both testable with no
wiring), then the reducer's validation arm (also pure, also scenario-testable), then the one step
that touches the live scheduled pass's transaction (the real regression risk in this plan), then
the UI, then a scenario correction the design doc doesn't mention but the codebase already flags,
then live verification last — the one step no harness can check.

## Steps

**1. `lib/automation.ts` — the `RuleTrigger` type, `AutomationRule.on` widened, `lastFiredOn`
added, `planCalendarActions` written.**

- `export type RuleTrigger = EventType | { kind: 'calendar'; cadence: Cadence }` — import `Cadence`
  from `./recurrence` (already exported there, unchanged).
- `AutomationRule.on: EventType` → `on: RuleTrigger`; add `lastFiredOn?: string | null` per the
  design's "mirrors `Recurrence.lastRaisedOn`" decision.
- `matches()` (`lib/automation.ts:225`) currently does `rule.on !== event.type` — this still works
  unchanged for event-shaped rules once `rule.on` is a union, because a calendar-shaped `rule.on`
  is an object and will never `===` a string `event.type`. No change needed to `matches`, but
  worth a one-line comment saying why, since the next reader will wonder.
- New function, pure, same signature shape as `planActions` minus the `events` parameter (there is
  none — that is the entire point):
  ```ts
  export function planCalendarActions(
    state: WorkspaceState,
    today: string,
    now: string,
  ): { actions: Action[]; fired: { ruleId: string; occurrence: string }[]; misses: RuleMiss[] }
  ```
  For each rule in `state.model.automationRules` whose `on.kind === 'calendar'`: compute
  `dueOccurrence({ ...rule, lastRaisedOn: rule.lastFiredOn ?? null } as unknown as Recurrence,
  today)` — `dueOccurrence` takes a `Recurrence`-shaped object but only reads `.enabled`,
  `.cadence` and `.lastRaisedOn` (`lib/recurrence.ts:96-102`), so a minimal object satisfying
  those three fields is enough; do not construct a fake full `Recurrence` with invented `id`/
  `name`/`scopeId`. If an occurrence is due, resolve audience via the existing
  `resolveAudience(step.audience ?? '', state, undefined)` (issue is `undefined`, which already
  makes `owner`/`raisedBy` resolve to `[]` — no new branch needed there), build one `notify`
  Action per resolved person exactly as `planActions`'s own `notify` case does
  (`lib/automation.ts:311-337`), and push `{ ruleId: rule.id, occurrence }` to `fired`. Text runs
  through the existing `fill()`, called with a synthetic `DomainEvent`-shaped object
  `{ type: rule.on-irrelevant-here, subjectId: rule.id, from: '', to: '', by: 'the scheduled pass'
  }` — `fill` only reads `.subjectId`/`.from`/`.to`/`.by` (`lib/automation.ts:248-255`), so this
  does not need a real `EventType`.

**Verify:** `npx tsc --noEmit` — no test harness reaches this function until step 3, so a clean
type-check is what this step alone can promise.

**2. `lib/workspace.ts`'s `setAutomationRules` reducer arm (`:8067-8084`) — refuse a calendar rule
carrying a non-`notify` step.**

Add, before the existing `label`/`then.length` checks: for each `r` where `r.on.kind ===
'calendar'`, refuse if `r.then.some((s) => s.kind !== 'notify')` with an error naming why
("A calendar-triggered rule can only notify — the other actions need an issue a calendar tick
does not have."). This is the design's "refused at the config-save boundary, not caught only at
run time" decision — it is the one line that makes the UI's restricted picker (step 5) a
guarantee rather than a suggestion.

**Verify:** `npx tsc --noEmit`, then exercised directly by the new scenario in step 3 (which
includes a case constructing a calendar rule with a `setStatus` step and asserting the refusal) —
no separate command needed for this step alone.

**3. New scenario `AUTO3`, in `scripts/scenario-validation.ts`, beside `AUTO1`/`AUTO2`.**

Modeled on `AUTO1`'s three-case shape. Cases, in one scenario function per this file's own
convention of proving several sub-claims in one scenario when they are the same feature:

- A calendar rule (`on: { kind: 'calendar', cadence: { kind: 'weekly', weekday: <today's UTC
  day> } }`, no `lastFiredOn`) due today fires exactly one `notify` action for each person
  `resolveAudience` returns, via `planCalendarActions(state, TODAY, NOW)` called directly — no
  scheduler, no transaction, matching how `AUTO1` calls `runWatch` directly rather than going
  through `runScheduledPass`.
- The same rule, with `lastFiredOn` already set to this week's occurrence, fires nothing — the
  duplicate guard, same shape as `Recurrence`'s own existing coverage.
- A calendar rule addressed to a role nobody holds produces a `RuleMiss`, not a silent no-op —
  same assertion shape `AUTO_ORPHAN` already uses in scenario `Z`.
- `setAutomationRules` refuses a calendar rule whose `then` contains `setStatus` — proves step 2's
  reducer-arm refusal, via `ok`/an expected-refusal helper matching how `Z`'s own `withIllegalRule`
  case is asserted.

**Verify:** `npx tsx scripts/scenario-validation.ts` — expect `AUTO3 PASS` and the total scenario
count to rise by exactly one (260 → 261) with no regressions elsewhere. This is the step that
actually exercises steps 1 and 2 for the first time; a failure here means one of those two, not
this step, is wrong.

**4. `lib/db/schedule.ts`'s `runScheduledPass` — wire `planCalendarActions` into the transaction.**

**This is the step carrying the most regression risk in this plan, and it is named as such.** It
edits the one function that already writes production data on an automatic timer with no person
watching each run — the same posture `runRecurrences` itself sits in, and that function's own
comment states the exact failure this must not repeat: writing the notify actions and advancing
`lastFiredOn` in different transactions (or in the wrong order) reintroduces the "double-fire or
silently-forget" class of bug `Recurrence`'s guard exists to prevent, except for notifications
that would reach a person's inbox for real, autonomously, in production. If this step is wrong,
the failure is not a crash — it is either a person receiving the same "every Monday" message
every single day, or never receiving it at all, and either one is silent until somebody notices
its absence or its repetition, exactly as `Recurrence`'s own header comment already warns for the
sibling mechanism.

Add, immediately after the existing `const recur = runRecurrences(run.state, today, now, actor)`
line (`:89`): call `planCalendarActions(recur.state, today, now)`, then apply each returned action
through `apply` the same way `runRecurrences`'s own internal loop does (`lib/workspace.ts:9576`),
persisting steps via `persistSteps` exactly as the existing `for (const step of recur.steps)` loop
already does (`:99-101`) — do not invent a second persistence path. For each entry in `fired`,
apply a `config`/`setAutomationRules` action patching that rule's `lastFiredOn` to the occurrence,
**in the same transaction**, mirroring `runRecurrences`'s own `advance` action
(`lib/workspace.ts:9585-9599`) including its comment about why a half-write here is worse than no
write. Extend `ScheduledRun`'s interface with a `calendarFired: { ruleId: string; occurrence:
string }[]` field, threaded through the return the same way `recurrences` already is, so the
admin-facing run summary can report it.

**Verify:** `npx tsc --noEmit`, `npm run build`. No new scenario here — `runScheduledPass` itself
is DB-backed and outside the pure-logic scenario harness's reach, the same limit this plan's step
7 exists to cover live instead.

**5. `components/ConfigWorkspace.tsx`'s `Automation` component (`:2184` on) — the trigger picker.**

The "When" `<select>` (`:2270-2276`) gains a preceding toggle: "On an event" (today's only mode)
vs. "On a calendar." Extract a small shared `CadenceFields` component (`{ kind, weekday, day,
onKind, onWeekday, onDay }`, controlled) from `Recurring`'s existing inline weekday/day-of-month
selects (`:2979-2998` for the state shape, the JSX further down in that function) rather than
duplicating the seven-weekday-label list a second time — one typo between two copies of "Tuesday"
is exactly the kind of drift this extraction avoids, and `Recurring` itself is edited to use the
same component so there is only one place that spells a weekday wrong if it ever is. When
"On a calendar" is selected: the action-kind picker for this rule's `then` steps is restricted to
`notify` only (matching step 2's reducer refusal — a restricted picker backed by a real refusal,
not a picker that merely suggests), and the audience picker's `owner`/`raisedBy` options are
hidden for this rule (both already resolve to nothing per step 1 — hidden here so the UI does not
offer a choice that can only ever miss).

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/ConfigWorkspace.tsx`. No
new scenario — display/form wiring over already-proven logic, the same posture this session's
other UI-only steps (I25 Tier 1, the custom-fields screen) already established.

**6. Correct scenario `Z`'s `impact` text.**

Not mentioned in the design doc — found while grounding this plan, which is what grounding is
for. Scenario `Z` (`scripts/scenario-validation.ts`, the one directly above `AUTO1`) currently
ends its `impact` field with: *"the one remaining gap is a rule bound to a bare calendar interval
with no watched condition at all, which is a different and much narrower thing."* That sentence
becomes wrong the moment `AUTO3` passes — leaving it would have this suite documenting its own
gap as open after closing it, which is exactly the kind of self-contradiction the earlier
`3a29b3d` incident (see `docs/pending-actions.md`'s now-closed G2 row) was about a stale sentence
doing. Update it to name `AUTO3` as the scenario that closes the gap, past tense.

**Verify:** re-run `npx tsx scripts/scenario-validation.ts` — `Z` still PASSes (its own assertions
are untouched; only the prose describing impact changes), confirms nothing else broke.

**7. Live verification against production.**

Last, because it is the one step no harness can check, matching this repo's own stated ordering
principle exactly. Sequence:

1. In Configuration → Automation, create a calendar-triggered rule: "On a calendar," weekly,
   today's weekday, audience `role:ROLE_ENGAGEMENT_LEAD`, message text with no `{id}`/`{subject}`
   tokens (per the design's open question about how degraded substitution reads — check this
   live rather than guessing further).
2. Trigger the scheduled pass manually (`ConfigWorkspace.tsx`'s existing "Run now" button, which
   already calls `POST /api/schedule/run` — `:1935`). Confirm a notification appears in the
   Inbox for whoever holds Engagement Leader, with the message text rendered.
3. Click "Run now" again immediately. Confirm no second notification — the `lastFiredOn` guard,
   live.
4. Confirm the rule's card shows the advanced `lastFiredOn` (or equivalent "last fired" display,
   if step 5 added one — check whether it did, since the design doc did not explicitly ask for
   one and it may be worth adding for parity with `Recurring`'s own "last raised" line).
5. Attempt to save a calendar rule with a `setStatus` step directly (bypass the restricted picker
   if needed, e.g. via a scenario-proven-safe but UI-adjacent check) to confirm the config-save
   refusal from step 2 is real in production, not just in the scenario harness.
6. Clean up: disable or remove the test rule afterward, matching this session's unbroken
   discipline of leaving production configuration exactly as found once verification is done.

## Commits

**Commit 1 — steps 1, 2 and 3.** The type, the planner function, the reducer refusal, and the
scenario that proves all three — pure logic and a reducer arm, zero UI change, zero scheduler
change, verifiable by `tsc`/scenarios alone. Ships the new capability inert: nothing calls
`planCalendarActions` yet, so nothing in production behaves differently.

**Commit 2 — step 4.** The scheduled-pass wiring — stands alone because it is the step that
starts actually running in production on a timer, and its own risk (named above) deserves a
commit boundary a `git revert` could isolate cleanly if step 7 finds it wrong.

**Commit 3 — steps 5 and 6.** The UI and the scenario-Z text correction — the user-facing half,
built once steps 1-4 are already known correct. Small enough, and similar enough in kind (both
"make what already works visible/accurate"), to ship together.

Step 7 is verification, not a commit.

## What would send this back to the design

- **If `resolveAudience(step.audience, state, undefined)` turns out to silently resolve
  `owner`/`raisedBy` to something other than `[]`** — the design's whole "no new branch needed"
  claim rests on this already being true from the existing function; step 3's scenario checks it
  directly, cheaply, before step 4 (the risky one) is even touched.
- **If the scheduled pass's transaction (step 4) cannot cleanly interleave a `setAutomationRules`
  patch (advancing `lastFiredOn`) with `notify` actions inside the same Serializable transaction**
  — e.g. if `setAutomationRules`'s validation (step 2) somehow rejects its own advance because of
  an ordering issue with the just-fired rule's own state. Surfaces at step 4's `tsc`/build, or
  worse, only at step 7 live — worth deliberately testing "the rule that just fired advances
  itself without the reducer refusing its own patch" as part of step 3's scenario rather than
  discovering it live.
- **If step 7's live check of degraded `{id}`/`{subject}` substitution reads as broken rather than
  honest** (the design's own named open question) — this is the one place the design deliberately
  left a decision for after seeing a real render; if it reads badly, the fix is a calendar-rule-
  specific template variant, not a patch to `fill()` that would change what every event-triggered
  rule's substitution does today.
