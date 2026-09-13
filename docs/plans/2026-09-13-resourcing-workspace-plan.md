# Resourcing workspace — implementation plan

Follows `docs/plans/2026-09-13-resourcing-workspace-design.md`.

**Ordering:** the two pure functions and their scenario first — `actualHoursByPerson` is
genuinely new logic, `resourcingRows` composes it with `capacityFor` (already proven
elsewhere), so both need proving before anything renders. View wiring (sidebar entry,
stale-view guard) is next since the panel depends on `view` existing as a valid state before
it can render into it. The panel component is last — the only step a scenario cannot check.

## 1. `lib/capacity.ts` — `actualHoursByPerson` and `resourcingRows`

```ts
export function actualHoursByPerson(
  entries: Record<string, TimeEntry>,
  from: string,
  to: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of Object.values(entries)) {
    if (e.deletedAt) continue
    if (e.date < from || e.date > to) continue
    const key = e.personId ?? e.person.trim().toLowerCase()
    out[key] = (out[key] ?? 0) + e.hours
  }
  return out
}
```

Keying: `e.personId ?? e.person.trim().toLowerCase()` — the exact join `lib/reports/finance.ts`
already uses (`:124`), so a caller resolving a `ResourcingRow`'s actual hours by the same key
shape it already resolves everything else by never has a second, drifting definition of
"the same person."

`resourcingRows(state, from, to)`:

```ts
export function resourcingRows(state: WorkspaceState, from: string, to: string): ResourcingRow[] {
  const actual = actualHoursByPerson(state.timeEntries, from, to)
  const profiles = profilesAt(Object.values(state.versions), state.model.resourceProfiles, from)
  const commitments = Object.values(state.commitments)
  const allocations = Object.values(state.allocations).filter((a) => !a.deletedAt)

  return Object.values(state.model.people)
    .filter((p) => p.status !== 'Departed')
    .map((p) => {
      const live = allocations.filter(
        (a) => (a.personId ? a.personId === p.id : a.person.trim().toLowerCase() === p.name.trim().toLowerCase())
          && a.startDate <= to && a.endDate >= from,
      )
      const projects = [...new Set(live.map((a) => state.nodes[a.projectId]?.name).filter((n): n is string => !!n))]
      const position = capacityFor(p.name, profiles[p.id], commitments, allocations, from, to, p.id)
      return {
        personId: p.id,
        person: p.name,
        position,
        actualHours: actual[p.id] ?? actual[p.name.trim().toLowerCase()] ?? 0,
        projects,
        bench: live.length === 0,
      }
    })
    .sort((a, b) => a.person.localeCompare(b.person))
}
```

Same `isPerson`-shaped id-first-with-name-fallback match `capacityFor`/`availabilityFor`
already do internally, spelled out here only for the "which projects" resolution, which
`capacityFor` itself doesn't return.

**Verified by:** `npx tsc --noEmit` clean; a new scenario (below) proving the shape before
`ResourcingPanel` exists to call it.

## 2. Scenario — before any wiring

Add to `scripts/scenario-validation.ts`: three people against a hand-built slice of
`state.allocations`/`state.timeEntries`/`state.commitments` (reuse `rowsOf(BASE)`'s
established pattern of spreading a real fixture row and overriding fields, as `BLK1`/`BLK2`
already do) —

- Person A: two live allocations, different projects, overlapping the window — asserts
  `projects.length === 2` and that `position.allocatedHours` is the SUM across both (proving
  the firm-wide, not per-project, computation this whole design rests on).
- Person B: zero live allocations — asserts `bench: true`, `projects: []`.
- Person C: allocated over 100% in the window — asserts `position.overallocated === true`.
- `actualHoursByPerson`, checked directly: an entry inside the window counts, one dated
  before `from` or after `to` does not, one on a departed... no — a **deleted** entry does not.

**Verified by:** `npm run validate:scenarios` showing the new scenario `PASS`, and
`git diff data/validation.json` additive-only (no existing verdict moves) — the same
byte-diff discipline every prior commit this session has held to.

## 3. View wiring — `lib/viewChoice.ts`, `AppSidebar.tsx`, `IssueWorkspace.tsx`

- `WORKSPACE_VIEWS` gains `'resourcing'` (after `'portfolio'`).
- `AppSidebar.tsx`'s `GROUPS` Workspace group gains `'resourcing'`; `VIEW_LABEL` gains its
  label. **Never** added to `CLIENT_GROUPS`.
- `IssueWorkspace.tsx` gains the stale-view guard, same shape as `'people'`'s (`:930`):
  ```ts
  if (view === 'resourcing' && !can(state.model, actor, 'capacity.allocate').allowed) setView('mywork')
  ```
- The view-ternary chain gains `) : view === 'resourcing' ? (<ResourcingPanel .../>` beside
  `portfolio`/`applications`.

**Verified by:** `npx tsc --noEmit` and `npx eslint components/AppSidebar.tsx
components/IssueWorkspace.tsx` clean.

## 4. `components/ResourcingPanel.tsx` — the step no scenario can check

New component: summary tiles, quick filter, sortable table over `resourcingRows(state, from, to)`
(`from`/`to` local state, defaulting to `today`→`addDays(today, 90)` — the exact default
`CapacityPanel` already uses). Row click opens the person's Profile via the same
`onOpenProfile` callback `PeopleDirectory` already receives — not a new navigation path.

**Detail likely to be got wrong:** the tile counts must be computed from the SAME
`resourcingRows` array the table renders, not a second, separately-filtered pass — two
counts of "the same thing" computed two different ways is exactly the class of drift this
codebase's own design docs warn about elsewhere (the type-scale/spacing drift in
`axiomate-design-system.md`).

**Verified by:** `npx tsc --noEmit` and `npx eslint components/ResourcingPanel.tsx` clean;
`npm run validate:scenarios` re-run to confirm still byte-identical (this step adds no new
pure logic); a manual pass — the tiles' four counts sum to the directory's active-person
count minus nobody (every person lands in exactly one of staffed/under/over/bench), filtering
by name narrows the table, and the person link opens the right profile.

## Commits

- Steps 1 + 2 together — the functions and their proof.
- Steps 3 + 4 together — wiring and the component are meaningless apart (a view nobody can
  reach, or a component nothing renders).

## What would send the design back

- If `actualHoursByPerson`'s all-hours-not-just-approved choice turns out to read as
  misleading next to `Allocated %` (a figure that IS policy-gated) — the two columns would be
  comparing a raw fact to a governed one without saying so, and might need an explicit
  "approved only" toggle rather than one fixed choice. Surfaces once real data is behind it,
  in step 4's manual pass.

Not expected otherwise — the computation is a straightforward composition of already-proven
functions, and the identified risk in the design (v1 being read-only) was a scope decision,
not an open technical question.
