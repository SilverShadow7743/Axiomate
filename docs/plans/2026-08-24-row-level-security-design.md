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

**The mechanism — how `current_setting('app.tenant_id')` gets set — revised.** The Client
Extension approach originally specified here was abandoned before being built, on evidence found
while tracing how an ordinary user-driven CRUD write actually reaches the database (see
"What sent this back" below). It is replaced by wrapping the codebase's small, fixed set of true
transaction boundaries directly — no extension, no hook trying to infer whether a call is already
inside a transaction.

Tracing every call site (`grep` for `prisma.$transaction` and for `loadWorkspace(` across the
whole repo) shows the actual shape is narrower than "changes scattered across `repo.ts`,
`persist.ts` and `schedule.ts`" implied: **only three functions ever open a transaction** —
`persist.ts`'s `runBatch`, `schedule.ts`, and `repo.ts`'s `importWorkspace` — and **every write in
the application goes through exactly one of them** (`grep` for bare `prisma.<model>.create
/update/upsert/delete` outside those three files and `boot.ts` returns nothing). Reads are
`loadWorkspace(tenantId, db: Reader = prisma)`, called two ways: with an explicit `tx` from inside
one of those three transactions, or bare (the default `db = prisma`) from `boot()`'s own page-load
read, from `mail/send`, `intake`, `intake/form`, `documents`, `documents/[id]`, `schedule/run`,
and every operator script under `scripts/`.

That shape gives a mechanism with no ambiguity to resolve, because nothing has to guess whether a
call is already transactional — the four places that matter already know:

1. **`loadWorkspace` wraps itself** when called with the default `db = prisma` (checked by
   reference equality against the exported singleton, not by a type test — `tx` objects are never
   that same reference): `prisma.$transaction(async (tx) => { set_config; <the existing 32-way
   Promise.all, against tx> })`. Called with an explicit `tx` instead, it runs the same 32 queries
   directly against it and sets nothing — trusting the caller already set the tenant on that `tx`,
   which is true for all three callers below.
2. **`persist.ts`'s `runBatch`** sets `app.tenant_id` as the first statement inside its existing
   `prisma.$transaction(async (tx) => {...}, { isolationLevel: 'Serializable', ... })`, before its
   own `loadWorkspace(tenantId, tx)` call. This is the single write path for every user action —
   `app/api/workspace/route.ts` and every other route that mutates state all resolve here through
   `persistActions`/`persistAction`.
3. **`schedule.ts`** gets the same one-line addition at the top of its own `prisma.$transaction`.
4. **`repo.ts`'s `importWorkspace`** gets the same, at the top of the transaction that lays down a
   new tenant's log on first boot.

No other file changes. Every bare `loadWorkspace` call — dozens of scripts, six routes, `boot()`'s
own read — is covered by change 1 without being touched; every write is covered by changes 2–4.
Scripts under `scripts/` are operator-run maintenance, not user-driven CRUD, and are covered by
this mechanism incidentally (they call the same `loadWorkspace`) rather than by design — worth
noting, not a gap this design needs to close separately.

Every call into `lib/db` already carries an explicit `TenantId` argument — the tenancy audit's own
claim, "every tenant-scoped model call names a tenant" — so each of the four places above has a
value to read; nothing needs to newly thread a tenant id anywhere that doesn't already have one.

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

**Before a single `CREATE POLICY` is written**, prove the four-point wrapping mechanism itself
against a real Postgres connection: two concurrent operations under two different tenant ids, over
the existing pooled connection (`lib/db/client.ts`'s `pg.Pool`, `POOL_MAX` reused connections),
confirming `app.tenant_id` never leaks from one pooled connection's prior request into the next,
and that it is set before — not after, not racing — the query it is meant to protect. A policy
checking a session variable that is not reliably set is a policy that does nothing, and that is
exactly the failure mode that looks correct in a code review and passes every existing test.

This also needs one proof the Client Extension approach would not have: that `loadWorkspace`'s
self-wrapping branch (called bare, `db = prisma`) and its pass-through branch (called with an
explicit `tx` from inside `runBatch`/`schedule.ts`/`importWorkspace`) are never taken by the same
call in a way that nests one transaction inside another — i.e., that the reference-equality check
against the `prisma` singleton reliably tells the two cases apart.

**After the policies exist**, a proof in the shape of `scripts/persistence-proof.ts` — call it
`scripts/rls-proof.ts` — that deliberately does *not* go through the extension for one query (the
same way a future bug might skip it) and confirms Postgres itself returns zero rows for another
tenant's data, not an error and not the real rows. This is the proof that matters most: every
other proof in this project shows the application behaves correctly; this one shows the database
still refuses even when the application does not.

## What sent this back, already, once

**This condition fired, during plan-writing, before any code was built — and was honored rather
than patched around.** Tracing how an ordinary user-driven CRUD write reaches the database (per
the user's explicit request, "Check for how user will input (CRUD)") found that `persist.ts`'s
`runBatch` opens `prisma.$transaction(async (tx) => { const { state } = await
loadWorkspace(tenantId, tx); ... })` — and `loadWorkspace` fires 32 concurrent queries through
that same `tx`. `runBatch`'s own comment explains why the read has to happen inside that
transaction: two concurrent batches must not both read the pre-change state and have the second
silently overwrite the first with no error and no audit entry. A `query.$allOperations` Client
Extension hook cannot distinguish "this call arrived via `tx`, already inside `runBatch`'s
transaction" from "this call arrived bare" — wrapping every intercepted call in its own new
transaction regardless would either nest incorrectly or pull `loadWorkspace`'s 32 reads *out* of
`runBatch`'s transaction, reintroducing exactly the last-write-wins race `persist.ts` exists to
prevent, invisibly. This is that send-back condition, worded as it stood before the mechanism
changed — kept here as the record of why the mechanism above is not the one this design opened
with:

- ~~If the Client Extension approach, once built against `boot()`'s real transaction, cannot
  reliably guarantee `set_config` runs on the same connection as the query it protects for every
  shape of call this codebase actually makes (bare, batch-array `$transaction`, interactive
  `$transaction`) — that is a real gap in "the extension handles it," not a detail to patch
  around in one call site while leaving others exposed.~~ **Fired.** Replaced by the four-point
  wrapping mechanism above, which has no such ambiguity because it wraps the transactions
  themselves rather than intercepting queries after the fact.

## What would send this back, from here

- If the reference-equality check `loadWorkspace` uses to tell "called bare" from "called with a
  caller's `tx`" turns out not to reliably distinguish them (e.g. a future caller wraps `prisma`
  in something that breaks identity, or passes a client extension of `prisma` itself as `db`) —
  that is a real gap in the same family as the one above, not a detail to patch around.
- If `FORCE ROW LEVEL SECURITY` turns out to break a legitimate operational path this design
  did not anticipate (a migration script, a seed script, an operator's own `psql` session using
  the same connection string) — that is a finding about how this deployment is actually operated,
  not something to work around by weakening the policy.
