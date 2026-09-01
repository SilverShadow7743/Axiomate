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
leave/holidays/meetings — never from assignments or timesheets directly. `Allocation`,
`Commitment`, `TimeEntry` and `Timesheet` all carry a `person: String` field alongside an
optional `personId` — this is deliberate, not a gap: `person` is the display name (and, for
`TimeEntry`, part of the attested record), `personId` is the resolved directory join. The
identity-ids migration (designed, planned, built in six steps, backfilled and verified against
live production on 2026-08-22 — `docs/verification-checklist.md` §22) made every reducer arm
resolve `personId` at write, made every personal join id-first with a name fallback
(`lib/dataIntegrity.ts`'s `personSeamCheck` audits drift), and ran the backfill to zero
remaining unique matches — what's left null is imported-log compounds and placeholders, on the
name fallback by design. `scripts/fix-person-identity.ts` moves both fields together on a
rename and refuses if any `TimeEntry` would be silently rewritten. The one place still
name-only is unavoidable, not unresolved: an incoming action (e.g. `addTime`) carries only a
free-text `person` field, like every write action in this codebase, so its entry point must
resolve a name before any id-first join can begin — see scenario `TW2`'s `stops` text for the
one live instance of this. Any *new* write path must resolve `personId` at creation the way the
existing ones do; that is the discipline to maintain, not a migration still to do.

This distinction is also encoded in `.claude/skills/axiomate-domain-analysis`,
`axiomate-work-model`, `axiomate-project-allocation`, and `axiomate-capacity-planning` — check
those before implementing anything that touches resourcing.
