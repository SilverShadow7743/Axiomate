---
name: axiomate-data-integrity
description: This skill should be used when auditing Axiomate TMS for orphaned records, broken references, duplicate allocations, invalid dates/states, or capacity inconsistencies. Implemented as `npm run audit:integrity` (persistence-proof.ts checks round-trip mapper fidelity, a different concern). Load when the user asks for a data-integrity audit, or before a migration that touches person/personId, allocation, or timesheet data.
---

# Axiomate Data Integrity

**Implemented, 2026-08-31** — `npm run audit:integrity` (`scripts/integrity-audit.ts`, pure
checks in `lib/dataIntegrity.ts`, pinned by scenario `DI1`) now runs all seven risk areas below,
read-only, against the real tenant. `npm run audit:persistence` (`scripts/persistence-proof.ts`)
is a different, older concern — whether a written value survives a round trip through Postgres
unchanged (mapper fidelity), not whether a stored reference still points at something live. One
correction from the original proposal: risk #6 (status reachable via the transition graph) is
narrowed to "is this a status value the type recognises at all" — `lib/statusPolicy.ts`'s own
header comment says the graph "governs changes, not the past," and imported history legitimately
sits in combinations it would never produce; checking full reachability would false-positive on
exactly that known-good data.

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
   `Issue.plannedStart <= plannedEnd` where both are set — the same class of check
   `lib/schedule.ts`'s `validateChange` already runs at write-time for issue dates; an integrity
   audit checks whether anything bypassed it (a migration, a direct write) rather than
   re-implementing the rule.
6. **Corrupted status** — not "reachable per the transition graph from history" (`lib/
   statusPolicy.ts`'s own comment: the graph "governs changes, not the past," and imported
   history legitimately sits in combinations it would never produce) — narrower and honest: is
   `Issue.status` a value `ISSUE_STATUSES` even recognises. `status` is a plain schema `String`,
   so nothing but the reducer enforces this, and only the reducer writes through it.
7. **Capacity inconsistencies** — the sum of a person's `Allocation.percentage` across
   concurrent, overlapping windows exceeding 100% is not necessarily invalid (over-allocation
   can be a real, deliberate business decision) but is always worth surfacing as a finding, not
   silently allowed to pass unnoticed.

## Process

1. Run `npm run audit:integrity` — it groups findings by risk area already (each of the seven
   checks reports separately, `error` or `review` kind), so "a combined dump" isn't a live
   concern the way it would be for an ad-hoc manual query. For a ONE-OFF check outside the
   script (e.g. investigating a specific report), still scope to one risk area at a time.
2. For anything beyond the shipped script, query the violation directly against the schema
   (read-only), citing the real relation that's broken — or add a case to
   `lib/dataIntegrity.ts` if it's a genuinely new, recurring risk, pinned by its own scenario.
3. Distinguish "this is definitely wrong" (a dangling foreign key, a date where end < start,
   `kind: 'error'`) from "this is worth a human decision" (over-allocation, `kind: 'review'`) —
   the shipped checks already carry this distinction; preserve it in anything new.
4. Do not write a fix without explicit approval — this skill audits; a companion fix is a
   separate, deliberate action per `axiomate-code-review`'s standing discipline around
   destructive/data-modifying changes. `scripts/integrity-audit.ts` never writes.
