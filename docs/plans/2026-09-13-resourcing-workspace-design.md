# Resourcing workspace — design

First of the three new pages from the 12 Sep business-process review (§4, Design 1) and its
interactive wireframe (`docs/strategy/2026-09-12-business-process-review.md`). Answers the
single most-repeated finding across all five domain reviews: every allocation action requires
opening one project's Capacity tab, and nothing shows who is free across the practice.

## What already does the work

`components/CapacityPanel.tsx` already computes exactly the number this page needs, and
already computes it firm-wide by accident of its own inputs: its `positions` (`:170-183`)
calls `capacityFor(person, profile, Object.values(state.commitments), Object.values(state.allocations), from, to)`
— the **unfiltered** `state.allocations`, every project, not just the one the panel is open
on. `capacityFor` is a thin wrapper over `lib/availability.ts`'s `availabilityFor`, which
filters by person internally (`isPerson`). So a person allocated to three projects already has
their true firm-wide `allocatedHours`/`remainingHours`/`utilisationPct` computed today —
it only ever gets shown next to the one project whose tab happened to be open. This page is a
new caller of an existing computation, not a new one.

`profilesAt(versions, profiles, on)` (`lib/capacity.ts:141`) resolves every person's working
pattern at once — the same call `CapacityPanel` already makes per-render.

## New pure logic — the one addition

Nothing computes allocation-vs-**actual** hours (the number the review named as the real gap:
"allocated but not billing" is currently invisible). New function, `lib/capacity.ts`:

```ts
/** Hours actually logged per person, in [from, to] -- every entry, not only approved ones,
 *  since the point is a live check-in, not a billing figure (that's buildFinanceReport's job,
 *  a different question with a different answer). */
export function actualHoursByPerson(
  entries: Record<string, TimeEntry>,
  from: string,
  to: string,
): Record<string, number> // keyed by personId when known, else lowercased person name
```

Sums `e.hours` for live entries (`!deletedAt`) with `from <= e.date <= to`, keyed the same
id-first-with-name-fallback way every other person join in this codebase already is.

## The aggregation, one new function

```ts
export interface ResourcingRow {
  personId: string | null
  person: string
  position: CapacityPosition   // from capacityFor -- allocatedHours, remainingHours, utilisationPct, overallocated
  actualHours: number
  projects: string[]           // display names, from the person's live allocations in-window
  bench: boolean                // no live allocation overlapping [from, to]
}

export function resourcingRows(
  state: WorkspaceState,
  from: string,
  to: string,
): ResourcingRow[]
```

One row per **active** directory person (`status !== 'Departed'`, matching every other
active-people list this session's fixes already established — `ownerChoicesFor`,
`CapacityPanel`'s `CommitmentForm` person list). For each: `capacityFor` exactly as
`CapacityPanel` already calls it, `actualHoursByPerson`'s figure for that person, project
names resolved from `state.nodes[a.projectId]?.name` for their live allocations overlapping
the window, `bench` when that list is empty.

## View wiring

- `lib/viewChoice.ts`'s `WORKSPACE_VIEWS` gains `'resourcing'`.
- `components/AppSidebar.tsx`'s `GROUPS` Workspace group gains `'resourcing'` (after
  `'portfolio'`) — never `CLIENT_GROUPS`, matching the design's own "never reaches client nav."
- `IssueWorkspace.tsx` gains the same stale-view guard `'people'` already has (`:930`):
  `if (view === 'resourcing' && !can(state.model, actor, 'capacity.allocate').allowed)
  setView('mywork')` — nav hiding stops choosing it, this stops a stale/forced choice from
  rendering it, the exact reasoning the existing comment there already gives for `people`.
- New component `components/ResourcingPanel.tsx`, rendered in the same view-ternary chain as
  `portfolio`/`applications`, `docked` the same way.

## Page structure (per the wireframe, now precise)

- Summary tiles: Fully staffed / Under-allocated / Over-allocated / Bench — counts over
  `resourcingRows`' own `position.overallocated`/`remainingHours`/`bench`, no new thresholds
  invented (over-allocated = `overallocated`; under-allocated = `utilisationPct` below a
  **configured** threshold would be new policy — for v1, "not fully allocated and not bench":
  `remainingHours > 0 && !bench`, stated plainly as the definition, open to being named a
  policy later if it needs to be).
- List-page discipline: quick filter (name/project), sortable columns, first column links to
  the person's Profile (`onOpenProfile`, the same callback `PeopleDirectory` already uses).
- Columns: Person · Allocated % (`utilisationPct`) · Actual hrs (`actualHours`) · Variance
  (`actualHours` vs. allocated hours, i.e. `position.allocatedHours`) · Projects · Bench.
- Date window: `from`/`to` state, defaulting to today→+90 days — the exact default
  `CapacityPanel` already uses (`addDays(today, 90)`), so the same window means the same thing
  in both places.

## Out of scope (v1)

- **"Group by: Project" pivot.** Real value, genuinely more work (a second aggregation, over
  projects rather than people) — not needed to close the review's stated gap ("who is free"),
  which is answered by the person view alone. Fast-follow, not this pass.
- **Allocate directly from this page.** `AllocateForm` is built around a known project with a
  picked person; inverting it (a known person, pick a project) is a different form, not a
  drop-in reuse, despite the review's own prose implying otherwise — checked against the
  actual component and it doesn't fit as cleanly as described. v1 links each row to the
  person's Profile; allocating still happens on the project's own Capacity tab, unchanged. If
  this friction turns out to matter in practice, the person-first allocate form is a real,
  separate design, not a one-line addition.

## Risk

Low. `resourcingRows` is pure and additive — no existing function's behaviour changes, no
reducer arm touched, no write path added (v1 is read-only). The named risk is the same class
every new list view in this codebase carries: getting the person-active-directory filter or
the project-name resolution wrong reads as a UI bug (a missing row, a blank project name), not
a data-integrity one.

## Testing

A new scenario proves `resourcingRows` against a small fixture: two people with allocations
across different projects (confirming firm-wide, cross-project totals, not per-project ones),
one bench person (zero rows, `bench: true`), one over-allocated person (`overallocated: true`
matches the tile count), and `actualHoursByPerson` counting logged hours only inside the
window. The view wiring (sidebar entry, stale-view guard, the panel's own rendering) is UI
behaviour this harness does not drive — verified by typecheck, eslint, and a manual pass, the
same limit every other view-wiring change this session has lived with.
