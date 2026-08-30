'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { addDays, formatIso, formatShort } from '@/lib/dates'
import { isTerminal } from '@/lib/schedule'
import {
  weekStarting,
  weekLabel,
  weekTotal,
  daysOfWeek,
  issueWeekCells,
  sheetFor,
  submitProblem,
  decideProblem,
} from '@/lib/timesheet'
import { backdated, gridSaveProblem } from '@/lib/timeWindow'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface WeekDraft {
  hours: string
  activity: TimeActivity
  billable: boolean
  note: string
  justification: string
}

const EMPTY_DRAFT: WeekDraft = { hours: '', activity: 'Resolution', billable: true, note: '', justification: '' }

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
  onUpdate,
  onSubmitWeek,
  onDecideWeek,
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
    /** Record against one task of this issue. Absent means work-level — the default. */
    activityId?: string
    /** Required by the reducer when the entry lags the work past the workspace's allowance. */
    justification?: string
  }) => boolean
  onRemove: (id: string) => void
  /** Present a week for approval. Returns false when the reducer refused. */
  onSubmitWeek: (person: string, week: string) => boolean
  /** Approve or return. `reason` is required on a return and ignored on an approval. */
  onDecideWeek: (id: string, decision: 'approved' | 'rejected', reason?: string) => boolean
  /**
   * Correct an entry.
   *
   * The reducer arm, the API allowlist entry and the persist arm all existed and no screen
   * dispatched it — so an hour could be logged and withdrawn but not corrected, and the only
   * way to fix a typo was to delete the record of the work and write a new one.
   */
  onUpdate: (
    id: string,
    patch: { hours?: number; note?: string; billable?: boolean; justification?: string },
  ) => boolean
}) {
  const may = can(state.model, actor, 'time.record')
  const mayOthers = can(state.model, actor, 'time.recordForOthers')
  const maySubmit = can(state.model, actor, 'time.submit')
  const mayApprove = can(state.model, actor, 'time.approve')

  const entries = useMemo(() => entriesFor(state.timeEntries, issueId), [state.timeEntries, issueId])
  const summary = useMemo(() => summariseTime(state.timeEntries, issueId), [state.timeEntries, issueId])
  const variance = useMemo(
    () => effortVariance(state.timeEntries, issueId, state.estimates[issueId], state.model.sizeBands),
    [state.timeEntries, issueId, state.estimates, state.model.sizeBands],
  )

  /*
   * The week being attested to is the one containing the date in the form, not "this week".
   * Somebody entering Friday's hours on Monday is looking at last week, and a Submit control
   * that quietly meant a different week from the one on screen would be the worst kind of
   * wrong — it would work.
   */
  const [person, setPerson] = useState(actor.name)
  const [date, setDate] = useState(today)
  const [hours, setHours] = useState('')
  const [activity, setActivity] = useState<TimeActivity>('Resolution')
  const [billable, setBillable] = useState(true)
  const [note, setNote] = useState('')
  const [justification, setJustification] = useState('')
  /** Which task the hours executed — '' is work-level, the shape every entry had before
   *  task-level time and still the default: a picker in front of the ordinary case would be
   *  the same friction the date default exists to avoid. */
  const [taskId, setTaskId] = useState('')

  const tasks = useMemo(
    () =>
      Object.values(state.activities)
        .filter((t) => t.issueId === issueId && !t.deletedAt)
        .sort((x, y) => x.order - y.order),
    [state.activities, issueId],
  )

  const parsed = Number(hours)
  const problem = hours.trim() ? checkEntry({ hours: parsed, date, person }, today) : null
  /*
   * The lateness, live as the date changes, from the same rule the reducer applies — though
   * the reducer judges by the SERVER's clock, so this hint is a preview and the arm is the
   * authority. The reason box appears only when the policy demands it: a reason box in front
   * of the ordinary case is exactly what the allowance exists to avoid.
   */
  const lateness = backdated(date, today, state.model.timePolicy.backdatingAllowanceDays)
  /*
   * Closed work reopens its window with a reason — the extension the refusal message always
   * promised. The box appears BEFORE the refusal would, so the flow is one step, and the same
   * field serves lateness when both apply: an entry carries one justification.
   */
  const onClosedWork = isTerminal(state.issues[issueId]?.status ?? null)
  const needsReason = lateness.justificationRequired || onClosedWork

  /* ---------------- the week, and whether it is still theirs ---------------- */

  const sheets = useMemo(() => Object.values(state.timesheets), [state.timesheets])
  const week = weekStarting(date)
  const sheet = sheetFor(sheets, person, week)
  const total = useMemo(
    () => weekTotal(Object.values(state.timeEntries), person, week),
    [state.timeEntries, person, week],
  )
  /** The week's late entries, every issue included — the week is attested whole. */
  const lateInWeek = useMemo(
    () =>
      Object.values(state.timeEntries).filter(
        (e) =>
          !e.deletedAt && e.person === person && weekStarting(e.date) === week && e.justification,
      ),
    [state.timeEntries, person, week],
  )
  const attester = {
    name: actor.name,
    maySubmit: maySubmit.allowed,
    mayApprove: mayApprove.allowed,
  }
  const cannotSubmit = submitProblem(sheets, person, week, attester)
  const cannotApprove = decideProblem(sheet, 'approved', undefined, attester)
  const [returnReason, setReturnReason] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const cannotReturn = decideProblem(sheet, 'rejected', returnReason, attester)

  /* ---------------- the weekly grid: a second way to fill in the same form ---------------- */

  /**
   * Its own week, independent of the Quick Record `date` above.
   *
   * `sheetPanel` above reads `week`, derived from the Quick Record date — that binding is
   * unchanged. The grid gets a second, separate week so that paging through it with
   * Previous/Next cannot move what `sheetPanel` reports; `TimesheetPanel` already establishes
   * this exact shape (its own `useState` week, moved by `addDays(week, ±7)`) for the same
   * reason: two week pickers on one screen that quietly shared state would be the confusing
   * kind of bug, the kind that looks like it works.
   */
  const [mode, setMode] = useState<'quick' | 'week'>('quick')
  const [gridWeek, setGridWeek] = useState(() => weekStarting(date))
  const [drafts, setDrafts] = useState<Record<string, WeekDraft>>({})
  /* A draft typed for one week, or for somebody else's hours, is not an entry meant for the
   * week or the person now on screen. */
  useEffect(() => {
    setDrafts({})
  }, [gridWeek, person, issueId])

  const gridCells = useMemo(
    () => issueWeekCells(Object.values(state.timeEntries), issueId, person, gridWeek),
    [state.timeEntries, issueId, person, gridWeek],
  )
  const openDates = useMemo(() => gridCells.filter((c) => c.hours === null).map((c) => c.date), [gridCells])
  const filledCells = useMemo(
    () =>
      openDates
        .map((d) => {
          const draft = drafts[d]
          if (!draft || !draft.hours.trim()) return null
          return { date: d, hours: Number(draft.hours), justification: draft.justification.trim() || undefined }
        })
        .filter((x): x is { date: string; hours: number; justification: string | undefined } => x !== null),
    [openDates, drafts],
  )
  const gridProblem = gridSaveProblem(
    filledCells,
    sheets,
    person,
    gridWeek,
    today,
    state.model.timePolicy.backdatingAllowanceDays,
  )

  /**
   * Every filled cell, or none. `onAdd` has no batch form — this is `N` independent calls —
   * so `gridSaveProblem` above is what makes "all or nothing" true in practice: every filled
   * cell already passed the same checks the reducer applies before any of them is attempted.
   *
   * They are NOT fired in a synchronous loop, and that is not a style choice. `onAdd` reaches
   * this app's shared `dispatch` (`IssueWorkspace.tsx`), which closes over `state` as of the
   * render that created it and calls `setState` with a plain value rather than an updater
   * function. Two calls to it inside one synchronous handler both read the SAME stale `state`
   * snapshot, and the second's `setState` call overwrites the first's — both actions still
   * reach the server and persist correctly (every filled cell really is recorded), but the
   * browser's own copy of `state` would silently keep only the last cell until the next
   * reload, showing every earlier cell as if it had reverted to blank. Queuing one cell into
   * `pendingSave` and letting the effect below pop it lets a real render land between calls,
   * so `onAdd` is a fresh closure over the state the previous call actually produced.
   */
  const [pendingSave, setPendingSave] = useState<
    | {
        date: string
        hours: number
        activity: TimeActivity
        billable: boolean
        note: string
        justification?: string
      }[]
    | null
  >(null)

  const saveWeek = () => {
    if (filledCells.length === 0 || gridProblem || pendingSave) return
    setPendingSave(
      filledCells.map((cell) => {
        const draft = drafts[cell.date] ?? EMPTY_DRAFT
        return {
          date: cell.date,
          hours: cell.hours,
          activity: draft.activity,
          billable: draft.billable,
          note: draft.note,
          justification: cell.justification,
        }
      }),
    )
  }

  useEffect(() => {
    if (!pendingSave || pendingSave.length === 0) return
    const [next, ...rest] = pendingSave
    const ok = onAdd({ person, ...next })
    if (ok) {
      setDrafts((prev) => {
        const nextDrafts = { ...prev }
        delete nextDrafts[next.date]
        return nextDrafts
      })
    }
    setPendingSave(ok && rest.length ? rest : null)
    // Deliberately just `pendingSave`: onAdd/person must be read fresh on every firing (that
    // is the whole point above), not frozen at whatever render first queued this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSave])

  /**
   * The week's own strip: what it totals, what state it is in, and the one action available.
   *
   * A control is ABSENT rather than disabled when the permission is missing. A disabled button
   * invites somebody to find out why, and the answer is never encouraging — whereas a refusal
   * they can act on (the week is already submitted, somebody else has to decide it) is shown as
   * a note, because that one is temporary and theirs to resolve.
   */
  const sheetPanel = (
    <section className="est-blocks" aria-label="This week">
      <div className="est-block">
        <span className="est-block-label">{weekLabel(week)}</span>
        <span className="est-block-value mono">{total.hours}h</span>
        <span className="est-block-note">
          {total.billable === total.hours
            ? 'all billable'
            : `${total.billable}h billable`}
          {person !== actor.name ? ` · ${person}` : ''}
        </span>
      </div>
      <div className="est-block">
        <span className="est-block-label">Status</span>
        <span className="est-block-value">{sheet?.status ?? 'Open'}</span>
        <span className="est-block-note">
          {!sheet
            ? 'not submitted'
            : sheet.status === 'Submitted'
              ? `submitted ${formatShort(sheet.submittedAt.slice(0, 10))} by ${sheet.submittedBy}`
              : sheet.status === 'Approved'
                ? `approved by ${sheet.decidedBy}`
                : `returned by ${sheet.decidedBy}`}
        </span>
      </div>
      <div className="est-block time-week-actions">
        {/* Absent, not disabled, when the grant is missing. */}
        {maySubmit.allowed && sheet?.status !== 'Approved' ? (
          <button
            type="button"
            className="btn"
            disabled={Boolean(cannotSubmit)}
            title={cannotSubmit ?? `Submit the ${weekLabel(week)} for approval`}
            onClick={() => onSubmitWeek(person, week)}
          >
            {sheet?.status === 'Rejected' ? 'Resubmit week' : 'Submit week'}
          </button>
        ) : null}
        {mayApprove.allowed && sheet?.status === 'Submitted' ? (
          <>
            {/* What the design asks the approval to discharge: the late entries and their
                reasons, read before the number is signed. Across every issue — the week is
                attested whole. */}
            {lateInWeek.length > 0 && (
              <span className="est-block-note time-late">
                {lateInWeek.length === 1 ? 'A late entry' : `${lateInWeek.length} late entries`} in
                this week:{' '}
                {lateInWeek
                  .map((e) => `${formatIso(e.date)} ${e.hours}h — ${e.justification}`)
                  .join(' · ')}
              </span>
            )}
            <button
              type="button"
              className="btn"
              disabled={Boolean(cannotApprove)}
              title={cannotApprove ?? 'Approve this week'}
              onClick={() => onDecideWeek(sheet.id, 'approved')}
            >
              Approve
            </button>
            <input
              className="fld-input"
              placeholder="Why it is being returned"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              aria-label="Reason for returning the week"
            />
            <button
              type="button"
              className="btn"
              disabled={Boolean(cannotReturn)}
              title={cannotReturn ?? 'Return this week to be corrected'}
              onClick={() => {
                if (onDecideWeek(sheet.id, 'rejected', returnReason)) setReturnReason('')
              }}
            >
              Return
            </button>
          </>
        ) : null}
        {/*
         * Shown to the person whose week it is, because it is theirs to act on. Not shown when
         * the reason is simply that they hold no grant — that is what the absent button says.
         */}
        {cannotSubmit && maySubmit.allowed ? (
          <span className="est-block-note">{cannotSubmit}</span>
        ) : null}
        {sheet?.status === 'Rejected' && sheet.reason ? (
          <span className="est-block-note">Returned: {sheet.reason}</span>
        ) : null}
      </div>
    </section>
  )

  const submit = () => {
    if (problem || !hours.trim()) return
    if (needsReason && !justification.trim()) return
    if (
      onAdd({
        person,
        date,
        hours: parsed,
        activity,
        billable,
        note,
        activityId: taskId || undefined,
        justification: needsReason ? justification.trim() : undefined,
      })
    ) {
      setHours('')
      setNote('')
      setJustification('')
      // The task selection deliberately survives the reset: several entries against the same
      // task in a row is the normal shape of a working day.
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

      {sheetPanel}

      {!may.allowed ? (
        <div className="panel-note">{may.reason ?? 'Read only.'}</div>
      ) : (
        <>
          <div className="time-mode-toggle" role="tablist" aria-label="How to record time">
            <button
              type="button"
              className={mode === 'quick' ? 'btn' : 'btn ghost'}
              role="tab"
              aria-selected={mode === 'quick'}
              onClick={() => setMode('quick')}
            >
              Quick record
            </button>
            <button
              type="button"
              className={mode === 'week' ? 'btn' : 'btn ghost'}
              role="tab"
              aria-selected={mode === 'week'}
              onClick={() => setMode('week')}
            >
              Weekly timesheet
            </button>
          </div>

          {mode === 'week' ? (
            <section className="time-week">
              <div className="ts-week-bar">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setGridWeek(addDays(gridWeek, -7))}
                  aria-label="Previous week"
                >
                  ‹
                </button>
                <b>{weekLabel(gridWeek)}</b>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setGridWeek(addDays(gridWeek, 7))}
                  aria-label="Next week"
                >
                  ›
                </button>
                <button type="button" className="btn ghost" onClick={() => setGridWeek(weekStarting(today))}>
                  This week
                </button>
              </div>
              <div className="time-week-grid">
                {gridCells.map((cell, i) => (
                  <div key={cell.date} className="time-week-day">
                    <div className="time-week-day-head">
                      <span>{DAY_NAMES[i]}</span>
                      <span className="mono prov">{formatShort(cell.date)}</span>
                    </div>
                    {cell.hours !== null ? (
                      <div className="time-week-day-total mono" title="Already recorded — correct it below, in Entries">
                        {cell.hours}h
                      </div>
                    ) : (
                      <WeekDayCell
                        date={cell.date}
                        person={person}
                        today={today}
                        allowanceDays={state.model.timePolicy.backdatingAllowanceDays}
                        onClosedWork={onClosedWork}
                        draft={drafts[cell.date] ?? EMPTY_DRAFT}
                        onChange={(patch) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [cell.date]: { ...(prev[cell.date] ?? EMPTY_DRAFT), ...patch },
                          }))
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              {gridProblem && <p className="ov-gate">{gridProblem}</p>}
              <button
                type="button"
                className="btn primary"
                disabled={filledCells.length === 0 || Boolean(gridProblem) || Boolean(pendingSave)}
                title={
                  pendingSave
                    ? 'Recording — one moment'
                    : (gridProblem ?? 'Record every filled day at once')
                }
                onClick={saveWeek}
              >
                {pendingSave ? 'Saving…' : 'Save week'}
              </button>
            </section>
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
            {/* Only when this issue actually has tasks — a picker with one option ("whole
                record") is a question with no answer, and most records have no lifecycle. */}
            {tasks.length > 0 && (
              <label className="fld">
                <span className="fld-label">On task</span>
                <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                  <option value="">— whole record —</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.phase}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            <button
              className="btn primary"
              onClick={submit}
              disabled={!hours.trim() || Boolean(problem) || (needsReason && !justification.trim())}
            >
              Record
            </button>
          </div>
          {needsReason && (
            <div className="time-row">
              <label className="fld time-fld-note">
                <span className="fld-label">
                  {lateness.justificationRequired ? 'Why so late' : 'Why on closed work'}
                </span>
                <input
                  value={justification}
                  placeholder={
                    lateness.justificationRequired
                      ? `${lateness.days} days after the work — the allowance is ${state.model.timePolicy.backdatingAllowanceDays}. The week's approver reads this.`
                      : 'This issue is closed — the reason reopens its window, and the week’s approver reads it.'
                  }
                  onChange={(e) => setJustification(e.target.value)}
                  aria-label="Reason for the entry"
                />
              </label>
            </div>
          )}
          {problem && <p className="ov-gate">{problem.message}</p>}
        </section>
          )}
        </>
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
              {entries.flatMap((e) => [
                <tr key={e.id}>
                  <td className="mono">{formatIso(e.date)}</td>
                  <td>{e.person}</td>
                  <td className="mono">{e.hours}</td>
                  <td>
                    {e.activity}
                    {/* The task the hours executed, when recorded at task level. Reads from
                        stored state, so an entry against a since-archived task still says
                        where it went rather than going quiet. */}
                    {e.activityId && (
                      <span className="prov"> · {state.activities[e.activityId]?.phase ?? e.activityId}</span>
                    )}
                  </td>
                  <td>{e.billable ? 'Yes' : <span className="prov">No</span>}</td>
                  <td>
                    {e.note || <span className="prov">—</span>}
                    {e.justification && (
                      <span className="time-late" title={e.justification}>
                        late — {e.justification}
                      </span>
                    )}
                    {e.updatedAt && (
                      <span className="prov"> · corrected by {e.updatedBy}</span>
                    )}
                  </td>
                  <td>
                    {mayRemove(e, actor, mayOthers.allowed) && (
                      <>
                        {/*
                          * Correct, then Remove. Correcting is the commoner intent and was the
                          * one with no control at all — so a typo could only be fixed by
                          * deleting the record of the work and writing a new one, which loses
                          * who first entered it and when.
                          */}
                        <button className="btn-link" onClick={() => setEditing(editing === e.id ? null : e.id)}>
                          {editing === e.id ? 'Cancel' : 'Correct'}
                        </button>{' '}
                        <button className="btn-link" onClick={() => onRemove(e.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>,
                editing === e.id ? (
                  <tr key={`${e.id}-edit`}>
                    <td colSpan={7}>
                      <CorrectEntry
                        entry={e}
                        today={today}
                        allowanceDays={state.model.timePolicy.backdatingAllowanceDays}
                        onSave={(patch) => {
                          if (onUpdate(e.id, patch)) setEditing(null)
                        }}
                      />
                    </td>
                  </tr>
                ) : null,
              ])}
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

/**
 * Correct an entry's hours, note or billable flag.
 *
 * Deliberately NOT the date or the person. Moving an entry to another day or another person is
 * not a correction — it changes which week is being attested to and whose time it is, and both
 * are things the freeze and the attestation rules are built around. `updateTime` will accept
 * either, and the reducer checks both the old week and the new one; offering it here would
 * invite it as a matter of course. Withdraw and re-enter is the honest route for those.
 */
function CorrectEntry({
  entry,
  today,
  allowanceDays,
  onSave,
}: {
  entry: TimeEntry
  today: string
  allowanceDays: number
  onSave: (patch: { hours?: number; note?: string; billable?: boolean; justification?: string }) => void
}) {
  const [hours, setHours] = useState(String(entry.hours))
  const [note, setNote] = useState(entry.note)
  const [billable, setBillable] = useState(entry.billable)
  const [justification, setJustification] = useState('')

  const parsed = Number(hours)
  const problem = checkEntry({ hours: parsed, date: entry.date, person: entry.person }, entry.date)
  const changed = parsed !== entry.hours || note !== entry.note || billable !== entry.billable
  /*
   * Changing the HOURS of a stale entry is the same reconstruction as recording it late —
   * the reducer gates it, so the form demands what the arm will refuse without. A relabel of
   * the note or the billing changes no claimed number and asks nothing.
   */
  const staleHours = parsed !== entry.hours && backdated(entry.date, today, allowanceDays).justificationRequired

  return (
    <div className="time-row">
      <label className="fld time-fld-hours">
        <span className="fld-label">Hours</span>
        <input type="number" min={0.25} step={0.25} max={MAX_HOURS_PER_ENTRY} value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <label className="fld time-fld-note">
        <span className="fld-label">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld-label">Billable</span>
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
      </label>
      {staleHours && (
        <label className="fld time-fld-note">
          <span className="fld-label">Why the change</span>
          <input
            value={justification}
            placeholder="This entry is past the allowance — the approver reads this."
            onChange={(e) => setJustification(e.target.value)}
            aria-label="Reason for correcting a late entry"
          />
        </label>
      )}
      <button
        className="btn"
        disabled={Boolean(problem) || !changed || (staleHours && !justification.trim())}
        title={problem?.message ?? (changed ? 'Save the correction' : 'Nothing has changed')}
        onClick={() =>
          onSave({
            hours: parsed,
            note,
            billable,
            justification: staleHours ? justification.trim() : undefined,
          })
        }
      >
        Save
      </button>
      {problem && <span className="ov-gate">{problem.message}</span>}
    </div>
  )
}

/**
 * One open day in the weekly grid.
 *
 * Deliberately not `CorrectEntry` reused: that component edits a stored entry's hours, note
 * and billable flag; this one drafts a *new* entry that does not exist until Save Week writes
 * it, so it also needs an activity picker and, when the date warrants it, its own reason
 * field — which `CorrectEntry` gates on `staleHours` instead, a different question (was the
 * change itself late) from this one (was the work itself late).
 */
function WeekDayCell({
  date,
  person,
  today,
  allowanceDays,
  onClosedWork,
  draft,
  onChange,
}: {
  date: string
  person: string
  today: string
  allowanceDays: number
  /** The issue is terminal — the extension applies, so the reason field shows for every day. */
  onClosedWork: boolean
  draft: WeekDraft
  onChange: (patch: Partial<WeekDraft>) => void
}) {
  const parsed = Number(draft.hours)
  const problem = draft.hours.trim() ? checkEntry({ hours: parsed, date, person }, today) : null
  const lateness = backdated(date, today, allowanceDays)
  const needsReason = draft.hours.trim() && (lateness.justificationRequired || onClosedWork)

  return (
    <div className="time-week-day-form">
      <input
        type="number"
        step={0.25}
        min={0.25}
        max={MAX_HOURS_PER_ENTRY}
        value={draft.hours}
        placeholder="0.00"
        onChange={(e) => onChange({ hours: e.target.value })}
        aria-label={`Hours on ${date}`}
      />
      <select
        value={draft.activity}
        onChange={(e) => onChange({ activity: e.target.value as TimeActivity })}
        aria-label={`Activity on ${date}`}
      >
        {TIME_ACTIVITIES.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      <label className="time-week-billable">
        <input type="checkbox" checked={draft.billable} onChange={(e) => onChange({ billable: e.target.checked })} />
        Billable
      </label>
      <input
        className="fld-input"
        value={draft.note}
        placeholder="Note — optional"
        onChange={(e) => onChange({ note: e.target.value })}
        aria-label={`Note on ${date}`}
      />
      {needsReason && (
        <input
          className="fld-input"
          value={draft.justification}
          placeholder={
            lateness.justificationRequired ? `${lateness.days}d late — reason needed` : 'closed work — reason needed'
          }
          onChange={(e) => onChange({ justification: e.target.value })}
          aria-label={`Reason for the entry on ${date}`}
        />
      )}
      {problem && <span className="ov-gate">{problem.message}</span>}
    </div>
  )
}
