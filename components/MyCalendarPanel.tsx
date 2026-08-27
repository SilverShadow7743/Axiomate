'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { directoryPersonFor } from '@/lib/access'
import { myCalendarMonth, type MyCalendarEntry } from '@/lib/myCalendar'
import type { WorkspaceState } from '@/lib/workspace'

export interface PersonalEventInput {
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  note: string
  attendees: string
}

/**
 * One person's month — events, leave, allocation and their own due dates, gathered. Always
 * docked: unlike TimesheetPanel/Inbox, there is no existing modal to preserve here, so this
 * has no scrim/portal machinery at all — it is rendered once, inside `.view-dock`, the same
 * wrapper `MyWorkPanel`/`TimesheetPanel`/`Inbox` already use for their docked instance.
 *
 * Only events are editable here. Leave, allocation and work are facts recorded elsewhere
 * (Capacity, the Time tab, the tree) — this screen gathers them, it does not manage them, the
 * same posture `TimesheetPanel`'s own header comment states about itself: "It GATHERS and it
 * decides; it never edits."
 */
export default function MyCalendarPanel({
  state,
  actor,
  today,
  onAdd,
  onUpdate,
  onRemove,
  onSelectWork,
}: {
  state: WorkspaceState
  actor: Actor
  today: string
  onAdd: (input: PersonalEventInput) => boolean
  onUpdate: (id: string, patch: Partial<PersonalEventInput>) => void
  onRemove: (id: string) => void
  onSelectWork: (issueId: string) => void
}) {
  const meId = directoryPersonFor(state.model, actor)?.id ?? null
  const [monthIso, setMonthIso] = useState(today.slice(0, 10))
  const [dayIso, setDayIso] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const month = useMemo(() => myCalendarMonth(state, meId, monthIso), [state, meId, monthIso])
  const monthKey = month.monthStart.slice(0, 7)
  const monthName = new Date(`${month.monthStart}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const shift = (months: number) => {
    const d = new Date(`${month.monthStart}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + months)
    setMonthIso(d.toISOString().slice(0, 10))
    setDayIso(null)
  }

  const dayEntries = dayIso ? (month.weeks.flat().find((d) => d.date === dayIso)?.entries ?? []) : null

  if (!meId) {
    return (
      <div className="view-dock">
        <div className="cal docked">
          <p className="panel-note">
            This sign-in matches no directory entry, so there is no calendar to show. Ask the
            firm to add you.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="view-dock">
      <div className="cal docked" role="region" aria-label="My calendar">
        <div className="cal-head">
          <span className="cal-title">My calendar</span>
          <div className="segmented" role="group" aria-label="Month">
            <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <button
              onClick={() => {
                setMonthIso(today.slice(0, 10))
                setDayIso(null)
              }}
            >
              Today
            </button>
            <button onClick={() => shift(1)} aria-label="Next month">›</button>
          </div>
          <span className="cal-month">{monthName}</span>
          <span className="grow" />
          <button className="btn primary" onClick={() => setEditingId('new')}>
            Add event
          </button>
        </div>
        <div className="board-sub sentence">
          Private to you — nobody else, including an administrator, can see this.
        </div>

        <div className="cal-body">
          <div className="cal-grid-wrap">
            <div className="cal-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="cal-dow">
                  {d}
                </div>
              ))}
              {month.weeks.flat().map((day) => {
                const inMonth = day.date.slice(0, 7) === monthKey
                return (
                  <button
                    key={day.date}
                    className={`cal-day${inMonth ? '' : ' outside'}${day.date === today ? ' today' : ''}${day.date === dayIso ? ' selected' : ''}`}
                    onClick={() => setDayIso(day.date === dayIso ? null : day.date)}
                    aria-label={`${day.date}, ${day.entries.length} items`}
                  >
                    <span className="cal-day-num mono">{Number(day.date.slice(8))}</span>
                    {day.entries.slice(0, 3).map((e) => (
                      <span key={e.id} className={`cal-chip cal-chip-${e.kind}`} title={entryLabel(e)}>
                        {entryLabel(e)}
                      </span>
                    ))}
                    {day.entries.length > 3 && <span className="cal-more">+{day.entries.length - 3} more</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <aside className="cal-rail">
            {dayEntries ? (
              <>
                <h3 className="cal-rail-title">
                  {dayIso} · {dayEntries.length} {dayEntries.length === 1 ? 'item' : 'items'}
                </h3>
                {!dayEntries.length && <p className="board-lane-empty">Nothing on this day.</p>}
                {dayEntries.map((e) => (
                  <EntryRow key={e.id} entry={e} onSelectWork={onSelectWork} onEdit={setEditingId} onRemove={onRemove} />
                ))}
              </>
            ) : (
              <>
                <h3 className="cal-rail-title">Unscheduled work · {month.unscheduled.length}</h3>
                <p className="cal-rail-note">
                  No planned date, so no place on any calendar. Give one a planned end in the tree
                  and it appears in the grid.
                </p>
                {month.unscheduled.map((u) => (
                  <button key={u.issueId} className="board-card" onClick={() => onSelectWork(u.issueId)}>
                    <span className="board-card-name">{u.title}</span>
                  </button>
                ))}
              </>
            )}
          </aside>
        </div>
      </div>

      {editingId && (
        <EventForm
          existing={editingId !== 'new' ? Object.values(state.personalEvents).find((e) => e.id === editingId) : undefined}
          defaultDate={dayIso ?? today}
          onSave={(input) => {
            if (editingId === 'new') {
              if (onAdd(input)) setEditingId(null)
            } else {
              onUpdate(editingId, input)
              setEditingId(null)
            }
          }}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

function entryLabel(e: MyCalendarEntry): string {
  switch (e.kind) {
    case 'event':
      return e.title
    case 'commitment':
      return e.label
    case 'allocation':
      return e.label
    case 'work':
      return e.title
  }
}

function EntryRow({
  entry,
  onSelectWork,
  onEdit,
  onRemove,
}: {
  entry: MyCalendarEntry
  onSelectWork: (issueId: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (entry.kind === 'work') {
    return (
      <button className="board-card" onClick={() => onSelectWork(entry.issueId)}>
        <span className="board-card-name">{entry.title}</span>
      </button>
    )
  }
  if (entry.kind === 'event') {
    return (
      <div className="board-card">
        <span className="board-card-name">{entry.title}</span>
        <span className="board-card-meta">
          <button className="btn-link" onClick={() => onEdit(entry.id)}>
            Edit
          </button>
          <button className="btn-link" onClick={() => onRemove(entry.id)}>
            Remove
          </button>
        </span>
      </div>
    )
  }
  // commitment / allocation — recorded elsewhere, read-only here.
  return (
    <div className="board-card">
      <span className="board-card-name">{entry.label}</span>
    </div>
  )
}

function EventForm({
  existing,
  defaultDate,
  onSave,
  onClose,
}: {
  existing?: { id: string; title: string; startAt: string; endAt: string; allDay: boolean; note: string; attendees: string }
  defaultDate: string
  onSave: (input: PersonalEventInput) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [startAt, setStartAt] = useState(existing?.startAt.slice(0, 16) ?? `${defaultDate}T09:00`)
  const [endAt, setEndAt] = useState(existing?.endAt.slice(0, 16) ?? `${defaultDate}T10:00`)
  const [allDay, setAllDay] = useState(existing?.allDay ?? false)
  const [note, setNote] = useState(existing?.note ?? '')
  const [attendees, setAttendees] = useState(existing?.attendees ?? '')

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal via the Cancel button
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={existing ? 'Edit event' : 'Add event'}>
        <div className="modal-head">
          <b>{existing ? 'Edit event' : 'Add event'}</b>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <label className="fld">
            <span className="fld-label">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="fld">
            <span className="fld-label">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
            </span>
          </label>
          <label className="fld">
            <span className="fld-label">Start</span>
            <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? startAt.slice(0, 10) : startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld-label">End</span>
            <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? endAt.slice(0, 10) : endAt} onChange={(e) => setEndAt(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld-label">Attendees</span>
            <input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Free text — a note to yourself, not an invitation" />
          </label>
          <label className="fld">
            <span className="fld-label">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          <div className="time-row">
            <button
              className="btn primary"
              disabled={!title.trim()}
              onClick={() =>
                onSave({
                  title,
                  startAt: new Date(allDay ? `${startAt.slice(0, 10)}T00:00` : startAt).toISOString(),
                  endAt: new Date(allDay ? `${endAt.slice(0, 10)}T23:59` : endAt).toISOString(),
                  allDay,
                  note,
                  attendees,
                })
              }
            >
              Save
            </button>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
