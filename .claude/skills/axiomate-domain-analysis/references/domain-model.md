# The Real Domain Model

Grounded in `prisma/schema.prisma`, `lib/types.ts`, `lib/workspace.ts`, `lib/statusPolicy.ts`,
`lib/access.ts` as of 2026-08-31. Cited, not inferred.

## Tier chain — configurable, not fixed

`HierarchyNode.kind` is **text, not an enum** (`prisma/schema.prisma:159`) — "the chain above
Project is per-organisation configuration." `lib/types.ts:31`'s `NODE_KINDS = ['company',
'client', 'engagement', 'project', 'outcome', 'module']` are the DEFAULT kinds; `NodeKind` is
typed as `string`, so a tenant can define others via the Configuration → Terminology/tier
settings. Never hardcode a tier name as a literal outside this default list without checking
whether it's configuration-driven for the tenant in question.

## Work-item kinds — issue / activity / (isMilestone flag)

`lib/types.ts:49` — `LEAF_ROW_KINDS = ['issue', 'activity', 'milestone']`, but at the database
level there are only two real models: `Issue` (`schema.prisma:205`, the primary work item —
`subIssues` self-relation for sub-issues, sits under a `HierarchyNode` OR a parent `Issue`,
never both) and `IssueActivity` (`schema.prisma:325`, the task/phase concept — "the five
standard phases are a convention of the lifecycle builder, not a constraint"). `isMilestone:
Boolean` on `IssueActivity` is a flag, not a separate kind — the UI's `milestone` leaf-row-kind
is derived from it. **There is no Story, Task-as-a-distinct-model, or Bug kind anywhere.**

## `canParent` — the real placement law

`lib/workspace.ts:519`, `canParent(childKind, parentKind, tiers)`: `activity` only under
`issue`; `milestone` under `issue` or `activity`; `issue` under another `issue` or any
configured tier at index ≥ 0; tier-to-tier follows the configured chain via `tierIndex`. This
function IS the domain rule for "where can this go" — consult it rather than reasoning about
placement from first principles.

## Status/lifecycle — a configurable transition graph, not free text

`lib/statusPolicy.ts:67`, `DEFAULT_STATUS_POLICY`: real statuses include `Open → {In Progress,
Needs clarification, Closed - no defect, Superseded}` and further transitions from each.
`allowedNext(policy, from)` (line 113) enforces the graph unless `policy.enforced` is false
(config-driven escape hatch, not a code branch). This is exactly what Configuration's "Status
transitions" section edits — a status is never just a string field to add a new value to.

## Estimation — matches a named methodology exactly

`IssueEstimate` (`schema.prisma:1038`) — "per the Axiomate Estimation Model" verbatim in the
schema comment. Five dimensions, each `Int? 0-5`: `business, technical, integration, testing,
data`. `sizeOverride: String?` (T-shirt size; null derives from the score), `approvedEffortHours`,
`confidence` (default "Medium"), `steps: Json` (effort breakdown with `dependsOn`),
`baselinedAt`/`baselinedBy` plus an `EstimateRevision` history table. The XS–3XL band
calibration lives in `OperatingModel`'s config JSON (Configuration's "T-shirt sizing" section),
NOT in this schema — the schema stores the raw score, the config maps score to band. See
`axiomate-estimation` for the full model.

## Requirements / acceptance criteria — thin precedent, not a real system

`Sow.acceptanceCriteria: String @db.Text` (`schema.prisma:793`) is free text under a
Statement-of-Work, and `ScopeItem.kind` includes an `'acceptance'` value among `deliverable |
acceptance | assumption | exclusion | process | scenario | configuration`
(`schema.prisma:~1481`) — but this taxonomy is for **commercial scope tracking under a SOW**,
not engineering acceptance criteria. **There is no Given/When/Then or structured requirement
system in code.** `axiomate-requirement-analysis` and `axiomate-acceptance-criteria` introduce
new process — be explicit about that rather than presenting it as extracted convention, and
never reuse `ScopeItem.kind === 'acceptance'` for an engineering acceptance-criteria concept;
that field already means something else.

## Domain invariants — structural, not conventional

- **Tenant scoping is a type-level fact, not a runtime check.** Every tenant-scoped model
  carries `tenantId` as a compound-key prefix (`@@id([tenantId, id])`), and relations are
  declared as `[tenantId, xId]` pairs — a cross-tenant join is a Prisma type error before it's
  ever a bug. Enforcement is doubled at the database layer too: every tenant-scoped table has
  `FORCE ROW LEVEL SECURITY` with a policy reading `current_setting('app.tenant_id', true)`
  (`prisma/migrations/20260824000004_row_level_security/`), and the session variable is set by
  exactly four call sites, all through `lib/db/client.ts:180`'s `withTenant()`. A `lib/db/*.ts`
  call site must BOTH run inside `withTenant` AND name the tenant explicitly at the call —
  deliberate redundancy, documented in `discussion.ts:24`'s own comment.
- **Every write names its actor.** `can(model, actor, key)` (`lib/access.ts:372`) is the single
  permission gate; `!model.access?.enforced` short-circuits to allow-all, which is
  config-driven, never a hardcoded bypass.
- **The person/personId seam recurs on `Allocation`, `Commitment`, `TimeEntry`, and
  `Timesheet`.** Name is the historical join key; id is the migration target. A rename that
  updates only the name field silently orphans anything still joined on the old name — this has
  caused a real incident in this project (a directory entry with a partial record left a person
  holding zero permissions on sign-in). Any skill or feature touching resourcing must treat this
  as a known, unresolved structural gap, not something to "fix" incidentally as a side effect of
  unrelated work.
