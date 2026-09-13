'use client'

import { useMemo, useRef } from 'react'
import { useOverlay } from './useOverlay'
import { formatIso } from '@/lib/dates'
import type { ClientMilestoneLine } from '@/lib/clientBoundary'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * A client's own contracted schedule — name, planned/delivered/accepted dates, and status
 * only (docs/plans/2026-09-13-client-milestones-design.md, Design 3 of the business-process
 * review). `CLIENT_GROUPS`-only, with no internal equivalent: an internal reader already has
 * `CommercialPanel`'s full milestone view, a strict superset of this one.
 *
 * Reads `state.clientMilestones` — the narrow projection `clientView()` computes for this
 * reader alone — never `state.milestones`, which is zeroed for a client seat. Everything here
 * is presentation over fields `ClientMilestoneLine` already decided are safe to carry; this
 * component invents no new disclosure, it only words what survived.
 */
function statusOf(m: ClientMilestoneLine): { icon: string; label: string } {
  if (m.acceptance === 'Rejected') return { icon: '✗', label: 'Returned for rework' }
  if (m.acceptance === 'Accepted') {
    return { icon: '✓', label: `Delivered${m.acceptedAt ? ` ${formatIso(m.acceptedAt)}` : ''}` }
  }
  if (m.delivery === 'Delivered') return { icon: '●', label: 'Delivered · awaiting review' }
  const due = m.plannedDate ? ` · due ${formatIso(m.plannedDate)}` : ''
  if (m.delivery === 'InProgress') return { icon: '●', label: `In progress${due}` }
  return { icon: '○', label: `Planned${due}` }
}

export default function ClientMilestonesPanel({
  state,
  docked = false,
  onClose,
}: {
  state: WorkspaceState
  docked?: boolean
  onClose?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)

  const rows = useMemo(
    () =>
      Object.values(state.clientMilestones).sort((a, b) =>
        a.sowReference === b.sowReference ? a.sequence - b.sequence : a.sowReference.localeCompare(b.sowReference),
      ),
    [state.clientMilestones],
  )

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="milestones-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="milestones-title">Milestones</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close milestones">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">What was promised, when it lands, and where it stands.</div>
        </header>

        <div className="evi-list">
          {rows.length === 0 ? (
            <p className="evi-empty">No milestone is recorded yet.</p>
          ) : (
            <table className="cfg-table est-table">
              <thead>
                <tr>
                  <th />
                  <th>Milestone</th>
                  <th>SOW</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const { icon, label } = statusOf(m)
                  return (
                    <tr key={m.id}>
                      <td className="mono">{icon}</td>
                      <td>{m.name}</td>
                      <td>{m.sowReference}</td>
                      <td>{label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  )
}
