/**
 * Import the Microsoft D365 Business Process Catalogue workbook into this tenant's
 * `CatalogueEntry` table (ADR 0006 / ART-20260914-003, Alt B — direct tenant-scoped Prisma,
 * outside `WorkspaceState`). Mirrors `add-project-tier.ts` and the WBS import
 * (`extract-wbs.ts` / `transform-wbs.mjs`) in shape: read the source, classify and order it
 * with pure functions from `lib/commercial/catalogueImport.ts`, print a plan, write nothing until
 * `--apply` is passed and reviewed.
 *
 *   npx tsx scripts/import-d365-catalogue.ts "<path-to-workbook.xlsx>"              # dry run (default)
 *   npx tsx scripts/import-d365-catalogue.ts "<path-to-workbook.xlsx>" --sheet="Catalog"
 *   npx tsx scripts/import-d365-catalogue.ts "<path-to-workbook.xlsx>" --apply
 *
 * ---------------------------------------------------------------------------
 * What step 4 built (dry-run path, AC1)
 *
 * Reads the workbook with `exceljs` — the `extract-wbs.ts` precedent — turns each row into a
 * `WorkbookRow`, hands the rows to step 1's `orderForImport` (parse, classify, parent-before-child
 * order, honest skip reasons), queries this tenant's existing `CatalogueEntry` ids
 * (`prisma.catalogueEntry.findMany({ where: { tenantId } })`, run inside `runAsTenant` — see that
 * function's doc comment) to tell "would create" apart from "ALREADY PRESENT", and prints the
 * plan. Writes nothing.
 *
 * ---------------------------------------------------------------------------
 * What step 5 adds (the `--apply` write path)
 *
 * Tenant-scoped Prisma creates against `AXIOMATE_TENANT`, each wrapped in `runAsTenant` now that
 * `CatalogueEntry` carries row-level security (see that function's doc comment) — no `Action` arm,
 * no `persistActions`, no `lib/access.ts` entry (BR8; ART-20260914-003 v2 Alt B). Three choices
 * this step makes that the plan states as constraints but leaves to the script to work out in code:
 *
 *   - **Create-only, never upsert.** BR6 calls `workbookVersion` "updated in place on re-import" —
 *     but that is the diff-and-reconcile capability the design doc explicitly defers (scope_out:
 *     "No live sync... or diffing against a previous run"), not this step. AC6 governs what this
 *     step actually does: an id already present is skipped and reported, never duplicated *or
 *     overwritten*. So a present id is left completely untouched here — an `upsert` would still
 *     report "0 created" on a second run while silently bumping `updatedAt`/`workbookVersion` on
 *     every existing row, which is exactly the silent corruption AC6 rules out.
 *   - **One `create` per row, not `createMany`.** AC6 requires each already-present id to be
 *     *named*, not folded into a count — `createMany` can't give that back. A `create` that hits
 *     `P2002` (the id was inserted by a concurrent run between this run's `findMany` and this
 *     row's write) is caught and reported as ALREADY PRESENT rather than crashing the run.
 *   - **Two fields this step must derive that step 1 deliberately left uninterpreted:**
 *     `CatalogueEntry.status` (`live | deprecated | deleted`) from `WorkbookRow.status`'s free
 *     text (`normalizeStatus` below — blank/absent is `live`; unrecognised text is never guessed,
 *     it is skipped and reported, the same "refuse rather than invent" posture as an unparseable
 *     id), and `CatalogueEntry.name`, which the schema requires and a row can carry blank — also
 *     skipped and reported, never written as `''`. Both checks run for the dry run too (not just
 *     `--apply`), so "WOULD CREATE" never promises a row `--apply` would then refuse.
 *   - **`workbookVersion` — an assumption, not a confirmed fact (CLAUDE.md principle 1).** Neither
 *     the design doc nor the ADR names where in the workbook a version/release lives (no column
 *     candidate for it, unlike every other field) — Part 2/3 only establish that it is an
 *     attribute, not part of the key (BR6). Read as an optional `--workbook-version=<value>` CLI
 *     argument the operator supplies by hand; `null` when omitted, never inferred from the
 *     filename or guessed from workbook content.
 *
 * ---------------------------------------------------------------------------
 * Column headers — an assumption, not a confirmed fact (CLAUDE.md principle 1)
 *
 * No real export of the catalogue workbook was available while writing this script — the design
 * doc and ADR 0006 describe the catalogue's *fields* (Process Sequence ID, Level, Status,
 * Alternate Process Sequence ID, the configuration-deliverable's related-process reference) but
 * neither names the workbook's literal column headers. `HEADER_CANDIDATES` below lists the
 * spellings judged most likely from Microsoft's own vocabulary (Microsoft Learn, fetched
 * 2026-09-16 — see `lib/commercial/catalogueImport.ts`'s module doc), matched case-insensitively and
 * exactly, never by substring. If a real workbook uses different headers, this script refuses
 * with a clear "column not found" error rather than silently reading the wrong column or
 * guessing — never invent (CLAUDE.md principle 2). Add the real spelling to the relevant
 * `HEADER_CANDIDATES` entry once a workbook has been read once, the same correction
 * `extract-wbs.ts`'s own header row took after its first real file.
 */
import { config as loadEnv } from 'dotenv'
loadEnv()

import ExcelJS from 'exceljs'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  orderForImport,
  IMPORTABLE_LEVELS,
  type CatalogueLevel,
  type WorkbookRow,
  type OrderedImportRow,
  type SkippedImportRow,
} from '../lib/commercial/catalogueImport'
import type { TenantId } from '../lib/tenant'
import type { Actor } from '../lib/actor'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const WORKBOOK_PATH = args.find((a) => !a.startsWith('--'))
const SHEET_ARG = args.find((a) => a.startsWith('--sheet='))
const SHEET_NAME = SHEET_ARG ? SHEET_ARG.slice('--sheet='.length) : undefined
/** Optional — see the module doc's "workbookVersion" note. Never inferred when omitted. */
const VERSION_ARG = args.find((a) => a.startsWith('--workbook-version='))
const WORKBOOK_VERSION = VERSION_ARG ? VERSION_ARG.slice('--workbook-version='.length) : null

const TENANT = (process.env.AXIOMATE_TENANT ?? 'axiocloud') as TenantId
/** Attribution is print-only (BR7) — `CatalogueEntry` has no `createdBy` column to write it to. */
const ACTOR: Actor = { id: 'import-d365-catalogue', name: process.env.AXIOMATE_OPERATOR ?? 'Operator' }

if (!WORKBOOK_PATH) {
  console.log('Usage: npx tsx scripts/import-d365-catalogue.ts "<path-to-workbook.xlsx>" [--sheet=<name>] [--apply]')
  process.exit(1)
}

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('DATABASE_URL is not set. This script reads this tenant\'s existing catalogue rows and needs a database.')
  process.exit(1)
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL }) })

/**
 * `CatalogueEntry` carries row-level security as of `prisma/migrations/20260916075746_add_catalogue_entry`
 * (`FORCE ROW LEVEL SECURITY` + a `tenant_isolation` policy — fixed alongside this wrapping; see
 * that migration and ART-20260916-002). Every `prisma.catalogueEntry.*` call below must therefore
 * run inside a transaction that sets `app.tenant_id` first, the same discipline `lib/db/client.ts`'s
 * real `withTenant` applies to every RLS-covered table — otherwise a `FOR ALL` policy with no
 * separate `WITH CHECK` applies its `USING` clause to reads AND writes alike: a `findMany` on a
 * connection with no `app.tenant_id` set returns zero rows silently (not an error), and a `create`
 * is rejected outright.
 *
 * `withTenant` itself is not imported here because it begins `import 'server-only'`, which throws
 * under a bare `tsx` run — this script's own usage line (and step 5's fixed verify_command) runs it
 * with no extra flags. `scripts/catalogue-tenant-fk-proof.ts` hits the identical constraint and
 * reimplements the same three lines locally; this is that same precedent, not a new pattern.
 */
async function runAsTenant<T>(tenantId: TenantId, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

/* ------------------------------------------------------------------ *
 * Workbook reading — no interpretation here, just cells into WorkbookRow (extract-wbs.ts split)
 * ------------------------------------------------------------------ */

type RowField = 'id' | 'name' | 'levelText' | 'status' | 'alternateId' | 'relatedProcessId'

/** Candidate header spellings per field — see the module doc's "Column headers" note. */
const HEADER_CANDIDATES: Record<RowField, string[]> = {
  id: ['process sequence id', 'process sequence  id', 'hierarchical id', 'catalog id', 'catalogue id', 'id'],
  name: ['name', 'process name', 'title'],
  levelText: ['level', 'type', 'work item type', 'catalog level', 'catalogue level'],
  status: ['status', 'catalog status', 'catalogue status'],
  alternateId: [
    'alternate process sequence id',
    'alternate process sequence  id',
    'alternate id',
    'alternate process sequence',
  ],
  relatedProcessId: [
    'related process id',
    'related process',
    'primary process id',
    'primary process',
    'mapped process id',
    'mapped process',
  ],
}
/** Field lookups this script refuses to run without — see `findHeaderRow`. */
const REQUIRED_FIELDS: RowField[] = ['id', 'name', 'levelText']
/** How far down the sheet to search for the header row before giving up. */
const HEADER_SCAN_ROWS = 20
/** How many rows below a candidate header row to scan before moving to the next candidate. */
const DATA_PROBE_ROWS = 5000

function normalizeHeader(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

function matchColumns(headerRow: ExcelJS.Row): Partial<Record<RowField, number>> {
  const found: Partial<Record<RowField, number>> = {}
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = normalizeHeader(cell.value)
    if (!text) return
    for (const field of Object.keys(HEADER_CANDIDATES) as RowField[]) {
      if (found[field] !== undefined) continue
      if (HEADER_CANDIDATES[field].includes(text)) found[field] = colNumber
    }
  })
  return found
}

/**
 * Scan the first `HEADER_SCAN_ROWS` rows for the one carrying all of `REQUIRED_FIELDS`. Some
 * catalogue exports carry a title row (and sometimes a blank row) above the real header, so this
 * does not assume a fixed row number the way `extract-wbs.ts` could for its one known file.
 * Refuses — never guesses a row — if none of the scanned rows carries every required column.
 */
function findHeaderRow(ws: ExcelJS.Worksheet): { rowNumber: number; columns: Partial<Record<RowField, number>> } {
  for (let r = 1; r <= HEADER_SCAN_ROWS; r++) {
    const row = ws.getRow(r)
    if (row.cellCount === 0) continue
    const columns = matchColumns(row)
    if (REQUIRED_FIELDS.every((f) => columns[f] !== undefined)) {
      return { rowNumber: r, columns }
    }
  }
  const missing = REQUIRED_FIELDS.join(', ')
  throw new Error(
    `Could not find a header row carrying all of [${missing}] in the first ${HEADER_SCAN_ROWS} rows of ` +
      `worksheet "${ws.name}". Recognised header spellings are listed in HEADER_CANDIDATES in this script — ` +
      `add the real spelling rather than guessing which column is which.`,
  )
}

function cellText(row: ExcelJS.Row, col: number | undefined): string | null {
  if (col === undefined) return null
  const v = row.getCell(col).value as unknown
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v !== null && 'text' in (v as Record<string, unknown>)) {
    // ExcelJS rich-text cell.
    return String((v as { text: unknown }).text ?? '').trim() || null
  }
  if (typeof v === 'object' && v !== null && 'result' in (v as Record<string, unknown>)) {
    // ExcelJS formula cell — the computed value, not the formula.
    return String((v as { result: unknown }).result ?? '').trim() || null
  }
  const s = String(v).trim()
  return s || null
}

async function readWorkbookRows(path: string, sheetName: string | undefined): Promise<WorkbookRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0]
  if (!ws) {
    const available = wb.worksheets.map((s) => s.name).join(', ')
    throw new Error(
      sheetName
        ? `Worksheet "${sheetName}" not found in ${path}. Available sheets: ${available}.`
        : `${path} has no worksheets.`,
    )
  }

  const { rowNumber: headerRowNumber, columns } = findHeaderRow(ws)

  const rows: WorkbookRow[] = []
  const dataStart = headerRowNumber + 1
  const lastRow = Math.max(ws.rowCount, dataStart + DATA_PROBE_ROWS)
  for (let r = dataStart; r <= lastRow; r++) {
    const excelRow = ws.getRow(r)
    if (excelRow.cellCount === 0) continue

    const id = cellText(excelRow, columns.id)
    const name = cellText(excelRow, columns.name)
    const levelText = cellText(excelRow, columns.levelText)
    if (!id && !name && !levelText) continue // spacer row — nothing to classify, not a skip

    rows.push({
      id,
      name,
      levelText,
      status: cellText(excelRow, columns.status),
      alternateId: cellText(excelRow, columns.alternateId),
      relatedProcessId: cellText(excelRow, columns.relatedProcessId),
      rowNumber: r,
    })
  }
  return rows
}

/* ------------------------------------------------------------------ *
 * Plan rendering — add-project-tier.ts / WBS-import shape
 * ------------------------------------------------------------------ */

type SkipCategory = 'unparseable-id' | 'unmapped-level' | 'out-of-scope' | 'missing-parent' | 'invalid-for-write'

const CATEGORY_LABEL: Record<SkipCategory, string> = {
  'unparseable-id': 'unparseable id',
  'unmapped-level': 'unmapped level',
  'out-of-scope': 'out of scope for v1',
  'missing-parent': 'missing implied parent',
  'invalid-for-write': 'not writable as a CatalogueEntry',
}
const OUT_OF_SCOPE_L_NUMBER: Record<string, string> = { e2e: 'L1', 'system-process': 'L5', 'test-case': 'L6' }

function categorize(s: SkippedImportRow): SkipCategory {
  if (/implied process-area parent/i.test(s.reason) || /could not derive an implied process-area parent/i.test(s.reason)) {
    return 'missing-parent'
  }
  if (s.level === 'unmapped') return 'unmapped-level'
  if (s.level === 'e2e' || s.level === 'system-process' || s.level === 'test-case') return 'out-of-scope'
  return 'unparseable-id'
}

/** `CatalogueEntry.status` values this import ever writes. Matches the schema's documented vocabulary. */
type EntryStatus = 'live' | 'deprecated' | 'deleted'

/**
 * `WorkbookRow.status`'s free text, normalised to the three values `CatalogueEntry.status` is
 * documented to hold (schema.prisma:1652, `/// live | deprecated | deleted.`). Blank/absent means
 * a live row — the catalogue's own convention (module doc on `WorkbookRow.status`: "blank/absent
 * for a live row"). Anything else that isn't a recognised spelling of Deprecated/Deleted is never
 * guessed into one of the three — `null` tells the caller to skip the row and say why, the same
 * "refuse rather than invent" discipline `classifyWorkbookRow` uses for level and id.
 */
function normalizeStatus(raw: string | null | undefined): EntryStatus | null {
  const t = (raw ?? '').trim().toLowerCase()
  if (!t) return 'live'
  if (t === 'live') return 'live'
  if (t === 'deprecated') return 'deprecated'
  if (t === 'deleted') return 'deleted'
  return null
}

/** One row cleared for creation with every `CatalogueEntry` field resolved and valid to write. */
interface WritableEntry {
  id: string
  level: CatalogueLevel
  name: string
  status: EntryStatus
  alternateId: string | null
}

/**
 * Split `toCreate` (rows cleared by `orderForImport`, not yet present in the DB) into what can
 * actually be written and what must be skipped-and-reported instead, per the module doc's step 5
 * note. Order is preserved — callers rely on it for parent-before-child (AC3).
 */
function resolveForWrite(toCreate: OrderedImportRow[]): { creatable: WritableEntry[]; invalid: SkippedImportRow[] } {
  const creatable: WritableEntry[] = []
  const invalid: SkippedImportRow[] = []
  for (const o of toCreate) {
    const name = (o.row.name ?? '').trim()
    if (!name) {
      invalid.push({ row: o.row, level: o.level, reason: 'Row carries no name — a CatalogueEntry cannot be written without one.' })
      continue
    }
    const status = normalizeStatus(o.row.status)
    if (!status) {
      invalid.push({
        row: o.row,
        level: o.level,
        reason: `Status "${o.row.status}" does not match live/deprecated/deleted — refusing to guess which it means.`,
      })
      continue
    }
    creatable.push({ id: o.id, level: o.level, name, status, alternateId: (o.row.alternateId ?? '').trim() || null })
  }
  return { creatable, invalid }
}

function groupByLevel<T extends { level: CatalogueLevel }>(rows: T[]): Map<CatalogueLevel, T[]> {
  const m = new Map<CatalogueLevel, T[]>()
  for (const lvl of IMPORTABLE_LEVELS) m.set(lvl, [])
  for (const r of rows) {
    if (!m.has(r.level)) m.set(r.level, [])
    m.get(r.level)!.push(r)
  }
  return m
}

function describeOrdered(o: OrderedImportRow): string {
  return `${o.id} — ${o.row.name ?? '(no name)'}`
}

async function main() {
  console.log('')
  console.log(`AXIOMATE — D365 CATALOGUE IMPORT   ${APPLY ? '(applying)' : '(dry run)'}`)
  console.log(`Tenant: ${TENANT}`)
  console.log(`Operator: ${ACTOR.name}`)
  console.log(`Workbook: ${WORKBOOK_PATH}${SHEET_NAME ? `  sheet: ${SHEET_NAME}` : ''}${WORKBOOK_VERSION ? `  version: ${WORKBOOK_VERSION}` : ''}`)
  console.log('')

  const rows = await readWorkbookRows(WORKBOOK_PATH as string, SHEET_NAME)
  console.log(`Read ${rows.length} row(s) with an id, name or level/type value.`)
  console.log('')

  const order = orderForImport(rows)

  const existing = await runAsTenant(TENANT, (tx) =>
    tx.catalogueEntry.findMany({ where: { tenantId: TENANT }, select: { id: true } }),
  )
  const existingIds = new Set(existing.map((e) => e.id))

  const toCreate = order.ordered.filter((o) => !existingIds.has(o.id))
  const alreadyPresent = order.ordered.filter((o) => existingIds.has(o.id))

  // Resolved here, not just under --apply, so the dry run's WOULD CREATE list never promises a
  // row that --apply would in fact refuse (blank name, unrecognised status — see the module doc).
  const { creatable, invalid: invalidForWrite } = resolveForWrite(toCreate)

  const toCreateByLevel = groupByLevel(creatable)
  const presentByLevel = groupByLevel(alreadyPresent)

  console.log('WOULD CREATE')
  if (!creatable.length) {
    console.log('  none — every row cleared for import already exists as a CatalogueEntry (or nothing was cleared).')
  } else {
    for (const level of IMPORTABLE_LEVELS) {
      const levelRows = toCreateByLevel.get(level) ?? []
      if (!levelRows.length) continue
      console.log(`  ${level}: ${levelRows.length}`)
      for (const o of levelRows.slice(0, 6)) console.log(`    ${o.id} — ${o.name}`)
      if (levelRows.length > 6) console.log(`    ...and ${levelRows.length - 6} more`)
    }
  }
  console.log('')

  console.log(`ALREADY PRESENT — ${alreadyPresent.length} row(s) cleared for import already exist as a CatalogueEntry for this tenant`)
  if (alreadyPresent.length) {
    for (const level of IMPORTABLE_LEVELS) {
      const levelRows = presentByLevel.get(level) ?? []
      if (!levelRows.length) continue
      console.log(`  ${level}: ${levelRows.length}`)
      for (const o of levelRows.slice(0, 4)) console.log(`    ${describeOrdered(o)}`)
      if (levelRows.length > 4) console.log(`    ...and ${levelRows.length - 4} more`)
    }
  }
  console.log('')

  const allSkipped: SkippedImportRow[] = [...order.skipped, ...invalidForWrite]
  console.log(`NOT CREATED — ${allSkipped.length} row(s) skipped, each for a stated reason`)
  const byCategory = new Map<SkipCategory, SkippedImportRow[]>()
  for (const s of order.skipped) {
    const c = categorize(s)
    if (!byCategory.has(c)) byCategory.set(c, [])
    byCategory.get(c)!.push(s)
  }
  if (invalidForWrite.length) byCategory.set('invalid-for-write', invalidForWrite)
  const categoryOrder: SkipCategory[] = [
    'unparseable-id',
    'unmapped-level',
    'out-of-scope',
    'missing-parent',
    'invalid-for-write',
  ]
  if (!allSkipped.length) {
    console.log('  none')
  } else {
    for (const cat of categoryOrder) {
      const items = byCategory.get(cat) ?? []
      if (!items.length) continue
      const label =
        cat === 'out-of-scope'
          ? `${CATEGORY_LABEL[cat]} (${Array.from(new Set(items.map((i) => OUT_OF_SCOPE_L_NUMBER[i.level as string] ?? i.level))).sort().join('/')})`
          : CATEGORY_LABEL[cat]
      console.log(`  ${label}: ${items.length}`)
      for (const s of items.slice(0, 5)) {
        const id = s.row.id ?? '(no id)'
        const at = s.row.rowNumber ? `row ${s.row.rowNumber}` : 'row ?'
        console.log(`    ${at} (${id}): ${s.reason}`)
      }
      if (items.length > 5) console.log(`    ...and ${items.length - 5} more`)
    }
  }
  console.log('')

  console.log(
    `Summary: ${rows.length} row(s) read, ${order.ordered.length} cleared for import ` +
      `(${creatable.length} would create, ${alreadyPresent.length} already present), ${allSkipped.length} skipped.`,
  )

  if (!APPLY) {
    console.log('')
    console.log('Nothing changed. Re-run with --apply to write it.')
    return
  }

  /**
   * One `create` per row, in the exact order `orderForImport` produced — process-area rows
   * before the process/scenario/configuration-deliverable rows that name them (AC3). A present
   * id is never touched (AC6, BR6 — see the module doc's "create-only" note): `toCreate`/
   * `creatable` already excludes every id this run's `existingIds` snapshot found, so the only
   * way `create` can still hit that id is a concurrent run inserting it in between — caught below
   * as P2002 and reported as ALREADY PRESENT rather than crashing the run.
   */
  console.log('')
  let created = 0
  let concurrentlyPresent = 0
  for (const c of creatable) {
    try {
      await runAsTenant(TENANT, (tx) =>
        tx.catalogueEntry.create({
          data: {
            tenantId: TENANT,
            id: c.id,
            level: c.level,
            name: c.name,
            status: c.status,
            alternateId: c.alternateId,
            workbookVersion: WORKBOOK_VERSION,
          },
        }),
      )
      created += 1
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        concurrentlyPresent += 1
        console.log(`  ${c.id}: created by a concurrent run since this run started — left as is, not overwritten.`)
        continue
      }
      throw e
    }
  }

  console.log('')
  console.log(
    `Applied. ${created} CatalogueEntry row(s) created for tenant ${TENANT}` +
      (concurrentlyPresent ? `, ${concurrentlyPresent} found already present mid-run` : '') +
      `. ${alreadyPresent.length} already present at start, ${invalidForWrite.length} skipped as not writable.`,
  )
}

main()
  .catch((err) => {
    console.log('')
    console.log('Failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
