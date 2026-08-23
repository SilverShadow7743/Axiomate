'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import { directoryPersonFor } from '@/lib/access'
import { addDays, formatIso } from '@/lib/dates'
import {
  daysOfWeek,
  decideProblem,
  entriesInWeek,
  sheetFor,
  submitProblem,
  weekGrid,
  weekLabel,
  weekStarting,
  weekTotal,
  type Timesheet,
} from '@/lib/timesheet'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * The week, gathered — and the queue an approver can clear.
 *
 * Scenario U's original finding was that every timesheet mechanism existed and "nothing
 * gathers a week of entries to put in front of it": a consultant attested a week they could
 * only see one issue at a time, and an approver decided weeks one issue-tab at a time with
 * no queue. This panel is that gathering. It GATHERS and it decides; it never edits — a
 * cell aggregates several entries, and corrections belong on the entry's own Time tab,
 * where the grace gate collects its justifications.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function TimesheetPanel({
  state,
  actor,
  today,
  onSubmitWeek,
  onDecideWeek,
  onDecideMany,
  onOpen,
  onClose,
}: {
  state: WorkspaceState
  actor: Actor
  today: string
  onSubmitWeek: (person: string, week: string) => boolean
  onDecideWeek: (id: string, decision: 'approved' | 'rejected', reason?: string) => boolean
  /** The batch — dispatched as ONE dispatchMany, which is atomic; the caller pre-filtered. */
  onDecideMany: (ids: string[]) => void
  onOpen: (issueId: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, true, onClose)

  const meId = directoryPersonFor(state.model, actor)?.id ?? null
  const [week, setWeek] = useState(() => weekStarting(today))
  const [returnReason, setReturnReason] = useState('')
  const [returning, setReturning] = useState<string | null>(null)

  const entries = useMemo(() => Object.values(state.timeEntries), [state.timeEntries])
  const grid = useMemo(() => weekGrid(entries, actor.name, week, meId), [entries, actor.name, week, meId])
  const days = useMemo(() => daysOfWeek(week), [week])

  const sheets = useMemo(() => Object.values(state.timesheets), [state.timesheets])
  const sheet = sheetFor(sheets, actor.name, week, meId)
  const attester = {
    name: actor.name,
    maySubmit: can(state.model, actor, 'time.submit').allowed,
    mayApprove: can(state.model, actor, 'time.approve').allowed,
  }
  const cannotSubmit = submitProblem(sheets, actor.name, week, attester)

  /* ---- the queue ---- */
  const submitted = useMemo(
    () =>
      sheets
        .filter((t) => t.status === 'Submitted')
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [sheets],
  )
  /**
   * Everything the batch will actually decide. `dispatchMany` is atomic — one refused
   * self-approval would abort the whole batch — so this filter is correctness, not
   * politeness, and the button counts only what it will do.
   */
  const decidable = useMemo(
    () => submitted.filter((t) => !decideProblem(t, 'approved', undefined, attester)),
    [submitted, attester.name, attester.mayApprove],
  )

  const lateFor = (t: Timesheet) =>
    entriesInWeek(entries, t.person, t.weekStarting, t.personId).filter((e) => e.justification)

  const body = (
    // Pointer-only dismissal; Escape via useOverlay is the keyboard path, and the target
    // guard means clicks inside the dialog never bubble into a close.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal is Escape (useOverlay)
    <div
        className="modal-scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
      <div
        className="modal timesheet-modal"
        ref={ref}
        role="dialog"
        aria-label="Timesheets"
      >
        <div className="modal-head">
          <b>Timesheets</b>
          <span className="grow" />
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">

        {/* ---------------- my week ---------------- */}
        <section className="ts-week">
          <div className="ts-week-bar">
            <button className="btn ghost" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
              ‹
            </button>
            <b>{weekLabel(week)}</b>
            <button className="btn ghost" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
              ›
            </button>
            <button className="btn ghost" onClick={() => setWeek(weekStarting(today))}>
              This week
            </button>
            <span className="grow" />
            <span className="prov">
              {sheet
                ? sheet.status === 'Submitted'
                  ? `submitted ${formatIso(sheet.submittedAt.slice(0, 10))} — awaiting a decision`
                  : sheet.status === 'Approved'
                    ? `approved by ${sheet.decidedBy}`
                    : `returned: ${sheet.reason}`
                : 'not submitted'}
            </span>
            {attester.maySubmit && sheet?.status !== 'Approved' && sheet?.status !== 'Submitted' && (
              <button
                className="btn"
                disabled={Boolean(cannotSubmit)}
                title={cannotSubmit ?? `Submit the ${weekLabel(week)} for approval`}
                onClick={() => onSubmitWeek(actor.name, week)}
              >
                {sheet?.status === 'Rejected' ? 'Resubmit week' : 'Submit week'}
              </button>
            )}
          </div>

          {grid.rows.length === 0 ? (
            <p className="panel-note">
              No hours recorded in this week. Recording happens on a record&rsquo;s Time tab —
              this panel gathers the week so it can be read whole before it is attested.
            </p>
          ) : (
            <table className="cfg-table ts-grid">
              <thead>
                <tr>
                  <th>Record</th>
                  {DAY_NAMES.map((d, i) => (
                    <th key={d} className="mono" title={formatIso(days[i])}>
                      {d}
                    </th>
                  ))}
                  <th className="mono">Total</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.issueId}>
                    <td>
                      {/* The way to the edit path — corrections live with the entry. */}
                      <button className="btn-link mono" onClick={() => onOpen(r.issueId)}>
                        {r.issueId}
                      </button>
                    </td>
                    {r.byDay.map((h, i) => (
                      <td key={i} className="mono">
                        {h > 0 ? h : ''}
                      </td>
                    ))}
                    <td className="mono">
                      <b>{r.total}</b>
                    </td>
                  </tr>
                ))}
                <tr className="ts-total-row">
                  <td>
                    <b>Week</b>
                  </td>
                  {grid.byDay.map((h, i) => (
                    <td key={i} className="mono">
                      {h > 0 ? h : ''}
                    </td>
                  ))}
                  <td className="mono">
                    <b>{grid.total}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* ---------------- the queue ---------------- */}
        {attester.mayApprove && (
          <section className="ts-queue">
            <div className="ts-week-bar">
              <b>Awaiting a decision</b>
              <span className="prov">
                {submitted.length === 0
                  ? 'nothing submitted'
                  : `${submitted.length} week${submitted.length === 1 ? '' : 's'}`}
              </span>
              <span className="grow" />
              {decidable.length > 1 && (
                <button
                  className="btn"
                  onClick={() => onDecideMany(decidable.map((t) => t.id))}
                  title="Approve every decidable week in one batch"
                >
                  Approve all · {decidable.length}
                </button>
              )}
              {submitted.length > decidable.length && (
                <span className="prov">your own week is not yours to approve</span>
              )}
            </div>

            {submitted.map((t) => {
              const total = weekTotal(entries, t.person, t.weekStarting, t.personId)
              const late = lateFor(t)
              const cannot = decideProblem(t, 'approved', undefined, attester)
              return (
                <div key={t.id} className="ts-queue-row">
                  <div className="ts-queue-who">
                    <b>{t.person}</b>
                    <span className="prov">
                      {weekLabel(t.weekStarting)} · {total.hours}h ({total.billable}h billable)
                      · submitted {formatIso(t.submittedAt.slice(0, 10))}
                    </span>
                    {late.length > 0 && (
                      <span className="time-late">
                        {late.length === 1 ? 'A late entry' : `${late.length} late entries`}:{' '}
                        {late
                          .map((e) => `${formatIso(e.date)} ${e.hours}h — ${e.justification}`)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="ts-queue-actions">
                    {cannot ? (
                      <span className="prov">{cannot}</span>
                    ) : returning === t.id ? (
                      <>
                        <input
                          className="fld-input"
                          placeholder="Why it is being returned"
                          value={returnReason}
                          onChange={(e) => setReturnReason(e.target.value)}
                          aria-label={`Reason for returning ${t.person}'s week`}
                        />
                        <button
                          className="btn"
                          disabled={!returnReason.trim()}
                          onClick={() => {
                            if (onDecideWeek(t.id, 'rejected', returnReason)) {
                              setReturning(null)
                              setReturnReason('')
                            }
                          }}
                        >
                          Return
                        </button>
                        <button className="btn ghost" onClick={() => setReturning(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn" onClick={() => onDecideWeek(t.id, 'approved')}>
                          Approve
                        </button>
                        <button className="btn ghost" onClick={() => setReturning(t.id)}>
                          Return…
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
        )}
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
