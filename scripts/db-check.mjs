/**
 * Can this deployment reach its database, and is it ready to be written to?
 *
 * Written because the answer was previously buried. A wrong password surfaced as a Prisma
 * error inside a server-rendered page, in a browser console, wrapped in a Turbopack stack
 * trace — findable, but only by somebody who already suspected the database. Everything else
 * looked fine, because the app is designed to degrade to the browser mirror rather than break,
 * and it does that job well enough to hide the cause.
 *
 * Four questions, in the order they stop being answerable:
 *
 *   1. Is DATABASE_URL set, and does it parse?
 *   2. Is something listening?
 *   3. Do the credentials work?
 *   4. Has the schema been applied?
 *
 * Read-only. It creates nothing, migrates nothing and writes nothing — a check that changes
 * the thing it is checking is not a check.
 *
 *   npm run db:check
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The password is never printed, here or in an error. Everything else is. */
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

const say = (ok, text, detail) => {
  console.log(`  ${ok === null ? '·' : ok ? 'ok  ' : 'FAIL'} ${text}`)
  if (detail) console.log(`       ${detail}`)
}

console.log('')
console.log('AXIOMATE — DATABASE CHECK')
console.log('')

const url = readUrl()
if (!url) {
  say(false, 'DATABASE_URL is not set', 'Run `node scripts/db-setup.mjs` to generate .env.')
  console.log('\nThe app runs without one — work is saved in the browser only.\n')
  process.exit(1)
}

let parsed
try {
  parsed = new URL(url)
} catch (err) {
  say(false, 'DATABASE_URL does not parse', err.message)
  process.exit(1)
}

say(true, `DATABASE_URL reads ${mask(url)}`)

const password = decodeURIComponent(parsed.password)
const client = new pg.Client({
  user: decodeURIComponent(parsed.username),
  password,
  host: parsed.hostname,
  port: Number(parsed.port || 5432),
  database: parsed.pathname.slice(1),
  connectionTimeoutMillis: 8000,
})

try {
  await client.connect()
} catch (err) {
  const code = err.code ?? ''
  /**
   * The three failures that look alike from the app and mean entirely different things. Each
   * gets the remedy rather than the symptom — this file exists so that nobody has to know
   * that 28P01 means the password and ECONNREFUSED means the service.
   */
  if (code === '28P01') {
    say(false, 'The server rejected these credentials', 'The role exists or does not; either way its password is not the one in .env.')
    console.log('')
    console.log('  Run the generated setup as a superuser. It is idempotent, and it sets the')
    console.log('  role password to exactly what .env already holds.')
    console.log('')
    console.log('  In SQL Shell (psql) — which does NOT start in this directory, so the path')
    console.log('  must be absolute, with forward slashes, quoted:')
    console.log('')
    console.log(`      \\i '${path.join(ROOT, 'scripts', 'db-setup.sql').replace(/\\/g, '/')}'`)
    console.log('')
    console.log('  Or from a shell already here:')
    console.log('')
    console.log('      psql -U postgres -f scripts/db-setup.sql')
    console.log('')
    console.log('  Expect errors: the role statements are written so whichever one does not')
    console.log('  apply fails harmlessly. The last line printed should begin "db-setup ran."')
    console.log('  — if it does not, the file was never found and nothing was changed.')
    console.log('')
    console.log('  Then run this check again.')
  } else if (code === '3D000') {
    say(false, `The database "${parsed.pathname.slice(1)}" does not exist`, 'psql -U postgres -f scripts/db-setup.sql creates it.')
  } else if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
    say(false, `Nothing is listening on ${parsed.hostname}:${parsed.port || 5432}`, 'The service is stopped, or the host and port are wrong.')
  } else {
    say(false, 'The connection failed', `${code} ${err.message}`)
  }
  console.log('')
  process.exit(1)
}

say(true, 'Connected, and the credentials are accepted')

/**
 * Whether the schema is there, asked in a way that cannot be confused by an empty tenant.
 *
 * `_prisma_migrations` is the honest question — it distinguishes "no migration has run" from
 * "migrations ran and nobody has used the app yet", which count the tables cannot.
 */
try {
  const applied = await client.query(
    `select migration_name, finished_at from _prisma_migrations order by finished_at`,
  )
  const pending = applied.rows.filter((r) => !r.finished_at)
  say(true, `${applied.rows.length} migration(s) applied`, applied.rows.map((r) => r.migration_name).join(', ') || undefined)
  if (pending.length) say(false, `${pending.length} did not finish`, pending.map((r) => r.migration_name).join(', '))

  const tables = await client.query(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  )
  say(true, `${tables.rows[0].n} table(s) in the public schema`)

  console.log('')
  console.log(pending.length ? '  Run `npm run db:migrate` to finish applying the schema.' : '  Ready. `npm run audit:persistence` will exercise it.')
} catch (err) {
  if (err.code === '42P01') {
    say(null, 'No migrations have been applied yet', 'Run `npm run db:migrate` to create the schema.')
  } else {
    say(false, 'The schema could not be inspected', `${err.code ?? ''} ${err.message}`)
  }
}

await client.end()
console.log('')
