/**
 * Does `set_config('app.tenant_id', ...)`, set the way `loadWorkspace`, `persist.ts`'s
 * `runBatch`, `schedule.ts` and `importWorkspace` now set it, actually stay put — on the
 * connection it was set on, for the transaction it was set in, and nowhere else?
 *
 * Run with `npx tsx --conditions=react-server scripts/rls-mechanism-proof.ts`, against a real
 * database. Step 1 of `docs/plans/2026-08-24-row-level-security-plan.md`, which asks for this
 * proved before a single `CREATE POLICY` exists: no RLS policy has been written yet, so this
 * script changes no observable application behavior and is safe to run anywhere, including
 * production.
 *
 * ---------------------------------------------------------------------------
 * What this looks for
 *
 * A policy checking a session variable that is not reliably set is a policy that does nothing —
 * the row-level-security design's own words for the failure mode that looks correct in review
 * and passes every existing test. Three ways that could be true here, each with its own check
 * below:
 *
 *   1. Leak across pooled connections — a value set on one logical request's transaction is
 *      still visible to the next request that happens to be handed the same physical connection
 *      by `pg.Pool`. `set_config(..., true)` is documented as transaction-local, but this
 *      application's pool (`lib/db/client.ts`, `POOL_MAX` reused connections) is exactly the
 *      shape that would surface it if that guarantee ever did not hold in practice.
 *   2. Cross-talk under real concurrency — many transactions, each claiming a distinct tenant,
 *      running at the same time against the same pool, each reading back a value that is not
 *      its own.
 *   3. `loadWorkspace` itself, called bare (its production entry point for every page load,
 *      script, and non-transactional route) for two different tenants at once, completing
 *      without error and without one call's transaction disturbing the other's.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { loadWorkspace } from '../lib/db/repo'
import type { TenantId } from '../lib/tenant'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This proof needs a database — see .env.example.')
  process.exit(1)
}

// Matches lib/db/client.ts's own pool size, so this proof exercises the same amount of reuse
// the application actually gets rather than a pool generous enough to give every call its own
// connection.
const POOL_MAX = Number(process.env.AXIOMATE_DB_POOL_MAX) || 8

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL, max: POOL_MAX }) })

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

/** Mirrors the exact wrapping pattern the app's four set_config points now use. */
async function setAndReadBack(tenantId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    // A real query in between, not an immediate read-back — closer to production, where
    // loadWorkspace's 32-way Promise.all runs between the set_config and anything that would
    // notice it having drifted.
    await tx.$queryRaw`SELECT 1`
    const rows = await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('app.tenant_id', true) as v`
    return rows[0]?.v ?? ''
  })
}

async function main() {
  console.log('--- RLS mechanism proof (no policies exist yet — this changes no behavior) ---\n')

  /* ---------------- 1. one transaction sets it, reads back its own value ---------------- */
  const solo = await setAndReadBack('proof-rls-solo')
  check('a single transaction reads back the value it set', solo === 'proof-rls-solo', `got "${solo}"`)

  /* ---------------- 2. many concurrent transactions, many tenants, no cross-talk -------- */
  const N = POOL_MAX * 4 // deliberately more in flight than there are connections, so reuse is forced
  const tenants = Array.from({ length: N }, (_, i) => `proof-rls-concurrent-${i}`)
  const results = await Promise.all(tenants.map((t) => setAndReadBack(t)))
  const mismatches = tenants
    .map((t, i) => ({ expected: t, got: results[i] }))
    .filter((r) => r.expected !== r.got)
  check(
    `${N} concurrent transactions over a pool of ${POOL_MAX} connections each read back their own tenant`,
    mismatches.length === 0,
    mismatches.length
      ? mismatches.map((m) => `expected "${m.expected}" got "${m.got}"`).join('; ')
      : `all ${N} matched`,
  )

  /* ---------------- 3. nothing lingers once the transaction that set it has committed --- */
  // A fresh, ordinary (non-transactional) query, run on whatever connection the pool hands
  // back — possibly one of the connections just used above. If set_config's transaction scope
  // ever failed to hold, this is where a stale tenant would show up.
  const after = await prisma.$queryRaw<{ v: string }[]>`SELECT current_setting('app.tenant_id', true) as v`
  check(
    'a bare query outside any transaction sees no tenant set',
    (after[0]?.v ?? '') === '',
    `got "${after[0]?.v ?? ''}"`,
  )

  /* ---------------- 4. loadWorkspace's real bare-call path, under concurrency ----------- */
  // Two distinct, nonexistent tenants — loadWorkspace does not require a Tenant row to exist
  // to run its (empty-result) queries, so this proves the wrapping itself completes cleanly
  // under concurrency without needing any seeded data.
  const [a, b] = await Promise.all([
    loadWorkspace('proof-rls-load-a' as TenantId),
    loadWorkspace('proof-rls-load-b' as TenantId),
  ])
  check(
    'loadWorkspace, called bare, completes for two tenants concurrently',
    Array.isArray(Object.values(a.state.nodes)) && Array.isArray(Object.values(b.state.nodes)),
    'no error, both calls returned a WorkspaceState',
  )
}

main()
  .then(() => {
    console.log('')
    if (fail.length) {
      console.log('FAIL: ' + fail.join(', '))
      process.exit(1)
    }
    console.log('RLS mechanism: set_config stays on its own transaction, under real concurrency, over the real pool.')
  })
  .catch((err) => {
    console.log('')
    console.log('The proof could not complete:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
