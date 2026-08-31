# Axiomate Screen Inventory

**Status:** Proposal — every screen in the application, flat, with the pattern it uses and its
primary component file. Cross-check this before building anything new (Principle 10 / the
decision table in `navigation-model.md`).

## Workspace views (inside `IssueWorkspace.tsx`, reached via the primary rail)

| Screen | View key | Pattern | Primary component | Pairs with Filters chip? | Pairs with drawer? |
|---|---|---|---|---|---|
| My work | `mywork` | Grouped list, dashboard widget | `MyWorkPanel` (+ `FirstRunCard`) | No | No — hops to Tree on open |
| Tree | `tree` | Primary grid + Gantt, split pane | `TreeGrid`, `GanttChart` | Yes | Yes |
| Board | `board` | Kanban lanes | `BoardView` | Yes | Yes |
| Calendar | `calendar` | Month grid + undated rail | `CalendarView` | Yes | Yes |
| Portfolio | `portfolio` | Grouped list, dashboard widget | `PortfolioPanel` | No | No |
| Timesheets | `timesheet` | Phone-adjacent form + approval queue | `TimesheetPanel` | No | No |
| Notifications | `inbox` | Grouped list | `Inbox` (docked) | No | No |
| My calendar | `mycalendar` | Month grid, personal | `MyCalendarPanel` | No | No |
| Mail | `mail` | Two-part: live inbox panel + static log table | `InboxPanel`, `MailLog` | No | No |

## Standalone routes (outside the shell)

| Screen | Route | Pattern | Primary component |
|---|---|---|---|
| My week | `/my-week` | Phone-first form, 44px touch targets | `MyWeek.tsx` |
| Sign in | `/signin` | Entra redirect | (auth route, no custom UI) |

## Configuration (full-screen overlay, reached from the sidebar's foot)

Twenty-seven sections behind the Configuration rail (`.cfg-rail` — see `navigation-model.md`
pattern 3). Grouped exactly as declared in `ConfigWorkspace.tsx`:

**Operating model** — All settings (`index`, the discoverability landing page), Capabilities,
Terminology, Roles & people, Work types, Disciplines, Skills, Service levels, Status
transitions, Permissions, Approvals, Automation, Scheduled pass, Time recording, Allocation,
T-shirt sizing, Responsibilities.

**Governance** — Goals, Rates, Blueprints, Scope overrides.

**Automation** — Agent registry, Recurring work, Workflows & templates, Routing & intake.

Each section is a structured-form surface (`.cfg-fld` pattern — see `component-standards.md`).
Under 900px the rail collapses to a horizontal tab strip.

## Overlay patterns (not standalone screens — pair with a host view)

| Overlay | Opens from | Pattern | Primary component |
|---|---|---|---|
| Record detail | Tree / Board / Calendar row selection | Right drawer | `DetailDrawer` + `DetailPanel` |
| Add/edit dialogs (issue, node, dependency, etc.) | "+ New Issue", row actions | Modal | `Dialogs` |
| Evidence manager | A record's Links/Evidence tab | Modal | `EvidencePanel` |
| Archive | Sidebar foot | Drawer-style panel | `ArchivePanel` |
| SLA planner | Filters chip's "Set due dates from this policy…" | Modal | `SlaPlanPanel` |
| Finance report | Export ▾ menu | Modal | `FinanceReportDialog` |
| Profile panel | Account menu / sidebar avatar | Modal/panel | `ProfilePanel` |
| Assistant | Top bar toggle | Dock (`--z-dock`, distinct from the drawer) | `ChatPanel` |

## Export / print artifacts (not navigable screens)

Reached via the top bar's Export ▾ menu, not the sidebar — these render for print/PDF, not
interactive browsing:

- Daily IMS status report (text + CSV)
- Weekly client pack (print-ready, client-safe records only) — `ClientPackView`
- Monthly governance pack (print-ready rollup) — `ClientPackView`
- Finance timesheet report (.xlsx / PDF, no rates)
- Visible-rows CSV export

## Coverage note

This inventory reflects the shell as of commit `adc8645` (2026-08-31). When a new view,
section, or overlay ships, add it here in the same pass — an inventory that drifts from the
real app is worse than no inventory, because it gets trusted anyway. `axiomate-design-audit`'s
audit template checks this file's freshness against the actual `AppSidebar`/`ConfigWorkspace`
source as part of its standard pass.
