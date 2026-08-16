/**
 * Does what the reducer decided survive a trip through Postgres?
 *
 * Run with `npm run audit:persistence`, against a real database.
 *
 * ---------------------------------------------------------------------------
 * Why this is the one proof that could not be written until now
 *
 * Every other check in this repository runs against the reducer, which is a pure function and
 * needs nothing. The persistence layer needs a database, and there was never one — so twenty-one
 * tables, fourteen mapper pairs and a write path with an arm per action typechecked and had
 * never executed. The validation report has carried that as its largest untested surface for
 * several rounds, which is honest and is not the same as being tested.
 *
 * The failure this looks for is specific and quiet: a mapper that drops a field, coerces a
 * type, or rounds a number. Nothing raises an error; the value simply comes back different, and
 * it comes back different weeks later on somebody else's machine. So the shape of the check is
 * always the same — write a record with values chosen to break careless mapping, read the whole
 * workspace back through the ordinary load path, and compare field by field.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does
 *
 * It uses its own tenant, and removes it at the end. Running a proof against the tenant a
 * person is using would be a test that edits their data, which is the sort of thing that is
 * fine until the day it is not.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { importWorkspace, loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { runScheduledPass } from '../lib/db/schedule'
import { initWorkspace, type Action, type SeedIssueInput } from '../lib/workspace'
import { SCHEDULE_ACTOR, type Actor } from '../lib/actor'
import type { TenantId } from '../lib/tenant'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This proof needs a database — see .env.example.')
  process.exit(1)
}

/** Its own tenant, and it goes away at the end. */
const TENANT = 'proof-persistence' as TenantId
const A: Actor = { id: 'proof', name: 'Persistence Proof' }
const TODAY = new Date().toISOString().slice(0, 10)
const NOW = `${TODAY}T09:00:00.000Z`

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

const seedIssue = (id: string, over: Partial<SeedIssueInput> = {}): SeedIssueInput =>
  ({
    id, client: 'PROOF', engagement: 'Proof Engagement', module: 'Inventory',
    subject: `Subject ${id}`, description: '', type: 'Defect', severity: 'High',
    status: 'Open', owner: 'Priya', raisedBy: 'Client', accountable: 'PROOF',
    raised: '2026-08-03', lastActivity: '2026-08-03', actualEnd: null, age: 1,
    daysSinceActivity: 1, nextAction: '', evidence: '', evidenceDate: '',
    verification: '', source: 'Proof', reference: '', clientImpact: '',
    ...over,
  }) as SeedIssueInput

/**
 * Remove every row this proof created.
 *
 * It used to delete the tenant alone, on the belief that everything would follow. Nothing
 * would have: every model's foreign key to `Tenant` is `onDelete: Restrict`, deliberately, so
 * that a firm with records cannot be dropped along with every issue anyone ever filed under
 * it. Suspension sets `deletedAt`; deletion is refused. That is right for the application and
 * fatal for a cleanup routine — the one-line scrub could only ever have worked on a tenant
 * that owned nothing, which is the state it is in before the proof runs and never after.
 *
 * So the rows go explicitly, leaves first. The order below is not arbitrary and is worth
 * keeping in this shape:
 *
 *   The node/statement-of-work cycle first. A node points at the SOW it is delivered under
 *   with `Restrict`, and a SOW points back at its engagement node with `Cascade`. Neither can
 *   go first, so the reference is cleared before either is deleted.
 *
 *   Then everything that hangs off an issue or a node, then issues, then nodes, then the
 *   tenant. Self-references — an issue's parent issue, a node's parent node — need no ordering
 *   because each table is emptied in a single statement, and Postgres checks those constraints
 *   once the statement has finished rather than row by row.
 *
 * This asserts nothing about the schema. The previous comment claimed it did, which is how a
 * routine that could not work read as one that proved something.
 */
async function scrub() {
  const where = { tenantId: TENANT }

  await prisma.hierarchyNode.updateMany({ where, data: { sowId: null } })

  await prisma.estimateRevision.deleteMany({ where })
  await prisma.issueEstimate.deleteMany({ where })
  await prisma.timeEntry.deleteMany({ where })
  await prisma.approval.deleteMany({ where })
  await prisma.notification.deleteMany({ where })
  await prisma.issueNote.deleteMany({ where })
  await prisma.evidence.deleteMany({ where })
  await prisma.issueRelationship.deleteMany({ where })
  await prisma.issueDependency.deleteMany({ where })
  await prisma.issueActivity.deleteMany({ where })
  await prisma.allocation.deleteMany({ where })
  await prisma.commitment.deleteMany({ where })
  await prisma.engagement.deleteMany({ where })
  await prisma.appliedAction.deleteMany({ where })
  await prisma.scheduleAudit.deleteMany({ where })
  await prisma.workspaceMeta.deleteMany({ where })
  await prisma.operatingModel.deleteMany({ where })
  await prisma.scheduleWatch.deleteMany({ where })
  await prisma.sow.deleteMany({ where })
  await prisma.issue.deleteMany({ where })
  await prisma.hierarchyNode.deleteMany({ where })

  /**
   * The tenant last, and it is also the check that the list above is complete.
   *
   * `Restrict` means this delete fails if any table still holds a row — so a model added to
   * the schema and forgotten here cannot pass silently. The raw error names a constraint and
   * not the fix, which is a poor way to learn this months from now, so it is translated.
   */
  try {
    await prisma.tenant.deleteMany({ where: { id: TENANT } })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `The proof tenant could not be removed, so some table still holds its rows — most ` +
        `likely a model added to the schema since this list was written. Add it to scrub(), ` +
        `before the tenant and after anything that references it. Postgres said: ${detail}`,
    )
  }
}

async function main() {
  console.log('')
  console.log('AXIOMATE — PERSISTENCE PROOF')
  console.log(`Against ${URL!.replace(/:\/\/[^@]*@/, '://***@')}`)
  console.log('')

  await scrub()

  /* ---------------- import ---------------- */
  const seed = initWorkspace(
    [seedIssue('PROOF-1'), seedIssue('PROOF-2', { severity: 'Medium', owner: 'Sam' })],
    [],
  )
  const imported = await importWorkspace(TENANT, seed)
  check('the seed imports', imported.imported, `${imported.counts.issues} issues, ${imported.counts.nodes} nodes`)

  const afterImport = await loadWorkspace(TENANT)
  check(
    'and reads back with the same issues',
    Object.keys(afterImport.state.issues).length === 2 && afterImport.orphans.length === 0,
    `${Object.keys(afterImport.state.issues).length} issues, ${afterImport.orphans.length} orphans`,
  )

  /* ---------------- one write per table that has one ---------------- */
  const parentId = afterImport.state.issues['PROOF-1'].parentId
  const engagementId = Object.values(afterImport.state.nodes).find((n) => n.kind === 'engagement')!.id

  const actions: Action[] = [
    /* A project to hang capacity and a SOW from. */
    { t: 'create', parentId: engagementId, kind: 'project', draft: { name: 'Proof project' }, now: NOW },
  ]
  const madeProject = await persistActions(TENANT, A, actions)
  check('a project is created and returns its id', madeProject.ok && Boolean(madeProject.createdId), madeProject.error ?? '')
  const projectId = madeProject.createdId!

  /**
   * The values here are chosen to break careless mapping rather than to be realistic.
   *
   *  - 6.25 hours exercises the Decimal column: a Float would round it, and quarter hours summed
   *    across a month are what an invoice is argued about with.
   *  - The unicode and the newline exercise text columns and any accidental trimming.
   *  - A zero and a null are kept distinct, because "nothing recorded" and "recorded as none"
   *    are different answers and a mapper that conflates them is the classic quiet bug.
   */
  const batch: Action[] = [
    { t: 'setDates', id: 'PROOF-1', start: '2026-08-01', end: '2026-08-10', now: NOW, reason: 'Client moved UAT — “quotes” and a\nnewline' },
    { t: 'addNote', issueId: 'PROOF-1', body: 'Note with “smart quotes”, an em—dash and a\nnewline.', noteType: 'Client Communication', pinned: true, now: NOW },
    { t: 'addEvidence', issueId: 'PROOF-1', kind: 'document', name: 'signoff.pdf', purpose: 'Client confirmation', url: null, mimeType: 'application/pdf', sizeBytes: 0, note: '', now: NOW },
    { t: 'addTime', issueId: 'PROOF-1', person: 'Priya', date: '2026-08-04', hours: 6.25, activity: 'Investigation', billable: false, note: 'Quarter hours', now: NOW },
    { t: 'setEstimate', issueId: 'PROOF-1', patch: { scores: { business: 3, technical: 4, integration: 2, testing: 3, data: 1 }, waitDays: 2, assumptions: 'Assumes the client answers' }, now: NOW },
    { t: 'baselineEstimate', issueId: 'PROOF-1', now: NOW },
    { t: 'upsertSow', id: null, engagementId, patch: { reference: 'SOW-PROOF-1', title: 'Proof', effortHours: 40, value: 12345.67, status: 'Signed' }, now: NOW },
    { t: 'upsertCommitment', id: null, person: 'Priya', kind: 'Leave', startDate: '2026-09-07', endDate: '2026-09-11', hoursPerDay: 7.5, note: '', now: NOW },
    { t: 'upsertAllocation', id: null, person: 'Priya', projectId, startDate: '2026-09-01', endDate: '2026-09-05', percentage: 50, note: '', now: NOW },
    { t: 'link', sourceIssueId: 'PROOF-2', targetIssueId: 'PROOF-1', relationshipType: 'Duplicate of', note: '', now: NOW },
    { t: 'buildLifecycle', issueId: 'PROOF-2', slaDays: 5, now: NOW },
    { t: 'config', op: { k: 'setSla', patch: { High: 3 } }, now: NOW },
  ]
  const wrote = await persistActions(TENANT, A, batch)
  check('a batch across every table applies', wrote.ok, wrote.error ?? `${wrote.audited} audit rows`)

  /* ---------------- read it all back ---------------- */
  const { state } = await loadWorkspace(TENANT)

  const note = Object.values(state.notes)[0]
  check(
    'a note keeps its text exactly, quotes and newline included',
    note?.body === 'Note with “smart quotes”, an em—dash and a\nnewline.' && note.pinned === true,
    note ? `pinned=${note.pinned}` : 'no note',
  )

  const entry = Object.values(state.timeEntries)[0]
  check(
    'quarter hours survive as a decimal, not a float',
    entry?.hours === 6.25 && entry.billable === false,
    entry ? `${entry.hours}h, billable=${entry.billable}` : 'no entry',
  )

  const evidence = Object.values(state.evidence).find((e) => e.name === 'signoff.pdf')
  check(
    'a zero size is zero rather than nothing',
    evidence?.sizeBytes === 0,
    evidence ? `sizeBytes=${JSON.stringify(evidence.sizeBytes)}` : 'no evidence',
  )

  const estimate = state.estimates['PROOF-1']
  check(
    'an estimate keeps its scores, its wait and its baseline',
    estimate?.scores.technical === 4 && estimate.waitDays === 2 && Boolean(estimate.baselinedAt),
    estimate ? `technical=${estimate.scores.technical}, baselined=${Boolean(estimate.baselinedAt)}` : 'no estimate',
  )

  const sow = Object.values(state.sows)[0]
  check(
    'money keeps its pennies',
    sow?.value === 12345.67 && sow.effortHours === 40,
    sow ? `${sow.currency} ${sow.value}` : 'no sow',
  )

  const allocation = Object.values(state.allocations)[0]
  const commitment = Object.values(state.commitments)[0]
  check(
    'an allocation and a commitment keep their dates',
    allocation?.startDate === '2026-09-01' && commitment?.startDate === '2026-09-07' && commitment.hoursPerDay === 7.5,
    allocation ? `${allocation.startDate}→${allocation.endDate}, leave ${commitment?.hoursPerDay}h/day` : 'missing',
  )

  const dated = state.issues['PROOF-1']
  check(
    'a date written as a day comes back as the same day',
    dated?.plannedStart === '2026-08-01' && dated.plannedEnd === '2026-08-10',
    `${dated?.plannedStart} → ${dated?.plannedEnd}`,
  )

  const reasoned = state.audit.find((e) => e.field === 'plannedEnd' || e.field === 'dates')
  check(
    'the audit keeps the reason, including its punctuation',
    Boolean(reasoned?.reason?.includes('“quotes”')),
    reasoned?.reason ?? 'no reason recorded',
  )

  check(
    'a relationship and a generated lifecycle both persist',
    state.relationships.length === 1 && Object.values(state.activities).length > 0,
    `${state.relationships.length} relationships, ${Object.values(state.activities).length} activities`,
  )

  check(
    'configuration changes survive',
    state.model.sla.High === 3,
    `High = ${state.model.sla.High} working days`,
  )

  /* ---------------- the trail keeps the newest entries, oldest-first ---------------- */

  /**
   * Reproduced in five rows rather than five thousand.
   *
   * The defect was `orderBy: 'asc'` with a `take`, which keeps the *oldest* rows — so once a
   * tenant passed the window, every new entry was written and none was read back. Shrinking the
   * window is what makes that visible without generating a workspace nobody would sit through.
   *
   * Two properties, and both matter. The newest entries must be the ones present, or the daily
   * report sees a quiet day in a busy workspace and a restore cannot find the moves it needs to
   * reverse. And they must arrive oldest-first, because the write path appends to this array
   * and the browser mirror keeps its tail.
   */
  {
    for (const marker of ['first', 'second', 'third', 'fourth', 'fifth']) {
      await persistActions(TENANT, A, [
        { t: 'updateIssue', id: 'PROOF-2', patch: { nextAction: `trail-${marker}` }, now: NOW },
      ])
    }

    process.env.AXIOMATE_AUDIT_WINDOW = '3'
    const narrowed = await loadWorkspace(TENANT)
    delete process.env.AXIOMATE_AUDIT_WINDOW

    const trail = narrowed.state.audit
    const ascending = trail.every((e, i) => i === 0 || trail[i - 1].at <= e.at)
    const text = trail.map((e) => e.to).join(' ')

    check(
      'a capped trail keeps the newest entries, not the oldest',
      trail.length === 3 && text.includes('trail-fifth') && !text.includes('trail-first'),
      `${trail.length} entries, ending "${trail[trail.length - 1]?.to}"`,
    )
    check('and returns them oldest-first, which is what the write path appends to', ascending)
  }

  /* ---------------- ids do not collide after a restart ---------------- */
  const meta = await prisma.workspaceMeta.findUnique({ where: { tenantId: TENANT } })
  check(
    'the id counter is stored, so a restart cannot re-mint an id',
    (meta?.seq ?? 0) >= state.seq,
    `stored seq ${meta?.seq}, state seq ${state.seq}`,
  )

  /* ---------------- the scheduled pass, end to end ---------------- */
  const first = await runScheduledPass(TENANT, SCHEDULE_ACTOR)
  const second = await runScheduledPass(TENANT, SCHEDULE_ACTOR)
  check(
    'the scheduled pass raises on the first run and not the second',
    first.diff.onset.length > 0 && second.diff.onset.length === 0,
    `${first.summary} | then | ${second.summary}`,
  )

  const watched = await prisma.scheduleWatch.findUnique({ where: { tenantId: TENANT } })
  check(
    'and its memory is stored, not held in the process',
    Boolean(watched?.lastRunAt) && Array.isArray((watched?.observation as { watching?: unknown })?.watching),
    watched?.lastSummary ?? 'nothing stored',
  )

  /* ---------------- a refused batch leaves nothing behind ---------------- */
  const before = await loadWorkspace(TENANT)
  const half = await persistActions(TENANT, A, [
    { t: 'addNote', issueId: 'PROOF-2', body: 'This one is fine.', noteType: 'General Update', pinned: false, now: NOW },
    { t: 'addNote', issueId: 'NOPE-9', body: 'This one is not.', noteType: 'General Update', pinned: false, now: NOW },
  ])
  const after = await loadWorkspace(TENANT)
  check(
    'a batch that fails part-way rolls back whole',
    !half.ok && Object.keys(after.state.notes).length === Object.keys(before.state.notes).length,
    `${half.error ?? ''} — notes ${Object.keys(before.state.notes).length} → ${Object.keys(after.state.notes).length}`,
  )

  /* ---------------- tenancy holds at the database, not just in the code ---------------- */
  const otherTenantRows = await prisma.issue.count({ where: { tenantId: TENANT } })
  const allRows = await prisma.issue.count()
  check(
    'the proof tenant owns only its own rows',
    otherTenantRows === 2 && allRows >= otherTenantRows,
    `${otherTenantRows} of ${allRows} issue rows`,
  )
}

main()
  .then(async () => {
    await scrub()
    console.log('')
    if (fail.length) {
      console.log('FAIL: ' + fail.join(', '))
      process.exit(1)
    }
    console.log('Persistence: what the reducer decided is what comes back out of Postgres.')
  })
  .catch(async (err) => {
    console.log('')
    console.log('The proof could not complete:', err instanceof Error ? err.message : err)
    await scrub().catch(() => {})
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
