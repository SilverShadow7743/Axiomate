'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { directoryPersonFor } from '@/lib/access'
import { profileAt, type Commitment } from '@/lib/capacity'
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

export interface LeaveInput {
  startDate: string
  endDate: string
  hoursPerDay: number
  /** Private to the subject and the leave.approve holders — never in any notification body. */
  reason?: string
  note: string
}

/**
 * One person's month — events, leave, allocation and their own due dates, gathered. Always
 * docked: unlike TimesheetPanel/Inbox, there is no existing modal to preserve here, so this
 * has no scrim/portal machinery at all — it is rendered once, inside `.view-dock`, the same
 * wrapper `MyWorkPanel`/`TimesheetPanel`/`Inbox` already use for their docked instance.
 *
 * Events and the person's OWN leave are editable here (E2: leave is calendar-shaped, and this
 * is where a person stands to ask for it — the Capacity panel remains the team view and the
 * approver-records-other flow). Allocation and work stay facts recorded elsewhere (Capacity,
 * the tree) — gathered, not managed. A leave write goes through the same `upsertCommitment`
 * arm as everywhere else, so a self-write lands Requested by the arm's rule, never by this
 * screen's opinion.
 */
export default function MyCalendarPanel({
  state,
  actor,
  today,
  onAdd,
  onUpdate,
  onRemove,
  onSelectWork,
  onRequestLeave,
  onUpdateLeave,
  onWithdrawLeave,
}: {
  state: WorkspaceState
  actor: Actor
  today: string
  onAdd: (input: PersonalEventInput) => boolean
  onUpdate: (id: string, patch: Partial<PersonalEventInput>) => void
  onRemove: (id: string) => void
  onSelectWork: (issueId: string) => void
  onRequestLeave: (input: LeaveInput) => boolean
  onUpdateLeave: (id: string, input: LeaveInput) => boolean
  onWithdrawLeave: (id: string) => void
}) {
  const meId = directoryPersonFor(state.model, actor)?.id ?? null
  const [monthIso, setMonthIso] = useState(today.slice(0, 10))
  const [dayIso, setDayIso] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 'new' for a fresh request; a commitment id when editing an existing one. */
  const [leaveEditing, setLeaveEditing] = useState<string | null>(null)

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
          <button className="btn" onClick={() => setLeaveEditing('new')}>
            Request leave
          </button>
          <button className="btn primary" onClick={() => setEditingId('new')}>
            Add event
          </button>
        </div>
        <div className="board-sub sentence">
          Private to you — nobody else, including an administrator, can see this. Leave is the
          one exception: its dates are visible to the firm&rsquo;s planners because they move
          availability; its reason stays private to you and leave approvers.
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
                {dayEntries.map((e) => {
                  // Own leave is manageable here — the grid only ever holds the viewer's rows,
                  // so a commitment entry that resolves to a Leave row is theirs to act on.
                  const leave = e.kind === 'commitment' ? state.commitments[e.id] : undefined
                  return leave && leave.kind === 'Leave' ? (
                    <div key={e.id} className="board-card">
                      <span className="board-card-name">
                        Leave {leave.startDate} → {leave.endDate} · {leave.hoursPerDay}h/day
                      </span>
                      <span className="prov">
                        {leave.status ?? 'Approved'}
                        {leave.status === 'Returned' && ' — edit the dates to ask again, or withdraw it'}
                      </span>
                      <span className="board-card-meta">
                        <button className="btn-link" onClick={() => setLeaveEditing(leave.id)}>
                          Edit
                        </button>
                        <button className="btn-link" onClick={() => onWithdrawLeave(leave.id)}>
                          Withdraw
                        </button>
                      </span>
                    </div>
                  ) : (
                    <EntryRow key={e.id} entry={e} onSelectWork={onSelectWork} onEdit={setEditingId} onRemove={onRemove} />
                  )
                })}
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

      {leaveEditing && (
        <LeaveForm
          existing={leaveEditing !== 'new' ? state.commitments[leaveEditing] : undefined}
          defaultDate={dayIso ?? today}
          defaultHours={
            profileAt(Object.values(state.versions), state.model.resourceProfiles, meId ?? '', today)?.hoursPerDay ?? 7.5
          }
          onSave={(input) => {
            const saved = leaveEditing === 'new' ? onRequestLeave(input) : onUpdateLeave(leaveEditing, input)
            if (saved) setLeaveEditing(null)
          }}
          onClose={() => setLeaveEditing(null)}
        />
      )}
    </div>
  )
}

function LeaveForm({
  existing,
  defaultDate,
  defaultHours,
  onSave,
  onClose,
}: {
  existing?: Commitment
  defaultDate: string
  defaultHours: number
  onSave: (input: LeaveInput) => void
  onClose: () => void
}) {
  const [startDate, setStartDate] = useState(existing?.startDate ?? defaultDate)
  const [endDate, setEndDate] = useState(existing?.endDate ?? defaultDate)
  const [hoursPerDay, setHours] = useState(String(existing?.hoursPerDay ?? defaultHours))
  const [reason, setReason] = useState(existing?.reason ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const valid = Boolean(startDate && endDate && endDate >= startDate && Number(hoursPerDay) > 0)
  const reopens = Boolean(existing && (existing.status ?? 'Approved') !== 'Requested')

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal via the Cancel button
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={existing ? 'Edit leave request' : 'Request leave'}>
        <div className="modal-head">
          <b>{existing ? 'Edit leave request' : 'Request leave'}</b>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="prov">
            Your request lands with the leave approvers to decide. The dates are visible to the
            firm&rsquo;s planners because they move availability; the reason below is private to
            you and leave approvers.
          </p>
          {reopens && (
            <p className="prov">
              This request was already decided — changing its dates or hours re-opens it for a
              fresh decision.
            </p>
          )}
          <label className="fld">
            <span className="fld-label">First day</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} autoFocus />
          </label>
          <label className="fld">
            <span className="fld-label">Last day</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld-label">Hours per day</span>
            <input type="number" min="0.5" step="0.5" value={hoursPerDay} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld-label">Why (private)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — only you and leave approvers see this" />
          </label>
          <label className="fld">
            <span className="fld-label">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — visible like any commitment note" />
          </label>
          <div className="time-row">
            <button
              className="btn primary"
              disabled={!valid}
              onClick={() =>
                onSave({
                  startDate,
                  endDate,
                  hoursPerDay: Number(hoursPerDay),
                  reason: reason.trim() || undefined,
                  note,
                })
              }
            >
              {existing ? 'Save' : 'Request'}
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
