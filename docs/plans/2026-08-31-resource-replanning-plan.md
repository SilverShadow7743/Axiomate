# Automatic Resource Replanning — implementation plan

Follows `docs/plans/2026-08-31-resource-replanning-design.md` (approved 2026-08-31). Ordering
principle: the read-side computation first — provable alone, matched against Portfolio's own
capacity concern before anything depends on it — then the reducer's edit-by-id path, proven on
its own before any UI reaches it, because it is the one path in this codebase that has never
been exercised by a real caller. The UI comes last, since it depends on everything above already
being correct.

## One finding from reading the real code that this plan resolves

**`Concern` carries no identity for who a concern is about** — `{ kind, count, phrase }`
(`lib/portfolio.ts:63-69`), and the capacity concern's phrase names only the worst person as a
string inside a sentence (`"${overCount} over-committed (worst ${worstCapacity.name}, by
${worstCapacity.by}h)"`). The design says the drill-down opens from the capacity concern's
phrase, but there is nothing structured to open it FOR. Re-deriving "who is worst" a second time
in a new function would be exactly the two-disagreeing-readings risk the design's own send-back
list names first.

**Resolution**: two new optional fields on `Concern` — `subjectPerson?: string` and
`subjectPersonId?: string | null` — populated only by the capacity block, with exactly the same
`worstCapacity` values it already computes, undefined for the other five kinds. Additive, not a
shape change any other concern kind's callers need to handle — the same pattern Zero-Entry
Timesheet used for `WeekDayCell`'s `sourceTitles?` prop.

## Steps

### Step 1 — `lib/replanning.ts`, new file

```ts
import { availabilityFor, overlapWorkingDays } from './availability'
import { profileAt } from './capacity'
import { holidaySetOf } from './config'
import { addDays } from './dates'
import type { WorkspaceState } from './workspace'

export interface ReplanningAllocationRow {
  id: string
  projectId: string
  projectName: string
  percentage: number
  startDate: string
  endDate: string
  hoursInWindow: number
}

export interface ReplanningView {
  person: string
  personId: string | null
  windowFrom: string
  windowTo: string
  deficitHours: number
  allocations: ReplanningAllocationRow[]
}

/**
 * Decision-support only — no allocation is picked as the one to change. See
 * docs/plans/2026-08-31-resource-replanning-design.md. `null` when the person is not
 * overallocated in this window; a deficit with nothing to show is not a real case.
 */
export function replanningFor(
  state: WorkspaceState,
  person: string,
  personId: string | null,
  today: string,
): ReplanningView | null {
  const holidays = holidaySetOf(state.model)
  const commitments = Object.values(state.commitments)
  const allocations = Object.values(state.allocations)
  const versions = Object.values(state.versions)
  const windowFrom = today
  const windowTo = addDays(today, 28)

  const profile = personId ? profileAt(versions, state.model.resourceProfiles, personId, today) : undefined
  const pos = availabilityFor(person, profile, commitments, allocations, windowFrom, windowTo, personId, holidays)
  if (!pos.overallocated) return null

  const hoursPerDay = profile?.hoursPerDay ?? 7.5
  const key = person.trim().toLowerCase()
  const mine = allocations.filter(
    (a) => !a.deletedAt && (a.personId && personId ? a.personId === personId : a.person.trim().toLowerCase() === key),
  )

  const rows: ReplanningAllocationRow[] = mine
    .map((a) => {
      const days = overlapWorkingDays(a.startDate, a.endDate, windowFrom, windowTo, holidays)
      const hoursInWindow = Math.round(days * hoursPerDay * (a.percentage / 100) * 100) / 100
      return {
        id: a.id,
        projectId: a.projectId,
        projectName: state.nodes[a.projectId]?.name ?? a.projectId,
        percentage: a.percentage,
        startDate: a.startDate,
        endDate: a.endDate,
        hoursInWindow,
      }
    })
    .filter((r) => r.hoursInWindow > 0)
    .sort((x, y) => y.hoursInWindow - x.hoursInWindow)

  return {
    person,
    personId,
    windowFrom,
    windowTo,
    deficitHours: -pos.remainingHours,
    allocations: rows,
  }
}
```

**The `hoursPerDay` and window MUST match `lib/portfolio.ts`'s capacity block exactly**:
`profileAt(versions, resourceProfiles, personId, today)` with the SAME `today`, `windowTo =
addDays(today, 28)` with the SAME `today`, `holidaySetOf(state.model)` over the SAME model. This
is not a stylistic echo — it is what makes `deficitHours` here provably equal to `-remainingHours`
in Portfolio's own `pos.overallocated` check for the identical person, which `RR1` (below) pins
directly.

**Verify:** `npx tsc --noEmit`. No caller yet — proven by `RR1` next.

### Step 2 — `RR1`, `scripts/scenario-validation.ts` (read-side)

Placed beside `PP1` (the Project Pulse capacity scenario), reusing its own fixture idiom:
Priya allocated across two projects under different engagements, combined over capacity (forced
through via `setAllocationPolicy: advisory` + `acceptOverallocation: true`, exactly as `PP1`
already does), Sam allocated but comfortably within capacity.

- `replanningFor(state, 'Priya', priyaId, TODAY)` returns non-null: `deficitHours` equal to
  `-portfolio(state, TODAY)`'s own capacity concern position for Priya (cross-checked by calling
  `availabilityFor` directly in the scenario with the identical arguments, not by trusting the
  two modules agree) — this is the design's own named "what would send this back" risk, pinned
  here rather than assumed.
- Both of Priya's allocations appear as rows, each with a plausible `hoursInWindow`, project
  names resolved (not raw ids).
- `replanningFor(state, 'Sam', samId, TODAY)` returns `null` — no fabricated deficit for someone
  within capacity.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: `RR1` `PASS`, count 197 → 198,
0 FAIL.

### Step 3 — `RR2`, `scripts/scenario-validation.ts` (reducer edit-by-id) ⚠ riskiest step in this plan

**Not a UI mistake risk — a latent reducer risk.** `upsertAllocation`'s edit-by-id branch
(`lib/workspace.ts:6167-6245`) has existed since Allocation shipped, but grepped every UI call
site in this codebase and found exactly one — `IssueWorkspace.tsx`'s `onAllocate`, which always
passes `id: null`. No caller has ever exercised the branch where `a.id` names an existing
allocation. If that branch has a latent bug — `createdBy`/`createdAt` not actually preserved,
`personId` not re-resolved correctly, the audit trail recording the wrong `rowId` — this plan's
Apply button would be the first thing in production to hit it, live, changing a real person's
committed capacity. Proving the branch alone, before any UI depends on it, is exactly the
ordering principle's own reason for existing.

Construct: create an allocation via `ok()` (`id: null`, `percentage: 60`), capture its id, then
edit it via a second `upsertAllocation` action with that same `id` and `percentage: 30` (a plain
reduction — no cap conflict possible, per the reducer's own arithmetic: `others` excludes this
id, so lowering `next.percentage` only ever lowers the total). Assert:

- The stored allocation's `percentage` is now `30`.
- `person`, `projectId`, `startDate`, `endDate`, `note` are byte-identical to what was created —
  not something the scenario re-asserts by re-passing them, but read back off the stored record
  and compared.
- `createdBy` and `createdAt` are unchanged from the original create (not reset to the edit's
  actor/time).
- The audit trail records the edit as a real, distinct entry.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: `RR2` `PASS`, count 198 → 199,
0 FAIL.

### Step 4 — `lib/portfolio.ts`: `Concern`'s two new fields

Add `subjectPerson?: string` and `subjectPersonId?: string | null` to the `Concern` interface
(line ~63-69). In the capacity block (line ~274-280), set both from the already-computed
`worstCapacity` when pushing the `capacity` concern:

```ts
out.push({
  kind: 'capacity',
  count: overCount,
  phrase: `${overCount} over-committed (worst ${worstCapacity.name}, by ${worstCapacity.by}h)`,
  subjectPerson: worstCapacity.name,
  subjectPersonId: peopleHere.get(/* the key worstCapacity.name was stored under */)?.personId ?? null,
})
```

`worstCapacity` currently only carries `{ name, by }` — it needs `personId` added when it's set
(inside the loop over `peopleHere.values()`, where `personId` is already in scope), not
re-derived afterward by searching `peopleHere` a second time.

Extend `PP1` (does not need a new scenario — it already constructs exactly this fixture) to also
assert `capacity.subjectPersonId === priyaRow.id` and `capacity.subjectPerson === 'Priya'`.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: `PP1` still `PASS` with the
strengthened assertion, count unchanged (199), 0 FAIL.

### Step 5 — UI: `PortfolioPanel.tsx` link + new `ReplanningDrawer.tsx`

The capacity concern's phrase becomes a button/link (only when `subjectPersonId` or
`subjectPerson` is present) opening `ReplanningDrawer`, built on the existing `DetailDrawer`
pattern. The drawer calls `replanningFor(state, subjectPerson, subjectPersonId, today)` and
renders the deficit plus the allocation table. Each row: project name, current %, current
hours, a percentage input (defaulting to the row's own current value, not blank), an **Apply**
button, and a **Release** button.

- **Apply** dispatches `{ t: 'upsertAllocation', id: row.id, person, projectId: row.projectId,
  startDate: row.startDate, endDate: row.endDate, percentage: <typed value>, note: <the
  allocation's existing note, read off state.allocations[row.id], never reconstructed>, now }` —
  every field except `percentage` read directly off the stored `Allocation` record the row came
  from, not off local component state, per the design's own flagged risk.
- **Release** dispatches the existing `{ t: 'removeAllocation', id: row.id, now }`, unchanged
  from `IssueWorkspace.tsx`'s own `onRelease`.

No row is pre-selected or highlighted. `projectName` already falls back to the raw id in
`replanningFor` itself (Step 1), so the drawer never needs its own missing-node handling.

**Verify:** `npx tsc --noEmit` → `npm run audit:a11y` (0, matching every prior UI step this
session) → `npm run build`.

## Commit boundaries

- **Commit 1** — Step 1 + Step 2: `lib/replanning.ts` + `RR1`. Meaningless in isolation from
  each other (an unpinned pure function is not provably correct); meaningful together.
- **Commit 2** — Step 3 (`RR2`) standalone. The riskiest step in this plan, kept isolated
  specifically so a problem found in the reducer's edit-by-id path — the only genuinely new
  reducer behavior this plan exercises for the first time — has a one-commit revert target that
  does not also take back the UI or the read-side module.
- **Commit 3** — Step 4: `lib/portfolio.ts`'s `Concern` fields + `PP1`'s strengthened assertion.
  Isolated because it touches an already-shipped, previously-stable module (Project Pulse,
  deployed this session) — a regression here should be revertible without touching anything new
  this plan adds.
- **Commit 4** — Step 5: `PortfolioPanel.tsx` + `ReplanningDrawer.tsx`. Depends on all three
  prior commits being correct; the only step that can actually be exercised end to end.
- **Deploy**: after all four.

## Details most likely to be gotten wrong

- **`replanningFor`'s `hoursPerDay`, window, and holiday set must be derived identically to
  `lib/portfolio.ts`'s capacity block** — same `profileAt` call, same `addDays(today, 28)`, same
  `holidaySetOf(state.model)`. A version that approximates any of these (a different default
  `hoursPerDay`, a different window length) produces a `deficitHours` that silently disagrees
  with the count that sent the person here. `RR1` cross-checks this directly rather than trusting
  it.
- **The Apply action must read every field except `percentage` off the stored `Allocation`
  record**, never off whatever the drawer's own local state happens to hold — `upsertAllocation`
  reconstructs `person`/`projectId`/`startDate`/`endDate`/`note` fresh from the action on every
  write, edit included, so a value the drawer got slightly stale (e.g., the project moved between
  the drawer opening and the person clicking Apply) would silently write the drawer's stale copy
  over the current one.
- **`worstCapacity`'s `personId` must be captured inside the loop, at the same point `name`
  already is** — not re-derived afterward via a second lookup into `peopleHere`, which is a Map
  keyed by `personId ?? person` and would need the SAME key-resolution logic duplicated to find
  it again, exactly the kind of second, possibly-disagreeing join this plan exists to avoid
  elsewhere.
- **A concern with `count > 1` still only names and links to the worst person** — this is not a
  bug to route around with a multi-person picker; it is what the phrase itself already says
  today, unchanged by this plan. Adding a picker would be scope the approved design never asked
  for.

## What would send this back

- If `RR1`'s cross-check finds `replanningFor`'s deficit genuinely cannot be made to match
  Portfolio's own capacity concern for the same person and window without a special-case
  adjustment — that means the two modules need a shared computation, not two callers of the same
  formula, and this plan's Step 1 needs to be reopened before Step 2 is trusted.
- If `RR2` finds the reducer's edit-by-id path does NOT preserve `createdBy`/`createdAt`, or
  resolves `personId` differently than the create path does for the same person — that is a real,
  previously-latent reducer defect, not something this plan should route around with a
  remove-then-recreate instead of an edit. Surfaces at Step 3, before any UI depends on it.
- If, once live, the capacity concern rarely fires with `count > 1` (making the worst-person-only
  scope moot) or fires so often that the drawer becomes noise — that's the same named risk
  Project Pulse's own design already carries forward, not a new one this feature introduces.

## Deploy

Same staged recipe as every feature this session: `git archive` the combined commits → fresh dir
→ `npm ci` → `npx prisma generate` → `npm run build` → `npx prisma migrate status` (expect: up to
date, no schema change) → package via `scripts/package-release.py` → `az webapp deploy` → health
poll → chunk-grep verification (e.g. a distinctive drawer string). **Live walkthrough**: Portfolio
sits behind Microsoft sign-in, same limitation as every UI feature this session — hand off to the
user to confirm the capacity concern's phrase is clickable for an engagement with a real
over-committed person, the drawer's numbers read sensibly against what Portfolio already showed,
and Apply/Release actually change the person's allocations and are reflected back in Portfolio on
a refresh.
