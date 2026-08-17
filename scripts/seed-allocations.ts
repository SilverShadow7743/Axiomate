/**
 * Record who is allocated to what, as stated by the operator.
 *
 * Allocations are the input `CapacityPanel` and `planCheck` exist to read, and this workspace
 * had none — so the capacity arithmetic had nothing to be right or wrong about.
 *
 * ---------------------------------------------------------------------------
 * What was stated, and what was not
 *
 * Stated: the people, the projects and the percentages. Everything below carries them exactly.
 *
 * Not stated, and required by the model:
 *
 *   `startDate` / `endDate` — an allocation is a claim about a period, and `capacityFor`
 *   answers "what is left of this person's time between these dates". Without a window the
 *   question has no meaning. The window below is an assumption, stated here rather than buried:
 *   from the day this was run to the end of the calendar year. Change it in the Capacity panel;
 *   it is not a fact about anybody's contract.
 *
 *   Tarun's full name. The directory holds first-and-last names, and adding a bare "Tarun"
 *   would repeat exactly the fault that had to be merged out of it earlier — "Somu" and "Somu
 *   Udayappan" sitting as two people, landing on opposite sides of the delivery/client split.
 *   So the allocation is recorded, because `Allocation.person` is text and the capacity
 *   arithmetic works, and no directory entry is created. He cannot be given a role or sign in
 *   until somebody supplies the full name.
 *
 *   npx tsx --conditions=react-server scripts/seed-allocations.ts          # dry run
 *   npx tsx --conditions=react-server scripts/seed-allocations.ts --apply
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
const ACTOR: Actor = { id: 'seed-allocations', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

/** The assumed window. See the note above — this is not a fact about anybody's contract. */
const FROM = NOW.slice(0, 10)
const TO = `${NOW.slice(0, 4)}-12-31`

/** An internal project, because sales and marketing effort is still effort against something. */
const GROWTH = { client: 'Axiocloud', name: 'Axio-Growth' }

const ALLOCATIONS: { person: string; project: string; percentage: number }[] = [
  { person: 'Amolak', project: 'POS Programme', percentage: 50 },
  { person: 'Michael Thomas', project: 'POS Programme', percentage: 100 },
  { person: 'Amolak', project: 'D365 Implementation', percentage: 50 },
  { person: 'Dharmendra Kumar Dwivedi', project: 'D365 Implementation', percentage: 100 },
  { person: 'Jaya Jothi R', project: 'D365 Implementation', percentage: 100 },
  { person: 'Tarun', project: GROWTH.name, percentage: 100 },
]

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const nodes = Object.values(state.nodes).filter((n) => !n.deletedAt)
  const projects = new Map(nodes.filter((n) => n.kind === 'project').map((n) => [n.name, n.id]))
  const people = new Set(Object.values(state.model.people ?? {}).map((p) => p.name))

  console.log('')
  console.log(`AXIOMATE — ALLOCATIONS   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log(`Assumed window: ${FROM} to ${TO}  (not stated; change it in the Capacity panel)`)
  console.log('')

  const needsGrowth = !projects.has(GROWTH.name)
  if (needsGrowth) {
    console.log(`Creates project  ${GROWTH.name} under client ${GROWTH.client}`)
    console.log('                 sales and marketing effort is effort against something, and an')
    console.log('                 allocation names a project — so it needs one to name.')
    console.log('')
  }

  const totals = new Map<string, number>()
  for (const a of ALLOCATIONS) totals.set(a.person, (totals.get(a.person) ?? 0) + a.percentage)

  for (const a of ALLOCATIONS) {
    const known = people.has(a.person)
    console.log(`  ${a.person.padEnd(26)}${String(a.percentage).padStart(4)}%  ${a.project.padEnd(22)}${known ? '' : '  ← not in the directory'}`)
  }
  console.log('')
  console.log('  Totals per person:')
  for (const [p, t] of totals) {
    console.log(`    ${p.padEnd(26)}${String(t).padStart(4)}%${t > 100 ? '   OVER-ALLOCATED' : ''}`)
  }

  const unknown = [...new Set(ALLOCATIONS.map((a) => a.person))].filter((p) => !people.has(p))
  if (unknown.length) {
    console.log('')
    console.log('  NOT ADDED TO THE DIRECTORY — a partial name is how one person becomes two')
    for (const p of unknown) {
      console.log(`    ${p} — the allocation is recorded and the capacity arithmetic works, but`)
      console.log('      no directory entry is created, so no role and no sign-in until a full name is given.')
    }
  }

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }

  if (needsGrowth) {
    const client = nodes.find((n) => n.kind === 'client' && n.name === GROWTH.client)
    if (!client) throw new Error(`No client named "${GROWTH.client}".`)
    const made = await persistActions(TENANT, ACTOR, [
      { t: 'create', parentId: client.id, kind: 'project', draft: { name: GROWTH.name }, now: NOW } as Action,
    ])
    if (!made.ok || !made.createdId) throw new Error(`Could not create ${GROWTH.name}: ${made.error ?? 'no id'}`)
    projects.set(GROWTH.name, made.createdId)
    console.log(`\n  created ${GROWTH.name} as ${made.createdId}`)
  }

  const actions: Action[] = ALLOCATIONS.map((a) => {
    const projectId = projects.get(a.project)
    if (!projectId) throw new Error(`No project named "${a.project}".`)
    return {
      t: 'upsertAllocation',
      id: null,
      person: a.person,
      projectId,
      startDate: FROM,
      endDate: TO,
      percentage: a.percentage,
      note: 'Stated by the operator, 17 Aug 2026. Window assumed — see scripts/seed-allocations.ts.',
      now: NOW,
    } as Action
  })

  const res = await persistActions(TENANT, ACTOR, actions)
  console.log('')
  console.log(res.ok ? `Applied. ${actions.length} allocations recorded.` : `Refused: ${res.error}`)
  if (!res.ok) process.exitCode = 1
}

main().catch((e) => {
  console.log('Failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
