# Project/Engagement Snapshot — design

## Why

Steal-list item 9 in `wiki/resources/platform/hive-comparison.md`, sourced from
`help.hive.com/en/articles/2889473`: Hive's Baseline is "a snapshot of what was planned before
beginning a project" — planned start/end date per work item, plus "budget definitions, totals,
and other cost details at the time," taken manually from the Gantt view, multiple per project,
compared later via a "View baseline" dropdown.

Axiomate's `Estimate.baselinedAt` (`lib/estimation.ts`) is a false friend: per-issue, agreed
once, locks *effort* only, never a date, never a frozen cost figure, and holds no history — only
the current agreed value. There is no answer today to "what did the plan look like when the
client signed off, versus now" (the user's own framing for why this matters) anywhere in this
codebase.

## What this is not

Not a replacement for `Estimate.baselinedAt` (issue-level effort agreement) or `SowPosition`
(live, always-current SOW cost/variance rollup, `lib/sow.ts`). This sits beside both: a
point-in-time copy a person deliberately takes, that never changes again once taken.

## Scope, settled during brainstorming

- **Trigger**: manual only — a person clicks "Take snapshot." No automatic snapshot at any
  event. Matches Hive exactly; a snapshot means something because someone chose that moment.
- **Content**: planned dates *and* cost together, matching Hive's Baseline exactly rather than
  a dates-only first cut.
- **Node scope**: both projects and engagements. Unified by `issuesUnder(state, nodeId)`
  (`lib/engagement.ts:156`) — already exported, already documented as reusable ("Exported for
  `lib/portfolio.ts`, which needs the same walk over every engagement at once. One
  implementation rather than two"), already walks any node at any depth. A snapshot's root can
  be a project or an engagement; the capture logic does not need to know which.
- **Retention**: unlimited. Every snapshot ever taken is kept, newest-first — matches Hive
  ("your existing Baselines", plural, no documented cap) and this codebase's own
  soft-delete/never-destroy discipline used everywhere else (`Archive…` restores rather than
  deletes; `TimeEntry`/`Allocation` rows are marked, not removed).

## Data model

A new top-level state collection, the same shape as `milestones`/`timesheets` — a flat record,
not nested under the node it targets, so it survives the node being renamed or moved:

```ts
export interface SnapshotEntry {
  issueId: string
  subject: string          // captured at the time — a later rename doesn't rewrite history
  plannedStart: string | null
  plannedEnd: string | null
}

export interface Snapshot {
  id: string
  nodeId: string
  nodeKind: 'project' | 'engagement'
  nodeName: string          // captured at the time, same reasoning as SnapshotEntry.subject
  takenAt: string
  takenBy: string           // actor.name, same attribution pattern as everywhere else
  entries: SnapshotEntry[]
  /**
   * sowCostOf()'s own output, frozen. Null for one of two reasons, and the record does not
   * distinguish them: the taker lacked rate.view at the time (never computed — the same
   * "null entirely, never computed-then-hidden" rule CommercialPanel's own cost block already
   * follows), or the node's issues carry no priced time. Both read the same to a later
   * viewer: nothing to show. Re-checking rate.view on view would let a later permission grant
   * retroactively "unlock" a number that was never actually seen at the time — wrong, because
   * this field records what WAS captured, not what could be computed now.
   */
  cost: CostOfWork | null
  deletedAt: string | null
}
```

`entries` is embedded as one JSON array inside the row, not a normalized per-issue table — the
same shape `ScheduleWatch.Observation` already uses for "many facts captured at one moment."
Projects and engagements in this codebase are not large enough (per the seeded register: single
digits to low hundreds of issues under any one node) for an embedded array to be a real size
concern, and a normalized table would need its own tenant-scoped mapper pair for no benefit —
nothing ever queries one entry across snapshots, only a whole snapshot at a time.

## Capture — pure first

```ts
export function takeSnapshot(
  state: WorkspaceState,
  nodeId: string,
  rates: PersonRate[],
  actor: Actor,
  now: string,
): Snapshot
```

Three already-proven primitives, composed, not reimplemented:

1. `issuesUnder(state, nodeId)` — the issue set, for either a project or an engagement root,
   the identical call `lib/watch.ts`'s SOW-over-consumption check and `lib/portfolio.ts` already
   make.
2. Map each issue to a `SnapshotEntry` — `plannedStart`/`plannedEnd` read straight off
   `IssueRecord` (`lib/workspace.ts:301-302`), no new computation.
3. `sowCostOf(rates, issueIds, timeEntries)` (`lib/rates.ts`, this session's rate/margin
   rollup) — called once, its `CostOfWork` output stored verbatim as `cost`. The caller decides
   whether to pass real rates or omit them (i.e., call this from a context that has already
   checked `rate.view`) — `takeSnapshot` itself takes no permission decision; the reducer arm
   below does, matching this codebase's standing separation between pure logic and the
   permission funnel.

Reducer arm: a new action `{ t: 'takeSnapshot', nodeId, now }`. Checks `sow.edit`
(`can(state.model, actor, 'sow.edit')` — already held by `ROLE_ENGAGEMENT_LEAD`/`ROLE_ADMIN`
by default, a commercial-governance action of the same shape as agreeing a SOW), checks the
node exists and is a project or engagement (refuses otherwise, same discipline every other
node-targeted action already follows), then calls `takeSnapshot` with `rates` passed only if
`can(state.model, actor, 'rate.view').allowed` — otherwise passes `[]`, so `sowCostOf` returns
its own `cost: null, unratedHours: <all>` shape, and the stored `Snapshot.cost` is `null` for
exactly the right reason.

## Where it surfaces

No dedicated "Project Overview" screen exists in Axiomate (confirmed in
`wiki/resources/platform/hive-screen-comparison.md`) and inventing one is out of scope here.

- **Take**: `RowMenu.tsx` — a new entry, `Save as blueprint…`'s neighbour, shown only for
  `row.kind === 'project'` or `row.kind === 'engagement'` (the same `row.kind` guard
  `saveBlueprint` already uses for `engagement`), gated by the same `sow.edit` check the
  reducer enforces — a refused click is not offered as a live option, matching the button-level
  gating pattern `Capabilities`'s "Reconcile now" button already established this session.
- **View/compare**: a new drawer, `SnapshotDrawer.tsx`, the same shape as `ReplanningDrawer` —
  opened from the row menu's `View snapshots…` (shown whenever `state.snapshots` has any entry
  for this node, mirroring `RowMenu`'s own "empty sections hide themselves" rule). A dropdown of
  past snapshots by date (newest first); selecting one shows its date table beside each issue's
  *current* `plannedStart`/`plannedEnd` for comparison, and its frozen cost figures beside the
  node's *current* `sowCostOf` output (computed live, same `rate.view` gate as `CommercialPanel`)
  — variance is the visual point, not a new stored field.

## Persistence

`snapshots` is a new top-level collection on `WorkspaceState`, so this needs the same three
pieces every prior new collection has needed (`milestones`, `timesheets`, `personalEvents`):
a new Prisma model (tenant-scoped, the standard `tenantId` + row-mapper pattern
`scripts/tenant-audit.mjs` checks), a `persistSteps` arm in `lib/db/persist.ts` so a taken
snapshot survives past the in-memory reducer (the E2 lesson this codebase already learned once:
an arm whose rows the writer drops persists nothing, and no other gate notices), and a load-path
entry in `lib/db/repo.ts`. This is a schema change and stands alone as its own commit in the
implementation plan, per this project's own migration discipline — never bundled with the pure
logic or the UI wiring.

## Access control, summarised

| Action | Permission | Precedent |
|---|---|---|
| Take a snapshot | `sow.edit` | Same key that gates agreeing/editing a SOW |
| See a snapshot's dates | `internal.view` (the row menu's own existing gate) | — |
| See a snapshot's cost | `rate.view`, checked at CAPTURE time and frozen — never re-checked on view | `CommercialPanel`'s existing cost-null pattern |

## Testing

A new scenario proving, against the pure `takeSnapshot` function directly (no UI, no reducer
needed to prove the core claim):

- A snapshot captures the dates and cost that were true at the moment it was taken.
- A later `setDates` change on one of the captured issues does not alter the already-taken
  snapshot's `entries` — the defining property of a snapshot, asserted explicitly rather than
  assumed.
- A later change to a person's rate (`rate.effectiveDate`-style, mirroring `RT1`'s own fixture
  shape) does not alter an already-taken snapshot's `cost` — same defining property, for the
  cost half.
- Taken without `rate.view`: `cost` is `null`. A SECOND snapshot taken afterward, by an actor
  who does hold `rate.view`, has a real `cost` — proving the null is per-snapshot-at-capture-time,
  not a workspace-wide flag.
- The reducer arm: `sow.edit` is required (refused for an actor who lacks it, same message
  shape as every other permission refusal); an engagement root and a project root both produce
  a snapshot via the identical code path (asserted by taking one of each in the same test and
  comparing the shape of both results, not just that neither throws).

## What would send this design back

- If `issuesUnder`'s actual current behaviour turns out to already special-case project vs.
  engagement roots differently (undermining the "identical code path" claim) — this would need
  rechecking against the real function body before the plan is written, not assumed from its
  doc comment.
- If a firm's real project/engagement sizes turn out to be large enough that an embedded
  `entries` array is a genuine performance concern — would send the data model back to a
  normalized table, a materially different migration.
