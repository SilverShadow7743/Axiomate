# Project Pulse — implementation plan

Follows `docs/plans/2026-08-31-project-pulse-design.md` (approved 2026-08-31). Ordering
principle: `projectIdsUnder` first — pure, provable alone, no caller yet — then the capacity
block inside `concernsFor` that depends on it, then `CONCERN_ORDER`'s reorder last, even though
grounding while writing this plan found the reorder is actually the SAFEST step here (see
below) — it still goes last because it's the step that makes the new concern visible in the
UI at all, and nothing should depend on visibility before the underlying computation is proven.

## Two findings from reading the real code that change what this plan needs to do

1. **`concernsFor`'s final line is `out.sort((a, b) => CONCERN_ORDER.indexOf(a.kind) -
   CONCERN_ORDER.indexOf(b.kind))`** (`lib/portfolio.ts:258`) — every concern is re-sorted by
   `CONCERN_ORDER` regardless of the order blocks push into `out`. The capacity block can be
   inserted anywhere in the function body; it does not need to sit textually between the
   `forecast` and `blocked` blocks for the design's ranking to hold.
2. **`PortfolioPanel.tsx` renders concerns fully generically**
   (`line.concerns.map((c) => c.phrase).join(', ')`, line ~172) — no per-`kind` switch anywhere.
   **This plan has no UI step.** The capacity concern appears correctly the moment
   `concernsFor` produces it, with zero changes to `PortfolioPanel.tsx`.

## Steps

### Step 1 — `projectIdsUnder(state, nodeId)`, `lib/portfolio.ts`

Add beside `projectsUnder` (line 158), mirroring its exact shape:

```ts
function projectIdsUnder(state: WorkspaceState, nodeId: string): string[] {
  const self = state.nodes[nodeId]
  const ids = Object.values(state.nodes)
    .filter((n) => !n.deletedAt && n.kind === 'project' && hasAncestor(state, n.parentId, nodeId))
    .map((n) => n.id)
  // A portfolio line's own node is sometimes ITSELF a project (the outermost-project case,
  // a firm filing projects directly under a client — see hasPortfolioAncestor). Allocation's
  // own reducer (workspace.ts:6169, `project.kind !== 'project'` refused) permits an
  // allocation directly on that node — projectsUnder's descendant-only walk would silently
  // miss it. `self` covers that; an engagement's own id is never itself a valid
  // Allocation.projectId, so including it here when self.kind !== 'project' would be
  // harmless but is skipped for clarity.
  return self?.kind === 'project' ? [nodeId, ...ids] : ids
}
```

**Verify:** `npx tsc --noEmit`. No scenario yet — this function has no caller until Step 2;
per the ordering principle it's proven correct AS PART OF Step 2's scenario, not standalone,
because its only observable behavior is through the concern it feeds.

### Step 2 — the capacity block inside `concernsFor`, plus its call-site signature change

⚠ **The step carrying the most regression risk in this plan** — not the `CONCERN_ORDER`
reorder (Step 3), which grounding while writing this plan confirmed is low-risk (see below).
`concernsFor`'s signature changes from `(state, open, lastActivity, today)` to `(state, open,
lastActivity, today, nodeId)`, and its ONE call site — `portfolio()` at line 135 — must pass
`node.id`. `concernsFor` currently always succeeds for the other five concerns; a mistake in
this signature change (wrong argument order, or passing something other than the line's own
`node.id`) would silently corrupt what EVERY concern computes for EVERY engagement, not just
fail to add capacity. Get the call site right first, verify with the existing behavior
unchanged, before trusting the new block's own output.

Insert (position in the function body doesn't matter, per finding 1 above — placed after the
`forecast` block here purely for readability, reusing its already-computed locals):

```ts
// After the existing forecast block, reusing holidays/commitments/allocations/versions
// already computed there — same data, one more question asked of it.
const projectIds = new Set(projectIdsUnder(state, nodeId))
// Keyed by personId when known, else the raw name — carrying BOTH halves forward, so there is
// no later reverse-lookup guessing which one a dedup key was.
const peopleHere = new Map<string, { person: string; personId: string | null }>()
for (const a of allocations) {
  if (a.deletedAt || !projectIds.has(a.projectId)) continue
  const key = a.personId ?? a.person
  if (!peopleHere.has(key)) peopleHere.set(key, { person: a.person, personId: a.personId ?? null })
}
let overCount = 0
let worstCapacity: { name: string; by: number } | null = null
const windowEnd = addDays(today, 28)
for (const { person, personId } of peopleHere.values()) {
  const profile = personId ? profileAt(versions, state.model.resourceProfiles, personId, today) : undefined
  // availabilityFor is checked against FULL state.allocations (not projectIds-filtered) —
  // the design's explicit decision: total commitment, not just this engagement's slice.
  const pos = availabilityFor(person, profile, commitments, allocations, today, windowEnd, personId, holidays)
  if (!pos.overallocated) continue
  overCount++
  const by = -pos.remainingHours
  if (!worstCapacity || by > worstCapacity.by) worstCapacity = { name: person, by }
}
if (overCount && worstCapacity) {
  out.push({
    kind: 'capacity',
    count: overCount,
    phrase: `${overCount} over-committed (worst ${worstCapacity.name}, by ${worstCapacity.by}h)`,
  })
}
```

New imports needed in `lib/portfolio.ts`: `availabilityFor` from `./availability`, `addDays`
from `./dates`. `profileAt` is already imported (used by the forecast block).

**The dedup key detail** (see "details most likely to be gotten wrong" below): `peopleHere` is
built as a `Set<string>` of `personId ?? person` — this correctly collapses two allocations for
the SAME id-resolved person into one entry, but does NOT collapse an allocation recorded by
name with one recorded by id for the same real person (the person/personId seam,
`axiomate-domain-analysis`). Accept this as a known limitation inherited from the seam itself,
not a bug to solve here — solving it means fixing the seam, out of scope for this feature.

**Verify:** `npx tsc --noEmit` → the new `PP1` scenario (below) `PASS` → `npm run
validate:scenarios`: count 195 → 196, nothing else changes verdict (the forecast/overdue/
blocked/unowned/stale blocks are untouched code, but re-run to be certain the signature change
didn't silently break a call site).

### Step 3 — `CONCERN_ORDER` reorder, `lib/portfolio.ts:58`

Confirmed low-risk while writing this plan: grepped every use of `CONCERN_ORDER` in the
repository (`lib/portfolio.ts` only, three call sites — the export itself, the final
`out.sort()`, and `compareLines`' `indexOf`/`.length` calls) — all three are `.indexOf`/
`.length`-relative, none assume a fixed array length or a specific adjacent pair. The reorder
is a genuine one-line change with no other blast radius:

```ts
export const CONCERN_ORDER = ['overdue', 'forecast', 'capacity', 'blocked', 'unowned', 'stale'] as const
```

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: count unchanged (196), `PP1` and
every pre-existing portfolio-touching scenario unchanged verdict — this proves the reorder
didn't silently change any EXISTING concern's relative position in a way a scenario would
catch.

### Step 4 — `PP1` scenario, `scripts/scenario-validation.ts`

Pin the real `portfolio()`/`concernsFor()` path (not `projectIdsUnder`/the capacity block in
isolation — per this project's own scenario discipline, drive the real public function, not an
internal helper). Construct:

- An engagement with two project-tier children.
- One person allocated 70% on the first child project and 60% on the second, both starting
  today or earlier and running past `today+28`d — combined exceeds capacity; must appear ONCE
  in the count, not twice.
- A second person allocated 30% on one of the same projects — comfortably within capacity,
  must NOT appear.
- Assert: `portfolio(state, TODAY).find(l => l.nodeId === engagementId).concerns` contains a
  `kind: 'capacity'` entry with `count === 1` and a phrase naming the first person.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: `PP1` `PASS`, count 196 → 197,
0 FAIL → `npm run audit:a11y` (no UI touched, expect 0 unchanged) → `npm run build`.

## Commit boundaries

- **Commit 1**: Steps 1–2 together — `projectIdsUnder` has no independent scenario (per the
  ordering principle's own allowance: "where an existing test harness can be pointed at new
  logic before that logic is wired in, do that as its own step" doesn't apply here, since
  `projectIdsUnder`'s only meaningful behavior is observable through the concern it feeds) —
  and Step 4's `PP1` scenario, since a capacity block with no scenario pinning it is not
  provably correct. Steps 1, 2, and 4 are meaningless in isolation from each other.
- **Commit 2**: Step 3 (the reorder) standalone — confirmed safe, but kept separate because it's
  the step that changes user-visible ranking, and an isolated commit is a one-line revert if
  the live walkthrough (below) finds the position reads wrong in practice.
- **Deploy**: after both commits.

## Details most likely to be gotten wrong

- **`projectIdsUnder` must include `nodeId` itself when it's a project-kind node** — the
  outermost-project edge case (no engagement layer) — or allocations directly on that node are
  silently invisible to the capacity concern. `projectsUnder`'s existing descendant-only logic
  does NOT have this problem for ITS purpose (counting descendant projects, correctly excluding
  self), which is exactly why this can't be solved by literally reusing `projectsUnder` and
  just changing what it returns — the semantics differ by one line, and that line matters.
- **The dedup key must resolve to `personId ?? person`, and `availabilityFor` must receive the
  FULL, unfiltered `state.allocations`** — filtering allocations to `projectIds` before calling
  `availabilityFor` would silently check only this engagement's slice of someone's commitments,
  contradicting the design's explicit "against a person's TOTAL allocation" decision. Filter
  ONLY when finding who to check (`peopleHere`); never filter the array handed to
  `availabilityFor`.
- **`addDays`, not `addWorkingDays`** — the 28-day window is a calendar span (matching the
  design's "today → today+28 days" and the pitch's "Week 3" framing), not 28 working days
  (~39 calendar days) — confirmed `lib/dates.ts:16`'s `addDays(iso, days)` is the calendar-day
  function; `addWorkingDays` (line 55) is a different function for a different purpose
  (`axiomate-scheduling`'s SLA proposals) and must not be reached for here by habit.
- **`concernsFor`'s new `nodeId` parameter is the PORTFOLIO LINE's node id** (an engagement, or
  an outermost project) — not an issue id, not a project id from inside the loop. `portfolio()`
  already has this value as `node.id` at its call site; the risk is a future edit passing the
  wrong variable if the function is refactored again later, not anything ambiguous today.

## What would send this back

- If `PP1` cannot be made to pass without filtering `state.allocations` before calling
  `availabilityFor` — i.e., if checking someone's TOTAL commitment produces a result that
  reads as wrong or unexplainable for the test fixture — that means the design's "total
  allocation" decision needs re-examination, not a quiet filter added to make the test pass.
  Surfaces at Step 4.
- If, once live, the capacity concern fires so frequently (many people crossing the
  overallocated line inside any 28-day window) that it dominates every engagement's concern
  list, that's the design's own named risk (noisy, flickering counts) — grounds to revisit the
  window length as a follow-up, not to abandon the concern. Surfaces only after deployment;
  the gate cannot catch it.
- If Step 1's `projectIdsUnder` needs `hasPortfolioAncestor`-style logic beyond the single
  `self.kind === 'project'` check (e.g., a portfolio line's node is a project AND has further
  nested projects that also carry allocations, in some interaction not covered by the simple
  descendant walk) — surfaces at Step 4's scenario if the fixture is built to exercise nesting;
  if found, extend the fixture and the function together rather than special-casing around it.

## Deploy

Same staged recipe as prior features this session: `git archive` the combined commits → fresh
dir → `npm ci` → `npx prisma generate` → `npm run build` → package via
`scripts/package-release.py` → `az webapp deploy` → health poll on response body. **Live
walkthrough**: open Portfolio for an engagement with a real, currently-overallocated person (if
one exists in production data) and confirm the capacity concern appears with a sensible phrase;
otherwise confirm engagements WITHOUT capacity issues show no new concern (a quieter, equally
important check — the feature must not fire when it shouldn't).
