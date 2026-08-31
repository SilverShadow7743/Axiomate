# The clean shell — implementation plan

Executes `docs/plans/2026-08-31-clean-shell-design.md` (approved 2026-08-31, three recorded
decisions). Ordering principle: the riskiest structural change — the drawer replacing the
dock — lands FIRST, so the design's send-backs surface before four more commits pile onto a
doomed layout; the calm restyle lands LAST because it is the most reversible. The design's
shippability rule governs every step: **view components mount unchanged**; if the 192
scenarios or the a11y zero move at ANY step, the change was not UI-only and the step stops.

Honesty about verification, stated up front: this is layout work, and the gates (tsc,
scenarios, a11y, build) prove compilation and non-regression of logic — they cannot see a
drawer that opens under a popover. Steps 1–4 are FULLY verified only at Step 5's deployed
walkthrough. Therefore: one deploy at the end, every commit still individually gated, and
the walkthrough checklist written verbatim below because the browser extension is degraded
and the USER may be the one walking it.

Ground truth verified while writing:

- IssueWorkspace.tsx (~2,940 lines): toolbar row (brand ~1885 → UserMenu), the view-switch
  chain at ~2257, the Tree's INTERNAL splitter (grid|Gantt, ~2408 — this is NOT the dock and
  is untouched), the dock region: content div closes ~2477, then `LabelProvider` +
  `<DetailPanel …>` (~2481) and the "+ New Issue" wiring whose click builds `setDialog({t:
  'add', parentId, kind:'issue'})` from the selection (~2465–2475) — the handler moves to
  the top bar WITH this parent-resolution logic intact.
- Dirty flow: `requestSelect(id)` (~649) owns the unsaved-changes confirm; deselecting is
  `requestSelect(null)`. The drawer's Esc/outside-click MUST route through it — a drawer
  that merely unmounts discards edits silently, in the hands of whoever edits daily.
- z-index is a token ladder in globals.css (`--z-toast/-overlay/-modal/-dock/-overlay-
  stacked/-lightbox` + numeric 1–10/49/50/60 for in-grid layers and the search dropdown at
  60). The drawer slots at `--z-overlay`; Quick-Edit popovers and the search dropdown must
  sit ABOVE it or below-but-outside — enumerate at implementation and keep the ladder in
  one comment block.
- FilterBar.tsx (self-contained: filters+facets props) also carries the second-row controls
  (Show/Hide completed :348, Expand/Collapse :367, Columns ▾ :403, Today/Archive/scale/
  Legend) — the WHOLE component relocates into the per-view header; nothing inside it
  changes.
- Board and Calendar receive `rows` (already filtered upstream: ~2266–2268) — the Filters
  chip therefore applies to tree, board AND calendar; mywork/portfolio/timesheet/inbox/
  mycalendar/mail get no chip.
- Sidebar data sources: `myWork(state, actor, today).items.length` (~716) for the My-work
  badge; the Inbox bell's unread count (locate its source when lifting it); saved-views
  apply = the Views ▾ handlers (`setFilters(v.filters); setView(v.view)`) lifted verbatim;
  Save-current = the existing `upsertSavedView` dispatch; Configuration = `setConfigOpen
  (true)`; Archive chip's handler moves to the sidebar bottom.

Gates per commit: `npx tsc --noEmit` → `npm run validate:scenarios` (192, 0 FAIL, no verdict
moves) → `npm run audit:a11y` (0) → `npm run build`.

---

## Step 1 — ⚠ DetailDrawer replaces the dock (most regression risk)

**Named as the riskiest step, and why: the dock hosts DetailPanel — the surface where every
edit happens, daily. Two silent failure modes: a drawer close that bypasses
`requestSelect(null)` DISCARDS UNSAVED EDITS without the confirm; and if the grid's height
math assumes the dock's presence (the `.view-dock` height notes at IssueWorkspace:126–131),
the Tree renders broken. Both are the design's send-backs, and this step runs first so they
surface before anything else is built.**

- `components/DetailDrawer.tsx` (new): `role="dialog" aria-modal`, width `min(720px, 92vw)`,
  scrim behind at `--z-overlay`; Esc and scrim-mousedown call the PASSED close handler
  (which is `() => requestSelect(null)` — the dirty confirm fires exactly as a row-switch
  does); focus moves into the drawer on open and returns to the previously focused element
  on close.
- IssueWorkspace: the dock wrapper around `LabelProvider`+`DetailPanel` (~2479+) moves
  inside `<DetailDrawer open={selectedId !== null} onClose={() => requestSelect(null)}>`;
  the Overview/History tab strip and the ⤢ affordances come along unchanged; the dock's
  drag-resize between grid and dock is deleted (the Tree's internal grid|Gantt splitter
  stays). Content region CSS loses the dock's height reservation — verify the Tree fills
  the freed height rather than keeping a phantom gap.
- "+ New Issue" moves from the dock bar to the top bar NOW (it dies with the dock
  otherwise), carrying its selection-based parent resolution verbatim.
- CSS: `.drawer`/`.drawer-scrim` new; the dock's named classes removed in the same commit
  so dead styles never ship.

Verify: full gate; plus a build-level smoke that `selectedId` still drives DetailPanel
props identically (the diff shows a MOVED mount, not a changed one).
**Commit 1.**

## Step 2 — AppSidebar + the one-row top bar

- `components/AppSidebar.tsx` (new): the design's IA verbatim (Your work / Workspace /
  Records / Saved views / bottom Configuration · Archive); receives view+setView, the two
  badge counts, savedViews + apply + save-current dispatch, `setConfigOpen`, the archive
  handler; `aria-current` on the active item; arrows/Enter navigable. Collapse: a hamburger
  in the top bar toggles a `useState`; under 900px the sidebar overlays instead of docking
  (CSS only).
- IssueWorkspace: root layout becomes `.shell` grid (sidebar | main); the view TAB STRIP is
  removed (the sidebar owns switching); Views ▾ and its save box are removed (lifted to the
  sidebar); the `.mw-link` phone-only anchor retires — My week is a normal sidebar link
  (the `/my-week` route itself is untouched); the top bar keeps brand + search (+dropdown,
  its z-60 above the drawer scrim checked) + New Issue (from Step 1) + Assistant + Export ▾
  + save-state chip + Inbox bell? — the bell's count moves INTO the sidebar's Notifications
  badge and the bell retires; UserMenu stays right-most.

Verify: full gate; `grep -c "setView('"` unchanged call sites still compile (notification
deep-links at ~1984 keep working — they call setView, which the sidebar now reflects).
**Commit 2.**

## Step 3 — the per-view Filters chip

- `components/FiltersHeader.tsx` (new, thin): a chip row at the top of the content area for
  view ∈ {tree, board, calendar}: "Filters · N" (N = fields of `filters` differing from
  `EMPTY_FILTERS`, EXCLUDING `search` — search stays global in the top bar) toggling the
  EXISTING FilterBar component, moved here verbatim with all its second-row controls.
  Expanded state per-session (`useState`, default expanded when N > 0).
- The old global second row is removed from the shell.

Verify: full gate; the chip's count logic is 5 lines — assert by reading; live behavior at
Step 5 (type a filter → grid narrows → chip count updates).
**Commit 3.**

## Step 4 — the calm token pass (named selectors only)

A REVIEWABLE list, not a blanket rewrite — touch exactly: the `:root` spacing/radius tokens
(if present; else the literal values in) `.toolbar`-region rules, `.btn`, `.menu`,
`.cfg-card`, `.cfg-section`, `.pack-*` untouched (print surfaces keep their look), the
tab-strip rules (deleted), row hover/selection tints, and the new `.shell/.sidebar/.drawer`
polish. Accent audit: the red stays only on primary buttons, active nav, badges, and
semantic warnings — find-and-calm any other `var(--accent)` usage in the NAMED selectors
only.

Verify: full gate (a11y especially — contrast stays); visual truth at Step 5.
**Commit 4.**

## Step 5 — staged deploy + the walkthrough

Staged FOREGROUND recipe → health `"database":"connected"`. Then the walkthrough — by the
assistant if the extension revives; otherwise BY THE USER, verbatim:

1. Hard-reload. The sidebar shows; the top bar is one row.
2. Click through all nine views — each renders with its content unchanged.
3. Tree: open a record → the drawer slides over the RIGHT, Gantt still full-width behind;
   edit a field, press Esc → the unsaved-changes confirm appears (do NOT lose the edit);
   cancel, save, Esc closes clean; focus lands back on the row.
4. Tree: the Filters chip shows, expands, a Status filter narrows the grid live, the count
   badge updates; Board and Calendar likewise.
5. Sidebar: apply the saved view "OAPIL open work" — filters + view change together.
6. + New Issue from the top bar creates under the selected scope as before.
7. Mail: BOTH the "Your inbox" panel and the log render (the panel that started this phase).
8. Narrow the window under 900px — the hamburger appears, the sidebar overlays.
9. Notifications badge counts match the old bell; a notification click still deep-links.

**Commit 5**: live-found fixes only, each through the full gate.

---

## Details most likely to be got wrong

1. Drawer close = `requestSelect(null)` — Esc and scrim must fire the dirty confirm, never a
   silent unmount. The single most damaging possible regression in this plan.
2. Focus return on drawer close, and focus into the drawer on open — keyboard users lose
   their place otherwise.
3. "+ New Issue" carries its selection-based parent resolution (~2465) verbatim — a naive
   move that always uses `defaultParentId` files new work in the wrong place.
4. The Tree's INTERNAL grid|Gantt splitter (~2408) is not the dock resizer — it stays.
5. The z-ladder: drawer at `--z-overlay`; the search dropdown (60) and Quick-Edit popovers
   must remain usable while the drawer is open or be scoped outside it — enumerate before
   choosing, comment the ladder.
6. The Filters chip count excludes `search`; Board and Calendar DO filter (they receive the
   filtered `rows`) and get the chip.
7. Notification deep-links call `setView` — the sidebar must reflect external view changes
   (derive active from `view`, never own state).
8. `.mw-link` retirement must not touch `/my-week` — only the anchor moves.
9. The a11y gate at zero without suppressions — the sidebar nav and dialog-role drawer are
   exactly the patterns it checks.
10. Scenario count and verdicts must not move at any step — this phase owns no logic.

## Commit boundaries

| Commit | Contents | Gate |
|---|---|---|
| 1 | DetailDrawer + dock removal + New-Issue relocation | full gate |
| 2 | AppSidebar + one-row top bar + tab-strip/Views ▾ removal | full gate |
| 3 | FiltersHeader chip + FilterBar relocation | full gate |
| 4 | calm token pass (named selectors) | full gate |
| 5 | deploy + walkthrough fixes only | full gate + the 9-point walkthrough |

## What would send the design back (with where each surfaces)

- The grid/Gantt height math structurally depends on the dock's layout → pause for a real
  fix, no CSS hacks. Surfaces at Step 1, deliberately first.
- The drawer fights Quick Edit or the dirty flow beyond a z-order slot → the interaction
  model reopens. Surfaces at Step 1/Step 5.3.
- Any scenario or a11y movement at any step → the change was not UI-only; stop and look.
