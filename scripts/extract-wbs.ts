/**
 * Extract the OAPIL WBS and SLG WBS sheets from the program tracker into raw JSON.
 *
 * Pure extraction — no mapping, no validation, no database access. `transform-wbs.mjs` is
 * where the source's own vocabulary (Type, Status) gets interpreted; this step only reads
 * cells and writes them out verbatim, tagged with which project each row belongs to (the
 * sheet name, not a column, is the only place that fact lives).
 *
 *   npx tsx scripts/extract-wbs.ts "C:\path\to\OAPIL_SLG_PM_Tracker_STAGED.xlsx"
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

const HEADER_ROW = 3
const DATA_START_ROW = 4
const SHEETS: { name: string; project: 'OAPIL' | 'SLG' }[] = [
  { name: 'OAPIL WBS', project: 'OAPIL' },
  { name: 'SLG WBS', project: 'SLG' },
]

async function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('Usage: npx tsx scripts/extract-wbs.ts "<path to xlsx>"')
    process.exit(1)
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  const rows: Record<string, string | number | null>[] = []

  for (const { name, project } of SHEETS) {
    const ws = wb.getWorksheet(name)
    if (!ws) throw new Error(`Sheet "${name}" not found in ${path}.`)

    const headerRow = ws.getRow(HEADER_ROW)
    const headers: string[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? '').trim()
    })
    if (!headers.length) throw new Error(`No headers found on row ${HEADER_ROW} of "${name}".`)

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < DATA_START_ROW) return
      const idCell = row.getCell(headers.indexOf('ID'))
      const id = idCell.value
      if (id === null || id === undefined || String(id).trim() === '') return

      const record: Record<string, string | number | null> = { project }
      headers.forEach((header, colNumber) => {
        if (!header) return
        const cell = row.getCell(colNumber)
        const v = cell.value
        record[header] = v === null || v === undefined ? null : typeof v === 'object' ? String(v) : v
      })
      rows.push(record)
    })
  }

  const outPath = join(process.cwd(), 'data/wbs.raw.json')
  writeFileSync(outPath, JSON.stringify(rows, null, 2))
  console.log(`Wrote ${outPath}`)
  console.log(`  rows: ${rows.length}`)
  console.log(`  OAPIL: ${rows.filter((r) => r.project === 'OAPIL').length}`)
  console.log(`  SLG:   ${rows.filter((r) => r.project === 'SLG').length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
