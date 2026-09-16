/**
 * Pure logic for reading the Microsoft D365 Business Process Catalogue workbook.
 *
 * No I/O, no Prisma import. `scripts/import-d365-catalogue.ts` (a later step of
 * ART-20260914-004) is where a real workbook gets opened and `CatalogueEntry` rows get
 * written — this module only interprets rows the script has already extracted into plain
 * objects (`WorkbookRow`), the same split `extract-wbs.ts` / `transform-wbs.mjs` used for the
 * WBS import.
 *
 * ---------------------------------------------------------------------------
 * Grounded against Microsoft Learn (fetched 2026-09-16, E1 unless noted) —
 * `about-catalog-levels`, `about-whats-new-2024-november`, `about-import-catalog-devops-
 * process-work-item-types`, `about-import-catalog-devops-configuration-deliverable-work-item-
 * type`, `about-devops-work-items-deliverables`:
 *
 *   - Six levels, in this vocabulary: end-to-end process (L1), business process area (L2),
 *     business process (L3), scenario/pattern (L4), system process (L5), test case (L6).
 *     Naming is Microsoft-governed; each level also carries an Azure DevOps work-item-type
 *     name ("End-to-end", "Process area", "Process", "Scenario").
 *   - **Every catalogue (Process Sequence) id is four dot-separated, zero-padded numeric
 *     segments of fixed width — `NN.NN.NNN.NNN`** (Nov 2024 update, "Updated process sequence
 *     IDs"): `60.00.000.000` (L1), `60.10.000.000` (L2), `60.10.100.000` (L3), and (by the same
 *     pattern, L4 fully populated) e.g. `60.10.100.010`. A trailing segment of zeros means "not
 *     used at this level," not "absent." This module's `parseCatalogueId` enforces exactly this
 *     shape.
 *   - **Configuration deliverable is not part of that 4-segment tree.** It is a related work
 *     item "mapped to the Level 3 process that is primary to the configuration"
 *     (`about-devops-work-items-deliverables`) — a relationship field, not a nesting of its own
 *     id under its process's id. This module therefore never infers a configuration-deliverable
 *     row's implied process-area parent from its OWN id; it always requires the workbook's
 *     explicit "related process" reference (`WorkbookRow.relatedProcessId`) and derives the
 *     parent from THAT id's shape. Confirmed E1 that the relationship exists; **not confirmed
 *     (E3)** whether a configuration deliverable's own id follows the same 4-segment shape as
 *     the other five levels — so, unlike them, its own id is never required to parse as one;
 *     it is carried verbatim as the `CatalogueEntry` key (ADR 0006 point 2).
 *
 * The persisted `CatalogueEntry.level` enum (ADR 0006, ART-20260914-001 scope_in item 1) is
 * `e2e | process-area | process | scenario | configuration-deliverable` — it has no slot for
 * `system-process`/`test-case` because those two levels are never imported in v1 (BR5) and so
 * never need to be persisted. Classification below still recognises all seven names, because
 * AC4 requires *telling apart* "recognised but out of scope" from "not recognised at all," and
 * that distinction is lost if the two skipped levels aren't named.
 */

/** The five levels `CatalogueEntry.level` can ever hold. Matches ADR 0006 / ART-20260914-001. */
export const CATALOGUE_LEVELS = [
  'e2e',
  'process-area',
  'process',
  'scenario',
  'configuration-deliverable',
] as const
export type CatalogueLevel = (typeof CATALOGUE_LEVELS)[number]

/**
 * Every level this module's classifier can recognise in a workbook row — the five persistable
 * ones plus the two (`system-process`, `test-case`) that are real catalogue levels with no
 * consumer in this product. Recognised, never persisted.
 */
export type RecognizedLevel = CatalogueLevel | 'system-process' | 'test-case'

/**
 * The only levels this import ever proposes a `CatalogueEntry` for (BR5, plan step 1).
 * `e2e` is in `CATALOGUE_LEVELS` — the schema leaves room for a future L1 import — but v1 never
 * proposes one; L1 has no home in this codebase today (design doc Part 3).
 */
export const IMPORTABLE_LEVELS: readonly CatalogueLevel[] = [
  'process-area',
  'process',
  'scenario',
  'configuration-deliverable',
]

function isImportable(level: RecognizedLevel): level is CatalogueLevel {
  return (IMPORTABLE_LEVELS as readonly string[]).includes(level)
}

/**
 * Recognised spellings for each level's name, as they appear either in the catalogue's own
 * "Level" column text or in the Azure DevOps work-item-type name Microsoft renamed levels to
 * (Nov 2024) — both forms show up depending on which export of the workbook an operator has.
 * Matched case-insensitively, trimmed, exact — never a substring match, so "Business process
 * area" and "Business process" never collide.
 */
const LEVEL_TEXT = new Map<string, RecognizedLevel>([
  ['end-to-end process', 'e2e'],
  ['end-to-end', 'e2e'],
  ['e2e', 'e2e'],
  ['business process area', 'process-area'],
  ['process area', 'process-area'],
  ['business process', 'process'],
  ['process', 'process'],
  ['scenario', 'scenario'],
  ['pattern', 'scenario'],
  ['scenario (pattern)', 'scenario'],
  ['system process', 'system-process'],
  ['test case', 'test-case'],
  // Not the bare "configuration" — Microsoft's own work-item-type name is the full two-word
  // phrase (about-import-catalog-devops-configuration-deliverable-work-item-type). A row
  // recognised by mistake here is the one classification error that manufactures a CREATE
  // rather than an extra skip, so this entry stays exact, not loose.
  ['configuration deliverable', 'configuration-deliverable'],
])

/**
 * One row as extracted from the workbook, before any interpretation.
 *
 * Field names describe what the catalogue calls them, not what this product calls them —
 * `relatedProcessId` is the "primary process" a configuration deliverable is mapped to
 * (`about-devops-work-items-deliverables`), and `alternateId` is the catalogue's own
 * "Alternate Process Sequence ID" column. Every field is the raw cell value or `null`/
 * `undefined`; nothing here has been validated yet.
 */
export interface WorkbookRow {
  /** The catalogue's own hierarchical (Process Sequence) id, e.g. `60.10.100.000`. */
  id: string | null | undefined
  name: string | null | undefined
  /** Raw text from the workbook's Level/Type column. Matched against `LEVEL_TEXT`. */
  levelText: string | null | undefined
  /** `Deprecated`, `Deleted`, or blank/absent for a live row. Carried through, not interpreted here. */
  status: string | null | undefined
  /** The catalogue's "Alternate Process Sequence ID" column, present on a deprecated row. */
  alternateId: string | null | undefined
  /** The L3 (occasionally L4) process id a configuration-deliverable row is primary to. */
  relatedProcessId: string | null | undefined
  /** 1-based sheet row, for a skip reason a person can find in the workbook. Optional. */
  rowNumber?: number
}

/** A catalogue id split into its four zero-padded segments, still exactly as written. */
export interface ParsedCatalogueId {
  /** The id as given, trimmed — what gets stored as `CatalogueEntry.id`. */
  raw: string
  /** `[end-to-end, process-area, process, scenario]`, e.g. `['60', '10', '100', '000']`. */
  segments: readonly [string, string, string, string]
}

const ID_PATTERN = /^(\d{2})\.(\d{2})\.(\d{3})\.(\d{3})$/

/**
 * Parse a catalogue hierarchical id.
 *
 * Requires exactly the shape Microsoft's own Nov-2024 update standardised on: four
 * dot-separated numeric segments, widths 2-2-3-3. Anything else — extra/missing segments, a
 * non-numeric segment, the pre-2024 unpadded shape — returns `null` rather than a best guess;
 * callers report that as "does not parse," never invent a segment to make it fit (AC4).
 */
export function parseCatalogueId(id: string | null | undefined): ParsedCatalogueId | null {
  if (!id) return null
  const trimmed = id.trim()
  const m = ID_PATTERN.exec(trimmed)
  if (!m) return null
  return { raw: trimmed, segments: [m[1], m[2], m[3], m[4]] }
}

/**
 * The `[end-to-end, process-area]` segment pair identifying a parsed id's process-area
 * ancestor. Used as the join key between a child row and its process-area parent — segment
 * comparison, never a reconstructed-then-reparsed string, so a parent match can't be missed by
 * a padding mismatch that isn't actually there.
 */
function processAreaKeyOf(parsed: ParsedCatalogueId): string {
  return `${parsed.segments[0]}.${parsed.segments[1]}`
}

/** The process-area id a parsed id's own process-area ancestor would have: `NN.NN.000.000`. Display only. */
function processAreaIdOf(parsed: ParsedCatalogueId): string {
  return `${processAreaKeyOf(parsed)}.000.000`
}

/** The outcome of classifying one workbook row. Always carries a reason when not proposed. */
export interface ClassifiedRow {
  row: WorkbookRow
  /** `'unmapped'` when the row's level/type text matched none of the seven recognised names. */
  level: RecognizedLevel | 'unmapped'
  /** True only for a `process-area | process | scenario | configuration-deliverable` row whose id(s) parsed. */
  proposed: boolean
  /** Why `proposed` is false. Null iff `proposed` is true. */
  reason: string | null
}

/**
 * Classify one workbook row against the catalogue's six levels plus the configuration-
 * deliverable relationship.
 *
 * Three distinct outcomes, kept distinct rather than collapsed into one boolean, per AC4 and
 * the plan's instruction to report "does not map" and "no home, not imported" as separate,
 * honest reasons:
 *
 *   1. **`level: 'unmapped'`** — the row's Level/Type text matched none of the seven recognised
 *      names. Nothing about this row is guessed; AC4's "does not map" case.
 *   2. **Recognised but not importable** (`e2e`, `system-process`, `test-case`) — a real
 *      catalogue level this product has no home for (design doc Part 2, BR5). scope_out's "no
 *      home, not imported."
 *   3. **Recognised and importable** (`process-area | process | scenario |
 *      configuration-deliverable`) — `proposed: true` only once its id (and, for a
 *      configuration deliverable, its related-process id) has parsed; otherwise still not
 *      proposed, with the parse failure named as the reason (AC4's "id does not parse" case).
 */
export function classifyWorkbookRow(row: WorkbookRow): ClassifiedRow {
  const rawLevel = (row.levelText ?? '').trim().toLowerCase()
  const level = rawLevel ? LEVEL_TEXT.get(rawLevel) : undefined

  if (!level) {
    return {
      row,
      level: 'unmapped',
      proposed: false,
      reason: row.levelText
        ? `Level/type "${row.levelText}" does not match any of the catalogue's six levels or the configuration-deliverable work item type — nothing was guessed.`
        : 'Row carries no level/type value to classify against the catalogue.',
    }
  }

  if (!isImportable(level)) {
    return {
      row,
      level,
      proposed: false,
      reason: `Level "${level}" is a recognised catalogue level with no home in this product — v1 imports process-area, process, scenario and configuration-deliverable only (BR5).`,
    }
  }

  if (level === 'configuration-deliverable') {
    if (!row.id || !row.id.trim()) {
      return { row, level, proposed: false, reason: 'Configuration-deliverable row carries no id.' }
    }
    const related = parseCatalogueId(row.relatedProcessId)
    if (!related) {
      return {
        row,
        level,
        proposed: false,
        reason: row.relatedProcessId
          ? `Configuration deliverable's related-process id "${row.relatedProcessId}" does not parse as a catalogue id — nothing was guessed.`
          : 'Configuration-deliverable row carries no related-process reference to derive a process-area parent from.',
      }
    }
    return { row, level, proposed: true, reason: null }
  }

  // process-area | process | scenario: keyed and parented off their own id's shape.
  const parsed = parseCatalogueId(row.id)
  if (!parsed) {
    return {
      row,
      level,
      proposed: false,
      reason: row.id
        ? `Hierarchical id "${row.id}" does not parse (expected four dot-separated, zero-padded segments, e.g. "60.10.100.000") — nothing was guessed.`
        : 'Row carries no hierarchical id to classify.',
    }
  }
  return { row, level, proposed: true, reason: null }
}

/**
 * The implied process-area (L2) parent id for a proposed `process | scenario |
 * configuration-deliverable` row, or `null` when it has none to derive (a `process-area` row
 * itself — L1 is out of scope, see module doc) or the id(s) it would derive from don't parse.
 *
 * `process`/`scenario` derive it from their OWN id (`NN.NN.000.000`, truncating the segments
 * that go deeper). `configuration-deliverable` derives it from its `relatedProcessId` instead —
 * see the module doc on why its own id is never used for this.
 */
export function deriveImpliedProcessAreaParentId(row: WorkbookRow, level: CatalogueLevel): string | null {
  if (level === 'process' || level === 'scenario') {
    const parsed = parseCatalogueId(row.id)
    return parsed ? processAreaIdOf(parsed) : null
  }
  if (level === 'configuration-deliverable') {
    const related = parseCatalogueId(row.relatedProcessId)
    return related ? processAreaIdOf(related) : null
  }
  return null
}

/** One row cleared for creation, in the order it should be created. */
export interface OrderedImportRow {
  row: WorkbookRow
  level: CatalogueLevel
  /** `row.id`, trimmed — what `CatalogueEntry.id` will be. */
  id: string
}

/** One row this import will not create, and why. */
export interface SkippedImportRow {
  row: WorkbookRow
  level: RecognizedLevel | 'unmapped'
  reason: string
}

export interface ImportOrder {
  /** Process-area rows first, then process/scenario/configuration-deliverable rows — each
   *  after the process-area row its implied parent id names. */
  ordered: OrderedImportRow[]
  skipped: SkippedImportRow[]
}

/**
 * Classify every row, then topologically order the ones cleared for creation — parent
 * (process-area) before child (process/scenario/configuration-deliverable) — skipping, with a
 * stated reason, any row that classification refused (AC4) or whose implied process-area
 * parent is not present anywhere in this workbook (AC3). Never invents a parent.
 *
 * This function reasons about the workbook alone — whether a row's catalogue id is already a
 * `CatalogueEntry` in the database ("ALREADY PRESENT", AC6) is the import script's concern
 * (steps 4-5), not this one; nothing here reads or needs a tenant's existing rows.
 */
export function orderForImport(rows: WorkbookRow[]): ImportOrder {
  const skipped: SkippedImportRow[] = []
  const proposed: { row: WorkbookRow; level: CatalogueLevel }[] = []

  for (const row of rows) {
    const c = classifyWorkbookRow(row)
    if (!c.proposed) {
      skipped.push({ row: c.row, level: c.level, reason: c.reason as string })
      continue
    }
    // isImportable already guarantees this at the classify stage; narrow for the compiler.
    proposed.push({ row: c.row, level: c.level as CatalogueLevel })
  }

  const processAreas = proposed.filter((p) => p.level === 'process-area')
  const children = proposed.filter((p) => p.level !== 'process-area')

  // Keyed on the parsed segment pair, not a reconstructed-then-reparsed id string — see
  // `processAreaKeyOf`. classifyWorkbookRow already guaranteed a process-area row's own id
  // parses before proposing it, so the `!` here is narrowing a fact already established.
  const processAreaKeys = new Set(
    processAreas.map((p) => processAreaKeyOf(parseCatalogueId(p.row.id) as ParsedCatalogueId)),
  )

  const orderedProcessAreas: OrderedImportRow[] = processAreas.map((p) => ({
    row: p.row,
    level: p.level,
    id: (p.row.id as string).trim(),
  }))

  const orderedChildren: OrderedImportRow[] = []
  for (const c of children) {
    const parentParsed =
      c.level === 'configuration-deliverable' ? parseCatalogueId(c.row.relatedProcessId) : parseCatalogueId(c.row.id)
    const parentKey = parentParsed ? processAreaKeyOf(parentParsed) : null
    if (!parentKey || !processAreaKeys.has(parentKey)) {
      const parentId = deriveImpliedProcessAreaParentId(c.row, c.level)
      skipped.push({
        row: c.row,
        level: c.level,
        reason: parentId
          ? `Implied process-area parent "${parentId}" is not present anywhere in this workbook — skipped, not given an invented parent (AC3).`
          : 'Could not derive an implied process-area parent id (its own or related-process id did not parse) — skipped, not given an invented parent.',
      })
      continue
    }
    orderedChildren.push({ row: c.row, level: c.level, id: (c.row.id as string).trim() })
  }

  return { ordered: [...orderedProcessAreas, ...orderedChildren], skipped }
}
