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
 * `sekharn@axiocloudsolutions.com` for every engagement, filed to a triage module. That is the
 * operating partner's own address, which is a deliberate starting point rather than a shortcut:
 * it is the mailbox that already receives this correspondence, so nothing has to be created or
 * forwarded before intake can be watched working, and everything that arrives lands somewhere a
 * person is already reading.
 *
 * A dedicated triage module rather than an engagement, because one address cannot tell OAPIL's
 * mail from SLG's. Filing everything in one place and letting somebody move it is honest;
 * guessing the engagement from the sender's domain would be a routing rule nobody wrote, and it
 * would be wrong for every client who copies in a colleague.
 *
 * ---------------------------------------------------------------------------
 * Why the scope is checked rather than trusted
 *
 * This was first configured as `company:root`, which is the natural reading of "everything, from
 * everywhere" and is **not somewhere an issue can live**: `ALLOWED_PARENTS` lets an issue sit
 * under a client, engagement, project, module or another issue, and deliberately not under a
 * company. Every message would have been refused with a 409 the sender never saw, in a run
 * history nobody reads, and the mailbox would have looked quiet.
 *
 * It was found by posting one test message rather than by reading the table, which is the point:
 * the configuration was accepted, the deployment reported success, and the failure only existed
 * at the moment a real message arrived. So the check is now here, before the configuration is
 * written, in the same terms the reducer would refuse it in.
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
import { canParent } from '../lib/workspace'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'intake-mailbox', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

const ADDRESS = process.env.AXIOMATE_INTAKE_ADDRESS ?? 'sekharn@axiocloudsolutions.com'
/** Created if it does not exist. A client may parent a module; see `ALLOWED_PARENTS`. */
const TRIAGE_PARENT = 'client:Axiocloud'
const TRIAGE_NAME = 'Unfiled intake'

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const existing = state.model.intake ?? []

  /*
   * Found by name under its parent, not by a constructed id.
   *
   * The seeded tiers carry readable ids like `module:OAPIL:Inventory`, which made
   * `module:Axiocloud:Unfiled intake` look like the obvious key — but `create` mints ids from
   * the workspace sequence and gave it `module:20`. Looking it up by what it is called avoids
   * depending on a naming convention the reducer does not actually follow.
   */
  const found = Object.values(state.nodes).find(
    (n) => !n.deletedAt && n.parentId === TRIAGE_PARENT && n.name === TRIAGE_NAME,
  )
  const SCOPE = process.env.AXIOMATE_INTAKE_SCOPE ?? found?.id ?? '(to be created)'

  let scope = found

  if (!scope) {
    const parent = state.nodes[TRIAGE_PARENT]
    if (!parent || parent.deletedAt) {
      console.error(`Neither "${SCOPE}" nor its parent "${TRIAGE_PARENT}" exists.`)
      process.exit(1)
    }
    console.log(`  "${SCOPE}" does not exist — creating it under ${TRIAGE_PARENT}.`)
    if (!APPLY) {
      console.log('  (dry run: would create it, then configure the mailbox against it)')
    } else {
      const made = await persistActions(TENANT, ACTOR, [
        {
          t: 'create',
          kind: 'module',
          parentId: TRIAGE_PARENT,
          // No id: `create` mints its own from the workspace sequence and ignores one
          // supplied here, which is how the first attempt ended up looking for a node that
          // was never going to exist under that key.
          draft: { name: TRIAGE_NAME },
          now: NOW,
        } as Action,
      ])
      if (!made.ok) {
        console.error(`Could not create the triage scope: ${made.error}`)
        process.exit(1)
      }
      const reloaded = await loadWorkspace(TENANT)
      scope = Object.values(reloaded.state.nodes).find(
        (n) => !n.deletedAt && n.parentId === TRIAGE_PARENT && n.name === TRIAGE_NAME,
      )
    }
  }

  /*
   * The scope must be somewhere an issue can actually live. `company:root` is the natural
   * reading of "everything" and is refused by the reducer — checked here, in the same terms,
   * because the alternative is finding out when a client's email is silently rejected.
   */
  if (scope && !canParent('issue', scope.kind)) {
    console.error(`\n  "${SCOPE}" is a ${scope.kind}, and an issue cannot sit under a ${scope.kind}.`)
    console.error(`  Every message to ${ADDRESS} would be refused with a 409 nobody sees.`)
    console.error(`  An issue may sit under: client, engagement, project, module or another issue.`)
    process.exit(1)
  }
  if (!scope && APPLY) {
    console.error(`Scope "${SCOPE}" still does not exist after creating it.`)
    process.exit(1)
  }

  const already = existing.find((m) => m.address.toLowerCase() === ADDRESS.toLowerCase())
  console.log('AXIOMATE — INTAKE MAILBOX\n')
  console.log(`  address  : ${ADDRESS}`)
  console.log(`  files to : ${SCOPE}${scope ? `  (${scope.name})` : ''}`)
  console.log(`  existing : ${existing.length} mailbox(es) configured`)

  if (already && already.scopeId === SCOPE) {
    console.log(`\n  Already configured, filing to ${already.scopeId}. Nothing to do.`)
    return
  }
  if (already) {
    // Repointed rather than left alone. The first configuration named a scope an issue cannot
    // sit under, and "already configured" is not the same as "configured correctly".
    console.log(`\n  Repointing: ${already.scopeId} -> ${SCOPE}`)
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
      // The existing row's id when there is one, so this corrects the configuration rather than
      // adding a second mailbox on the same address.
      id: already?.id ?? null,
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
