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
