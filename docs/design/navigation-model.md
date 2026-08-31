# Axiomate Navigation Model

**Status:** Proposal — four navigation patterns, extracted from the shipped shell. Three are
genuinely distinct jobs; the fourth (Configuration's rail) is the SAME pattern as the first,
restyled to match after it drifted (commit `47239f1`) — documented here as one spec with two
instantiations, not two specs, so the next contributor doesn't reintroduce the drift.

## 1. Primary rail — "where am I"

**Component:** `AppSidebar.tsx`. **CSS:** `.sidebar` / `.side-item` / `.side-title` /
`.side-badge`.

**Anatomy:** fixed 232px column, grouped vertical list. Each group has a `.side-title` (10px
uppercase, `--text-faint`) header; items are flat `.side-item` buttons,
`border-radius: var(--radius-default)`, `padding: 5px 6px`.

**States:**
- Default — `color: var(--text)`.
- Hover — `background: var(--surface-2)`.
- Active/current — `background: var(--surface-2)` + `color: var(--accent)` +
  `font-weight: 600`, plus `aria-current="page"` (screen-reader-safe even though the visual cue
  is color+weight only, not shape — see `ux-checklist.md`).
- Badge — a filled `.side-badge` pill (accent background) for live counts (My work, unread
  Notifications), or `.side-badge.muted` for a neutral count (Archive).

**Responsive:** under 900px, collapses to an off-canvas overlay (`transform: translateX`)
behind a hamburger (`.nav-burger`), guarded by `prefers-reduced-motion`. The underlying page
stays mounted and visible around the overlay's edges.

**Use for:** the ONE place every workspace view is reached from. Never duplicate a navigation
entry point elsewhere (no repeated "quick buttons" to a view already in the rail — this was
tried once, for My work and Portfolio, and removed for exactly this reason).

## 2. Top bar — "act on this, right now"

**Component:** the `<div className="topbar">` block in `IssueWorkspace.tsx`. **CSS:**
`.topbar`.

**Anatomy:** single fixed row, `padding: 7px 14px`, `min-height: 48px`. Fixed order,
left-to-right: brand → global search (with a results dropdown, `z-index: 60`) → flexible
spacer → **one primary CTA** (`.btn.primary`, "+ New Issue") → secondary actions (Assistant
toggle, Export ▾) → save-status chip (`.persist-tag`) → account (`UserMenu`).

**The one-primary-action rule:** exactly one `.btn.primary` lives in the top bar at any time.
Every other action is `.btn` or `.btn.ghost`. This is deliberate — a bar with two competing
primary actions asks the user to decide which one matters, which is a decision the interface
should have already made.

**Use for:** global actions that apply regardless of the current view. **Never** for navigating
between views — that's the rail's job. (An earlier design merged navigation and action into one
row; the clean shell deliberately split them apart, and that split is now load-bearing — don't
reintroduce a view-switcher here.)

## 3. Configuration rail — the same pattern, a second instantiation

**Component:** `ConfigWorkspace.tsx`. **CSS:** `.cfg-rail` / `.cfg-rail-item` (as of commit
`47239f1`, restyled to match `.side-item` exactly).

**Anatomy:** narrower (210px) vertical list, same rounded-fill/accent-text idiom as the primary
rail — `background: var(--surface-2)` + `color: var(--accent)` + `font-weight: 600` on `.on`.
Scoped to the full-screen Configuration overlay (`.cfg`, `position: fixed`).

**Responsive — deliberately DIFFERENT from the primary rail:** under 900px, becomes a
horizontal scrolling tab strip (`display: flex; overflow-x: auto`), group headers hidden, and
the selected indicator switches from a filled background to a bottom border
(`border-bottom-color: var(--accent)`) — an idiom appropriate to a horizontal strip, the way a
filled-pill wouldn't read as cleanly in a row of unequal-width tabs.

**Why the collapse strategy differs, even though the visual idiom is now unified:**
Configuration's content occupies the full screen — there's no underlying page that needs to
stay visible the way the primary rail's overlay respects. A horizontal strip is the right
trade-off for a self-contained full-screen surface; an off-canvas overlay is right when the
rail sits beside content the user still needs to see.

**Use for:** navigation *within* one full-screen settings/admin surface. If a future full-screen
surface needs internal navigation, reuse this exact spec — do not invent a third rail idiom.

## 4. Detail drawer — inspect one record without leaving the list

**Component:** `DetailDrawer.tsx`. **CSS:** `.drawer` / `.drawer-scrim`.

**Anatomy:** right-side overlay, `width: min(720px, 92vw)` (or `92vw` in "wide" mode via the
panel's own ⤢ control). `role="dialog" aria-modal="true"`. Slides in over
`--duration-entrance` (0.16s), guarded by `prefers-reduced-motion`.

**Opening:** row selection on Tree, Board, or Calendar.

**Closing:** scrim click OR Escape (via `DetailPanel`'s own key handler, deferring to any
focused input first) — **both routed through the same `requestSelect(null)` dirty-check gate
every other deselection path uses.** This is the single most important rule in this spec: a
drawer close that bypassed the gate would silently discard an in-progress edit. No alternate
close path may skip it.

**Stacking:** `--z-drawer` (140) sits deliberately BELOW `--z-dock` (150, the assistant panel)
and `--z-modal` (200) — Dialogs and the focus editor opened from inside the drawer must stack
above it, and the assistant stays usable beside an open record.

**Use for:** inspecting or editing exactly one record without leaving the surrounding list or
grid context. This is not primary navigation and not a route change — closer to a focused
workspace than a page.

## Decision table — which pattern for a new capability

| The new thing is... | Use |
|---|---|
| A new top-level "place" (view of the workspace) | Primary rail — add to `AppSidebar`'s groups |
| A global action available from anywhere | Top bar — but only if no `.btn.primary` already exists there for this context |
| Internal navigation within a new full-screen admin/settings surface | Configuration rail's spec (reuse, don't reinvent) |
| Inspecting/editing one record from a list | Detail drawer's spec (reuse — route closing through `requestSelect`-equivalent) |
| None of the above | Stop. This is a Principle 10 moment ("no screen should invent a new UI pattern unnecessarily") — reopen the design before building. |
