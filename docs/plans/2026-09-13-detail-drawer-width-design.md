# Detail drawer width — wide by default on desktop, full-screen for focus — design

Nishant: *"use a wide issue detail panel on desktop and a full-screen detail view when the
user needs to focus on a complex issue. This gives users more space without losing their
context in the board or list."*

## What already exists

The issue detail pane is `DetailPanel.tsx` (tab content) inside `DetailDrawer.tsx` (the
container) — a right-hand overlay drawer, not a route or a resized column. Its own doc
comment states the exact property the request needs for free: *"The Tree and Gantt keep
every pixel of width underneath; selecting a record slides its detail over them instead of
shortening them."* Widening the drawer, even to the full viewport, never touches that
guarantee — the board or list is exactly where it was, just covered, the same as it is
today at the drawer's current 720px.

A "wide" mode is already built: `DetailDrawer`'s `wide: boolean` prop (`app/globals.css`
~1492-1536) toggles `.drawer` between `min(720px, 92vw)` and `92vw`, driven by a ⤢/⤡ button
in `DetailPanel.tsx`'s header (`onSetPanel(panelState === 'expanded' ? 'standard' :
'expanded')`, `IssueWorkspace.tsx:2058-2064` maps that dock-era `PanelState` verb onto
`setDrawerWide`). It defaults to `false` on every record open (`useState(false)`,
`IssueWorkspace.tsx:2048`) and isn't a persisted preference — a delivery lead has to notice
and click a small icon to get it, every time.

There is no full-screen mode. The one full-viewport pattern already in the app
(Configuration's `.cfg`, `position: fixed; inset: 0`) replaces the sidebar and top bar too,
which the request's own "without losing context" line rules out as a literal reuse.

## The two changes

**1. Wide becomes the desktop default**, not something to discover. `drawerWide`'s initial
state becomes viewport-aware instead of always `false`: `window.innerWidth >= 900` (matching
the mobile breakpoint the nav-burger fix already established as this app's desktop line).
Narrower than that, the drawer keeps opening at `standard` (720px would already exceed the
viewport below ~780px anyway — `min(720px, 92vw)` already degrades gracefully there). The ⤢
toggle stays exactly as it is today, for the person who wants to shrink it back.

**2. A new `full` width, a manual action, independent of `wide`.** `DetailDrawer`'s `wide:
boolean` prop becomes `width: 'standard' | 'wide' | 'full'` (a new type, `DrawerWidth`,
defined and exported from `DetailDrawer.tsx` — not folded into `lib/panel.ts`'s `PanelState`,
which is dock-era HEIGHT vocabulary for a component that no longer has a height axis; see
"What this deliberately does not touch" below). `.drawer.full { width: 100vw; }`, declared
after `.drawer.wide` so it wins in the (currently impossible, since the three are mutually
exclusive classes) combined case, the same source-order convention `.drawer.blade-open` and
`.drawer.wide` already rely on.

A third button joins the two already in `DetailPanel.tsx`'s `.panel-controls` — `⛶`/`⛶
close`, its own independent state (`drawerFull`, not folded into `PanelState`/`onSetPanel`),
disabled under the same `panelLocked` condition the other two already use. Turning `full` on
does not change what `wide` remembers underneath it — turning `full` back off returns to
whatever `wide` was already set to, exactly the way `wide` today doesn't forget `standard`.

**Reset on record change, not persisted.** Unlike `wide` (whose desktop-default makes it the
ordinary state), `full` starts `false` every time a different record is selected — "focus on
THIS complex issue" reads as a deliberate, per-record action in the request's own wording,
not a standing preference that would otherwise silently full-screen every subsequent click
whether or not that record needed it.

## What this deliberately does not touch

- **`lib/panel.ts`'s dead height math** (`autoStateFor`, `defaultFraction`, `panelHeight`,
  `loadPrefs`, `savePrefs`, `COMPACT_H`, `CONTENT_HEAVY_TABS`) — confirmed unused by grep
  across every component. Real, and named here so it isn't rediscovered as part of this
  change, but a dead-code removal is a separate, unrelated cleanup with its own review, not
  bundled into a feature commit.
- **`PanelState`'s existing three values** (`compact`/`standard`/`expanded`) and the
  ▼/▲ and ⤢/⤡ buttons — unchanged. `full` is a fourth, independent axis layered on top via
  its own prop and button, not a fourth `PanelState` value, because `PanelState` already
  conflates two things (open/closed, and standard/wide) inherited from the dock era, and
  stretching it to also carry "full-screen focus" would compound that rather than add
  cleanly beside it.
- **The FactBox blade's own width math** (`.drawer.blade-open`, `min(1020px, 92vw)`) — at
  `full`, the drawer is already `100vw`, so the blade simply has more room inside it; no
  blade-specific change needed.
- **`SnapshotDrawer`'s use of the same `DetailDrawer`** (`wide={false}`, no toggle) — becomes
  `width="standard"` under the new prop shape, mechanically, with no new capability offered
  there (snapshots never had a wide/full control and don't gain one here).

## Copy fix noticed while reading the exact lines this touches

The ⤢ button's tooltip currently says *"Expand the detail pane"* / *"Restore normal
height"* — dock-era wording (the pane has had no height axis since the 31 Aug migration to a
width-based drawer). Fixed in the same pass since the third button's tooltip sits right next
to it and a reader comparing the two would notice the mismatch immediately: *"Widen the
detail pane"* / *"Restore normal width."*

## Risk

Low, and entirely presentational. No reducer arm, no schema, no scenario-shaped logic — pure
CSS width classes and two booleans in component state. The one thing worth being deliberate
about: the 900px breakpoint should match the app's own existing desktop line (the mobile-nav
fix's `@media (max-width: 900px)`) rather than inventing a second one, so "desktop" means the
same viewport width everywhere in this app.

## Testing

No new scenario — this is presentation state with no data shape to prove (the same reasoning
Resourcing's and Commercial's own component-level changes used: `npm run validate:scenarios`
re-run for byte-identical confirmation, not a new scenario). Verified by hand in a browser at
a genuine desktop width and a genuine narrow width: the drawer opens wide by default above
900px and standard-width below it, the ⤢ toggle still shrinks/restores it, the new ⛶ toggle
takes it to 100vw and back without losing whatever `wide` state it had, and Tree/Board
underneath are unaffected by any of the three.
