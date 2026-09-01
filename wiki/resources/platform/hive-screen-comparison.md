---
type: resource
title: "Hive screen-by-screen comparison"
created: "2026-08-31"
tags:
  - resource
  - competitive
---

# Hive screen-by-screen comparison

A different axis from [[hive-comparison]]'s 40-row feature/pricing analysis: for each real
Axiomate screen, what actions does it actually offer, and what does Hive's closest equivalent
screen actually offer. Both sides are evidence-grounded, not inferred:

- **Axiomate side**: read directly from the components (`components/*.tsx`), not from any
  design doc — cited by file where it matters.
- **Hive side**: fetched 2026-08-31 from hive.com's own product pages and `help.hive.com`'s
  documentation — the only source that documents actual UI actions rather than marketing
  copy. Where Hive's own docs don't specify a detail, that's stated as a gap in the research,
  not filled in with a guess.

## The record/task detail — the single most important comparison

| | Axiomate `DetailPanel.tsx` | Hive action card |
|---|---|---|
| Structure | 8 tabs (already consolidated from 12 this session's own audit found — see the layout plan) | One scrolling card: right-column fields + top nav + body |
| Core fields | Status, owner, severity, dates — all in a persistent, editable field strip visible from every tab | Assignee, due date, status (color-coded), estimated time, "Schedule time" (blocks calendar) |
| Discussion/comments | Discussion tab (threaded, real-time) | Comments section, @mentions, `@action`/`@project` shortcuts |
| Notes | Notes tab + "Write a reply" entry point | Not on the card itself — separate Hive Notes module |
| Time | Time tab: Quick record + Weekly grid modes, this session's meeting-derived suggestions | Automatic time logging per card, manual entry, estimated-vs-actual |
| Schedule/dependencies | Schedule tab: schedule fields + Lifecycle activities + Resolution Path (critical path) as sections | Dependencies set from Gantt view, not the card; no critical-path computation documented |
| Relationships/evidence | Links tab: Relationships + Evidence sections | "More Menu" (convert, template), attachments in comments — no distinct relationship graph |
| Audit trail | History tab: full, permanent, every field change | "Show history" option — documented as present, depth unspecified |
| Subtasks | `activityId`-scoped time entries within one issue; no full "task-within-task" recursion | Subactions — genuinely recursive ("subactions for subactions"), each with its own assignee/dates/description |
| Governance | Every write funnels through the same permission/audit/status-transition reducer, no exceptions | Card-level lock ("Lock proof" is proofing-specific), no evidence of a workspace-wide transition graph |

**Read**: Hive's card is broader in casual collaboration surface (chat-adjacent comments, richer
mention shortcuts, genuine subaction recursion). Axiomate's tab is deeper in governed structure
— the same field strip, the same audit trail, the same permission funnel, on every record, with
no second path around it. Subactions are a real gap: Axiomate's task-level time entry
(`activityId`) doesn't give a task its own assignee, dates, or nested children the way Hive's
subactions do.

## Board / Status view

| Action | Axiomate `BoardView.tsx` | Hive Status/Kanban view |
|---|---|---|
| Drag between lanes | Yes, with a pre-check (`dropOutcome`) refusing illegal transitions in the policy's own words | Yes, documented as simple drag-and-drop |
| Bulk move | Not found in `BoardView.tsx` | CTRL/COMMAND multi-select, drag together — documented |
| Keyboard/touch path | **Move ▾** menu per card, this session added Escape/outside-click dismissal | Not documented in Hive's own help article — the article covers drag-and-drop only |
| Reason capture | Every status change collects a reason (`board-ask` dialog) — no exceptions | Not documented as required |
| Custom lanes | Governed by the tenant's configured `StatusPolicy` transition graph | "Edit status columns," add statuses beyond the default three (unstarted/in progress/completed) |

**Read**: Hive documents bulk multi-select, which Axiomate's Board doesn't have. Axiomate
requires a reason on every move and pre-checks the transition against policy before it's
attempted — Hive's own documentation doesn't mention either.

## Portfolio / cross-project view

Hive has a screen with almost the same name and stated purpose — worth a direct look.

| | Axiomate `PortfolioPanel.tsx` | Hive Portfolio View |
|---|---|---|
| Purpose (Hive's own words) | "which of these needs me" | "the detail of Project Navigator combined with the flexibility of a Table View" |
| Shape | Named, counted concerns per engagement (overdue/forecast/**capacity**/blocked/unowned/stale) — no score | Table of actions across projects: status, due dates, completion checkmarks |
| Capacity | **This session's addition**: names who is over-committed and by how much, workspace-wide, with a drill-down (`ReplanningDrawer`) into decision-support (deficit + every overlapping allocation, no number picked automatically) | Resourcing is a separate module (below), not part of Portfolio View itself |
| Drill-down | Click an engagement to open it in the tree; click the capacity concern to open Replanning | Click into an action from the table |

**Read**: same name, different design philosophy. Hive's Portfolio View is a wider table (more
actions visible at once, more like a spreadsheet). Axiomate's is a concern-first summary — six
named claims per engagement, checkable, ranked by argument rather than alphabetically or by
raw count. Neither is strictly more capable; they answer the question differently, and
Axiomate's explicitly refuses to compress the six concerns into one number, which Hive's table
view doesn't attempt to either (it just doesn't summarize at all).

## Time tracking / Timesheets / Resourcing

| Action | Axiomate | Hive |
|---|---|---|
| Record time | `MyWeek.tsx` / `TimeTab.tsx`, day-by-day, activity-tagged, billable flag | Automatic per-card logging + manual entry |
| Submit | Explicit **Submit week** action, freezes the week | "Timesheet submissions" — explicit process documented, mechanics unspecified |
| Approve | `TimesheetPanel.tsx`: batch **Approve all**, per-sheet Approve/Return with a reason | Not detailed in Hive's own time-tracking page — described only as "team/organizational level" submission |
| Suggestions | **This session's addition**: meeting-derived, pre-filled-but-confirmed suggestions (`meetingSuggestions()`) — a real fact (meeting duration), never invented | Not found — Hive's time tracking is manual entry or automatic logging while working, not suggestion-based |
| Capacity/resourcing | **This session's addition**: Automatic Resource Replanning — the deficit + every overlapping allocation for an over-committed person, decision-support only | "Set working hours... add placeholders... assign by project," workload-based reassignment — Hive's own page explicitly doesn't detail over-allocation warnings or reassignment mechanics |
| Utilization reporting | `lib/utilisation` (not directly explored this pass) | "View team utilization and optimize work" — documented as a capability, UI unspecified |

**Read**: this is the area with the least head-to-head Hive documentation depth — their own
help content describes resourcing conceptually without detailing warnings, reassignment flows,
or approval mechanics. Axiomate's side is fully specified because it's read from real code. Two
of Axiomate's three additions this session (meeting-derived suggestions, capacity replanning)
have no documented Hive equivalent at all.

## Forms / intake

| | Axiomate `lib/intake.ts` + `app/api/intake` | Hive Forms |
|---|---|---|
| Field types | Free-text subject/body from mail, or a structured intake form (`app/api/intake/form`) | 10 documented field types: checkbox group, date (with min/max), file upload, header, paragraph, radio group, text field/area, ruler, multi-text |
| Classification | Keyword/regex severity guess (`HIGH_WORDS`/`LOW_WORDS`), reported as `stated`/`guessed`/`default` — never silent | Not classification — routing is explicit (map fields to project/action fields) |
| Routing | Mailbox → scope, `RoutingRule`s in configured order | Conditional actions based on form-field criteria, sub-action creation, new-project creation |
| Duplicate handling | `duplicateGroups()` — a report to review, not auto-merged (found this session to be a standalone script, not wired to a screen) | Not found in Hive's documentation |
| Draft/publish/archive states | Not present on Axiomate's intake config | Forms have explicit Draft/Published/Archived states |

**Read**: Hive's form field-type library is richer (10 typed fields vs. Axiomate's largely
free-text intake). Axiomate's classification honesty (never silently deciding, always tagging
`guessed`) has no stated Hive equivalent — Hive's routing is deterministic field-mapping, not a
severity guess, so the comparison isn't quite apples-to-apples: Hive doesn't need to guess
because its forms are structured at submission time, while Axiomate's mail-based intake has to
interpret free text.

### Form builder / layout — the deeper cut

Fetched 2026-09-01 from `help.hive.com/en/articles/802410` (Hive Forms) and `.../2873120`
(Dynamic Fields). Axiomate side re-read directly from `app/api/intake/form/route.ts`.

**Hive's builder**: a drag-and-drop toolbox onto a canvas — Hive's own article doesn't specify
the toolbox's screen position or the canvas layout in enough detail to state as fact (stated as
a gap in the research, not filled with a guess, per this doc's own rule), only that fields are
dragged in and a settings panel sits at the bottom of the page. The toolbox's ten field types,
named: Checkbox Group, Date Field, File Upload, Header, Paragraph, Radio Group, Text Field
(single or paragraph), Text Area, Ruler, Multi-text. Each field can be marked required, given
help text, and (for text fields) a max length.

**Hive's Dynamic Fields** — four types, no Axiomate equivalent at all:

| Dynamic field | What it does |
|---|---|
| Dynamic Users | Dropdown limited to the target project's own members; "Map to action assignee" auto-assigns the submitted person to the created card, who is then notified |
| Dynamic Projects | "Map to project" places the card in the chosen project; "Map to linked projects" creates it elsewhere but links it — the form owner must already be a member of any project offered |
| Dynamic Labels | Submitter picks from an admin-scoped label set; the card receives it automatically |
| Dynamic Priorities | Submitter picks from the workspace's real priority list; the answer maps straight onto the card's priority field |

**Hive's routing**: a submission can create an action card, a sub-action nested under a parent
card, or a new/updated project — gated by an explicit "Only create this action IF" condition
against form-field criteria. **Lifecycle**: Save keeps a form in Draft (edits not live); Publish
saves and publishes the latest version; Archive is admin/form-owner only, and a submitter who
reaches an archived form's URL sees "the form is unavailable" rather than the form itself.

**Axiomate's real shape**: not a form-*building* system at all — `app/api/intake/form/route.ts`
is one fixed schema, five hardcoded fields (`name`, `email`, `subject`, `description`, `urgency`
— the last capped to `'urgent' | 'low' | 'normal'`), no toolbox, no field types to choose, no
per-form Draft/Published/Archived lifecycle, no dynamic mapping to assignee/project/label/
priority. There is exactly one form shape a deployment can offer, not many a firm designs.

**What Axiomate has that this comparison didn't surface until now**: a real security property
Hive's own docs never claim. The route's own comment states it plainly — "an unknown token and
a disabled form produce the SAME refusal — status, body and shape identical — so probing the
URL space reveals nothing about what exists." Hive's Archive behavior ("the form is
unavailable") is asymmetric with an invalid link by comparison — Hive's own docs don't state
whether an archived form's message is indistinguishable from a token that never existed.

**Read**: this is a sharper version of the same finding one level up — not "Axiomate's forms are
less rich," but "Axiomate has no form *builder* at all, only one form." Whether that is a real
gap depends entirely on whether this firm needs more than one intake shape (a bug report vs. a
change request vs. a new-engagement kickoff, say) — worth checking with whoever owns intake
before adding it to any steal-list, the same caution [[hive-comparison]] already applies to
project-level description/attachments.

## The personal landing screen — My Work vs. Hive Home

| | Axiomate `MyWorkPanel.tsx` | Hive Home |
|---|---|---|
| Default landing | Unconditional (`IssueWorkspace.tsx:702-705`, this session) | Documented as the default entry point, replacing the older "My Actions View" |
| Content | Reason-ranked work list + a Today meetings section | "My Actions" widget (filterable/sortable), "My Projects," "People," "Scratch Pad" |
| Customization | None — the ranking is computed, not arranged by the user | Add/remove widgets, background/greeting color themes, per-user personalization |
| Quick capture | Not on this screen | "What needs to be done?" quick-add box |
| Interaction | Click-through only — no create/edit/filter controls on the screen itself | Filterable/sortable "My Actions" widget in place |

**Read**: real, honest gap. Hive Home is a **customizable dashboard** — the user arranges
widgets, picks colors, adds a scratch pad. Axiomate's My Work is **deliberately uncustomizable**
— a computed, reason-ranked list with no arrangement controls, matching `lib/portfolio.ts`'s
own stated philosophy across this whole codebase ("name the concerns... let the reader do the
weighing" — applied here as "the system ranks, you don't have to arrange"). Whether that's a gap
or a feature depends entirely on which philosophy a firm wants; it is a genuine design
difference, not an oversight.

## Project setup and configuration

Fetched 2026-09-01 from `help.hive.com/en/articles/457193` (project creation) and
`.../2817692` (Overview page) — Axiomate side read from `lib/workspace.ts`'s `HierarchyNode`
and `components/ConfigWorkspace.tsx`.

| | Axiomate `HierarchyNode` (a "project") | Hive project setup |
|---|---|---|
| Fields on the node itself | `id, kind, name, parentId, owner, sowId, deletedAt` — that's all | Name, color, description, custom fields (text/dropdown, for type/tier/priority), attachments, notes |
| Access model | Role + permission (`can()`), same funnel as everything else; no per-project visibility choice | Set per project at creation: **Everyone**, **Specific people**, or **Private to me** — plus a separate toggle for whether members may edit membership |
| View type | One structure (tree + Gantt-style timeline pane), same for every project | Chosen per project at creation from seven: Status, Team, Calendar, Label, Gantt, Table, List |
| Notify on creation | Not a project-level concept | "Notify users" checkbox |
| Draft/staged rollout | Not present | "Draft Mode" — assign work before announcing the project |

**Read**: this is a real, structural gap, not a styling one. A project in Axiomate is a thin tree
node — everything richer (description, notes, attachments, custom classification) lives on
*issues*, never on the project itself. Hive's project is a first-class object with its own
content. Whether Axiomate needs project-level description/attachments depends on whether "what
is this engagement's project actually for" currently has nowhere to live and is being improvised
in an issue's description instead — worth checking with whoever runs engagements before treating
this as a gap to close.

## Project Overview page

Hive's page, in the order documented: Status (color-coded On-track/Off-track/On Hold/At risk,
with history), Activity Feed, Files (aggregated from cards+comments), custom-field Project
Information, Description, Attachments, Notes, a %-complete dashboard, a Budget Overview
("Billable hours budget" against submitted timesheets), and an export (download) icon.

| Hive Overview section | Axiomate's equivalent | Where |
|---|---|---|
| Status (manually set, color-coded, historied) | Computed, not set: `scheduleHealth` per issue, and Portfolio's six named concerns (overdue/blocked/unowned/stale/**capacity**/planImpossible) per **engagement** — no single manually-declared project-level status | `lib/portfolio.ts` |
| Activity Feed | Per-*record* History tab only (`lib/workspace.ts`'s audit log, filtered per issue). No project-wide aggregate feed. | `DetailPanel.tsx` |
| Files / Attachments | Per-record `Evidence`/document storage (Links tab), no project-level aggregation across every issue under it | — |
| Custom fields / Description / Notes | None on the project node itself (see table above) | — |
| % complete dashboard | Portfolio's per-engagement counts are the closest analogue, one tier up from project | `lib/portfolio.ts` |
| Budget Overview (billable hours vs. budget) | `sowCostOf()` + `SowPosition` — SOW-level cost/margin/variance shown in `CommercialPanel.tsx`, gated behind `rate.view` — **this session's own rate/margin rollup work** | `lib/rates.ts`, `lib/sow.ts` |
| Export | Workspace-level only: **Export ▾** in the top bar offers Daily IMS and weekly/monthly client packs (`IssueWorkspace.tsx:1969-2000`), not a per-project overview export | — |

**Read**: Axiomate's Budget Overview equivalent is real and already shipped (this session), and
arguably more honest — it's `null` entirely for a viewer without `rate.view` rather than hidden
after being computed. Everything else on Hive's Overview page that isn't financial has no
project-scoped home in Axiomate today; it exists, if at all, scattered per-issue or one tier up
at the engagement.

## Snapshots / Baselines — the one Hive concept with no real Axiomate equivalent

Fetched 2026-09-01 from `help.hive.com/en/articles/2889473`. A Hive **Baseline** is "a snapshot
of what was planned before beginning a project": planned start/end date per work item, plus
"budget definitions, totals, and other cost details at the time." Taken manually from the Gantt
view, multiple per project, compared against current state via a "View baseline" dropdown on
Overview, and exported with "Planned Start Date and Planned End Date from the most recent
baseline" as columns.

Axiomate's nearest concept is a false friend, not a match: `Estimate.baselinedAt`
(`lib/estimation.ts`) is **per-issue**, agreed once, and locks *effort* — a later material change
needs a reason and is recorded as a revision (`lib/workspace.ts:3841` refuses a silent
re-baseline). `lib/sow.ts`'s `sowPosition()` sums `effortVariance()` across a SOW's baselined
issues into `varianceHours`/`varianceIssueCount` (this session's rate/margin rollup). Both are
real and proven (`RT1`), but neither is what Hive's Baseline is:

- Hive snapshots **dates** (planned start/end per item) — Axiomate's baseline only ever
  concerned effort/hours, never dates. There is no "what did we say the schedule looked like
  before we started" record anywhere in this codebase.
- Hive snapshots at the **project** level, once, covering every item under it in one action —
  Axiomate's baseline is set **per issue**, one at a time, as a side effect of agreeing that
  issue's estimate.
- Hive keeps **multiple** named snapshots per project for comparison — Axiomate keeps exactly
  one baseline state per issue (the agreed estimate); there is no history of "what we thought
  three snapshots ago."

**Read**: this is the strongest, most specific finding in this whole comparison. Not "Axiomate
has a smaller version of Hive's feature" — it genuinely does not have a project-level,
date-and-budget point-in-time snapshot at all. Worth its own brainstorm if a real need surfaces
("what did the plan look like when the client signed off, versus now") — the domain model to
build it on is not obviously right yet (per-issue estimates aren't structured to roll up into a
single project-wide, repeatable, dated snapshot without new modeling), so this is a candidate to
scope carefully, not a quick extension of `baselinedAt`.

## What Axiomate has that Hive's own documentation doesn't mention

- Reason-required status transitions, checked against a configured policy before the drag/move
  is even attempted (Board).
- A permission funnel with zero exceptions — no screen or action bypasses `commitCell`'s single
  path.
- Meeting-derived timesheet suggestions and capacity-deficit decision-support (this session) —
  no equivalent found anywhere in Hive's product pages or help docs.
- Classification honesty (`stated`/`guessed`/`default`) surfaced on every intake record.
- A full permanent audit trail on every record, not scoped to proofing/approval rounds.

## What Hive has that Axiomate doesn't

- Genuinely recursive subactions (a task within a task within a task), each with its own full
  field set — Axiomate's task-level time entry has no equivalent structure.
- A dedicated proofing/approval surface with markup tools (drawing, stamps, measurement,
  video-timestamp comments) — Axiomate has nothing comparable; this was already named as an
  open item in [[hive-comparison]]'s steal-list ("visual proofing markup").
- Bulk multi-select drag on the board.
- A customizable personal dashboard (Home) vs. Axiomate's deliberately fixed, computed My Work.
- Richer structured form field types (10 documented types vs. Axiomate's largely free-text
  intake).
- A form Draft/Published/Archived lifecycle.

## Related

- [[hive-comparison]] — the 40-row feature/pricing analysis this complements
- `docs/plans/2026-08-22-hive-layout-attention-plan.md` — the layout-grammar comparison and its
  now-closed status
