/**
 * Attribution must follow the actor parameter, and nothing in an action may override it.
 *
 * Run with `npm run audit:attribution`.
 *
 * This exists because the static check in `tenant-audit.mjs` proves the *shape* — that the
 * reducer imports no ambient identity and takes an actor — and cannot prove the behaviour. It
 * would not notice someone writing `by: 'Nishant Sekhar'` inside a single arm, which is
 * exactly how the defect it guards against got in: one constant, read everywhere, invisible
 * because it was consistent.
 *
 * So this runs the real reducer. Two different actors apply one identical action; if the
 * attribution does not differ, something is reading a name from somewhere other than the
 * parameter. It also asserts that `Action` carries no attribution field, because the server
 * replays the browser's actions verbatim — a field there would be the client naming itself.
 */
import { apply, initWorkspace, type Action, type SeedIssueInput } from '../lib/workspace'
import type { Actor } from '../lib/actor'

const ISSUE: SeedIssueInput = {
  id: 'PROOF-001',
  client: 'OAPIL',
  engagement: 'OAPIL Engagement',
  module: 'Inventory',
  subject: 'A fixture, not a record of anything',
  description: '',
  type: 'Defect',
  severity: 'Medium',
  status: 'Open',
  owner: 'Someone',
  raisedBy: 'Someone',
  accountable: 'OAPIL',
  raised: '2026-08-01',
  lastActivity: '2026-08-01',
  actualEnd: null,
  age: 14,
  daysSinceActivity: 14,
  nextAction: '',
  evidence: '',
  evidenceDate: '',
  verification: '',
  source: '',
  reference: '',
  clientImpact: '',
} as SeedIssueInput

const seed = initWorkspace([ISSUE], [])

const ALICE: Actor = { id: 'alice', name: 'Alice Operator' }
const BOB: Actor = { id: 'bob', name: 'Bob Operator' }

/** One action per family that records attribution, so a regression in any arm is caught. */
const CASES: { what: string; action: Action }[] = [
  {
    what: 'updateIssue',
    action: { t: 'updateIssue', id: 'PROOF-001', patch: { nextAction: 'Chase' }, now: '2026-08-15T10:00:00.000Z' },
  },
  {
    what: 'setDates',
    action: { t: 'setDates', id: 'PROOF-001', start: '2026-08-10', end: '2026-08-20', now: '2026-08-15T10:00:00.000Z' },
  },
  {
    what: 'config (label)',
    action: { t: 'config', op: { k: 'setLabel', scopeId: 'ROOT', key: 'TIER_MODULE', label: 'Workstream' }, now: '2026-08-15T10:00:00.000Z' },
  },
]

const failures: string[] = []

for (const { what, action } of CASES) {
  const a = apply(seed, action, ALICE)
  const b = apply(seed, action, BOB)
  if (a.error || b.error) {
    failures.push(`${what}: the reducer rejected the fixture (${a.error ?? b.error})`)
    continue
  }
  const lastBy = (s: typeof seed) => s.audit[s.audit.length - 1]?.by
  const [aBy, bBy] = [lastBy(a.state), lastBy(b.state)]
  if (!aBy || !bBy) {
    failures.push(`${what}: produced no audit entry to attribute`)
  } else if (aBy !== ALICE.name || bBy !== BOB.name) {
    failures.push(`${what}: expected "${ALICE.name}"/"${BOB.name}", got "${aBy}"/"${bBy}"`)
  } else {
    console.log(`  ${what.padEnd(16)} ${aBy} / ${bBy}`)
  }
}

/* No action may carry attribution — the client sends these and the server replays them. */
const forgeable = CASES.filter(({ action }) =>
  Object.keys(action).some((k) => /^(actor|by|user|operator)$/i.test(k)),
)
if (forgeable.length) {
  failures.push(`Action carries an attribution field the client could forge: ${forgeable.map((f) => f.what).join(', ')}`)
}

console.log('')
if (failures.length) {
  console.log('FAIL')
  for (const f of failures) console.log('  ' + f)
  process.exit(1)
}
console.log(`Attribution: ${CASES.length}/${CASES.length} arms follow the actor parameter; no action can override it.`)
