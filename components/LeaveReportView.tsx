import type { LeaveReport } from '@/lib/reports/leave'
import type { OrganizationIdentity } from '@/lib/config'
import ReportHeader from './reports/ReportHeader'

/**
 * The print half of the leave report — the same `.pack-scrim`/`.pack-page` pattern as
 * `FinanceReportView`. Renders the SAME `LeaveReport` object the dialog previewed; takes it as
 * a prop so it cannot rebuild and disagree. No reason or note text exists on the report object
 * at all (lib/reports/leave.ts), so there is nothing here that could accidentally render one.
 */
export default function LeaveReportView({
  report,
  org,
  generated,
  onClose,
}: {
  report: LeaveReport
  org: OrganizationIdentity
  generated: string
  onClose: () => void
}) {
  return (
    <div className="pack-scrim" role="dialog" aria-label="Leave report">
      <div className="pack-toolbar">
        <span>Leave report</span>
        <span className="grow" />
        <button className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="pack-page">
        <ReportHeader
          org={org}
          title="Leave report"
          period={`${report.months[0]} – ${report.months[report.months.length - 1]}`}
          generated={generated}
        />
        <h1>Working days taken, month on month</h1>

        {report.rows.length === 0 ? (
          <p className="pack-empty">No approved leave in this window.</p>
        ) : (
          <section>
            <h2>Taken</h2>
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
          </section>
        )}

        <section>
          <h2>Pending</h2>
          {report.pending.length === 0 ? (
            <p className="pack-empty">No requests awaiting a decision.</p>
          ) : (
            <table className="pack-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {report.pending.map((p, i) => (
                  <tr key={i}>
                    <td>{p.person}</td>
                    <td>{p.startDate}</td>
                    <td>{p.endDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="pack-footer">
          Working days taken — approved leave only, holiday-aware. No reasons and no leave
          balances appear anywhere in this report.
        </p>
      </div>
    </div>
  )
}
