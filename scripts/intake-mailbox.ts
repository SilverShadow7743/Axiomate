/**
 * Configure the mailbox intake watches, and where what arrives is filed.
 *
 * The address here and the address the Logic App polls have to be **the same string**. The
 * workflow sends the mailbox address as the payload's `to`, and the endpoint matches it against
 * this configuration; a mismatch of one character refuses every message with 422 and the run
 * history looks like a mailbox nobody wrote to.
 *
 * ---------------------------------------------------------------------------
 * One address now, one per engagement later
 *
 * `sekharn@axiocloudsolutions.com` for every engagement, filed to `company:root`. That is the
 * operating partner's own address, which is a deliberate starting point rather than a shortcut:
 * it is the mailbox that already receives this correspondence, so nothing has to be created or
 * forwarded before intake can be watched working, and everything that arrives lands somewhere a
 * person is already reading.
 *
 * `company:root` rather than an engagement, because one address cannot tell OAPIL's mail from
 * SLG's. Filing everything at the root and letting somebody move it is honest; guessing the
 * engagement from the sender's domain would be a routing rule nobody wrote, and it would be
 * wrong for every client who copies in a colleague.
 *
 * The intended shape is one address per engagement — `oapil@`, `slg@` — at which point each gets
 * its own row here with its own `scopeId`, the guessing problem disappears, and this row either
 * narrows to Axiomate's own work or goes away. `IntakeMailbox` is already a list for that reason;
 * nothing about this needs redesigning to get there.
 *
 *   npx tsx --conditions=react-server scripts/intake-mailbox.ts          # dry run
 *   npx tsx --conditions=react-server scripts/intake-mailbox.ts --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'intake-mailbox', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

const ADDRESS = process.env.AXIOMATE_INTAKE_ADDRESS ?? 'sekharn@axiocloudsolutions.com'
const SCOPE = process.env.AXIOMATE_INTAKE_SCOPE ?? 'company:root'

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const existing = state.model.intake ?? []

  const scope = state.nodes[SCOPE]
  if (!scope || scope.deletedAt) {
    console.error(`Scope "${SCOPE}" does not exist, so anything arriving would have nowhere to go.`)
    process.exit(1)
  }

  const already = existing.find((m) => m.address.toLowerCase() === ADDRESS.toLowerCase())
  console.log('AXIOMATE — INTAKE MAILBOX\n')
  console.log(`  address  : ${ADDRESS}`)
  console.log(`  files to : ${SCOPE}  (${scope.name})`)
  console.log(`  existing : ${existing.length} mailbox(es) configured`)

  if (already) {
    console.log(`\n  Already configured, filing to ${already.scopeId}. Nothing to do.`)
    return
  }

  /*
   * `workflowId: null` — no agent chain runs on arrival. The classification the endpoint does on
   * its own already reports itself as guessed rather than stated, and adding a workflow before
   * anybody has watched a single real message arrive would be turning on inference on top of a
   * path nobody has seen work yet.
   */
  const action = {
    t: 'config',
    op: {
      k: 'upsertIntake' as const,
      id: null,
      patch: { address: ADDRESS, scopeId: SCOPE, workflowId: null, enabled: true },
    },
    now: NOW,
  } as Action

  console.log('\n  No agent workflow runs on arrival. The endpoint classifies what it can and')
  console.log('  reports that as guessed; anything more is a decision to take after somebody')
  console.log('  has watched a real message land.')

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }

  const result = await persistActions(TENANT, ACTOR, [action])
  console.log(`\n${result.ok ? 'Applied' : 'Refused'}: ${result.message ?? result.error}`)
  if (!result.ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
