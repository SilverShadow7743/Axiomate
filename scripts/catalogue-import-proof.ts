/**
 * `lib/commercial/catalogueImport.ts` is pure logic with no I/O and no Prisma import — this proof runs it
 * against fixture rows in memory, no DB, the same shape as `scripts/attribution-proof.ts` /
 * `scripts/estimation-proof.ts`.
 *
 * Run with `npx tsx scripts/catalogue-import-proof.ts` (plan ART-20260914-004, step 2).
 *
 * Four things are worth a script rather than a comment, each tied to an acceptance criterion
 * from ART-20260914-001:
 *
 *   - AC4: id parsing and level classification — including that a row recognised as a real
 *     catalogue level with no home in this product (e2e / system-process / test-case) is a
 *     *different*, honest reason from a row whose level text matches nothing at all
 *     ('unmapped'), which is again different from a row whose level is recognised and
 *     importable but whose own id does not parse. Three distinct outcomes; nothing guessed in
 *     any of them.
 *   - AC3: parent-before-child ordering, with a child whose implied process-area parent is not
 *     present anywhere in the workbook skipped and the reason stated — never given an invented
 *     parent.
 *   - AC5: a Deprecated row carrying an Alternate Process Sequence id is still created (not
 *     dropped), with its own id, status and alternateId recorded verbatim — never rewritten to
 *     point at the alternate.
 *   - AC4 (malformed id / unmapped level are skipped, never guessed) is re-checked end to end
 *     through `orderForImport`, not just `classifyWorkbookRow`, so a regression in how the two
 *     compose would also fail this.
 */
import {
  classifyWorkbookRow,
  orderForImport,
  parseCatalogueId,
  type WorkbookRow,
} from '../lib/commercial/catalogueImport'

const fail: string[] = []
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(what)
}

/** A `WorkbookRow` with every field defaulted to absent, so each fixture states only what it needs. */
function row(partial: Partial<WorkbookRow> & { id: string | null }): WorkbookRow {
  return {
    name: null,
    levelText: null,
    status: null,
    alternateId: null,
    relatedProcessId: null,
    ...partial,
  }
}

/* ------------------------------------------------------------------ *
 * 1. AC4 — id parsing, in isolation
 * ------------------------------------------------------------------ */

check('a well-formed four-segment id parses', parseCatalogueId('60.10.100.000') !== null)
check(
  'the parsed segments are exactly the four dot-separated groups',
  JSON.stringify(parseCatalogueId('60.10.100.010')?.segments) === JSON.stringify(['60', '10', '100', '010']),
)
check('a missing segment does not parse', parseCatalogueId('60.10.100') === null)
check('an extra segment does not parse', parseCatalogueId('60.10.100.000.1') === null)
check('a non-numeric segment does not parse', parseCatalogueId('60.10.AAA.000') === null)
check('the pre-2024 unpadded shape does not parse', parseCatalogueId('60.10.1.0') === null)
check('blank/absent parses to null, not a guess', parseCatalogueId('') === null && parseCatalogueId(null) === null)

/* ------------------------------------------------------------------ *
 * 2. AC4 — classification: three distinct outcomes, never collapsed
 * ------------------------------------------------------------------ */

const unmappedNoText = classifyWorkbookRow(row({ id: '60.10.000.000', levelText: null }))
check('a row with no level/type text at all is unmapped', unmappedNoText.level === 'unmapped' && !unmappedNoText.proposed)
check(
  'and its reason says there was nothing to classify, not a guess',
  /no level\/type value/i.test(unmappedNoText.reason ?? ''),
)

const unmappedGarbage = classifyWorkbookRow(row({ id: '60.10.000.000', levelText: 'Interpretive Dance' }))
check('a row whose level/type text matches none of the seven names is unmapped', unmappedGarbage.level === 'unmapped' && !unmappedGarbage.proposed)
check(
  'and the reason names what it failed to match, not what it guessed',
  /does not match any/i.test(unmappedGarbage.reason ?? ''),
)

const e2e = classifyWorkbookRow(row({ id: '60.00.000.000', levelText: 'End-to-end process' }))
const sysProcess = classifyWorkbookRow(row({ id: '60.10.100.020', levelText: 'System Process' }))
const testCase = classifyWorkbookRow(row({ id: '60.10.100.030', levelText: 'Test Case' }))
check('e2e is recognised, not unmapped', e2e.level === 'e2e' && !e2e.proposed)
check('system-process is recognised, not unmapped', sysProcess.level === 'system-process' && !sysProcess.proposed)
check('test-case is recognised, not unmapped', testCase.level === 'test-case' && !testCase.proposed)
for (const [what, c] of [
  ['e2e', e2e],
  ['system-process', sysProcess],
  ['test-case', testCase],
] as const) {
  check(`${what}'s skip reason says "no home", not "does not match"`, /no home in this product/i.test(c.reason ?? ''))
}
check(
  'recognised-but-out-of-scope and unmapped give textually distinct reasons',
  e2e.reason !== unmappedGarbage.reason && sysProcess.reason !== unmappedNoText.reason,
)

const malformedId = classifyWorkbookRow(row({ id: 'not-a-catalogue-id', levelText: 'Business process' }))
check('a recognised, importable level with an unparseable id is still classified (not unmapped)', malformedId.level === 'process' && !malformedId.proposed)
check('and its reason is about the id, not the level', /does not parse/i.test(malformedId.reason ?? ''))
check(
  'an unmapped level and an unparseable id are distinguishable outcomes',
  unmappedGarbage.level !== malformedId.level && unmappedGarbage.reason !== malformedId.reason,
)

const noIdAtAll = classifyWorkbookRow(row({ id: null, levelText: 'Scenario' }))
check('a recognised level with no id at all is skipped, not guessed', !noIdAtAll.proposed && /no hierarchical id/i.test(noIdAtAll.reason ?? ''))

const cdNoRelated = classifyWorkbookRow(row({ id: 'CD-100', levelText: 'Configuration deliverable', relatedProcessId: null }))
check(
  'a configuration-deliverable row with no related-process reference is skipped, not guessed',
  !cdNoRelated.proposed && /no related-process reference/i.test(cdNoRelated.reason ?? ''),
)
const cdBadRelated = classifyWorkbookRow(
  row({ id: 'CD-101', levelText: 'Configuration deliverable', relatedProcessId: 'garbage' }),
)
check(
  'a configuration-deliverable row whose related-process id does not parse is skipped, not guessed',
  !cdBadRelated.proposed && /related-process id "garbage" does not parse/i.test(cdBadRelated.reason ?? ''),
)
const cdOk = classifyWorkbookRow(row({ id: 'CD-102', levelText: 'Configuration deliverable', relatedProcessId: '60.20.100.000' }))
check('a configuration-deliverable row with a parseable related-process id is proposed', cdOk.proposed && cdOk.level === 'configuration-deliverable')

/* ------------------------------------------------------------------ *
 * 3. AC3 — parent-before-child ordering; a missing parent is skipped, not invented
 * ------------------------------------------------------------------ */

const areaA = row({ id: '60.10.000.000', name: 'Area A', levelText: 'Business process area' })
const areaB = row({ id: '60.20.000.000', name: 'Area B', levelText: 'Process area' })
const processUnderA = row({ id: '60.10.100.000', name: 'Process under A', levelText: 'Business process' })
const scenarioUnderA = row({ id: '60.10.100.010', name: 'Scenario under A', levelText: 'Scenario' })
const cdUnderB = row({
  id: 'CD-200',
  name: 'Config deliverable under B',
  levelText: 'Configuration deliverable',
  relatedProcessId: '60.20.100.000',
})
/** L3 whose implied L2 parent (60.99.000.000) is nowhere in this workbook. */
const orphanProcess = row({ id: '60.99.100.000', name: 'Orphan process', levelText: 'Process' })

const orderFixture = [areaA, areaB, processUnderA, scenarioUnderA, cdUnderB, orphanProcess]
const orderResult = orderForImport(orderFixture)

check('both process-area rows are ordered (not skipped)', orderResult.ordered.some((o) => o.id === '60.10.000.000') && orderResult.ordered.some((o) => o.id === '60.20.000.000'))
check('the process and scenario under Area A are ordered', orderResult.ordered.some((o) => o.id === '60.10.100.000') && orderResult.ordered.some((o) => o.id === '60.10.100.010'))
check('the configuration deliverable under Area B is ordered', orderResult.ordered.some((o) => o.id === 'CD-200'))

const idxOf = (id: string) => orderResult.ordered.findIndex((o) => o.id === id)
check('Area A precedes the process it implies-parents', idxOf('60.10.000.000') < idxOf('60.10.100.000'))
check('Area A precedes the scenario it implies-parents', idxOf('60.10.000.000') < idxOf('60.10.100.010'))
check("Area B precedes the configuration deliverable related to Area B's process", idxOf('60.20.000.000') < idxOf('CD-200'))
check(
  'every process-area in the order precedes every non-process-area row',
  (() => {
    const lastAreaIdx = Math.max(...orderResult.ordered.map((o, i) => (o.level === 'process-area' ? i : -1)))
    const firstChildIdx = Math.min(
      ...orderResult.ordered.map((o, i) => (o.level !== 'process-area' ? i : Number.POSITIVE_INFINITY)),
    )
    return lastAreaIdx < firstChildIdx
  })(),
)

const orphanSkip = orderResult.skipped.find((s) => s.row.id === '60.99.100.000')
check('the orphan process (missing implied parent) is skipped, not ordered', !!orphanSkip && !orderResult.ordered.some((o) => o.id === '60.99.100.000'))
check(
  "the orphan's skip reason names the missing parent and says it was not present in the workbook — never invented",
  /Implied process-area parent "60\.99\.000\.000" is not present anywhere in this workbook/.test(orphanSkip?.reason ?? ''),
)

/* ------------------------------------------------------------------ *
 * 4. AC5 — a Deprecated row's status and alternate id are carried verbatim
 * ------------------------------------------------------------------ */

const deprecatedProcess = row({
  id: '60.10.101.000',
  name: 'Deprecated process under A',
  levelText: 'Process',
  status: 'Deprecated',
  // Deliberately in an area (60.77) not present in this fixture at all: if anything ever
  // derived this row's parent — or its own id — from `alternateId` instead of `id`, that
  // mistake would surface as a wrongly-skipped/missing-parent row, not a silently-passing one.
  alternateId: '60.77.999.000',
})
const deprecatedFixture = [areaA, deprecatedProcess]
const deprecatedResult = orderForImport(deprecatedFixture)

check('the deprecated row is still created, never dropped from the import (AC5)', deprecatedResult.ordered.some((o) => o.id === '60.10.101.000'))
check('and it is not silently skipped alongside it', !deprecatedResult.skipped.some((s) => s.row.id === '60.10.101.000'))

const deprecatedOrdered = deprecatedResult.ordered.find((o) => o.id === '60.10.101.000')
check(
  "the deprecated row's own id is recorded verbatim — never rewritten to the alternate id",
  deprecatedOrdered?.id === '60.10.101.000' && deprecatedOrdered?.id !== deprecatedProcess.alternateId,
)
check(
  "the row's status survives untouched, for the import script to persist verbatim",
  deprecatedOrdered?.row.status === 'Deprecated',
)
check(
  "the row's alternate id survives untouched, for the import script to persist verbatim",
  deprecatedOrdered?.row.alternateId === '60.77.999.000',
)

/* A Deleted row gets the same treatment — AC5 names both statuses. */
const deletedScenario = row({
  id: '60.10.101.010',
  name: 'Deleted scenario under A',
  levelText: 'Scenario',
  status: 'Deleted',
  alternateId: null,
})
const deletedResult = orderForImport([areaA, deletedScenario])
check('a Deleted row is also created, not dropped', deletedResult.ordered.some((o) => o.id === '60.10.101.010'))
check(
  "a Deleted row with no alternate id keeps that absence verbatim, not a guessed value",
  deletedResult.ordered.find((o) => o.id === '60.10.101.010')?.row.alternateId === null,
)

/* ------------------------------------------------------------------ *
 * 5. AC4 end to end — a malformed id and an unmapped level are skipped by
 *    orderForImport too, not only by classifyWorkbookRow in isolation
 * ------------------------------------------------------------------ */

const malformedIdRow = row({ id: 'garbage-id', name: 'Bad id', levelText: 'Business process' })
const unmappedLevelRow = row({ id: '60.10.100.040', name: 'Bad level', levelText: 'Interpretive Dance' })
const endToEnd = orderForImport([areaA, malformedIdRow, unmappedLevelRow])

check('a malformed id is skipped by the full pipeline, never guessed into an id', !endToEnd.ordered.some((o) => o.row === malformedIdRow))
check('an unmapped level is skipped by the full pipeline, never guessed into a level', !endToEnd.ordered.some((o) => o.row === unmappedLevelRow))
const malformedSkip = endToEnd.skipped.find((s) => s.row === malformedIdRow)
const unmappedSkip = endToEnd.skipped.find((s) => s.row === unmappedLevelRow)
check('the malformed-id skip carries a stated reason, not a blank one', !!malformedSkip?.reason && malformedSkip.reason.length > 0)
check('the unmapped-level skip carries a stated reason, not a blank one', !!unmappedSkip?.reason && unmappedSkip.reason.length > 0)
check('the two skip reasons remain textually distinct end to end, same as in isolation', malformedSkip?.reason !== unmappedSkip?.reason)

console.log('')
if (fail.length) {
  console.log('FAIL: ' + fail.join(', '))
  process.exit(1)
}
console.log(
  'Catalogue import: id parsing/classification distinguish unmapped, out-of-scope and unparseable (AC4); ' +
    'ordering is parent-before-child with an unreferenced parent skipped and named (AC3); ' +
    'a Deprecated/Deleted row is created with its status and alternate id carried verbatim, never rewritten (AC5).',
)
