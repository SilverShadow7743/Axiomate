/**
 * Remove issues from a tenant's database, by id.
 *
 * The companion to `scripts/remove-issues.mjs`, which edits the source register. Both are
 * needed and neither is enough: the register is what a fresh install seeds from, and the
 * database is what a running install serves. Editing one and not the other leaves a workspace
 * that disagrees with its own source, and the disagreement is invisible until somebody reseeds.
 *
 * Deletes rather than archives. `softDelete` exists in the application for "this happened and
 * is no longer live" and it keeps the record; this is for entries that should not be in the
 * register at all. Every table that hangs off `Issue` is `onDelete: Cascade`, so the activities,
 * evidence, notes, notifications, approvals, time entries, estimates, revisions, relationships
 * and dependencies belonging to a removed issue go with it. That is the point, and it is why
 * this prints what it is about to take before it takes it.
 *
 * Dry by default. `--apply` writes, inside one transaction, so a failure part-way leaves the
 * workspace as it was rather than half-removed.
 *
 *   node scripts/db-remove-issues.mjs --tenant axiocloud --ids OAPIL-078,OAPIL-079
 *   node scripts/db-remove-issues.mjs --tenant axiocloud --ids ... --apply
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const APPLY = argv.includes('--apply')

/** The password is never printed, here or in an error. */
const mask = (url) => url.replace(/:\/\/([^:@/]+):([^@]*)@/, '://$1:***@')

function readUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim()
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return null
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='))
  if (!line) return null
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
}

const tenant = flag('--tenant')
const ids = (flag('--ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

if (!tenant || !ids.length) {
  console.error('Usage: node scripts/db-remove-issues.mjs --tenant <id> --ids A,B [--apply]')
  process.exit(1)
}

const url = readUrl()
if (!url) {
  console.error('DATABASE_URL is not set and .env does not carry one.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
console.log(`database : ${mask(url)}`)
console.log(`tenant   : ${tenant}`)

/*
 * Parameterised, always. These ids arrive on a command line and are interpolated into nothing —
 * a delete built by string concatenation is one stray quote away from being a different delete.
 */
const found = await client.query(
  'SELECT id, module, description, status FROM "Issue" WHERE "tenantId" = $1 AND id = ANY($2::text[]) ORDER BY id',
  [tenant, ids],
)

const missing = ids.filter((id) => !found.rows.some((r) => r.id === id))
console.log(`selected : ${ids.length}`)
console.log(`present  : ${found.rows.length}`)
if (missing.length) console.log(`absent   : ${missing.join(', ')}`)

if (!found.rows.length) {
  console.log('\nNothing to remove.')
  await client.end()
  process.exit(0)
}

/** What goes with them. Counted before the delete, because afterwards there is nothing to count. */
const dependents = [
  ['IssueActivity', 'issueId'],
  ['Evidence', 'issueId'],
  ['IssueNote', 'issueId'],
  ['TimeEntry', 'issueId'],
  ['IssueEstimate', 'issueId'],
  ['Approval', 'subjectId'],
  ['Notification', 'aboutId'],
]
console.log('\ncascading with them:')
for (const [table, column] of dependents) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM "${table}" WHERE "tenantId" = $1 AND "${column}" = ANY($2::text[])`,
    [tenant, ids],
  )
  if (rows[0].n) console.log(`  ${table.padEnd(14)} ${rows[0].n}`)
}
const { rows: rel } = await client.query(
  'SELECT count(*)::int AS n FROM "IssueRelationship" WHERE "tenantId" = $1 AND ("sourceIssueId" = ANY($2::text[]) OR "targetIssueId" = ANY($2::text[]))',
  [tenant, ids],
)
if (rel[0].n) console.log(`  ${'IssueRelationship'.padEnd(14)} ${rel[0].n}`)

console.log('\nissues:')
for (const r of found.rows) {
  console.log(`  ${r.id}  ${(r.module ?? '').padEnd(16)} ${String(r.description ?? '').slice(0, 62)}`)
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete.')
  await client.end()
  process.exit(0)
}

await client.query('BEGIN')
try {
  const del = await client.query('DELETE FROM "Issue" WHERE "tenantId" = $1 AND id = ANY($2::text[])', [tenant, ids])
  await client.query('COMMIT')
  console.log(`\nDeleted ${del.rowCount} issues and everything cascading from them.`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(`\nRolled back: ${e.message}`)
  process.exitCode = 1
}
await client.end()
