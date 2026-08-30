import { useMemo, useState } from 'react'
import type { WorkspaceState } from '@/lib/workspace'
import { buildFinanceReport } from '@/lib/reports/finance'
import { weekStarting, weekLabel } from '@/lib/timesheet'
import FinanceReportView from './FinanceReportView'

/**
 * "Finance timesheet…" off the Export menu — the user's "selected or weekly and month"
 * period pickers, a preview of exactly what will leave, and the two outputs. One
 * `buildFinanceReport` call (the memo below) feeds the preview, the workbook AND the print
 * view, so the file and the screen cannot disagree.
 *
 * exceljs is imported dynamically inside the download handler — a static import would put a
 * spreadsheet engine into the main chunk for every visitor who never exports anything.
 */

const addDaysIso = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function FinanceReportDialog({
  state,
  today,
  onClose,
}: {
  state: WorkspaceState
  today: string
  onClose: () => void
}) {
  const org = state.model.organization
  const [mode, setMode] = useState<'week' | 'month' | 'custom'>('week')
  const [week, setWeek] = useState(() => weekStarting(today))
  const [month, setMonth] = useState(today.slice(0, 7))
  const [from, setFrom] = useState(() => weekStarting(today))
  const [to, setTo] = useState(today)
  const [printOpen, setPrintOpen] = useState(false)

  const weekChoices = useMemo(() => {
    const current = weekStarting(today)
    return Array.from({ length: 12 }, (_, i) => addDaysIso(current, -7 * i))
  }, [today])

  const period = useMemo(() => {
    if (mode === 'week') return { from: week, to: addDaysIso(week, 6) }
    if (mode === 'month') {
      const [y, m] = month.split('-').map(Number)
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
    }
    return { from, to }
  }, [mode, week, month, from, to])

  const badRange = period.from > period.to
  const report = useMemo(
    () => (badRange ? null : buildFinanceReport(state, period.from, period.to)),
    [state, period.from, period.to, badRange],
  )

  const downloadXlsx = async () => {
    if (!report) return
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()

    const brand = (ws: import('exceljs').Worksheet, columns: string[]) => {
      ws.addRow([org.name])
      ws.getRow(1).font = { bold: true, size: 14 }
      ws.addRow([`Finance timesheet report — ${period.from} to ${period.to}, generated ${today}`])
      ws.addRow([])
      const header = ws.addRow(columns)
      header.font = { bold: true }
      return ws
    }

    const summary = brand(wb.addWorksheet('Summary'), [
      'Client', 'Engagement', 'Project', 'Person', 'Billable', 'Non-billable', 'Total',
    ])
    for (const r of report.summary) {
      summary.addRow([r.client, r.engagement, r.project, r.person, r.billable, r.nonBillable, r.total])
    }
    if (report.empty) summary.addRow([`No approved hours between ${period.from} and ${period.to}.`])
    summary.columns.forEach((c) => { c.width = 18 })

    const detail = brand(wb.addWorksheet('Daily detail'), [
      'Date', 'Person', 'Work item', 'Project', 'Activity', 'Billable', 'Hours',
    ])
    for (const d of report.dailyDetail) {
      detail.addRow([d.date, d.person, d.issueId, d.project, d.activity, d.billable ? 'Yes' : 'No', d.hours])
    }
    detail.columns.forEach((c) => { c.width = 16 })

    // The exceptions sheet exists even when empty — "every week is approved" is a finding.
    const exceptions = brand(wb.addWorksheet('Exceptions'), ['Person', 'Week', 'Status', 'Hours held back'])
    if (report.exceptions.length === 0) exceptions.addRow(['Every week in range is approved.'])
    for (const x of report.exceptions) exceptions.addRow([x.person, x.week, x.status, x.hours])
    exceptions.columns.forEach((c) => { c.width = 24 })

    // exceljs embeds png/jpeg/gif; any other configured logo type just means no image here.
    const logo = org.logoDataUri
    const ext = logo?.match(/^data:image\/(png|jpeg|gif);base64,/)?.[1]
    if (logo && ext) {
      const imageId = wb.addImage({
        base64: logo.slice(logo.indexOf(',') + 1),
        extension: ext as 'png' | 'jpeg' | 'gif',
      })
      summary.addImage(imageId, { tl: { col: 5, row: 0 }, ext: { width: 120, height: 40 } })
    }

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finance-timesheet-${period.from}-to-${period.to}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (printOpen && report) {
    return (
      <FinanceReportView report={report} org={org} generated={today} onClose={() => setPrintOpen(false)} />
    )
  }

  return (
    <div className="modal-scrim" role="dialog" aria-label="Finance timesheet report">
      <div className="modal" style={{ maxWidth: 720 }}>
        <h3>Finance timesheet report</h3>
        <p className="cfg-note">
          Approved hours for a chosen period, ready to hand to finance. Weeks that are not
          approved are listed as exceptions, never silently included — and no rates or amounts
          appear anywhere.
        </p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="cfg-fld">
            <span>Period</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="week">A week</option>
              <option value="month">A calendar month</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {mode === 'week' && (
            <label className="cfg-fld">
              <span>Week</span>
              <select value={week} onChange={(e) => setWeek(e.target.value)}>
                {weekChoices.map((w) => (
                  <option key={w} value={w}>
                    {weekLabel(w)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === 'month' && (
            <label className="cfg-fld">
              <span>Month</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          )}
          {mode === 'custom' && (
            <>
              <label className="cfg-fld">
                <span>From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="cfg-fld">
                <span>To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>

        {badRange ? (
          <p className="cfg-note">The range ends before it starts.</p>
        ) : report ? (
          <>
            {report.empty ? (
              <p className="cfg-note">
                No approved hours between {period.from} and {period.to}.
                {report.exceptions.length > 0 &&
                  ` ${report.exceptions.length} person-week(s) have hours awaiting submission or decision — see below.`}
              </p>
            ) : (
              <div style={{ maxHeight: 260, overflow: 'auto', margin: '12px 0' }}>
                <table className="pack-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Engagement</th>
                      <th>Project</th>
                      <th>Person</th>
                      <th>Billable</th>
                      <th>Non-billable</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary.map((r, i) => (
                      <tr key={i}>
                        <td>{r.client}</td>
                        <td>{r.engagement}</td>
                        <td>{r.project}</td>
                        <td>{r.person}</td>
                        <td>{r.billable}</td>
                        <td>{r.nonBillable}</td>
                        <td>{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.exceptions.length > 0 && (
              <div style={{ margin: '8px 0' }}>
                <strong style={{ fontSize: 13 }}>Not included — awaiting timesheets</strong>
                <ul style={{ margin: '4px 0 0 18px', fontSize: 12.5 }}>
                  {report.exceptions.map((x, i) => (
                    <li key={i}>
                      {x.person}, {x.week}: {x.status} ({x.hours}h)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={!report} onClick={() => setPrintOpen(true)}>
            Print / Save as PDF
          </button>
          <button className="btn primary" disabled={!report || report.empty} onClick={downloadXlsx}>
            Download .xlsx
          </button>
        </div>
      </div>
    </div>
  )
}
