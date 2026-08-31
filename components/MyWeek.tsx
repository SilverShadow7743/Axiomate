'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { apply, type Action, type WorkspaceState } from '@/lib/workspace'
import type { Actor } from '@/lib/actor'
import { can, directoryPersonFor } from '@/lib/access'
import { isTerminal } from '@/lib/schedule'
import { addDays, formatShort } from '@/lib/dates'
import { TIME_ACTIVITIES, checkEntry, type TimeActivity } from '@/lib/time'
import { backdated } from '@/lib/timeWindow'
import {
  daysOfWeek,
  entriesInWeek,
  sheetFor,
  submitProblem,
  weekLabel,
  weekStarting,
  weekTotal,
} from '@/lib/timesheet'

/**
 * My Week — the attestation loop on a phone browser. See
 * `docs/plans/2026-08-31-my-week-design.md`.
 *
 * Wiring only: every rule this page touches lives in the reducer and is already
 * scenario-owned. Each action is applied optimistically for the message or the refusal, then
 * posted alone on the same wire the autosave queue drains to; a failed post REVERTS and says
 * so — nothing on this page ever pretends to be saved.
 */

export default function MyWeek({
  initialState,
  actor,
  today,
  canWrite,
}: {
  initialState: WorkspaceState | null
  actor: Actor
  today: string
  canWrite: boolean
}) {
  const [state, setState] = useState<WorkspaceState | null>(initialState)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null)
  const thisWeek = weekStarting(today)
  const [week, setWeek] = useState(thisWeek)

  const [issueId, setIssueId] = useState('')
  const [date, setDate] = useState(today)
  const [hours, setHours] = useState('')
  const [activity, setActivity] = useState<TimeActivity>('Resolution')
  const [billable, setBillable] = useState(true)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})

  const me = actor.name
  const myId = state ? (directoryPersonFor(state.model, actor)?.id ?? null) : null
  const mayApprove = state ? can(state.model, actor, 'time.approve').allowed : false
  const maySubmit = state ? can(state.model, actor, 'time.submit').allowed : false

  const myIssues = useMemo(() => {
    if (!state) return []
    return Object.values(state.issues)
      .filter((i) => !i.deletedAt && i.owner.trim().toLowerCase() === me.trim().toLowerCase() && !isTerminal(i.status))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
  }, [state, me])

  const entries = useMemo(() => (state ? Object.values(state.timeEntries) : []), [state])
  const weekDays = daysOfWeek(week)
  const mine = state ? entriesInWeek(entries, me, week, myId) : []
  const total = state ? weekTotal(entries, me, week, myId) : { hours: 0, billable: 0 }
  const sheet = state ? sheetFor(Object.values(state.timesheets), me, week, myId) : null

  const chosen = state && issueId ? state.issues[issueId] : undefined
  const lateness = backdated(date, today, state?.model.timePolicy.backdatingAllowanceDays ?? 3)
  const onClosedWork = isTerminal(chosen?.status ?? null)
  const needsReason = lateness.justificationRequired || onClosedWork
  const problem = hours.trim() ? checkEntry({ hours: Number(hours), date, person: me }, today) : null

  /** Optimistic apply, single-action post, revert-and-say-so on a failed wire. */
  const dispatch = async (action: Action): Promise<boolean> => {
    if (!state) return false
    const before = state
    const res = apply(state, action, actor)
    if (res.error) {
      setNotice({ text: res.error, bad: true })
      return false
    }
    setState(res.state)
    if (res.message) setNotice({ text: res.message, bad: false })
    if (!canWrite) return true
    setBusy(true)
    try {
      const posted = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actions: [action] }),
      })
      if (!posted.ok) throw new Error(`server said ${posted.status}`)
      const body = (await posted.json()) as { ok?: boolean; error?: string }
      if (body.ok === false) throw new Error(body.error ?? 'the server refused the write')
      return true
    } catch (err) {
      setState(before)
      setNotice({
        text: `Nothing was saved — ${err instanceof Error ? err.message : 'the server could not be reached'}. Try again.`,
        bad: true,
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  const record = async () => {
    const ok = await dispatch({
      t: 'addTime',
      issueId,
      person: me,
      date,
      hours: Number(hours),
      activity,
      billable,
      note: note.trim(),
      justification: reason.trim() || undefined,
      now: new Date().toISOString(),
    } as Action)
    if (ok) {
      setHours('')
      setNote('')
      setReason('')
    }
  }

  const cannotSubmit = state
    ? submitProblem(Object.values(state.timesheets), me, week, {
        name: me,
        maySubmit,
        mayApprove,
      })
    : 'No workspace.'

  const submittedQueue = useMemo(() => {
    if (!state || !mayApprove) return []
    return Object.values(state.timesheets)
      .filter((t) => t.status === 'Submitted')
      .sort((a, b) => a.weekStarting.localeCompare(b.weekStarting))
  }, [state, mayApprove])

  if (!state) {
    return (
      <main className="mw">
        <p className="mw-note">The workspace is empty for this sign-in — the banner on the main page says why.</p>
        <Link href="/">Open the workspace</Link>
      </main>
    )
  }

  return (
    <main className="mw">
      <header className="mw-head">
        <h1>My week</h1>
        <Link href="/" className="mw-desktop-link">
          Full workspace →
        </Link>
      </header>

      <div className="mw-weekpick" role="tablist" aria-label="Which week">
        {[addDays(thisWeek, -7), thisWeek].map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={week === w}
            className={`mw-tab${week === w ? ' on' : ''}`}
            onClick={() => setWeek(w)}
          >
            {w === thisWeek ? 'This week' : 'Last week'}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`mw-notice${notice.bad ? ' bad' : ''}`} role="status">
          {notice.text}
        </p>
      )}

      {sheet && (
        <p className={`mw-sheet mw-sheet-${sheet.status.toLowerCase()}`}>
          {sheet.status === 'Submitted' && `The ${weekLabel(week)} is submitted and awaiting a decision.`}
          {sheet.status === 'Approved' && `The ${weekLabel(week)} is approved — it is frozen.`}
          {sheet.status === 'Rejected' && `The ${weekLabel(week)} was returned: ${sheet.reason ?? ''} Fix it and submit again.`}
        </p>
      )}

      <section aria-label="Days">
        {weekDays.map((d) => {
          const dayEntries = mine.filter((e) => e.date === d)
          const dayTotal = Math.round(dayEntries.reduce((t, e) => t + e.hours, 0) * 100) / 100
          return (
            <div key={d} className={`mw-day${d === today ? ' today' : ''}`}>
              <div className="mw-day-head">
                <span>{formatShort(d)}</span>
                <span className="mw-day-total">{dayTotal ? `${dayTotal}h` : '—'}</span>
              </div>
              {dayEntries.map((e) => (
                <div key={e.id} className="mw-entry">
                  <span className="mw-entry-issue">{e.issueId}</span>
                  <span>{e.hours}h · {e.activity}{e.billable ? '' : ' · non-billable'}</span>
                  {e.justification && <span className="mw-entry-reason">“{e.justification}”</span>}
                </div>
              ))}
            </div>
          )
        })}
      </section>

      <p className="mw-total">
        {total.hours}h this week · {total.billable}h billable
      </p>

      <section className="mw-form" aria-label="Record hours">
        <h2>Record hours</h2>
        <label>
          <span>Work item (yours, open)</span>
          <select value={issueId} onChange={(e) => setIssueId(e.target.value)}>
            <option value="">Choose…</option>
            {myIssues.map((i) => (
              <option key={i.id} value={i.id}>
                {i.id} — {i.subject.slice(0, 48)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Day</span>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {weekDays.map((d) => (
              <option key={d} value={d}>{formatShort(d)}</option>
            ))}
          </select>
        </label>
        <div className="mw-row">
          <label>
            <span>Hours</span>
            <input type="number" step={0.25} min={0.25} max={12} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label>
            <span>Activity</span>
            <select value={activity} onChange={(e) => setActivity(e.target.value as TimeActivity)}>
              {TIME_ACTIVITIES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mw-check">
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          <span>Billable</span>
        </label>
        <label>
          <span>Note — optional</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {needsReason && (
          <label>
            <span>{onClosedWork ? 'Why on closed work' : 'Why so late'}</span>
            <input
              value={reason}
              placeholder={
                onClosedWork
                  ? 'This item is closed — the reason reopens its window; the approver reads it.'
                  : `${lateness.days} days after the work — the approver reads this.`
              }
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        {problem && <p className="mw-notice bad">{problem.message}</p>}
        <button
          className="mw-btn primary"
          disabled={busy || !issueId || !hours.trim() || Boolean(problem) || (needsReason && !reason.trim())}
          onClick={record}
        >
          Record
        </button>
      </section>

      <section className="mw-form" aria-label="Submit the week">
        {cannotSubmit ? (
          <p className="mw-note">{cannotSubmit}</p>
        ) : (
          <button
            className="mw-btn primary"
            disabled={busy || total.hours === 0}
            onClick={() =>
              dispatch({ t: 'submitTimesheet', person: me, weekStarting: week, now: new Date().toISOString() } as Action)
            }
          >
            Submit the {weekLabel(week)} — {total.hours}h
          </button>
        )}
      </section>

      {mayApprove && submittedQueue.length > 0 && (
        <section className="mw-form" aria-label="Waiting on your decision">
          <h2>Waiting on your decision</h2>
          {submittedQueue.map((t) => {
            const justified = entriesInWeek(entries, t.person, t.weekStarting, t.personId).filter(
              (e) => e.justification,
            )
            const wtotal = weekTotal(entries, t.person, t.weekStarting, t.personId)
            return (
              <div key={t.id} className="mw-decide">
                <div className="mw-decide-head">
                  <b>{t.person}</b> · {weekLabel(t.weekStarting)} · {wtotal.hours}h ({wtotal.billable}h billable)
                </div>
                {justified.map((e) => (
                  <p key={e.id} className="mw-entry-reason">
                    {formatShort(e.date)} {e.hours}h — “{e.justification}”
                  </p>
                ))}
                <div className="mw-row">
                  <button
                    className="mw-btn primary"
                    disabled={busy}
                    onClick={() =>
                      dispatch({ t: 'decideTimesheet', id: t.id, decision: 'approved', now: new Date().toISOString() } as Action)
                    }
                  >
                    Approve
                  </button>
                  <input
                    className="mw-reject-input"
                    placeholder="Reason to return it"
                    value={rejectReason[t.id] ?? ''}
                    onChange={(e) => setRejectReason((p) => ({ ...p, [t.id]: e.target.value }))}
                    aria-label={`Reason for returning ${t.person}'s week`}
                  />
                  <button
                    className="mw-btn"
                    disabled={busy || !(rejectReason[t.id] ?? '').trim()}
                    onClick={() =>
                      dispatch({
                        t: 'decideTimesheet',
                        id: t.id,
                        decision: 'rejected',
                        reason: (rejectReason[t.id] ?? '').trim(),
                        now: new Date().toISOString(),
                      } as Action)
                    }
                  >
                    Return
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <p className="mw-note">
        Two weeks of reach; corrections beyond adding hours live in the full workspace.
      </p>
    </main>
  )
}
