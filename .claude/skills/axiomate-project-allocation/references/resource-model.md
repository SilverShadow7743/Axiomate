# The Real Resource Model

Grounded in `prisma/schema.prisma`, `lib/workspace.ts`, `lib/availability.ts`,
`lib/timeWindow.ts`, `lib/timesheet.ts` as of 2026-08-31.

## Allocation — project capacity

`Allocation` (`schema.prisma:621-643`): `projectId` (required, FK to `HierarchyNode` via the
`"ProjectAllocation"` relation — always a project-tier node, never a work item), `person:
String` (the historical join), `personId: String?` (nullable — the known gap), `startDate`,
`endDate`, `percentage: Int`, `note`. Reducer: `upsertAllocation`/`removeAllocation` in
`lib/workspace.ts`, wired through `IssueWorkspace.tsx`'s `onAllocate`/`onRelease`.

## ProjectMember — project access, not capacity

`ProjectMember` (`schema.prisma:651-670`) — a role-bearing access record, explicitly documented
in-schema as answering a DIFFERENT question from `Allocation`. `personId` is required (not
optional) — a row that can't resolve to a directory id is an access-control fact nothing will
ever match, so it can't be allowed to exist unresolved the way `Allocation.personId` can.
Reducer: `addProjectMember`/`updateProjectMember`/`removeProjectMember`.

## Commitment — person-level, not project-level

`Commitment` (`schema.prisma:733+`) has NO `projectId` at all — it's leave/time-off/other
non-project commitments, `kind`/`hoursPerDay`/`startDate`/`endDate`, plus a `status`/`reason`
pair used for the Leave kind's approval flow. It feeds the capacity formula as a DEDUCTION, but
it is not a fifth allocation-shaped concept — don't conflate it with `Allocation`.

## Assignment — who executes an issue

Not a dedicated model — `setAssignment` operates on the configurable responsibility-types
system (cardinality/requiredness/role-eligibility, editable in Configuration → Responsibilities),
read via `readAssignment`, wired through `onSetAssignment`. This is the layer that answers "who
is doing THIS issue," independent of who's allocated to the project it lives under.

## Timesheet — actual effort, always issue-scoped

`TimeEntry` (`schema.prisma:981-1006`) — `issueId` REQUIRED on every row, `activityId` optional
for task-level granularity, `person`/`personId` (the seam again), `date`, `hours`, `billable:
Boolean` (real, feeds utilisation — see below). No `projectId` field at all: a time entry's
project is reached only by walking the issue's tier ancestry, never stored directly.
`Timesheet` (`schema.prisma:1185-1210`) is the weekly wrapper, `(person, weekStarting)` keyed,
`status: Submitted | Approved | Rejected` (a String by design — "the vocabulary is the
product's," not a fixed enum).

**The freeze rule is live, not planned:** `lib/timeWindow.ts`'s `checkEntry` is called from
`addTime` (`lib/workspace.ts:3851`); `isFrozen`/`frozenMessage` (`lib/timesheet.ts:202,213`)
refuse further entries against an already-submitted week.

## Capacity — the real formula

`lib/availability.ts` is, per its own header comment, "the ONE place 'who has time, when' is
computed":

```
available = pattern-derived gross − approved leave/commitments − holidays − meetings
remaining = available − allocations
```

`lib/capacity.ts` holds `WORKING_PATTERN` defaults (`hoursPerDay: 7.5, daysPerWeek: 5,
billableTargetPct: 80`). Working pattern itself is versioned through the generic `Version`
model (`subjectKind`/`subjectId`/`validFrom`/`validTo`/`value` JSON), read via `valueAt` — a
person's pattern can change over time and old records still resolve against what was true then.

## Utilisation — the data and formula exist; the analysis surface doesn't yet

`lib/availability.ts:203` — `utilisationPct = (allocatedHours / availableHours) * 100`.
`TimeEntry.billable` is real. Two agents are DECLARED but not built in `lib/config.ts`:
`AGENT_UTILIZATION` (billable/non-billable/internal/training/leave/available time and trend) and
`AGENT_BILLING_READY` (billing readiness from approved time/billable work/milestones/change
requests). A "Rates" Configuration section exists. A future `axiomate-utilisation-analysis`
skill should build the analysis SURFACE against this real data — not invent a parallel
calculation.

## Scheduling — allocation dates and work-execution dates are genuinely separate

`Allocation.startDate`/`endDate` (a project percentage window) share no field and no derivation
with `Issue.plannedStartDate`/`plannedEndDate`/`actualEndDate` (`lib/schedule.ts`'s
`ScheduleRow` type). The product owner's "allocation date vs. work execution date" distinction
is real and already structurally enforced — a feature that tries to derive one from the other is
inventing a relationship the schema doesn't have.
