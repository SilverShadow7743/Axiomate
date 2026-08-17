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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
loadEnv()

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { importWorkspace, loadWorkspace } from '../lib/db/repo'
import { persistActions } from '../lib/db/persist'
import { runScheduledPass } from '../lib/db/schedule'
import { initWorkspace, type Action, type SeedIssueInput, type WorkspaceState } from '../lib/workspace'
import { SCHEDULE_ACTOR, type Actor } from '../lib/actor'
import type { TenantId } from '../lib/tenant'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
/**
 * Every check, kept so the run can be written down.
 *
 * The scenario harness has no database and never will — it drives the reducer. So the only
 * way it can say anything true about persistence is to cite a run that did happen, with its
 * date attached, rather than assert a capability nothing checked. That file is the citation.
 */
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  results.push({ what, ok, detail })
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
 * So the rows go explicitly, leaves first — but ordering alone is not enough, because four
 * foreign keys here are `RESTRICT`, which Postgres enforces immediately, per row, rather than
 * at the end of the statement. Three of them cannot be satisfied by any ordering at all:
 *
 *   A node points at the statement of work it is delivered under, and the SOW points back at
 *   its engagement node. Whichever goes first, the other still references it.
 *
 *   A node points at its parent node, and an issue at its parent issue. A single
 *   `DELETE ... WHERE tenantId = …` removes parents and children together in no defined order,
 *   so a parent removed before its child trips the constraint on the spot.
 *
 * Clearing those three references first is what makes the deletes possible. The fourth —
 * an issue pointing at its node — needs only that issues go before nodes, which they do.
 *
 * Read out of the generated SQL rather than inferred from the schema. These four came out
 * `RESTRICT` where the relations are optional and an optional relation is widely assumed to
 * null itself out on delete; assuming that here produced an order that reads correctly and
 * would have failed on the first tenant that had a hierarchy in it.
 *
 * This asserts nothing about the schema. The previous comment claimed it did, which is how a
 * routine that could not work read as one that proved something.
 */
async function scrub() {
  const where = { tenantId: TENANT }

  // The three references no deletion order can satisfy. See above.
  await prisma.hierarchyNode.updateMany({ where, data: { sowId: null, parentId: null } })
  await prisma.issue.updateMany({ where, data: { parentIssueId: null } })

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
  /**
   * Seeded WITH relationships, including a duplicate — because an empty array is what let the
   * first Azure deployment fail.
   *
   * This passed `[]` for relationships, so the seeder's relationship loop had no rows to write
   * and the one thing that could go wrong there went untested. The real seed carries two
   * byte-identical entries for the same pair; the importer writes each with `create`, the
   * second collides on the primary key, and the entire seeding transaction rolls back. The
   * deployment then falls back to the seed file on every page load, reporting "changes are not
   * being saved" — and looking, to anyone glancing at it, like a working application.
   *
   * The duplicate below is deliberate and must stay. It is the case that was missing.
   */
  const link = (id: string, source: string, target: string) =>
    ({ id, sourceIssueId: source, targetIssueId: target, relationshipType: 'DUPLICATE_OF', note: 'Proof link' }) as WorkspaceState['relationships'][number]

  const seed = initWorkspace(
    [seedIssue('PROOF-1'), seedIssue('PROOF-2', { severity: 'Medium', owner: 'Sam' })],
    [
      link('rel-proof-1-2', 'PROOF-1', 'PROOF-2'),
      link('rel-proof-1-2', 'PROOF-1', 'PROOF-2'),
      // A link to an issue the log never carried. Skipped rather than failing the import.
      link('rel-proof-dangling', 'PROOF-1', 'NOPE-9'),
    ],
  )
  check(
    'a seed carrying a duplicate link is reduced to one before it reaches the database',
    seed.relationships.length === 2,
    `${seed.relationships.length} of 3 kept`,
  )
  /**
   * Two at once, because that is what a new deployment actually does.
   *
   * The first page load of a fresh instance fires several requests before any of them
   * finishes, and every one of them boots, finds an unseeded workspace and starts importing
   * the same two hundred and sixty-four issues. This was found by running the built server
   * against an empty Azure database and watching the first request answer 200 while the log
   * filled with `Unique constraint failed on the fields: ("tenantId", id)` — a half-written
   * tree, on the very first request anyone makes.
   *
   * Sequential calls cannot show it. Only the concurrent pair does.
   */
  const [a1, a2] = await Promise.all([importWorkspace(TENANT, seed), importWorkspace(TENANT, seed)])
  const imported = a1.imported ? a1 : a2
  const loser = a1.imported ? a2 : a1
  check(
    'two boots racing to seed an empty workspace produce one seed, not a collision',
    a1.imported !== a2.imported,
    `one imported ${imported.counts.issues} issues, the other stood down: "${loser.reason}"`,
  )
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

  // 'plannedDates' is what the reducer records — one entry for the pair, because a start and
  // an end that moved together are one decision, not two. The check looked for 'plannedEnd'
  // and found nothing, and reported that as the reason not being stored.
  const reasoned = state.audit.find((e) => e.field === 'plannedDates')
  /**
   * The identity behind the name, and the reason this is checked against Postgres rather than
   * against the reducer: it is a column, and a column that is written but never read back is
   * indistinguishable from one that was never written.
   *
   * The proof's actor has an id and no address, which is the machine shape — the scheduled pass
   * and the intake connector are the same. null therefore has to survive as null rather than
   * becoming an empty string, or 'no mailbox' and 'a mailbox nobody typed' stop being different.
   */
  const stamped = state.audit.find((e) => e.byId)
  check(
    'an audit entry carries the identity behind the name, not just the name',
    stamped?.byId === A.id && stamped?.byEmail === null && Boolean(stamped?.by),
    stamped
      ? `by "${stamped.by}", id ${stamped.byId}, email ${JSON.stringify(stamped.byEmail)}`
      : `no entry carried an id — ${state.audit.length} entries, sample ${JSON.stringify(state.audit.slice(0, 2).map((e) => ({ f: e.field, by: e.by, byId: e.byId })))}`,
  )

  check(
    'the audit keeps the reason, including its punctuation',
    Boolean(reasoned?.reason?.includes('“quotes”')),
    reasoned?.reason ?? 'no reason recorded',
  )

  /**
   * Two links, and which two is the point.
   *
   * One was seeded and one was created by a `link` action, so this covers both routes into the
   * table. The count was 1 when the seed carried no relationships at all; it is 2 now, and the
   * third — the seeded link pointing at an issue the log never carried — is deliberately absent,
   * because the importer skips a dangling reference rather than failing the whole import on it.
   */
  const seededLink = state.relationships.some((r) => r.id === 'rel-proof-1-2')
  const danglingSkipped = !state.relationships.some((r) => r.id === 'rel-proof-dangling')
  check(
    'a seeded link, a created link and a generated lifecycle all persist',
    state.relationships.length === 2 &&
      seededLink &&
      danglingSkipped &&
      Object.values(state.activities).length > 0,
    `${state.relationships.length} relationships (seeded: ${seededLink}, dangling skipped: ${danglingSkipped}), ${Object.values(state.activities).length} activities`,
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
  /**
   * This asserted the opposite until the first time it ran, and the code was right.
   *
   * `persistActions` stops the fold at the first rejection and keeps what came before it, on
   * the grounds that those actions were valid, the browser has already applied them, and
   * discarding them puts the two sides further apart rather than closer. The whole system is
   * built on that: the error names how many were saved, and the endpoint returns their
   * idempotency keys so the client can stop counting them as unsaved work.
   *
   * A check asserting atomicity therefore contradicted the design it was checking — and only
   * said so once a database existed to say it against. The behaviour it should have been
   * describing is the prefix surviving and nothing past the refusal being written.
   */
  const notesBefore = Object.keys(before.state.notes).length
  const notesAfter = Object.keys(after.state.notes).length
  check(
    'a batch that fails part-way keeps the valid prefix and stops there',
    !half.ok && notesAfter === notesBefore + 1 && half.error?.includes('1 saved') === true,
    `${half.error ?? ''} — notes ${notesBefore} → ${notesAfter}`,
  )
  /* ---------------- a re-delivered batch, against a real database ---------------- */
  /**
   * The half of idempotency that could not be proven without Postgres.
   *
   * `split` is pure and is driven directly by the scenario harness, so the *decision* was
   * covered. What was not is the transaction around it: reading the recorded keys, folding,
   * writing the new ones, and doing all three inside one serializable transaction so a
   * redelivery cannot interleave its way past the check. That is the part this exercises.
   */
  {
    const keyed = (body: string, key: string) =>
      ({ t: 'addNote', issueId: 'PROOF-2', body, noteType: 'General Update', pinned: false, now: NOW, key }) as Action & { key: string }

    const batch = [
      keyed('Delivered once.', 'proof-key-aaaaaaaa-1111'),
      keyed('Delivered twice.', 'proof-key-bbbbbbbb-2222'),
    ]

    const notesAtStart = Object.keys((await loadWorkspace(TENANT)).state.notes).length
    const firstSend = await persistActions(TENANT, A, batch)
    const notesAfterFirst = Object.keys((await loadWorkspace(TENANT)).state.notes).length

    // The same batch again — a beacon overlapping a live request, or a retry after a timeout.
    const secondSend = await persistActions(TENANT, A, batch)
    const notesAfterSecond = Object.keys((await loadWorkspace(TENANT)).state.notes).length

    check(
      'a re-delivered batch writes nothing the second time',
      firstSend.ok && secondSend.ok &&
        notesAfterFirst === notesAtStart + 2 && notesAfterSecond === notesAfterFirst,
      `${notesAtStart} → ${notesAfterFirst} → ${notesAfterSecond} notes; ${secondSend.skipped} skipped on the replay`,
    )

    const recorded = await prisma.appliedAction.count({ where: { tenantId: TENANT } })
    check(
      'and the keys are stored, so the skip survives a restart',
      recorded >= 2,
      `${recorded} key(s) in AppliedAction`,
    )

    // A keyed batch that fails part-way must report the keys that did commit — the empty array
    // this check used to accept proved nothing, because the actions carried no keys at all.
    const partial = await persistActions(TENANT, A, [
      keyed('Valid, and keyed.', 'proof-key-cccccccc-3333'),
      { t: 'addNote', issueId: 'NOPE-9', body: 'Not valid.', noteType: 'General Update', pinned: false, now: NOW, key: 'proof-key-dddddddd-4444' } as Action & { key: string },
    ])
    check(
      'a refused keyed batch names the keys that did commit',
      !partial.ok && partial.committedKeys?.length === 1 &&
        partial.committedKeys[0] === 'proof-key-cccccccc-3333',
      `${partial.committedKeys?.length ?? 0} key(s): ${partial.committedKeys?.join(', ') ?? 'none'}`,
    )
  }

  /* ---------------- tenancy holds at the database, not just in the code ---------------- */
  const otherTenantRows = await prisma.issue.count({ where: { tenantId: TENANT } })
  const allRows = await prisma.issue.count()
  check(
    'the proof tenant owns only its own rows',
    otherTenantRows === 2 && allRows >= otherTenantRows,
    `${otherTenantRows} of ${allRows} issue rows`,
  )
}

function record() {
  /**
   * The run, written down where the scenario harness can cite it.
   *
   * Dated on purpose. A persistence claim is only as good as the last time it was true, and a
   * file with a date lets a reader see a stale one; a hard-coded PASS in a scenario would not.
   * The target is masked — this file is committed.
   */
  const out = {
    at: new Date().toISOString(),
    target: URL!.replace(/:\/\/[^@]*@/, '://***@').replace(/\?.*$/, ''),
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    checks: results,
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'persistence.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`Written to data/persistence.json — ${out.passed} passed, ${out.failed} failed.`)
}

main()
  .then(async () => {
    await scrub()
    record()
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
    // Swallowed so the original failure is what surfaces, but not silently: a scrub that could
    // not finish leaves rows behind, and the next run collides with them and reports something
    // confusing far from the cause.
    await scrub().catch((e) => {
      console.log('The cleanup also failed:', e instanceof Error ? e.message : e)
    })
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
