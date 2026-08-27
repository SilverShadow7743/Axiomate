'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { canAddNote, canEditNote } from '@/lib/permissions'
import { NOTE_TYPES, DEFAULT_NOTE_TYPE, notesFor, wasEdited, type IssueNote, type NoteType } from '@/lib/notes'
import { emptyRichDoc, isEmptyRichDoc, richDocsEqual, type RichDoc } from '@/lib/richText'
import type { WorkspaceState } from '@/lib/workspace'
import RichTextEditor from './RichTextEditor'

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
  onUploadImage,
  onWriteReply,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  onAdd: (body: RichDoc, noteType: NoteType, pinned: boolean, clientVisible: boolean) => void
  onUpdate: (
    id: string,
    patch: Partial<Pick<IssueNote, 'body' | 'noteType' | 'pinned' | 'clientVisible'>>,
  ) => void
  onDelete: (id: string) => void
  onUploadImage: (file: File) => Promise<{ documentId: string; alt: string } | null>
  /**
   * Present when this record can be replied to (a claimed address, the grant, a mailbox).
   * The sent replies land in this thread as pinned notes, so the place they are READ offers
   * the way to CONTINUE them — the compose itself has one home, on Overview.
   */
  onWriteReply?: () => void
}) {
  const notes = useMemo(() => notesFor(state.notes, issueId), [state.notes, issueId])
  const mayAdd = canAddNote(state.model, actor)
  const people = useMemo(() => Object.values(state.model.people).map((p) => ({ id: p.id, name: p.name })), [state.model.people])
  const issues = useMemo(
    () => Object.values(state.issues).map((i) => ({ id: i.id, subject: i.subject, status: i.status })),
    [state.issues],
  )

  const [draft, setDraft] = useState<RichDoc>(emptyRichDoc())
  const [draftType, setDraftType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [draftPinned, setDraftPinned] = useState(false)
  /** Born internal unless the writer says otherwise — the boundary's default, restated here. */
  const [draftVisible, setDraftVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState<RichDoc>(emptyRichDoc())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const submit = () => {
    if (isEmptyRichDoc(draft)) return
    onAdd(draft, draftType, draftPinned, draftVisible)
    setDraft(emptyRichDoc())
    setDraftType(DEFAULT_NOTE_TYPE)
    setDraftPinned(false)
    setDraftVisible(false)
  }

  return (
    <div className="notes">
      {onWriteReply && (
        <p className="prov" style={{ marginBottom: 6 }}>
          <button className="btn ghost" onClick={onWriteReply}>
            Write a reply to the client →
          </button>{' '}
          Replies send as the engagement's mailbox and are recorded in this thread.
        </p>
      )}
      {mayAdd.allowed ? (
        <div className="note-compose">
          <RichTextEditor
            value={draft}
            onChange={setDraft}
            editable
            people={people}
            issues={issues}
            onUploadImage={onUploadImage}
            placeholder="What happened, what was tried, what was decided…"
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
            <label
              className="note-pin-toggle"
              title="Client seats see this note. Unticked, it stays internal — the default."
            >
              <input
                type="checkbox"
                checked={draftVisible}
                onChange={(e) => setDraftVisible(e.target.checked)}
              />
              Show to client
            </label>
            <span className="grow" />
            <button className="btn primary" disabled={isEmptyRichDoc(draft)} onClick={submit}>
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
                  {(n.clientVisible ?? false) && (
                    <span className="cv-chip on" title="Client seats see this note">
                      Client-visible
                    </span>
                  )}
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
                        <button
                          className="btn ghost"
                          onClick={() =>
                            onUpdate(n.id, { clientVisible: !(n.clientVisible ?? false) })
                          }
                          title={
                            (n.clientVisible ?? false)
                              ? 'Make this note internal again'
                              : 'Let client seats see this note'
                          }
                        >
                          {(n.clientVisible ?? false) ? 'Make internal' : 'Show to client'}
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
                    <RichTextEditor
                      value={editBody}
                      onChange={setEditBody}
                      editable
                      people={people}
                      issues={issues}
                      onUploadImage={onUploadImage}
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
                        disabled={isEmptyRichDoc(editBody) || richDocsEqual(editBody, n.body)}
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
                  <div className="note-body">
                    <RichTextEditor
                      value={n.body}
                      onChange={() => {}}
                      editable={false}
                      people={people}
                      issues={issues}
                      onUploadImage={async () => null}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
