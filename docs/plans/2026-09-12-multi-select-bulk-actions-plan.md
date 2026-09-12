# Multi-select and bulk actions — implementation plan

Follows `docs/plans/2026-09-12-multi-select-bulk-actions-design.md` (approved 12 Sep).

**Ordering principle:** the pure candidate/refusal logic for a bulk status change comes first
because it needs nothing — no state, no click, no browser — so a wrong rule is found while it
costs nothing to change. The scenarios that drive it come next, written against the function
signatures directly, before either has a caller. Selection state and the click/keyboard wiring
that depends on it come third, together, because a `selectedIds` set nothing ever toggles is
unverifiable in isolation. The toolbar's bulk branch and the actual `dispatchMany` commit come
fourth, since they are the only step that writes data and therefore the only step that needs
steps 1–3 already proven correct beneath it. The full interactive walkthrough is last, because
it is the one part no scenario or typecheck can see.

Two corrections to the design doc's prose, found while reading the actual code below — the
design's *intent* is unchanged, only the mechanism:

- The design says the status picker offers "the intersection of `allowedNext(row.status)`."
  The precise primitive is `dropOutcome` (`lib/board.ts:53`), which Board's own drag already
  trusts and which additionally handles the no-op case (`row.status === to`) and evidence
  correctly. Step 1 builds on `dropOutcome`, not on a fresh `allowedNext` intersection.
- The design says a reason is collected "if the chosen target requires one." Board's own
  comment (`components/BoardView.tsx:16-19`) and `commitCell`'s `'status'` case
  (`components/IssueWorkspace.tsx:1481-1497`) both establish that **every** status change
  through this funnel requires a reason, not only the ones `checkTransition` itself flags. The
  bulk dialog collects one reason unconditionally.

## Steps

### 1. `lib/board.ts` — the bulk rule, with nothing attached

Pure. Two new exported functions, beside `dropOutcome`:

```ts
/** Every IssueStatus that dropOutcome refuses for no row in the selection. */
export function bulkStatusChoices(
  policy: StatusPolicy,
  rows: ScheduleRow[],
  hasEvidence: (rowId: string) => boolean,
): IssueStatus[]

/** ok when no row refuses `to` (rows already AT `to` are no-ops, not refusals);
 *  otherwise the refused rows, each with dropOutcome's own message. */
export function bulkDropOutcome(
  policy: StatusPolicy,
  rows: ScheduleRow[],
  to: IssueStatus,
  hasEvidence: (rowId: string) => boolean,
): { kind: 'ok' } | { kind: 'refused'; refused: { rowId: string; message: string }[] }
```

`bulkStatusChoices` iterates `ISSUE_STATUSES` (imported from `lib/types.ts`, the same list
`allowedNext` reads its fallback from) and keeps a candidate only when `bulkDropOutcome(...,
candidate, ...).kind === 'ok'`. Rows whose current status already equals the candidate are
`{kind: 'ok'}` from `dropOutcome` itself (`board.ts:59`) — they are silently excluded from the
dispatch list in step 4, not from the candidate list here.

### 2. Scenarios BLK1 and BLK2 — before any wiring

Add to `scripts/scenario-validation.ts`, beside the existing `CV1`/board scenarios, calling
step 1's functions directly against hand-built `ScheduleRow` fixtures (reuse `blank()`'s shape
or an existing row-builder helper already in the file — check for one before writing a new one).

- **BLK1** — three rows with different current statuses, one of which has no legal common next
  status with the others: `bulkStatusChoices` must exclude that status from the candidate list,
  and must include a status that genuinely is legal for all three. Covers the empty-intersection
  case with a fourth row set where no candidate survives at all.
- **BLK2** — a row missing required evidence for `Closed - confirmed` mixed with rows that have
  it: `bulkDropOutcome(..., 'Closed - confirmed', ...)` must report `refused` naming exactly
  that row, and a row already sitting at the candidate status must not appear as refused.

**Verified by:** `npm run validate:scenarios` (`scripts/scenario-validation.ts`) showing BLK1
and BLK2 as `PASS`, and `git diff data/validation.json` showing only the two new rows added —
no existing scenario's verdict changes.

*Doing this before either function has a caller is deliberate: if the candidate rule or the
refusal rule is wrong, this is where it is cheap to find out, exactly as `CV1` already does for
`calendarMonth`.*

### 3. Selection state and interaction wiring — the step with the regression risk

Touches `components/IssueWorkspace.tsx`, `components/TreeGrid.tsx`, `components/BoardView.tsx`,
`components/CalendarView.tsx`.

- `IssueWorkspace.tsx`: add `selectedIds: Set<string>` state, `lastClickedId: string | null`
  (the range-select anchor), `toggleSelect(id, extendRange?: boolean)`, and `rangeBetween(from,
  to, rows)` exactly as sketched in the design's State model section. `requestSelect` (the
  existing dirty-check gate, `:816-829`) gets one added line: on a successful select, clear
  `selectedIds`. Pass `selectedIds` and the toggle handler down to all three views alongside the
  existing `selectedId`/`onSelect` pair.
- `TreeGrid.tsx`: the row `onClick` at `:515` branches on `e.ctrlKey || e.metaKey` /
  `e.shiftKey` before falling through to today's `onSelect(r.id)`. `onGridKeyDown`'s existing
  arrow-key case grows a `Shift+ArrowUp/Down` branch calling `toggleSelect` with the range flag
  from the current tab stop.
- `BoardView.tsx`: same Ctrl/Shift-click branch on the card's click handler (find it beside
  `begin`/`drop`, `:57-75`), Shift-click bounded to cards sharing the dragged-from card's lane
  (`boardLanes(rows)` already groups them — reuse that grouping to bound the range, don't
  recompute lane membership a second way).
- `CalendarView.tsx`: same Ctrl/Shift-click branch on the chip's click handler (`:91-95`), no
  range-select branch at all.

**This is the risky step, named as such:** every one of these four click/keyboard paths
currently *always* succeeds — a plain click always opens the row, an arrow key always moves the
tab stop. A mistake here does not fail loudly; it silently changes what a single click does for
every user of this codebase's single busiest interaction, multi-select or not. The detail most
likely to be got wrong: the branch order. `e.shiftKey` and `e.ctrlKey`/`e.metaKey` must be
checked **before** the plain-click fallthrough, not as an early return inside it — an `if
(ctrl) {...}; onSelect(id)` written without a `return` fires both paths on every modified click.

**Verified by:** `npx tsc --noEmit` and `npx eslint components/TreeGrid.tsx
components/BoardView.tsx components/CalendarView.tsx components/IssueWorkspace.tsx` clean;
then a manual browser pass (`npm run dev`, since this step's actual behaviour is exactly what
no scenario drives): a plain click on any row in all three views still opens the detail drawer
and still triggers the unsaved-changes prompt when one is open and dirty; Ctrl-click on two
Tree rows highlights both without opening either; Shift-click a third row selects the
contiguous range; Shift+ArrowDown from a tab-stopped row extends the range by one.

### 4. The toolbar's bulk branch and the commit itself

Touches `components/SelectionToolbar.tsx` and its caller in `IssueWorkspace.tsx` (`:2761`).

- `SelectionToolbar` takes two new props: `selectedIds: Set<string>` and `selectedRows:
  ScheduleRow[]` (resolved by the caller, not by the toolbar reaching into workspace state
  itself — it already takes a single resolved `row`, not an id, so this matches its existing
  shape). When `selectedIds.size >= 2`, render the bulk bar instead of the existing `row`
  branch: item count, a status `<select>` populated from `bulkStatusChoices`, an owner picker
  reusing `ownerChoicesFor`, and Clear.
- **Status change:** choosing a target opens one reason prompt (always, per the correction
  above) reusing whatever text-input pattern Board's own `asking` dialog already uses
  (`BoardView.tsx:44-45`) rather than inventing a second one. On confirm, build one `Action[]`:
  for each selected row where `row.status !== target`, `{ t: 'updateIssue', id: row.id, patch:
  { status: target }, now, reason }` — rows already at the target are skipped, not sent as
  no-op updates. Dispatch with `dispatchMany(actions)` (`IssueWorkspace.tsx:597`), which is
  already all-or-nothing client-side and queues the result as one server batch
  (`autosave.enqueueAll`, `:639`) — no new commit primitive.
- **Reassign owner:** for each selected row, check `availabilityForAssignment` exactly as
  `commitCell`'s single-record `'owner'` case does (`IssueWorkspace.tsx:1434-1436`). If **any**
  selected row's assignment would be refused for unavailability, refuse the whole bulk reassign
  with one message naming which rows and why — do **not** attempt the single-record "type it
  again within 8 seconds to override" dance across a multiselection; that confirmation gesture
  means something for one row and means nothing well-defined for N. The user reassigns the
  refused rows individually, where the existing override still works exactly as it does today.
  If no row is refused, dispatch one `Action[]` of `{ t: 'updateIssue', id: row.id, patch: {
  owner }, now }` via `dispatchMany`.

**Verified by:** `npx tsc --noEmit` and eslint clean; `npm run validate:scenarios` re-run to
confirm the byte-identical-baseline discipline still holds (this step adds no new pure logic
beyond step 1, so nothing here should move an existing verdict); then the browser pass — select
2–3 real issues in Tree, change status to a common legal target, confirm one reason prompt (not
three), confirm all three issues show the new status and an audit row citing the shared reason,
confirm a target excluded by `bulkStatusChoices` never appears in the picker at all; repeat for
reassign, including the refusal path (select an issue plus one where the target owner is on
leave for the whole window, confirm the whole reassign refuses naming that row).

### 5. Full interactive walkthrough

Not a code step — the closing verification pass, because it is the only place the three views'
click/keyboard wiring and the toolbar's two actions are exercised together rather than one at a
time. Confirm in the running app (`npm run dev`): multi-select and bulk status/reassign work
identically in Tree, Board and Calendar; a plain click at any point during a multi-selection
correctly collapses it back to a single open record; the existing single-record `SelectionToolbar`
menu (Add, Edit, Move, Link, Delete/Archive) is untouched when 0 or 1 rows are selected.

## Commits

- Steps 1 + 2 together — the rule and its proof are meaningless apart.
- Step 3 alone — the named risk, independently revertable without losing steps 1–2's proven
  logic or step 4's not-yet-built commit path.
- Step 4 alone — depends on 1–3, but is itself a coherent, separately revertable capability: if
  a problem surfaces here, reverting it leaves multi-select highlighting working with the bulk
  actions temporarily gone, not a half-built feature.

## What would send the design back

- **If `dispatchMany`'s all-or-nothing guarantee turns out not to hold under a real concurrent
  edit** (a race the client-side fold in step 4 didn't anticipate) — the design's "nothing
  commits partially" claim would be wrong, and bulk actions might need a dedicated server-side
  batch endpoint rather than N ordinary actions folded into one client batch. Would surface in
  step 4's browser pass, ideally caught there rather than after ship.
- **If Nishant sees the reassign-refusal behaviour in step 4 and wants the "type it twice to
  override" gesture preserved in bulk form** rather than pushed to per-row follow-up — the
  design's "gated on whatever permission an individual owner edit already checks" line glossed
  over the availability veto entirely, and this would be a real product decision the design
  doc never actually made. Surfaces in step 4.
- **If Board's same-lane Shift-click bound feels wrong in practice** (people expect a visual,
  cross-lane range the way the board is laid out) — the range-select model for Board specifically
  would need rethinking, not just a tweak. Surfaces in step 3's browser pass.

None of the three is expected. All three are cheaper to admit where they are named above than
after step 4 has already shipped.
