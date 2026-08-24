# Row-level security — design

## What this answers

`lib/tenant.ts` says it plainly: *"isolation is a discipline the code follows, not a guarantee
the database enforces; the guarantee is row-level security, and it arrives with identity, not
before it."* The product audit (`docs/plans/2026-08-17-product-audit.md`) names this its other
P0, beside people getting stable keys, and its own validation question — *"is Axiomate one
deployment per firm, or genuinely multi-tenant SaaS?"* — settles the scope here: the answer is
multi-tenant SaaS, confirmed this session.

That answer also revealed the real size of the gap. `lib/auth/entra.ts`'s `entraConfig()` reads
one hardcoded Entra tenant id — today, only people inside Axiocloud's own Entra tenant can sign in
at all. Making a second firm's identity resolve to a different `TenantId` is genuinely separate,
larger work (auth, provisioning, a signup path) and **is not this design**. This design makes the
boundary Axiomate already has — one `TenantId`, resolved from `AXIOMATE_TENANT` — enforced by
Postgres itself rather than by every query remembering to filter, which is exactly what
`currentTenantId()`'s own comment says is left to do: *"this is the function that changes...
resolving from the session, a subdomain or a header — and nothing downstream moves, because
everything downstream already takes the result as a parameter."* This design is what makes
"nothing downstream moves" literally true — the database enforces the boundary regardless of what
resolves `TenantId` later.

## What this is

**32 tables carry their own `tenantId` column** (`Tenant` itself excepted) — the composite-key
discipline `lib/tenant.ts` already established, applied without exception, confirmed by
`npm run audit:tenancy`. RLS needs no cascade reasoning the way `scrub()`/cleanup logic does:
every table already answers "whose row is this" directly, so every policy has the same shape.

**The migration**: `ALTER TABLE "<Model>" ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL
SECURITY` (needed because the connecting role owns these tables — this app's own migrations
create them, and an owner bypasses RLS by default unless forced), then one `CREATE POLICY`
per table checking `"tenantId" = current_setting('app.tenant_id', true)`. One additive SQL file,
the same `prisma migrate diff` → hand-write → `migrate deploy` workflow every migration this
session has used.

**The mechanism — how `current_setting('app.tenant_id')` gets set**: a Prisma Client Extension,
not changes scattered across `lib/db/repo.ts`, `persist.ts` and `schedule.ts`. Two parts, because
Postgres session variables only work correctly when set in the same transaction the protected
query runs in, and this codebase already has explicit `prisma.$transaction(...)` call sites
(`repo.ts`'s `boot()`, `persist.ts`, `schedule.ts`) that must keep working unchanged:

1. A `query.$allOperations` hook wraps any *bare* (non-transactional) call in a two-statement
   batch transaction: `SELECT set_config('app.tenant_id', $1, true)`, then the real query. Safe
   because a bare call was never inside a transaction to begin with — this creates one where
   there wasn't one, rather than nesting inside an existing one.
2. A `client.$transaction` override prepends the same `set_config` call to every *explicit*
   transaction — both the array/batch form and the `async (tx) => {...}` interactive form. This
   is what lets `boot()`'s existing transaction (which creates the `Tenant` row itself, before
   anything else) keep working with zero edits: the override sets the tenant on that same
   connection before the callback's own first statement runs, whatever that statement is.

Every call into `lib/db` already carries an explicit `TenantId` argument — the tenancy audit's own
claim, "every tenant-scoped model call names a tenant" — so the extension has a value to read at
every call site; nothing needs to newly thread a tenant id anywhere that doesn't already have one.

## What this deliberately is not

**Not tenant resolution for a second firm.** `currentTenantId()` keeps reading
`AXIOMATE_TENANT` exactly as it does today. This design makes the single tenant it already
resolves enforced at the database; it does not make a second tenant reachable. That is
`entraConfig()`'s single-tenant authority, a mapping from Entra tenant to `TenantId`, and
probably a provisioning/signup path — a real, separate design with its own questions.

**Not a performance optimization, and may cost something.** Wrapping bare calls in a transaction
adds a round trip `FORCE ROW LEVEL SECURITY` didn't need before. This is accepted as the price of
the guarantee; if it turns out to matter under load, that is a finding for later, not a reason to
weaken the mechanism now.

**No change to `lib/access.ts`'s application-level permission checks.** RLS is a second,
independent layer — the database refusing a row a bug in the reducer's own permission check
would have let through. It replaces nothing; the `can()` funnel keeps deciding what a person may
do, and RLS decides what a connection may ever see, full stop, regardless of what the application
believes it checked.

## Verification

**Before a single `CREATE POLICY` is written**, prove the extension mechanism itself against a
real Postgres connection: two concurrent operations under two different tenant ids, over the
existing pooled connection (`lib/db/client.ts`'s `pg.Pool`, `POOL_MAX` reused connections),
confirming `app.tenant_id` never leaks from one pooled connection's prior request into the next,
and that it is set before — not after, not racing — the query it is meant to protect. A policy
checking a session variable that is not reliably set is a policy that does nothing, and that is
exactly the failure mode that looks correct in a code review and passes every existing test.

**After the policies exist**, a proof in the shape of `scripts/persistence-proof.ts` — call it
`scripts/rls-proof.ts` — that deliberately does *not* go through the extension for one query (the
same way a future bug might skip it) and confirms Postgres itself returns zero rows for another
tenant's data, not an error and not the real rows. This is the proof that matters most: every
other proof in this project shows the application behaves correctly; this one shows the database
still refuses even when the application does not.

## What would send this back

- If the Client Extension approach, once built against `boot()`'s real transaction, cannot
  reliably guarantee `set_config` runs on the same connection as the query it protects for every
  shape of call this codebase actually makes (bare, batch-array `$transaction`, interactive
  `$transaction`) — that is a real gap in "the extension handles it," not a detail to patch
  around in one call site while leaving others exposed.
- If `FORCE ROW LEVEL SECURITY` turns out to break a legitimate operational path this design
  did not anticipate (a migration script, a seed script, an operator's own `psql` session using
  the same connection string) — that is a finding about how this deployment is actually operated,
  not something to work around by weakening the policy.
