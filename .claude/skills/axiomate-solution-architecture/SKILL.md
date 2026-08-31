---
name: axiomate-solution-architecture
description: This skill should be used before significant development work on Axiomate TMS, to identify architectural impact across domain, API, database, UI, and integration layers before implementation starts. It supplies the real stack facts and the two-layer tenancy enforcement model so new work is built against what actually exists, not assumed defaults. Load before axiomate-feature-builder for anything touching more than one layer.
---

# Axiomate Solution Architecture

## Real stack facts

Next.js `^16.2.9`, Prisma `^7.9.1` / `@prisma/client ^7.8.0`, Node 24, deployed to Azure App
Service (Linux, `axiomate-tms`). Sessions: `lib/auth/seal.ts`, an HMAC-signed (not encrypted)
cookie carrying exactly `{oid, name, email, exp}` — nothing else rides in the session, so any
per-request data beyond those four fields is resolved server-side, never trusted from the
client.

## Tenancy — two independent enforcement layers, both required

1. **Application-layer discipline** — every `lib/db/*.ts` call site must run inside
   `withTenant()` (`lib/db/client.ts:180`, `SELECT set_config('app.tenant_id', $1, true)`) AND
   name the tenant explicitly at the call. `audit:tenancy` (`scripts/tenant-audit.mjs`) checks
   this — deliberately naive (a text scan defeated by indirection on purpose, so scoping stays
   visible at the call site rather than buried behind a helper).
2. **Database-layer enforcement** — every tenant-scoped table has `FORCE ROW LEVEL SECURITY`
   with a policy reading the same session variable
   (`prisma/migrations/20260824000004_row_level_security/`). `audit:rls` checks the database
   refuses even when the application-layer discipline is skipped.

Both layers are deliberately redundant (`discussion.ts:24`'s own comment states this). A new
feature that queries the database must satisfy both — passing `audit:tenancy` alone is not
sufficient evidence of correct scoping.

## Architectural impact checklist, before implementation

```
Domain    — does this fit the real model? (axiomate-domain-analysis, axiomate-work-model)
Database  — new table/column? Does it need tenantId as a compound-key prefix? RLS policy?
API       — new route? Tenant-scoped from the first line, actor resolved server-side, never
            trusted from the request body
UI        — which shell pattern? (axiomate-ui-design, axiomate-screen-builder)
Integration — does this touch Entra/Graph, the scheduled pass, or an external mailbox? Check
              existing patterns before adding a new integration surface
```

## What this skill hands back

Which layers a change touches, and for each: what already exists to build on (a reducer arm, a
db module, a UI pattern) versus what's genuinely new. Genuinely new database surface always
needs the tenancy checklist above stated explicitly, not assumed. Hand off implementation
sequencing to `axiomate-feature-builder`.
