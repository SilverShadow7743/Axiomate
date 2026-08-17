/**
 * Give each engagement the project tier the imported log never had.
 *
 * The hierarchy is `Company ▸ Client ▸ Engagement ▸ Project ▸ Process Area ▸ Issue`, and this
 * workspace has no projects at all: forty-one process areas hang straight off three engagements,
 * because the spreadsheet the log was imported from had a client column and a module column and
 * nothing between them.
 *
 * That is not a cosmetic gap. `CapacityPanel` renders only for `row.kind === 'project'`, so a
 * fully built panel — allocations, commitments, planned against actual capacity — cannot be
 * opened by anybody in this workspace. `attributeToSow` links a *project* to a statement of
 * work, so nothing can be attributed to a contract either. The commercial and resourcing half of
 * the product is invisible for want of a tier rather than for want of code.
 *
 * ---------------------------------------------------------------------------
 * What it does not do
 *
 * It does not create statements of work. A SOW carries a reference, a contracted effort, a
 * contracted value and dates — facts about a signed agreement. None of them are in this
 * workspace and none can be derived from it, and writing plausible numbers into a contract
 * record is the one thing this application exists to stop. They are entered when somebody has
 * the agreement in front of them.
 *
 * It does not touch an issue. Issues move with their process area because the process area is
 * their parent; nothing about the issues themselves changes.
 *
 * ---------------------------------------------------------------------------
 * Naming
 *
 * One project per engagement, named from what the engagement demonstrably delivers rather than
 * from a convention invented here. The evidence is in the issue subjects and the process area
 * names, and it is quoted in `PROJECTS` below so the reasoning survives disagreement with it.
 *
 * One project per engagement is deliberately the least structure that removes the gap. Splitting
 * an engagement into several projects is a judgement about how a firm runs its delivery, and it
 * is not one this script can make from a spreadsheet import — but it is easy afterwards, because
 * a project can be created and process areas moved under it through the ordinary interface.
 *
 *   npx tsx --conditions=react-server scripts/add-project-tier.ts          # dry run
 *   npx tsx --conditions=react-server scripts/add-project-tier.ts --apply
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
const ACTOR: Actor = { id: 'add-project-tier', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

/**
 * Engagement name → the project to create under it, and why that name.
 *
 * Keyed on the engagement rather than the client, because an engagement is what a project sits
 * under and a client may hold several.
 */
const PROJECTS: Record<string, { name: string; evidence: string }> = {
  Axiomate: {
    name: 'Axiomate Platform',
    evidence: 'internal product development — every process area is a component of this application',
  },
  'OAPIL Engagement': {
    name: 'D365 Implementation',
    evidence: 'D365 named in 17 issue subjects, AX in 4, F&O in 1; process areas Finance, Inventory, Procurement, Production and Environment/LCS are Finance and Operations modules',
  },
  'SLG Engagement': {
    name: 'POS Programme',
    evidence: 'POS named in 5 subjects; 8 of 11 process areas are POS, receiving or carrier work',
  },
}

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const nodes = Object.values(state.nodes).filter((n) => !n.deletedAt)
  const engagements = nodes.filter((n) => n.kind === 'engagement')

  console.log('')
  console.log(`AXIOMATE — PROJECT TIER   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log('')

  const plan: { engagement: string; project: string; evidence: string; modules: string[] }[] = []
  const unplanned: string[] = []

  for (const e of engagements) {
    const spec = PROJECTS[e.name]
    const modules = nodes.filter((n) => n.kind === 'module' && n.parentId === e.id)
    if (!spec) {
      unplanned.push(`${e.name} (${modules.length} process areas)`)
      continue
    }
    plan.push({ engagement: e.name, project: spec.name, evidence: spec.evidence, modules: modules.map((m) => m.name) })
  }

  for (const p of plan) {
    console.log(`${p.engagement}`)
    console.log(`  creates project   ${p.project}`)
    console.log(`  because           ${p.evidence}`)
    console.log(`  moves under it    ${p.modules.length} process areas: ${p.modules.slice(0, 6).join(', ')}${p.modules.length > 6 ? `, and ${p.modules.length - 6} more` : ''}`)
    console.log('')
  }

  if (unplanned.length) {
    console.log('NOT TOUCHED — no project named for these engagements, so they keep their current shape')
    for (const u of unplanned) console.log(`  ${u}`)
    console.log('')
  }

  const alreadyHasProject = nodes.filter((n) => n.kind === 'project')
  if (alreadyHasProject.length) {
    console.log(`ALREADY PRESENT — ${alreadyHasProject.length} project(s) exist; this script would add to them, not replace them.`)
    console.log('')
  }

  console.log('NOT CREATED — statements of work')
  console.log('  A SOW carries a reference, a contracted effort, a contracted value and dates.')
  console.log('  None are in this workspace and none can be derived from it. They are entered')
  console.log('  when somebody has the agreement in front of them; inventing them would put a')
  console.log('  number nobody agreed to into a commercial record.')

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }

  /**
   * Created one engagement at a time, and the moves are sent in the same batch as the create
   * they depend on.
   *
   * `persistActions` folds a batch against the state each action before it produced, so a move
   * can name a project the same batch just created — but only if the create comes first in the
   * list. `createdId` is reported for the last create in a batch, so each engagement is its own
   * call rather than one batch of three creates and forty-one moves.
   */
  let created = 0
  let moved = 0
  for (const p of plan) {
    const e = engagements.find((x) => x.name === p.engagement)!
    const first = await persistActions(TENANT, ACTOR, [
      { t: 'create', parentId: e.id, kind: 'project', draft: { name: p.project }, now: NOW } as Action,
    ])
    if (!first.ok || !first.createdId) {
      console.log(`\nRefused creating ${p.project}: ${first.error ?? 'no id returned'}`)
      process.exitCode = 1
      return
    }
    created += 1
    const projectId = first.createdId

    const mods = nodes.filter((n) => n.kind === 'module' && n.parentId === e.id)
    const moves = mods.map((m) => ({ t: 'move', id: m.id, newParentId: projectId, now: NOW }) as Action)
    if (moves.length) {
      const res = await persistActions(TENANT, ACTOR, moves)
      if (!res.ok) {
        console.log(`\nRefused moving process areas under ${p.project}: ${res.error}`)
        process.exitCode = 1
        return
      }
      moved += moves.length
    }
    console.log(`  ${p.project}: created as ${projectId}, ${moves.length} process areas moved`)
  }

  console.log('')
  console.log(`Applied. ${created} project(s) created, ${moved} process areas reparented.`)
}

main().catch((e) => {
  console.log('Failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
