'use client'

import { useState } from 'react'
import { replanningFor } from '@/lib/replanning'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Automatic Resource Replanning — decision support, not an invented fix.
 * See docs/plans/2026-08-31-resource-replanning-design.md.
 *
 * No row is pre-selected as "the one to change" — the deficit and every overlapping
 * allocation's own hours are shown side by side, workspace-wide for this person, and the
 * person looking at it decides. Apply and Release both go through the real reducer.
 */
export default function ReplanningDrawer({
  state,
  today,
  person,
  personId,
  onApplyAllocation,
  onReleaseAllocation,
  onClose,
}: {
  state: WorkspaceState
  today: string
  person: string
  personId: string | null
  /** Returns false when the reducer refused — the row's own input stays as typed. */
  onApplyAllocation: (allocationId: string, percentage: number) => boolean
  onReleaseAllocation: (allocationId: string) => boolean
  onClose: () => void
}) {
  const view = replanningFor(state, person, personId, today)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  return (
    <div className="rp-drawer">
      <header className="evi-head-top">
        <h2>{person}’s capacity</h2>
        <button className="btn ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {!view ? (
        <p className="panel-note">
          {person} is no longer over capacity for {today} → +28 days — nothing to replan.
        </p>
      ) : (
        <>
          <p className="evi-sub sentence">
            {view.deficitHours}h more committed than available, {view.windowFrom} → {view.windowTo}.
            No allocation below is picked as the one to change — that stays a decision for
            whoever staffs {person}.
          </p>

          <table className="cfg-table est-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Current %</th>
                <th>Hours in window</th>
                <th>New %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.allocations.map((row) => {
                const draft = drafts[row.id] ?? String(row.percentage)
                const parsed = Number(draft)
                const validPercentage = Number.isFinite(parsed) && parsed > 0 && parsed <= 100
                const changed = validPercentage && parsed !== row.percentage
                return (
                  <tr key={row.id}>
                    <td>{row.projectName}</td>
                    <td className="mono">{row.percentage}%</td>
                    <td className="mono">{row.hoursInWindow}h</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        className="fld-input"
                        value={draft}
                        aria-label={`New percentage for ${row.projectName}`}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        disabled={!changed}
                        title={changed ? `Reduce to ${parsed}%` : 'Type a different percentage first'}
                        onClick={() => {
                          if (onApplyAllocation(row.id, parsed)) {
                            setDrafts((prev) => {
                              const next = { ...prev }
                              delete next[row.id]
                              return next
                            })
                          }
                        }}
                      >
                        Apply
                      </button>{' '}
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => onReleaseAllocation(row.id)}
                      >
                        Release
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
