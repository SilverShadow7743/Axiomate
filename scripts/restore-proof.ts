/**
 * Archive and restore must be reversible, and must invert each other exactly.
 *
 * Run with `npm run audit:restore`.
 *
 * The reducer arm this covers was dead code for a long time — present, allowlisted, and
 * dispatched by nothing — so it was never exercised and was wrong in two ways when it finally
 * was. Both failures are asserted here: restoring the top of a cascade used to leave every
 * child archived, and restoring a child under an archived parent used to succeed while
 * producing a record the tree can never reach.
 */
import { apply, initWorkspace, type Action, type SeedIssueInput } from '../lib/workspace'
import type { Actor } from '../lib/actor'

const mk = (id: string, module: string): SeedIssueInput =>
  ({
    id, client: 'OAPIL', engagement: 'OAPIL Engagement', module,
    subject: `Subject ${id}`, description: '', type: 'Defect', severity: 'Medium',
    status: 'Open', owner: 'Someone', raisedBy: 'Someone', accountable: 'OAPIL',
    raised: '2026-08-01', lastActivity: '2026-08-01', actualEnd: null, age: 1,
    daysSinceActivity: 1, nextAction: '', evidence: '', evidenceDate: '',
    verification: '', source: '', reference: '', clientImpact: '',
  }) as SeedIssueInput

const A: Actor = { id: 'a', name: 'Tester' }
const NOW = '2026-08-15T10:00:00.000Z'
const seed = initWorkspace([mk('OAPIL-1', 'Inventory'), mk('OAPIL-2', 'Inventory')], [])
const moduleId = Object.values(seed.nodes).find((n) => n.kind === 'module')!.id

const live = (s: typeof seed) => ({
  nodes: Object.values(s.nodes).filter((n) => !n.deletedAt).length,
  issues: Object.values(s.issues).filter((i) => !i.deletedAt).length,
})

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

/* 1. Cascade-archive a process area, then restore it: children must come back too. */
const archived = apply(seed, { t: 'softDelete', id: moduleId, mode: 'cascade', now: NOW } as Action, A)
check('cascade archives the branch', live(archived.state).issues === 0, `${live(seed).issues} -> ${live(archived.state).issues} issues`)

const restored = apply(archived.state, { t: 'restore', id: moduleId, now: NOW } as Action, A)
check('restore brings the branch back', live(restored.state).issues === 2, restored.message ?? restored.error ?? '')
check('restore reports what came with it', /2 record/.test(restored.message ?? ''), restored.message ?? '')

/* 2. Restoring a child while its parent is archived must be refused, not silently invisible. */
const child = apply(archived.state, { t: 'restore', id: 'OAPIL-1', now: NOW } as Action, A)
check('refuses to restore under an archived parent', Boolean(child.error), child.error ?? '(no error)')

/* 3. A record archived separately keeps its own timestamp and stays archived. */
const one = apply(seed, { t: 'softDelete', id: 'OAPIL-2', mode: 'cascade', now: '2026-08-14T09:00:00.000Z' } as Action, A)
const both = apply(one.state, { t: 'softDelete', id: moduleId, mode: 'cascade', now: NOW } as Action, A)
const back = apply(both.state, { t: 'restore', id: moduleId, now: NOW } as Action, A)
check(
  'an independently archived record is not swept back',
  Boolean(back.state.issues['OAPIL-2'].deletedAt) && !back.state.issues['OAPIL-1'].deletedAt,
  `OAPIL-1 ${back.state.issues['OAPIL-1'].deletedAt ? 'archived' : 'active'}, OAPIL-2 ${back.state.issues['OAPIL-2'].deletedAt ? 'archived' : 'active'}`,
)

/* 4. Restoring something already active is a message, not an error. */
const noop = apply(seed, { t: 'restore', id: 'OAPIL-1', now: NOW } as Action, A)
check('restoring an active record is a no-op message', !noop.error && Boolean(noop.message), noop.message ?? noop.error ?? '')

/* 5. The other archive mode moves children up a level. Each move must be audited... */
const reparented = apply(seed, { t: 'softDelete', id: moduleId, mode: 'reparent', now: NOW } as Action, A)
const moveEntries = reparented.state.audit.filter((e) => e.field === 'parent' && e.at === NOW)
check(
  'reparent-archive audits every record it moves',
  moveEntries.length === 2,
  `${moveEntries.length} move entries for 2 children`,
)
check(
  'each move entry names where the record came from',
  moveEntries.every((e) => e.from === moduleId),
  moveEntries.map((e) => `${e.rowId}: ${e.from} -> ${e.to}`).join(', '),
)
check(
  'the children were not archived, only moved',
  Object.values(reparented.state.issues).every((i) => !i.deletedAt),
)

/* ...and restoring must put them back. */
const putBack = apply(reparented.state, { t: 'restore', id: moduleId, now: NOW } as Action, A)
check(
  'restore moves them back into the record',
  Object.values(putBack.state.issues).filter((i) => i.parentId === moduleId).length === 2,
  putBack.message ?? putBack.error ?? '',
)

/* A record moved again since the archive is left alone — that was somebody's own decision. */
// Somewhere genuinely different from where the archive put it — the client tier, not the
// engagement the children were already moved to.
const clientId = Object.values(seed.nodes).find((n) => n.kind === 'client')!.id
const movedOn = apply(
  reparented.state,
  { t: 'move', id: 'OAPIL-1', newParentId: clientId, now: NOW } as Action,
  A,
)
const partial = apply(movedOn.state, { t: 'restore', id: moduleId, now: NOW } as Action, A)
check(
  'a record moved again since the archive is not dragged back',
  partial.state.issues['OAPIL-1'].parentId !== moduleId && partial.state.issues['OAPIL-2'].parentId === moduleId,
  `OAPIL-1 under ${partial.state.issues['OAPIL-1'].parentId}, OAPIL-2 under ${partial.state.issues['OAPIL-2'].parentId}`,
)

console.log('')
if (fail.length) { console.log('FAIL: ' + fail.join(', ')); process.exit(1) }
console.log('Restore: archive is no longer a one-way door, in either mode.')
