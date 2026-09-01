# Project/Engagement Snapshot — implementation plan

Follows `docs/plans/2026-09-01-project-snapshot-design.md`. Ordering principle: pure logic first
(`takeSnapshot()`, provable directly against a scenario before the reducer or UI exist), then the
reducer wiring that calls it, then persistence (stands alone, per the design's own "Persistence"
section — a schema change against the live database is never bundled with logic or UI), then the
UI surface last, because it is the one part no harness checks and the one whose failures are
slowest to diagnose.

Two things the design doc left to confirm during planning, now grounded against real code:

- **"`issuesUnder` is the identical code path for a project or an engagement root"** — confirmed.
  Read in full (`lib/engagement.ts:156-171`): a generic parent-chain BFS from `nodeId`, no
  `n.kind` branch anywhere in the walk, ending in `Object.values(state.issues).filter(...)`.
  Does not send the design back.
- **"Embedded JSON array, not a normalized table"** — confirmed as reasonable. The precedent
  field (`ScheduleWatch.observation`, `prisma/schema.prisma:611`) is `Json @default("{}")` for
  exactly this "many facts captured once" shape, and this codebase's seeded register (single
  digits to low hundreds of issues per project) doesn't approach a size where an embedded array
  in one row is a real concern. Does not send the design back.

One thing the design doc got wrong about the mechanism, not the outcome — corrected here rather
than in the design, since it doesn't change what gets built, only how the reducer arm is wired:
`apply()` has **one central permission funnel** (`lib/workspace.ts:1906-1910`), not a per-arm
`can()` call. `permissionForAction(a.t, ...)` reads `ACTION_PERMISSIONS[a.t]`
(`lib/access.ts:489`), and a `void (ACTION_PERMISSIONS satisfies Record<Action['t'],
PermissionKey | null>)` assertion at `lib/workspace.ts:1948` makes forgetting the entry a
**compile failure naming the action**, not a silently-unguarded arm (the exact failure mode its
own comment says `recordVersion`/`correctVersion` shipped with once). The reducer arm for
`takeSnapshot` does not call `can()` itself — it only needs an entry in `ACTION_PERMISSIONS`.

Also confirmed: `projectScopeOf` (`lib/workspace.ts:820+`) — the second, independent
"is this actor staffed on the project" gate — has no case for `takeSnapshot`, deliberately.
`upsertSow`/`archiveSow` are absent from its switch too (confirmed: neither appears among its
cases; the switch's `default: return null` catches both), for the reason its own doc comment
states: this gate applies to actions resolvable to *one issue's* project, and SOW/node-scoped
actions aren't derived from a single issue. `takeSnapshot` follows the same reasoning and needs
no case added.

## Step 1 — `lib/snapshot.ts`: types and `takeSnapshot()`, pure

New file. `SnapshotEntry`, `Snapshot` (exactly as specified in the design doc's Data Model
section), and:

```ts
export function takeSnapshot(
  state: WorkspaceState,
  nodeId: string,
  rates: PersonRate[],
  actor: Actor,
  now: string,
): Snapshot
```

Composes three existing functions, does not reimplement any of them:

1. `issuesUnder(state, nodeId)` (`lib/engagement.ts:156`) — returns `IssueRecord[]`.
2. Map each to a `SnapshotEntry`: `{ issueId: i.id, subject: i.subject, plannedStart:
   i.plannedStart, plannedEnd: i.plannedEnd }` — `plannedStart`/`plannedEnd` read straight off
   `IssueRecord` (`lib/workspace.ts:301-302`), no new computation.
3. `sowCostOf(rates, issueIds, state.timeEntries)` (`lib/rates.ts:204-208`, `issueIds` being the
   same issue list's `.map(i => i.id)`) — its `CostOfWork` output stored verbatim as `cost`.

The node's current `name` and its `kind` (`'project'` or `'engagement'`, read from
`state.nodes[nodeId]`) are captured into `nodeName`/`nodeKind` at this layer too — the function
takes no stance on whether `nodeId` is valid or the right kind; that check belongs to the reducer
arm (step 2), matching this codebase's standing separation between pure logic and the guards that
gate it.

**Verify**: new scenario `SN1` in `scripts/scenario-validation.ts` (placed near `RT1`, reusing
its fixture shape — a SOW, a project, issues with baselined estimates and time entries, `BASE`'s
seeded people/rates), driving `takeSnapshot` directly, no reducer involved yet:

- Dates and cost captured match what's true at the moment of the call.
- A person-rate array omitted (`[]`) produces `cost: null` with `unratedHours` covering every
  entry's hours — `sowCostOf`'s own documented behavior, not new logic to test twice.
- An engagement root and a project root both produce a result with the same shape (both have
  `entries`/`cost` populated) from the identical call — the "one code path" claim, checked
  directly rather than assumed.

`npx tsc --noEmit && npm run validate:scenarios` — expect `SN1` `PASS`, count `206 → 207`,
`0 FAIL`.

## Step 2 — Reducer wiring

Touches `lib/workspace.ts` and `lib/access.ts`. Merges into one commit with step 1 — the pure
function has no caller until this exists, and a plan step with no way to be exercised end-to-end
through `apply()` is not yet provable as *wired*, only as *correct in isolation*.

- `lib/workspace.ts`: add `snapshots: Record<string, Snapshot>` to `WorkspaceState` (beside
  `milestones`/`personalEvents`/`meetings`, matching their exact declaration shape), seed `{}` in
  `initWorkspace`, add `{ t: 'takeSnapshot'; nodeId: string; now: string }` to the `Action`
  union.
- `lib/access.ts`: add `takeSnapshot: 'sow.edit'` to `ACTION_PERMISSIONS` (`:489+`, alongside
  `upsertSow`/`archiveSow`, same key, same neighbourhood). This is the step the compiler
  enforces — if it's missed, `tsc` fails at `lib/workspace.ts:1948` naming `takeSnapshot`
  specifically, not a silent gap.
- `lib/workspace.ts`'s `apply()`: a new `case 'takeSnapshot':` arm. Refuses if
  `state.nodes[a.nodeId]` doesn't exist or its `kind` isn't `'project'`/`'engagement'`
  (the same "does this node exist and is it the right kind" shape every other node-targeted arm
  already uses — no new refusal idiom). Otherwise calls `takeSnapshot(state, a.nodeId, rates,
  actor, a.now)` — `rates` passed as `Object.values(state.rates)` filtered to
  `can(state.model, actor, 'rate.view').allowed ? ... : []`, i.e. the ONE place in this feature
  that does call `can()` directly, because it's deciding *what to pass into* the pure function,
  not *whether the action may proceed* (already decided by the funnel before this arm runs).
  Assigns the result into `state.snapshots`, logs an audit entry (`field: 'snapshot'`, matching
  the shape other mint-only arms use — no `from`, `to` is the snapshot's `id`).

**Verify**: extend `SN1` to also drive `apply()` with a `{ t: 'takeSnapshot', ... }` action:

- An actor without `sow.edit` is refused, with the same refusal shape every other permission
  denial produces (`error` set, state unchanged) — proving the `ACTION_PERMISSIONS` entry is
  live, not just present in the map.
- A refusal for an unknown `nodeId`, and for a `nodeId` that resolves to neither `project` nor
  `engagement` (e.g. a `module`).
- A successful call lands the result in `state.snapshots`, with an audit entry.

`npx tsc --noEmit && npm run validate:scenarios` — `SN1` still `PASS`, count unchanged (extending
an existing scenario, not adding a new one), `0 FAIL`.

## Step 3 — Persistence (stands alone, its own commit)

**The step carrying the most regression risk.** This is the first time this session a *brand
new* top-level `WorkspaceState` collection has been added, rather than extending one that
already exists — every other feature this session (resolution notices, reconcile grants, rate
rollup) added fields or read-side computation over data that was already flowing through
`persistSteps`/`repo.ts`. A mismatched Prisma model, a forgotten mapper cast, or a `persistSteps`
case that doesn't fire leaves `takeSnapshot` working in memory and vanishing on reload — the
exact E2 lesson `lib/db/persist.ts`'s own comments cite (`// The arms mint, so the diff rides
along — the E2 lesson, applied at birth.`, `:537`) for `upsertMeeting`. If this step is wrong,
the failure is invisible in every check except `audit:persistence` and a live reload — silent
data loss in production, not a crash. Whoever ships this must run `npm run audit:persistence`
before deploying, not just `validate:scenarios`.

Follows `Meeting`'s shape exactly (`prisma/migrations/20260830000004_meeting/migration.sql`,
`prisma/schema.prisma:856-876`, `lib/db/map.ts:1047-1082`, `lib/db/persist.ts:535-549`,
`lib/db/repo.ts:151,166,237,287`) — the most recent precedent for a genuinely new collection:

1. `prisma/schema.prisma`: new `model Snapshot` — `tenantId`/`id` composite key
   (`@@id([tenantId, id])`, matching `Meeting`'s `tenantId String` + relation, not
   `ScheduleWatch`'s single-row-per-tenant `tenantId String @id` shape, since a tenant has many
   snapshots), `nodeId String`, `nodeKind String`, `nodeName String`, `takenAt DateTime`,
   `takenBy String`, `entries Json`, `cost Json?`, `deletedAt DateTime?`. An index on
   `(tenantId, nodeId)` — every real read pattern (`View snapshots…` for one node) filters on it.
2. `npx prisma migrate dev --name snapshot` (or the equivalent hand-written migration file if
   the dev DB isn't reachable locally) — forced RLS, the `20260824000004` tenant-isolation
   policy pattern every table since has repeated verbatim.
3. `lib/db/map.ts`: `snapshotToRow`/`snapshotFromRow`, following `meetingToRow`/`meetingFromRow`'s
   exact shape for the scalar fields, and the `x as unknown as Prisma.InputJsonValue` /
   `(r.x as unknown as SnapshotEntry[]) ?? []` cast convention already used for every other JSON
   column in this file (`lib/db/map.ts:211,247,618,650` etc.) for `entries`/`cost`.
4. `lib/db/persist.ts`: `case 'takeSnapshot':` in `persistSteps`, the same diff-and-upsert
   idiom as `upsertMeeting`/`cancelMeeting` (`:535-549`) — loop `Object.entries(after.snapshots)`,
   skip unchanged, upsert the rest. `takeSnapshot` only ever mints, never updates, so this is
   simpler than `Meeting`'s case (no `cancelMeeting`-equivalent second action to share the arm
   with).
5. `lib/db/repo.ts`: add `'snapshot'` to the mapper-name union (`:151`), `db.snapshot.findMany({
   where: { tenantId }, orderBy: { takenAt: 'desc' } })` (`:237`-equivalent — newest-first at the
   query, matching the design's "View snapshots…" dropdown order so the UI never has to re-sort),
   `snapshots: Object.fromEntries(...)` in the returned state (`:287`-equivalent).

**Verify**: `npx tsc --noEmit`, then `npm run audit:persistence` — extend
`scripts/persistence-proof.ts` with one check in its existing style: take a snapshot through the
real reducer against its own scratch tenant, reload the whole workspace through `loadWorkspace`,
assert the reloaded `Snapshot`'s `entries` and `cost` match what was written field-by-field (the
same "write deliberately, read back, compare" shape every other check in that script already
uses). Then `npm run audit:tenancy` — confirms the new `db.snapshot` calls are tenant-scoped by
the same static scan every other table already passes.

## Step 4 — UI: RowMenu entries

Touches `components/RowMenu.tsx`. Merges with step 5 (they're one feature surface, meaningless
apart — a menu entry with nothing to open is not a shippable half).

- `RowActions` interface: add `takeSnapshot?: (row: ScheduleRow) => void` and `viewSnapshots?:
  (row: ScheduleRow) => void` — optional, matching `saveBlueprint`'s own precedent exactly
  (`components/RowMenu.tsx:44`).
- Render: a new block, `row.kind === 'project' || row.kind === 'engagement'` guard (the
  `saveBlueprint` block currently checks only `row.kind === 'engagement'`
  (`components/RowMenu.tsx:220`) — this one is deliberately broader, per the design's own
  "both projects and engagements" scope decision). "Take snapshot…" always shown when the guard
  passes (a refused click surfaces the reducer's own refusal message — this codebase's
  established pattern elsewhere, e.g. Board's drag-and-drop). "View snapshots…" shown only when
  `state.snapshots` has an entry for this `row.id`, mirroring `RowMenu`'s "empty sections hide
  themselves" rule already followed for `childKinds`/`siblingKinds`.

**Verify**: `npm run audit:a11y` (new interactive elements) — `eslint components app`, expect
clean, matching every UI step's standing check this session.

## Step 5 — UI: `SnapshotDrawer.tsx` and its mount

New file, `components/SnapshotDrawer.tsx`, the same structural shape as
`ReplanningDrawer.tsx` (`state`, a target — here `{ nodeId, nodeKind }` rather than
`ReplanningDrawer`'s `{ person, personId }` — and an `onClose`). Note precisely, since it's easy
to get wrong from the design doc's "same shape as ReplanningDrawer" alone: `ReplanningDrawer` is
mounted from `PortfolioPanel.tsx`, not `IssueWorkspace.tsx` — RowMenu lives in the tree
(`IssueWorkspace.tsx`), so the local `useState<{ nodeId: string; nodeKind: 'project' |
'engagement' } | null>` + conditional render + `onClose` callback pattern is what to copy, in
`IssueWorkspace.tsx`, not the literal file it currently lives in.

Content: a dropdown of `state.snapshots` filtered to this `nodeId`, newest-first (already sorted
that way from the load path per step 3); selecting one renders its `entries` beside each issue's
*current* `plannedStart`/`plannedEnd` (a live lookup into `state.issues`, not stored on the
snapshot), and its `cost` beside a *live* `sowCostOf` call over the node's *current*
`issuesUnder(...)` result — gated by `can(state.model, actor, 'rate.view').allowed`, the exact
`mayViewRate` pattern `CommercialPanel.tsx` already uses, so a viewer who can't see current cost
doesn't see the past figure either, regardless of what was captured.

Wiring in `IssueWorkspace.tsx`: `rowActions.takeSnapshot` dispatches `{ t: 'takeSnapshot',
nodeId: row.id, now: new Date().toISOString() }` directly (matching `duplicate`'s dispatch-only
shape, `:1383`, not `saveBlueprint`'s navigate-to-Configuration shape — a snapshot is a discrete
event, not something requiring a form). `rowActions.viewSnapshots` sets the new drawer's target
state. The drawer mounts conditionally beside wherever `DetailDrawer`/other overlay panels
already mount in this file.

**Verify**: `npx tsc --noEmit`, `npm run audit:a11y`, `npm run build` — the full standing gate,
since this is the step that finally exercises every layer together.

## Step 6 — Standing gate, commit boundaries, and staged deploy

Full sequence: `npx tsc --noEmit` → `npm run validate:scenarios` (`SN1` `PASS`, count `207`,
`0 FAIL`) → `npm run audit:a11y` → `npm run audit:persistence` → `npm run audit:tenancy` →
`npm run build`. Then the established staged-deploy recipe (`git archive` → fresh deploy dir →
`npm ci` → `prisma generate` → `npm run build` → `npx prisma migrate status` — this time expect
**"following migrations have not yet been applied"**, not "up to date", since step 3 adds a real
migration → `az webapp deploy` → health poll on response body → grep the deployed bundle for a
distinctive string from step 5, e.g. `"View snapshots"`).

**Commit boundaries**: steps 1+2 together (pure logic has no independent value until it's
reachable through `apply()`, and both are provable by the same scenario extended in place).
Step 3 stands alone — a schema migration, per the design doc's own instruction and this
project's standing discipline, never bundled with logic or UI. Steps 4+5 together (a menu entry
with no drawer to open, or a drawer nothing opens, are each half a feature). Step 6 is the
deploy, not a code commit.

## What would send this design back

Both candidates the design doc named were checked during this planning pass and did **not**
trigger a reopen (see the top of this document) — recorded here so the next reader doesn't
re-derive the same check. Nothing new surfaced during grounding that the design didn't already
anticipate; the one correction found (the `ACTION_PERMISSIONS` mechanism) changed how step 2 is
built, not what the design specifies building.
