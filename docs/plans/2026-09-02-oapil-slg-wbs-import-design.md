# OAPIL/SLG WBS import — operating-model config + issue import (design)

## Context

The live work tree (all `Issue` rows and everything hung off them) was wiped on 2026-09-01 to
make room for a fresh import from `OAPIL_SLG_PM_Tracker_STAGED.xlsx`, a 12-sheet program
tracker covering the OAPIL and SLG engagements. `HierarchyNode`, `Sow`, `Milestone`,
`ScopeItem`, the directory, rates, allocations, and `OperatingModel` all survived that wipe
untouched.

This design covers the first two of five phases the import needs. The workbook is genuinely
too large for one spec — it mixes work breakdown, a live issue log, a dependency map, a
risk/decision register, commercial utilization tracking, an effort-estimation calibration
sheet, and a timesheet log, each with a different shape and different target tables. Splitting
it lets each phase be checked against real imported data before the next is designed.

**Phase 1 — configure the operating model.** Add the work-type vocabulary this data needs.

**Phase 2 — import the WBS.** `OAPIL WBS` (117 rows) and `SLG WBS` (34 rows) — 151 rows total,
the work breakdown structure for both engagements — as issues (mostly), activities, approvals
and meetings under the existing hierarchy.

**Deferred to later phases, each its own design:**
- Phase 3 — `Client Issue Log (Live)` (39 rows, sourced from Outlook/Teams) — deferred so it
  can be reconciled against what Phase 2 imports, using the Duplicates screen shipped this
  session, rather than importing two overlapping issue populations blind.
- Phase 4 — `Issues & Risks` (20 rows) and `Decisions Required` (20 rows) as RAID risk/decision
  issues.
- Phase 5 — `Dependencies` (13 rows) as `IssueRelationship` (`BLOCKS`) — not `IssueDependency`,
  whose `predecessorId`/`successorId` reference `IssueActivity`, not `Issue`; these rows link
  WBS items directly.

**Out of scope entirely, not deferred:** `Commercial Utilization (OAPIL)` and
`Effort Estimation Framework` are reference/calibration sheets, not row-per-record import
material (the latter's "Primary Category" tag is used *within* Phase 2, as input, not imported
as its own record). `Timesheet Log` has no real data — one row explicitly marked
"EXAMPLE ROW — DELETE BEFORE USE" plus an all-zero monthly summary.

## Phase 1 — operating-model changes

Two new work types, added to `OperatingModel.model.workTypes` the same way every other work
type there is configured (id, label, `fromSource: true`, description):

- `WT_EPIC` — "Epic". 21 WBS rows are typed `Epic` and every other row's `Parent` chain
  eventually traces back to one of them (`Not Provided` parents are almost all Epics). This is
  the WBS's own top-of-chain concept, not a generic Task.
- `WT_DELIVERABLE` — "Deliverable". 5 rows — a concrete contracted output (a signed MSA, an
  executed Service Order), distinct enough from a generic Task to keep its own label rather
  than being flattened into one.

Everything else routes onto **existing** work types — `WT_TASK`, `WT_ISSUE`, `WT_RISK`,
`WT_DECISION`, `WT_DEFECT`, `WT_REQUEST`, `WT_CHANGE_REQUEST` — with the WBS's own word kept in
`Issue.sourceType`, the field that exists exactly for "what the source log called this, when
type was mapped onto another taxonomy." No other work type is added.

### New reducer capabilities (also Phase 1 — code, not just configuration)

Checking the actual write paths (not just the schema) for the three "model it properly" targets
below found three different situations, so three different fixes:

- **`IssueActivity`** has no free-form creation action — only `buildLifecycle`, which
  auto-generates a fixed 5-phase template from `issue.raised` and cannot reproduce a real WBS
  row's own title, dates or owner. **New action**: `{ t: 'addActivity', issueId, phase,
  isMilestone, plannedStartDate, plannedEndDate, owner, now }`, a new `case 'addActivity':` arm
  in `lib/workspace.ts` alongside `buildLifecycle`, gated on `lifecycle.build` (the same
  permission `buildLifecycle` already uses — this is the same authority, a different way of
  exercising it).
- **`Approval`** needs no new code — `requestApproval` already works against any configured,
  enabled `ApprovalRule`; there just isn't one for historical/imported approvals yet. **New
  config, Phase 1**: one `ApprovalRule` added to `OperatingModel.model.approvalRules` (e.g.
  `id: 'imported-historical'`, question something like "Historical approval — recorded for
  completeness, no live decision captured through this rule").
- **`Meeting`** hit a real data gap, not a missing action: `meetingProblem()` requires at least
  one resolved attendee, and this phase's own Owner-resolution is deferred (per the user's
  direction above), so every imported meeting would have zero attendees. Both sampled rows
  (`OAPIL-052`, `SLG-007`) DO have real `Planned Start`/`Planned Finish` dates, so only the
  attendee requirement is actually blocking — the time requirement isn't. **Scoped fix**:
  `meetingProblem()` takes an options argument, `{ requireAttendees?: boolean }`, defaulting to
  `true` — every existing call site (the UI's own meeting form, `case 'upsertMeeting':`) keeps
  today's behaviour unchanged; only the import path passes `requireAttendees: false`. This is a
  narrower change than the blanket relaxation first proposed: nobody using the app UI can create
  a meeting with no attendees after this, only the import script can, and only because it has no
  attendee ids to give it yet.

## Phase 2 — WBS import

### Type routing (151 rows, both projects)

| WBS `Type` | Count | Target |
|---|---:|---|
| Task | 55 | `Issue`, `type=WT_TASK` |
| Epic | 21 | `Issue`, `type=WT_EPIC` |
| Decision | 14 | `Issue`, `type=WT_DECISION` |
| Requirement | 8 | `Issue`, `type=WT_REQUEST`, `sourceType='Requirement'` |
| CHALLENGE | 6 | `Issue`, `type=WT_ISSUE`, `sourceType='CHALLENGE'` |
| Deliverable | 5 | `Issue`, `type=WT_DELIVERABLE` |
| Milestone | 5 | `addActivity{isMilestone:true}` (new) under its parent issue |
| Issue | 5 | `Issue`, `type=WT_ISSUE` |
| Development | 5 | `Issue`, `type=WT_TASK`, `sourceType='Development'` |
| Corrective Action | 5 | `addActivity` (new) under its parent issue |
| Dependency (Type column) | 4 | `Issue`, `type=WT_ISSUE`, `sourceType='Dependency'` |
| Risk | 3 | `Issue`, `type=WT_RISK` (`riskLikelihood`/`riskImpact` left null — not judged in the sheet) |
| Work Package | 2 | `Issue`, `type=WT_TASK`, `sourceType='Work Package'` |
| Defect | 2 | `Issue`, `type=WT_DEFECT` |
| Approval | 2 | `requestApproval` against the new `imported-historical` rule, `subjectId` = the parent issue |
| Meeting | 2 | `upsertMeeting` with `attendeeIds: []`, real `Planned Start`/`Finish` as `startAt`/`endAt` |
| Investigation | 2 | `addActivity` (new) under its parent issue |
| Change | 2 | `Issue`, `type=WT_CHANGE_REQUEST` |
| Testing | 2 | `Issue`, `type=WT_TASK`, `sourceType='Testing'` |
| Verification | 1 | `addActivity` (new) under its parent issue |

**Correction (found during implementation, not during design):** the counts above were
transcribed from two separate per-sheet tallies (OAPIL WBS and SLG WBS read independently) and
three were added wrong when combined — `CHALLENGE` (6, not 2), `Development` (5, not 1),
`Corrective Action` (5, not 6) — and one type, `Testing` (2 rows, both SLG, both real WBS work
items with a real `Parent` and no real dates), was missed entirely. `Testing` routes the same
way `Work Package`/`Development` already do: onto `WT_TASK` with the original label kept in
`sourceType`, since it's the same shape of thing — a task-like WBS row whose label doesn't
happen to match an existing work type. Confirmed against the real extracted data
(`data/wbs.raw.json`, all 151 rows, 20 distinct `Type` values, verified to sum to exactly 151)
rather than trusted from the design-time read. Total: 20 types, 151 rows.

Every one of the 17 rows routed to `addActivity`/`Approval`/`Meeting` (13 activities + 2
approvals + 2 meetings) has a real `Parent` set in the sheet (verified directly, row by row —
none are free-floating), so "attach to the parent issue" holds for all of them. This means the WBS's own row order matters for the import: a
row's parent must exist (as an already-created `Issue`) before the row itself is processed, so
the import walks the sheet in parent-before-child order (a topological pass over the `Parent`
column), not simple top-to-bottom.

### Hierarchy targeting

The existing OAPIL/SLG module tree (`module:OAPIL:Data Migration`, `module:OAPIL:Inventory`,
etc.) came from the `Client Issue Log`'s own "Module" column, a different and narrower
taxonomy than the WBS sheet's "Workstream" column (`Program & Commercial Governance`,
`Master Data & Data Migration`, `Procure-to-Pay`, `Plan-to-Produce`,
`Inventory & Warehouse Management`, `Order-to-Cash & Logistics`, `Record-to-Report`,
`Reporting & Analytics`, `Security, Access & Compliance`, `Asset Management`,
`Platform, Release & Test Automation` for OAPIL; `Inbound Logistics: Receiving & Transfers`,
`Order Fulfillment: Pick, Pack & Ship`, `Platform & Integration` for SLG). The two taxonomies
do not match well enough to force one onto the other.

**Decision: create new module nodes for the WBS's own workstream taxonomy**, under the existing
`project:2` (OAPIL) and `project:3` (SLG) nodes, alongside — not replacing — the existing
Client-Issue-Log-derived modules. Each WBS row's top-level workstream name (the part before the
parenthetical, e.g. `Master Data & Data Migration` from
`Master Data & Data Migration (AX2012 to D365 Migration)`) becomes one new module; the
parenthetical sub-label is not a separate node, it is preserved verbatim in `Issue.description`.

A top-level WBS row (`Parent = 'Not Provided'`) gets `nodeId` = its workstream's new module.
A child row (real `Parent`) gets `parentIssueId` = the parent's issue id and no `nodeId` — the
schema statement "either under a hierarchy node, or under another issue — never both" is
followed exactly.

**Correction (found during implementation):** only root rows' workstream names become modules
— 9 for OAPIL and 3 for SLG (12 total), not the 11+3=14 estimated above by listing every row's
`Workstream` regardless of root/child status. Two of the listed OAPIL workstreams,
`Procure-to-Pay` and `Order-to-Cash & Logistics`, turn out to appear only on non-root rows
(5 `Task` rows nested under `OAPIL-010`, a `Program & Commercial Governance` epic) — those rows
attach via `parentIssueId`, never `nodeId`, so nothing ever needs a module under either label.

**Correction (found during implementation):** one issue-shaped row's `Parent` points at a row
that isn't issue-shaped — `OAPIL-154` (`Task`)'s `Parent` is `OAPIL-151` (`Milestone`), and
`Issue.parentId` may only be a hierarchy node or another *issue*, never an activity. The
transform walks past non-issue-shaped ancestors to the nearest real issue (`OAPIL-150`, the
epic both ultimately belong to) rather than passing the raw `Parent` value through unchecked —
confirmed to be the only such row in the real data.

**Correction (found during implementation, resolved by the user):** 24 root rows (mostly Epics)
have no `Planned Start` at all, and no ancestor to inherit one from either — a real conflict
with `Issue.raisedDate` being required and this workbook's own stated convention ("Not Provided
/ To Be Confirmed — used wherever the source material does not state a value. Never invented.").
Resolved by explicit user direction: those 24 default to the import's own run date, flagged in
the issue's description as a default rather than a stated fact, never silently indistinguishable
from a real one.

### Status mapping

`ISSUE_STATUSES` (`lib/types.ts`) is documented as closed vocabulary — "we do not invent new
ones" — 7 values: `Open`, `In Progress`, `Needs clarification`, `Awaiting client confirmation`,
`Closed - confirmed`, `Closed - no defect`, `Superseded`. The WBS sheet's 14 raw status strings
best-fit onto these:

| Raw WBS status | → |
|---|---|
| New, Planned, Ready | `Open` |
| In Progress, UAT, Testing, Under Review, Blocked, Waiting | `In Progress` |
| Completed | `Closed - confirmed` |
| Closed | `Closed - confirmed` |
| Open | `Open` |
| Pending Approval, Submitted — Awaiting OAPIL Confirmation | `Awaiting client confirmation` |

The original raw string is never silently dropped: it is appended to the imported issue's
description (`"Source status: <raw value>"`), since `sourceType` is already spent on WBS
`Type`, not `Status`.

### Person and discipline resolution — deferred to a later action

Per the user's direction mid-design: `Owner` and `Discipline` are **not** resolved during this
import. `Owner` is written as raw text exactly as the sheet has it (including compound cells
like `"Michael Thomas (POS) / Amolak (D365)"`), `ownerId` stays `null` on every row, and
`Discipline` is left unclassified (`''`) on every row. Both get set correctly in a follow-up
action after this import lands, once there is real imported data to assign them against rather
than an import-time guess. This import does not read the `Effort Estimation Framework` sheet
at all, and does not attempt directory name-matching.

`Client Stakeholder` has no dedicated field on `Issue` regardless, and is folded into the
description text as before.

### What Phase 2 explicitly does not do

- No de-duplication against a second data source — the `Client Issue Log` (Phase 3) is the
  only other issue-shaped sheet, and it is deferred specifically so this phase's own output
  exists as something to reconcile against, rather than importing two populations blind.
- No `IssueDependency`/`IssueRelationship` records from the WBS's own `Dependency` column
  values (4 rows typed `Dependency`) or the separate `Dependencies` sheet — both are Phase 5.
- No `TimeEntry` rows — there is no real timesheet data to import.
- No changes to `Sow`, `Milestone` (the commercial model), `ScopeItem`, or `ChangeRequest` —
  all untouched by the wipe and untouched by this phase.

## What would send this design back

- If a WBS row's `Parent` value does not resolve to another row already processed in the same
  sheet (a cycle, or a reference to a row that does not exist) — the topological-order
  assumption this design depends on would be wrong, and the actual shape of the `Parent` column
  would need re-examining before import, not patched around row by row.
- If the new module nodes created for the WBS workstream taxonomy turn out to need merging with
  the existing Client-Issue-Log-derived modules once Phase 3 is designed — better to find that
  out before Phase 3 is built on top of two separate, un-reconciled module sets, than after.
- If `addActivity` turns out to need more validation than "the parent issue exists and the actor
  holds `lifecycle.build`" once real rows are run through it (e.g. a phase name colliding with
  an existing activity, or a milestone date that precedes the issue's `raisedDate`) — surfaced
  by the scenario the plan writes for it, before it is wired into the import script, not after.
