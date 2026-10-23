import { useMemo, useState } from 'react'
import type { WorkspaceState } from '@/lib/workspace'
import { buildLeaveReport } from '@/lib/reports/leave'
import LeaveReportView from './LeaveReportView'

/**
 * "Leave report…" off the Export menu. Unlike the finance report there is no period picker —
 * the design's own resolution (docs/plans/2026-09-08-leave-report-design.md, decided 10 Sep) is
 * a fixed trailing-6-months window, always current. One `buildLeaveReport` call (the memo below)
 * feeds the preview, the workbook AND the print view, so the file and the screen cannot
 * disagree.
 *
 * exceljs is imported dynamically inside the download handler, matching FinanceReportDialog —
 * a static import would put a spreadsheet engine into the main chunk for every visitor.
 */
export default function LeaveReportDialog({
  state,
  today,
  onClose,
}: {
  state: WorkspaceState
  today: string
  onClose: () => void
}) {
  const org = state.model.organization
  const [printOpen, setPrintOpen] = useState(false)

  const report = useMemo(() => buildLeaveReport(state, today.slice(0, 7)), [state, today])
  const period = `${report.months[0]} to ${report.months[report.months.length - 1]}`

  const downloadXlsx = async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()

    const brand = (ws: import('exceljs').Worksheet, columns: string[]) => {
      ws.addRow([org.name])
      ws.getRow(1).font = { bold: true, size: 14 }
      ws.addRow([`Leave report — ${period}, generated ${today}`])
      ws.addRow([])
      const header = ws.addRow(columns)
      header.font = { bold: true }
      return ws
    }

    const taken = brand(wb.addWorksheet('Taken'), ['Person', ...report.months, 'Total'])
    for (const r of report.rows) {
      taken.addRow([r.person, ...report.months.map((m) => r.byMonth[m]), r.total])
    }
    if (report.rows.length === 0) taken.addRow([`No approved leave between ${period}.`])
    taken.columns.forEach((c) => { c.width = 14 })

    const pending = brand(wb.addWorksheet('Pending'), ['Person', 'Start', 'End'])
    if (report.pending.length === 0) pending.addRow(['No requests awaiting a decision.'])
    for (const p of report.pending) pending.addRow([p.person, p.startDate, p.endDate])
    pending.columns.forEach((c) => { c.width = 18 })

    const logo = org.logoDataUri
    const ext = logo?.match(/^data:image\/(png|jpeg|gif);base64,/)?.[1]
    if (logo && ext) {
      const imageId = wb.addImage({
        base64: logo.slice(logo.indexOf(',') + 1),
        extension: ext as 'png' | 'jpeg' | 'gif',
      })
      taken.addImage(imageId, { tl: { col: report.months.length + 2, row: 0 }, ext: { width: 120, height: 40 } })
    }

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leave-report-${report.months[0]}-to-${report.months[report.months.length - 1]}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (printOpen) {
    return (
      <LeaveReportView report={report} org={org} generated={today} onClose={() => setPrintOpen(false)} />
    )
  }

  return (
    <div className="modal-scrim" role="dialog" aria-label="Leave report">
      <div className="modal" style={{ maxWidth: 720 }}>
        <h3>Leave report</h3>
        <p className="cfg-note">
          Working days taken, month on month, trailing 6 months ({period}) — approved leave
          only, holiday-aware. No reasons and no leave balances appear anywhere in this report.
        </p>

        {report.rows.length === 0 ? (
          <p className="cfg-note">No approved leave between {period}.</p>
        ) : (
          <div style={{ maxHeight: 260, overflow: 'auto', margin: '12px 0' }}>
            <table className="pack-table">
              <thead>
                <tr>
                  <th>Person</th>
                  {report.months.map((m) => (
                    <th key={m}>{m}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.personId ?? r.person}>
                    <td>{r.person}</td>
                    {report.months.map((m) => (
                      <td key={m}>{r.byMonth[m]}</td>
                    ))}
                    <td>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report.pending.length > 0 && (
          <div style={{ margin: '8px 0' }}>
            <strong style={{ fontSize: 13 }}>Pending — awaiting a decision</strong>
            <ul style={{ margin: '4px 0 0 18px', fontSize: 12.5 }}>
              {report.pending.map((p, i) => (
                <li key={i}>
                  {p.person}: {p.startDate} to {p.endDate}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={() => setPrintOpen(true)}>
            Print / Save as PDF
          </button>
          <button className="btn primary" disabled={report.rows.length === 0 && report.pending.length === 0} onClick={downloadXlsx}>
            Download .xlsx
          </button>
        </div>
      </div>
    </div>
  )
}
