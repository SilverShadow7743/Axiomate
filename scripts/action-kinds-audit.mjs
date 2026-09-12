/**
 * The three action registries and every client dispatch must agree.
 *
 * Run with `npm run audit:kinds`.
 *
 * Three files each name the action vocabulary: `lib/actionShape.ts` (`SHAPES`, type-exhaustive
 * over `Action` minus `notify`), `lib/access.ts` (`ACTION_PERMISSIONS`), and
 * `app/api/workspace/route.ts` (`SERVER_ONLY`, from which `KINDS` is now derived). Twice the
 * hand-maintained allow-list drifted from the other two — nine kinds in I1, three more found
 * by the 12 Sep audit — and each time a built, typechecked, scenario-passing action was
 * unreachable from the UI, and because the endpoint refuses a batch whole and the queue treats
 * a 4xx as terminal, each time persistence silently stopped for the session.
 *
 * This is a text scan, like `tenant-audit.mjs`, and for the same reason: `tsc` cannot see that
 * a component dispatches a kind the route refuses, because the route's set is runtime data.
 *
 * Checks:
 *   1. every `SHAPES` key has an `ACTION_PERMISSIONS` entry (omission means the funnel skips can());
 *   2. every kind a component dispatches (`t: 'x'`) is in `SHAPES` and not in `SERVER_ONLY`;
 *   3. every `SERVER_ONLY` name is a real `SHAPES` key (a typo there would silently allow it).
 */
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(p, 'utf8')
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length))

/** Top-level keys of the object literal that starts at `marker`. */
function topLevelKeys(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`marker not found: ${marker}`)
  const open = src.indexOf('{', at)
  let depth = 0
  let end = open
  for (; end < src.length; end++) {
    const c = src[end]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) break
    }
  }
  const keys = []
  let d = 0
  for (const line of src.slice(open + 1, end).split('\n')) {
    if (d === 0) {
      const m = line.match(/^\s{2}(['"]?)([A-Za-z_]\w*)\1\s*:/)
      if (m) keys.push(m[2])
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') d++
      else if (ch === '}' || ch === ')' || ch === ']') d--
    }
  }
  return keys
}

const shapes = new Set(topLevelKeys(strip(read('lib/actionShape.ts')), 'const SHAPES = {'))
const permissions = new Set(topLevelKeys(strip(read('lib/access.ts')), 'export const ACTION_PERMISSIONS'))

const routeSrc = strip(read('app/api/workspace/route.ts'))
const serverOnlyBlock = routeSrc.slice(routeSrc.indexOf('const SERVER_ONLY'), routeSrc.indexOf('])', routeSrc.indexOf('const SERVER_ONLY')))
const serverOnly = new Set([...serverOnlyBlock.matchAll(/['"]([A-Za-z_]\w*)['"]/g)].map((m) => m[1]))

/** Every `t: 'kind'` a browser-side file dispatches. Route handlers are excluded: they are the server. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.(tsx|ts)$/.test(entry.name) && !/route\.ts$/.test(entry.name)) out.push(p)
  }
  return out
}
const dispatched = new Map()
for (const file of [...walk('components'), ...walk('app')]) {
  const src = strip(read(file))
  for (const m of src.matchAll(/\bt:\s*['"]([A-Za-z_]\w*)['"]/g)) {
    if (!dispatched.has(m[1])) dispatched.set(m[1], new Set())
    dispatched.get(m[1]).add(path.relative('.', file))
  }
}

const findings = []
for (const k of shapes) {
  if (!permissions.has(k)) findings.push(`SHAPES has '${k}' but ACTION_PERMISSIONS does not — the funnel would skip can() for it`)
}
for (const k of serverOnly) {
  // `notify` is excluded from SHAPES by type (see actionShape.ts) and still has a permission
  // entry, so a server-only name is real if either registry knows it.
  if (!shapes.has(k) && !permissions.has(k)) findings.push(`SERVER_ONLY names '${k}', which neither SHAPES nor ACTION_PERMISSIONS knows`)
}
for (const [k, files] of dispatched) {
  // A `t:` that is not an action kind at all is somebody else's object; only kinds the
  // reducer knows are judged here, and a kind the reducer knows but SHAPES does not is
  // exactly the hole this exists to find.
  if (!shapes.has(k) && !permissions.has(k)) continue
  if (!shapes.has(k)) findings.push(`'${k}' is dispatched from ${[...files].join(', ')} but has no SHAPES entry — the route would refuse it`)
  else if (serverOnly.has(k)) findings.push(`'${k}' is dispatched from ${[...files].join(', ')} but the route marks it server-only`)
}

console.log(`Action kinds: ${shapes.size} shapes, ${permissions.size} permission entries, ${serverOnly.size} server-only, ${dispatched.size} kinds dispatched from the browser`)
if (findings.length === 0) {
  console.log('PASS — the three registries and every client dispatch agree.')
} else {
  console.log(`FAIL — ${findings.length} disagreement(s):`)
  for (const f of findings) console.log(`  ${f}`)
  process.exitCode = 1
}
