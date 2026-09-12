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
| Applications | `applications` | List page (local quick filter, name as link) grouped by client | `ApplicationLandscape` | No | Its own `DetailDrawer` (`ApplicationDetail`) |
| Analytics | `analytics` | Cross-tabs over the register | `AnalyticsView` | No | No |
| Timesheets | `timesheet` | Phone-adjacent form + approval queue; record column is the link | `TimesheetPanel` | No | No — opens the record's Time tab via `revealIssue` |
| Mail | `mail` | Two-part: live inbox panel + static log table | `InboxPanel`, `MailLog` | No | No |
| People | `people` | List page (quick filter over name/address/title/role, sortable columns, name as link, status chip, one primary: New person for `config.manage`) — internal actors only | `PeopleDirectory` | No | Yes — a person's page in `DetailDrawer` (`ProfilePanel`) |

## Standalone routes (outside the shell)

| Screen | Route | Pattern | Primary component |
|---|---|---|---|
| My week | `/my-week` | Phone-first form, 44px touch targets | `MyWeek.tsx` |
| Sign in | `/signin` | Entra redirect | (auth route, no custom UI) |

## Configuration (full-screen overlay, reached from the account menu)

Thirty sections behind the Configuration rail (`.cfg-rail` — see `navigation-model.md`
pattern 3). Grouped exactly as declared in `ConfigWorkspace.tsx`'s `TABS`:

**Operating model** (20) — All settings (`index`, the discoverability landing page),
Capabilities, Terminology, Roles & people, Work types, Disciplines, Skills, Custom fields,
Service levels, Status transitions, Permissions, Approvals, Automation, Scheduled pass, Time
recording, Allocation, T-shirt sizing, Responsibilities, Activity templates, Issue templates.

**Governance** (6) — Goals, Health score, Rates, Blueprints, Scope overrides, Duplicates.

**Automation** (4) — Agent registry, Recurring work, Workflows & templates, Routing & intake.

Each section is a structured-form surface (`.cfg-fld` pattern — see `component-standards.md`).
Under 900px the rail collapses to a horizontal tab strip.

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

## Export / print artifacts (not navigable screens)

Reached via the top bar's Export ▾ menu, not the sidebar — these render for print/PDF, not
interactive browsing:

- Daily IMS status report (text + CSV)
- Weekly client pack (print-ready, client-safe records only; carries the engagement health
  score with its terms and its "over-commitment not counted" disclosure) — `ClientPackView`
- Monthly governance pack (print-ready rollup, same score section) — `ClientPackView`
- Finance timesheet report (.xlsx / PDF, no rates)
- Visible-rows CSV export

## Coverage note

This inventory reflects the shell as of commit `b09fb75` (2026-09-11, the F&O page-grammar
work's step 7). When a new view, section, or overlay ships, add it here in the same pass — an
inventory that drifts from the real app is worse than no inventory, because it gets trusted
anyway: the previous stamp (`adc8645`, 31 Aug) was four views and three Configuration sections
behind by the time this was refreshed. `axiomate-design-audit`'s audit template checks this
file's freshness against the actual `AppSidebar`/`ConfigWorkspace` source as part of its
standard pass.
