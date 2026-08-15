/**
 * Every Prisma call in lib/db must name a tenant.
 *
 * Run with `npm run audit:tenancy`.
 *
 * This exists because typecheck and build prove nothing about isolation: a query that forgets
 * its `where` compiles perfectly, passes every type, and returns every firm's rows. When this
 * check was first written it found nine such calls.
 *
 * It is a text scan, so it is defeated by indirection — a `where: scope` that resolves to
 * `{ tenantId }` elsewhere reads as unscoped here. That is deliberate rather than a
 * limitation to work around: `repo.ts` was changed to write the tenant out at every call
 * instead, because a reader should be able to see the scoping without following a variable.
 * If a future call needs indirection, the right fix is to make it explicit again, not to make
 * this script cleverer.
 *
 * The real guarantee is row-level security, which needs a database role per request, which
 * needs identity. Until then this is the check, and it should stay cheap enough to run often.
 */
import fs from 'fs'
import path from 'path'

const DIR = 'lib/db'
const CALL = /\b(?:tx|db|prisma)\.([a-zA-Z]+)\.(findMany|findUnique|findFirst|create|createMany|upsert|update|updateMany|delete|deleteMany|count|aggregate)\b/g

/** Models that are not tenant-scoped: the tenant table itself is keyed by its own id. */
const EXEMPT = new Set(['tenant', '$transaction'])

let findings = []
let checked = 0

for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith('.ts')) continue
  const p = path.join(DIR, file)
  // Strip comments first — a doc comment that quotes `prisma.issue.findMany()` is prose, not
  // a query, and counting it would train the reader to ignore this script's output.
  const src = fs
    .readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length))
  const lines = src.split('\n')

  for (const m of src.matchAll(CALL)) {
    const [full, model, op] = m
    const lineNo = src.slice(0, m.index).split('\n').length
    if (EXEMPT.has(model)) continue
    checked++

    // Take the call's argument span: from the match to the matching close paren.
    let i = src.indexOf('(', m.index + full.length)
    if (i === -1) { findings.push({ p, lineNo, full, why: 'could not parse arguments' }); continue }
    let depth = 0, end = i
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')') { depth--; if (depth === 0) break }
    }
    const args = src.slice(i, end + 1)

    const scoped = /tenantId/.test(args)
    if (!scoped) {
      findings.push({ p, lineNo, full, why: 'no tenantId in the call', snippet: lines[lineNo - 1].trim() })
    }
  }
}

console.log(`Prisma calls checked in ${DIR}: ${checked}`)
if (findings.length === 0) {
  console.log('PASS — every tenant-scoped model call names a tenant.')
} else {
  console.log(`FAIL — ${findings.length} unscoped call(s):`)
  for (const f of findings) console.log(`  ${f.p}:${f.lineNo}  ${f.full}  (${f.why})\n    ${f.snippet ?? ''}`)
  process.exitCode = 1
}

/* The mappers must all stamp the tenant onto the row they build. */
const map = fs.readFileSync('lib/db/map.ts', 'utf8')
const toRow = [...map.matchAll(/export function (\w+ToRow)\(/g)].map((m) => m[1])
const unstamped = toRow.filter((fn) => {
  const start = map.indexOf(`export function ${fn}(`)
  const body = map.slice(start, map.indexOf('\n}', start))
  return !/tenantId/.test(body)
})
console.log(`\nRow mappers: ${toRow.length} — ${unstamped.length ? 'MISSING tenantId: ' + unstamped.join(', ') : 'all stamp tenantId'}`)
if (unstamped.length) process.exitCode = 1
