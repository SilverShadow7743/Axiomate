/**
 * AC7 — the tenant-composite FK, not application code, makes cross-tenant reference impossible.
 *
 * Run with `npx tsx scripts/catalogue-tenant-fk-proof.ts`, against a real database, after the
 * migration in `prisma/migrations/20260916075746_add_catalogue_entry` has been applied.
 *
 * ---------------------------------------------------------------------------
 * What this proves, and how
 *
 * `HierarchyNode.catalogueEntryId` / `ScopeItem.catalogueEntryId` are declared
 * `@relation(fields: [tenantId, catalogueEntryId], references: [tenantId, id])` — the same
 * tenant-composite shape `sowId` already uses (schema.prisma:201/1586). That means a row in
 * tenant B naming a `CatalogueEntry.id` that only exists under tenant A cannot satisfy the
 * foreign key, no matter what application code intended to check, because there is no
 * `(tenantId=B, id=<that id>)` row for it to reference. This script creates exactly that
 * situation directly against Postgres and asserts the database — not a reducer guard, not a
 * script-level check — is what refuses it (`P2003`, foreign key constraint violation).
 *
 * Two same-tenant controls run alongside the two cross-tenant attempts, writing the identical
 * shape of row under the SAME tenant the `CatalogueEntry` belongs to. If a control failed too,
 * that would mean something else about the fixture is wrong (a bad row shape, a missing
 * dependency) and the cross-tenant failure would prove nothing. Both controls must succeed for
 * the cross-tenant rejections to mean what AC7 says they mean.
 *
 * `HierarchyNode`, `Sow` and `ScopeItem` all carry row-level security — confirmed by grep, not
 * assumed from this migration's header comment: all three get their own `ENABLE/FORCE ROW LEVEL
 * SECURITY` and `tenant_isolation` policy in `prisma/migrations/20260824000004_row_level_security`
 * (`Sow` at its line 98, `ScopeItem` at its line 168) — so every write to them here goes through
 * `runAsTenant` (this file's own `withTenant`, see below) to set `app.tenant_id` to the row's OWN
 * tenant first — otherwise RLS's `WITH CHECK`
 * would refuse the insert before the FK constraint ever had a chance to run, and a pass would
 * prove the wrong thing.
 *
 * **`CatalogueEntry` now carries row-level security.** Its creation migration
 * (`20260916075746_add_catalogue_entry`) originally shipped with no RLS statement at all — a real
 * gap against this codebase's own established pattern, flagged here as a checked note when this
 * script was first written. That gap has since been closed in the same migration (fix recorded
 * against ART-20260914-004's finding; see ART-20260916-002): `CatalogueEntry` now gets the
 * identical `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy every other table added
 * after 2026-08-24 gets in the migration that creates it. AC7's FK guarantee never depended on
 * this either way (a composite FK check runs outside row security — see the "What this proves"
 * note above), so nothing about what this proof demonstrates changes. What does change: every
 * `prisma.catalogueEntry.*` call in this file now runs inside `runAsTenant`, same as every other
 * RLS-covered table here — an unwrapped call would now see zero rows (`findMany`/`count`) or be
 * rejected outright (`create`), not the real behaviour.
 *
 * ---------------------------------------------------------------------------
 * AC8/AC9 — checked note, not a code change
 *
 * v1 ships no flow that ever sets `catalogueEntryId` on a `HierarchyNode` or `ScopeItem` (OQ1,
 * confirmed accepted gap) — `scripts/import-d365-catalogue.ts` only ever writes `CatalogueEntry`
 * rows themselves (AC6, BR4). `work.move` and `scope.edit`'s gates on linking (AC8/AC9) govern a
 * write path that does not exist yet, so they are unreached by this change, not newly exercised
 * by it. Nothing here calls either action, and nothing in this plan adds a UI or API path that
 * would.
 *
 * ---------------------------------------------------------------------------
 * `npm run audit:tenancy` coverage note
 *
 * That audit scans `lib/db` only — it does not see this script's direct
 * `prisma.catalogueEntry.*` / `prisma.hierarchyNode.*` / `prisma.sow.*` / `prisma.scopeItem.*`
 * calls under `scripts/`, since the standing tenancy audit does not cover `scripts/` at all.
 * Every call in this file, and every call in steps 4-5 (`scripts/import-d365-catalogue.ts`), was
 * hand-verified to carry an explicit `tenantId` rather than relying on that audit to catch a
 * missing one.
 *
 * ---------------------------------------------------------------------------
 * Why `withTenant` is reimplemented here instead of imported from `lib/db/client.ts`
 *
 * This script must run as exactly `npx tsx scripts/catalogue-tenant-fk-proof.ts`, with no extra
 * flags. `lib/db/client.ts` (the real `withTenant`) begins `import 'server-only'`, which THROWS
 * under a bare `tsx` run — `scripts/rls-proof.ts` needs the same function and is the reason
 * `package.json`'s `audit:rls` script exists at all: `npx tsx --conditions=react-server
 * scripts/rls-proof.ts`. Adding a matching flag or npm script is not available here — this
 * script's owns-list is `scripts/catalogue-tenant-fk-proof.ts` alone, not `package.json`, and
 * the run command is fixed. So the three lines `withTenant` actually does (open a transaction,
 * `set_config('app.tenant_id', ...)`, run the callback) are duplicated below as `runAsTenant`
 * rather than imported — the single-source-of-truth concern `lib/db/client.ts`'s own comment
 * raises is about `lib/db`'s six call sites, which this file is not one of.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import type { TenantId } from '../lib/tenant'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This proof needs a database — see .env.example.')
  process.exit(1)
}

// The app's own client, going through runAsTenant for every RLS-covered table, CatalogueEntry
// included as of this migration's fix (see the module doc) — this is the control path.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

/**
 * `lib/db/client.ts`'s `withTenant`, reimplemented here without the `server-only` import — see
 * the module doc's "Why `withTenant` is reimplemented here" note. Identical behaviour: a fresh
 * transaction with `app.tenant_id` set first, the one thing every RLS-covered table's policy
 * checks.
 */
async function runAsTenant<T>(tenantId: TenantId, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

const TENANT_A = 'proof-catalogue-fk-a' as TenantId
const TENANT_B = 'proof-catalogue-fk-b' as TenantId

const ENTRY_ID = 'proof.catalogue.fk.001'

const NODE_CONTROL_A = 'proof-catalogue-fk-node-control-a'
const NODE_ATTACK_B = 'proof-catalogue-fk-node-attack-b'

const ENGAGEMENT_A = 'proof-catalogue-fk-engagement-a'
const ENGAGEMENT_B = 'proof-catalogue-fk-engagement-b'
const SOW_CONTROL_A = 'proof-catalogue-fk-sow-control-a'
const SOW_ATTACK_B = 'proof-catalogue-fk-sow-attack-b'
const SCOPE_CONTROL_A = 'proof-catalogue-fk-scope-control-a'
const SCOPE_ATTACK_B = 'proof-catalogue-fk-scope-attack-b'

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

function prismaCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code
}

/** Every row this proof might have left behind, in dependency order — children before parents. */
async function scrub() {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await runAsTenant(tenantId, async (tx) => {
      await tx.scopeItem.deleteMany({ where: { tenantId } })
      await tx.sow.deleteMany({ where: { tenantId } })
      await tx.hierarchyNode.deleteMany({ where: { tenantId } })
    })
  }
  await runAsTenant(TENANT_A, (tx) => tx.catalogueEntry.deleteMany({ where: { tenantId: TENANT_A, id: ENTRY_ID } }))
}

async function main() {
  console.log('--- Catalogue tenant-FK proof (AC7) ---\n')

  await prisma.tenant.upsert({
    where: { id: TENANT_A },
    update: {},
    create: { id: TENANT_A, name: 'Proof Catalogue FK Tenant A' },
  })
  await prisma.tenant.upsert({
    where: { id: TENANT_B },
    update: {},
    create: { id: TENANT_B, name: 'Proof Catalogue FK Tenant B' },
  })

  await scrub()

  /* ---------------- 1. seed a CatalogueEntry under tenant A only ---------------- */
  const entry = await runAsTenant(TENANT_A, (tx) =>
    tx.catalogueEntry.create({
      data: { tenantId: TENANT_A, id: ENTRY_ID, level: 'process-area', name: 'Proof catalogue entry', status: 'live' },
    }),
  )
  check(
    'CatalogueEntry created under tenant A, not tenant B',
    entry.tenantId === TENANT_A && entry.id === ENTRY_ID,
    `tenantId=${entry.tenantId}`,
  )

  /* ---------------- 2. HierarchyNode — same-tenant control (must succeed) ---------------- */
  let controlNodeOk = false
  let controlNodeDetail = ''
  try {
    const node = await runAsTenant(TENANT_A, (tx) =>
      tx.hierarchyNode.create({
        data: { tenantId: TENANT_A, id: NODE_CONTROL_A, kind: 'process-area', name: 'Control node (tenant A)', catalogueEntryId: ENTRY_ID },
      }),
    )
    controlNodeOk = node.catalogueEntryId === ENTRY_ID
  } catch (e) {
    controlNodeDetail = `unexpectedly rejected: ${e instanceof Error ? e.message : e}`
  }
  check('control: HierarchyNode.catalogueEntryId accepted within the SAME tenant as the entry', controlNodeOk, controlNodeDetail)

  /* ---------------- 3. HierarchyNode — cross-tenant attack (must be rejected by the DB) ------- */
  let attackNodeRejected = false
  let attackNodeCode: string | undefined
  try {
    await runAsTenant(TENANT_B, (tx) =>
      tx.hierarchyNode.create({
        data: { tenantId: TENANT_B, id: NODE_ATTACK_B, kind: 'process-area', name: 'Attack node (tenant B)', catalogueEntryId: ENTRY_ID },
      }),
    )
  } catch (e) {
    attackNodeRejected = true
    attackNodeCode = prismaCode(e)
  }
  check(
    'attack: HierarchyNode.catalogueEntryId set to tenant A\'s entry id, from tenant B, is REJECTED by the database',
    attackNodeRejected && attackNodeCode === 'P2003',
    `rejected=${attackNodeRejected}, code=${attackNodeCode}`,
  )

  /* ---------------- 4. scaffolding both tenants need for a ScopeItem: engagement + Sow -------- */
  await runAsTenant(TENANT_A, (tx) =>
    tx.hierarchyNode.create({ data: { tenantId: TENANT_A, id: ENGAGEMENT_A, kind: 'ENGAGEMENT', name: 'Proof engagement (tenant A)' } }),
  )
  await runAsTenant(TENANT_B, (tx) =>
    tx.hierarchyNode.create({ data: { tenantId: TENANT_B, id: ENGAGEMENT_B, kind: 'ENGAGEMENT', name: 'Proof engagement (tenant B)' } }),
  )
  const now = new Date()
  await runAsTenant(TENANT_A, (tx) =>
    tx.sow.create({
      data: {
        tenantId: TENANT_A, id: SOW_CONTROL_A, engagementId: ENGAGEMENT_A,
        reference: 'PROOF-FK-A-1', title: 'Proof SOW (tenant A)', status: 'draft',
        scope: '', exclusions: '', acceptanceCriteria: '', createdBy: 'catalogue-tenant-fk-proof', createdAt: now,
      },
    }),
  )
  await runAsTenant(TENANT_B, (tx) =>
    tx.sow.create({
      data: {
        tenantId: TENANT_B, id: SOW_ATTACK_B, engagementId: ENGAGEMENT_B,
        reference: 'PROOF-FK-B-1', title: 'Proof SOW (tenant B)', status: 'draft',
        scope: '', exclusions: '', acceptanceCriteria: '', createdBy: 'catalogue-tenant-fk-proof', createdAt: now,
      },
    }),
  )

  /* ---------------- 5. ScopeItem — same-tenant control (must succeed) ---------------- */
  let controlScopeOk = false
  let controlScopeDetail = ''
  try {
    const scope = await runAsTenant(TENANT_A, (tx) =>
      tx.scopeItem.create({
        data: {
          tenantId: TENANT_A, id: SCOPE_CONTROL_A, sowId: SOW_CONTROL_A, kind: 'process',
          text: 'Control scope item (tenant A)', source: 'stated', sequence: 1,
          recordedBy: 'catalogue-tenant-fk-proof', recordedAt: now, catalogueEntryId: ENTRY_ID,
        },
      }),
    )
    controlScopeOk = scope.catalogueEntryId === ENTRY_ID
  } catch (e) {
    controlScopeDetail = `unexpectedly rejected: ${e instanceof Error ? e.message : e}`
  }
  check('control: ScopeItem.catalogueEntryId accepted within the SAME tenant as the entry', controlScopeOk, controlScopeDetail)

  /* ---------------- 6. ScopeItem — cross-tenant attack (must be rejected by the DB) ----------- */
  let attackScopeRejected = false
  let attackScopeCode: string | undefined
  try {
    await runAsTenant(TENANT_B, (tx) =>
      tx.scopeItem.create({
        data: {
          tenantId: TENANT_B, id: SCOPE_ATTACK_B, sowId: SOW_ATTACK_B, kind: 'process',
          text: 'Attack scope item (tenant B)', source: 'stated', sequence: 1,
          recordedBy: 'catalogue-tenant-fk-proof', recordedAt: now, catalogueEntryId: ENTRY_ID,
        },
      }),
    )
  } catch (e) {
    attackScopeRejected = true
    attackScopeCode = prismaCode(e)
  }
  check(
    'attack: ScopeItem.catalogueEntryId set to tenant A\'s entry id, from tenant B, is REJECTED by the database',
    attackScopeRejected && attackScopeCode === 'P2003',
    `rejected=${attackScopeRejected}, code=${attackScopeCode}`,
  )

  /* ---------------- cleanup ---------------- */
  await scrub()
  const countTenant = (tenantId: TenantId) =>
    runAsTenant(tenantId, async (tx) => {
      const [nodes, sows, scopeItems] = await Promise.all([
        tx.hierarchyNode.count({ where: { tenantId } }),
        tx.sow.count({ where: { tenantId } }),
        tx.scopeItem.count({ where: { tenantId } }),
      ])
      return nodes + sows + scopeItems
    })
  const [leftA, leftB, leftEntries] = await Promise.all([
    countTenant(TENANT_A),
    countTenant(TENANT_B),
    runAsTenant(TENANT_A, (tx) => tx.catalogueEntry.count({ where: { tenantId: TENANT_A, id: ENTRY_ID } })),
  ])
  check(
    'cleanup removed every proof row (HierarchyNode, Sow, ScopeItem, CatalogueEntry) from both tenants',
    leftA === 0 && leftB === 0 && leftEntries === 0,
    `A left with ${leftA}, B left with ${leftB}, CatalogueEntry left with ${leftEntries}`,
  )
}

main()
  .then(() => {
    console.log('')
    if (fail.length) {
      console.log('FAIL: ' + fail.join(', '))
      process.exit(1)
    }
    console.log(
      'AC7: the tenant-composite foreign key rejects a cross-tenant CatalogueEntry reference on ' +
        'both HierarchyNode.catalogueEntryId and ScopeItem.catalogueEntryId — the database refuses ' +
        'it, not application code. AC8/AC9 checked: v1 sets catalogueEntryId nowhere, so those ' +
        'gates are unreached, not exercised, by this change.',
    )
  })
  .catch(async (err) => {
    console.log('')
    console.log('The proof could not complete:', err instanceof Error ? err.message : err)
    await scrub().catch((e) => {
      console.log('The cleanup also failed:', e instanceof Error ? e.message : e)
    })
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
