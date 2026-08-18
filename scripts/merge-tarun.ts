/**
 * Consolidate Tarun onto one directory record, and give him the role.
 *
 *   npx tsx --conditions=react-server scripts/merge-tarun.ts           # report only
 *   npx tsx --conditions=react-server scripts/merge-tarun.ts --apply
 *
 * ---------------------------------------------------------------------------
 * What was actually wrong
 *
 * The August identity fix created a NEW person rather than correcting the old one, so there were
 * two records for one human:
 *
 *   PERSON_61  "Tarun"           no email, no role, grade "Growth Consultant" / "Sales and marketing"
 *   PERSON_63  "M Tarun Kumar"   kumart@…, ROLE_PROJECT_MANAGER, the Axio-Growth allocation
 *
 * He could already sign in — `rolesFor` joins on email and finds PERSON_63 — so pending action A2
 * ("he can sign in and see nothing") had been stale for a while. What remained was the split:
 * his professional profile on one record and his identity, role and allocation on the other, plus
 * a second "Tarun" in every person dropdown for somebody to record against by mistake.
 *
 * ---------------------------------------------------------------------------
 * Three steps, in an order that matters
 *
 *   1. Move the grade and track onto PERSON_63, and set the role.
 *   2. Delete PERSON_61.
 *   3. Withdraw ver-19, its orphaned working pattern.
 *
 * Two and three cannot be swapped. `removeVersion` refuses while the subject is still in the
 * directory — that guard is what stops it being a general way to erase somebody's dated history —
 * so the person has to go first for the version to become removable at all.
 *
 * ---------------------------------------------------------------------------
 * The role is Engagement Leader, and that is a large grant
 *
 * Chosen deliberately over Project Manager, which does not carry `change.approve` or
 * `milestone.accept`. The firm has exactly one engagement leader, so every change request that
 * person raises is currently undecidable by anybody but an administrator — the segregation rule
 * working as designed with nobody on the other side of it. A second leader is what resolves that.
 *
 * The cost is stated rather than buried: Engagement Leader carries all 38 permissions, the same
 * set as Platform Administrator, including `config.manage` and `rate.view`. He will be able to
 * see what everybody costs and to change the operating model. If that is more than intended, the
 * narrower fix is to add `change.approve` to Project Manager instead and leave milestone
 * acceptance with a client sponsor.
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
const NOW = new Date().toISOString()

const KEEP = 'PERSON_63'
const DROP = 'PERSON_61'
const ROLE = 'ROLE_ENGAGEMENT_LEAD'

async function main() {
  const { state } = await loadWorkspace(TENANT)

  const keep = state.model.people[KEEP]
  const drop = state.model.people[DROP]

  console.log('AXIOMATE — CONSOLIDATE TARUN\n')
  if (!keep) {
    console.log(`  ${KEEP} is not in the directory. Nothing done.`)
    process.exitCode = 1
    return
  }

  /*
   * The operator, resolved by address rather than named. Same reasoning as the seed script: an
   * invented actor holds no roles because `defaultRoleIds` is empty, so every write is refused.
   */
  const wanted = (process.env.AXIOMATE_OPERATOR_EMAIL ?? 'sekharn@axiocloudsolutions.com').toLowerCase()
  const operator = Object.values(state.model.people).find((p) => p.email?.toLowerCase() === wanted)
  if (!operator) {
    console.log(`  No directory entry has ${wanted}, so nothing here would be permitted.`)
    process.exitCode = 1
    return
  }
  const ACTOR: Actor = { id: operator.id, name: operator.name, email: operator.email }

  const grade = keep.grade || drop?.grade || ''
  const track = keep.track || drop?.track || ''
  const orphans = Object.values(state.versions).filter((v) => v.subjectId === DROP)

  console.log(`  keep      : ${KEEP} "${keep.name}" ${keep.email ?? 'no email'}`)
  console.log(`  role      : [${keep.roleIds.join(', ') || 'none'}] -> [${ROLE}]`)
  console.log(`  grade     : "${keep.grade || '-'}" -> "${grade || '-'}"`)
  console.log(`  track     : "${keep.track || '-'}" -> "${track || '-'}"`)
  console.log(`  remove    : ${drop ? `${DROP} "${drop.name}"` : `${DROP} is already gone`}`)
  console.log(`  versions  : ${orphans.length ? orphans.map((v) => `${v.id} (${v.subjectKind} from ${v.validFrom})`).join(', ') : 'none on ' + DROP}`)
  console.log(`  attributed: ${operator.name} (${operator.id})`)
  console.log()
  console.log(`  Engagement Leader carries all 38 permissions — the same set as Platform`)
  console.log(`  Administrator, including config.manage and rate.view. That is deliberate and`)
  console.log(`  larger than Project Manager; see the note at the top of this file.`)

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }

  /* Step 1 and 2 together: the profile lands before the record it came from goes. */
  const first: Action[] = [
    {
      t: 'config',
      op: {
        k: 'upsertPerson',
        id: KEEP,
        name: keep.name,
        roleIds: [ROLE],
        email: keep.email,
        grade,
        track,
        developingToward: keep.developingToward,
      },
      now: NOW,
    } as Action,
  ]
  if (drop) {
    first.push({ t: 'config', op: { k: 'deletePerson', id: DROP }, now: NOW } as Action)
  }

  const r1 = await persistActions(TENANT, ACTOR, first)
  console.log(`\n  ${r1.ok ? 'Applied' : 'Refused'}: ${r1.message ?? r1.error}`)
  if (!r1.ok) { process.exitCode = 1; return }

  /* Step 3, and only now: `removeVersion` refuses while the subject is still in the directory. */
  if (orphans.length) {
    const r2 = await persistActions(
      TENANT,
      ACTOR,
      orphans.map((v) => ({ t: 'removeVersion', id: v.id, now: NOW }) as Action),
    )
    console.log(`  ${r2.ok ? 'Applied' : 'Refused'}: ${orphans.length} orphaned version(s) — ${r2.message ?? r2.error}`)
    if (!r2.ok) process.exitCode = 1
  }

  const { state: after } = await loadWorkspace(TENANT)
  const left = Object.values(after.model.people).filter((p) => /tarun/i.test(p.name))
  console.log(`\n  Directory now holds ${left.length} Tarun: ${left.map((p) => `${p.id} "${p.name}" [${p.roleIds.join(',')}] ${p.grade ?? ''}`).join(' | ')}`)
  console.log(`  Versions on ${DROP}: ${Object.values(after.versions).filter((v) => v.subjectId === DROP).length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
