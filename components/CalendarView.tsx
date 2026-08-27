'use client'

import { useMemo, useState } from 'react'
import { calendarMonth, describeCalendar } from '@/lib/calendar'
import type { ScheduleRow } from '@/lib/types'

/**
 * One month of planned work, with the undated majority carried beside it.
 *
 * No mutation happens here — v1 is deliberately read-only, and dragging to reschedule is a
 * later decision rather than an omission (see the design). The screen’s one obligation is the
 * split: the header sentence states how much cannot be on any calendar, and the rail lists it.
 */
export default function CalendarView({
  rows,
  today,
  selectedId,
  onSelect,
}: {
  rows: ScheduleRow[]
  today: string
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [monthIso, setMonthIso] = useState(today.slice(0, 10))
  const [dayIso, setDayIso] = useState<string | null>(null)

  const m = useMemo(() => calendarMonth(rows, monthIso), [rows, monthIso])
  const monthKey = m.monthStart.slice(0, 7)
  const monthName = new Date(`${m.monthStart}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const shift = (months: number) => {
    const d = new Date(`${m.monthStart}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + months)
    setMonthIso(d.toISOString().slice(0, 10))
    setDayIso(null)
  }

  const dayRows = dayIso ? (m.weeks.flat().find((d) => d.date === dayIso)?.rows ?? []) : null

  return (
    <div className="cal" role="region" aria-label="Calendar">
      <div className="cal-head">
        <span className="cal-title">Calendar</span>
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
      </div>
      <div className="board-sub sentence">{describeCalendar(m)}</div>

      <div className="cal-body">
        <div className="cal-grid-wrap">
          <div className="cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="cal-dow">
                {d}
              </div>
            ))}
            {m.weeks.flat().map((day) => {
              const inMonth = day.date.slice(0, 7) === monthKey
              return (
                <button
                  key={day.date}
                  className={`cal-day${inMonth ? '' : ' outside'}${day.date === today ? ' today' : ''}${day.date === dayIso ? ' selected' : ''}`}
                  onClick={() => setDayIso(day.date === dayIso ? null : day.date)}
                  aria-label={`${day.date}, ${day.rows.length} items`}
                >
                  <span className="cal-day-num mono">{Number(day.date.slice(8))}</span>
                  {day.rows.slice(0, 3).map((r) => (
                    <span key={r.id} className="cal-chip" title={r.name}>
                      {r.displayId || r.name}
                    </span>
                  ))}
                  {day.rows.length > 3 && (
                    <span className="cal-more">+{day.rows.length - 3} more</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <aside className="cal-rail">
          {dayRows ? (
            <>
              <h3 className="cal-rail-title">
                {dayIso} · {dayRows.length} {dayRows.length === 1 ? 'item' : 'items'}
              </h3>
              {!dayRows.length && <p className="board-lane-empty">Nothing planned to span this day.</p>}
              {dayRows.map((r) => (
                <RailRow key={r.id} row={r} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </>
          ) : (
            <>
              <h3 className="cal-rail-title">Unscheduled · {m.undated.length}</h3>
              <p className="cal-rail-note">
                No planned date, so no place on any calendar. Listed rather than hidden — give one
                a planned end in the tree and it appears in the grid.
              </p>
              {m.undated.map((r) => (
                <RailRow key={r.id} row={r} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function RailRow({
  row,
  selectedId,
  onSelect,
}: {
  row: ScheduleRow
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <button
      className={`board-card${row.id === selectedId ? ' selected' : ''}`}
      onClick={() => onSelect(row.id)}
      title="Open in the detail panel"
    >
      <span className="board-card-id mono">{row.displayId}</span>
      <span className="board-card-name">{row.name}</span>
      <span className="board-card-meta">
        {row.severity && <span>{row.severity}</span>}
        {row.owner && <span>{row.owner}</span>}
      </span>
    </button>
  )
}
