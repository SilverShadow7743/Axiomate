'use client'

import { useMemo, useState } from 'react'
import type { PersonalAction } from '@/lib/personalActions'
import type { WorkspaceState } from '@/lib/workspace'

export interface PersonalActionInput {
  text: string
  dueDate?: string
}

/**
 * One person's own to-dos — mail that turned out not to be project work (converted from an
 * unconfirmed record), and anything typed in here. Always docked, inside `.view-dock`, the same
 * wrapper `MyCalendarPanel` uses: there is no modal to preserve, so no scrim/portal machinery.
 *
 * Nothing is filtered here on purpose. By the time state reaches this browser,
 * `lib/db/boot.ts`'s `redactForReader` has already withheld every row that is not the reader's
 * own (`personalActionsFor`, PA2) — so `state.personalActions` IS this person's list, and a
 * second filter in the component would only suggest the first one might not have run.
 *
 * Deliberately minimal, per the design: text, an optional due date, done/to-do. No priority,
 * no reminder.
 */
export default function MyTodosPanel({
  state,
  today,
  onAdd,
  onUpdate,
  onRemove,
}: {
  state: WorkspaceState
  today: string
  onAdd: (input: PersonalActionInput) => void
  onUpdate: (id: string, patch: Partial<Pick<PersonalAction, 'text' | 'dueDate' | 'status'>>) => void
  onRemove: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [showDone, setShowDone] = useState(false)

  const items = useMemo(() => {
    const live = Object.values(state.personalActions).filter((a) => !a.deletedAt)
    // Due date ascending, undated last, then oldest first — the order a person works a list in.
    return live.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'To do' ? -1 : 1
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [state.personalActions])

  const open = items.filter((a) => a.status === 'To do')
  const done = items.filter((a) => a.status === 'Done')

  const add = () => {
    const t = text.trim()
    if (!t) return
    onAdd({ text: t, ...(dueDate ? { dueDate } : {}) })
    setText('')
    setDueDate('')
  }

  const row = (a: PersonalAction) => {
    const overdue = a.status === 'To do' && a.dueDate !== undefined && a.dueDate < today
    return (
      <li key={a.id} className="todo-row">
        <label className="todo-check">
          <input
            type="checkbox"
            checked={a.status === 'Done'}
            onChange={(e) => onUpdate(a.id, { status: e.target.checked ? 'Done' : 'To do' })}
            aria-label={`${a.status === 'Done' ? 'Reopen' : 'Mark done'}: ${a.text}`}
          />
          <span className={a.status === 'Done' ? 'todo-done' : undefined}>{a.text}</span>
        </label>
        <span className="grow" />
        {a.sourceSubject && a.sourceSubject !== a.text && (
          <span className="prov" title="The mail this came from">from “{a.sourceSubject}”</span>
        )}
        <input
          type="date"
          value={a.dueDate ?? ''}
          aria-label={`Due date for ${a.text}`}
          className={overdue ? 'todo-overdue' : undefined}
          onChange={(e) => onUpdate(a.id, { dueDate: e.target.value })}
        />
        <button className="btn ghost" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.text}`}>
          Remove
        </button>
      </li>
    )
  }

  return (
    <div className="view-dock">
      <section className="cfg-section">
        <h3 className="cfg-h">My to-dos</h3>
        <p className="cfg-note">
          Yours alone — nothing here appears on the tree, in a report, or to anyone else. Mail
          you moved here from an unconfirmed record lands at the top; add anything else below.
        </p>

        <div className="cfg-fld-row">
          <label className="cfg-fld" style={{ flex: 1 }}>
            <span>New to-do</span>
            <input
              value={text}
              placeholder="What needs doing?"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
              }}
            />
          </label>
          <label className="cfg-fld">
            <span>Due (optional)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!text.trim()} onClick={add}>
            Add
          </button>
        </div>

        {open.length === 0 ? (
          <p className="panel-note">Nothing to do. Anything you move here from an unconfirmed record, or add above, shows here.</p>
        ) : (
          <ul className="todo-list">{open.map(row)}</ul>
        )}

        {done.length > 0 && (
          <>
            <button
              className={`btn ghost${showDone ? ' on' : ''}`}
              aria-pressed={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? 'Hide done' : `Show done (${done.length})`}
            </button>
            {showDone && <ul className="todo-list">{done.map(row)}</ul>}
          </>
        )}
      </section>
    </div>
  )
}
