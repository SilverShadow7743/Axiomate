'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import { checklistCount, checklistFor, type ChecklistItem } from '@/lib/checklist'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * A lightweight to-do list within a task.
 *
 * Not a subtask (`Issue.parentIssueId`/`subIssues`) and not a note — see
 * `docs/plans/2026-09-07-checklist-design.md`. The count shown is read off the live items on
 * every render, never a stored percentage.
 */
export default function ChecklistTab({
  issueId,
  state,
  actor,
  onAdd,
  onToggle,
  onRemove,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  onAdd: (text: string) => void
  onToggle: (id: string, done: boolean) => void
  onRemove: (id: string) => void
}) {
  const items = useMemo(() => checklistFor(state.checklistItems, issueId), [state.checklistItems, issueId])
  const count = checklistCount(items)
  const mayEdit = can(state.model, actor, 'work.edit')
  const [draft, setDraft] = useState('')

  const submit = () => {
    if (!draft.trim()) return
    onAdd(draft.trim())
    setDraft('')
  }

  return (
    <div className="notes">
      {items.length > 0 && (
        <p className="prov" style={{ marginBottom: 6 }}>
          {count.done} of {count.total} checked off.
        </p>
      )}

      {items.length === 0 ? (
        <div className="cfg-empty">
          Nothing on the list yet. A checklist item is for the small "confirm with client, update
          FBS, close ticket" kind of thing — anything with its own status or owner belongs on a
          subtask instead.
        </div>
      ) : (
        <ol className="note-list">
          {items.map((item) => (
            <li className="note" key={item.id}>
              <div className="note-head">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={!mayEdit.allowed}
                    onChange={(e) => onToggle(item.id, e.target.checked)}
                  />
                  <span style={{ textDecoration: item.done ? 'line-through' : 'none' }}>
                    {item.text}
                  </span>
                </label>
                {item.done && item.doneBy && (
                  <span className="note-by">
                    {item.doneBy} · {new Date(item.doneAt!).toLocaleDateString()}
                  </span>
                )}
                {mayEdit.allowed && (
                  <button className="btn ghost" onClick={() => onRemove(item.id)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {mayEdit.allowed ? (
        <div className="note-compose-row">
          <input
            className="fld-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="Add an item"
            aria-label="New checklist item"
            style={{ flex: 1 }}
          />
          <button className="btn primary" disabled={!draft.trim()} onClick={submit}>
            Add
          </button>
        </div>
      ) : (
        <div className="panel-note">{mayEdit.reason ?? 'You cannot edit this checklist.'}</div>
      )}
    </div>
  )
}
