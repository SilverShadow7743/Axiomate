# Axiomate Information Architecture

**Status:** Proposal — a map of what's where and why, as of the clean shell (commits
`92a2fe5`–`adc8645`, 2026-08-31). See `navigation-model.md` for the interaction specs of the
patterns named below, and `screen-inventory.md` for the flat enumeration of every screen.

## The shape of the app

One shell (`IssueWorkspace.tsx`) hosts nine navigable **views**, reached exclusively through the
left sidebar. Two things sit outside that shell entirely: `/my-week` (a standalone phone-first
route) and Configuration (a full-screen overlay reached from the sidebar's foot, with its own
internal navigation). A detail drawer overlays any list-shaped view to show one record without
leaving it.

```
AppSidebar (all navigation)
├── Your work
│   ├── My work        → view: mywork
│   ├── My week         → route: /my-week (standalone, phone-first)
│   ├── My calendar     → view: mycalendar
│   └── Notifications   → view: inbox
├── Workspace
│   ├── Tree             → view: tree      (+ DetailDrawer on selection)
│   ├── Board            → view: board     (+ DetailDrawer on selection)
│   ├── Calendar          → view: calendar (+ DetailDrawer on selection)
│   └── Portfolio        → view: portfolio
├── Records
│   ├── Timesheets       → view: timesheet
│   └── Mail             → view: mail
├── Saved views           (team-shared, apply sets filters + view together)
└── (foot) Configuration → full-screen overlay, its own rail (27 sections / 3 groups)
    (foot) Archive       → archive drawer
```

## The sidebar's four groups, and why they're grouped that way

Grouped by **whose question each place answers**, not by how the code renders them
(`AppSidebar.tsx`'s own top comment states this explicitly):

- **Your work** — "what's waiting on me, personally." My work (badged with a live count), My
  week, My calendar, Notifications (badged with unread count).
- **Workspace** — "what does the delivery look like." Tree, Board, Calendar, Portfolio — the
  four ways of viewing the same underlying issue/schedule data.
- **Records** — "what happened / what's on file." Timesheets, Mail.
- **Saved views** — team-shared filter+view combinations, not a fifth semantic group so much as
  a personalization layer over Workspace.

The active item derives from the current `view` state, never from local component state —
notification deep-links and search-hit clicks change `view` externally, and the rail follows
without needing to be told separately. This is a structural rule, not a convenience: any new
navigation entry point MUST change `view`, never bypass the sidebar's own state.

## The nine workspace views

| View key | Sidebar label | Purpose | Pairs with the drawer? |
|---|---|---|---|
| `mywork` | My work | Everything waiting on you, across every engagement, grouped by reason (decide/overdue/blocked/attest/due/open) | No — opens via `revealIssue`, navigates to Tree |
| `tree` | Tree | The full structure with the timeline (Gantt) beside it | Yes |
| `board` | Board | Status lanes — drag a card to move it | Yes |
| `calendar` | Calendar | Due dates on a month grid, undated on a rail | Yes |
| `portfolio` | Portfolio | Every engagement at once — overdue, blocked, unowned, quiet | No |
| `timesheet` | Timesheets | Your week, gathered; the approval queue if you hold `time.approve` | No |
| `inbox` | Notifications | What the rules have told you, and what never left the building (undelivered escalations) | No |
| `mycalendar` | My calendar | Your own month — events, leave, allocation, your own due dates | No |
| `mail` | Mail | "Your inbox" (delegated Mail.Read, per-session) plus the intake mail log | No |

Only Tree, Board, and Calendar pair with the Filters chip (`FiltersHeader.tsx`) — they're the
three views that actually receive the filtered row set. The other six compute their own lists
and correctly show no filter row at all (a control that does nothing must not be shown — see
`component-standards.md`'s Forms section).

## Configuration — 27 sections, 3 groups

Configuration is reached from the sidebar's foot but is architecturally separate: a full-screen
overlay (`.cfg`, `position: fixed`) with its own left rail, not a tenth workspace view. Its
sections, grouped exactly as defined in `ConfigWorkspace.tsx`:

**Operating model** (16 sections) — All settings (index/landing), Capabilities, Terminology,
Roles & people, Work types, Disciplines, Skills, Service levels, Status transitions,
Permissions, Approvals, Automation, Scheduled pass, Time recording, Allocation, T-shirt sizing,
Responsibilities.

**Governance** (4 sections) — Goals, Rates, Blueprints, Scope overrides.

**Automation** (4 sections) — Agent registry, Recurring work, Workflows & templates, Routing &
intake.

The "All settings" section is the discoverability entry point — a new admin lands there rather
than having to scan 27 rail entries cold. Under 900px, the rail collapses to a horizontal
scrolling tab strip (a different collapse strategy than the primary sidebar's overlay — see
`navigation-model.md` for why).

## Where a record's detail lives

The detail drawer (`DetailDrawer.tsx`) is not a tenth view or a route — it's a right-hand
overlay that opens on row selection from Tree, Board, or Calendar, and closes through the same
unsaved-changes gate every deselection uses. It does not pair with My work, Portfolio,
Timesheets, Notifications, My calendar, or Mail — those either navigate away on selection
(`revealIssue` hops to Tree) or have no per-record detail concept at all.

## Standalone surfaces outside the shell

- **`/my-week`** — the one phone-first route. Mirrors the shell's own sign-in redirect but is
  otherwise a fully separate page, deliberately: the shell's dense grid has no phone-usable
  equivalent, so this is a purpose-built alternative surface for the same underlying
  time-recording data, not a responsive collapse of the shell.
- **`/signin`** — Entra sign-in.
- **Client portal packs** (weekly/monthly, print-ready) — rendered through `ClientPackView`,
  reached from the Export ▾ menu, not the sidebar — these are export artifacts, not navigable
  views.

## The rule this map exists to enforce

A new capability should be placed by asking: *whose question does it answer* (Your work /
Workspace / Records), *does it need the full grid* (a workspace view) *or a phone-usable form*
(a standalone route, like My week), *is it configuration* (a Configuration section) *or a
per-record detail* (the drawer). If none of those fit, that is the signal to reopen the design
— per Principle 10, "no screen should invent a new UI pattern unnecessarily" — before adding a
tenth thing to the sidebar.
