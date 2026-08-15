'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import type { WorkspaceState } from '@/lib/workspace'
import {
  MAX_HOURS_PER_ENTRY,
  TIME_ACTIVITIES,
  checkEntry,
  effortVariance,
  entriesFor,
  summariseTime,
  type TimeActivity,
  type TimeEntry,
} from '@/lib/time'
import { formatIso } from '@/lib/dates'

/**
 * Hours recorded against this issue.
 *
 * Two decisions worth stating, because both cost something.
 *
 * **The form defaults to today and to the person using it.** Time is recorded late far more
 * often than it is recorded wrong, and every extra field between somebody finishing a task and
 * logging it is a reason to do it tomorrow instead — which is how a week of hours becomes an
 * estimate of a week of hours. The date is still editable, because "late" is the normal case.
 *
 * **Billable is a switch, not a derivation.** It would be easy to infer it from the engagement,
 * and wrong: rework after a mistake of ours is non-billable on a time-and-materials job, and a
 * goodwill fix is non-billable on any job. The exceptions are the whole point of recording it.
 */
export default function TimeTab({
  issueId,
  state,
  actor,
  today,
  onAdd,
  onRemove,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  today: string
  onAdd: (entry: {
    person: string
    date: string
    hours: number
    activity: TimeActivity
    billable: boolean
    note: string
  }) => boolean
  onRemove: (id: string) => void
}) {
  const may = can(state.model, actor, 'time.record')
  const mayOthers = can(state.model, actor, 'time.recordForOthers')

  const entries = useMemo(() => entriesFor(state.timeEntries, issueId), [state.timeEntries, issueId])
  const summary = useMemo(() => summariseTime(state.timeEntries, issueId), [state.timeEntries, issueId])
  const variance = useMemo(
    () => effortVariance(state.timeEntries, issueId, state.estimates[issueId], state.model.sizeBands),
    [state.timeEntries, issueId, state.estimates, state.model.sizeBands],
  )

  const [person, setPerson] = useState(actor.name)
  const [date, setDate] = useState(today)
  const [hours, setHours] = useState('')
  const [activity, setActivity] = useState<TimeActivity>('Resolution')
  const [billable, setBillable] = useState(true)
  const [note, setNote] = useState('')

  const parsed = Number(hours)
  const problem = hours.trim() ? checkEntry({ hours: parsed, date, person }, today) : null

  const submit = () => {
    if (problem || !hours.trim()) return
    if (onAdd({ person, date, hours: parsed, activity, billable, note })) {
      setHours('')
      setNote('')
    }
  }

  return (
    <div className="time-tab">
      <section className="est-summary">
        <div className="est-block">
          <span className="est-block-label">Recorded</span>
          <span className="est-block-value mono">{summary.hours}h</span>
          <span className="est-block-note">
            {summary.billable}h billable · {summary.nonBillable}h not
          </span>
        </div>
        <div className="est-block">
          <span className="est-block-label">Against estimate</span>
          <span className="est-block-value mono">
            {variance.estimated === null ? '—' : `${variance.estimated}h`}
          </span>
          <span className="est-block-note">
            {variance.estimated === null
              ? 'nothing estimated yet'
              : variance.varianceHours === 0
                ? 'exactly on it'
                : `${variance.varianceHours! > 0 ? 'over by' : 'under by'} ${Math.abs(variance.varianceHours!)}h`}
          </span>
        </div>
        <div className="est-block">
          <span className="est-block-label">People</span>
          <span className="est-block-value mono">{summary.people.length}</span>
          <span className="est-block-note">
            {summary.people.length ? summary.people.join(', ') : 'nobody yet'}
          </span>
        </div>
        <div className="est-block">
          <span className="est-block-label">Span</span>
          <span className="est-block-value mono">
            {summary.first ? formatIso(summary.first) : '—'}
          </span>
          <span className="est-block-note">
            {summary.last && summary.last !== summary.first ? `to ${formatIso(summary.last)}` : 'first entry'}
          </span>
        </div>
      </section>

      {!may.allowed ? (
        <div className="panel-note">{may.reason ?? 'Read only.'}</div>
      ) : (
        <section className="time-form">
          <h4 className="est-h">Record time</h4>
          <div className="time-row">
            <label className="fld time-fld-person">
              <span className="fld-label">Who</span>
              <input
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                disabled={!mayOthers.allowed}
                title={mayOthers.allowed ? undefined : mayOthers.reason}
              />
            </label>
            <label className="fld">
              <span className="fld-label">Day</span>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="fld time-fld-hours">
              <span className="fld-label">Hours</span>
              <input
                type="number"
                step={0.25}
                min={0.25}
                max={MAX_HOURS_PER_ENTRY}
                value={hours}
                placeholder="0.00"
                onChange={(e) => setHours(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </label>
            <label className="fld">
              <span className="fld-label">Doing what</span>
              <select value={activity} onChange={(e) => setActivity(e.target.value as TimeActivity)}>
                {TIME_ACTIVITIES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="fld time-fld-billable">
              <span className="fld-label">Billable</span>
              <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
            </label>
          </div>
          <div className="time-row">
            <label className="fld time-fld-note">
              <span className="fld-label">Note</span>
              <input
                value={note}
                placeholder="What was done — optional, and useful three months later"
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </label>
            <button className="btn primary" onClick={submit} disabled={!hours.trim() || Boolean(problem)}>
              Record
            </button>
          </div>
          {problem && <p className="ov-gate">{problem.message}</p>}
        </section>
      )}

      {entries.length === 0 ? (
        <p className="panel-note">
          No time recorded against this issue. Until there is, effort variance has nothing to
          compare an estimate against — which is why the Estimation tab reports it as unknown
          rather than as zero.
        </p>
      ) : (
        <section>
          <h4 className="est-h">Entries</h4>
          <table className="cfg-table est-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Who</th>
                <th>Hours</th>
                <th>Doing what</th>
                <th>Billable</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{formatIso(e.date)}</td>
                  <td>{e.person}</td>
                  <td className="mono">{e.hours}</td>
                  <td>{e.activity}</td>
                  <td>{e.billable ? 'Yes' : <span className="prov">No</span>}</td>
                  <td>
                    {e.note || <span className="prov">—</span>}
                    {e.updatedAt && (
                      <span className="prov"> · corrected by {e.updatedBy}</span>
                    )}
                  </td>
                  <td>
                    {mayRemove(e, actor, mayOthers.allowed) && (
                      <button className="btn-link" onClick={() => onRemove(e.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.byActivity.length > 1 && (
            <p className="cfg-inherit">
              {summary.byActivity.map((x) => `${x.activity} ${x.hours}h`).join(' · ')}
            </p>
          )}
        </section>
      )}

      <p className="panel-note">
        Removing an entry withdraws it rather than destroying it, and the trail keeps what it
        said. Hours drive money, and an entry that could vanish is an entry nobody can reconcile
        against an invoice.
      </p>
    </div>
  )
}

/** Own hours, or the grant to touch anybody else's. */
function mayRemove(entry: TimeEntry, actor: Actor, hasOverride: boolean): boolean {
  return entry.person.toLowerCase() === actor.name.toLowerCase() || hasOverride
}
