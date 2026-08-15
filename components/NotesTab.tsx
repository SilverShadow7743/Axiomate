'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { canAddNote, canEditNote } from '@/lib/permissions'
import { NOTE_TYPES, DEFAULT_NOTE_TYPE, notesFor, wasEdited, type IssueNote, type NoteType } from '@/lib/notes'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * The working record of an issue: what was tried, said, decided and ruled out.
 *
 * Kept apart from History on purpose. History is produced by the system and proves what
 * changed; this is written by people and explains why. A reader three weeks later needs both,
 * and merging them would leave a stream too noisy to audit and too thin to explain.
 */

export default function NotesTab({
  issueId,
  state,
  actor,
  onAdd,
  onUpdate,
  onDelete,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  onAdd: (body: string, noteType: NoteType, pinned: boolean) => void
  onUpdate: (id: string, patch: Partial<Pick<IssueNote, 'body' | 'noteType' | 'pinned'>>) => void
  onDelete: (id: string) => void
}) {
  const notes = useMemo(() => notesFor(state.notes, issueId), [state.notes, issueId])
  const mayAdd = canAddNote(state.model, actor)

  const [draft, setDraft] = useState('')
  const [draftType, setDraftType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [draftPinned, setDraftPinned] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const submit = () => {
    if (!draft.trim()) return
    onAdd(draft, draftType, draftPinned)
    setDraft('')
    setDraftType(DEFAULT_NOTE_TYPE)
    setDraftPinned(false)
  }

  return (
    <div className="notes">
      {mayAdd.allowed ? (
        <div className="note-compose">
          <textarea
            className="note-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What happened, what was tried, what was decided…"
            rows={3}
            aria-label="New note"
            // Enter is for paragraphs — a note is prose, and losing a half-written one to a
            // stray keystroke is worse than reaching for the button.
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            }}
          />
          <div className="note-compose-row">
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as NoteType)}
              aria-label="Note type"
            >
              {NOTE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="note-pin-toggle">
              <input
                type="checkbox"
                checked={draftPinned}
                onChange={(e) => setDraftPinned(e.target.checked)}
              />
              Pin
            </label>
            <span className="grow" />
            <span className="fld-hint">⌘/Ctrl + Enter</span>
            <button className="btn primary" disabled={!draft.trim()} onClick={submit}>
              Add note
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-note">{mayAdd.reason ?? 'You cannot add notes here.'}</div>
      )}

      {notes.length === 0 ? (
        <div className="cfg-empty">
          No notes yet. This is where the story of the issue goes — what was investigated, what
          the client said, what was decided and why.
        </div>
      ) : (
        <ol className="note-list">
          {notes.map((n) => {
            const mayEdit = canEditNote(state.model, actor, n)
            const editing = editingId === n.id
            return (
              <li className={`note${n.pinned ? ' pinned' : ''}`} key={n.id}>
                <div className="note-head">
                  <span className="note-type">{n.noteType}</span>
                  {n.pinned && <span className="note-pin" title="Pinned">Pinned</span>}
                  <span className="note-by">{n.createdBy}</span>
                  <span className="note-at" title={new Date(n.createdAt).toLocaleString()}>
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                  {/* An edited note says so, and by whom. The original authorship above is
                      never rewritten, so both facts are on screen at once. */}
                  {wasEdited(n) && (
                    <span className="prov">
                      · edited by {n.updatedBy} {new Date(n.updatedAt!).toLocaleString()}
                    </span>
                  )}
                  <span className="grow" />
                  {mayEdit.allowed ? (
                    editing ? null : (
                      <>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            setEditingId(n.id)
                            setEditBody(n.body)
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => onUpdate(n.id, { pinned: !n.pinned })}
                          title={n.pinned ? 'Unpin this note' : 'Pin this note to the top'}
                        >
                          {n.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        {confirmDelete === n.id ? (
                          <button
                            className="btn danger-solid"
                            onClick={() => {
                              onDelete(n.id)
                              setConfirmDelete(null)
                            }}
                            onBlur={() => setConfirmDelete(null)}
                          >
                            Confirm delete
                          </button>
                        ) : (
                          <button className="btn ghost" onClick={() => setConfirmDelete(n.id)}>
                            Delete
                          </button>
                        )}
                      </>
                    )
                  ) : (
                    <span className="prov" title={mayEdit.reason}>
                      {n.createdBy}&rsquo;s note
                    </span>
                  )}
                </div>

                {editing ? (
                  <div className="note-edit">
                    <textarea
                      className="note-input"
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={4}
                      aria-label="Edit note"
                      autoFocus
                    />
                    <div className="note-compose-row">
                      <select
                        value={n.noteType}
                        onChange={(e) => onUpdate(n.id, { noteType: e.target.value as NoteType })}
                        aria-label="Note type"
                      >
                        {NOTE_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <span className="grow" />
                      <button className="btn" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button
                        className="btn primary"
                        disabled={!editBody.trim() || editBody === n.body}
                        onClick={() => {
                          onUpdate(n.id, { body: editBody })
                          setEditingId(null)
                        }}
                      >
                        Save note
                      </button>
                    </div>
                  </div>
                ) : (
                  // `white-space: pre-wrap` in the stylesheet: notes are structured plain text,
                  // and paragraph breaks someone typed are part of what they wrote.
                  <p className="note-body">{n.body}</p>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
