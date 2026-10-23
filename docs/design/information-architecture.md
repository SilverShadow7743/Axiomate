# Axiomate Information Architecture

**Status:** Proposal — a map of what's where and why, refreshed as of commit `c8e138b`
(2026-09-20) to add Resourcing, Commercial, Milestones and the Career levels Configuration
section, none of which existed when this was first written against commit `b09fb75`
(2026-09-11, the F&O page-grammar work), itself built against the clean shell
(`92a2fe5`–`adc8645`, 31 Aug). See `navigation-model.md` for the interaction specs of the
patterns named below, and `screen-inventory.md` for the flat enumeration of every screen.

## The shape of the app

One shell (`IssueWorkspace.tsx`) hosts sixteen navigable **views**. For an internal actor,
fourteen are reached through the left sidebar and a fifteenth, notifications (`inbox`), is an
action centre reached from the bell in the top bar — the one place the "rail navigates, top bar
acts" split is crossed on purpose (12 Sep 2026: "inbox is just notification"). A client actor
sees a four-item sidebar instead (Tree, Board, Calendar, Milestones); Milestones is the
sixteenth view and is reachable only from that reduced sidebar, never from the internal one.
Three things sit outside the shell entirely: `/my-week` and `/intake/form/[token]` (standalone
routes) and Configuration (a full-screen overlay reached from the account menu, with its own
internal navigation). A detail drawer overlays any list-shaped view to show one record without
leaving it, and a FactBox blade can open beside that record.

```
Top bar (actions)
├── 🔔 Notifications     → view: inbox (badged with unread count)
└── account menu         → My profile · Appearance · Configuration · Archive · Sign out

AppSidebar (places) — internal actor
├── My work
│   ├── My work        → view: mywork      (workspace: tiles above the ranked list)
│   ├── My calendar     → view: mycalendar
│   └── My to-dos       → view: mytodos     (private; per-owner redaction)
├── Workspace
│   ├── Tree             → view: tree      (+ DetailDrawer on selection)
│   ├── Board            → view: board     (+ DetailDrawer on selection)
│   ├── Calendar          → view: calendar (+ DetailDrawer on selection)
│   ├── Portfolio        → view: portfolio  (workspace: score tiles above the concern lines)
│   ├── Resourcing       → view: resourcing (workspace: 4 tiles above a table; requires `capacity.allocate`)
│   ├── Applications     → view: applications (+ its own DetailDrawer)
│   └── Analytics        → view: analytics
├── Records
│   ├── Timesheets       → view: timesheet
│   ├── Mail             → view: mail
│   ├── People           → view: people (internal actors only)
│   └── Commercial       → view: commercial (4 sub-tabs; requires `rate.view`)
└── Saved views           (team-shared, apply sets filters + view together)

AppSidebar (places) — client actor (`CLIENT_GROUPS`)
└── Workspace
    ├── Tree            → view: tree
    ├── Board           → view: board
    ├── Calendar        → view: calendar
    └── Milestones      → view: milestones  (client-only; bounces an internal viewer to My work)
```

Configuration (a full-screen overlay with its own rail, 31 sections / 3 groups) and Archive
(a drawer) are reached from the account menu, not the rail. They sat at the rail's foot until
12 Sep 2026; the account menu had carried both all along, so the foot was a second entry point
to the same two places — the very duplication the rail's own rule forbids.

`/my-week` is reached from the sidebar too, as a route rather than a view. A client actor
sees a reduced sidebar: Tree, Board, Calendar and Milestones (`CLIENT_GROUPS` in
`AppSidebar.tsx`) — four items, not three; Milestones is the one view that exists only on this
sidebar and never on the internal one.

## The sidebar's four groups, and why they're grouped that way

Grouped by **whose question each place answers**, not by how the code renders them
(`AppSidebar.tsx`'s own top comment states this explicitly):

- **My work** — "what's waiting on me, personally." My work (badged with a live count), My
  calendar, My to-dos. Notifications used to sit here as "Inbox"; they are the top bar's bell
  now, because a notification is a prompt to act, not a place to be.
- **Workspace** — "what does the delivery look like." Tree, Board, Calendar, Portfolio — four
  ways of viewing the same underlying issue/schedule data — plus Applications (what each client
  runs) and Analytics (cross-tabs over the register).
- **Records** — "what happened / what's on file." Timesheets, Mail, People.
- **Saved views** — team-shared filter+view combinations, not a fifth semantic group so much as
  a personalization layer over Workspace.

The active item derives from the current `view` state, never from local component state —
notification deep-links, search-hit clicks and My work's tiles change `view` externally, and
the rail follows without needing to be told separately. This is a structural rule, not a
convenience: any new navigation entry point MUST change `view`, never bypass the sidebar's own
state.

## The sixteen workspace views

| View key | Sidebar label | Purpose | Pairs with the drawer? |
|---|---|---|---|
| `mywork` | My work | Everything waiting on you, across every engagement, grouped by reason (decide/overdue/blocked/attest/due/open); summary tiles above — the workspace's own counts open the Tree narrowed, your reason counts scroll to the group | No — opens via `revealIssue`, navigates to Tree |
| `mycalendar` | My calendar | Your own month — events, leave, allocation, your own due dates | No |
| `mytodos` | My to-dos | Your own to-dos — mail that wasn't project work, and anything you note for yourself; never visible at org level | No |
| `inbox` | (top-bar bell, "Notifications") | What needs a decision, what you're waiting on, and what the rules have told you | No |
| `tree` | Tree | The full structure with the timeline (Gantt) beside it; quick filter above, subject is the link | Yes |
| `board` | Board | Status lanes — drag a card to move it; quick filter above | Yes |
| `calendar` | Calendar | Due dates on a month grid, undated on a rail; quick filter above | Yes |
| `portfolio` | Portfolio | Every engagement at once — a score tile each (band, value, printed terms) above the counted concerns | No |
| `resourcing` | Resourcing | Who is allocated where against actual hours, across every project at once; 4 summary tiles, requires `capacity.allocate` | Yes — a person's name opens `ProfilePanel` |
| `applications` | Applications | What each client runs and how it connects; local quick filter, name is the link | Its own `DetailDrawer` |
| `analytics` | Analytics | Firm-wide cross-tabs over the live register — severity, client, age, owner | No |
| `timesheet` | Timesheets | Your week, gathered; the approval queue if you hold `time.approve` | No |
| `mail` | Mail | "Your inbox" (delegated Mail.Read, per-session) plus the intake mail log | No |
| `people` | People | Every colleague in the directory; local quick filter, name opens the profile | No — opens `ProfilePanel` |
| `commercial` | Commercial | Every statement of work at once — 4 sub-tabs (All SOWs / Overdue milestones / Unpaid invoices / At-risk margin), requires `rate.view` | No |
| `milestones` | Milestones | What was promised, when it lands, where it stands — client-facing only, reached from the reduced client sidebar | No |

Only Tree, Board, and Calendar pair with the Filters chip (`FiltersHeader.tsx`) — they're the
three views that actually receive the filtered row set, and the quick filter in the chip's row
is bound to the same `filters.search` the top bar's global search feeds (one state, two
inputs). The other thirteen compute their own lists and correctly show no filter row at all (a
control that does nothing must not be shown — see `component-standards.md`'s Forms section);
People, Applications, Resourcing and Commercial each carry a *local* quick filter of their own,
which narrows nothing outside them.

## Configuration — 31 sections, 3 groups

Configuration is reached from the account menu but is architecturally separate: a full-screen
overlay (`.cfg`, `position: fixed`) with its own left rail, not a seventeenth workspace view.
Its sections, grouped exactly as defined in `ConfigWorkspace.tsx`, with five Operating-model
sub-groups the rail renders as headings (Vocabulary & classification, Roles & people, Rules &
permissions, Estimation & capacity, Templates):

**Operating model** (21 sections) — All settings (index/landing), Terminology, Work types,
Disciplines, Skills, Career levels, Custom fields, Responsibilities, Roles & people,
Capabilities, Status transitions, Permissions, Approvals, Automation rules, Scheduled pass,
T-shirt sizing, Time recording, Allocation, Service levels, Activity templates, Issue
templates.

**Governance** (6 sections) — Goals, Health score, Rates, Blueprints, Scope overrides,
Duplicates. Health score sits here rather than in Operating model on purpose: its weights are
printed in client packs, so they are a commercial statement, not a tuning knob.

**Automation** (4 sections) — Agent registry, Recurring work, Workflows & templates, Routing &
intake.

The "All settings" section is the discoverability entry point — a new admin lands there rather
than having to scan 30 rail entries cold. Under 900px, the rail collapses to a horizontal
scrolling tab strip (a different collapse strategy than the primary sidebar's overlay — see
`navigation-model.md` for why).

## Where a record's detail lives

The detail drawer (`DetailDrawer.tsx`) is not a view or a route — it's a right-hand overlay
that opens on row selection from Tree, Board, or Calendar, and closes through the same
unsaved-changes gate every deselection uses. Inside it the record is an F&O details page:
`ID : Subject` as the title, status pinned upper-right, one primary action (the suggested
status transition), and the former tab strip as single-open FastTabs with a summary on each
header. A **FactBox blade** (`FactBoxBlade.tsx`) can open at the drawer's right edge with the
record's related information — Owner and Schedule cards, Related records and Recent activity
grids — every figure an existing pure function's output; the drawer widens to hold it rather
than narrowing the page.

The drawer does not pair with My work, Portfolio, Timesheets, Notifications, My calendar, My
to-dos, Analytics, Mail, Commercial or Milestones — those either navigate away on selection
(`revealIssue` hops to Tree) or have no per-record detail concept at all. Applications and
Resourcing are the two other views that use `DetailDrawer` directly: Applications for its own
`ApplicationDetail`, Resourcing for `ProfilePanel` (a person's name opens their own page, the
same drawer People already opens).

## Standalone surfaces outside the shell

- **`/my-week`** — one of two phone-first routes. Mirrors the shell's own sign-in redirect but
  is otherwise a fully separate page, deliberately: the shell's dense grid has no phone-usable
  equivalent, so this is a purpose-built alternative surface for the same underlying
  time-recording data, not a responsive collapse of the shell.
- **`/signin`** — a full custom two-column page (a claims panel plus "Continue with
  Microsoft"), not a bare redirect with no UI of its own.
- **`/intake/form/[token]`** — the other phone-first route: an unauthenticated public form
  (name, email, subject, description, urgency) that files straight into the register. Loads
  nothing from the workspace; the token is validated only on submit.
- **Client portal packs** (weekly/monthly, print-ready) — rendered through `ClientPackView`,
  reached from the Export ▾ menu, not the sidebar — these are export artifacts, not navigable
  views. Both carry the engagement health score with its terms printed and its exclusion
  (over-commitment — staffing is not shown to clients) stated beside it.

## The rule this map exists to enforce

A new capability should be placed by asking: *whose question does it answer* (My work /
Workspace / Records), *does it need the full grid* (a workspace view) *or a phone-usable form*
(a standalone route, like My week), *is it configuration* (a Configuration section), *a
per-record detail* (the drawer) *or related, read-only context for that record* (the FactBox
blade). If none of those fit, that is the signal to reopen the design — per Principle 10, "no
screen should invent a new UI pattern unnecessarily" — before adding a fourteenth thing to the
sidebar.
