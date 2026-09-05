---
artifact: ART-20260905-012
status: proposed
date: 2026-09-05
---

# 0003. Membership on staffing is created by the reducer; provenance is a creation-time source on the row; the change log is read from rows enriched by audit

## Context

`ART-20260905-010` records three decisions of 2026-09-05 (Nishant Sekhar, E1): provision to add,
edit, update and see the change history of a project's members; automatic membership when a
person is staffed through an allocation or an issue assignment, so nobody can be staffed and
invisible; and a per-project change log on the Members panel showing who was added, removed or
had their role changed, by whom, when, and whether from staffing or a deliberate act, with removed
rows kept as history.

`CLAUDE.md`'s resource model holds allocation, membership and assignment as three distinct facts.
The 2026-08-24 membership design made membership a read gate and a write gate with a descriptive
role, and stated that nobody is both a client seat and an internal member. Today membership rows
come only from the three deliberate arms (`lib/workspace.ts:6991-7085`, gated by `project.staff`)
and from the one-off backfill (12 production rows, `addedBy 'backfill migration 20260824000001'`,
no audit entry). `upsertAllocation` (`:6310`) and `setAssignment` (`:6921`) never touch
`state.projectMembers`.

The design is open on three axes:

| Axis | Options in play |
| --- | --- |
| Mechanism | The reducer arms; a rule in `lib/automation.ts`; the scheduled pass |
| Provenance | How an automatic row is distinguished from a deliberate one without storing a derived value. The request's "Allocation's stated/derived pattern" names a field `Allocation` does not have; the vocabulary is `CapacityProfile.source` `'stated' \| 'default'` (`lib/capacity.ts:65`) and `Activity.origin` `'generated' \| 'user'` (`lib/workspace.ts:337`) |
| Log storage | `ScheduleAudit` is prose from/to, loaded newest-`auditWindow()` (5000) rows tenant-wide at boot (`lib/db/repo.ts:101-103, 213`), and absent for the backfill rows, so it cannot be the sole source |

Three facts verified on 2026-09-05 constrain the shape:

- `lib/db/persist.ts` diffs `projectMembers` only under the three membership action cases
  (493-500); `setAssignment` persists the issue only (384) and `upsertAllocation` the allocations
  only (479-491). A row created inside either arm would apply in memory and never reach Postgres.
- `ROLE_AUTOMATION` holds `work.assign` (`lib/access.ts:245`) and both intake routes dispatch
  `setAssignment` as the machine actor.
- `setAssignment` writes `issue.owner` but not `ownerId`; the helper must resolve `personId`
  itself.

The domain rules the decision text leaves open (which acts count, unresolvable names,
re-staffing after a deliberate removal, exempt people, the default role) are the specification's
open questions OQ1-OQ5, OQ7 and are not decided here. This ADR fixes the shape so that any answer
lands in one place.

## Decision

1. **Membership is created by the reducer inside the staffing arms**, through one shared pure
   helper (working name `enrolIfStaffed(state, actor, by, projectId, personName, personId,
   source, now)` returning `{ state, entries }`). Callers: `addProjectMember` (source `'stated'`),
   `setAssignment` for each newly added person-valued value that resolves to a directory id
   (the arm already computes `after.filter(v => !before.includes(v))` at `:6960`),
   `upsertAllocation` when `next.personId` resolves, and, if OQ1 includes them, `create`,
   `duplicate`, `updateIssue` and `move`. The helper creates a row only when none is live for
   `(projectId, personId)`; it never refuses or alters the staffing act; it mints `projmem-<seq>`
   ids from `state.seq`; it returns audit entries the arm emits through `logAll` beside its own
   (the `log` comment at `:1520-1528` says why two `log` calls drop one). The gate
   (`isStaffedOn`, `projectView`, `memberProjectIdsFor`) is unchanged and never computes
   membership from allocations or assignments.
2. **Provenance is an immutable creation-time column** `ProjectMember.source: 'stated' |
   'staffing' | 'backfill'`, stamped by the arm from which arm is running, never accepted from
   the wire (`lib/actionShape.ts` gains no field, the discipline `upsertCommitment` uses for
   `status`), never read by the gate, and never rewritten by a later role edit. A companion
   `removedBy: string | null` is stamped by `removeProjectMember` from the reducer's `by`. Both
   are attribution-class facts like `addedBy` and `createdBy`, not derived values: they describe
   how the row came to exist or end and cannot be recomputed from other state (the allocation
   that caused a row may later be released; the row stays and still came from staffing). The
   migration is additive and stamps `source = 'backfill'` where `id LIKE 'projmem-backfill-%'`
   and `'stated'` otherwise, stating in its comment that the inference rests on the id prefix
   the script itself mints. Which allocation or issue caused an automatic add goes in the audit
   entry's `reason` (`"Staffed by allocation alloc-12"`), not on the row.
3. **The per-project change log is read, not stored.** Its durable skeleton is the
   `ProjectMember` rows for the project: every row, live or removed, yields an *added* line from
   `addedAt` / `addedBy` / `source` and, if removed, a *removed* line from `removedAt` /
   `removedBy`. The existing `ScheduleAudit` entries with `rowId = projectId` and
   `field = 'project member'` enrich it (role changes with from/to, reasons, `byId` / `byEmail`)
   when they are within the boot window; the panel states when enrichment is unavailable. No new
   table. `projectView` already keeps audit rows by member project
   (`lib/projectBoundary.ts:69`), so visibility follows the project without new code.
4. **`lib/db/persist.ts` diffs `projectMembers` under the staffing action cases** as it does
   under the three membership cases.
5. **A standing integrity check** `staffedWithoutMembershipCheck` in `lib/dataIntegrity.ts`, run
   by `audit:integrity`, lists every live allocation with a resolved `personId` on a project node
   and every person-valued responsibility value on a live issue with a project ancestor whose
   person has no live membership and is not exempt. Computed over `WorkspaceState`, never stored.
   This is how the backfill's grade ("nobody actively working a project loses sight of it")
   becomes a standing gate instead of a one-off.
6. **Enrolment excludes people who resolve to a client-scoped seat** (`Person.clientScopeId`
   set). Exemption of `ROLE_ADMIN` and the machine actor follows the product owner's answer to
   OQ7, with the backfill's skip (`scripts/backfill-project-members.ts:107-108`) as the default.

## Alternatives rejected

- **A rule in the automation layer.** `addProjectMember` needs `project.staff`, which
  `ROLE_AUTOMATION` does not hold, so the dispatched action is refused; `EVENT_TYPES` has
  `issue.owner` but no event for other person-valued responsibilities and none for allocations;
  `RuleAction` kinds are notify / addNote / setNextAction / requestApproval. And it is non-atomic:
  the person is staffed and invisible between the staffing action and the rule run, the literal
  state decision (2) ends. The automation layer's own note that a rule cannot do anything a
  person could not is the argument for the reducer.
- **A nightly reconcile in the scheduled pass.** `runWatch` runs as the machine actor, so
  `addedBy` would read as the pass and the person who staffed is lost; up to a day of
  staffed-and-invisible contradicts decision (2). The comparison it would make is decision 5,
  adopted as the check rather than the creation mechanism.
- **Derive membership at read from allocations and assignments.** Collapses layer 2 into layers
  1 and 3 against `CLAUDE.md`; makes deliberate removal impossible while an assignment stands;
  makes the gate's answer change when an allocation end date passes with nobody deciding.
- **Refuse the staffing action when the person is not a member and the actor lacks
  `project.staff`.** Decision (2) chose creation over refusal. Recorded because it is the only
  option that does not widen who can write an access fact; if the product owner reverses at OQ5,
  a new ADR carries the refusal and its effect on intake.
- **A new membership-event table** (add / role change / remove, actor, at, origin, cause
  reference), the UX analyst's alternative. Not rejected on merit; not chosen now. It adds a
  tenant-keyed table with row-level security, a persistence path and a boot load for a register
  whose durable content the rows already carry, except role-change history, which is audit-only
  and window-bounded. If the product owner does not accept that bound at OQ6, or requires a
  per-line cause reference at OQ9, a new ADR carries the table and its costs.
- **Store the cause of an automatic add on the row.** A pointer to a soft-deletable fact invites
  treating it as live and re-couples membership to the allocation that caused it. The cause is
  detail about an event and goes in the audit `reason`.
- **Reuse `'stated' | 'default'`.** `'default'` means the shipped fallback was used; nothing
  about a staffing-created membership is a fallback.
- **Infer origin at read from the `addedBy` string.** Origin becomes a derived value that changes
  meaning the day the string does; the backfill script's own header says audit `by` fields are
  never identity data. Stamped once by migration instead.

## Consequences

- The permission boundary moves: `work.assign` and `capacity.allocate` holders, and the intake
  machine actor, cause access facts without `project.staff`. Specification BR14 and OQ5; the
  Security Reviewer reads it at Proof.
- `lib/workspace.ts` changes in `upsertAllocation`, `setAssignment`, the three membership arms,
  and in `create` / `duplicate` / `updateIssue` / `move` if OQ1 includes them; `setAssignment`
  must bump `seq` and emit audit through `logAll`. `prisma/schema.prisma` and
  `prisma/migrations/**` gain two columns and a one-time stamp, as their own workstream and
  commit. Gate 3 with the architect applies to the plan.
- `lib/db/persist.ts` must diff `projectMembers` under the staffing cases or the feature silently
  fails on reload; `audit:persistence` gains a round-trip check (specification AC22).
- The audit window bounds enrichment: added and removed lines are durable from rows; role-change
  lines older than `AXIOMATE_AUDIT_WINDOW` are not recoverable. The panel says so. If that bound
  is not acceptable, the event-table alternative supersedes this decision.
- The 12 production backfill rows, and any from today's run, are stamped `'backfill'` by
  migration and display as backfilled with their backdated `addedAt`; until stamped they display
  as "origin not recorded", never as deliberate.
- The default role for an automatic row comes from one pure function shared with the backfill
  script; the row carries no role history, so "defaulted" is displayed from `source` plus the
  absence of a role-change line, which is window-bounded, unless OQ2 chooses a neutral seeded
  role.
- The backfill script must be re-keyed on `(tenantId, projectId, personId)` before any further
  `--commit` (risk R1 in `ART-20260905-011`), must stamp `source 'backfill'`, and stays a
  one-off tool; the integrity check replaces it as the standing guarantee.
- Nothing ends a membership automatically; the check reports staffed-without-membership, never
  member-without-staffing, so leftover access is legible on the Members tab and removed
  deliberately.

## Principles checked

- **Tenant isolation at both layers.** No new table; two columns on a table already under
  `FORCE ROW LEVEL SECURITY` with `@@id([tenantId, id])`; any new audit read runs in
  `withTenant()` naming the tenant at the call. `audit:tenancy` and `audit:rls` in the gate.
- **Pure reducer.** Enrolment is a function of state, action, actor and `a.now`; ids from
  `state.seq`; no clock or IO. The integrity check is pure over `WorkspaceState`.
- **Attribution as a parameter.** `addedBy` / `removedBy` and the audit `by` / `byId` come from
  the `actor` parameter of `apply()`; a machine actor is attributed as itself; `source` is not
  attribution and does not substitute for it.
- **Derived never stored.** Membership is a stored fact created by an event, not a projection of
  allocation or assignment; `source` and `removedBy` are creation- and removal-time provenance;
  the staffed-but-not-a-member comparison is computed by the integrity check and never stored;
  the log is rendered from rows and audit at read.
