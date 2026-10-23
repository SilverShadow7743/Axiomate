# Analytics drill-down — design

32-area review, area 19 (P2): every row in `AnalyticsView.tsx` is static — the file's only click
handler is its own close button. Proposed in the Coverage Roadmap's Tier 5 as small and
self-contained; confirmed here before building.

## What maps cleanly, and what doesn't

Three of the four cross-tabs have a direct filter-field counterpart in `lib/types.ts`'s
`FilterState` (`severity`, `status`, `client`, `owner` are all real facets Tree/Board already
filter by):

- **By severity and status** — one row is one `(severity, status)` pair. Drill-down sets both.
- **By client** — one row is one client name. Drill-down sets `client`, for a named client only.
- **By owner** — one row is one owner name. Drill-down sets `owner`, for a named owner only.

**By age bucket does not map** — `FilterState` has no age facet, and inventing one to make this
table clickable would be new filtering logic, not a wiring fast-follow. Left un-clickable, named
here rather than silently skipped.

**The "Unassigned" row, in both Client and Owner, does not map either — checked, not assumed.**
`lib/analytics.ts`'s `byClient`/`byOwner` write `i.client || 'Unassigned'` / `i.owner || 'Unassigned'`
for display, but that normalization is local to this file. The actual filterable data
(`ScheduleRow.owner: string | null` in `lib/types.ts`; `clientOf(row)` in `lib/planning/tree.ts`, which
walks the tree for the nearest client ancestor and returns `null` when there is none) carries
`null`, never the string `"Unassigned"` — and `matchesFilters` compares `i.owner !== f.owner`
directly, so a filter literally set to `"Unassigned"` would match nothing. `"Unassigned"` does not
appear anywhere in `FilterBar.tsx` either, confirming this was never a supported filter value.
Drill-down on these two rows is left un-clickable, same treatment as age buckets, rather than
silently landing on an empty Tree.

## The mechanism — the same one `MyWorkPanel`'s tiles already use

`IssueWorkspace.tsx` already threads a callback of this exact shape into `MyWorkPanel`:
`onShowInTree={(health) => { setFilters({ ...filters, health: health ?? 'All' }); setView('tree') }}`.
`AnalyticsView` gets the equivalent: `onDrillDown?: (patch: Partial<FilterState>) => void`, called
with `{ severity, status }`, `{ client }` or `{ owner }` depending on the row. The mount site
supplies `onDrillDown={(patch) => { setFilters({ ...filters, ...patch }); setView('tree') }}` —
new glue code, but the pattern, not the concept, since `MyWorkPanel`'s version already proves
"patch the filters and switch to Tree" is a sound way to land a drill-down.

## What changes

- `AnalyticsView` gains `onDrillDown?: (patch: Partial<FilterState>) => void`.
- Each row in the severity/status, client and owner tables gets its lead cell wrapped in a
  `<button className="btn-link">`, same convention as the Commercial register fix just made.
- The mount site in `IssueWorkspace.tsx` gets the callback above.

## What does not change

No new computation — every count already comes from `lib/analytics.ts`'s existing functions.
No schema change, no new permission gate (Analytics carries no `rate.view`-style gate today and
none is added). The age-bucket table is untouched.

## Testing

No new scenario, same reasoning as the Commercial register fix: the drill-down calls
`setFilters`/`setView`, both already exercised by every existing filter-bar interaction: this is
a new caller of proven code, not new logic to prove.

## Risk

Low. Additive, read-only, no reducer arm touched.
