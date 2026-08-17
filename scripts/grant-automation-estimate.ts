/**
 * Let automation propose an estimate. Not agree one.
 *
 * The Estimation agent writes complexity scores through the ordinary `setEstimate` action, so it
 * needs `estimate.edit` like anybody else who writes an estimate. `ROLE_AUTOMATION` did not have
 * it and the reducer refused, correctly and by design — the shipped grant was written when the
 * only machines were intake and the scheduled pass, neither of which estimates anything.
 *
 * ---------------------------------------------------------------------------
 * Why the seed change was not enough, which is the interesting part
 *
 * `DEFAULT_GRANTS` in lib/access.ts is what a NEW workspace starts with. `mergeModel` merges
 * grants per role with **stored winning**, deliberately: a firm that has customised what a role
 * may do must not have it silently reverted by a deployment. So this workspace kept the grant it
 * was seeded with months ago, and editing the source changed nothing about the running system.
 *
 * That is the right behaviour and it means a permission change to a live workspace is an action
 * somebody takes, is audited, and can be reversed — rather than a line in a diff.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT granted
 *
 * `estimate.agree`. Agreeing an estimate is baselining it, which is a commitment a person makes,
 * and the comment on `MACHINE_ROLE_ID` has always said a machine cannot do it. It still cannot.
 * That pair — edit yes, agree no — is the whole control on what an agent may do to an estimate,
 * and it is why the agent's proposals arrive with `baselinedAt: null`.
 *
 * The widening is real and worth naming: this grant applies to every machine actor, so the
 * intake endpoint can now write an estimate on an issue it creates. That is coherent — an
 * inbound issue arriving with a proposed size is the same kind of proposal — but it is a change
 * to what automation may do and not merely to what one agent may do.
 *
 *   npx tsx --conditions=react-server scripts/grant-automation-estimate.ts          # dry run
 *   npx tsx --conditions=react-server scripts/grant-automation-estimate.ts --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { MACHINE_ROLE_ID } from '../lib/access'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'
import type { PermissionKey } from '../lib/access'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = {
  id: 'grant-automation-estimate',
  name: process.env.AXIOMATE_OPERATOR ?? 'Operator',
}
const NOW = new Date().toISOString()

const GRANT: PermissionKey = 'estimate.edit'
const WITHHELD: PermissionKey = 'estimate.agree'

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const policy = state.model.access
  const current = policy.grants[MACHINE_ROLE_ID] ?? []

  console.log('AXIOMATE — AUTOMATION GRANT\n')
  console.log(`  role    : ${MACHINE_ROLE_ID}`)
  console.log(`  before  : ${current.join(', ') || '(none)'}`)

  if (current.includes(GRANT)) {
    console.log(`\n  ${GRANT} is already granted. Nothing to do.`)
    return
  }

  const next = [...current, GRANT]
  console.log(`  after   : ${next.join(', ')}`)
  console.log(`\n  withheld: ${WITHHELD} — agreeing an estimate is baselining it, and that stays`)
  console.log(`            a decision a person makes. The agent's proposals are never baselined.`)

  /*
   * The op takes a `patch`, and the whole grants map goes in it rather than the one role.
   *
   * `Partial<AccessPolicy>` is shallow: a patch carrying `{ grants: { ROLE_AUTOMATION: [...] } }`
   * replaces the grants map with a one-entry object, and every other role loses everything it
   * had. Sending the full map with one entry changed is the difference between granting a
   * permission and revoking ten.
   */
  const action = {
    t: 'config',
    op: {
      k: 'setAccess' as const,
      patch: { grants: { ...policy.grants, [MACHINE_ROLE_ID]: next } },
    },
    now: NOW,
  } as Action

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
