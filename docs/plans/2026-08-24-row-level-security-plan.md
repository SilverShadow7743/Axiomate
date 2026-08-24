# Row-level security — implementation plan

Follows `docs/plans/2026-08-24-row-level-security-design.md`, approved and then revised once
during this plan's own writing — see that document's "What sent this back, already, once". The
mechanism below is the *revised* one: four hand-placed `set_config` calls at the codebase's three
real transaction boundaries plus `loadWorkspace`'s own self-wrap, not the Client Extension the
design opened with. Quotes below are from the design as it now stands.

**Ordering principle.** Nothing here is pure logic in the reducer sense — this is infrastructure,
not `apply()`. The equivalent discipline is the design's own: *"Before a single `CREATE POLICY` is
written, prove the [...] mechanism itself against a real Postgres connection."* So the order is
mechanism → proof the mechanism changed nothing it shouldn't → schema → proof the schema does what
it claims → production. Nothing schema-level happens until everything before it is proven against
a real, already-live database, because this design's own send-back list has already fired once
from evidence found by tracing real call paths rather than trusting the design as written.

## Step 1 — Wire the four `set_config` points

**Files:**
- `lib/db/repo.ts` — `loadWorkspace`. At the top of the function, branch on whether `db` is the
  bare `prisma` singleton (`db === prisma`, reference equality against the import from
  `./client` — safe because `prisma` is a stable module-level `Proxy` and a transaction client is
  never that same object) or a caller-supplied `tx`. Bare: open
  `prisma.$transaction(async (tx) => { await tx.$executeRaw\`SELECT
  set_config('app.tenant_id', ${tenantId}, true)\`; return loadWorkspaceInner(tenantId, tx) })`
  where `loadWorkspaceInner` is the existing 32-query `Promise.all` body, extracted unchanged.
  Passed a `tx`: call `loadWorkspaceInner(tenantId, db)` directly — no new transaction, no
  `set_config`, because the caller already set it on that `tx` (steps below).
- `lib/db/repo.ts` — `importWorkspace`. One `tx.$executeRaw` line added at the top of its existing
  `prisma.$transaction(async (tx) => {...})`, before its first read or write.
- `lib/db/persist.ts` — `runBatch`. Same one-line addition, at the top of its
  `prisma.$transaction(async (tx) => {...}, { isolationLevel: 'Serializable', ... })`, before its
  `loadWorkspace(tenantId, tx)` call. This is the design's own documented risk point — the exact
  transaction whose read-inside-write ordering the whole mechanism was redesigned around.
- `lib/db/schedule.ts` — same, at the top of its `prisma.$transaction(async (tx) => {...})`,
  before its `loadWorkspace(tenantId, tx)` call at line 46.

`app/api/health/route.ts`'s probe (`prisma.$queryRaw\`SELECT 1\``) touches no table and needs
nothing — checked, not an oversight.

**Addendum, found while preparing step 3 and fixed before step 5 ever touched production.** A
second sweep — `grep` for bare `prisma.<model>.<verb>(` across all of `app/` and `lib/`, this time
covering reads as well as writes — found three more bare calls the first pass missed, one of them
severe enough that applying the migration without fixing it first would have taken the live
application's persistence offline on the very next page load:

- `repo.ts`'s `importWorkspace`, its own pre-check (`const existing = await
  prisma.workspaceMeta.findUnique(...)`), runs *before* that function's transaction opens. Once
  RLS is live, a bare read like this always sees nothing, so `existing?.seededAt` reads as falsy
  for a tenant that has been seeded for months — `importWorkspace` proceeds to re-import, its own
  transaction's `tx.workspaceMeta.create` then throws the unique-constraint violation it actually
  has, and `boot()`'s `catch` block returns `persistence: { enabled: false, note: 'Running from
  the issue log. Changes are not being saved.' }` — on every request, forever. This is the one
  that would have been found immediately in step 5.3, at the earliest, and would have looked like
  the whole database had gone down rather than like a scoping gap.
- `boot.ts`'s own `prisma.scheduleWatch.findUnique(...)`, called right after `loadWorkspace` in
  the same function to populate the "when did the pass last run" banner (`pass.lastRunAt`/
  `lastSummary`). Silently reads as never-run on every page load once RLS is live — a real,
  user-visible regression, just not a fatal one.
- `persist.ts`'s `pruneAppliedActions`, called daily by `app/api/schedule/run/route.ts`. Its own
  comment explains it is deliberately *outside* `runBatch`'s transaction, to avoid serializable-
  isolation contention with concurrent batches over the same expired rows. Once RLS is live, an
  unwrapped `deleteMany` here does not contend with anything — it silently deletes zero rows,
  every day, forever, which is low severity (the retained keys are already ignored once expired)
  but is a real, if quiet, permanent regression.

All three needed the same fix as `loadWorkspace`'s bare path — wrap in a transaction, set
`app.tenant_id`, then run the query — so rather than a fourth and fifth hand-written
`$executeRaw`, a single `withTenant(tenantId, (tx) => ...)` helper was added to `lib/db/client.ts`
and all three (plus `loadWorkspace`'s own wrapper, refactored to call it too) now share it. The
three transactional functions that already open their own transaction for other reasons
(`runBatch`, `schedule.ts`, `importWorkspace`'s main body) keep their inline `$executeRaw` as the
first statement rather than switching to `withTenant`, since they need control over their own
transaction's options (isolation level, timeout) that `withTenant` does not expose. `pg_policies`
was not yet queryable at this point (no migration applied), so this was verified the same way as
the rest of step 1: `npx tsc --noEmit`, `rls-mechanism-proof.ts`, and the full regression suite,
all re-run clean after the fix.

This is exactly the class of gap step 3's own risk note describes, found one step earlier than
the plan's own ordering would have caught it — by re-running the same grep with a wider net,
not by trusting the first pass's "no other file changes" claim.

**Verify:** `npx tsc --noEmit`. Then a standalone script,
`scripts/rls-mechanism-proof.ts` (own throwaway tenant ids, same shape as
`persistence-proof.ts`'s header — `dotenv`, its own `PrismaClient`, no reliance on `AXIOMATE_TENANT`),
that runs two concurrent `loadWorkspace` calls under two different tenant ids over the real pooled
connection and, from inside each, reads back `SELECT current_setting('app.tenant_id', true)` to
confirm: (a) it equals the tenant that call passed, and (b) running a *third* bare call with no
tenant context afterward on a connection the pool may reuse does not inherit either prior value —
`set_config(..., true)` is transaction-scoped, so this should hold by construction, but the design
explicitly asks for it proven rather than assumed. No `CREATE POLICY` exists yet, so this step
changes no observable application behavior — it is safe to run against any environment, including
production, before the schema step.

## Step 2 — Prove step 1 changed nothing else

**No files change.** Run the existing regression suite against the now-wrapped paths:

    npx tsc --noEmit
    npm run validate:scenarios      # must still be 135/135, 0 fail
    npm run audit:tenancy           # every tenant-scoped call still names a tenant
    npm run audit:attribution
    npm run audit:persistence       # must still be 55/55 — this is the one that exercises
                                     # persistActions/runBatch and loadWorkspace end to end
                                     # against real Postgres, so it is the proof that the new
                                     # transaction wrapping introduced no deadlock, no changed
                                     # isolation behavior, and no double-wrap
    npm run build

If `audit:persistence` regresses, stop here — it means the wrapping itself is wrong, and step 3
must not proceed until this passes clean. This is the step that would have caught a Client
Extension nesting bug had that mechanism been built instead; it is the same proof obligation,
aimed at the new mechanism.

**Commit steps 1 and 2 together.** The wrapping change is meaningless without the proof that nothing
else moved — half of this is not a shippable state.

## Step 3 — The migration

**File:** `prisma/migrations/20260824000004_row_level_security/migration.sql` (following the
existing `YYYYMMDDNNNNNN_description` naming — `20260824000003_inbound_mail` was today's last).

Generate the statement list from `prisma/schema.prisma`'s own `model` blocks rather than by
hand-counting — every `model` name except `Tenant` (the same exemption `scripts/tenant-audit.mjs`
already encodes: `EXEMPT = new Set(['tenant', '$transaction'])`). For each:

    ALTER TABLE "<Model>" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "<Model>" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "<Model>"
      USING ("tenantId" = current_setting('app.tenant_id', true));

`FORCE` is required — the design's own reasoning: *"needed because the connecting role owns these
tables... and an owner bypasses RLS by default unless forced."* No `WITH CHECK` clause is needed
beyond the `USING` clause reused for both read and write, since every write already goes through
`persistSteps`, which never sets `tenantId` to anything but the value the transaction's own
`set_config` matches.

**Verify:** `npx prisma migrate diff` against the schema to confirm no *other* drift snuck in since
the last migration, then apply locally (`npm run db:migrate:dev` or the project's established
apply command) against a disposable/dev database, then:

    SELECT schemaname, tablename FROM pg_policies;

— confirm the row count equals (model count − 1), and diff the table names against
`schema.prisma`'s own model list to catch an accidental omission by name rather than by count
(a count match with the wrong table swapped in is a silent failure this exact style of check has
been the whole session's discipline to catch).

**This is the step carrying the most regression risk in the entire plan.** Once `FORCE ROW LEVEL
SECURITY` is live, any code path that reaches one of these tables *without* having gone through
one of step 1's four `set_config` points gets **zero rows back, not an error** — `current_setting`
returns an empty string for an unset session variable, the policy compares it against a real
`tenantId` and never matches, and the query succeeds with an empty result set. That is a silent
failure by construction, on a live application already serving real users (per the standing state
document, Tarun Kumar's incident and 216 register issues are live data on this exact database) —
it would read as "the workspace is empty" rather than "access denied," which is the worst version
of every failure mode this session has spent its debugging effort catching. It is why steps 1 and
2 must be complete and green before this step is even drafted, and why step 4 below exists before
this touches production.

## Step 4 — `scripts/rls-proof.ts`

Modeled on `scripts/persistence-proof.ts`'s shape (own throwaway tenant, `dotenv`, its own
`PrismaClient` with the same adapter). Design's own words for what this must prove: *"a proof...
that deliberately does not go through the extension for one query... and confirms Postgres itself
returns zero rows for another tenant's data, not an error and not the real rows."* Concretely:

1. Create two tenants, seed one row each (e.g. one `HierarchyNode`) via the normal wrapped path
   (`importWorkspace`), so both are real, policy-protected data.
2. Through the normal wrapped path, confirm tenant A's `loadWorkspace` sees only tenant A's row,
   tenant B's only tenant B's — this is the "does it isolate" proof, and mostly re-covers step 1's
   own proof, kept here so `rls-proof.ts` stands alone as the single citation for "RLS is proven"
   the way `persistence-proof.ts` is the citation for "persistence is proven".
3. The deliberate-bypass case: open a raw `pg.Pool` connection (or a fresh un-extended
   `PrismaClient`, bypassing every one of step 1's four points on purpose) and query tenant A's
   table with no `set_config` call at all. Confirm the result is an **empty array**, not tenant
   A's row and not an error — proving Postgres refuses even when the application's own discipline
   is skipped, which is the proof this design says *"matters most: every other proof in this
   project shows the application behaves correctly; this one shows the database still refuses
   even when the application does not."*
4. Clean up both tenants' rows at the end, matching `persistence-proof.ts`'s own convention of
   never leaving state behind in a shared database.

Add `"audit:rls": "npx tsx scripts/rls-proof.ts"` to `package.json`'s `scripts`, beside the other
`audit:*` entries.

**Verify:** `npm run audit:rls` passes, run against the same dev/disposable database step 3 was
verified against — not production yet.

**Commit steps 3 and 4 together.** A migration that enables `FORCE ROW LEVEL SECURITY` without the
proof that it actually refuses a bypass is exactly the failure mode the design calls out by name:
*"a policy checking a session variable that is not reliably set is a policy that does nothing, and
that is exactly the failure mode that looks correct in a code review and passes every existing
test."* The migration and its proof are one unit of work, not two.

## Step 5 — Apply to production

Stands alone — no code change, an operational action against the live database backing
`axiomate-tms.azurewebsites.net`. In order:

1. `npm run db:migrate` (== `prisma migrate deploy`) against the production `DATABASE_URL`.
2. Immediately: `npm run audit:rls` pointed at production (its own throwaway tenant ids, cleaned up
   after — does not touch `axiocloud`'s real rows).
3. Smoke-test the live application itself: load the page, confirm the existing tenant's data still
   renders (this is the step that would surface a gap step 1–4 could not — a code path this plan
   did not find, still reaching a protected table unwrapped, now silently empty). Make one small
   real edit through the UI and confirm it saves and reloads correctly.
4. Poll `/api/health` — unaffected by this migration (confirmed in step 1), but part of the
   established post-deploy routine for this project and worth keeping for consistency.

**If step 5.3 shows anything wrong**, the way back is fast and does not require a new migration to
be written under pressure: `ALTER TABLE "<Model>" NO FORCE ROW LEVEL SECURITY; ALTER TABLE
"<Model>" DISABLE ROW LEVEL SECURITY;` per table, or a single migration that reverses all of them.
Worth drafting that reversal SQL alongside step 3's forward migration, not after something has
already gone wrong.

## Details most likely to be gotten wrong

- **The reference-equality check.** `db === prisma` only works because `prisma` (`lib/db/client.ts`)
  is a single `Proxy` object cached across the module's lifetime. If `loadWorkspace` is ever called
  with some other wrapper around the same underlying client — a future logging proxy, a test double
  — the check silently takes the "already transactional" branch and skips `set_config` and its own
  transaction, which is a page render or a script quietly getting zero rows back. This is exactly
  the design's own first "what would send this back" item, listed before any code existed.
- **`loadWorkspaceInner`'s extraction.** The 32-query `Promise.all` must be moved, not copied — a
  copy-paste that leaves two versions to drift is worse than the current single function.
- **`$executeRaw` vs `$executeRawUnsafe`.** Use the tagged-template form (`tx.$executeRaw\`SELECT
  set_config('app.tenant_id', ${tenantId}, true)\``) exclusively — it parameterizes `tenantId`
  automatically. `TenantId` is validated at `currentTenantId()`'s own slug regex, but the raw-SQL
  boundary is not the place to rely on an upstream validation holding; use the safe form regardless.
- **Migration statement order.** `ENABLE` before `FORCE` before `CREATE POLICY`, per table — running
  `FORCE` before `ENABLE` is a Postgres error, not a silent no-op, so this fails loud rather than
  quiet if gotten wrong, which is the safer of the two failure directions available here.
- **Step 5.2's proof must run before step 5.3's smoke test**, not after — the proof is scoped to its
  own throwaway tenant and cannot damage `axiocloud`'s data, so there is no reason to defer it past
  the migration, and running it first is what turns step 5.3 from "the only signal" into "the second
  signal."

## What would send this back to the design

Restated from the design doc's own list, now that the mechanism has changed once already:

- If the reference-equality check does not reliably distinguish "called bare" from "called with a
  caller's already-scoped `tx`" for every real call shape this codebase makes — found in step 1's
  own proof or step 2's regression run — that is a repeat of the same class of gap the Client
  Extension had, not a detail to patch around in one call site.
- If `FORCE ROW LEVEL SECURITY` breaks an operational path this design did not anticipate (a
  migration script, a seed script, an operator's own `psql` session using the same connection
  string) — surfaces at step 5.3 at the earliest if steps 1–4 did not catch it, which is later than
  this plan would like and is the reason step 5.3 is a real smoke test against real UI, not a
  glance at a log.
- If step 4's bypass proof does *not* come back empty — if a raw, unwrapped connection can still see
  another tenant's row — the policy itself is wrong (most likely: `USING` without matching the
  actual column name's exact casing, `"tenantId"` vs `tenantid`), and this stops at step 4, before
  production is touched at all.
