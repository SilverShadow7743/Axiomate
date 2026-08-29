'use client'

import { useEffect, useRef, useState } from 'react'
import type { ScheduleRow } from '@/lib/types'
import { isGroupRow } from '@/lib/types'
import { createMenuFor, type CreatableKind } from '@/lib/workspace'
import { kindLabel } from '@/lib/config'
import { useLabels } from './labels'

/**
 * Contextual action bar (Select → Understand → Act).
 *
 * The available actions come from the kind of row selected, so the user never has to know
 * which underlying entity they are touching or pick a parent by hand — the selection is the
 * parent.
 */
interface Props {
  row: ScheduleRow | null
  onAdd: (kind: CreatableKind) => void
  onEdit: () => void
  onMove: () => void
  onLink: () => void
  onDependency: () => void
  onMarkComplete: () => void
  onDelete: () => void
  onNewIssue: () => void
  onBuildLifecycle: () => void
  hasLifecycle: boolean
}

export default function SelectionToolbar({
  row,
  onAdd,
  onEdit,
  onMove,
  onLink,
  onDependency,
  onMarkComplete,
  onDelete,
  onNewIssue,
  onBuildLifecycle,
  hasLifecycle,
}: Props) {
  const labels = useLabels()
  const [addOpen, setAddOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) {
        setAddOpen(false)
        setMoreOpen(false)
      }
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [])

  // Nothing selected — only the global actions make sense.
  if (!row) {
    return (
      <div className="seltoolbar" ref={wrap}>
        <button className="btn primary" onClick={onNewIssue}>
          + New Issue
        </button>
        <span className="sel-none">Select a row to act on it</span>
      </div>
    )
  }

  /**
   * What can be created here is decided by the row's kind, full stop.
   *
   * It used to be recovered from `row.type` — the *display* string, lowercased — because
   * Engagement and Project rows were once modelled as modules and the type column was the
   * only thing that told them apart. They have been real tiers for a while now, so both
   * branches were unreachable, and reading a structural decision out of a user-renameable
   * label would have started returning the wrong menu the moment somebody renamed a tier.
   */
  const addOptions = createMenuFor(row.kind)
  const isActivity = row.kind === 'activity' || row.kind === 'milestone'
  const isIssue = row.kind === 'issue'
  // Structural rows are archived, not deleted — every tier of them. Naming two of the five
  // meant an Engagement offered "Delete…" for an action that soft-deletes like the rest.
  const isStructural = isGroupRow(row.kind)

  return (
    <div className="seltoolbar" ref={wrap}>
      <span className="sel-ctx">
        <b>{row.displayId || row.name}</b>
        <span className="sel-kind">{row.type}</span>
      </span>

      {addOptions.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button className="btn primary" onClick={() => setAddOpen((v) => !v)}>
            + Add ▾
          </button>
          {addOpen && (
            <div className="menu" style={{ top: 30, left: 0 }}>
              <div className="menu-title">Add under {row.displayId || row.name}</div>
              {addOptions.map((k) => (
                <button
                  key={k}
                  className="menu-item"
                  onClick={() => {
                    setAddOpen(false)
                    onAdd(k)
                  }}
                >
                  {kindLabel(labels, k)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="btn" onClick={onEdit}>
        Edit
      </button>

      {!isActivity && (
        <button className="btn" onClick={onMove} title="Change this record's parent, with validation">
          Move
        </button>
      )}

      {isIssue && (
        <button className="btn" onClick={onLink} title="Create a business relationship to another issue">
          Link
        </button>
      )}

      {isActivity && (
        <>
          <button className="btn" onClick={onDependency}>
            Add Dependency
          </button>
          <button className="btn" onClick={onMarkComplete}>
            Mark Complete
          </button>
        </>
      )}

      {isIssue && !hasLifecycle && (
        <button className="btn" onClick={onBuildLifecycle}>
          Build lifecycle
        </button>
      )}

      <div style={{ position: 'relative' }}>
        <button className="btn" onClick={() => setMoreOpen((v) => !v)} title="More actions">
          ⋮
        </button>
        {moreOpen && (
          <div className="menu" style={{ top: 30, right: 0, left: 'auto' }}>
            <button
              className="menu-item"
              onClick={() => {
                setMoreOpen(false)
                navigator.clipboard?.writeText(`${location.origin}/?row=${encodeURIComponent(row.id)}`)
              }}
            >
              Copy link
            </button>
            {isIssue && hasLifecycle && (
              <button
                className="menu-item"
                onClick={() => {
                  setMoreOpen(false)
                  onBuildLifecycle()
                }}
              >
                Remove lifecycle plan
              </button>
            )}
            <button
              className="menu-item danger"
              onClick={() => {
                setMoreOpen(false)
                onDelete()
              }}
            >
              {isStructural ? 'Archive…' : 'Delete…'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

