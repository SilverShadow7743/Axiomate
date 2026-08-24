/**
 * Does Postgres refuse another tenant's rows even when the application's own discipline is
 * skipped — not just when it is followed?
 *
 * Run with `npm run audit:rls`, against a real database, after the migration in
 * `prisma/migrations/20260824000004_row_level_security` has been applied.
 *
 * ---------------------------------------------------------------------------
 * Why this is the proof that matters most
 *
 * Every other proof in this project — `audit:persistence`, `scripts/rls-mechanism-proof.ts` —
 * shows the *application* behaving correctly: `loadWorkspace` and `persistActions` set
 * `app.tenant_id` and see only what they should. None of that proves the database would refuse
 * a query that skipped the setup — a future bug, a new script, a call site nobody wired. This
 * one does, by deliberately being that bug: it opens a connection that never calls
 * `withTenant`, `loadWorkspace`, or any of the app's own four transaction-opening points, and
 * asks Postgres for another tenant's row by name. The row-level-security design's own words:
 * "a policy checking a session variable that is not reliably set is a policy that does nothing,
 * and that is exactly the failure mode that looks correct in a code review and passes every
 * existing test." This is the check that is not fooled by that.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does
 *
 * Two of its own tenants, cleaned up at the end through the ordinary wrapped path — the
 * cleanup itself is proof that a bare, unwrapped `deleteMany` would no longer work, so it does
 * not attempt one.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { importWorkspace, loadWorkspace } from '../lib/db/repo'
import { withTenant } from '../lib/db/client'
import { initWorkspace, type SeedIssueInput } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This proof needs a database — see .env.example.')
  process.exit(1)
}

const TENANT_A = 'proof-rls-a' as TenantId
const TENANT_B = 'proof-rls-b' as TenantId

// The app's own client, going through every one of its wrapped points — this is the control.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

// A second, entirely separate connection that never calls withTenant, loadWorkspace, or any
// wrapped point — the deliberate bypass. Built from the same driver the app uses, so what is
// being tested is Postgres's own policy, not a difference in client library.
const bypass = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

const seedIssue = (id: string): SeedIssueInput =>
  ({
    id, client: 'PROOF-RLS', engagement: 'Proof RLS Engagement', module: 'Inventory',
    subject: `Subject ${id}`, description: '', type: 'Defect', severity: 'High',
    status: 'Open', owner: 'Priya', raisedBy: 'Client', accountable: 'Unassigned',
    raised: '2026-08-24', lastActivity: '2026-08-24', actualEnd: null, age: 1,
    daysSinceActivity: 1, nextAction: '', evidence: '', evidenceDate: '',
    verification: '', source: 'Proof', reference: '', clientImpact: '',
  }) as SeedIssueInput

async function scrub(tenantId: TenantId) {
  await withTenant(tenantId, async (tx) => {
    await tx.hierarchyNode.updateMany({ where: { tenantId }, data: { parentId: null } })
    await tx.issue.deleteMany({ where: { tenantId } })
    await tx.hierarchyNode.deleteMany({ where: { tenantId } })
    await tx.workspaceMeta.deleteMany({ where: { tenantId } })
  })
}

async function main() {
  console.log('--- RLS proof (requires the migration to already be applied) ---\n')

  /* ---------------- 1. seed two tenants through the normal wrapped path ---------------- */
  const seedA = initWorkspace([seedIssue('RLSA-1')], [])
  const seedB = initWorkspace([seedIssue('RLSB-1')], [])
  const [a, b] = await Promise.all([
    importWorkspace(TENANT_A, seedA),
    importWorkspace(TENANT_B, seedB),
  ])
  check('tenant A seeds one issue', a.imported && a.counts.issues === 1, `imported=${a.imported}, issues=${a.counts.issues}`)
  check('tenant B seeds one issue', b.imported && b.counts.issues === 1, `imported=${b.imported}, issues=${b.counts.issues}`)

  /* ---------------- 2. the ordinary wrapped path sees only its own tenant --------------- */
  const loadedA = await loadWorkspace(TENANT_A)
  const loadedB = await loadWorkspace(TENANT_B)
  const idsA = Object.keys(loadedA.state.issues)
  const idsB = Object.keys(loadedB.state.issues)
  check(
    'loadWorkspace(A) sees exactly A\'s issue, not B\'s',
    idsA.length === 1 && idsA[0] === 'RLSA-1',
    `A saw [${idsA.join(', ')}]`,
  )
  check(
    'loadWorkspace(B) sees exactly B\'s issue, not A\'s',
    idsB.length === 1 && idsB[0] === 'RLSB-1',
    `B saw [${idsB.join(', ')}]`,
  )

  /* ---------------- 3. the deliberate bypass: no set_config, no withTenant -------------- */
  // A raw query, on a connection that never once called withTenant or loadWorkspace, naming
  // tenant A's row explicitly by id in its own WHERE clause. If RLS is doing its job, the
  // WHERE clause naming the right tenant is irrelevant — current_setting('app.tenant_id', true)
  // is unset on this connection, so the policy hides the row regardless of what the query asks
  // for by name.
  const bypassed = await bypass.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Issue" WHERE "tenantId" = ${TENANT_A}
  `
  check(
    'a query with no app.tenant_id set sees zero rows, not the real row and not an error',
    bypassed.length === 0,
    `${bypassed.length} row(s) returned`,
  )

  /* ---------------- cleanup ---------------- */
  await scrub(TENANT_A)
  await scrub(TENANT_B)
  const [afterA, afterB] = await Promise.all([loadWorkspace(TENANT_A), loadWorkspace(TENANT_B)])
  check(
    'cleanup, through the wrapped path, actually removed both proof tenants\' rows',
    Object.keys(afterA.state.issues).length === 0 && Object.keys(afterB.state.issues).length === 0,
    `A left with ${Object.keys(afterA.state.issues).length}, B left with ${Object.keys(afterB.state.issues).length}`,
  )
}

main()
  .then(() => {
    console.log('')
    if (fail.length) {
      console.log('FAIL: ' + fail.join(', '))
      process.exit(1)
    }
    console.log('RLS: the database refuses another tenant\'s rows even when the application does not ask it to.')
  })
  .catch(async (err) => {
    console.log('')
    console.log('The proof could not complete:', err instanceof Error ? err.message : err)
    // A failed run may have left rows behind; try to clean up rather than leaving the next run
    // to collide with them and report something confusing far from the cause.
    await Promise.all([scrub(TENANT_A), scrub(TENANT_B)]).catch((e) => {
      console.log('The cleanup also failed:', e instanceof Error ? e.message : e)
    })
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await bypass.$disconnect()
  })
