'use client'

import { boardLanes, describeBoard } from '@/lib/board'
import type { ScheduleRow } from '@/lib/types'

/**
 * The register as lanes.
 *
 * Render-only in this commit: cards open the same detail panel the grid opens, and nothing
 * else happens. The drop handler — the step that puts the transition graph in front of a
 * gesture — lands separately, because it is the risky half and wants its own revert line.
 *
 * Lanes come from `boardLanes`, which keeps every configured status visible even when empty:
 * an empty lane is where work is allowed to go, and hiding it would hide the process.
 */
export default function BoardView({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ScheduleRow[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const lanes = boardLanes(rows)

  return (
    <div className="board" role="region" aria-label="Status board">
      <div className="board-sub sentence">{describeBoard(lanes)}</div>
      <div className="board-lanes">
        {lanes.map((lane) => (
          <section key={lane.status} className="board-lane" aria-label={lane.status}>
            <header className="board-lane-head">
              <span className="board-lane-name">{lane.status}</span>
              <span className="mono board-lane-count">{lane.rows.length}</span>
            </header>
            <div className="board-cards">
              {lane.rows.map((row) => (
                <button
                  key={row.id}
                  className={`board-card${row.id === selectedId ? ' selected' : ''}`}
                  onClick={() => onSelect(row.id)}
                  title="Open this record in the detail panel"
                >
                  <span className="board-card-id mono">{row.displayId}</span>
                  <span className="board-card-name">{row.name}</span>
                  <span className="board-card-meta">
                    {row.severity && <span>{row.severity}</span>}
                    {row.owner && <span>{row.owner}</span>}
                    {row.plannedEndDate && <span className="mono">{row.plannedEndDate}</span>}
                  </span>
                </button>
              ))}
              {!lane.rows.length && <p className="board-lane-empty">Nothing here.</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
