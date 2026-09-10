# Calendar-only automation trigger — design

**Status:** design approved by Nishant, 10 September 2026 (shape confirmed in conversation before
this doc was written). Not yet built.

## Why this exists

I9 (`docs/pending-actions.md`) shipped `setStatus`/`setOwner` as new automation action kinds on 8
Sep but explicitly left its "finding 1" unbuilt: *"a pure calendar-only trigger usable by any
action... needs its own pass."* `lib/automation.ts`'s own header comment names the gap precisely:

> What genuinely is not expressible is a rule bound to nothing but a calendar interval — "every
> Monday, send a status digest" with no condition ever needing to become true. `runRecurrences`
> covers that shape, but only for raising a new issue, not for this module's notify/addNote/
> setNextAction/requestApproval actions.

Today, every `AutomationRule` fires on an `EventType` — something happening (`issue.overdue`,
`issue.created`, and the five others `lib/watch.ts`'s `WATCH_CONDITIONS` raise as events). There is
no way to say "every Monday morning, tell the engagement lead X" with nothing needing to become
true first.

## What this is not

Read the codebase before proposing anything, not after — `RuleActionKind` has six members
(`notify`, `setNextAction`, `addNote`, `requestApproval`, `setStatus`, `setOwner`), and five of
them are unconditionally `event.subjectId`-shaped in `planActions` (`lib/automation.ts:339-385`):
`setNextAction`/`setStatus`/`setOwner`/`addNote` patch or annotate a specific issue;
`requestApproval` requests approval on a specific subject. None of these has a sensible "which
issue" answer on a bare calendar tick — building a target-issue picker for each would be a
materially bigger feature than what I9 actually asked for, and the backlog row's own example
("send a status digest") is a `notify`, not any of the other five.

**So calendar-triggered rules support `notify` only in this pass.** The other five action kinds
stay event-triggered. If a real need for "every month, close X" or similar surfaces, that is a
second pass with its own target-selection design — not a widening of this one on a guess.

## Architecture

`AutomationRule.on` widens from `EventType` to a union:

```ts
export type RuleTrigger = EventType | { kind: 'calendar'; cadence: Cadence }
```

reusing `lib/recurrence.ts`'s existing `Cadence` (`weekly`/`monthly`) and `dueOccurrence`
arithmetic rather than a second scheduler — the same reuse `Recurrence` itself already is for
"raise an issue on a cadence." A calendar-triggered rule needs its own duplicate-guard, mirroring
`Recurrence.lastRaisedOn`:

```ts
export interface AutomationRule {
  // ...unchanged...
  /** Set only for a calendar-triggered rule; the occurrence last fired for. Mirrors
   *  Recurrence.lastRaisedOn — same reason, same discipline: a pass re-running the same
   *  morning must not notify twice, and a pass down for three days fires the missed
   *  occurrence once, not once per missed day. */
  lastFiredOn?: string | null
}
```

`planActions` is event-driven at its core (`for (const event of events)`) and stays that way —
folding a calendar tick into it would mean inventing a synthetic `DomainEvent` to satisfy a
function whose whole contract is "given events, decide what to do about them." Instead, a new
function alongside it, evaluated the same place `runRecurrences` already is:

```ts
export function planCalendarActions(
  state: WorkspaceState,
  today: string,
  now: string,
): { actions: Action[]; fired: { ruleId: string; occurrence: string }[]; misses: RuleMiss[] }
```

Wired into `lib/db/schedule.ts`'s `runScheduledPass`, in the same transaction, after
`runRecurrences` — same reasoning that function's own comment already states for why recurring
work rides the watch's transaction: a raise (or here, a notification) and the pass's own memory of
having sent it must commit together, or a crash between them either silently re-sends or silently
forgets.

## Components

- **`lib/automation.ts`**: `RuleTrigger` type; `planCalendarActions` (new, parallel to
  `planActions`); a calendar-scoped `resolveAudience` call (unchanged function, called with
  `issue: undefined` — already returns `[]` for `owner`/`raisedBy` when there is no issue, which is
  correct here: those two audience choices are refused for a calendar-triggered rule at
  config-save time, not silently miss-fired at run time).
- **`lib/db/schedule.ts`**: one more step in `runScheduledPass`, same shape as the existing
  `recur = runRecurrences(...)` line — call `planCalendarActions`, apply what it returns through
  `apply` the same way `runRecurrences`'s own loop does, persist steps, advance `lastFiredOn` in
  the same transaction as the notify itself (both-or-neither, same reasoning `Recurrence`'s
  `lastRaisedOn` advance already documents).
- **`components/ConfigWorkspace.tsx`'s Automation screen**: the trigger picker gains a third
  option beside "on an event" — "on a calendar" — reusing whatever weekday/day-of-month control
  `Recurrence`'s own Configuration UI already renders (not a new date-picker component). When
  calendar is chosen, the action-kind picker is filtered to `notify` only, and the
  audience picker excludes `owner`/`raisedBy` (both meaningless with no issue) — a config-time
  refusal, not a run-time miss.

## Data flow

1. Configuration → Automation: a person creates a rule, picks "on a calendar" and a cadence
   instead of an event, sets `then: [{ kind: 'notify', audience: 'role:...', text: '...' }]`.
2. Scheduled pass runs (same daily trigger as everything else in `runScheduledPass`).
   `planCalendarActions` checks every calendar-triggered rule: is today's cadence occurrence
   strictly after `lastFiredOn`? If so, resolve the audience, build one `notify` action per
   person (mirroring `planActions`'s own per-person fan-out for `notify`), and record the
   occurrence to advance.
3. Both the notify actions and the `lastFiredOn` advance apply and persist in the same
   transaction — a crash between them is not possible by construction, same as the recurrence
   guard.
4. `fill()` still runs the text through its existing template substitution
   (`{id}`/`{subject}`/`{from}`/`{to}`/`{by}`), fed a synthetic event with an empty subject —
   `{id}`/`{subject}` render as `''`/the rule's own id (whichever reads more honestly at build
   time), `{from}`/`{to}` render as `'—'` (the function's existing empty-string fallback),
   `{by}` is the scheduled-pass actor's name. No new templating mechanism; the existing one
   already degrades gracefully for a missing issue, which is exactly this case.

## Error handling

- **Audience resolves to nobody** (a role nobody currently holds): reported as a `RuleMiss`,
  same as `planActions` already does for event-triggered rules — visible in whatever surface
  already lists misses (the scheduled-pass admin view), not a silent no-op.
- **A rule is saved with `then` containing a non-`notify` action while `on` is calendar-shaped**:
  refused at the config-save boundary (`setAutomationRules`'s validation, alongside its existing
  checks), not caught only at run time — the whole point of restricting the UI's action-kind
  picker above is to make this unreachable rather than merely reported.
- **The scheduled pass is down for several days**: `dueOccurrence`'s existing "at most one
  occurrence, the latest on or before today" arithmetic already prevents a flood of catch-up
  notifications — reused unchanged, so this is inherited correctness, not new work.

## Testing

A new scenario (working name `AUTO3`) proves: a calendar rule due today fires exactly one
`notify` per resolved audience member; a rule not yet due does not fire; a rule already fired for
today's occurrence does not fire twice on a same-day re-run (the `lastFiredOn` guard); a rule
whose audience resolves to nobody produces a `RuleMiss`, not a silent success. Modeled directly on
`AUTO1`/`AUTO2`'s existing shape for the two shipped I9 findings, and on `Recurrence`'s own
duplicate-guard scenarios for the "no double-fire" case specifically.

Not reachable by the scenario harness, same limit `I10`'s own row already named for
`automationRules` generally: this is a **stored snapshot per tenant**, so a new calendar-triggered
rule reaches new tenants automatically via `defaultAutomationRules()` but not an already-provisioned
production tenant, which needs it added once through Configuration → Automation — the identical
manual step I1's permission fix and I10's `AUTO_SUBWORK_CLOSED` both already needed. Named here so
it is not rediscovered as a surprise on first use.

## What would send this back to the design

- **If a genuine need for a non-`notify` calendar action surfaces** (someone wants "every month,
  close X" rather than "every month, tell someone about X") — that is a real widening of scope,
  needing its own target-selection design, not an extension bolted onto this one.
- **If `fill()`'s degraded substitution for a calendar-only rule reads badly in practice** (an
  empty `{subject}` or a bare rule id in `{id}` looking like a bug rather than an honest absence)
  — worth a dedicated calendar-rule template variant rather than reusing the event-shaped one, but
  not decided ahead of seeing a real message render.
