/**
 * Point intake at the shared engagement mailbox, and prove the other half is aligned.
 *
 *   npx tsx --conditions=react-server scripts/point-intake.ts           # dry run
 *   npx tsx --conditions=react-server scripts/point-intake.ts --apply
 *
 * ---------------------------------------------------------------------------
 * Why this is one script and not two commands
 *
 * `stop-personal-intake` recorded the rule it stopped short of: **the app config decides which
 * messages are ACCEPTED and the Logic App decides which mailbox is POLLED**, and changing one
 * without the other leaves intake refusing everything with a 409 nobody sees. That is the
 * silent-failure shape this codebase has been caught by more than once.
 *
 * So this does the app half and then REPORTS the Azure half rather than assuming it. It cannot
 * change the Logic App — that is `az`, not the reducer — but it can say what the parameter must
 * be, and the operator runs one command beside this one. Two halves, one page, no gap.
 *
 * ---------------------------------------------------------------------------
 * Why an engagement and not the client
 *
 * `OAPILCatalyst@` is the mailbox for one engagement, so its messages file into that engagement
 * rather than at the top of the client. A record can always be moved down into a module or a
 * project once somebody has read it; a record filed too high is merely unsorted, where one filed
 * under the wrong project is wrong. `canParent` is checked before anything is written, because
 * pointing intake at a node that cannot hold an issue is exactly the fault the first version of
 * `intake-mailbox` shipped with: every message refused with a 409 nobody sees.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT done
 *
 * `INBOX_62` — the individually addressed mailbox — is left in place and left disabled. Deleting
 * it would remove the only record in configuration that it was ever pointed at somebody's own
 * inbox, and that is a thing worth being able to find later.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { canParent, kindOf, type Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const NOW = new Date().toISOString()

const ADDRESS = process.env.AXIOMATE_INTAKE_ADDRESS ?? 'OAPILCatalyst@axiocloudsolutions.com'
const SCOPE = process.env.AXIOMATE_INTAKE_SCOPE ?? 'engagement:OAPIL'

async function main() {
  const { state } = await loadWorkspace(TENANT)

  const wanted = (process.env.AXIOMATE_OPERATOR_EMAIL ?? 'sekharn@axiocloudsolutions.com').toLowerCase()
  const operator = Object.values(state.model.people).find((p) => p.email?.toLowerCase() === wanted)
  if (!operator) {
    console.log(`  No directory entry has ${wanted}, so nothing here would be permitted.`)
    process.exitCode = 1
    return
  }
  const ACTOR: Actor = { id: operator.id, name: operator.name, email: operator.email }

  console.log('AXIOMATE — POINT INTAKE AT THE SHARED ENGAGEMENT MAILBOX\n')
  console.log(`  attributed to : ${operator.name} (${operator.id})`)
  console.log(`  address       : ${ADDRESS}`)
  console.log(`  files into    : ${SCOPE}\n`)

  /* ---- the scope has to be able to hold an issue ---- */
  const scopeKind = kindOf(state, SCOPE)
  if (!scopeKind) {
    console.log(`  ${SCOPE} is not a node in this workspace. Refusing.`)
    process.exitCode = 1
    return
  }
  if (!canParent('issue', scopeKind)) {
    console.log(`  An issue cannot live under a ${scopeKind}. Refusing — every message would 409.`)
    process.exitCode = 1
    return
  }
  console.log(`  scope check   : ok, an issue may live under a ${scopeKind}\n`)

  /* ---- what is configured now ---- */
  console.log('  Configured mailboxes:')
  for (const box of state.model.intake) {
    console.log(`    ${box.id}  ${box.address}  enabled=${box.enabled}  ->  ${box.scopeId}`)
  }

  const existing = state.model.intake.find((b) => b.address.toLowerCase() === ADDRESS.toLowerCase())
  const actions: Action[] = []

  if (existing && existing.enabled && existing.scopeId === SCOPE) {
    console.log('\n  Already configured exactly like this — nothing to do.')
  } else {
    console.log(`\n  WILL ${existing ? 'UPDATE' : 'ADD'} ${ADDRESS}, enabled, filing into ${SCOPE}.`)
    actions.push({
      t: 'config',
      op: {
        k: 'upsertIntake',
        id: existing?.id ?? null,
        patch: { address: ADDRESS, scopeId: SCOPE, enabled: true },
      },
      now: NOW,
    } as Action)
  }

  /* ---- the other half, which this script cannot do ---- */
  console.log('\n  THE OTHER HALF — the Logic App decides which mailbox is POLLED:\n')
  console.log('    az resource update --resource-group Axiomate-TMS-RG \\')
  console.log('      --resource-type Microsoft.Logic/workflows --name axiomate-intake \\')
  console.log(`      --set properties.parameters.mailboxAddress.value=${ADDRESS}`)
  console.log('\n    az resource update --resource-group Axiomate-TMS-RG \\')
  console.log('      --resource-type Microsoft.Logic/workflows --name axiomate-intake \\')
  console.log('      --set properties.state=Enabled')
  console.log('\n    The connector polls /v2/SharedMailbox/Mail/OnNewEmail as the account the')
  console.log('    connection was authorised with, so that account needs FullAccess on the shared')
  console.log('    mailbox. Without it the trigger fails quietly and no message is ever seen.')

  if (!actions.length) return

  if (!APPLY) {
    console.log(`\n  Dry run. ${actions.length} action(s) would be applied. Re-run with --apply.`)
    return
  }

  const result = await persistActions(TENANT, ACTOR, actions)
  console.log(`\n  ${result.ok ? 'Applied.' : `REFUSED: ${result.error}`}`)
  if (!result.ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
