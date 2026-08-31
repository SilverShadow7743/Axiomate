# Screen Template — Placement Decision

Before writing a new screen, decide where it belongs using this order. Full rationale:
`docs/design/navigation-model.md`'s decision table and `docs/design/information-architecture.md`.

## 1. Is this a new top-level "place"?

If it answers a "where do I find X" question the way My work, Tree, or Timesheets do → it's a
**workspace view**. Add it to `AppSidebar.tsx`'s `GROUPS`/`VIEW_LABEL`/`VIEW_TITLE`, pick the
right group (Your work / Workspace / Records — see `information-architecture.md` for the
grouping logic), and wire the view-switch in `IssueWorkspace.tsx`.

Does it need the dense grid (Tree/Gantt-shaped data)? Pair it with the Filters chip pattern
ONLY if it will actually receive a filtered row set (most views don't — check first).

## 2. Is this a config/admin surface?

If it's about configuring behavior rather than doing work → a **Configuration section**. Add it
to `ConfigWorkspace.tsx`'s section list in the right group (Operating model / Governance /
Automation), use the `.cfg-fld` structured-form pattern, and update
`docs/design/screen-inventory.md`'s Configuration table in the same commit.

## 3. Is this phone-first, touch-primary work?

If the primary user will do this from a phone (like time recording) → a **standalone route**
like `/my-week`, not a responsive collapse of a dense desktop view. Use the phone-first form
spec (44px targets, 16px input font, visible labels where space allows).

## 4. Is this about ONE record?

If it's inspecting or editing a single record without leaving its list context → the **detail
drawer** pattern. Reuse `DetailDrawer`'s dirty-check-gated close; do not build a second
drawer/panel with its own close logic.

## 5. None of the above?

Stop. This is a Principle 10 moment. Read `docs/design/ux-principles.md` §10 and check with
`axiomate-ui-refactor`'s consolidation rules before inventing a new pattern — most "new" needs
turn out to be a variant of something in `component-library.md`.

## After building

1. Every color/spacing/radius/type value should trace to a token in
   `references/design-system.md` — no raw hex or arbitrary px.
2. Every status indicator needs a non-color signal alongside color (shape, glyph, text).
3. Update `docs/design/screen-inventory.md` in the same commit.
4. Run the project's standard gate (tsc, scenarios, a11y, build) before considering it done.
5. If the change touches shared CSS, scope the diff to a NAMED selector list — never a blanket
   rewrite (the calm-pass discipline from commit `c8417fa`).
