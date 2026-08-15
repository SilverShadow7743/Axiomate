/**
 * Effort and timeline are different things, and an agreed estimate cannot be quietly rewritten.
 *
 * Run with `npm run audit:estimation`.
 *
 * Two claims are worth a script rather than a comment. The first is arithmetic that a screen
 * makes very easy to get wrong: adding people divides effort, but it cannot divide a chain of
 * steps that must happen in order, and an earlier version of this code let four resources
 * compress a strictly sequential week into under two days. The second is a rule about
 * authority: once somebody has agreed an estimate, changing what it says is an event with a
 * reason attached, not an edit — and the reducer, not the form, is what enforces that.
 */
import {
  DEFAULT_SIZE_BANDS,
  criticalPathHours,
  deriveEffort,
  deriveTimeline,
  emptyEstimate,
  type Estimate,
  type EstimateStep,
} from '../lib/estimation'
import { apply, initWorkspace, type Action, type SeedIssueInput } from '../lib/workspace'
import type { Actor } from '../lib/actor'

const A: Actor = { id: 'a', name: 'Tester' }
const NOW = '2026-08-15T10:00:00.000Z'
const BANDS = DEFAULT_SIZE_BANDS

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

/* ------------------------------------------------------------------ *
 * 1. A sequential chain is a floor that capacity cannot break
 * ------------------------------------------------------------------ */

/** Four steps of one day each, each waiting on the one before it. */
const CHAIN: EstimateStep[] = [
  { id: 's1', activity: 'Reproduce', effortHours: 14, dependsOn: [] },
  { id: 's2', activity: 'Fix', effortHours: 14, dependsOn: ['s1'] },
  { id: 's3', activity: 'Test', effortHours: 14, dependsOn: ['s2'] },
  { id: 's4', activity: 'Deploy', effortHours: 14, dependsOn: ['s3'] },
]

const withResources = (n: number): Estimate => ({
  ...emptyEstimate('2026-08-17'),
  scores: { business: 3, technical: 3, integration: 3, testing: 3, data: 3 },
  approvedEffortHours: 56,
  capacity: { hoursPerDay: 8, resources: n, allocationPct: 100 },
  steps: CHAIN,
})

const days = (n: number) => {
  const e = withResources(n)
  return deriveTimeline(e, deriveEffort(e, BANDS)).workingDays
}

check('the chain is measured in hours, not steps', criticalPathHours(CHAIN) === 56, `${criticalPathHours(CHAIN)}h`)
check(
  'adding people cannot shorten a strictly sequential chain',
  days(1) === days(2) && days(2) === days(4) && days(8) === days(1),
  `1:${days(1)}d 2:${days(2)}d 4:${days(4)}d 8:${days(8)}d`,
)
check(
  'and the timeline says why it did not move',
  deriveTimeline(withResources(4), deriveEffort(withResources(4), BANDS)).dependencyBound,
  'dependency-bound',
)

/* Parallel work is the control: with no dependencies, people do divide the duration. */
const PARALLEL: EstimateStep[] = CHAIN.map((s) => ({ ...s, dependsOn: [] }))
const parallelDays = (n: number) => {
  const e = { ...withResources(n), steps: PARALLEL }
  return deriveTimeline(e, deriveEffort(e, BANDS)).workingDays
}
check(
  'independent work does divide across people',
  parallelDays(4)! < parallelDays(1)!,
  `1:${parallelDays(1)}d -> 4:${parallelDays(4)}d`,
)

/* A cycle is a half-drawn breakdown, not a crash. */
const CYCLE: EstimateStep[] = [
  { id: 'a', activity: 'A', effortHours: 8, dependsOn: ['b'] },
  { id: 'b', activity: 'B', effortHours: 8, dependsOn: ['a'] },
]
check('a cycle in the breakdown returns a number instead of hanging', Number.isFinite(criticalPathHours(CYCLE)), `${criticalPathHours(CYCLE)}h`)

/* ------------------------------------------------------------------ *
 * 2. An agreed estimate cannot be silently overwritten
 * ------------------------------------------------------------------ */

const issue: SeedIssueInput = {
  id: 'OAPIL-1', client: 'OAPIL', engagement: 'OAPIL Engagement', module: 'Inventory',
  subject: 'Subject', description: '', type: 'Defect', severity: 'Medium',
  status: 'Open', owner: 'Someone', raisedBy: 'Someone', accountable: 'OAPIL',
  raised: '2026-08-01', lastActivity: '2026-08-01', actualEnd: null, age: 1,
  daysSinceActivity: 1, nextAction: '', evidence: '', evidenceDate: '',
  verification: '', source: '', reference: '', clientImpact: '',
} as SeedIssueInput

const seed = initWorkspace([issue], [])
const patch = (state: typeof seed, p: Record<string, unknown>, reason?: string) =>
  apply(state, { t: 'setEstimate', issueId: 'OAPIL-1', patch: p, reason, now: NOW } as Action, A)

/* Drafting: edits are just edits, and nothing is logged as a revision. */
const drafted = patch(seed, {
  scores: { business: 3, technical: 4, integration: 2, testing: 3, data: 2 },
})
check('a draft can be edited without a reason', !drafted.error, drafted.error ?? '')
check('drafting mints no revision', Object.keys(drafted.state.estimateRevisions).length === 0)

const agreed = apply(drafted.state, { t: 'baselineEstimate', issueId: 'OAPIL-1', now: NOW } as Action, A)
check('the estimate can be agreed', Boolean(agreed.state.estimates['OAPIL-1'].baselinedAt), agreed.message ?? agreed.error ?? '')

/* Agreed: a change a reader would notice needs a reason. */
const silent = patch(agreed.state, { approvedEffortHours: 200 })
check('an agreed estimate refuses a silent change', Boolean(silent.error), silent.error ?? '(accepted)')
check('and the refusal changes nothing', silent.state.estimates['OAPIL-1'] === agreed.state.estimates['OAPIL-1'])

const revised = patch(agreed.state, { approvedEffortHours: 200 }, 'Client added two more interfaces.')
check('with a reason it is accepted', !revised.error, revised.error ?? '')
const revs = Object.values(revised.state.estimateRevisions)
check('and recorded as a revision', revs.length === 1, revs[0]?.reason ?? '(none)')
check(
  'the revision keeps both halves — effort and duration',
  revs.length === 1 && revs[0].from.effortHours !== revs[0].to.effortHours && 'workingDays' in revs[0].to,
  revs.length ? `${revs[0].from.effortHours}h -> ${revs[0].to.effortHours}h` : '',
)

/* A change nobody would notice is not an event. */
const cosmetic = patch(revised.state, { notes: 'Spoke to the integration lead.' })
check(
  'an edit that moves no number needs no reason',
  !cosmetic.error && Object.keys(cosmetic.state.estimateRevisions).length === 1,
  cosmetic.error ?? 'no new revision',
)

console.log('')
if (fail.length) { console.log('FAIL: ' + fail.join(', ')); process.exit(1) }
console.log('Estimation: capacity cannot break a dependency chain, and an agreed number cannot move without a reason.')
