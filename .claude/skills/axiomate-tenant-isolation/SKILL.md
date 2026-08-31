---
name: axiomate-tenant-isolation
description: This skill should be used whenever a feature touches the database layer in Axiomate TMS, since the app is multi-tenant and the primary invariant is that Tenant A must never access Tenant B's data. It supplies the real, already-implemented two-layer enforcement mechanism (app-layer withTenant discipline plus database-layer RLS) so a new feature is checked against the actual mechanism, not a generic multi-tenancy checklist.
---

# Axiomate Tenant Isolation

**Primary invariant: Tenant A must never access Tenant B's data.** Already enforced by two
independent, real layers — this skill's job is verifying new code satisfies both, not
designing a new mechanism.

## Layer 1 — application discipline

Every `lib/db/*.ts` call site must run inside `withTenant()`
(`lib/db/client.ts:180`, `SELECT set_config('app.tenant_id', $1, true)`) AND name the tenant
explicitly at the call site — both, not either. `npm run audit:tenancy`
(`scripts/tenant-audit.mjs`) checks this: a deliberately naive text scan, defeated by
indirection ON PURPOSE, so tenant scoping stays visible at the call site rather than hidden
behind a helper that could silently drop it. **A `lib/db/*.ts` function that doesn't visibly
name its tenant at the call site fails this check even if it's technically safe** — visibility
is the point, not just correctness.

## Layer 2 — database enforcement

Every tenant-scoped table has `FORCE ROW LEVEL SECURITY` with a policy reading
`current_setting('app.tenant_id', true)`
(`prisma/migrations/20260824000004_row_level_security/migration.sql`). `npm run audit:rls`
(`scripts/rls-proof.ts`) checks the database refuses even when Layer 1's discipline is skipped
— this is the layer that holds if application code has a bug.

**Both layers are deliberately redundant** — `discussion.ts:24`'s own comment states this
explicitly. A new table needs BOTH: `tenantId` as a compound-key prefix
(`@@id([tenantId, id])`) with `FORCE ROW LEVEL SECURITY` and a matching policy, AND every
`lib/db/*.ts` function touching it wrapped in `withTenant()` naming the tenant at the call.

## What this skill checks on a new feature

1. **New table** — does it carry `tenantId` in its compound key? Does its migration add
   `FORCE ROW LEVEL SECURITY` and a policy? A table without both is a Layer-2 gap regardless of
   how careful the application code is.
2. **New `lib/db/*.ts` function** — does it run inside `withTenant()`? Is the tenant named
   explicitly and visibly at the call, not passed through an indirection that
   `scripts/tenant-audit.mjs` can't see?
3. **New API route** — is the tenant resolved server-side (from the sealed session, never
   trusted from the request), before any database call?
4. **A relation between two tenant-scoped tables** — is it declared as a `[tenantId, xId]` pair,
   so a cross-tenant join is a Prisma type error, not just a runtime risk?
5. **Background jobs, caching, files** — do they carry tenant scoping through the same
   discipline, or does an async/deferred code path silently lose the tenant context that a
   synchronous request had?

## Handoff

Run both `audit:tenancy` and `audit:rls` as part of any change touching the database layer —
per `axiomate-code-review`'s BLOCKER classification, a tenant-isolation gap is never MEDIUM.
