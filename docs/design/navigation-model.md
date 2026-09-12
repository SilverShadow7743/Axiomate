# Axiomate Navigation Model

**Status:** Proposal — five navigation patterns, extracted from the shipped shell. Three are
genuinely distinct jobs; the third (Configuration's rail) is the SAME pattern as the first,
restyled to match after it drifted (commit `47239f1`) — documented here as one spec with two
instantiations, not two specs, so the next contributor doesn't reintroduce the drift. The
fifth, the FactBox blade, arrived with the F&O page-grammar work (10 Sep,
`docs/plans/2026-09-10-fno-page-grammar-design.md`) and is the one genuinely new element that
work added; the drawer's entry (pattern 4) was updated for the same work.

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
  is color+weight only, not shape — see `docs/verification-checklist.md`'s keyboard walk).
- Badge — a filled `.side-badge` pill (accent background) for live counts (My work, the
  timesheet approval queue). The same pill carries the unread count on the top bar's bell, so
  one style serves every live count in the shell. (`.side-badge.muted` is the neutral variant
  that Archive used at the rail's foot until 12 Sep 2026; it has no rail use now.)

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
toggle, the notification bell, Export ▾) → save-status chip (`.persist-tag`) → account
(`UserMenu`, which also holds Configuration and Archive).

**The bell** (`.topbar-bell`, 12 Sep 2026) is the one deliberate exception to the rule below:
it opens the `inbox` view. That view is an action centre — what needs a decision, what you are
waiting on, what the rules have told you — and Nishant's call was that it belongs with the
actions, the way F&O's action centre hangs off the top bar, not on the rail as a place
("inbox is just notification"). It is a `.btn.ghost` with `aria-pressed` while its view is
open and a `.side-badge` unread count; internal actors only, since a client's notifications
are always empty.

**The one-primary-action rule:** exactly one `.btn.primary` lives in the top bar at any time.
Every other action is `.btn` or `.btn.ghost`. This is deliberate — a bar with two competing
primary actions asks the user to decide which one matters, which is a decision the interface
should have already made.

**Use for:** global actions that apply regardless of the current view. **Never** for navigating
between views — that's the rail's job; the bell above is the sole, named exception, and a
second one needs the same explicit decision. (An earlier design merged navigation and action into one
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
panel's own ⤢ control; `min(1020px, 92vw)` while the FactBox blade is open — the drawer widens
so the page keeps its width). `role="dialog" aria-modal="true"`. Laid out as a row:
`.drawer-main` holds the page, an optional blade sits beside it (pattern 5). Slides in over
`--duration-entrance` (0.16s), guarded by `prefers-reduced-motion`.

**The page inside it is an F&O details page** (`DetailPanel.tsx`, since 10 Sep): title
`<ID> : <Subject>`, the record's status pinned upper-right as a chip, exactly one
`.btn.primary` on the record (the suggested status transition in `FieldStrip`; `Add` on a
structural row, where no strip renders), and the former tab strip as **single-open FastTabs**
in `TABS` order, each header carrying a summary (open checklist count, latest note date, logged
hours, planned end). Single-open is deliberate — the pane mounts one body at a time and
`onDirtyChange`, the editors and the two `tab` effects depend on it. The first FastTab is open
by default and fits without scrolling; `requestTab` opens *and reveals* its section.

**Opening:** row selection on Tree, Board, or Calendar — the row click, or the subject's own
link in the first column (both routed through `requestSelect`).

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

## 5. FactBox blade — related information beside the record

**Component:** `FactBoxBlade.tsx`, rendered into `DetailDrawer`'s `blade` slot by the
workspace. **CSS:** `.factbox-tab` (collapsed), `.factbox-blade` / `.factbox` (open),
`.drawer.blade-open`.

**Anatomy:** collapsed by default to a labelled vertical tab on the drawer's right edge
("Related information"); opened, a column of FactBoxes for the selected row in F&O's two
shapes — a **card** (a set of related fields: Owner with I14's leave caveat, Schedule from the
row) and a **grid** (a child collection capped at five with a "More" that opens the section
holding the full list: Related records → Links, Recent activity → Notes). The drawer widens
to hold it (pattern 4) rather than the page narrowing.

**The one rule, checked at review:** every figure in the blade is an existing record or an
existing pure function's output. No `useMemo` in the file computes a number `lib/` does not
already produce — the same constraint the dashboards design placed on widgets, for the same
reason. If a FactBox needs a number nothing provides, build the function under its module's
doctrine first; the blade never computes.

**Closing:** the tab toggles it; nothing routes through `requestSelect` because the blade holds
no edits — it is a reading surface. Stacks with the drawer at `--z-drawer`, below `--z-dock`.

**Use for:** read-only context about the record that is open — never for actions (those belong
on the record action pane or in a FastTab's local toolbar) and never for a figure that exists
nowhere else.

## Decision table — which pattern for a new capability

| The new thing is... | Use |
|---|---|
| A new top-level "place" (view of the workspace) | Primary rail — add to `AppSidebar`'s groups |
| A global action available from anywhere | Top bar — but only if no `.btn.primary` already exists there for this context |
| Internal navigation within a new full-screen admin/settings surface | Configuration rail's spec (reuse, don't reinvent) |
| Inspecting/editing one record from a list | Detail drawer's spec (reuse — route closing through `requestSelect`-equivalent) |
| Read-only context beside the record that is open | FactBox blade — a card or a capped grid, every figure an existing pure function's output; never a new number |
| None of the above | Stop. This is a Principle 10 moment ("no screen should invent a new UI pattern unnecessarily") — reopen the design before building. |
