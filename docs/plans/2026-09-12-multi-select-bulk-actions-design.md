# Multi-select and bulk actions for Tree, Board and Calendar — design

Approved by Nishant, 12 Sep 2026. Answers the highest-repeated single gap in that day's
business-process review (`docs/strategy/2026-09-12-business-process-review.md` §3, P1):
every status change, reassignment or close in Tree, Board and Calendar is one record at a
time, through a single shared `selectedId: string | null` in `components/IssueWorkspace.tsx`.

## Decisions taken

Three questions, each with a chosen answer:

1. **Selection model: Shift/Ctrl-click, plus Shift+Arrow where a range has a clear meaning.**
   Not a checkbox column — the F&O page-grammar pass (10-11 Sep) deliberately kept these grids
   lean, and a permanent checkbox column on every row would undo that for a feature used
   occasionally, not constantly.
2. **Scope: Tree, Board and Calendar together**, not Tree/Board only. Calendar's chips are the
   same `ScheduleRow` objects Tree and Board render, and `CalendarView` already wires into the
   same shared `selectedId`/`onSelect` pair the other two use (`IssueWorkspace.tsx:2539`), so
   extending it costs a parallel prop, not a parallel mechanism.
3. **First bulk actions: status change and reassign-owner only.** The two examples the review
   itself named ("bulk close duplicates, reassign after a leaver"). Bulk delete/archive and
   bulk field edits are explicitly out of scope for this pass — see **Out of scope**.

## State model

One new piece of state in `IssueWorkspace.tsx`, alongside the existing `selectedId`:

```ts
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
```

Deliberately separate from `selectedId`, not a generalisation of it. `selectedId` means "the
record whose detail drawer is open" — it drives `DetailDrawer`, `FactBoxBlade`, and the
single-record path through `SelectionToolbar`, exactly as today. `selectedIds` means "the
records checked for a bulk action." The two can never be conflated: a plain click keeps doing
exactly what `requestSelect` does today (dirty-check, then open the drawer) **and clears
`selectedIds`**; a modified click never calls `requestSelect` and never touches `selectedId` or
the drawer at all.

```ts
const toggleSelect = useCallback((id: string, rangeFrom?: string) => {
  setSelectedIds((prev) => {
    if (rangeFrom) return rangeBetween(rangeFrom, id, rows) // Tree/Board same-lane only
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
}, [rows])
```

`rangeBetween` walks the same ordered `rows` array `TreeGrid`/`BoardView` already render from —
no second ordering is invented. For Board, "same lane" bounds the range so a Shift-click across
lanes doesn't silently pull in every card between two arbitrary positions in an unrelated
grouping.

## Interaction, per view

- **Tree** (`components/TreeGrid.tsx`) — the row `onClick` at `:515` branches: a plain click
  calls `onSelect(r.id)` as today; `e.ctrlKey || e.metaKey` calls `onToggleSelect(r.id)`;
  `e.shiftKey` calls `onToggleSelect(r.id, lastClickedId)`. `onGridKeyDown`'s existing
  roving-tabindex arrow handling grows a `Shift+ArrowUp/Down` case that extends the range from
  the current tab stop, reusing the same `rows` order the mouse path uses.
- **Board** (`components/BoardView.tsx`) — identical Ctrl/Shift-click semantics on cards.
  Shift+Arrow is not wired here (arrow keys are not currently a Board navigation model at all);
  Shift-click range-select is bounded to cards within the same lane, where "the cards between
  these two" has an unambiguous meaning.
- **Calendar** (`components/CalendarView.tsx`) — identical Ctrl/Shift-click semantics on the
  chips inside a day cell (`:91-95`). No range-select: arrow keys move between days, not
  between chips, and "the chips between these two" has no meaning across day cells. Ctrl/Shift
  click only.

A plain click on empty grid background clears `selectedIds`, matching the standard "click away
to deselect" convention already implicit in `requestSelect`'s dirty-check flow.

## The toolbar

`SelectionToolbar` (`components/SelectionToolbar.tsx`) grows a second render branch. Today it
is `row === null` (global actions only) vs. `row` (the single-record menu, `:88-197`). It now
checks `selectedIds.size` first:

- `selectedIds.size >= 2` → the bulk bar: an item count ("3 selected"), **Change status**,
  **Reassign owner**, and **Clear**. Same DOM position and styling as the existing toolbar —
  no second floating element.
- `selectedIds.size <= 1` → today's existing behaviour, unchanged (a `selectedIds.size === 1`
  row that is ALSO the open `selectedId` renders the single-record menu; the two states cannot
  disagree, because a plain click that sets `selectedId` also resets `selectedIds` to empty).

## Bulk status change

The status picker's options are the **intersection** of `allowedNext(row.status)`
(`lib/statusPolicy.ts`) across every selected row — not the union. A target that is illegal for
even one selected row is not offered at all, so the batch can never be partially valid. An
empty intersection disables the control with one line: "No status is valid for all N
selected."

If the chosen target requires a reason for any selected row's specific transition
(`requireReason`, same policy), **one** reason prompt covers the whole batch — matching Board's
existing single-drag-reason UX, not N separate prompts. The same reason text is attached to
every action in the batch.

Commit is one batched dispatch, mirroring the existing atomic-batch pattern `TimesheetPanel`'s
"Approve all" already uses: one action per selected row, submitted together, so the batch
succeeds or fails as a unit. A permission gap or a stale-version conflict on any single row
fails the whole batch — nothing commits partially. The existing serializable-transaction retry
in `persistActions` already gives this "all or nothing" property; this feature does not
introduce a new commit primitive, only a new caller that submits N actions instead of one.

## Bulk reassign owner

Simpler: no transition graph. The existing owner picker (`ownerChoicesFor`,
`lib/ownerChoices.ts` — already directory-driven and departure-filtered) is shown once and
applied identically to every selected row, gated on whatever permission an individual owner
edit already checks. Same one-batch, all-or-nothing commit as status change.

## Error handling

- **Empty status intersection** — control disabled, reason stated inline (not a dialog).
- **Batch commit rejected** (permission, stale version, a transition refused server-side after
  optimistic apply) — the whole batch is reported as failed, same as any other rejected batch
  in this codebase; `selectedIds` stays as it was so the user can see exactly what was being
  acted on and retry or adjust the selection.
- **A selected row is deleted or archived by someone else mid-selection** — excluded from the
  status-intersection and reassign computation on the next render (it simply drops out of
  `rows`, and `selectedIds` naturally stops matching anything for that id).

## Testing

A new scenario proves the intersection logic directly (pure, no UI): given a set of rows with
mixed current statuses, `allowedNext` intersected across them produces exactly the shared legal
targets — including the empty-intersection case. A second scenario proves the batch commit is
all-or-nothing: an included row that would individually be refused (e.g. missing the required
evidence for a Closed-confirmed target) causes the entire batch to report failure, with none of
the other rows' status changed. Both follow this codebase's existing pure-function-first testing
discipline — the range-select and click-modifier wiring itself is UI behaviour this harness does
not drive, same limit every other click-handling change in this codebase already lives with.

## Out of scope (this pass)

- Bulk delete/archive — a destructive action deserves its own confirmation design, not a
  variant of this one.
- Bulk field edits beyond status and owner (severity, discipline, etc.) — can reuse this same
  toolbar-and-batch mechanism later; not built now because no reviewed finding named a concrete
  need for it yet.
- Cross-selection undo — a single "undo the whole batch" action was not requested and adds a
  second commit primitive; a rejected batch already commits nothing, so there is nothing to
  undo on failure, and undoing a *successful* batch is a separate, larger feature (undoing N
  individually-committed audit rows) than this pass's scope.
