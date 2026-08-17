/**
 * Find permissions a deployment cannot use, and give them to the roles the code says own them.
 *
 * ---------------------------------------------------------------------------
 * The trap this exists for
 *
 * `DEFAULT_GRANTS` in lib/access.ts is what a NEW workspace starts with. `mergeModel` merges
 * grants **per role with stored winning** — deliberately, so a firm that has customised what a
 * role may do is not silently reverted by a deployment.
 *
 * The consequence is that adding a permission in code does **nothing** for an existing
 * workspace. The key exists, the reducer checks it, every role's stored grant list predates it,
 * and so nobody holds it. The feature ships, the screen renders, and every attempt is refused.
 *
 * This is not hypothetical and it is not rare. On the day it was written, five permissions were
 * in exactly this state in production — `time.submit`, `time.approve`, `rate.view`, `rate.edit`
 * and `change.approve` — which meant nobody could submit a timesheet, approve one, see a rate,
 * set one, or decide a change request. Four features, all working, all unusable, and nothing
 * anywhere said so.
 *
 * It had already happened once before that, to `estimate.edit` for the automation role, and was
 * fixed with a one-off script. This is the general version.
 *
 * ---------------------------------------------------------------------------
 * What it will and will not do
 *
 * It grants a permission only to the roles `DEFAULT_GRANTS` already says should have it. It
 * never invents an assignment, never removes one, and never touches a role the code does not
 * name — so a firm's own customisation survives, which is the property `mergeModel` was
 * protecting in the first place.
 *
 *   npx tsx --conditions=react-server scripts/reconcile-grants.ts          # report only
 *   npx tsx --conditions=react-server scripts/reconcile-grants.ts --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { DEFAULT_GRANTS, PERMISSION_KEYS, type PermissionKey } from '../lib/access'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'reconcile-grants', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const grants = state.model.access.grants
  const held = new Set(Object.values(grants).flat())

  /** Defined in code, and no stored role holds it. The feature behind it cannot be used. */
  const orphans = PERMISSION_KEYS.filter((k) => !held.has(k))

  console.log('AXIOMATE — GRANT RECONCILIATION\n')
  console.log(`  permissions in code        : ${PERMISSION_KEYS.length}`)
  console.log(`  held by no stored role     : ${orphans.length}`)

  if (!orphans.length) {
    console.log('\n  Nothing to do. Every permission the code defines is held by somebody.')
    return
  }

  const next: Record<string, PermissionKey[]> = { ...grants }
  const lines: string[] = []

  for (const key of orphans) {
    const owners = Object.entries(DEFAULT_GRANTS)
      .filter(([, keys]) => (keys as readonly PermissionKey[]).includes(key))
      .map(([roleId]) => roleId)
      // Only roles this workspace actually has. A grant to a role nobody holds is a grant to
      // nobody, and writing it would make the report read as fixed when it is not.
      .filter((roleId) => state.model.roles[roleId] && !state.model.roles[roleId].deletedAt)

    if (!owners.length) {
      lines.push(`  ${key.padEnd(22)} NOT GRANTED — the code names no live role for it. Decide who should have it.`)
      continue
    }
    for (const roleId of owners) {
      next[roleId] = [...new Set([...(next[roleId] ?? []), key])]
    }
    lines.push(`  ${key.padEnd(22)} -> ${owners.map((r) => state.model.roles[r].label).join(', ')}`)
  }

  console.log()
  for (const l of lines) console.log(l)
  console.log('\n  Only roles the code already names are given anything. Nothing is removed, and a')
  console.log('  role the code does not mention is left exactly as the firm configured it.')

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }

  /*
   * The whole grants map, with the additions. `Partial<AccessPolicy>` is shallow, so sending
   * only the changed roles would replace the map with those roles and revoke everything else.
   */
  const result = await persistActions(TENANT, ACTOR, [
    { t: 'config', op: { k: 'setAccess', patch: { grants: next } }, now: NOW } as Action,
  ])
  console.log(`\n${result.ok ? 'Applied' : 'Refused'}: ${result.message ?? result.error}`)
  if (!result.ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
