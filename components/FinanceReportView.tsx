import type { FinanceReport } from '@/lib/reports/finance'
import type { OrganizationIdentity } from '@/lib/config'
import ReportHeader from './reports/ReportHeader'

/**
 * The print half of the finance report — the same `.pack-scrim`/`.pack-page` pattern as
 * `ClientPackView`: an ordinary screen with a print stylesheet, "download" being the
 * browser's own print-to-PDF. Renders the SAME `FinanceReport` object the dialog previewed;
 * it takes the report as a prop precisely so it cannot rebuild and disagree.
 */
export default function FinanceReportView({
  report,
  org,
  generated,
  onClose,
}: {
  report: FinanceReport
  org: OrganizationIdentity
  generated: string
  onClose: () => void
}) {
  return (
    <div className="pack-scrim" role="dialog" aria-label="Finance timesheet report">
      <div className="pack-toolbar">
        <span>Finance timesheet report</span>
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
          title="Finance timesheet report"
          period={`${report.period.from} – ${report.period.to}`}
          generated={generated}
        />
        <h1>Approved hours</h1>

        {report.empty ? (
          <p className="pack-empty">
            No approved hours between {report.period.from} and {report.period.to}.
          </p>
        ) : (
          <section>
            <h2>Summary</h2>
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
          </section>
        )}

        <section>
          <h2>Exceptions</h2>
          {report.exceptions.length === 0 ? (
            <p className="pack-empty">Every week in range is approved.</p>
          ) : (
            <table className="pack-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Week</th>
                  <th>Status</th>
                  <th>Hours held back</th>
                </tr>
              </thead>
              <tbody>
                {report.exceptions.map((x, i) => (
                  <tr key={i}>
                    <td>{x.person}</td>
                    <td>{x.week}</td>
                    <td>{x.status}</td>
                    <td>{x.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {!report.empty && (
          <section>
            <h2>Daily detail</h2>
            <table className="pack-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Person</th>
                  <th>Work item</th>
                  <th>Project</th>
                  <th>Activity</th>
                  <th>Billable</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {report.dailyDetail.map((d, i) => (
                  <tr key={i}>
                    <td>{d.date}</td>
                    <td>{d.person}</td>
                    <td>{d.issueId}</td>
                    <td>{d.project}</td>
                    <td>{d.activity}</td>
                    <td>{d.billable ? 'Yes' : 'No'}</td>
                    <td>{d.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="pack-footer">
          Approved hours only — a week that is not approved is listed above, never silently
          included. No rates or amounts appear anywhere in this report.
        </p>
      </div>
    </div>
  )
}
