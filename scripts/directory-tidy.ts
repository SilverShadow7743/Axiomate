/**
 * Turn the harvested owner column back into a directory of people.
 *
 * `initModel` seeds the person directory from every distinct owner in the imported log, which
 * is the honest thing to do on import — the log records who was working an issue and the
 * importer has no way to tell a name from a note. What it produces is not a directory. Of the
 * sixty entries in this workspace, roughly half are not people:
 *
 *   status text        "Requires OAPIL approval", "Deferred to next phase under AMC"
 *   organisations      "Axiocloud", "OAPIL", "Axiomate build"
 *   two people at once "Michael Thomas / Nishant Sekhar", "Amolak and Mansi Dalwadi"
 *   one person twice   "Bhandari Dhanveer" and "Dhanveer Bhandari"
 *
 * That matters now rather than cosmetically, because the next step is granting permissions, and
 * a role attached to "Security review" would sit in the access model forever.
 *
 * ---------------------------------------------------------------------------
 * What this does NOT do
 *
 * It does not touch the `owner` field on any issue. "Requires OAPIL approval" is what the log
 * actually recorded, and rewriting it would be editing the client's own history to make this
 * application's data model tidier. The entry stops being offered as a person; the record keeps
 * saying what it always said.
 *
 * ---------------------------------------------------------------------------
 * How roles are decided
 *
 * By evidence, and the evidence is weak on purpose — it is a starting point a human corrects,
 * not a verdict. Somebody who *owns* work is doing delivery; somebody who *raises* it is asking
 * for delivery. Where a person does both, the larger number decides, and a tie goes to the
 * lesser privilege. Client User is the least-privileged role in the model, so an error in that
 * direction grants nothing.
 *
 * Nobody is made an administrator by inference. That is named explicitly below and is the one
 * assignment this file will not guess at.
 *
 *   npx tsx --conditions=react-server scripts/directory-tidy.ts          # dry run
 *   npx tsx --conditions=react-server scripts/directory-tidy.ts --apply
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
const ACTOR: Actor = { id: 'directory-tidy', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }
const NOW = new Date().toISOString()

/** The one role nobody should receive by inference. */
const ADMINISTRATORS = ['Nishant Sekhar']

/**
 * Entries that are not a person, matched on what makes them one rather than by listing sixty
 * names — a list would be right once and wrong after the next import.
 */
const NOT_A_PERSON = [
  /\bapproval\b|\bapprove\b/i,
  /\bblocked\b|\bpending\b|\bdeferred\b|\brequires\b|\bto validate\b|\bto clarify\b/i,
  /\breview\b/i,
  /^axiocloud$|^oapil$|^slg$/i,
  /\bdevelopment\b|\bbuild\b|\bteam\b|\busers\b|\bcommercial\b|\badmin\b/i,
  /^unassigned/i,
  /\bneeds to\b|\bcheck with\b|\bto action\b/i,
  /—/, // an em dash in an owner cell is an annotation, never a surname
]

/** Two or more people in one cell. Real, and not a person this directory can hold. */
const COMPOUND = [/\s\/\s/, /\band\b/i, /\bvia\b/i, /,\s/]

/** The same human, written twice. Compared on sorted name parts so word order does not matter. */
const fingerprint = (name: string) =>
  name.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).sort().join(' ')

async function main() {
  const { state } = await loadWorkspace(TENANT)
  const people = Object.values(state.model.people ?? {})
  const issues = Object.values(state.issues)

  const owns = new Map<string, number>()
  const raises = new Map<string, number>()
  for (const i of issues) {
    if (i.owner) owns.set(i.owner, (owns.get(i.owner) ?? 0) + 1)
    if (i.raisedBy) raises.set(i.raisedBy, (raises.get(i.raisedBy) ?? 0) + 1)
  }

  const remove: { name: string; why: string }[] = []

  /**
   * Non-people first, duplicates second, and the order is the fix for a real mistake.
   *
   * Checking duplicates first reported "Nishant Sekhar / Michael Thomas" as the same person as
   * "Michael Thomas / Nishant Sekhar" — true of the words and nonsense about the world, because
   * neither is a person at all. Nothing can be a duplicate of something that was never an
   * entry, so the list is narrowed to real names before any of them are compared.
   */
  const real = people.filter((p) => {
    const name = p.name.trim()
    if (COMPOUND.some((r) => r.test(name))) {
      remove.push({ name, why: 'more than one person in one cell' })
      return false
    }
    if (NOT_A_PERSON.some((r) => r.test(name))) {
      remove.push({ name, why: 'a status or an organisation, not a person' })
      return false
    }
    return true
  })

  /**
   * The longer name wins, and a shorter name whose words are all contained in a longer one is
   * treated as the same person: "Somu" against "Somu Udayappan", "Samanta" against "Bibhu
   * Prasada Samanta". Matching only identical word-sets missed both, and the cost was not a
   * stray row — the two halves of one person landed on different sides of the delivery/client
   * split and would have been granted contradictory access.
   *
   * It is a heuristic, and it can be wrong about two people who genuinely share a name fragment.
   * That is why this prints what it will do before it does anything, and why a role is a
   * starting point somebody corrects rather than a verdict.
   */
  const parts = (n: string) => new Set(fingerprint(n).split(' ').filter(Boolean))
  const subsumes = (a: string, b: string) => {
    const [A, B] = [parts(a), parts(b)]
    if (A.size === 0 || B.size === 0 || A.size < B.size) return false
    for (const w of B) if (!A.has(w)) return false
    return true
  }
  const duplicateOf = new Map<string, string>()
  const byLongest = [...real].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name))

  /**
   * The same words in a different order are the same person, and this needs saying separately
   * from the subset rule above.
   *
   * "Bhandari Dhanveer" and "Dhanveer Bhandari" are one person written twice — surname first in
   * one row, last in another, which is what happens when a spreadsheet is filled in by several
   * people. Neither is longer than the other, so a rule that keeps the longer name cannot
   * separate them, and both survived a pass that was otherwise correct. The fingerprint sorts
   * the words, so it sees them as equal; the alphabetically-first is kept purely so that two
   * runs of this script agree with each other.
   */
  for (const p of byLongest) {
    if (duplicateOf.has(p.id)) continue
    for (const q of byLongest) {
      if (q.id === p.id || duplicateOf.has(q.id)) continue
      const same = fingerprint(p.name) === fingerprint(q.name)
      if (same && p.name.localeCompare(q.name) < 0) duplicateOf.set(q.id, p.name)
    }
  }

  for (const shorter of byLongest) {
    if (duplicateOf.has(shorter.id)) continue
    for (const longer of byLongest) {
      if (longer.id === shorter.id || duplicateOf.has(longer.id)) continue
      if (longer.name.length > shorter.name.length && subsumes(longer.name, shorter.name)) {
        duplicateOf.set(shorter.id, longer.name)
        break
      }
    }
  }

  const assign: { id: string; name: string; role: string; why: string }[] = []

  for (const p of real) {
    const name = p.name.trim()
    if (duplicateOf.has(p.id)) {
      remove.push({ name, why: `the same person as "${duplicateOf.get(p.id)}"` })
      continue
    }

    /* A merged person's work counts under both spellings, or the role is decided on half the
     * evidence — which is how "Somu" read as delivery while "Somu Udayappan" read as client. */
    const aliases = [name, ...[...duplicateOf].filter(([, keep]) => keep === name).map(([id]) => real.find((x) => x.id === id)!.name)]
    const o = aliases.reduce((sum, n) => sum + (owns.get(n) ?? 0), 0)
    const r = aliases.reduce((sum, n) => sum + (raises.get(n) ?? 0), 0)
    if (ADMINISTRATORS.includes(name)) {
      assign.push({ id: p.id, name, role: 'ROLE_ADMIN', why: 'named explicitly, not inferred' })
    } else if (o > r) {
      assign.push({ id: p.id, name, role: 'ROLE_FUNCTIONAL', why: `owns ${o}, raised ${r}` })
    } else {
      assign.push({
        id: p.id, name, role: 'ROLE_CLIENT_USER',
        why: r || o ? `raised ${r}, owns ${o}` : 'no work either way — least privilege',
      })
    }
  }

  console.log('')
  console.log(`AXIOMATE — DIRECTORY TIDY   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log(`${people.length} entries: ${assign.length} people kept, ${remove.length} removed`)
  console.log('')
  console.log('KEEP AND ASSIGN')
  for (const a of [...assign].sort((x, y) => x.role.localeCompare(y.role) || x.name.localeCompare(y.name))) {
    console.log(`  ${a.name.slice(0, 32).padEnd(34)}${a.role.padEnd(18)}${a.why}`)
  }
  console.log('')
  console.log('REMOVE FROM THE DIRECTORY (no issue is edited)')
  for (const r of [...remove].sort((x, y) => x.why.localeCompare(y.why) || x.name.localeCompare(y.name))) {
    console.log(`  ${r.name.slice(0, 44).padEnd(46)}${r.why}`)
  }

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }

  /* Through the ordinary reducer and write path, so every change is attributed and audited
   * exactly as it would be if somebody had made it in the Configuration screen. */
  const actions: Action[] = [
    ...assign.map((a) => ({
      t: 'config' as const,
      op: { k: 'upsertPerson' as const, id: a.id, name: a.name, roleIds: [a.role] },
      now: NOW,
    })),
    ...remove.map((r) => {
      const p = people.find((x) => x.name.trim() === r.name)!
      return { t: 'config' as const, op: { k: 'deletePerson' as const, id: p.id }, now: NOW }
    }),
  ]

  const result = await persistActions(TENANT, ACTOR, actions)
  console.log('')
  console.log(result.ok ? `Applied. ${actions.length} changes, ${result.audited} audit rows.` : `Refused: ${result.error}`)
  if (!result.ok) process.exitCode = 1
}

main()
  .catch((err) => {
    console.log('Failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
