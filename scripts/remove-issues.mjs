#!/usr/bin/env node
/**
 * Remove issues from the raw register by id.
 *
 * `data/issues.raw.json` is the source; `data/issues.seed.json` is generated from it by
 * `npm run transform`. Deleting from the seed alone is undone by the next transform, silently,
 * which is why this edits the raw file and tells you to re-run the transform.
 *
 * Dry by default, like every other script here that touches data. `--apply` writes.
 *
 * Removing an issue is not the same as archiving one. The application has `softDelete` for
 * "this happened and is no longer live", and it keeps the record. This is for entries that
 * should never have been in the register at all — it takes them out of the source, so nothing
 * downstream can rebuild them.
 *
 *   node scripts/remove-issues.mjs --ids OAPIL-078,OAPIL-079
 *   node scripts/remove-issues.mjs --ids-from-subject "Updated sheet of current points."
 *   node scripts/remove-issues.mjs --ids ... --apply
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const APPLY = argv.includes('--apply')

const rawPath = join(root, 'data/issues.raw.json')
const issues = JSON.parse(readFileSync(rawPath, 'utf8'))

const byId = (flag('--ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const bySubject = flag('--ids-from-subject')

if (!byId.length && !bySubject) {
  console.error('Nothing selected. Pass --ids A,B or --ids-from-subject "<prefix>".')
  process.exit(1)
}

const doomed = new Set(byId)
if (bySubject) {
  for (const i of issues) {
    if (typeof i.subject === 'string' && i.subject.startsWith(bySubject)) doomed.add(i.id)
  }
}

const present = issues.filter((i) => doomed.has(i.id))
const missing = [...doomed].filter((id) => !present.some((i) => i.id === id))
const survivors = issues.filter((i) => !doomed.has(i.id))

/*
 * Refuse rather than orphan. An issue removed while another still points at it leaves a
 * dependency or duplicate marker aimed at nothing, and the reader of that marker has no way to
 * tell a deliberate removal from a data fault.
 */
const dangling = []
for (const s of survivors) {
  const blob = JSON.stringify(s)
  for (const id of doomed) if (blob.includes(id)) dangling.push(`${s.id} references ${id}`)
}

console.log(`selected      : ${doomed.size}`)
console.log(`found in raw  : ${present.length}`)
if (missing.length) console.log(`not found     : ${missing.join(', ')}`)
console.log(`register      : ${issues.length} -> ${survivors.length}`)

const statuses = {}
for (const i of present) statuses[i.status] = (statuses[i.status] ?? 0) + 1
console.log(`statuses lost : ${JSON.stringify(statuses)}`)

if (dangling.length) {
  console.error(`\nRefusing: ${dangling.length} surviving issues reference a removed one.`)
  for (const d of dangling.slice(0, 20)) console.error(`  ${d}`)
  process.exit(1)
}

for (const i of present) {
  console.log(`  ${i.id}  ${i.module ?? ''} — ${String(i.desc ?? '').slice(0, 70)}`)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write data/issues.raw.json.')
  process.exit(0)
}

writeFileSync(rawPath, JSON.stringify(issues.filter((i) => !doomed.has(i.id)), null, 2))
console.log(`\nWrote data/issues.raw.json (${survivors.length} issues).`)
console.log('Now run: npm run transform')
console.log('The database keeps its own copy — see scripts/db-remove-issues.mjs.')
