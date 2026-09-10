import type { WeeklyClientPack, MonthlyGovernancePack } from '@/lib/reports/clientPack'
import type { ConcernKind, OrganizationIdentity } from '@/lib/config'
import { CONCERN_LABEL, scoreTerms } from '@/lib/portfolio'
import ReportHeader from './reports/ReportHeader'

/**
 * Why a term is left out of a client's score, in the client's own words. `capacity` is the one
 * the pack builder excludes today (`CLIENT_EXCLUDED` in lib/reports/clientPack.ts); any other
 * kind falls back to naming itself, so a new exclusion can never print as nothing.
 */
const EXCLUDED_WHY: Partial<Record<ConcernKind, string>> = {
  capacity: 'over-commitment is not counted — staffing is not shown to clients',
}
function excludedWords(kinds: ConcernKind[]): string {
  return kinds.map((k) => EXCLUDED_WHY[k] ?? `${CONCERN_LABEL[k].toLowerCase()} is not counted`).join('; ')
}

/**
 * A print-ready screen for a weekly or monthly client pack — see
 * `docs/plans/2026-08-25-client-pack-design.md`. No PDF library, no headless browser: this is an
 * ordinary screen with a print stylesheet, and "download" is the browser's own print-to-PDF.
 *
 * Mounted as a full-screen overlay over the workspace (`.pack-scrim`), not the narrow `.modal`
 * used for dialogs elsewhere — a document this long needs the width, and `@media print` hides
 * everything outside `.pack-page` so only the report itself is ever printed.
 */

type Pack = WeeklyClientPack | MonthlyGovernancePack
function isWeekly(p: Pack): p is WeeklyClientPack {
  return 'lines' in p
}

export default function ClientPackView({
  pack,
  org,
  onClose,
}: {
  pack: Pack
  org: OrganizationIdentity
  onClose: () => void
}) {
  const weekly = isWeekly(pack)
  const title = weekly ? 'Weekly client pack' : 'Monthly governance pack'

  return (
    <div className="pack-scrim" role="dialog" aria-label={title}>
      <div className="pack-toolbar">
        <span>{title}</span>
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
          title={title}
          period={`${pack.window.from} – ${pack.window.to}`}
          generated={pack.asOf}
        />
        <h1>{title}</h1>
        <div className="pack-meta">
          <div>{pack.client}</div>
          <div>As of {pack.asOf}</div>
          <div>
            {weekly ? 'Activity' : 'Movement'} {pack.window.from} – {pack.window.to}
          </div>
        </div>

        {/*
         * The disclosure line — how many of the client's own records are actually shown here,
         * against how many exist. Stated plainly rather than left implicit: see the design
         * document's own reasoning for why a client reading "3 open issues" needs to know
         * whether that means a quiet engagement or an unmarked backlog.
         */}
        <p className="pack-disclosure">
          {pack.disclosure.shown} of {pack.disclosure.total} records for {pack.client} are shown
          here; the rest are marked internal.
        </p>

        <section>
          <h2>Position</h2>
          <div className="pack-position">
            <span>
              Open {pack.position.open} of {pack.position.total} ({pack.position.closed} closed)
            </span>
            <span>
              High {pack.position.high} · Medium {pack.position.medium} · Low {pack.position.low}
            </span>
          </div>
        </section>

        {pack.health.engagements.length > 0 && (
          <section>
            <h2>Health</h2>
            <table className="pack-table">
              <thead>
                <tr>
                  <th>Engagement</th>
                  <th>Score</th>
                  <th>Band</th>
                  <th>How it adds up</th>
                </tr>
              </thead>
              <tbody>
                {pack.health.engagements.map((e) => (
                  <tr key={e.nodeId}>
                    <td>{e.name}</td>
                    <td>{e.score.value}</td>
                    <td>{e.score.band}</td>
                    <td>{scoreTerms(e.score) || 'nothing counted'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* The score's own disclosure, beside it: what the sum is and what it leaves out.
                A number a client cannot reproduce from the column beside it is the hidden
                sentence the design forbids. */}
            <p className="pack-disclosure">
              A score is each concern&rsquo;s count times its weight, added; the weights are
              {' '}{org.name || 'the firm'}&rsquo;s own configuration and are the second number
              in each term.
              {pack.health.excluded.length > 0 && <> In this pack {excludedWords(pack.health.excluded)}.</>}
            </p>
          </section>
        )}

        <section>
          <h2>Progress</h2>
          <div className="pack-position">
            <span>
              Closed {pack.progress.periodDeltas.closed} · Newly raised{' '}
              {pack.progress.periodDeltas.raised} this {weekly ? 'week' : 'month'} (from record
              dates)
            </span>
            <span>
              {pack.progress.schedule.pctComplete !== null
                ? `${pack.progress.schedule.pctComplete}% complete`
                : 'Completion not measurable'}{' '}
              · On track {pack.progress.schedule.onTrack} · Overdue {pack.progress.schedule.overdue}
              {pack.progress.schedule.projectedFinish
                ? ` · Projected finish ${pack.progress.schedule.projectedFinish}`
                : ''}
            </span>
          </div>
        </section>

        {weekly ? (
          <section>
            <h2>Activity this week</h2>
            {pack.lines.length === 0 ? (
              <p className="pack-empty">Nothing shown here had activity in this window.</p>
            ) : (
              <table className="pack-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Subject</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Severity</th>
                    <th>Due</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.id}</td>
                      <td>{l.subject}</td>
                      <td>{l.owner}</td>
                      <td>{l.status}</td>
                      <td>{l.severity}</td>
                      <td>{l.due}</td>
                      <td>{l.lastActivity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ) : (
          <section>
            <h2>Movement this month</h2>
            {!pack.movement.trailAvailable ? (
              <p className="pack-empty">
                Nothing recorded. Movement is read from the audit trail, which is capped and, with
                no database configured, held in one browser — an empty section here means nothing
                was recorded in this trail, not that nothing happened.
              </p>
            ) : (
              <p>
                Raised {pack.movement.raised} · Resolved {pack.movement.resolved}
              </p>
            )}
          </section>
        )}

        {!weekly && pack.milestones.length > 0 && (
          <section>
            <h2>Payment schedule</h2>
            <table className="pack-table">
              <thead>
                <tr>
                  <th>SOW</th>
                  <th>Milestone</th>
                  <th>Planned</th>
                  <th>Delivery</th>
                  <th>Acceptance</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {pack.milestones.map((m) => (
                  <tr key={m.id}>
                    <td>{m.sowReference || m.sowTitle}</td>
                    <td>{m.name}</td>
                    <td>{m.plannedDate ?? '—'}</td>
                    <td>
                      {m.delivery}
                      {m.deliveredAt ? ` (${m.deliveredAt})` : ''}
                    </td>
                    <td>
                      {m.acceptance}
                      {m.acceptedAt ? ` (${m.acceptedAt})` : ''}
                    </td>
                    <td>
                      {m.basis === 'amount'
                        ? m.amount !== null
                          ? `${m.currency} ${m.amount.toLocaleString()}`
                          : '—'
                        : m.percentage !== null
                          ? `${m.percentage}%`
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="pack-footer">
          Generated by Axiomate from {pack.disclosure.total} records for {pack.client}. Every
          figure is counted from the records or the audit trail; none is estimated.
        </p>
      </div>
    </div>
  )
}
