# Unified Work Inbox

**Status: approved 2026-08-31** (three AskUserQuestion decisions, recorded below). Second
concrete step out of the product-vision pitch — "Unified Work Inbox" (⭐⭐⭐ in that document),
scoped to what's real and buildable without AI. Follows the same additive discipline as
"Today" (`docs/plans/2026-08-31-today-my-work-design.md`): reuse existing collections, don't
invent a fourth data model.

## The three decisions

1. **A genuinely new consolidated view**, not just a shared taxonomy tagged across the
   existing three surfaces in place.
2. **Mail's delegated-Graph inbox stays out of this pass.** Its session-scoped trust model
   (RAM-only tokens, resets on restart) is different enough from everything else here
   (durable server state) to defer rather than force in now.
3. **Replaces the Notifications sidebar destination**, at the same `inbox` view slot — matches
   the vision's own framing ("instead of notifications scattered across... create My Inbox").

## What's already real, that this design builds on rather than invents

- **My Work's `decide` group** (`lib/mywork.ts`) already computes "needs my decision" from five
  real collections: pending approvals (`state.approvals`), submitted timesheets awaiting
  `time.approve`, delivered-and-pending-acceptance milestones, submitted change requests, and
  unagreed scope items. Each source already excludes the requester via `isMe(requestedBy)` /
  `isMe(deliveredBy)` / `isMine(person, personId)`.
- **`Inbox` / `lib/notifications.ts`** — the real notification stream (`inboxFor`,
  `unreadCount`), with routing already handled in `IssueWorkspace.tsx`'s `onOpen` (approval
  traffic → Timesheets, `meeting-*` → My calendar, `discussion-message` → Discussion tab, etc.).
  Confirmed single mount, docked, at the `inbox` view.
- Notifications carry a `NotificationKind` for PREFERENCES (`assignment`, `intake-arrival`,
  `automation`, `mention`, `approval`, `chat`, `meeting`) and a finer `ruleId` for routing —
  these are messages ABOUT state changes, not the actionable records themselves. The decide
  group queries the actionable records directly, which is why it's the more trustworthy source
  for "needs action" (a read notification isn't the same as a resolved decision).

## The addition

### `decisionItems()` — an extraction, not new logic

The five-source loop inside `myWork()`'s "decide" section becomes a standalone exported
function, `decisionItems(state, actor, today): WorkItem[]`, in `lib/mywork.ts`. `myWork()`
calls it and folds the result in exactly where the `decide` items went before — **no change to
`myWork()`'s output, order, or scenario behavior.** This is purely a refactor for reuse,
verified by a scenario asserting the extraction changed nothing (see Testing).

### `waitingItems()` — the requester's-eye mirror, genuinely new

In a new `lib/inbox.ts`: the same four of the five collections, with the exclusion flipped to
an inclusion — "mine, still pending someone else":

```
approvals where isMe(requestedBy) && !decision
timesheets where isMine(person, personId) && status === 'Submitted'
milestones where isMe(deliveredBy) && acceptance === 'Pending'
changes where isMe(requestedBy) && status === 'Submitted'
```

**Scope items are excluded from Waiting.** Unlike the other four, a pending `ScopeItem` carries
no requester field the decide-side check excludes on — there's nothing honest to mirror. Stated
plainly rather than inventing a "who submitted this line" concept the data doesn't have.

### `unifiedInbox()` — composition, not a fourth calculation

```ts
function unifiedInbox(state, actor, today) {
  return {
    needsAction: decisionItems(state, actor, today),
    waiting: waitingItems(state, actor, today),
    fyi: inboxFor(state.notifications, actor.name, personId),
  }
}
```

### `UnifiedInbox` component

Three labeled sections (Needs Action, Waiting, FYI), reusing the `.evi-item`/`.mywork-group`
row convention for the first two (same idiom as My Work's own rows — click-to-select into the
tree) and `Inbox`'s existing row rendering and `onOpen` routing, unchanged, for FYI. Mounted at
the same `inbox` view slot in `IssueWorkspace.tsx`, replacing `<Inbox ... docked />`. Sidebar
label: "Notifications" → "Inbox"; the `WorkspaceView` key stays `'inbox'` — no stored-preference
migration needed.

## The known, accepted overlap

My Work's own `decide` group is **not removed** in this pass. A `decide` item will appear both
in My Work's ranked list and in the new Inbox's Needs Action section. This is a deliberate,
named tradeoff (Approach A, chosen over Approach B which would have removed it) — touching
`myWork()`'s core ranking, which is scenario-pinned (`MW1`) and carefully reasoned about
("decisions come first because it's the only thing holding another person up"), is a
materially bigger and riskier change than this feature needs to take on in the same pass.
Revisit once the Inbox pattern has proven out.

## Error handling

Same "work is found by name, and “X” is not in the directory" banner pattern already used by
`MyWorkPanel` and `Inbox`, reused verbatim rather than reworded, for the same unresolved-actor
case affecting Needs Action and Waiting (FYI already handles this via `inboxFor`'s own
`personId`-or-name join).

## Testing

Two new scenarios, both pinning real functions:

1. **Extraction regression check** — `decisionItems()` output, folded into `myWork()`, produces
   an identical `decide` group to before the extraction (same items, same order) — proves the
   refactor changed nothing.
2. **`waitingItems()` mirror** — for each of the four sources, an item the actor raised/
   delivered/submitted and is still pending appears in `waiting`; the same item does NOT appear
   if decided/accepted/approved; a scope item is confirmed absent from `waiting` regardless of
   who raised it (documenting the honest exclusion, not a bug).

## What would send this back

- If, once built, the overlap between My Work's `decide` group and Inbox's Needs Action reads
  as confusing rather than merely redundant (two counts that don't match for a reason nobody
  can see), that's a signal to revisit the "known, accepted overlap" decision above — likely by
  surfacing a one-line explanation in the UI rather than removing either list.
- If `waitingItems()`'s scope-item exclusion turns out to matter in practice (scope agreement
  waits are common and invisible without it), that's grounds to reopen the design around
  whether `ScopeItem` needs a requester field added — a schema change, not a UI fix, and out of
  scope for a fast follow-up.
