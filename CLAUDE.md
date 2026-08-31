@AGENTS.md

# The resource model — read before touching allocation, capacity, or timesheet code

Four distinct layers, easy to collapse into each other by accident. Don't.

1. **Allocation** (`prisma/schema.prisma`'s `Allocation` model) — a person's *capacity commitment*
   to a **project-tier node**, never a work item. `projectId` (via the `ProjectAllocation`
   relation), `percentage`, `startDate`/`endDate`. This is the layer the product owner means by
   "resource allocation happens at Project level."
2. **ProjectMember** — a *project-access* fact, not a capacity one: who may see and act on a
   project, with a role. Explicitly documented in-schema as `Allocation`'s sibling, answering a
   different question. `personId` is required here (unlike `Allocation`'s optional one).
3. **Assignment** (`setAssignment`, the responsibility-types model — cardinality, requiredness,
   role-eligibility, configurable per Configuration) — who executes a **specific issue**. A
   person can be 50% allocated to a project and hold zero, one, or many issue assignments under
   it. Allocation ≠ assignment; a change to one never implies a change to the other.
4. **Timesheet** (`TimeEntry`, always `issueId`-scoped, optional `activityId` for task detail;
   `Timesheet` is the weekly `Submitted/Approved/Rejected` wrapper) — **actual** effort, checked
   against capacity via `lib/timeWindow.ts` (wired live into `addTime`) and the freeze rule
   (`lib/timesheet.ts`'s `isFrozen`), not a projection of allocation or assignment.

**Allocation is project-level. Assignment is work-level. Timesheet is actual-level.** Capacity
(`lib/availability.ts`) is computed from allocations plus the versioned working pattern minus
leave/holidays/meetings — never from assignments or timesheets directly. A known, unresolved
seam: `Allocation`, `Commitment`, and `TimeEntry` all carry a `person: String` field alongside
an optional `personId` — name is the historical join, id is the migration target; a rename
that only updates the name orphans anything still joined on it (see
`.claude/skills/axiomate-domain-analysis/references/domain-model.md` for the fuller trap).

This distinction is also encoded in `.claude/skills/axiomate-domain-analysis`,
`axiomate-work-model`, `axiomate-project-allocation`, and `axiomate-capacity-planning` — check
those before implementing anything that touches resourcing.
