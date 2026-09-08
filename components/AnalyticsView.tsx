'use client'

import { useMemo, useRef } from 'react'
import { useOverlay } from './useOverlay'
import { byAgeBucket, byClient, byOwner, bySeverityAndStatus } from '@/lib/analytics'
import { holidaySetOf } from '@/lib/config'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Firm-wide cross-tabs over the live register.
 *
 * Not a trend over time — see `docs/plans/2026-09-07-analytics-design.md` for why: nothing in
 * this codebase captures a period snapshot on a schedule, so a chart of a metric over time would
 * be invented rather than read. Every count here is computed against the register as it stands
 * right now, the same discipline `lib/portfolio.ts` already applies to its own concern counts —
 * no score, no colour-coded traffic light, a number a reader can go and check.
 */
export default function AnalyticsView({
  state,
  today,
  onClose,
  docked = false,
}: {
  state: WorkspaceState
  today: string
  onClose?: () => void
  /** A first-class view in the main pane: no scrim, no trap, no Close — see MyWorkPanel. */
  docked?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)

  const severityStatus = useMemo(() => bySeverityAndStatus(state.issues), [state.issues])
  const clients = useMemo(() => byClient(state.issues), [state.issues])
  const ageBuckets = useMemo(
    () => byAgeBucket(state.issues, today, holidaySetOf(state.model)),
    [state.issues, today, state.model.holidays],
  )
  const owners = useMemo(() => byOwner(state.issues), [state.issues])

  return (
    <>
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="analytics-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="analytics-title">Analytics</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close analytics">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">
            Every count below is read off the register as it stands right now — refresh the page
            for a current figure, not a cached one.
          </div>
        </header>

        <div className="evi-list">
          <section className="comm-changes">
            <h5 className="est-h">By severity and status</h5>
            {severityStatus.length === 0 ? (
              <p className="evi-empty">No live issues.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {severityStatus.map((c) => (
                    <tr key={`${c.severity}-${c.status}`}>
                      <td>{c.severity}</td>
                      <td>{c.status}</td>
                      <td className="mono">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="comm-changes">
            <h5 className="est-h">By client — worst first</h5>
            {clients.length === 0 ? (
              <p className="evi-empty">No open issues against any client.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Open</th>
                    <th>Open High</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.client}>
                      <td>{c.client}</td>
                      <td className="mono">{c.open}</td>
                      <td className="mono">{c.openHigh}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="comm-changes">
            <h5 className="est-h">Open issues by age</h5>
            <p className="est-block-note">Working days since raised. Bucketed, not averaged — an
              average hides the long tail this exists to show.</p>
            <table className="cfg-table est-table">
              <thead>
                <tr>
                  <th>Working days since raised</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {ageBuckets.map((b) => (
                  <tr key={b.bucket}>
                    <td>{b.bucket}</td>
                    <td className="mono">{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="comm-changes">
            <h5 className="est-h">Open issues by owner — busiest first</h5>
            {owners.length === 0 ? (
              <p className="evi-empty">No open issues.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((o) => (
                    <tr key={o.owner}>
                      <td>{o.owner}</td>
                      <td className="mono">{o.open}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}
