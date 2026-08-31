# The clean shell — Axiomate's information, Hive's calm

**Status: approved 2026-08-31** (three AskUserQuestion decisions: the full shell restructure
over declutter-in-place; the right OVERLAY drawer for detail over side-by-side and over the
bottom dock; the design below). The trigger was lived, not theoretical: a feature shipped
and its owner could not find it on the screen. The comparison already said it — Hive wins on
polish; Axiomate is expert-operator-shaped — and the weekend's additions made the shell
heavier still.

## The three regions

- **Left sidebar** (~240 px; collapses behind a hamburger under 900 px) owns ALL navigation.
- **One top bar** owns actions: brand, the global search box (unchanged, dropdown included),
  then right-aligned + New Issue (the single primary), Assistant, Export ▾, the save-state
  chip, account. The Views ▾ dropdown retires — the sidebar owns views now.
- **Content breathes.** The bottom dock is REMOVED: selecting a record slides the existing
  DetailPanel in from the right as an overlay drawer (min(720px, 92vw); Esc and
  outside-click close) — the Tree and Gantt keep every pixel of width underneath.

## The sidebar's information architecture (Axiomate's own, not Hive's copied)

- **Your work** — My work (count badge) · My week (a first-class desktop link at last) ·
  My calendar · Notifications (badge)
- **Workspace** — Tree · Board · Calendar · Portfolio
- **Records** — Timesheets · Mail
- **Saved views** — the team's list, applying filters + tab on click; "Save current…" moves
  here from the toolbar (its natural home)
- Bottom — Configuration · Archive

## Filters leave the shell

The global filter row is gone. Views that filter (Tree, Board, Calendar) get a slim
**Filters** toggle chip in their own content header, showing the active-filter count and
expanding the EXISTING FilterBar component in place — moved, not rewritten.

## Visual language — token-level only

More whitespace; separation by background tint rather than hard borders; radii softened;
the red confined to accent duty (active nav, primary buttons); warm grays elsewhere. All in
globals.css. No component logic changes for looks alone.

## The rule that makes this shippable

**Every view component mounts unchanged** — MyWorkPanel, the grid, Board, Calendar,
Portfolio, TimesheetPanel, MailLog (inbox panel included), Notifications, MyCalendar. Only
IssueWorkspace's layout JSX restructures around them, plus two new shell components
(AppSidebar, DetailDrawer). Reducer, boot, routes, and all 192 scenarios untouched by
construction; the a11y gate holds at zero; the sidebar and drawer get real keyboard
behaviour (arrows/Enter in nav, Esc for the drawer, focus return on close).

## Verification

Full gates, then a walkthrough of every view in the new shell: drawer open/edit/close with
unsaved-changes guard intact, Filters chip expand/collapse with the grid narrowing live,
saved views applying from the sidebar, hamburger behaviour at phone width, the My-week link,
and the Mail view showing BOTH the inbox panel and the log. By the assistant if the browser
extension revives; by the user with a two-minute checklist if not.

## What would send this back

- The grid/Gantt's height-and-scroll math structurally depends on the bottom dock's layout —
  the phase pauses for a real fix rather than CSS hacks. Surfaces at the first Tree render,
  deliberately the first UI step.
- The drawer's overlay fights Quick Edit's popovers or the dirty-check confirm flow — the
  interaction model reopens rather than stacking z-index patches. Surfaces at the drawer step.
