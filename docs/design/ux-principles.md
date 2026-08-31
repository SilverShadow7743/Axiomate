# Axiomate UI/UX Principles

**Status:** Proposal — these ten principles, as given by the product owner, made concrete
against the shipped application. Each entry states the principle, why it matters for THIS
product (an enterprise workforce-management and delivery-management SaaS, not a consumer app),
a real example already in the codebase, and an anti-pattern to watch for. See
`axiomate-design-system.md` for the tokens these principles are built on and
`component-standards.md` for the patterns that embody them.

## 1. Enterprise clarity over visual decoration

**Why:** the audience operates this tool for hours a day to make delivery and staffing
decisions. Decoration that doesn't carry information is a tax on every one of those hours.

**Already true:** `app/globals.css`'s own header comment states it outright — "Density matches
the grid, not a settings page." The calm-pass restyle (commit `c8417fa`) deliberately touched
only a named list of selectors and left the dense Tree/Gantt view untouched, because density
there is functional, not a defect.

**Watch for:** a future screen reaching for a hero image, a gradient, or a large illustrative
empty-state graphic where a one-line message with a clear next action would do. If a design
adds visual weight without adding information, it's decoration.

## 2. Data density without cognitive overload

**Why:** the primary users (delivery managers, resource planners) need to scan dozens of
records at once, not read one record in isolation.

**Already true:** the Filters chip (`FiltersHeader.tsx`) collapses eight facets into a "Filters
· N" toggle that starts pre-expanded exactly when N > 0 — density is available on demand, never
hidden when it's actively narrowing what's shown. The counts strip (`.counts` in `FilterBar.tsx`)
surfaces five key numbers inline rather than requiring a click into each.

**Watch for:** density used as an excuse to skip grouping, sorting, or filtering affordances. A
dense screen with no way to narrow it is overload; a dense screen the user can filter in one
click is density done right.

## 3. Consistent behaviour across all modules

**Why:** a delivery manager working across Tree, Board, Calendar, and Timesheets in the same
session should never have to relearn how selection, filtering, or detail-viewing works.

**Already true:** `requestSelect()` is the single gate every row-selection path in the app
passes through — the Tree, Board, Calendar, notification deep-links, and search results all
route through it, so the unsaved-changes confirm fires identically everywhere. The Configuration
rail was restyled (commit `47239f1`) specifically because it had drifted into its own nav idiom
before the clean shell existed — a real instance of this principle being violated and then
corrected.

**Watch for:** a new screen inventing its own selection, dirty-check, or navigation logic
instead of reusing `requestSelect`, `AppSidebar`, or `DetailDrawer`. See Principle 10.

## 4. Workflow status must always be visually obvious

**Why:** at-risk, blocked, and overdue work is the whole point of a delivery-management tool —
if status isn't legible at a glance, the tool has failed its core job.

**Already true:** the Gantt's `Legend` component (`FilterBar.tsx`) is a self-documenting status
spec: schedule health is signaled by BOTH color and shape/glyph (`!` overdue, `⌧` blocked, `✓`
completed) — color is never the sole carrier there, already compliant with WCAG's
color-not-only rule.

**A real gap to close:** the severity column (`.sev-High/-Medium/-Low`) is color-only, with no
glyph pairing the way schedule health has. The sidebar's active-nav state also relies on color
+ font-weight without a shape indicator, mitigated only by `aria-current="page"` for screen
readers — sighted users with color-vision deficiency have font-weight as their only visual cue.
Both are flagged in `component-standards.md` and `ux-checklist.md` as concrete fix candidates.

## 5. Important actions should require minimal clicks

**Why:** the actions this tool exists to enable — logging time, approving a timesheet,
escalating a blocked issue — are done dozens of times a day by the people using it.

**Already true:** "+ New Issue" is the one global primary action in the top bar, reachable from
any view in one click, and pre-fills its parent from wherever the user currently is
(`newIssue()` in `IssueWorkspace.tsx`) rather than always defaulting to the top of the tree. The
Filters chip's saved-view apply sets both filters and view in a single click.

**Watch for:** burying a frequent action behind a menu-within-a-menu. If an action is done more
than a few times per session, it earns a one-click surface (a button, a chip, a row action) —
see the top bar's explicit "one primary action" rule in `navigation-model.md`.

## 6. Planning, allocation and timesheet information should be easy to scan

**Why:** this is a workforce-management tool first; hours, allocation, and schedule are the
data a manager scans fastest and most often.

**Already true:** `.mono` with `font-variant-numeric: tabular-nums` is applied wherever numbers
need to line up in a column — IDs, dates, hour totals — so digits don't jitter horizontally as
they change. The `/my-week` phone page groups entries by day with the hour total leading each
row, matching how a person actually scans a timesheet.

**Watch for:** a numeric column rendered in the proportional body font. Any place digits stack
vertically (a table column, a stat tile, a timer) needs `.mono`/tabular-nums, not an exception.

## 7. Complex business functionality should progressively disclose complexity

**Why:** Axiomate's operating model (roles, responsibilities, approval chains, SLA policy) is
genuinely complex — hiding that complexity by default, while keeping it reachable, is what
makes the tool usable for a new team member and powerful for an admin.

**Already true:** the Filters chip is the clearest instance — eight facets collapse to a single
chip until something is actively filtering. Configuration's "All settings" landing section
(`SettingsIndex`) exists specifically as an entry point into 27 sections a new admin would
otherwise have to discover by scrolling a rail.

**A real gap to close:** the structured config form pattern (`.cfg-fld`) has no visible
required-field marker and no inline validation-error convention in the files sampled — a
config-heavy screen currently discloses fields but not which ones are load-bearing. Flagged in
`component-standards.md`.

## 8. Desktop-first but fully responsive

**Why:** the core work — the scheduling grid, Gantt, and Configuration — genuinely needs
desktop screen real estate; but timesheet entry and approval are things people do from a phone
between meetings.

**Already true:** the app draws a real, explicit line rather than trying to make everything
responsive equally. `/my-week` is the one true phone-first surface — `font-size: 16px` on
inputs specifically to stop iOS auto-zoom, `min-height: 44px` touch targets (fixed today,
commit `adc8645`). The primary sidebar collapses to an overlay under 900px; the Configuration
rail collapses to a horizontal tab strip under the same breakpoint — two DIFFERENT collapse
strategies, correctly chosen: the sidebar's underlying page stays visible when collapsed,
Configuration's full-screen surface doesn't need to.

**Watch for:** trying to make the Tree/Gantt grid "work" on a phone. It shouldn't — the
principle is desktop-first for dense work, not responsive-everywhere at the cost of usability.

## 9. Accessibility should be built into every component

**Why:** built in, not bolted on afterward — retrofitting accessibility onto twenty screens
costs far more than getting it right in the one shared component each screen reuses.

**Already true:** `:focus-visible` is a single global rule (2px accent outline) that every
custom control — `.side-item`, `.fh-chip`, `.cfg-rail-item`, the drawer's controls — inherits by
construction, not by each component remembering to add it. The self-labelling filter dropdowns
carry `aria-label`/`title` even though their visible caption disappears once a value is set.

**Real gaps to close** (both found by review, both small): the reject-reason input on
`/my-week` had no visible label at all until today (aria-label only — acceptable but not ideal);
`.focus`/`.cfg`'s mount animation was missing its `prefers-reduced-motion` guard until today
(commit `adc8645`). Both are the kind of gap this principle exists to prevent — see
`accessibility.md` for the checklist that should catch these before they ship, not after.

## 10. No screen should invent a new UI pattern unnecessarily

**Why:** every new pattern is a new thing every user has to learn once and every future
maintainer has to keep consistent forever. The cost compounds; the benefit rarely does.

**Already true, and the strongest example in the app:** the Configuration rail predates the
clean shell and had its own left-border-accent nav style — visually a different design language
one click away from the new sidebar. It was NOT a new capability, just an old pattern that
drifted apart from a newer one doing the same job. It was restyled to match `.side-item`'s idiom
exactly (commit `47239f1`) rather than left as a second "acceptable" nav style. That is this
principle in action: two things doing the same job should look like the same thing.

**The rule for new work:** before building a new interaction, check `screen-inventory.md` and
`navigation-model.md`/`component-standards.md` for an existing pattern that already does the
job. A new pattern needs an explicit reason it can't reuse an existing one — "it looks nicer"
is not that reason. This is the check `axiomate-screen-builder` and `axiomate-ui-refactor` exist
to enforce.
