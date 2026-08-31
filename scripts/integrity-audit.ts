/**
 * Referential integrity over records already stored — read-only, against the real tenant.
 *
 * Run with `npm run audit:integrity`.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * `.claude/skills/axiomate-data-integrity/SKILL.md` named seven real risk areas in this
 * schema's shape and said plainly that nothing checks them: `npm run audit:persistence` proves
 * a written value survives Postgres unchanged (a mapper-fidelity question), which is a
 * different concern from whether a stored reference still points at something live. This is
 * that check, finally run.
 *
 * ---------------------------------------------------------------------------
 * Why it reads the real tenant rather than a scratch one
 *
 * Every other proof in this directory (`persistence-proof.ts`, `restore-proof.ts`) creates its
 * own tenant, writes deliberately, and scrubs itself — because they are testing WRITES. This
 * audits what is already there. It never writes anything, so there is nothing to scrub, and the
 * one tenant worth checking is the one people actually use.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { loadWorkspace } from '../lib/db/repo'
import { runIntegrityChecks } from '../lib/dataIntegrity'
import { currentTenantId } from '../lib/tenant'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This audit reads stored state and needs a database.')
  process.exit(1)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

async function main() {
  const tenantId = currentTenantId()
  const { state } = await loadWorkspace(tenantId, prisma)
  const results = runIntegrityChecks(state)

  console.log('')
  console.log('AXIOMATE — DATA INTEGRITY AUDIT')
  console.log(`Tenant: ${tenantId}. Read-only — nothing here writes.`)
  console.log('')

  let errors = 0
  let reviews = 0
  for (const check of results) {
    const tag = check.kind === 'error' ? 'ERROR' : 'REVIEW'
    console.log(`${check.label} [${tag}] — ${check.findings.length} finding(s)`)
    for (const f of check.findings) {
      console.log(`  ${f.subject}: ${f.message}`)
      if (check.kind === 'error') errors++
      else reviews++
    }
  }

  console.log('')
  console.log(`${errors} error(s), ${reviews} review finding(s) worth a look.`)
  if (errors === 0 && reviews === 0) {
    console.log('Nothing to report — every check came back quiet.')
  }
}

main()
  .catch((err) => {
    console.log('')
    console.log('The audit could not complete:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
