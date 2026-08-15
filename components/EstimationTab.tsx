'use client'

import { useMemo, useState } from 'react'
import { effortVariance } from '@/lib/time'
import type { Actor } from '@/lib/actor'
import { canEditIssue } from '@/lib/permissions'
import { formatIso } from '@/lib/dates'
import type { WorkspaceState } from '@/lib/workspace'
import {
  COMPLEXITY_LEVELS,
  COMPLEXITY_PARAMETERS,
  CONFIDENCE_LEVELS,
  MAX_COMPLEXITY,
  TSHIRT_SIZES,
  deriveEffort,
  deriveTimeline,
  emptyEstimate,
  scheduleVarianceDays,
  type Confidence,
  type Estimate,
  type EstimateStep,
  type TshirtSize,
} from '@/lib/estimation'

/**
 * Effort and timeline, kept visibly apart.
 *
 * The tab is laid out to make the distinction unavoidable: complexity produces *effort*, and
 * effort only becomes a *date* after passing through capacity and dependencies. The summary
 * repeats both figures side by side for the same reason — a reader who takes "40 hours" and
 * "five days" as two ways of saying one thing is the reader this screen exists to correct.
 *
 * Three inputs are typed rather than calculated, and each says so on screen: capacity, waiting
 * time, and the working calendar's holidays (of which there are none, because no calendar
 * exists). They are the parts of the requirement that need the Resources & Capacity and Time
 * Management domains, neither of which this application has. Presenting them as derived would
 * be inventing precision.
 */

const num = (v: string, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export default function EstimationTab({
  issueId,
  state,
  actor,
  today,
  onSave,
  onBaseline,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  today: string
  onSave: (patch: Partial<Estimate>, reason?: string) => boolean
  onBaseline: () => void
}) {
  const may = canEditIssue(state.model, actor)
  const bands = state.model.sizeBands
  const stored = state.estimates[issueId]
  const issue = state.issues[issueId]

  const estimate: Estimate = stored ?? emptyEstimate(today)
  const effort = useMemo(() => deriveEffort(estimate, bands), [estimate, bands])
  const timeline = useMemo(() => deriveTimeline(estimate, effort), [estimate, effort])

  const revisions = useMemo(
    () =>
      Object.values(state.estimateRevisions)
        .filter((r) => r.issueId === issueId)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [state.estimateRevisions, issueId],
  )

  const agreed = Boolean(stored?.baselinedAt)
  const [reason, setReason] = useState('')

  /**
   * Every edit commits immediately, except when the estimate has been agreed — then it needs a
   * reason first, and the field above the form is where that goes. Field-by-field commits suit
   * this screen because each one is independently meaningful; the Overview form is different
   * because a dozen fields there describe one record together.
   */
  const put = (patch: Partial<Estimate>) => {
    if (agreed && !reason.trim()) return false
    const ok = onSave(patch, agreed ? reason : undefined)
    if (ok && agreed) setReason('')
    return ok
  }

  const setStep = (id: string, patch: Partial<EstimateStep>) =>
    put({ steps: estimate.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  const addStep = () =>
    put({
      steps: [
        ...estimate.steps,
        { id: `s${Date.now().toString(36)}`, activity: '', effortHours: 0, dependsOn: [] },
      ],
    })

  const variance = scheduleVarianceDays(timeline.finish, issue?.actualEnd ?? null)
  /**
   * The other half of "estimated versus actual", which this tab used to say plainly it could
   * not produce. It can now: hours are recorded against the issue, and the comparison is
   * recomputed from them rather than stored anywhere.
   */
  const effortActual = useMemo(
    () => effortVariance(state.timeEntries, issueId, stored, bands),
    [state.timeEntries, issueId, stored, bands],
  )

  return (
    <div className="est">
      {/* ---------------- summary ---------------- */}
      <section className="est-summary">
        <div className="est-sum-group">
          <span className="est-sum-head">Effort — how much work</span>
          <dl>
            <dt>Complexity</dt>
            <dd className="mono">
              {effort.scored ? `${effort.score} / ${MAX_COMPLEXITY}` : 'Not scored'}
            </dd>
            <dt>T-shirt size</dt>
            <dd className="mono">
              {effort.size ?? '—'}
              {effort.sizeOverridden && <span className="prov"> · chosen</span>}
            </dd>
            <dt>Story points</dt>
            <dd className="mono">{effort.storyPoints ?? '—'}</dd>
            <dt>Estimated effort</dt>
            <dd className="mono est-strong">
              {effort.effortHours !== null ? `${effort.effortHours} h` : '—'}
              {effort.effortOverridden && <span className="prov"> · approved</span>}
              {!effort.effortOverridden && effort.breakdownHours !== null && (
                <span className="prov"> · from breakdown</span>
              )}
            </dd>
          </dl>
        </div>

        <div className="est-sum-group">
          <span className="est-sum-head">Timeline — how long it takes</span>
          <dl>
            <dt>Capacity</dt>
            <dd className="mono">{timeline.dailyCapacity || '—'} h/day</dd>
            <dt>Working duration</dt>
            <dd className="mono est-strong">
              {timeline.workingDays !== null ? `${Math.ceil(timeline.workingDays)} days` : '—'}
              {timeline.dependencyBound && <span className="prov"> · set by dependencies</span>}
            </dd>
            <dt>Waiting</dt>
            <dd className="mono">{timeline.waitDays} days</dd>
            <dt>Completion</dt>
            <dd className="mono est-strong">{timeline.finish ? formatIso(timeline.finish) : '—'}</dd>
          </dl>
        </div>

        <div className="est-sum-group">
          <span className="est-sum-head">Standing</span>
          <dl>
            <dt>Confidence</dt>
            <dd className={`conf-${estimate.confidence.toLowerCase()}`}>{estimate.confidence}</dd>
            <dt>Status</dt>
            <dd>
              {agreed ? (
                <>
                  Agreed <span className="prov">· {formatIso(stored!.baselinedAt!.slice(0, 10))} by {stored!.baselinedBy}</span>
                </>
              ) : (
                <>Draft</>
              )}
            </dd>
            <dt>Revisions</dt>
            <dd className="mono">{revisions.length}</dd>
            <dt>Effort variance</dt>
            <dd className="mono">
              {effortActual.estimated === null ? (
                <span className="prov">
                  {effortActual.actual > 0
                    ? `${effortActual.actual}h spent, nothing estimated`
                    : 'nothing estimated'}
                </span>
              ) : effortActual.actual === 0 ? (
                <span className="prov">no time recorded yet</span>
              ) : (
                <>
                  {effortActual.actual}h of {effortActual.estimated}h{' '}
                  <span className={effortActual.varianceHours! > 0 ? 'est-over' : 'est-under'}>
                    ({effortActual.varianceHours! > 0 ? '+' : ''}
                    {effortActual.varianceHours}h
                    {effortActual.variancePct === null ? '' : `, ${effortActual.variancePct > 0 ? '+' : ''}${Math.round(effortActual.variancePct)}%`})
                  </span>
                  {!effortActual.againstBaseline && (
                    <span className="prov"> · against a draft, not an agreed figure</span>
                  )}
                </>
              )}
            </dd>
            <dt>Schedule variance</dt>
            <dd className="mono">
              {variance === null ? (
                <span className="prov">not finished yet</span>
              ) : (
                `${variance > 0 ? '+' : ''}${variance} working days`
              )}
            </dd>
          </dl>
        </div>
      </section>

      {!may.allowed && <div className="panel-note">{may.reason ?? 'Read only.'}</div>}

      {agreed && (
        <div className="est-reason">
          <label className="fld">
            <span className="fld-label">
              Reason for this change <span className="req-mark">*</span>
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Scope grew, dependency confirmed, client changed the requirement…"
            />
            <span className="fld-hint">
              This estimate has been agreed, so anything that moves the effort, size, duration,
              date or confidence is recorded as a revision. Type the reason first, then edit.
            </span>
          </label>
        </div>
      )}

      {/* ---------------- A. complexity and effort ---------------- */}
      <section className="est-section">
        <h4>A · Complexity and effort</h4>
        <p className="cfg-note">
          Five parameters, one to five each. The total maps to a T-shirt size, and the size
          carries the story points and hours this firm has calibrated — all of which is
          maintained centrally under Master data, not here.
        </p>

        <table className="est-table">
          <tbody>
            {COMPLEXITY_PARAMETERS.map((p) => (
              <tr key={p.key}>
                <th>{p.label}</th>
                <td className="est-what">{p.what}</td>
                <td className="est-scale">
                  {COMPLEXITY_LEVELS.map((l) => (
                    <button
                      key={l.score}
                      className={`est-dot${estimate.scores[p.key] === l.score ? ' on' : ''}`}
                      title={`${l.score} — ${l.label}`}
                      aria-label={`${p.label}: ${l.score}, ${l.label}`}
                      aria-pressed={estimate.scores[p.key] === l.score}
                      disabled={!may.allowed}
                      onClick={() => put({ scores: { ...estimate.scores, [p.key]: l.score } })}
                    >
                      {l.score}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="est-derive">
          <span className="mono">
            {effort.scored ? effort.score : '—'} / {MAX_COMPLEXITY}
          </span>
          <span className="est-arrow">→</span>
          <span className="mono">{effort.size ?? '—'}</span>
          <span className="est-arrow">→</span>
          <span className="mono">{effort.storyPoints ?? '—'} pts</span>
          <span className="est-arrow">→</span>
          <span className="mono est-strong">
            {effort.suggestedHours !== null ? `${effort.suggestedHours} h` : '—'}
          </span>
          {effort.scored && !effort.band && (
            <span className="prov"> · no configured size covers this score</span>
          )}
        </div>

        <div className="cfg-fld-row">
          <label className="cfg-fld">
            <span>Override the size</span>
            <select
              value={estimate.sizeOverride ?? ''}
              disabled={!may.allowed}
              onChange={(e) =>
                put({ sizeOverride: (e.target.value || null) as TshirtSize | null })
              }
            >
              <option value="">Use the score</option>
              {TSHIRT_SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="cfg-fld">
            <span>Final approved effort (hours)</span>
            <input
              type="number"
              min={0}
              defaultValue={estimate.approvedEffortHours ?? ''}
              placeholder={effort.suggestedHours !== null ? String(effort.suggestedHours) : ''}
              disabled={!may.allowed}
              onBlur={(e) => {
                const v = e.target.value.trim()
                const next = v === '' ? null : num(v)
                if (next !== estimate.approvedEffortHours) put({ approvedEffortHours: next })
              }}
            />
          </label>
        </div>
        <p className="cfg-inherit">
          Effort is the total work required. Forty hours is forty hours whether one person takes
          five days over it or two take two and a half — that is the timeline&rsquo;s business,
          below, not this section&rsquo;s.
        </p>
      </section>

      {/* ---------------- B. resource and timeline ---------------- */}
      <section className="est-section">
        <h4>B · Resource and timeline</h4>
        <p className="cfg-note">
          Capacity is entered, not looked up: this application has no resource model, no
          allocation records and no holiday calendar, so these are figures somebody states.
          Working days skip weekends only.
        </p>

        <div className="cfg-fld-row">
          <label className="cfg-fld">
            <span>Planned start</span>
            <input
              type="date"
              defaultValue={estimate.plannedStart}
              disabled={!may.allowed}
              onBlur={(e) => e.target.value !== estimate.plannedStart && put({ plannedStart: e.target.value })}
            />
          </label>
          <label className="cfg-fld">
            <span>Hours per day</span>
            <input
              type="number"
              min={1}
              max={24}
              defaultValue={estimate.capacity.hoursPerDay}
              disabled={!may.allowed}
              onBlur={(e) =>
                num(e.target.value) !== estimate.capacity.hoursPerDay &&
                put({ capacity: { ...estimate.capacity, hoursPerDay: num(e.target.value) } })
              }
            />
          </label>
          <label className="cfg-fld">
            <span>Resources</span>
            <input
              type="number"
              min={1}
              defaultValue={estimate.capacity.resources}
              disabled={!may.allowed}
              onBlur={(e) =>
                num(e.target.value) !== estimate.capacity.resources &&
                put({ capacity: { ...estimate.capacity, resources: num(e.target.value) } })
              }
            />
          </label>
          <label className="cfg-fld">
            <span>Allocation %</span>
            <input
              type="number"
              min={1}
              max={100}
              defaultValue={estimate.capacity.allocationPct}
              disabled={!may.allowed}
              onBlur={(e) =>
                num(e.target.value) !== estimate.capacity.allocationPct &&
                put({ capacity: { ...estimate.capacity, allocationPct: num(e.target.value) } })
              }
            />
          </label>
          <label className="cfg-fld">
            <span>Waiting days</span>
            <input
              type="number"
              min={0}
              defaultValue={estimate.waitDays}
              disabled={!may.allowed}
              onBlur={(e) => num(e.target.value) !== estimate.waitDays && put({ waitDays: num(e.target.value) })}
            />
          </label>
        </div>

        <div className="est-derive">
          <span className="mono">{effort.effortHours ?? '—'} h</span>
          <span className="est-arrow">÷</span>
          <span className="mono">{timeline.dailyCapacity || '—'} h/day</span>
          <span className="est-arrow">=</span>
          <span className="mono">
            {timeline.capacityDays !== null ? `${timeline.capacityDays.toFixed(2)} days` : '—'}
          </span>
          {timeline.criticalPathDays !== null && (
            <>
              <span className="est-arrow">vs chain</span>
              <span className="mono">{timeline.criticalPathDays.toFixed(2)} days</span>
            </>
          )}
          <span className="est-arrow">→</span>
          <span className="mono est-strong">
            {timeline.workingDays !== null ? `${Math.ceil(timeline.workingDays)} working days` : '—'}
          </span>
        </div>

        {timeline.dependencyBound && (
          <p className="cfg-inherit">
            Dependencies decide this duration, not capacity. Adding people will not bring the
            date forward — the chain below is already the longest path through the work, and it
            is measured at one person per step.
          </p>
        )}

        {/* breakdown */}
        <h5 className="est-sub">Breakdown</h5>
        <p className="cfg-note">
          Optional. When steps are listed their total replaces the size&rsquo;s nominal hours,
          and what each step waits for is what stops the timeline from being a simple division.
          Two steps waiting on the same thing run together.
        </p>
        {estimate.steps.length > 0 && (
          <table className="est-table est-steps">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Hours</th>
                <th>Waits for</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {estimate.steps.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      defaultValue={s.activity}
                      placeholder="Analysis, Development, UAT…"
                      disabled={!may.allowed}
                      onBlur={(e) => e.target.value !== s.activity && setStep(s.id, { activity: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      defaultValue={s.effortHours}
                      disabled={!may.allowed}
                      onBlur={(e) =>
                        num(e.target.value) !== s.effortHours && setStep(s.id, { effortHours: num(e.target.value) })
                      }
                    />
                  </td>
                  <td>
                    <select
                      multiple
                      value={s.dependsOn}
                      disabled={!may.allowed}
                      onChange={(e) =>
                        setStep(s.id, {
                          dependsOn: [...e.target.selectedOptions].map((o) => o.value),
                        })
                      }
                    >
                      {estimate.steps
                        .filter((o) => o.id !== s.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.activity || '(unnamed)'}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn ghost"
                      disabled={!may.allowed}
                      onClick={() => put({ steps: estimate.steps.filter((x) => x.id !== s.id) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="cfg-inline">
          <button className="btn" onClick={addStep} disabled={!may.allowed}>
            Add a step
          </button>
          {effort.breakdownHours !== null && (
            <span className="prov">
              {effort.breakdownHours} h across {estimate.steps.length} steps
              {timeline.criticalPathDays !== null &&
                ` · longest chain ${timeline.criticalPathDays.toFixed(2)} days`}
            </span>
          )}
        </div>
      </section>

      {/* ---------------- C. assumptions and confidence ---------------- */}
      <section className="est-section">
        <h4>C · Assumptions and confidence</h4>
        <div className="cfg-fld-row">
          <label className="cfg-fld">
            <span>Confidence</span>
            <select
              value={estimate.confidence}
              disabled={!may.allowed}
              onChange={(e) => put({ confidence: e.target.value as Confidence })}
            >
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="cfg-fld">
          <span>Assumptions</span>
          <textarea
            rows={3}
            defaultValue={estimate.assumptions}
            placeholder="Client supplies integration credentials and test data by the planned start. UAT environment available from week two."
            disabled={!may.allowed}
            onBlur={(e) => e.target.value !== estimate.assumptions && put({ assumptions: e.target.value })}
          />
        </label>
        <label className="cfg-fld">
          <span>Estimation notes</span>
          <textarea
            rows={3}
            defaultValue={estimate.notes}
            placeholder="How the number was reached, what was excluded, what was compared against."
            disabled={!may.allowed}
            onBlur={(e) => e.target.value !== estimate.notes && put({ notes: e.target.value })}
          />
        </label>

        {!agreed && may.allowed && (
          <div className="cfg-inline">
            <button className="btn primary" onClick={onBaseline} disabled={effort.effortHours === null}>
              Agree this estimate
            </button>
            <span className="prov">
              After this, changes that move the numbers are recorded as revisions with a reason.
            </span>
          </div>
        )}
      </section>

      {/* ---------------- revisions ---------------- */}
      {revisions.length > 0 && (
        <section className="est-section">
          <h4>Revisions</h4>
          <p className="cfg-note">
            Both halves are kept, because they move independently: scope can grow without the
            date slipping, and the date can slip with no change in effort at all.
          </p>
          <table className="est-table est-revs">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Effort</th>
                <th>Duration</th>
                <th>Completion</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{formatIso(r.at.slice(0, 10))}</td>
                  <td>{r.by}</td>
                  <td className="mono">
                    {r.from.effortHours ?? '—'} → {r.to.effortHours ?? '—'} h
                  </td>
                  <td className="mono">
                    {r.from.workingDays ?? '—'} → {r.to.workingDays ?? '—'} d
                  </td>
                  <td className="mono">
                    {r.from.finish ? formatIso(r.from.finish) : '—'} →{' '}
                    {r.to.finish ? formatIso(r.to.finish) : '—'}
                  </td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* What the comparison is worth, and what it still cannot reach. */}
      <p className="panel-note">
        Effort variance compares recorded hours against this estimate, and both halves are real:
        the hours are entries somebody made on the Time tab, and the estimate is the figure
        derived from the scores and the firm&rsquo;s own calibration. An overrun against a
        <em> draft</em> is labelled as such — a number nobody agreed is not yet a commitment
        anybody broke.
      </p>
      <p className="panel-note">
        What it still cannot show is money. Cost needs a rate, and there is no rate anywhere in
        this application — not on a person, not on a role, not on an engagement. Hours are the
        input to that arithmetic and are now recorded; the arithmetic itself is absent, and a
        cost figure invented from a default hourly rate would be worse than none.
      </p>
    </div>
  )
}
