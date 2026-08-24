# Timesheet: scheduled outcomes for the week — implementation plan

Follows `docs/plans/2026-08-24-timesheet-scheduled-outcomes-design.md`, approved after three
rounds of checking the design against real data (issue planned dates, allocation coverage, and
per-project row counts) rather than assumption. Quotes below are from that document as it stands.

**Ordering principle.** Two new pure functions in `lib/timesheet.ts` — the same "no clock, no
database" module `weekGrid` already lives in — fully provable by scenario before either one is
wired into `TimesheetPanel.tsx`. The UI step comes last because it is the one step this plan
cannot fully verify without a browser, and because both pure functions are cheap to get right in
isolation and expensive to debug through a rendered grid.

## Step 1 — `scheduledOutcomes` in `lib/timesheet.ts`

**New function**, alongside `weekGrid`:

```ts
export function scheduledOutcomes(
  allocations: Allocation[],
  nodes: Record<string, HierarchyNode>,
  issues: Record<string, IssueRecord>,
  person: string,
  week: string,
  personId?: string | null,
): string[]
```

Returns the issue ids that are "an open issue the person owns, under a project they have an
active allocation for, this week" — the design's exact words. Needs `Allocation` imported from
`./capacity`, `HierarchyNode`/`IssueRecord` from `./workspace`, `isTerminal` from `./schedule`.

**Three pieces, in the order they should be written:**

1. **Which allocations are active this week.** Filter `allocations` to this person — the same
   id-first, name-fallback join `entriesInWeek` already uses
   (`a.personId && personId ? a.personId === personId : a.person...`) — whose `[startDate,
   endDate]` overlaps `[week, week + 7)`, the same range shape `entriesInWeek` filters
   `TimeEntry.date` against.
2. **Which node ids sit under each matching allocation's `projectId`.** A breadth-first walk over
   `nodes` by `parentId`, seeded from each matching `projectId`, unioned into one set.
3. **Which issues qualify.** Every issue in `issues` where: `owner` matches this person (same
   join as step 1, issue-level — `IssueRecord` carries no `ownerId`, so this one is name-only,
   matching how `owner` is compared everywhere else in this codebase); `!isTerminal(status)`; and
   walking the issue's own ancestor chain reaches one of step 2's node ids.

**The ancestor walk in piece 3 is the detail most likely to be gotten wrong.** `IssueRecord.parentId`
is documented as "a hierarchy node **or another issue** (a sub-issue)" — a walk that only ever
looks up `nodes[issue.parentId]` stops immediately on a sub-issue and silently excludes it, the
same class of gap TV1's tree-visibility bug was. The walk must check `issues[id]` first (follow to
`issues[id].parentId`) and fall back to `nodes[id]` (walk stops there — a node has no further
issue ancestor).

**Verify:** a handful of scenario cases (naming convention: `TS-SO1` etc., in
`scripts/scenario-validation.ts`, following `TV1`–`TV6`'s own hand-built-records pattern — no
reducer, no database):

- an owned, open issue directly under an allocated project, allocation covering the week →
  included;
- the same shape but the allocation's date range does not cover the week → excluded;
- an owned, open **sub-issue** two levels under an allocated project (proving the ancestor walk
  crosses an issue-to-issue hop, not just node-to-node) → included;
- an issue under an allocated project, open, but owned by somebody else → excluded;
- an owned issue under an allocated project that is terminal-status → excluded.

`npx tsc --noEmit` and `npx tsx scripts/scenario-validation.ts` (or `npm run validate:scenarios`)
after writing these.

## Step 2 — `withScheduled` in `lib/timesheet.ts`

**New function**, taking `weekGrid`'s own row shape so the two compose without either one knowing
about the other's internals:

```ts
export function withScheduled(rows: WeekGridRow[], scheduledIssueIds: string[]): WeekGridRow[]
```

For every id in `scheduledIssueIds` not already present in `rows` (by `issueId`), append `{
issueId, byDay: [0,0,0,0,0,0,0], total: 0 }`, then re-sort by `issueId` with the same
`localeCompare` `weekGrid` itself uses — so a row's position never depends on whether it arrived
via logged hours or via this merge.

Deliberately not folded into `weekGrid` itself. `weekGrid` has existing scenario coverage and a
settled, narrow job ("aggregate what's logged"); this keeps that function's signature and
behaviour completely unchanged and adds the merge as its own, separately-provable step — cheaper
to verify and lower risk than widening an already-relied-upon function's contract.

**Verify:** scenario cases — a scheduled id not in `rows` is appended with all-zero hours; a
scheduled id already in `rows` (from logged hours) appears once, with its real hours, not
duplicated or zeroed; the merged list stays sorted by `issueId` regardless of insertion order.
`npx tsc --noEmit` and the scenario run again.

**Commit steps 1 and 2 together.** Both are additions to the same pure module, the second existing
only to compose with the first's output, and neither is reachable from the UI until step 3 wires
them in — shipping one without the other is not a usable state.

## Step 3 — Wire `TimesheetPanel.tsx`

**File:** `components/TimesheetPanel.tsx`. Only the "my week" section changes.

```ts
const allocations = useMemo(() => Object.values(state.allocations), [state.allocations])
const scheduledIds = useMemo(
  () => scheduledOutcomes(allocations, state.nodes, state.issues, actor.name, week, meId),
  [allocations, state.nodes, state.issues, actor.name, week, meId],
)
const displayRows = useMemo(() => withScheduled(grid.rows, scheduledIds), [grid.rows, scheduledIds])
```

`grid.rows.map(...)` in the render (the `<tbody>` loop, currently mapping `grid.rows` directly)
becomes `displayRows.map(...)`. `grid.byDay`/`grid.total` (the week's actual totals, and the
`ts-total-row` footer) stay driven by `grid` itself, unchanged — a scheduled-but-unlogged row
contributes zero to the real total, which is correct: nothing has actually been logged yet, and
the footer must keep meaning "hours you have recorded," not "hours you were expected to record."

No new props into `TimesheetPanel` and no changes in `IssueWorkspace.tsx` — `TimesheetPanel`
already receives the whole `state`, the same way it already derives `entries` from
`state.timeEntries`.

**This is the step carrying the most regression risk in this plan**, not because the logic is
complex but because it is the one step neither scenario coverage nor `tsc` can fully verify: a
`useMemo` dependency array missing `week` (easy to do, since `week` is read inside
`scheduledOutcomes` but easy to leave out of the array by habit) would mean scheduled rows freeze
on whatever week the panel first rendered and silently stop updating when the person clicks
Previous/Next week or "This week" — a bug that looks correct on first load and wrong on every
navigation after.

**Verify:** `npx tsc --noEmit`, `npm run validate:scenarios`, `npm run build`, then a real
browser check against the deployed app once live — open Timesheets as a person with an active
allocation and owned open work under it (the real data has this for Amolak, Michael Thomas,
Dharmendra Kumar Dwivedi, or Jaya Jothi R), confirm scheduled rows appear at 0h, log an hour
against one, confirm it becomes a real hour rather than a duplicate row, and confirm changing the
viewed week updates which scheduled rows show.

**Stands alone as its own commit** — the only step touching a component, and the only one this
plan cannot fully prove before a person looks at it.

## Details most likely to be gotten wrong

- The ancestor walk crossing issue-to-issue before falling back to node-to-node (step 1) — the
  exact shape of the bug TV1 already found once in a sibling piece of tree logic this session.
- The allocation and issue-owner joins must each use the SAME id-first/name-fallback convention
  already established (`entriesInWeek`'s own pattern) — not a fresh string comparison that could
  disagree with it under a rename.
- The `useMemo` dependency arrays in step 3, specifically `week` — see step 3's own risk note.
- `withScheduled`'s sort must match `weekGrid`'s exactly, or rows reorder depending on whether
  they arrived from logged hours or from the merge.

## What would send this back to the design

- If step 1's scenario cases show the ancestor walk cannot reliably distinguish "under an
  allocated project" from "under a different project entirely" once real sub-issue nesting is
  involved — that is a gap in the mechanism itself, not a detail to patch around in one call site.
- If, once live, the row counts in practice turn out noisier than the 0–24 sampled while writing
  the design — this is the design's own listed risk, restated here because step 3 is where it
  would actually be observed.
