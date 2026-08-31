---
name: axiomate-data-integrity
description: This skill should be used when auditing Axiomate TMS for orphaned records, broken references, duplicate allocations, invalid dates/states, or capacity inconsistencies. This is a NEW quality gate this skill proposes — no existing script performs referential-integrity checking today (persistence-proof.ts checks round-trip mapper fidelity, a different concern). Load when the user asks for a data-integrity audit, or before a migration that touches person/personId, allocation, or timesheet data.
---

# Axiomate Data Integrity

**New process — say so plainly.** `npm run audit:persistence` (`scripts/persistence-proof.ts`)
checks whether a written value survives a round trip through Postgres unchanged (a mapper
fidelity question). Nothing in the current script set checks orphaned records, broken
references, or cross-field consistency. This skill proposes what that gate should look like,
grounded in the real schema's actual risk surface — not a generic data-quality checklist.

## The real risk surface, from the schema itself

1. **The person/personId seam** (`axiomate-domain-analysis`) — `Allocation`, `Commitment`,
   `TimeEntry`, `Timesheet` all carry a `person: String` alongside an optional/required
   `personId`. A row whose `person` string no longer matches any live directory entry (a rename
   that only updated the name field) is a real, already-occurred failure mode in this project's
   history, not a hypothetical.
2. **Hierarchy placement** — every `Issue`/`HierarchyNode` relationship should satisfy
   `canParent()`'s real law (`axiomate-work-model`). A row that violates it wasn't created by
   the reducer (which enforces this) — it can only exist via direct data manipulation or a
   migration that bypassed the reducer, which is itself the finding.
3. **Allocation without a valid project** — `Allocation.projectId` should always resolve to a
   live `HierarchyNode` at the project tier. A dangling `projectId` (a deleted/archived project
   with allocations still pointing to it) is a duplicate-allocation-shaped bug: the person reads
   as committed to capacity that no longer has a real destination.
4. **TimeEntry without a valid issue** — `TimeEntry.issueId` is required; an entry pointing at a
   deleted issue is effort recorded against nothing, which breaks utilisation calculations
   downstream (`axiomate-utilisation-analysis`).
5. **Date consistency** — `Allocation.startDate <= endDate`, `Commitment.startDate <= endDate`,
   `Issue.plannedStartDate <= plannedEndDate` where both are set — the same class of check
   `lib/schedule.ts`'s `validateChange` already runs at write-time for issue dates; an integrity
   audit checks whether anything bypassed it (a migration, a direct write) rather than
   re-implementing the rule.
6. **Status consistency** — every `Issue.status` should be reachable per
   `lib/statusPolicy.ts`'s configured transition graph from the tenant's actual history; a
   status that couldn't have been reached via `allowedNext` suggests a bypass.
7. **Capacity inconsistencies** — the sum of a person's `Allocation.percentage` across
   concurrent, overlapping windows exceeding 100% is not necessarily invalid (over-allocation
   can be a real, deliberate business decision) but is always worth surfacing as a finding, not
   silently allowed to pass unnoticed.

## Process

1. Scope the audit to one risk area at a time (per the list above), not all seven at once — a
   focused finding set is actionable; a combined dump is not.
2. Query for the violation directly against the schema (read-only), citing the real relation
   that's broken.
3. Distinguish "this is definitely wrong" (a dangling foreign key, a date where end < start)
   from "this is worth a human decision" (over-allocation, a status reached unusually) — report
   the second category as a finding to review, not an error to silently fix.
4. Do not write a fix without explicit approval — this skill audits; a companion fix is a
   separate, deliberate action per `axiomate-code-review`'s standing discipline around
   destructive/data-modifying changes.
