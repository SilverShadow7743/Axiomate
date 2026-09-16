/**
 * One-time backfill: give every current internal team member a visible `AX-####` employee id.
 *
 * `Person.employeeId` is assigned lazily inside `upsertPerson`'s reducer arm the first time a
 * person's roles grant `internal.view` — see `docs/plans/2026-09-16-employee-id-design.md`. New
 * hires get one automatically from here on. This script is what gives the ~21 people already in
 * the directory theirs, by re-saving each one through the ordinary reducer rather than writing
 * the column directly — the same reasoning `seed-profiles.ts` uses: the reducer's own
 * assignment logic runs, and the write carries a real audit entry, rather than a raw column
 * update bypassing both.
 *
 * ---------------------------------------------------------------------------
 * Why this prints before it writes anything, no matter what
 *
 * Eligibility is "any role holding `internal.view`" — not a hardcoded role list — because a
 * hardcoded list silently misses a firm's own future custom role. That is also exactly what
 * makes it impossible to state from source alone whether this tenant's two known custom roles,
 * "Nishant (OAPIL Guest)" and "Client Process Lead," are excluded: nothing here can read what a
 * tenant actually has stored for a role it defined itself (the I27 lesson — shipped defaults are
 * not stored config). So this script always prints its full candidate list first and refuses to
 * write until re-run with --apply, so a human can check those two names are genuinely absent
 * before anything is dispatched.
 *
 *   npx tsx --conditions=react-server scripts/backfill-employee-ids.ts          # dry run
 *   npx tsx --conditions=react-server scripts/backfill-employee-ids.ts --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { rolesGrant } from '../lib/access'
import type { Action } from '../lib/workspace'
import type { Person } from '../lib/config'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = {
  id: 'backfill-employee-ids',
  name: process.env.AXIOMATE_OPERATOR ?? 'Operator',
}
const NOW = new Date().toISOString()

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const model = state.model
  const people = Object.values(model.people ?? {})
  const roleLabel = (r: string) => model.roles[r]?.label ?? r

  const active = people.filter((p) => p.status !== 'Departed')
  const candidates = active
    .filter((p) => !p.employeeId && rolesGrant(model, p.roleIds, 'internal.view'))
    .sort((a, b) => (a.joinedOn ?? '9999').localeCompare(b.joinedOn ?? '9999') || a.name.localeCompare(b.name))

  console.log('')
  console.log(`AXIOMATE — EMPLOYEE ID BACKFILL   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log('')
  console.log(`  active people in the directory   ${active.length}`)
  console.log(`  already have an employee id      ${active.filter((p) => p.employeeId).length}`)
  console.log(`  eligible (internal.view) + none  ${candidates.length}`)
  console.log('')
  console.log('  Every active person and why each is, or is not, a candidate:')
  console.log('')
  for (const p of active.sort((a, b) => a.name.localeCompare(b.name))) {
    const eligible = rolesGrant(model, p.roleIds, 'internal.view')
    const status = p.employeeId ? `has ${p.employeeId}` : eligible ? 'CANDIDATE' : 'not internal.view'
    console.log(`    ${p.name.padEnd(28)} ${p.roleIds.map(roleLabel).join(', ').padEnd(30)} ${status}`)
  }
  console.log('')
  console.log('  Check by hand before applying: neither "Nishant (OAPIL Guest)" nor "Client')
  console.log('  Process Lead" should show CANDIDATE above. If either does, stop — this means')
  console.log('  that role’s stored grants carry internal.view despite its name, and needs a')
  console.log('  decision, not a workaround in this script.')

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }
  if (!candidates.length) {
    console.log('\nNothing to write.')
    return
  }

  /**
   * `roleIds` copied byte-for-byte from the live record — `upsertPerson`'s reducer arm has no
   * carry-forward for it (`roleIds: op.roleIds.filter(...)`, no `existing` fallback, unlike
   * every other optional field it sets), so omitting it or sending `[]` would strip the
   * person's roles. `grade`/`track`/`developingToward` are left out of the op entirely, not
   * sent as empty strings — `career()` only overwrites what `op` explicitly sends, so omitting
   * them is what leaves this week's career data untouched.
   */
  const actions: Action[] = candidates.map((p: Person) => ({
    t: 'config' as const,
    op: { k: 'upsertPerson' as const, id: p.id, name: p.name, roleIds: p.roleIds },
    now: NOW,
  }))

  const res = await persistActions(TENANT, ACTOR, actions)
  console.log('')
  console.log(res.ok ? `Applied. ${actions.length} employee ids assigned.` : `Refused: ${res.error}`)
  if (!res.ok) process.exitCode = 1
}

main().catch((e) => {
  console.log('Failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
