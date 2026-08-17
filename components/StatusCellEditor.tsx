'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'

/** Roughly what the popover occupies, used only to keep it inside the viewport. */
const POPOVER_W = 300
const POPOVER_H = 176

/**
 * Inline status editing, with the reason the change has to carry.
 *
 * Status is the one inline edit that asks why, because status is what a client reads as a
 * commitment (design §6): "moved to Done on Tuesday, because …" is the entry that makes the
 * trail worth keeping. The reason is required and there is deliberately no way to submit an
 * empty one — writing `''` to make the flow smoother would be worse than asking nothing at
 * all, because a blank reason in the trail makes the field look answered.
 *
 * A popover rather than the shared `CellEditor`, for two reasons that both bite:
 *
 *   A status cell is 168px wide and this needs a sentence.
 *
 *   `CellEditor` commits on blur, which is right for a value that stands alone and wrong here:
 *   moving focus from the status select to the reason box is *inside* one edit, and a blur
 *   commit would fire halfway through the thing being typed — saving the change without the
 *   reason it exists to collect.
 */
export default function StatusCellEditor({
  options,
  value,
  onCommit,
  onCancel,
}: {
  options: readonly string[]
  /** The status as it stands, which is also what Cancel returns to. */
  value: string
  /** Returns false when the reducer refused, so the editor stays open with the text intact. */
  onCommit: (status: string, reason: string) => boolean
  onCancel: () => void
}) {
  const host = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState(value)
  const [reason, setReason] = useState('')
  const [at, setAt] = useState({ top: 0, left: 0 })
  useOverlay(pop)

  /**
   * Anchored to the cell it was opened from, measured before paint.
   *
   * A layout effect rather than an ordinary one: the popover is in the document from the first
   * commit — `useOverlay` has to find its controls to focus one — so measuring afterwards would
   * paint it at the top-left corner for a frame first.
   */
  useLayoutEffect(() => {
    const cell = host.current?.parentElement
    if (!cell) return
    const r = cell.getBoundingClientRect()
    setAt({
      top: Math.max(8, Math.min(r.bottom + 2, window.innerHeight - POPOVER_H)),
      left: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_W - 8)),
    })
    // `useOverlay` also puts focus on the first control, and this does not fight it — it lands
    // on the same element. It is here so Enter and Escape work whatever the effect ordering
    // turns out to be: both are handled on the popover, and a popover nothing is focused
    // inside of would leave the Cancel button as the only way out.
    pop.current?.querySelector<HTMLSelectElement>('select')?.focus()
  }, [])

  const changed = status !== value
  const why = reason.trim()
  const ready = changed && why.length > 0

  const commit = () => {
    // Not a refusal message and not a browser prompt: the missing thing is put under the
    // cursor, which is the shortest route from "this will not go through" to it going through.
    if (!ready) {
      reasonRef.current?.focus()
      return
    }
    onCommit(status, why)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    }
  }

  const body = (
    <>
      {/* The shell is `inert` while this is up, so a click outside would otherwise land on
          nothing at all. It abandons rather than commits: an unexplained status change is the
          one edit this workspace would rather lose than record. */}
      <div className="row-menu-scrim" onMouseDown={onCancel} />
      <div
        className="menu status-editor"
        ref={pop}
        role="dialog"
        aria-label="Change status"
        style={{ top: at.top, left: at.left }}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <label className="status-editor-field">
          <span className="menu-title">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label className="status-editor-field">
          <span className="menu-title">Why</span>
          <input
            ref={reasonRef}
            type="text"
            value={reason}
            placeholder="A short reason — required"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        <p className="prov status-editor-note">
          Status is what a client reads as a commitment, so the change carries a reason into the
          record's history.
        </p>

        <div className="status-editor-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={commit}
            disabled={!ready}
            title={
              !changed
                ? 'Pick a different status'
                : why
                  ? 'Save the change and the reason'
                  : 'A status change needs a reason'
            }
          >
            Save
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Stays in the cell so the popover has something to measure against, and shows the
          value that is still in force until the change is actually saved. */}
      <span ref={host} className="status-editor-anchor">
        {value}
      </span>
      {typeof document === 'undefined' ? body : createPortal(body, document.body)}
    </>
  )
}
