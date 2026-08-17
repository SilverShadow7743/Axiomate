/**
 * Record what the operating partner said about the five allocated people.
 *
 * Stated on 17 August 2026, and stated is the operative word: every profile in this workspace
 * carried `source: 'default'` until now, which meant the capacity machinery had no real input
 * anywhere. `default` is the shipped fallback. It is not a claim about anybody.
 *
 * Two kinds of fact, and they are recorded differently on purpose.
 *
 * ---------------------------------------------------------------------------
 * Grade and track go on the person, because they are not dated
 *
 * "Senior Technical Consultant on the X++ track" is true until it is not, and nobody has said
 * when it started. Recording it as an effective-dated version would require a `validFrom`, and
 * the only honest one available is "we do not know" — which a date field cannot express.
 *
 * Jaya's grade is **Intern**, with `developingToward: 'Analyst'`. Writing "Analyst" in the grade
 * would put somebody at a seniority they have not reached, and every staffing view downstream
 * would read it as fact.
 *
 * ---------------------------------------------------------------------------
 * The working pattern goes on the timeline, because it is exactly the thing that changes
 *
 * `validFrom` is **2026-08-17**, which is not chosen: it is the start date already recorded on
 * every one of the six allocations. Picking a tidier date — the start of the financial year, the
 * first of the month — would have invented a fact in the one place this design exists to stop
 * facts being invented.
 *
 * `validTo` is null, meaning still true. Not the allocation's 2026-12-31 end: an allocation
 * ending is a person coming off a project, not a person ceasing to have a working week.
 *
 * Nothing is backfilled before 17 August. A query for July returns null from `valueAt`, and null
 * means "not known then", which is the truth — no working pattern was ever recorded for July.
 * The tempting alternative, stamping these values back to some arbitrary start, would turn an
 * honest absence into a fabricated record and is the failure the whole mechanism guards against.
 *
 *   npx tsx --conditions=react-server scripts/staffing-facts.ts          # dry run
 *   npx tsx --conditions=react-server scripts/staffing-facts.ts --apply
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { valueAt } from '../lib/versioning'
import type { Action } from '../lib/workspace'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const APPLY = process.argv.includes('--apply')
const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
const ACTOR: Actor = {
  id: 'staffing-facts',
  name: process.env.AXIOMATE_OPERATOR ?? 'Nishant Sekhar',
  email: process.env.AXIOMATE_OPERATOR_EMAIL ?? 'sekharn@axiocloudsolutions.com',
}
const NOW = new Date().toISOString()

/** The allocation start date already on record for all six allocations. Not chosen — read. */
const FROM = '2026-08-17'

/** Five days a week, eight hours a day. */
const PATTERN = { daysPerWeek: 5, hoursPerDay: 8 }

const CAREERS: { name: string; grade: string; track?: string; developingToward?: string }[] = [
  { name: 'Amolak', grade: 'Senior Technical Consultant', track: 'X++' },
  { name: 'Dharmendra Kumar Dwivedi', grade: 'Senior Functional Consultant', track: 'SCM / manufacturing' },
  { name: 'Jaya Jothi R', grade: 'Intern', developingToward: 'Analyst' },
  { name: 'Tarun', grade: 'Growth Consultant', track: 'Sales and marketing' },
]

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const people = Object.values(state.model.people ?? {})
  const actions: Action[] = []
  const lines: string[] = []

  /* ---------------- grade and track ---------------- */

  for (const c of CAREERS) {
    const p = people.find((x) => x.name === c.name)
    if (!p) {
      console.error(`${c.name} is not in the directory. Refusing — creating people is`)
      console.error('scripts/directory-staffing.ts, and doing it here would hide the gap.')
      process.exit(1)
    }
    if (p.grade === c.grade && p.track === c.track && p.developingToward === c.developingToward) {
      lines.push(`${p.name.padEnd(26)} career already recorded`)
      continue
    }
    actions.push({
      t: 'config',
      op: {
        k: 'upsertPerson' as const,
        id: p.id,
        name: p.name,
        roleIds: p.roleIds,
        email: p.email,
        grade: c.grade,
        track: c.track,
        developingToward: c.developingToward,
      },
      now: NOW,
    } as Action)
    const target = c.developingToward ? ` → ${c.developingToward}` : ''
    lines.push(`${p.name.padEnd(26)} ${c.grade}${target}${c.track ? `  · ${c.track}` : ''}`)
  }

  /* ---------------- the working pattern, effective-dated ---------------- */

  // Everyone with a live allocation. Read from the allocations rather than listed here, so a
  // sixth person allocated tomorrow is not silently left without a pattern.
  const allocated = [
    ...new Set(Object.values(state.allocations ?? {}).filter((a) => !a.deletedAt).map((a) => a.person)),
  ].sort()

  const versions = Object.values(state.versions ?? {})

  for (const name of allocated) {
    const p = people.find((x) => x.name === name)
    if (!p) {
      lines.push(`${name.padEnd(26)} ALLOCATED BUT NOT IN THE DIRECTORY — skipped`)
      continue
    }
    // Asked at the date being recorded, not "does any version exist": a person can legitimately
    // gain a second period later, and refusing on the strength of an unrelated one would make
    // this script un-rerunnable the moment anybody's week changes.
    const already = valueAt(versions, 'person.workingPattern', p.id, FROM)
    if (already) {
      lines.push(`${name.padEnd(26)} pattern already recorded from ${already.validFrom}`)
      continue
    }
    actions.push({
      t: 'recordVersion',
      subjectKind: 'person.workingPattern',
      subjectId: p.id,
      validFrom: FROM,
      validTo: null,
      value: PATTERN,
      reason: 'Stated by the engagement leader, 17 August 2026. Dated from the allocation start already on record.',
      now: NOW,
    } as Action)
    lines.push(`${name.padEnd(26)} ${PATTERN.daysPerWeek}d × ${PATTERN.hoursPerDay}h from ${FROM} (open-ended)`)
  }

  console.log('AXIOMATE — STATED STAFFING FACTS\n')
  for (const l of lines) console.log(`  ${l}`)
  console.log(`\n  ${actions.length} change(s)`)
  console.log('\n  Nothing is backfilled before ' + FROM + '. A capacity question about July still')
  console.log('  answers "not known then", because it was not.')

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
