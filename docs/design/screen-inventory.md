# Axiomate Screen Inventory

**Status:** Proposal — every screen in the application, flat, with the pattern it uses and its
primary component file. Cross-check this before building anything new (Principle 10 / the
decision table in `navigation-model.md`). Pattern names in F&O's vocabulary since the 10 Sep
page-grammar work (`docs/plans/2026-09-10-fno-page-grammar-design.md`): *list page* (quick
filter above the grid, first textual column opens the record, plural title from terminology),
*details page* (`ID : Subject`, status upper-right, one primary action, FastTabs), *workspace*
(summary tiles above a tabbed list), *FactBox* (related information beside the record).

## Workspace views (inside `IssueWorkspace.tsx`, reached via the primary rail — except Notifications, reached via the top bar's bell)

| Screen | View key | Pattern | Primary component | Pairs with Filters chip? | Pairs with drawer? |
|---|---|---|---|---|---|
| My work | `mywork` | Workspace: two labelled tile rows (workspace counts → Tree; your reasons → the group) above the ranked list | `MyWorkPanel` (+ `FirstRunCard`, `AdminFirstRunCard`) | No | No — hops to Tree on open |
| My calendar | `mycalendar` | Month grid, personal | `MyCalendarPanel` | No | No |
| My to-dos | `mytodos` | Private list (per-owner redaction, never org-visible) | `MyTodosPanel` | No | No |
| Notifications | `inbox` | Action centre: grouped list, opened from the top-bar bell (badged with the unread count), not from the rail | `Inbox` (docked) | No | No |
| Tree | `tree` | List page (quick filter, subject as link) + Gantt, split pane | `TreeGrid`, `GanttChart` | Yes | Yes |
| Board | `board` | List page (quick filter) as Kanban lanes — the card is the link | `BoardView` | Yes | Yes |
| Calendar | `calendar` | List page (quick filter) as month grid + undated rail | `CalendarView` | Yes | Yes |
| Portfolio | `portfolio` | Workspace: one score tile per engagement (band, value, terms) above the concern lines | `PortfolioPanel` | No | No |
| Resourcing | `resourcing` | Workspace: 4 summary tiles (Fully staffed / Under- / Over-allocated / Bench) above a quick-filtered table (Person, Allocated %, Actual hrs, Variance, Projects, Bench?) — requires `capacity.allocate` | `ResourcingPanel` | No | Yes — person name opens `ProfilePanel` |
| Applications | `applications` | List page (local quick filter, name as link) grouped by client | `ApplicationLandscape` | No | Its own `DetailDrawer` (`ApplicationDetail`) |
| Analytics | `analytics` | Cross-tabs over the register | `AnalyticsView` | No | No |
| Timesheets | `timesheet` | Phone-adjacent form + approval queue; record column is the link | `TimesheetPanel` | No | No — opens the record's Time tab via `revealIssue` |
| Mail | `mail` | Two-part: live inbox panel + static log table | `InboxPanel`, `MailLog` | No | No |
| People | `people` | List page (quick filter over name/address/title/role, sortable columns, name as link, status chip, one primary: New person for `config.manage`) — internal actors only | `PeopleDirectory` | No | Yes — a person's page in `DetailDrawer` (`ProfilePanel`) |
| Commercial | `commercial` | Workspace: 4 sub-tabs (All SOWs / Overdue milestones / Unpaid invoices / At-risk margin) each with its own quick filter and table — requires `rate.view` | `CommercialRegister` | No | No |
| Milestones | `milestones` | List page: icon, milestone, SOW, status — client-facing only, reached from `CLIENT_GROUPS`; bounces an internal viewer back to My work | `ClientMilestonesPanel` | No | No |

## Standalone routes (outside the shell)

| Screen | Route | Pattern | Primary component |
|---|---|---|---|
| My week | `/my-week` | Phone-first form, 44px touch targets | `MyWeek.tsx` |
| Sign in | `/signin` | Custom two-column page: claims panel + "Continue with Microsoft" (not a bare redirect) | `app/signin/page.tsx` |
| Public intake form | `/intake/form/[token]` | Standalone, unauthenticated form: name, email, subject, description, urgency | `IntakeFormClient.tsx` |

## Configuration (full-screen overlay, reached from the account menu)

Thirty-one sections behind the Configuration rail (`.cfg-rail` — see `navigation-model.md`
pattern 3). Grouped exactly as declared in `ConfigWorkspace.tsx`'s `TABS`, with five
Operating-model sub-groups the rail itself renders as headings:

**Operating model** (21) —
*Vocabulary & classification*: All settings (`index`, the discoverability landing page),
Terminology, Work types, Disciplines, Skills, Career levels, Custom fields, Responsibilities.
*Roles & people*: Roles & people.
*Rules & permissions*: Capabilities, Status transitions, Permissions, Approvals, Automation
rules, Scheduled pass.
*Estimation & capacity*: T-shirt sizing, Time recording, Allocation, Service levels.
*Templates*: Activity templates, Issue templates.

**Governance** (6) — Goals, Health score, Rates, Blueprints, Scope overrides, Duplicates.

**Automation** (4) — Agent registry, Recurring work, Workflows & templates, Routing & intake.

Each section is a structured-form surface (`.cfg-fld` pattern — see `component-standards.md`).
Under 900px the rail collapses to a horizontal tab strip. The "All settings" landing page
itself covers only 18 of the 31 sections with a card — Disciplines, Skills, Career levels,
Custom fields, Capabilities, Time recording, Allocation, Goals and Rates have none, so an admin
starting from that page cannot discover them from there.

## Overlay patterns (not standalone screens — pair with a host view)

| Overlay | Opens from | Pattern | Primary component |
|---|---|---|---|
| Record detail | Tree / Board / Calendar row selection | Details page in a right drawer: `ID : Subject`, status chip upper-right, one `.btn.primary`, single-open FastTabs | `DetailDrawer` + `DetailPanel` |
| Related information | The drawer's right-edge tab | FactBox blade beside the page (Owner, Schedule cards; Related records, Recent activity grids capped at five) | `FactBoxBlade` (in `DetailDrawer`'s `blade` slot) |
| Add/edit dialogs (issue, node, dependency, etc.) | "+ New Issue", row actions | Modal | `Dialogs` |
| Evidence manager | A record's Links/Evidence tab | Modal | `EvidencePanel` |
| Archive | Account menu (Workspace group; shown only when something is archived) | Drawer-style panel | `ArchivePanel` |
| SLA planner | Filters chip's "Set due dates from this policy…" | Modal | `SlaPlanPanel` |
| Finance report | Export ▾ menu | Modal | `FinanceReportDialog` |
| A person's page | People list, reports-to / direct-report links, the People configuration card | Details page in a right drawer (lifted above the Configuration overlay): name as title, Active/Departed chip upper-right, Mark departed / Reactivate for `config.manage`, FastTabs Overview · Career · Skills · Work · History; identity fields inline-editable for `config.manage` | `ProfilePanel` in `DetailDrawer` |
| Assistant | Top bar toggle | Dock (`--z-dock`, distinct from the drawer) | `ChatPanel` |
| Leave report | Export ▾ menu | Modal, then a print view | `LeaveReportDialog` (+ `LeaveReportView`) |
| Snapshot drawer | A Gantt row's own action | Drawer, nested inside `DetailDrawer` | `SnapshotDrawer` |
| Capacity replanning | Portfolio's capacity-concern link | Drawer, nested inside `DetailDrawer` | `ReplanningDrawer` |
| Stuck changes | Automatic, on reload, when a change failed to reach the server | Modal | `StuckChangesPanel` |
| Selection toolbar | Row selection in the drawer, or multi-select in Tree/Board | Inline action bar, top of the drawer | `SelectionToolbar` |
| Quick edit | Double-click a Subject cell in `TreeGrid` | Popover | `QuickEditPopover` |
| Search results | Focusing the top-bar search box | Popover listbox | `SearchResults` |
| Add application | Applications view's "Add application…" | Modal | (inside `ApplicationLandscape.tsx`) |
| My calendar's own forms | "Add event" / "Request leave" / "Add meeting" | Modal, one per kind | (inside `MyCalendarPanel.tsx`) |

## Export / print artifacts (not navigable screens)

Reached via the top bar's Export ▾ menu, not the sidebar — these render for print/PDF, not
interactive browsing:

- Daily IMS status report (text + CSV)
- Weekly client pack (print-ready, client-safe records only; carries the engagement health
  score with its terms and its "over-commitment not counted" disclosure) — `ClientPackView`
- Monthly governance pack (print-ready rollup, same score section) — `ClientPackView`
- Finance timesheet report (.xlsx / PDF, no rates)
- Leave report (.xlsx / PDF, working days only — no reasons, no balances)
- Visible-rows CSV export

## Coverage note

This inventory reflects the shell as of commit `c8e138b` (2026-09-20). When a new view,
section, or overlay ships, add it here in the same pass — an inventory that drifts from the
real app is worse than no inventory, because it gets trusted anyway: the previous stamp
(`b09fb75`, 2026-09-11) was three views (Resourcing, Commercial, Milestones — all shipped
2026-09-13) and one Configuration section (Career levels, shipped 2026-09-14) behind by the
time this refresh caught it, and before that the `adc8645` stamp (31 Aug) was four views and
three Configuration sections behind. The pattern repeats because nothing enforces it
automatically — `axiomate-design-audit`'s audit template checks this file's freshness against
the actual `AppSidebar`/`ConfigWorkspace` source as part of its standard pass, but that audit
has to be run, not triggered by the ship itself.
