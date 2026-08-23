'use client'

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import { formatIso } from '@/lib/dates'
import type { SlaPlan } from '@/lib/sla'

/**
 * What applying the SLA policy would do, before it does it.
 *
 * This is the only bulk write in the application, and it converts a derived value into a
 * recorded one across many records at once — the two things this codebase is most careful
 * about. So the confirm step is not politeness: it is the point at which a person takes
 * responsibility for dates the policy computed.
 *
 * The panel leads with the consequence rather than the count. "This will set 147 dates" is
 * reassuring and useless; "134 of them are already in the past, and those records will report
 * as overdue immediately" is the thing somebody needs to agree to.
 */
export default function SlaPlanPanel({
  plan,
  scope,
  today,
  onApply,
  onClose,
}: {
  plan: SlaPlan
  scope: string
  today: string
  onApply: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, true, onClose)

  const { rows, skipped, bySeverity, past, policy } = plan
  const sample = rows.slice(0, 12)

  const body = (
    // Pointer-only dismissal; Escape via useOverlay is the keyboard path, and the target
    // guard means clicks inside the dialog never bubble into a close.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal is Escape (useOverlay)
    <div
        className="modal-scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
      <div
        className="modal sla-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sla-title"
      >
        <div className="modal-head">
          <span id="sla-title">Set due dates from the SLA policy</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="panel-note">
            The policy allows <b>{policy.High}</b> working days for High, <b>{policy.Medium}</b> for
            Medium and <b>{policy.Low}</b> for Low, counted from the date each issue was raised.
            Scope is what you are looking at: <b>{scope}</b>.
          </div>

          {rows.length === 0 ? (
            <div className="cfg-empty">
              Nothing to set. Every open record in scope either already has a due date or has no
              raised date to count from.
            </div>
          ) : (
            <>
              <dl className="kv sla-summary">
                <dt>Dates to set</dt>
                <dd>
                  <b>{rows.length}</b> open records — High {bySeverity.High} · Medium{' '}
                  {bySeverity.Medium} · Low {bySeverity.Low}
                </dd>
                <dt>Already past</dt>
                <dd className={past ? 'hl-overdue' : ''}>
                  <b>{past}</b>
                  {past > 0 && (
                    <>
                      {' '}— these were raised long enough ago that the policy&rsquo;s target has
                      already passed. They will report as overdue as soon as this is applied.
                      That is what the policy says about them; it was simply never written down.
                    </>
                  )}
                </dd>
                <dt>Left alone</dt>
                <dd>
                  {skipped.alreadyScheduled} already have a due date · {skipped.closed} closed
                  {skipped.noRaisedDate > 0 && ` · ${skipped.noRaisedDate} with no raised date`}
                  <span className="prov">
                    {' '}
                    · an existing due date is a commitment somebody made and is never overwritten
                  </span>
                </dd>
              </dl>

              <div className="sla-list-head">
                Soonest target first{rows.length > sample.length && ` — showing ${sample.length} of ${rows.length}`}
              </div>
              <table className="cfg-table sla-table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Severity</th>
                    <th>Raised</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.id}</td>
                      <td>{r.severity}</td>
                      <td className="mono">{formatIso(r.raised)}</td>
                      <td className={`mono${r.alreadyPast ? ' hl-overdue' : ''}`}>
                        {formatIso(r.target)}
                        {r.alreadyPast && <span className="prov"> · past</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="panel-note">
                Each date is recorded with the arithmetic that produced it, so it can always be
                told apart from one somebody set by hand. Applying is not reversible in bulk —
                individual dates can be changed afterwards like any other.
              </p>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={rows.length === 0} onClick={onApply}>
            Set {rows.length} due date{rows.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
