# RAID log — implementation plan

Follows `docs/plans/2026-09-01-raid-log-design.md` (approved 2026-09-01). Ordering principle:
the pure data extension first (`ScheduleRow`/`buildTree`/`matchesFilters`), provable together via
one scenario before any UI reads it; the column definitions next (still pure, but depend on
knowing the real cell-rendering mechanism, found below); the filter-bar toggle last, since it
depends on everything above already being correct and can't be scenario-tested.

## One correction from the design's own grounding, found while writing this plan

The design says "a checkbox in the filter bar, not a dropdown." Reading `FilterBar.tsx`'s real
`showCompleted` control (the file's own only other boolean filter) shows it is **not** an
`<input type="checkbox">` — it's a toggle `<button>` with `aria-pressed` and a caption that
names the action, not the state (`"Hide completed"` / `"Show completed"`). A real checkbox
would be a new control shape this file doesn't otherwise use, which is exactly what
`axiomate-ui-design`'s principle 10 ("no screen should invent a new UI pattern unnecessarily")
exists to catch. The plan follows `showCompleted`'s established shape instead.

## Steps

### Step 1 — `ScheduleRow` and `FilterState`, `lib/types.ts`

Add four nullable fields to `ScheduleRow` (near `severity`/`owner`, line ~237-239, matching
their exact style and doc-comment density):

```ts
/** null on a non-Risk row, or a Risk not yet judged — never a default. */
riskLikelihood: number | null
riskImpact: number | null
/** null on a non-Decision row, or an open Decision with no recorded outcome yet. */
decisionOutcome: string | null
/** Resolved once here via lib/raid.ts's raidKindOf, not re-derived per filter check —
 *  matchesFilters has no model reference to call it with. */
raidKind: 'risk' | 'decision' | null
```

Add `raidOnly: boolean` to `FilterState` (line ~339-365) and `raidOnly: false` to
`EMPTY_FILTERS` (line ~367-379) — confirmed the single canonical default; `lib/savedViews.ts`
reconstructs a `FilterState` by iterating `Object.keys(EMPTY_FILTERS)` generically, so nothing
there needs a separate edit. No other hardcoded `FilterState` literal exists — the only other
site (`components/IssueWorkspace.tsx:1894`) is a partial spread (`{...filters, search: ...}`),
untouched by this addition.

**Verify:** `npx tsc --noEmit` — will show every place a `ScheduleRow`/`FilterState` literal is
constructed without the new fields, which is exactly the next two steps.

### Step 2 — `buildTree()` and `blank()`, `lib/tree.ts`

Add `import { raidKindOf } from './raid'`. In `walkIssue`'s main field-assignment block
(alongside `row.severity = issue.severity` / `row.owner = issue.owner`, line ~139-141):

```ts
row.riskLikelihood = issue.riskLikelihood ?? null
row.riskImpact = issue.riskImpact ?? null
row.decisionOutcome = issue.decisionOutcome ?? null
row.raidKind = raidKindOf(state.model, issue.type)
```

In `blank()` (the structural-tier/placeholder row constructor, line ~302-314, alongside
`status: null, severity: null, owner: null,`):

```ts
riskLikelihood: null,
riskImpact: null,
decisionOutcome: null,
raidKind: null,
```

**Both sites, not one** — a structural row (client/engagement/project/module) is never a Risk
or Decision, and skipping `blank()` would leave those four fields `undefined` rather than
`null`, which `matchesFilters`' new check (Step 3) would still handle correctly by accident
(`undefined === null` is `false`, so `raidOnly` would still exclude it) — but every other
existing field in this file is explicitly nulled, not left undefined, and this should not be
the one exception silently relying on a coincidence.

**Verify:** `npx tsc --noEmit`.

### Step 3 — `matchesFilters()`, `lib/tree.ts`

One line, after the existing `health` check and before the `search` block (line ~391, matching
the file's own stated "cheapest checks first" ordering — a boolean flag check is cheaper than
the string-concatenation search block that follows it):

```ts
if (f.raidOnly && row.raidKind === null) return false
```

### Step 4 — `RA1`, `scripts/scenario-validation.ts`

Pins Steps 1-3 together via the real `buildTree()`/`matchesFilters()` path, not either function
in isolation. Construct, via `ok()` against `BASE`: a Risk issue with `riskLikelihood`/
`riskImpact` set (judged), a second Risk with neither set (unjudged), a Decision issue with
`decisionOutcome` set, and rely on `BASE`'s own existing ordinary issues for the "not RAID"
case. Check whether `upsertIssue`/`create`/`updateIssue` already supports setting
`riskLikelihood`/`riskImpact`/`decisionOutcome` via a patch (per `OverviewTab.tsx`'s own
`commitCell`-style calls) — read the reducer's actual accepted patch shape before assuming the
field names on the action match the stored field names exactly.

Assert: `buildTree(state, TODAY)` produces rows where the two Risk rows have
`raidKind === 'risk'`, the judged one's `exposure(riskLikelihood, riskImpact)` matches the
expected band, the unjudged one's is `null` (not a default); the Decision row has
`raidKind === 'decision'` and the recorded `decisionOutcome`; an ordinary issue's `raidKind` is
`null`. Then: `visibleRows(rows, { ...EMPTY_FILTERS, raidOnly: true }, new Set())` (or
`matchesFilters` called directly per-row, whichever this file's own convention for testing a
filter in isolation already is — check `PF1`/an existing filter-testing scenario for the exact
call shape) includes exactly the Risk and Decision rows and excludes the ordinary issue.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios`: `RA1` `PASS`, count 200 → 201,
0 FAIL.

### Step 5 — two new columns, `lib/columns.ts`

Added to `COLUMNS` only, **not** to `DEFAULT_VISIBLE` (per the design's "invisible by default"
decision — nobody's existing view changes):

```ts
{
  key: 'exposure',
  label: 'Exposure',
  width: 110,
  minWidth: 80,
  sortable: true,
  sortValue: (r) => exposure(r.riskLikelihood, r.riskImpact)?.score ?? -1,
},
{
  key: 'decisionOutcome',
  label: 'Decision Outcome',
  width: 220,
  minWidth: 120,
  sortable: false,
},
```

`sortValue`'s `?? -1` sends unjudged risks (and every non-Risk row, which also has no exposure)
to the bottom on an ascending sort — matching how `duration`'s own `sortValue` already handles
absence (`r.duration ?? -1`, confirmed in this file). `decisionOutcome` is `sortable: false`
because it is free text with no ordering that means anything, the same reason `next` (Next
Action) is already `sortable: false`.

### Step 6 — cell rendering, `components/TreeGrid.tsx`'s `Cell` function ⚠ riskiest step

Found during grounding: cell content is **not** driven by `ColumnDef` at all — `Cell({ col, row,
... })` (line ~752) is a separate `switch (col)` statement, keyed by the column's string key,
reading directly off `row.<field>`. Two new cases, added near the existing `severity`/`owner`
cases (line ~875-897) for readability:

```ts
case 'exposure': {
  const judged = exposure(row.riskLikelihood, row.riskImpact)
  return judged ? (
    <span className={`chip hl-${judged.band.toLowerCase()}`}>{judged.band}</span>
  ) : row.raidKind === 'risk' ? (
    <span style={{ color: 'var(--text-faint)' }}>not yet judged</span>
  ) : (
    <span style={{ color: 'var(--text-faint)' }}>—</span>
  )
}

case 'decisionOutcome':
  return row.raidKind === 'decision' ? (
    row.decisionOutcome ? <span>{row.decisionOutcome}</span> : <span style={{ color: 'var(--text-faint)' }}>not yet decided</span>
  ) : (
    <span style={{ color: 'var(--text-faint)' }}>—</span>
  )
```

**Named riskiest** because it's the one step editing a large, shared switch statement inside a
component every other view type (Board, Calendar, Gantt-adjacent grid rendering) reaches through
the same `Cell` function — a misplaced case, a missing `return`, or a syntax slip here risks
breaking cell rendering for every OTHER column, not just the two new ones, since a switch
statement's cases are not independently sandboxed the way separate functions would be. Verified
by hand after editing: every existing case (`id` through `dependency`) still renders unchanged,
checked by reading the full switch body once more after the insertion, not just diffing the
two new cases in isolation.

The three-way branch on `exposure`/`raidKind` distinguishes "not a Risk at all" (em dash,
matching `discipline`'s and `owner`'s own convention for "nothing to say here") from "a Risk,
not yet judged" (an honest sentence, not an em dash pretending there's nothing to know) — the
same distinction `dailyCap` and `windowOpening` draw elsewhere in this codebase between absence
and unenforced/unknown.

Reuses `hl-${band}` for the exposure chip's color class — `app/globals.css` already defines
`hl-critical`/`hl-high`/etc. for schedule-health chips (confirmed via `health`'s own case at
line ~886-894); `ExposureBand`'s values (`Low`/`Medium`/`High`/`Critical`) match exactly, so no
new CSS class is needed — verify this color mapping reads sensibly for exposure (not just
health) before treating it as free; if the existing hues don't fit, a small, additive
`exp-${band}` class set is the fallback, not a reason to invent a whole new color language.

**Verify:** `npx tsc --noEmit` → `npm run audit:a11y` (0, matching every prior UI step this
session) → manual: toggle the Exposure/Decision Outcome columns on via the column picker for a
judged Risk, an unjudged Risk, a Decision, and an ordinary issue, confirm all four render as
designed.

### Step 7 — the filter-bar toggle, `components/FilterBar.tsx`

A toggle button matching `showCompleted`'s exact shape (line ~260-274), placed beside it:

```tsx
<button
  className={`btn ghost${filters.raidOnly ? ' on' : ''}`}
  onClick={() => setFilters({ ...filters, raidOnly: !filters.raidOnly })}
  aria-pressed={filters.raidOnly}
  title={filters.raidOnly ? 'Show every record again' : 'Show only Risks and Decisions'}
>
  {filters.raidOnly ? 'All records' : 'RAID only'}
</button>
```

**Must also update the "active" check** (line ~203-205): `k === 'showCompleted' ? v === true :
v !== 'All'` needs a matching case for `raidOnly`, or the generic `v !== 'All'` fallback would
read a `boolean` against the string `'All'` and report `raidOnly` as permanently "active" the
moment it exists — the same bug class the file's own comment at line 197-201 already warns
about for exactly this reason. Change to:
`k === 'showCompleted' || k === 'raidOnly' ? v === true : v !== 'All'`.

**Verify:** `npx tsc --noEmit` → `npm run audit:a11y` → manual: toggle RAID only, confirm the
grid narrows to Risk/Decision rows; confirm Clear (only shown when `active`) doesn't
permanently show once `raidOnly` exists in the filter object.

### Step 8 — full standing gate

`npx tsc --noEmit` → `npm run validate:scenarios` (201 total, 0 FAIL, unchanged from Step 4) →
`npm run audit:a11y` (must actually pass — Steps 6-7 are real UI) → `npm run build`.

## Commit boundaries

- **Commit 1** — Steps 1-4: `ScheduleRow`/`FilterState`/`buildTree`/`blank`/`matchesFilters` +
  `RA1`. Meaningless in isolation from each other — a provably-correct data extension with no
  UI caller yet, exactly the ordering principle's own shape.
- **Commit 2** — Step 5: the two new `ColumnDef` entries alone. Low risk, pure, easy to read as
  its own diff.
- **Commit 3** — Step 6: `TreeGrid.tsx`'s `Cell` function, kept separate specifically because
  it's the riskiest step — an isolated commit is a one-line revert if the shared switch
  statement misbehaves for existing columns in a way the gate didn't catch.
- **Commit 4** — Step 7: the `FilterBar.tsx` toggle + active-check fix. Depends on all three
  prior commits; the only step that makes the feature reachable end to end.
- **Deploy**: after all four.

## Details most likely to be gotten wrong

- **Both `buildTree` construction sites need the four new fields** — the main `walkIssue` path
  and `blank()`. Missing `blank()` produces `undefined` rather than `null` on structural rows,
  which happens to still filter correctly today but leaves the codebase's own stated convention
  (every field explicitly nulled, never left undefined) broken for exactly these four fields.
- **`raidKind` is computed once, in `buildTree`, using the same `state.model` reference already
  in scope** — never re-derived inside `matchesFilters` (which has no model parameter) or
  inside the `Cell` renderer (which has no model prop either, only `row`).
- **The `Cell` switch statement is large and shared** — the two new cases must not disturb any
  existing case's control flow. Verify by re-reading the whole switch after editing, not by
  diffing only the inserted lines.
- **The active-filter check's special-case list** must include `raidOnly` alongside
  `showCompleted`, or "Clear" reads as permanently armed the moment this ships.
- **`sortValue`'s `?? -1` for exposure** must sort unjudged/non-Risk rows predictably to one end,
  matching `duration`'s own existing convention for the identical shape of absence — not a new
  convention invented for this one column.

## What would send this back

- If `RA1`'s cross-check finds the real `create`/`updateIssue` reducer path doesn't accept
  `riskLikelihood`/`riskImpact`/`decisionOutcome` in the shape assumed here (e.g. a different
  patch field name, or a permission gate not accounted for) — that's a real gap in this plan's
  understanding of the write path, surfaced at Step 4, before any UI depends on it.
- If the existing `hl-${band}` CSS classes read wrong for exposure specifically (a color chosen
  for schedule health happening to mean something different for risk exposure) — that's a
  legitimate design finding, not a reason to force the reuse; the fallback (a small additive
  `exp-${band}` class set) is named above precisely so this isn't discovered mid-implementation
  with no planned response.

## Deploy

Same staged recipe as every feature this session: `git archive` the combined commits → fresh dir
→ `npm ci` → `npx prisma generate` → `npm run build` → `npx prisma migrate status` (expect: up
to date, no schema change — the three RAID fields already exist on `Issue`) → package via
`scripts/package-release.py` → `az webapp deploy` → health poll → chunk-grep verification.
**Live walkthrough**: Tree sits behind Microsoft sign-in, same limitation as every UI feature
this session — hand off to the user to confirm the RAID-only toggle narrows the grid correctly,
and the Exposure/Decision Outcome columns show sensible values for real Risk/Decision records
once toggled visible.
