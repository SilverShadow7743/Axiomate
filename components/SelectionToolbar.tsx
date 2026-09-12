'use client'

import { useEffect, useRef, useState } from 'react'
import type { IssueStatus, ScheduleRow } from '@/lib/types'
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
  /**
   * The bulk-action selection (12 Sep multi-select design/plan) — rendered instead of the
   * single-record menu above whenever two or more rows are checked. Resolved by the caller
   * (`selectedRows`), not looked up here, the same way `row` above is already resolved rather
   * than an id the toolbar would have to look up itself.
   */
  selectedIds: Set<string>
  selectedRows: ScheduleRow[]
  /** Every status `bulkStatusChoices` refuses for no selected row — `lib/board.ts`. */
  bulkStatusOptions: IssueStatus[]
  /** commitCell's status arm, run once per selected row inside one dispatchMany. Returns false
   *  when the funnel refuses (mirrors onCommitStatus's own single-record contract). */
  onBulkStatusChange: (to: IssueStatus, reason: string) => boolean
  /** "Unassigned" first, then the directory — `ownerOptionValues` shape, resolved by the caller
   *  since which client seats are safe to offer depends on whether the selection shares one
   *  client node (see IssueWorkspace.tsx). */
  bulkOwnerOptions: string[]
  /** False means at least one selected row's assignment was refused for unavailability — the
   *  caller has already surfaced why; nothing committed for any row. */
  onBulkReassign: (owner: string) => boolean
  onClearSelection: () => void
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
  selectedIds,
  selectedRows,
  bulkStatusOptions,
  onBulkStatusChange,
  bulkOwnerOptions,
  onBulkReassign,
  onClearSelection,
}: Props) {
  const labels = useLabels()
  const [addOpen, setAddOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  /** The status picked, awaiting its unconditionally-required reason — `null` closes the ask. */
  const [bulkAsking, setBulkAsking] = useState<IssueStatus | null>(null)
  const [bulkReason, setBulkReason] = useState('')

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

  // Two or more rows checked for a bulk action — this branch replaces the single-record menu
  // entirely, the same way `!row` below replaces it with the "nothing selected" state. A row
  // that is ALSO the open `selectedId` never reaches here: a plain click that opens a record
  // clears `selectedIds` to empty, so the two states cannot disagree about which renders.
  if (selectedIds.size >= 2) {
    const submitBulkStatus = () => {
      if (!bulkAsking || !bulkReason.trim()) return
      if (onBulkStatusChange(bulkAsking, bulkReason.trim())) {
        setBulkAsking(null)
        setBulkReason('')
      }
    }
    return (
      <div className="seltoolbar" ref={wrap}>
        <span className="sel-ctx">
          <b>{selectedIds.size} selected</b>
        </span>

        <div style={{ position: 'relative' }}>
          <select
            value=""
            aria-label="Change status"
            disabled={bulkStatusOptions.length === 0}
            title={
              bulkStatusOptions.length === 0
                ? 'No status is valid for all selected records.'
                : 'Change status for every selected record'
            }
            onChange={(e) => {
              if (!e.target.value) return
              setBulkReason('')
              setBulkAsking(e.target.value as IssueStatus)
            }}
          >
            <option value="">Change status…</option>
            {bulkStatusOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div style={{ position: 'relative' }}>
          <select
            value=""
            aria-label="Reassign owner"
            onChange={(e) => {
              if (!e.target.value) return
              onBulkReassign(e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">Reassign owner…</option>
            {bulkOwnerOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <span className="grow" />
        <button className="btn" onClick={onClearSelection}>
          Clear ({selectedIds.size})
        </button>

        {bulkAsking && (
          <div className="board-ask" role="dialog" aria-label="Reason for the change">
            <p className="board-ask-title">
              Moving {selectedRows.length} records to “{bulkAsking}”. A status change needs a
              short reason — it is what these records are read for later.
            </p>
            <textarea
              autoFocus
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              rows={2}
              placeholder="Why these are moving"
            />
            <div className="board-ask-actions">
              <button className="btn" disabled={!bulkReason.trim()} onClick={submitBulkStatus}>
                Apply to {selectedRows.length}
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setBulkAsking(null)
                  setBulkReason('')
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

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
          {/* One primary per record (F&O's action-pane rule, docs/plans/2026-09-10-fno-page-
              grammar-design.md §2): on an issue or activity, FieldStrip's suggested status
              transition is the primary, so Add is secondary here; on a structural row no
              FieldStrip renders and adding a child IS the ordinary next move — F&O's own
              home-tab "New" — so it stays primary there. */}
          <button className={isIssue || isActivity ? 'btn' : 'btn primary'} onClick={() => setAddOpen((v) => !v)}>
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

