/**
 * Give every person in the directory a working pattern of their own.
 *
 * `resourceProfiles` was empty against twenty-four people, so `capacityFor` fell back to the
 * shipped default for everybody — 7.5 hours over 5 days at an 80% billable target — and every
 * capacity answer in the system was computed from a working week nobody had entered.
 *
 * ---------------------------------------------------------------------------
 * Why a row per person is only half the fix
 *
 * Seeding the default into twenty-four rows makes `capacityFor` stop guessing, and makes the
 * guess invisible: a stored row *looks* stated. That is worse than the fallback it replaces,
 * because "Dharmendra is at 96% utilisation" derived from an assumed week reads exactly like
 * one derived from a confirmed week, and gets quoted in a review as though it were.
 *
 * So each profile carries `source`. Seeded rows are `'default'`; the reducer flips a profile to
 * `'stated'` the moment anybody edits it — including when they set it to exactly the default
 * numbers, because choosing 7.5 hours is a different fact from never having been asked.
 * `profileConfidence` turns that into the sentence a report should carry.
 *
 * ---------------------------------------------------------------------------
 * What it does not do
 *
 * It does not invent anybody's hours. Every seeded profile holds the shipped default and says
 * so. The point is not to know these twenty-four working weeks — it is to stop the system
 * presenting a number it made up as one somebody supplied.
 *
 *   npx tsx --conditions=react-server scripts/seed-profiles.ts          # dry run
 *   npx tsx --conditions=react-server scripts/seed-profiles.ts --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { defaultProfile, profileConfidence } from '../lib/capacity'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = {
  id: 'seed-profiles',
  name: process.env.AXIOMATE_OPERATOR ?? 'Operator',
}
const NOW = new Date().toISOString()

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const people = Object.values(state.model.people ?? {})
  const profiles = state.model.resourceProfiles ?? {}

  const missing = people.filter((p) => !profiles[p.id])
  const d = defaultProfile('')

  console.log('')
  console.log(`AXIOMATE — WORKING PATTERNS   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log('')
  console.log(`  people in the directory      ${people.length}`)
  console.log(`  already have a profile       ${people.length - missing.length}`)
  console.log(`  will be given one            ${missing.length}`)
  console.log('')
  console.log(`  seeded values                ${d.hoursPerDay}h/day, ${d.daysPerWeek} days/week, ${d.billableTargetPct}% billable target`)
  console.log(`  marked                       source: 'default' — not a claim about anybody's week`)
  console.log('')
  console.log('  A profile becomes \'stated\' the moment somebody edits it in the Capacity panel,')
  console.log('  including if they set it to these same numbers. Choosing 7.5 hours is a')
  console.log('  different fact from never having been asked.')

  const after = profileConfidence(
    { ...profiles, ...Object.fromEntries(missing.map((p) => [p.id, defaultProfile(p.id)])) },
    people.length,
  )
  console.log('')
  console.log(`  After this run, a utilisation report would say: "${after.note}"`)

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }
  if (!missing.length) {
    console.log('\nNothing to write.')
    return
  }

  /**
   * One action per person, through the ordinary reducer, so each lands with attribution and an
   * audit entry — and so the validation in `setResourceProfile` runs rather than being bypassed
   * by writing the model document directly.
   *
   * `source` is not in the patch. It is not a field anybody edits, and the reducer sets it; a
   * patch carrying it would let a caller declare its own guesses confirmed.
   */
  const actions: Action[] = missing.map((p) => ({
    t: 'config' as const,
    op: {
      k: 'setResourceProfile' as const,
      personId: p.id,
      patch: {
        hoursPerDay: d.hoursPerDay,
        daysPerWeek: d.daysPerWeek,
        billableTargetPct: d.billableTargetPct,
      },
      // This pass is not a person choosing. Without it the seeded rows are stamped 'stated'
      // and the whole point of the field is lost — which is exactly what happened on the
      // first run, and was caught by reading the rows back rather than by the run reporting
      // anything wrong.
      confirmed: false,
    },
    now: NOW,
  }))

  const res = await persistActions(TENANT, ACTOR, actions)
  console.log('')
  console.log(res.ok ? `Applied. ${actions.length} profiles created.` : `Refused: ${res.error}`)
  if (!res.ok) process.exitCode = 1
}

main().catch((e) => {
  console.log('Failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
