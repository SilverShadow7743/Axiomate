'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { boardLanes, describeBoard, dropOutcome } from '@/lib/board'
import { allowedNext, type StatusPolicy } from '@/lib/statusPolicy'
import type { IssueStatus, ScheduleRow } from '@/lib/types'
import { useOverlay } from './useOverlay'

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
  selectedIds,
  onToggleSelect,
}: {
  rows: ScheduleRow[]
  policy: StatusPolicy
  /** Whether the issue has at least one live evidence item — the same test IssueFocus applies. */
  hasEvidence: (rowId: string) => boolean
  selectedId: string | null
  onSelect: (id: string) => void
  /** commitCell(rowId, 'status', status, reason) — returns false when the funnel refuses. */
  onCommitStatus: (rowId: string, status: IssueStatus, reason: string) => boolean
  /** Cards checked for a bulk action — separate from `selectedId`, the open detail record. */
  selectedIds: Set<string>
  /** Ctrl/Cmd-click toggles one card; Shift-click (`extendRange`) extends from the last click,
   *  bounded to the third argument — the dragged-from card's own lane, since "the cards
   *  between these two" has no meaning once two different lanes are involved. */
  onToggleSelect: (id: string, extendRange: boolean, within: ScheduleRow[]) => void
}) {
  const lanes = boardLanes(rows)
  const dragId = useRef<string | null>(null)

  /** A refusal renders at the lane it happened on, in the policy’s words, briefly. */
  const [refusal, setRefusal] = useState<{ lane: IssueStatus; message: string } | null>(null)
  /** A legal drop collecting its reason. `note` carries the policy’s message when it had one. */
  const [asking, setAsking] = useState<{ rowId: string; to: IssueStatus; note: string | null } | null>(null)
  const [reason, setReason] = useState('')

  /**
   * Which card's Move menu is open, if any, and where — the keyboard and touch path to a lane
   * change. Viewport coordinates of the trigger, same shape `TreeGrid`'s own `openMenu` computes
   * for `RowMenu`, and for the same reason: the menu is portaled to the body (see `MoveMenu`
   * below), so it needs real pixel coordinates, not a CSS position relative to a card that may
   * have scrolled.
   */
  const [menu, setMenu] = useState<{ rowId: string; top: number; left: number } | null>(null)

  /** One entry point for drag AND menu: the pre-check, then the reason collection. */
  const begin = (row: ScheduleRow, to: IssueStatus) => {
    if (row.status === to) return
    const outcome = dropOutcome(policy, row, to, hasEvidence(row.id))
    if (outcome.kind === 'refused') {
      setRefusal({ lane: to, message: outcome.message })
      return
    }
    // Legal — but every status change carries a reason, so both 'ok' and 'ask' collect one.
    setRefusal(null)
    setReason('')
    setAsking({ rowId: row.id, to, note: outcome.kind === 'ask' ? outcome.message : null })
  }

  const drop = (to: IssueStatus) => {
    const id = dragId.current
    dragId.current = null
    if (!id) return
    const row = rows.find((r) => r.id === id)
    if (row) begin(row, to)
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
        {lanes.map((lane) => {
          const empty = lane.rows.length === 0
          return (
          <section
            key={lane.status}
            className={`board-lane${empty ? ' collapsed' : ''}`}
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
            {empty ? (
              // Collapsed to a thin rail rather than dropped from the vocabulary entirely — a
              // status nobody is in right now is still a place a card can be dragged to, and
              // the "Move" menu already lists it regardless of whether this section is here.
              <p className="board-lane-empty collapsed">Drop here.</p>
            ) : (
            <div className="board-cards">
              {lane.rows.map((row) => (
                <div
                  key={row.id}
                  className={`board-card${row.id === selectedId ? ' selected' : ''}${selectedIds.has(row.id) ? ' bulk-selected' : ''}`}
                  draggable
                  onDragStart={() => {
                    dragId.current = row.id
                  }}
                  onClick={(e) => {
                    if (e.shiftKey) return onToggleSelect(row.id, true, lane.rows)
                    if (e.ctrlKey || e.metaKey) return onToggleSelect(row.id, false, lane.rows)
                    onSelect(row.id)
                  }}
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
                  {/* The board's one verb, reachable without a mouse drag: drag-and-drop is
                      unavailable to keyboard and touch users, and this menu runs the same
                      begin() pre-check-and-reason path a drop does. */}
                  <span className="board-card-move">
                    <button
                      className="btn ghost"
                      aria-haspopup="menu"
                      aria-expanded={menu?.rowId === row.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (menu?.rowId === row.id) {
                          setMenu(null)
                          return
                        }
                        // Same clamp TreeGrid's own openMenu applies, and the same reason: this
                        // is the side that knows the trigger, and a menu opened on a card near
                        // the edge of the board must not render off-screen.
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenu({
                          rowId: row.id,
                          top: Math.max(8, Math.min(r.bottom + 2, window.innerHeight - 320)),
                          left: Math.max(8, Math.min(r.left, window.innerWidth - 248)),
                        })
                      }}
                      title="Move to another status"
                    >
                      Move ▾
                    </button>
                    {menu?.rowId === row.id && (
                      <MoveMenu
                        at={{ top: menu.top, left: menu.left }}
                        options={allowedNext(policy, row.status).filter((s) => s !== row.status)}
                        onPick={(s) => {
                          setMenu(null)
                          begin(row, s)
                        }}
                        onClose={() => setMenu(null)}
                      />
                    )}
                  </span>
                  <span className="board-card-name">{row.name}</span>
                  <span className="board-card-meta">
                    {row.severity && <span>{row.severity}</span>}
                    {row.owner && <span>{row.owner}</span>}
                    {row.plannedEndDate && <span className="mono">{row.plannedEndDate}</span>}
                  </span>
                </div>
              ))}
            </div>
            )}
          </section>
          )
        })}
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

/**
 * The Move-to popover — its own component, not inlined into the card loop, because
 * `useOverlay` is a hook and cannot be called a variable number of times per render.
 *
 * Same shape `RowMenu.tsx` already establishes for a per-record popover: `useOverlay` for
 * background inert + Tab wrap, a scrim for outside-click dismissal, Escape handled locally
 * (`useOverlay`'s own `onEscape` is deliberately unused, matching `RowMenu`'s own comment on
 * why).
 *
 * **Portaled to the body, in viewport coordinates — the same reason `RowMenu` already is, and a
 * bug found live before this was added.** `useOverlay` marks `#app-shell` `inert` while an
 * overlay is open, which is correct for a portaled overlay (outside the inert subtree, so it
 * stays interactive) and self-defeating for one that is not: this menu used to render inline
 * inside the card, which is inside `#app-shell`, so opening it made its OWN scrim, its OWN
 * trigger button and itself inert along with the background — an outside click, Escape, and
 * even re-clicking the trigger all silently did nothing, because none of them could receive the
 * event any more. `elementFromPoint` on a click squarely inside the scrim's own
 * `getBoundingClientRect()` returned `<body>` with `#app-shell` marked `inert=""` — confirmed
 * live, not inferred. Portaling out of `#app-shell` is the fix `RowMenu` already uses for the
 * identical shape of popover.
 */
function MoveMenu({
  at,
  options,
  onPick,
  onClose,
}: {
  /** Viewport coordinates of the trigger, already clamped by the caller — same contract
   *  `RowMenu`'s own `at` prop has, for the same reason (`TreeGrid`'s `openMenu`). */
  at: { top: number; left: number }
  options: IssueStatus[]
  onPick: (s: IssueStatus) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, true)

  const body = (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape below */}
      <div className="row-menu-scrim" onMouseDown={onClose} />
      <div
        className="menu row-menu"
        role="menu"
        ref={ref}
        tabIndex={-1}
        style={{ top: at.top, left: at.left }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        {options.map((s) => (
          <button
            key={s}
            role="menuitem"
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation()
              onPick(s)
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
