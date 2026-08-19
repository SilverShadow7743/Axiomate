'use client'

import { useRef, useState } from 'react'
import { boardLanes, describeBoard, dropOutcome } from '@/lib/board'
import type { StatusPolicy } from '@/lib/statusPolicy'
import type { IssueStatus, ScheduleRow } from '@/lib/types'

/**
 * The register as lanes, and a drag that is the grid’s own lever held sideways.
 *
 * A drop does not dispatch anything itself. It runs `dropOutcome` — `checkTransition` as a
 * pre-check, so an illegal route or missing evidence refuses at the lane in the policy’s own
 * words — and then collects a reason and hands everything to `onCommitStatus`, which is
 * `commitCell`’s status arm: the same funnel every inline edit passes through. That funnel
 * requires a reason for EVERY status change, not only the closing ones, and it holds even if a
 * caller forgets — which is why the board goes through it rather than dispatching updateIssue
 * directly. Nothing moves here that could not move there, with the same ceremony.
 */
export default function BoardView({
  rows,
  policy,
  hasEvidence,
  selectedId,
  onSelect,
  onCommitStatus,
}: {
  rows: ScheduleRow[]
  policy: StatusPolicy
  /** Whether the issue has at least one live evidence item — the same test IssueFocus applies. */
  hasEvidence: (rowId: string) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
  /** commitCell(rowId, 'status', status, reason) — returns false when the funnel refuses. */
  onCommitStatus: (rowId: string, status: IssueStatus, reason: string) => boolean
}) {
  const lanes = boardLanes(rows)
  const dragId = useRef<string | null>(null)

  /** A refusal renders at the lane it happened on, in the policy’s words, briefly. */
  const [refusal, setRefusal] = useState<{ lane: IssueStatus; message: string } | null>(null)
  /** A legal drop collecting its reason. `note` carries the policy’s message when it had one. */
  const [asking, setAsking] = useState<{ rowId: string; to: IssueStatus; note: string | null } | null>(null)
  const [reason, setReason] = useState('')

  const drop = (to: IssueStatus) => {
    const id = dragId.current
    dragId.current = null
    if (!id) return
    const row = rows.find((r) => r.id === id)
    if (!row || row.status === to) return

    const outcome = dropOutcome(policy, row, to, hasEvidence(id))
    if (outcome.kind === 'refused') {
      setRefusal({ lane: to, message: outcome.message })
      return
    }
    // Legal — but every status change carries a reason, so both 'ok' and 'ask' collect one.
    setRefusal(null)
    setReason('')
    setAsking({ rowId: id, to, note: outcome.kind === 'ask' ? outcome.message : null })
  }

  const submitReason = () => {
    if (!asking || !reason.trim()) return
    const ok = onCommitStatus(asking.rowId, asking.to, reason.trim())
    // On refusal the funnel has already notified; keep the dialog so the reason is not lost.
    if (ok) setAsking(null)
  }

  return (
    <div className="board" role="region" aria-label="Status board">
      <div className="board-sub sentence">{describeBoard(lanes)}</div>
      <div className="board-lanes">
        {lanes.map((lane) => (
          <section
            key={lane.status}
            className="board-lane"
            aria-label={lane.status}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              drop(lane.status)
            }}
          >
            <header className="board-lane-head">
              <span className="board-lane-name">{lane.status}</span>
              <span className="mono board-lane-count">{lane.rows.length}</span>
            </header>
            {refusal?.lane === lane.status && (
              <p className="board-refusal" role="alert">
                {refusal.message}
              </p>
            )}
            <div className="board-cards">
              {lane.rows.map((row) => (
                <div
                  key={row.id}
                  className={`board-card${row.id === selectedId ? ' selected' : ''}`}
                  draggable
                  onDragStart={() => {
                    dragId.current = row.id
                  }}
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(row.id)
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title="Open in the detail panel. Drag to another lane to change status."
                >
                  <span className="board-card-id mono">{row.displayId}</span>
                  <span className="board-card-name">{row.name}</span>
                  <span className="board-card-meta">
                    {row.severity && <span>{row.severity}</span>}
                    {row.owner && <span>{row.owner}</span>}
                    {row.plannedEndDate && <span className="mono">{row.plannedEndDate}</span>}
                  </span>
                </div>
              ))}
              {!lane.rows.length && <p className="board-lane-empty">Nothing here.</p>}
            </div>
          </section>
        ))}
      </div>

      {asking && (
        <div className="board-ask" role="dialog" aria-label="Reason for the change">
          <p className="board-ask-title">
            Moving to “{asking.to}”. A status change needs a short reason — it is what this
            record is read for later.
          </p>
          {asking.note && <p className="board-ask-note">{asking.note}</p>}
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why this is moving"
          />
          <div className="board-ask-actions">
            <button className="btn" disabled={!reason.trim()} onClick={submitReason}>
              Move it
            </button>
            <button className="btn ghost" onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
