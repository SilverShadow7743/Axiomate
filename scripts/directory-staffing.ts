/**
 * Record who leads the engagements, and add the one allocated person the directory does not have.
 *
 * Three facts stated by the operating partner on 17 August 2026:
 *
 *   - Nishant Sekhar leads every engagement, and is also Platform Administrator.
 *   - Tarun works the Axio-Growth project and is allocated to it, but has no directory entry.
 *   - Amolak, Dharmendra and Jaya staff OAPIL; Amolak and Michael staff SLG.
 *
 * The third needs nothing done: those allocations already exist and carry their own percentages.
 * This script does the first two.
 *
 * ---------------------------------------------------------------------------
 * Why the engagement leader is written in two places, which is not a duplication
 *
 * `Engagement.engagementLeader` is a *fact about the engagement* — who is answerable for it, and
 * what a client sees on the engagement page. `ROLE_ENGAGEMENT_LEAD` is a *permission* — what the
 * application lets that person do. They are different questions and a firm can legitimately
 * answer them differently: an engagement can name a leader who has left, and an administrator
 * can hold the permission without leading anything.
 *
 * Collapsing them into one field would mean either granting permissions by whoever is typed into
 * a text box, or deriving the client-facing answer from a permission list. Both are worse.
 *
 * ---------------------------------------------------------------------------
 * What this deliberately does not decide
 *
 * Tarun is created with **no permission role**. "Growth Consultant" is a grade, not one of the
 * eleven roles this workspace grants access by, and there is no honest mapping from one to the
 * other — picking `ROLE_FUNCTIONAL` because it is the nearest-sounding would be guessing at
 * somebody's access. With the fallback role empty, no role means no permissions, which is the
 * right failure: it is visible, and it waits for an answer instead of inventing one.
 *
 * No email either. The others were matched against the tenant directory by
 * `scripts/directory-emails.ts`; there is nothing to match here and an address is not a thing to
 * infer from a first name.
 *
 * Grade and track — Senior Technical Consultant on the X++ track, Senior Functional Consultant
 * on manufacturing, Intern working toward Analyst — are not written here. The person record has
 * no field for them, and adding one is a schema change that belongs in its own commit rather
 * than smuggled into a staffing script.
 *
 *   npx tsx --conditions=react-server scripts/directory-staffing.ts          # dry run
 *   npx tsx --conditions=react-server scripts/directory-staffing.ts --apply
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
const ACTOR: Actor = { id: 'directory-staffing', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

const LEADER = 'Nishant Sekhar'
const LEADER_ROLE = 'ROLE_ENGAGEMENT_LEAD'

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const people = state.model.people ?? {}
  const actions: Action[] = []
  const notes: string[] = []

  /* ---------------- the leader's permission ---------------- */

  const leader = Object.values(people).find((p) => p.name === LEADER)
  if (!leader) {
    console.error(`${LEADER} is not in the directory. Refusing to create them here — this script`)
    console.error('assigns leadership, and creating the person it is about would hide a real problem.')
    process.exit(1)
  }
  if (leader.roleIds.includes(LEADER_ROLE)) {
    notes.push(`${LEADER} already holds ${LEADER_ROLE}.`)
  } else {
    // Added to the existing roles, never replacing them. He is Platform Administrator as well,
    // and a script that assigns one role by overwriting the list takes away the other silently.
    actions.push({
      t: 'config',
      op: { k: 'upsertPerson' as const, id: leader.id, name: leader.name, roleIds: [...leader.roleIds, LEADER_ROLE], email: leader.email },
      now: NOW,
    } as Action)
    notes.push(`${LEADER}: ${leader.roleIds.join(', ') || '(none)'} + ${LEADER_ROLE}`)
  }

  /* ---------------- the leader on every engagement ---------------- */

  for (const [nodeId, e] of Object.entries(state.engagements ?? {})) {
    if (e.engagementLeader === LEADER) {
      notes.push(`${nodeId}: already led by ${LEADER}.`)
      continue
    }
    // Overwriting a name that is already there would be a different decision and is worth
    // seeing, so it is reported rather than done quietly.
    if (e.engagementLeader) notes.push(`${nodeId}: replacing "${e.engagementLeader}" with ${LEADER}.`)
    else notes.push(`${nodeId}: engagement leader set to ${LEADER}.`)
    actions.push({ t: 'updateEngagement', nodeId, patch: { engagementLeader: LEADER }, now: NOW } as Action)
  }

  /* ---------------- the allocated person with no directory entry ---------------- */

  const allocatedNames = new Set(
    Object.values(state.allocations ?? {}).filter((a) => !a.deletedAt).map((a) => a.person),
  )
  const known = new Set(Object.values(people).map((p) => p.name))
  const orphans = [...allocatedNames].filter((n) => !known.has(n))

  for (const name of orphans) {
    actions.push({
      t: 'config',
      op: { k: 'upsertPerson' as const, id: null, name, roleIds: [] },
      now: NOW,
    } as Action)
    notes.push(`${name}: allocated but not in the directory — created with NO role and NO email.`)
  }

  /* ---------------- report, then maybe write ---------------- */

  console.log('AXIOMATE — STAFFING\n')
  for (const n of notes) console.log(`  ${n}`)
  console.log(`\n  ${actions.length} change(s)`)

  if (orphans.length) {
    console.log('\n  Needs a decision: the people created above hold no permission role, so they')
    console.log('  can sign in and see nothing. Say which role each should have.')
  }

  if (!actions.length) {
    console.log('\nNothing to do.')
    return
  }
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
