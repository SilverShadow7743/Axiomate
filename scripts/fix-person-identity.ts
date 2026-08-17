/**
 * Make a directory entry match the account the person actually signs in with.
 *
 * ---------------------------------------------------------------------------
 * The failure this exists to fix
 *
 * `rolesFor` joins a signed-in person to the directory on three things, strongest first: the
 * provider's object id, then the address it supplied, then the display name. A directory entry
 * created from an allocation has none of the first two and a name that came off a spreadsheet.
 *
 * Tarun was in the directory as "Tarun" with no address. His account is "M Tarun Kumar"
 * <kumart@axiocloudsolutions.com>. So the id missed, the address missed because there was none,
 * and the display name missed because "Tarun" is not "M Tarun Kumar". He fell through to the
 * fallback role — which is deliberately empty — and signed in to zero permissions.
 *
 * That is the correct failure and it is still a failure. The fix is not to widen the fallback;
 * it is to make the join work on something stable.
 *
 * ---------------------------------------------------------------------------
 * Why the allocation has to move at the same time
 *
 * `Allocation.person`, `Commitment.person` and `TimeEntry.person` are keyed by **name**, not by
 * person id. Renaming the directory entry without renaming those leaves an allocation pointing
 * at somebody who no longer exists under that name — the capacity screens stop finding it, and
 * nothing errors, which is the worst version of this.
 *
 * So the rename is one operation over both, and the script refuses to do half of it.
 *
 * The underlying weakness stays: a name is neither unique nor stable, and this is the second
 * time this session it has cost something. The durable answer is for those tables to carry a
 * person id, which is a schema change and its own commit.
 *
 *   npx tsx --conditions=react-server scripts/fix-person-identity.ts --id PERSON_61 \
 *     --name "M Tarun Kumar" --email kumart@axiocloudsolutions.com [--role ROLE_FUNCTIONAL]
 *   ... --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const flag = (name: string) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}

const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = { id: 'fix-person-identity', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

const ID = flag('--id')
const NAME = flag('--name')
const EMAIL = flag('--email')
const ROLE = flag('--role')

if (!ID) {
  console.error('Usage: --id PERSON_n [--name "New Name"] [--email a@b.com] [--role ROLE_X] [--apply]')
  process.exit(1)
}

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const person = state.model.people?.[ID!]
  if (!person) {
    console.error(`${ID} is not in the directory.`)
    process.exit(1)
  }

  const newName = NAME ?? person.name
  const newEmail = EMAIL ?? person.email
  const roles = ROLE ? [...new Set([...person.roleIds, ROLE])] : person.roleIds

  if (ROLE && !(state.model.roles[ROLE] && !state.model.roles[ROLE].deletedAt)) {
    console.error(`Role "${ROLE}" does not exist, so granting it would grant nothing.`)
    process.exit(1)
  }

  console.log('AXIOMATE — PERSON IDENTITY\n')
  console.log(`  ${ID}`)
  console.log(`  name  : ${person.name}${newName !== person.name ? `  ->  ${newName}` : '  (unchanged)'}`)
  console.log(`  email : ${person.email ?? '(none)'}${newEmail !== person.email ? `  ->  ${newEmail}` : '  (unchanged)'}`)
  console.log(`  roles : ${person.roleIds.join(', ') || '(none)'}${ROLE ? `  ->  ${roles.join(', ')}` : '  (unchanged)'}`)

  const actions: Action[] = [
    {
      t: 'config',
      op: { k: 'upsertPerson' as const, id: ID!, name: newName, roleIds: roles, email: newEmail },
      now: NOW,
    } as Action,
  ]

  /*
   * Everything keyed on the old name moves with it. Read from state rather than listed, because
   * the point of failure is the one table somebody forgets — and the tables that key on a name
   * are exactly the ones nobody thinks of as referring to a person.
   */
  const renames: string[] = []
  if (newName !== person.name) {
    for (const a of Object.values(state.allocations ?? {})) {
      if (a.deletedAt || a.person !== person.name) continue
      actions.push({
        t: 'upsertAllocation',
        id: a.id,
        person: newName,
        projectId: a.projectId,
        percentage: a.percentage,
        startDate: a.startDate,
        endDate: a.endDate,
        note: a.note,
        now: NOW,
      } as Action)
      renames.push(`allocation ${a.id}`)
    }
    for (const c of Object.values(state.commitments ?? {})) {
      if (c.deletedAt || c.person !== person.name) continue
      actions.push({
        t: 'upsertCommitment',
        id: c.id,
        person: newName,
        kind: c.kind,
        startDate: c.startDate,
        endDate: c.endDate,
        hoursPerDay: c.hoursPerDay,
        note: c.note,
        now: NOW,
      } as Action)
      renames.push(`commitment ${c.id}`)
    }
    const timeEntries = Object.values(state.timeEntries ?? {}).filter(
      (t) => !t.deletedAt && t.person === person.name,
    )
    if (timeEntries.length) {
      console.error(`\n  ${timeEntries.length} time entries are recorded against "${person.name}".`)
      console.error('  Refusing: attested hours are not something this script rewrites. Move them')
      console.error('  deliberately, or rename before anybody books time.')
      process.exit(1)
    }
  }

  console.log(`\n  also moving : ${renames.length ? renames.join(', ') : 'nothing else keys on this name'}`)

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.')
    return
  }

  const result = await persistActions(TENANT, ACTOR, actions)
  console.log(`\n${result.ok ? 'Applied' : 'Refused'}: ${result.message ?? result.error} (${result.audited} audited)`)
  if (!result.ok) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
