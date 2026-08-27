'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import type { ScheduleRow } from '@/lib/types'

/** Roughly what the popover occupies, used only to keep it inside the viewport. */
const POPOVER_W = 320
const POPOVER_H = 320

/**
 * Fast triage for an issue row, without leaving the grid.
 *
 * Subject is deliberately not a fourth `lib/editing.ts` `editorFor` case (see that module's
 * own reasoning at lines 57–73: a lone 392px cell divorces Subject from Description). This is
 * the resolution instead — a popover with room for a sentence, reached from the same
 * double-click that already opens the full editor for every column with no inline case of its
 * own. Every field here commits independently and immediately through the same `onCommit`
 * (`commitCell` in IssueWorkspace.tsx) every other inline editor already uses — this is four
 * fields shown together, not a form with its own save/cancel lifecycle.
 *
 * Status is the one field that still asks why, for the same reason `StatusCellEditor` does: a
 * status is what a client reads as a commitment. The reason box only appears once status has
 * actually changed, and Save is scoped to status alone — picking a new owner does not need to
 * wait on a sentence about a status nobody touched.
 */
export default function QuickEditPopover({
  row,
  statusOptions,
  ownerOptions,
  onCommit,
  onClose,
}: {
  row: ScheduleRow
  /** The transition graph's own answer for where this row's status may go. */
  statusOptions: readonly string[]
  ownerOptions: string[]
  /** Same shape as `TreeGrid`'s own `onCellCommit` — returns false when the reducer refused. */
  onCommit: (colKey: string, value: string, reason?: string) => boolean
  onClose: () => void
}) {
  const host = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ top: 0, left: 0 })
  useOverlay(pop)

  const [subject, setSubject] = useState(row.name)
  const [owner, setOwner] = useState(row.owner ?? '')
  const [severity, setSeverity] = useState<string>(row.severity ?? 'Medium')
  const [status, setStatus] = useState<string>(row.status ?? 'Open')
  const [statusReason, setStatusReason] = useState('')

  useLayoutEffect(() => {
    const cell = host.current?.parentElement
    if (!cell) return
    const r = cell.getBoundingClientRect()
    setAt({
      top: Math.max(8, Math.min(r.bottom + 2, window.innerHeight - POPOVER_H)),
      left: Math.max(8, Math.min(r.left, window.innerWidth - POPOVER_W - 8)),
    })
    pop.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])

  const commitSubject = () => {
    const value = subject.trim()
    if (value && value !== row.name) onCommit('name', value)
    else setSubject(row.name)
  }
  const commitOwner = () => {
    if (owner !== (row.owner ?? '')) onCommit('owner', owner)
  }
  const commitSeverity = (value: string) => {
    setSeverity(value)
    if (value !== row.severity) onCommit('severity', value)
  }

  const statusChanged = status !== row.status
  const statusReady = statusChanged && statusReason.trim().length > 0
  const commitStatus = () => {
    if (!statusReady) return
    if (onCommit('status', status, statusReason.trim())) setStatusReason('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const body = (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape above */}
      <div className="row-menu-scrim" onMouseDown={onClose} />
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is this editor's own keyboard handling; the click merely stops the scrim's dismissal */}
      <div
        className="menu quick-edit-popover"
        ref={pop}
        role="dialog"
        aria-label="Quick edit"
        style={{ top: at.top, left: at.left }}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <label className="status-editor-field">
          <span className="menu-title">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={commitSubject}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitSubject()
              }
            }}
          />
        </label>

        <label className="status-editor-field">
          <span className="menu-title">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {statusChanged && (
          <>
            <label className="status-editor-field">
              <span className="menu-title">Why</span>
              <input
                value={statusReason}
                placeholder="A short reason — required"
                onChange={(e) => setStatusReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitStatus()
                  }
                }}
              />
            </label>
            <div className="status-editor-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStatus(row.status ?? 'Open')
                  setStatusReason('')
                }}
              >
                Undo status
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={commitStatus}
                disabled={!statusReady}
                title={statusReason.trim() ? 'Save the status change and its reason' : 'A status change needs a reason'}
              >
                Save status
              </button>
            </div>
          </>
        )}

        <label className="status-editor-field">
          <span className="menu-title">Owner</span>
          <input
            value={owner}
            list="quick-edit-owners"
            placeholder="Unassigned"
            onChange={(e) => setOwner(e.target.value)}
            onBlur={commitOwner}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitOwner()
              }
            }}
          />
          <datalist id="quick-edit-owners">
            {ownerOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </label>

        <label className="status-editor-field">
          <span className="menu-title">Severity</span>
          <select value={severity} onChange={(e) => commitSeverity(e.target.value)}>
            {(['High', 'Medium', 'Low'] as const).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="status-editor-actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* Stays in the cell so the popover has something to measure against. */}
      <span ref={host} className="status-editor-anchor">
        {row.name}
      </span>
      {typeof document === 'undefined' ? body : createPortal(body, document.body)}
    </>
  )
}
