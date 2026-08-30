import PDFDocument from 'pdfkit'
import type { OrganizationIdentity } from '../config'
import type { DailyIms, ImsLine } from './dailyIms'
import type { WeeklyClientPack, MonthlyGovernancePack } from './clientPack'

/**
 * Branded PDF renderings of the three scheduled reports, for the delivery phase's email
 * attachments. See `docs/plans/2026-08-30-report-delivery-design.md`.
 *
 * ---------------------------------------------------------------------------
 * The one hard rule
 *
 * Every renderer takes ONLY the pure report object the screens already use, plus the
 * organisation identity — NEVER `WorkspaceState`. RP2's sentinel scan pins what a pack object
 * may carry across the client boundary; a renderer that cannot see state cannot leak what the
 * object does not hold. Extending a renderer to take state is not a convenience, it is a hole
 * in that proof.
 *
 * Server-only by usage: imported from the scheduled pass alone, so pdfkit never enters the
 * client bundle (checked at the build gate).
 */

const MARGIN = 50
const WIDTH = 612 - MARGIN * 2 // letter

type Doc = InstanceType<typeof PDFDocument>

function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

/**
 * The shared branded header: logo when the stored data URI is an embeddable raster, wordmark
 * styling otherwise — and a logo that FAILS to embed falls back silently-visibly, the header
 * renders, the image does not. Mirrors `components/reports/ReportHeader.tsx`.
 */
function header(doc: Doc, org: OrganizationIdentity, title: string, period: string, generated: string): void {
  const top = doc.y
  let textX = MARGIN
  const m = org.logoDataUri?.match(/^data:image\/(png|jpeg);base64,(.+)$/)
  if (m) {
    try {
      doc.image(Buffer.from(m[2], 'base64'), MARGIN, top, { fit: [100, 36] })
      textX = MARGIN + 112
    } catch {
      textX = MARGIN
    }
  }
  doc.fontSize(14).font('Helvetica-Bold').text(org.name, textX, top)
  if (org.shortName && org.shortName !== org.name) {
    doc.fontSize(9).font('Helvetica').fillColor('#666666').text(org.shortName, textX)
  }
  doc.fillColor('#000000')
  doc.fontSize(11).font('Helvetica-Bold').text(title, MARGIN, top, { width: WIDTH, align: 'right' })
  doc.fontSize(9).font('Helvetica').fillColor('#666666')
  doc.text(period, MARGIN, doc.y, { width: WIDTH, align: 'right' })
  doc.text(`Generated ${generated}`, MARGIN, doc.y, { width: WIDTH, align: 'right' })
  doc.fillColor('#000000')
  const y = Math.max(doc.y, top + 44)
  doc.moveTo(MARGIN, y).lineTo(MARGIN + WIDTH, y).lineWidth(1.5).strokeColor('#333333').stroke()
  doc.y = y + 14
  doc.x = MARGIN
}

function sectionTitle(doc: Doc, text: string): void {
  doc.moveDown(0.6)
  doc.fontSize(11).font('Helvetica-Bold').text(text, MARGIN)
  doc.moveDown(0.3)
}

function bodyLine(doc: Doc, text: string, muted = false): void {
  doc.fontSize(9).font('Helvetica').fillColor(muted ? '#666666' : '#000000').text(text, MARGIN)
  doc.fillColor('#000000')
}

/** A plain table: proportional column widths over the content width, header row bold. */
function table(doc: Doc, headers: string[], weights: number[], rows: string[][]): void {
  const total = weights.reduce((a, b) => a + b, 0)
  const widths = weights.map((w) => (w / total) * WIDTH)
  const drawRow = (cells: string[], bold: boolean) => {
    if (doc.y > 720) doc.addPage()
    const y = doc.y
    doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica')
    let x = MARGIN
    let bottom = y
    cells.forEach((cell, i) => {
      doc.text(cell, x, y, { width: widths[i] - 6 })
      bottom = Math.max(bottom, doc.y)
      x += widths[i]
    })
    doc.y = bottom + 2
    doc.x = MARGIN
  }
  drawRow(headers, true)
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + WIDTH, doc.y).lineWidth(0.5).strokeColor('#999999').stroke()
  doc.y += 3
  for (const row of rows) drawRow(row, false)
}

const imsRow = (l: ImsLine): string[] => [l.id, l.subject, l.owner, l.status, l.severity, l.due]

export async function renderImsPdf(r: DailyIms, org: OrganizationIdentity): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGIN })
  const out = collect(doc)
  header(doc, org, 'Daily IMS — issue management status', `Scope ${r.scope}`, r.asAt)

  sectionTitle(doc, 'Position')
  bodyLine(doc, `Open ${r.position.open} of ${r.position.total} (closed ${r.position.closed})`)
  bodyLine(doc, `Severity  High ${r.position.high} · Medium ${r.position.medium} · Low ${r.position.low}`)
  bodyLine(
    doc,
    `Overdue ${r.position.overdue} · At risk ${r.position.atRisk} · Blocked ${r.position.blocked} · Unscheduled ${r.position.unscheduled}`,
  )

  sectionTitle(doc, 'Movement')
  if (!r.movement.trailAvailable) {
    bodyLine(doc, 'Nothing recorded in the audit trail for this window.', true)
  } else {
    bodyLine(
      doc,
      `Raised ${r.movement.raised.length} · Closed ${r.movement.closed.length} · Status changes ${r.movement.statusChanges.length} · Notes ${r.movement.notesAdded.length} · Other edits ${r.movement.otherEdits}`,
    )
  }

  for (const s of r.sections) {
    sectionTitle(doc, `${s.title} (${s.lines.length})`)
    bodyLine(doc, s.note, true)
    doc.moveDown(0.2)
    table(doc, ['ID', 'Subject', 'Owner', 'Status', 'Severity', 'Due'], [10, 34, 14, 16, 10, 11], s.lines.map(imsRow))
  }

  doc.moveDown(1)
  bodyLine(doc, 'Every figure is counted from the rows behind the grid; none is estimated.', true)
  doc.end()
  return out
}

function packShared(
  doc: Doc,
  pack: WeeklyClientPack | MonthlyGovernancePack,
  periodWord: string,
): void {
  bodyLine(
    doc,
    `${pack.disclosure.shown} of ${pack.disclosure.total} records for ${pack.client} are shown here; the rest are marked internal.`,
    true,
  )

  sectionTitle(doc, 'Position')
  bodyLine(doc, `Open ${pack.position.open} of ${pack.position.total} (${pack.position.closed} closed)`)
  bodyLine(doc, `High ${pack.position.high} · Medium ${pack.position.medium} · Low ${pack.position.low}`)

  sectionTitle(doc, 'Progress')
  bodyLine(
    doc,
    `Closed ${pack.progress.periodDeltas.closed} · Newly raised ${pack.progress.periodDeltas.raised} this ${periodWord} (from record dates)`,
  )
  const s = pack.progress.schedule
  bodyLine(
    doc,
    `${s.pctComplete !== null ? `${s.pctComplete}% complete` : 'Completion not measurable'} · On track ${s.onTrack} · Overdue ${s.overdue}${s.projectedFinish ? ` · Projected finish ${s.projectedFinish}` : ''}`,
  )
}

export async function renderWeeklyPackPdf(p: WeeklyClientPack, org: OrganizationIdentity): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGIN })
  const out = collect(doc)
  header(doc, org, `Weekly client pack — ${p.client}`, `${p.window.from} – ${p.window.to}`, p.asOf)
  packShared(doc, p, 'week')

  sectionTitle(doc, 'Activity this week')
  if (p.lines.length === 0) {
    bodyLine(doc, 'Nothing shown here had activity in this window.', true)
  } else {
    table(
      doc,
      ['ID', 'Subject', 'Owner', 'Status', 'Severity', 'Due', 'Last activity'],
      [10, 30, 13, 14, 10, 11, 12],
      p.lines.map((l) => [l.id, l.subject, l.owner, l.status, l.severity, l.due, l.lastActivity]),
    )
  }

  doc.moveDown(1)
  bodyLine(
    doc,
    `Generated by Axiomate from ${p.disclosure.total} records for ${p.client}. Every figure is counted from the records; none is estimated.`,
    true,
  )
  doc.end()
  return out
}

export async function renderMonthlyPackPdf(p: MonthlyGovernancePack, org: OrganizationIdentity): Promise<Buffer> {
  const doc = new PDFDocument({ margin: MARGIN })
  const out = collect(doc)
  header(doc, org, `Monthly governance pack — ${p.client}`, `${p.window.from} – ${p.window.to}`, p.asOf)
  packShared(doc, p, 'month')

  sectionTitle(doc, 'Movement this month')
  if (!p.movement.trailAvailable) {
    bodyLine(
      doc,
      'Nothing recorded. Movement is read from the audit trail, which is capped — an empty section means nothing was recorded in this trail, not that nothing happened.',
      true,
    )
  } else {
    bodyLine(doc, `Raised ${p.movement.raised} · Resolved ${p.movement.resolved}`)
  }

  doc.moveDown(1)
  bodyLine(
    doc,
    `Generated by Axiomate from ${p.disclosure.total} records for ${p.client}. Every figure is counted from the records or the audit trail; none is estimated.`,
    true,
  )
  doc.end()
  return out
}
