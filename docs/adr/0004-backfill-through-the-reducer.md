---
artifact: ART-20260905-015
status: proposed
date: 2026-09-05
---

# 0004. The membership backfill plans in a pure function, skips on any existing (project, person) row, and writes only through the reducer; ids are never derived from person and project

## Context

`ART-20260905-013` records a correction to `scripts/backfill-project-members.ts`. The script
builds rows without reading `state.projectMembers`, numbers them `projmem-backfill-<counter>` in
Map iteration order (lines 101-121), and on `--commit` upserts by that id with a full-row update
(161-169) through a bare `PrismaClient` (37) that never sets `app.tenant_id`. A re-run would
rewrite six live production rows (E1, CEO, 2026-09-05).

The CEO's required outcome allows two mechanisms: "ids are stable and derived from person and
project rather than a counter, **or** the script goes through the reducer's `addProjectMember`
arm which already refuses duplicates". The requirement analyst drafted criteria for either and
marked the design open. This ADR holds that the two are not equivalent and that one of them
reintroduces the defect in a different shape.

Facts constraining the choice, read 2026-09-05:

| Fact | Where |
| --- | --- |
| `addProjectMember` refuses a live duplicate by `(projectId, personId, !removedAt)`, mints `projmem-<seq>` from `state.seq`, stamps `addedBy` from the reducer's `by`, writes an audit entry | `lib/workspace.ts:6991-7040`, guard at `:7010-7013` |
| Membership is soft-ended; the same pair legitimately has more than one row after a remove and re-add | `lib/staffing.ts:26-28` |
| No unique on `(tenantId, projectId, personId)`, only an index | `prisma/schema.prisma:669` |
| `persistActions` sets `app.tenant_id` first in `runBatch`'s transaction; stops at the first refusal keeping earlier writes | `lib/db/persist.ts:94, :170, :85-92` |
| `addProjectMember` needs `project.staff`; `ROLE_AUTOMATION` does not hold it and the grant is deliberately narrow | `lib/access.ts:595, :245` |
| The action carries a person name, not a `personId` | `lib/actionShape.ts` |
| `ProjectMember` is under `FORCE ROW LEVEL SECURITY` with a USING-only policy | `prisma/migrations/20260824000004:78-80` |

The concurrent `ART-20260905-012` / `docs/adr/0003` proposes `ProjectMember.source` stamped
`'stated'` by `addProjectMember` and `'backfill'` by a migration matching
`id LIKE 'projmem-backfill-%'`, and says the script "must be re-keyed on
`(tenantId, projectId, personId)` before any further `--commit`". The design here is open on
whether that re-keying means a derived id or a skip predicate, on whether the script writes
through the reducer, and on whether a schema-level guard is taken now.

## Decision

1. **Planning is a pure function.** `planMembershipBackfill(state)` in a new non-protected
   module (`lib/backfillMembers.ts`) returns `{ create, alreadyMember, removed, unresolvedOwners,
   unresolvedTimeEntries, unresolvedAllocations }`. `alreadyMember` holds every pair with a live
   row; `removed` every pair whose rows are all removed. Both use the predicate the reducer and
   `memberProjectIdsFor` use, never an id. The script becomes load → plan → print → (commit)
   write, and the proof asserts the buckets without a database.
2. **The skip covers any existing row, live or removed.** A removed row is a decision a person
   attested; evidence-derived enrolment never out-votes it. Re-enrolment, if wanted, is an
   `addProjectMember` by a person and a new row.
3. **Writes go through the reducer.** For the `create` bucket only, the script builds
   `{ t: 'addProjectMember', projectId, person: state.model.people[personId].name,
   projectRoleId, now }` actions and submits them through
   `persistActions(tenantId, operator, actions)`. The reducer mints ids, stamps `addedBy`,
   writes the audit entry, and its duplicate guard is the backstop that cannot be bypassed;
   `runBatch` sets the tenant, curing the bare-client write with no new code.
4. **The operator is a parameter** (`--as <email or id>`), resolved through
   `directoryPersonFor`, refused if nobody, and must hold `project.staff`. `ROLE_AUTOMATION` is
   not widened; `lib/access.ts` is untouched.
5. **No id is ever derived from person and project**, and the script never contains an upsert
   on `projectMember`; the proof asserts both.
6. **`addedAt`** follows the product owner's answer to the specification's OQ8 (earliest
   evidence, or run time with the evidence date in the audit reason); the mechanism is the same.
7. **A standing check** `duplicateLiveMembershipCheck` in `lib/dataIntegrity.ts`
   (`audit:integrity`) reports two live rows for one `(tenant, project, person)`; computed,
   never stored.
8. **Interim, before the above lands:** the current script refuses `--commit` when
   `state.projectMembers` is non-empty, and its header states both hazards and the standing
   instruction.
9. **The partial unique index** on `ProjectMember (tenantId, projectId, personId) WHERE
   removedAt IS NULL` is deferred as debt (specification OQ6), not rejected.

## Alternatives rejected

- **Derive the id from person and project and keep an in-place upsert on it** (the first half
  of the stated outcome). Neither necessary nor sufficient. A derived id sits beside a
  reducer-minted `projmem-42` for the same pair and creates the duplicate the reducer refuses;
  only a lookup on the pair prevents that, and then the id scheme does nothing. Because
  membership is soft-ended, a derived id collides with the removed row on re-add and an upsert
  on it overwrites attested history, breaching "can never overwrite an existing row". Once the
  script skips on an existing row and never upserts, the id only needs to be unique, and the
  reducer already mints one. ADR 0003's "re-keyed on `(tenantId, projectId, personId)`" is read
  as the skip predicate, not an id.
- **Fix in place with `create` inside `withTenant`.** The fallback if this route is refused,
  and stated as such: safe (a PK collision fails with P2002; the tenant is set) but weaker. No
  audit entry, hand-written attribution, a second copy of the duplicate rule beside the
  reducer's, which `lib/db/persist.ts:51` calls the fastest way to drift. It does keep
  backdated `addedAt` for free, the one thing the reducer route needs OQ8 to settle.
- **Extend `addProjectMember` to accept `personId`.** Touches `lib/workspace.ts` and
  `lib/actionShape.ts` (protected) for no gain; the script passes the name and reports any
  resolution refusal rather than bypassing it.
- **Widen `ROLE_AUTOMATION` to hold `project.staff`.** The grant is deliberately narrow, the
  widening is unrelated, `lib/access.ts` is protected, and `ART-20260905-010` already has the
  security reviewer looking at the machine actor causing access facts. A named operator is the
  precedent (`scripts/seed-allocations.ts`).
- **Add the partial unique index now.** Deferred, not rejected on merit: the strongest guarantee
  for every future writer, but a migration on a protected path needing a production pre-check,
  and the correction needs nothing from it.
- **Do nothing because `ART-20260905-010` retires the script.** A comment stops nobody, the
  retirement is proposed and unscheduled, and 010's own OQ12 contemplates one more run at ship.
  The interim guard is one line and closes the hazard today; the product owner decides at OQ3
  whether the rest is built or deferred to the retirement.

## Consequences

- Rows carry reducer-minted `projmem-<seq>` ids and `addedBy` = the operator's name, consume a
  seq each, and are attributed like any deliberate add. The 2026-08-24 literal is never written
  again.
- **Must be resolved with ADR 0003 before both are approved:** under 0003 the helper stamps
  `source 'stated'` from `addProjectMember` and the migration infers `'backfill'` from the id
  prefix. Rows created by this route would be `'stated'` with unrecognised ids. Either the
  helper takes `source` as a parameter the script sets to `'backfill'`, or the script retires
  before 0003 lands, or 0003's migration inference is widened. Specification OQ9.
- The operator must hold `project.staff` and, unless `ROLE_ADMIN`, pass the project gate for
  every project in the batch; a refusal is the rule working and is reported as a stop.
- `persistActions` stops at the first refusal, so the planner's filtering is load-bearing: the
  batch holds creates only and the report reconciles submitted, created and refused. One action
  per pair is acceptable.
- Backdating `addedAt` through the reducer backdates the audit entry's `at` (OQ8).
- Tenant isolation at Layer 1 is restored by construction; the proof records whether a
  bare-client write is refused by RLS against its own tenant (OQ5).
- No protected path changes. Touched: the script, `lib/backfillMembers.ts` (new),
  `lib/dataIntegrity.ts`, `scripts/backfill-members-proof.ts` (new), `package.json`, one dated
  line in `docs/plans/2026-08-24-project-membership-plan.md`.
- The script stays a one-off tool; 010's `staffedWithoutMembershipCheck` replaces it as the
  standing guarantee, and `duplicateLiveMembershipCheck` reports the damage a bad writer would
  leave.

## Principles checked

- **Tenant isolation at both layers.** The current commit path violates Layer 1 (bare client, no
  `withTenant`); the reducer route sets the tenant in `runBatch`; the proof uses its own tenant
  and cleans up through the wrapped path.
- **Pure reducer.** Unchanged; the planner is extracted as a pure function over
  `WorkspaceState`; `ProjectMember` stays written only via the reducer and its persist arm.
- **Attribution as a parameter.** The current script hardcodes a migration name; the fix takes
  the operator as a parameter and the reducer writes `actor.name` plus an audit entry.
- **Derived never stored.** `ProjectMember` is an attested access fact. The 24 August design
  accepted deriving it once from evidence as a seed; re-running as reconciliation would turn
  membership into a stored derivation that can overwrite attested state (removals), which is why
  the skip covers removed rows and why retirement via `ART-20260905-010` is the right end state.
  The duplicate check is computed and never stored.
