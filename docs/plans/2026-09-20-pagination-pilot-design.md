# Pagination — pilot on People

32-area review, area 18 (P2), confirmed live: zero pagination or virtualization anywhere —
every list (Tree, Board, People, Analytics) renders its full result set. Coverage Roadmap Tier
6: approved to build, not just decide about. Scoped here to one view first rather than four at
once, matching this session's own effort-sizing (the finding was `L`).

## Why People, and not Tree

Tree pairs a row with a Gantt bar and preserves expand/collapse state across the whole tree —
paginating it means deciding what a page even means for a hierarchy, a bigger design question
on its own. Board's columns are the pagination unit already (a lane, not a page). Analytics has
no row-level detail to page through. People is a flat, sorted, locally-filtered table with
none of that — the cleanest first slice, and the pattern this pilot establishes (page state,
controls, reset-on-filter-change) is the same shape the other three would reuse.

## The two risks checked before writing code

**Does a saved view need to remember a page position?** No. `lib/savedViews.ts`'s `SavedView`
stores a `FilterState`, nothing about scroll or page — a saved view is a statement of *what* to
show, not *where in it* someone last was. Page state stays local component state, not part of
`SavedView`, and is not a gap this pilot needs to close.

**Does `revealIssue`'s "reveal this row" logic break across a page boundary?** Doesn't apply to
this pilot. People doesn't use `revealIssue` at all — `PeopleDirectory` opens a profile through
`onOpenProfile(personId)` (a direct id-keyed lookup passed to `IssueWorkspace.tsx`'s
`setOpenProfileId`), which has no scroll-to-row or page-adjustment behaviour to interact with.
This risk is real for a future Tree/Board pilot, where `revealIssue` genuinely would need to
turn to the revealed row's page — named here so it isn't forgotten, not solved here.

## What changes

- `PeopleDirectory` gains local state: `const [page, setPage] = useState(1)`.
- Page size: 50 — the existing `people` memo (filtered + sorted, already computed) is sliced
  `people.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)` for the table body; the unsliced
  `people.length` still drives the existing "N active, M departed" summary line, so the counts
  above the table keep describing the whole filtered set, not just the visible page.
- `page` resets to 1 whenever `filter` or `sort` changes (a `useEffect` keyed on both, mirroring
  how `useQuickFilterFocus` already reacts to this component's own state) — landing on an
  empty page 4 after a new search is the failure mode this specifically avoids.
- A small pager control below the table: "‹ Prev", "Page X of Y", "Next ›", shown only when
  `people.length > PAGE_SIZE` — no pager at all when everything fits on one page, so the common
  case (today's real people count) renders exactly as it does now.

## What does not change

No new computation, no schema change, no new permission gate. The `people` memo itself is
untouched — pagination slices its output, it doesn't change what's in it.

## Testing

No new scenario — `people.slice()` is not domain logic the reducer owns, it's a display
concern local to one component, the same class of thing `barStyle` in `AnalyticsView.tsx` is
and was never scenario-tested either.

## Follow-up, not this pass

Tree, Board and Analytics all still render their full result sets. Each needs its own design
pass — Tree in particular, for the reason above. Not committing to a timeline here; naming it
so it isn't mistaken for closed once this pilot ships.
