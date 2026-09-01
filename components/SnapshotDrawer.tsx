'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import { issuesUnder } from '@/lib/engagement'
import { describeCost, sowCostOf } from '@/lib/rates'
import { formatIso } from '@/lib/dates'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * View and compare a project or engagement's past snapshots against the plan as it stands now.
 * See docs/plans/2026-09-01-project-snapshot-design.md.
 *
 * Same structural shape as `ReplanningDrawer` — a target, no pre-picked row, everything computed
 * from real state. Cost is gated by `rate.view` exactly as `CommercialPanel` gates its own —
 * a viewer who cannot see current cost does not see a past figure either, whatever was captured.
 */
export default function SnapshotDrawer({
  state,
  actor,
  nodeId,
  nodeName,
  onClose,
}: {
  state: WorkspaceState
  actor: Actor
  nodeId: string
  nodeName: string
  onClose: () => void
}) {
  const snapshots = useMemo(
    () =>
      Object.values(state.snapshots)
        .filter((s) => s.nodeId === nodeId && !s.deletedAt)
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
    [state.snapshots, nodeId],
  )
  const [selectedId, setSelectedId] = useState<string | null>(snapshots[0]?.id ?? null)
  const selected = snapshots.find((s) => s.id === selectedId) ?? snapshots[0]

  const mayViewRate = can(state.model, actor, 'rate.view')
  const currentCost = useMemo(() => {
    if (!mayViewRate.allowed) return null
    const ids = issuesUnder(state, nodeId).map((i) => i.id)
    return sowCostOf(Object.values(state.rates), ids, state.timeEntries)
  }, [mayViewRate.allowed, state, nodeId])

  return (
    <div className="rp-drawer">
      <header className="evi-head-top">
        <h2>{nodeName}’s snapshots</h2>
        <button className="btn ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {snapshots.length === 0 ? (
        <p className="panel-note">No snapshots taken yet.</p>
      ) : (
        <>
          <p className="evi-sub sentence">
            <select
              aria-label="Choose a snapshot"
              value={selected?.id}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatIso(s.takenAt)} — by {s.takenBy}
                </option>
              ))}
            </select>
          </p>

          {selected && (
            <>
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Planned then</th>
                    <th>Planned now</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.entries.map((e) => {
                    const now = state.issues[e.issueId]
                    const moved = now && (now.plannedStart !== e.plannedStart || now.plannedEnd !== e.plannedEnd)
                    return (
                      <tr key={e.issueId}>
                        <td>{e.subject}</td>
                        <td className="mono">
                          {formatIso(e.plannedStart)} → {formatIso(e.plannedEnd)}
                        </td>
                        <td className="mono">
                          {now
                            ? `${formatIso(now.plannedStart)} → ${formatIso(now.plannedEnd)}${moved ? ' — moved' : ''}`
                            : 'no longer in this plan'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {mayViewRate.allowed ? (
                <p className="evi-sub sentence">
                  <strong>Then:</strong> {selected.cost ? describeCost(selected.cost) : 'nothing to price at the time.'}
                  <br />
                  <strong>Now:</strong> {currentCost ? describeCost(currentCost) : 'nothing to price.'}
                </p>
              ) : (
                <p className="panel-note">Cost is not shown without rate.view.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
