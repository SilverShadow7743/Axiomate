'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import { contractedPosition, describeContracted, type ChangeRequest } from '@/lib/changeRequest'
import {
  SCOPE_KINDS,
  SCOPE_KIND_LABEL,
  WORK_KINDS,
  describeScope,
  effortProblem,
  scopeFor,
  scopePosition,
  type ScopeItem,
  type ScopeKind,
} from '@/lib/scope'
import {
  BILLING_TRIGGERS,
  describeMilestone,
  describeMilestones,
  isBillable,
  milestonePosition,
  milestoneRisk,
  milestoneValue,
  scheduleProblem,
  type BillingTrigger,
  type Milestone,
} from '@/lib/milestone'
import { LIVE_SOW_STATUSES, SOW_STATUSES, describePosition, sowPosition, type Sow, type SowStatus } from '@/lib/sow'
import type { ScheduleRow } from '@/lib/types'
import type { WorkspaceState } from '@/lib/workspace'
import { formatIso, workingDaysBetween } from '@/lib/dates'
import { issuesUnder as issuesUnderEngagement } from '@/lib/engagement'

/**
 * What has been contracted under this engagement, and how much of it is gone.
 *
 * The figures here are the reason the SOW is worth modelling at all. Baseline is what was
 * agreed; planned is the sum of the estimates on the work; actual is the sum of the recorded
 * hours. All three are real, because all three have sources — and the gap between them is
 * scope position rather than an opinion.
 *
 * Two things this screen refuses to do. It does not read a scope statement and pronounce on
 * whether a request is inside it: that is a commercial judgement, and a machine answer would be
 * wrong occasionally and confidently. And it does not hide the work its forecast could not
 * see — unestimated records are counted and named, because a forecast that treats them as zero
 * is exactly why a project looks fine until the week it does not.
 */
export default function CommercialPanel({
  row,
  state,
  actor,
  today,
  allRows,
  onUpsert,
  onAttribute,
  onArchive,
  onRaiseChange,
  onDecideChange,
  onWithdrawChange,
  onUpsertMilestone,
  onRemoveMilestone,
  onDeliverMilestone,
  onDecideMilestone,
  onUpsertScope,
  onRemoveScope,
  onDecideScope,
}: {
  row: ScheduleRow
  state: WorkspaceState
  actor: Actor
  today: string
  allRows: ScheduleRow[]
  onUpsert: (id: string | null, engagementId: string, patch: Partial<Sow>) => void
  onAttribute: (nodeId: string, sowId: string | null) => void
  /** Retire a statement of work. Refused by the reducer while live projects sit under it. */
  onArchive: (id: string) => void
  /** Raise a variation, optionally submitting it for a decision in the same act. */
  onRaiseChange: (sowId: string, c: { title: string; effortHours: number; value: number; reason: string; scope: string; effectiveFrom: string | null; issueId: string | null }, submit: boolean) => boolean
  /** Approve or refuse one. Never your own — the reducer refuses that whatever the grant. */
  onDecideChange: (id: string, decision: 'approved' | 'rejected', note?: string) => boolean
  onWithdrawChange: (id: string) => void
  /** Add or amend a line on the payment schedule. */
  onUpsertMilestone: (sowId: string, id: string | null, patch: Partial<Milestone>) => boolean
  onRemoveMilestone: (id: string) => void
  /** Say the work landed. Separate from accepting it — see lib/milestone.ts. */
  onDeliverMilestone: (id: string) => boolean
  onDecideMilestone: (id: string, decision: 'Accepted' | 'Rejected', note?: string) => boolean
  /** A line of what the SOW says it will deliver. */
  onUpsertScope: (sowId: string, id: string | null, patch: Partial<ScopeItem>) => boolean
  onRemoveScope: (id: string) => void
  /** Agree a line into the scope, or take it back out. */
  onDecideScope: (id: string, approved: boolean) => boolean
}) {
  const mayEdit = can(state.model, actor, 'sow.edit')
  const mayAttribute = can(state.model, actor, 'sow.attribute')
  const mayDecideChange = can(state.model, actor, 'change.approve')
  const mayEditMilestone = can(state.model, actor, 'milestone.edit')
  const mayAcceptMilestone = can(state.model, actor, 'milestone.accept')
  const mayEditScope = can(state.model, actor, 'scope.edit')
  const mayApproveScope = can(state.model, actor, 'scope.approve')
  const [adding, setAdding] = useState(false)

  const sows = useMemo(
    () =>
      Object.values(state.sows)
        .filter((s) => s.engagementId === row.id && !s.deletedAt)
        .sort((a, b) => a.reference.localeCompare(b.reference)),
    [state.sows, row.id],
  )

  /** Projects under this engagement, and which statement of work each is delivered under. */
  const projects = useMemo(
    () => Object.values(state.nodes).filter((n) => n.kind === 'project' && !n.deletedAt && n.parentId === row.id),
    [state.nodes, row.id],
  )

  /** Every issue beneath a project, so consumption counts the work rather than the tiers. */
  const issuesUnder = useMemo(() => {
    const byProject: Record<string, string[]> = {}
    for (const project of projects) {
      const wanted = new Set<string>([project.id])
      // Process areas sit between a project and its work, so the walk is two deep at least.
      let grew = true
      while (grew) {
        grew = false
        for (const n of Object.values(state.nodes)) {
          if (!n.deletedAt && n.parentId && wanted.has(n.parentId) && !wanted.has(n.id)) {
            wanted.add(n.id)
            grew = true
          }
        }
      }
      byProject[project.id] = Object.values(state.issues)
        .filter((i) => !i.deletedAt && wanted.has(i.parentId))
        .map((i) => i.id)
    }
    return byProject
  }, [projects, state.nodes, state.issues])

  /**
   * Issues anywhere under this engagement that could be the change a priced request came from.
   *
   * Not scoped to a SOW — the register carries no per-SOW tag on an issue, and a change
   * raised here is engagement-level knowledge before it is one contract's knowledge. Matched
   * on the work type's label, the same way scenario O and P do: unlike Risk and Decision,
   * "Change Request" has no seeded stable id, so a label match is the only join available.
   */
  const changeRequestIssues = useMemo(
    () => issuesUnderEngagement(state, row.id).filter((i) => /change request/i.test(i.type)),
    [state, row.id],
  )

  const positions = useMemo(() => {
    return sows.map((sow) => {
      const ids = projects
        .filter((p) => p.sowId === sow.id)
        .flatMap((p) => issuesUnder[p.id] ?? [])
      return sowPosition(sow, ids, state.estimates, state.timeEntries, state.model.sizeBands, Object.values(state.changes))
    })
  }, [sows, projects, issuesUnder, state.estimates, state.timeEntries, state.model.sizeBands])

  const unattributed = projects.filter((p) => !p.sowId)

  return (
    <div className="comm-panel">
      <div className="comm-head">
        <h4 className="est-h">Statements of work</h4>
        {mayEdit.allowed ? (
          <button className="btn" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Record a SOW'}
          </button>
        ) : (
          <span className="prov">{mayEdit.reason}</span>
        )}
      </div>

      {adding && (
        <SowForm
          onCancel={() => setAdding(false)}
          onSave={(patch) => {
            onUpsert(null, row.id, patch)
            setAdding(false)
          }}
        />
      )}

      {sows.length === 0 && !adding && (
        <p className="panel-note">
          Nothing contracted here yet. Until a statement of work exists there is no boundary for
          a request to be outside of — the engagement can be delivered, and scope leakage cannot
          be measured.
        </p>
      )}

      {sows.map((sow, i) => {
        const position = positions[i]
        return (
          <div className="comm-sow" key={sow.id}>
            <div className="comm-sow-head">
              <span className="comm-ref">{sow.reference}</span>
              <span className="comm-title">{sow.title}</span>
              <span className={`comm-status st-${sow.status.toLowerCase()}`}>{sow.status}</span>
              <span className="grow" />
              {/*
                * Retiring a SOW had no control, so one entered by mistake stayed for good.
                * The reducer refuses while live projects are attributed to it — the button does
                * not pre-empt that, because the refusal names how many and is more useful than
                * a disabled control with a guess in its tooltip.
                */}
              <button
                className="btn ghost"
                title="Archive this statement of work. Refused while projects are still delivered under it."
                onClick={() => onArchive(sow.id)}
              >
                Archive
              </button>
            </div>

            <div className="comm-figures">
              <div>
                <span className="est-block-label">Agreed</span>
                <span className="mono">
                  {sow.effortHours}h · {sow.currency} {sow.value.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="est-block-label">Planned</span>
                <span className="mono">{position.plannedHours}h</span>
              </div>
              <div>
                <span className="est-block-label">Spent</span>
                <span className="mono">{position.actualHours}h</span>
              </div>
              <div>
                <span className="est-block-label">Left</span>
                <span className={`mono${position.remainingHours < 0 ? ' est-over' : ''}`}>
                  {position.remainingHours}h
                </span>
              </div>
            </div>

            <p className={`comm-position${position.forecastOverrun ? ' warn' : ''}`}>
              {describePosition(position)}
            </p>

            <Scope
              sow={sow}
              items={Object.values(state.scopeItems).filter((i) => i.sowId === sow.id && !i.deletedAt)}
              contractedHours={contractedPosition(sow, Object.values(state.changes).filter((c) => c.sowId === sow.id && !c.deletedAt)).contractedHours}
              mayEdit={mayEditScope.allowed}
              mayApprove={mayApproveScope.allowed}
              onUpsert={onUpsertScope}
              onRemove={onRemoveScope}
              onDecide={onDecideScope}
            />

            <Milestones
              sow={sow}
              milestones={Object.values(state.milestones).filter((m) => m.sowId === sow.id && !m.deletedAt)}
              contracted={contractedPosition(sow, Object.values(state.changes).filter((c) => c.sowId === sow.id && !c.deletedAt))}
              today={today}
              warnBeforeDays={state.model.watch.warnBeforeDays}
              mayEdit={mayEditMilestone.allowed}
              mayAccept={mayAcceptMilestone.allowed}
              actorName={actor.name}
              onUpsert={onUpsertMilestone}
              onRemove={onRemoveMilestone}
              onDeliver={onDeliverMilestone}
              onDecide={onDecideMilestone}
            />

            <Changes
              sow={sow}
              changes={Object.values(state.changes).filter((c) => c.sowId === sow.id && !c.deletedAt)}
              candidateIssues={changeRequestIssues}
              mayRaise={mayEdit.allowed}
              mayDecide={mayDecideChange.allowed}
              actorName={actor.name}
              onRaise={onRaiseChange}
              onDecide={onDecideChange}
              onWithdraw={onWithdrawChange}
            />

            {mayEdit.allowed && (
              <div className="comm-edit">
                <label className="fld">
                  <span className="fld-label">Status</span>
                  <select
                    value={sow.status}
                    onChange={(e) => onUpsert(sow.id, row.id, { status: e.target.value as SowStatus })}
                  >
                    {SOW_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="fld">
                  <span className="fld-label">Agreed effort (h)</span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={sow.effortHours}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v) && v !== sow.effortHours) onUpsert(sow.id, row.id, { effortHours: v })
                    }}
                  />
                </label>
                <label className="fld">
                  <span className="fld-label">Agreed value</span>
                  <input
                    type="number"
                    min={0}
                    defaultValue={sow.value}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v) && v !== sow.value) onUpsert(sow.id, row.id, { value: v })
                    }}
                  />
                </label>
                <span className="prov">
                  {sow.signedOn ? `Signed ${formatIso(sow.signedOn)}` : 'Not signed'} · changes to
                  effort or value are recorded as a variation, with both figures either side
                </span>
              </div>
            )}
          </div>
        )
      })}

      <h4 className="est-h">Delivered under</h4>
      {projects.length === 0 ? (
        <p className="prov">No projects under this engagement yet.</p>
      ) : (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Statement of work</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {mayAttribute.allowed ? (
                    <select
                      value={p.sowId ?? ''}
                      onChange={(e) => onAttribute(p.id, e.target.value || null)}
                      aria-label={`Statement of work for ${p.name}`}
                    >
                      <option value="">— not attributed —</option>
                      {sows
                        .filter((s) => LIVE_SOW_STATUSES.includes(s.status) || s.id === p.sowId)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.reference}
                          </option>
                        ))}
                    </select>
                  ) : (
                    (sows.find((s) => s.id === p.sowId)?.reference ?? <span className="prov">— not attributed —</span>)
                  )}
                </td>
                <td className="mono">{(issuesUnder[p.id] ?? []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {unattributed.length > 0 && sows.length > 0 && (
        <p className="panel-note warn">
          {unattributed.length} project{unattributed.length === 1 ? ' is' : 's are'} attributed to
          no statement of work. Whatever is delivered there is invisible to every figure above —
          which is what scope leakage looks like before anybody calls it that.
        </p>
      )}

      <p className="panel-note">
        Whether a particular request falls inside the scope statement is a commercial judgement,
        and this screen does not make it. What it does is make the consequence visible — the
        agreed effort, what the plan now needs, and what has been spent — and the change-request
        path is there for when the answer is that the work is genuinely extra.
      </p>
    </div>
  )
}

/** A new SOW. Deliberately short: a reference, a title, and the two baseline figures. */
function SowForm({
  onSave,
  onCancel,
}: {
  onSave: (patch: Partial<Sow>) => void
  onCancel: () => void
}) {
  const [reference, setReference] = useState('')
  const [title, setTitle] = useState('')
  const [effortHours, setEffort] = useState('')
  const [value, setValue] = useState('')

  return (
    <div className="comm-form">
      <div className="time-row">
        <label className="fld">
          <span className="fld-label">Reference</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SOW-2026-014" />
        </label>
        <label className="fld time-fld-note">
          <span className="fld-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Phase 2 — inventory remediation" />
        </label>
        <label className="fld">
          <span className="fld-label">Agreed effort (h)</span>
          <input type="number" min={0} value={effortHours} onChange={(e) => setEffort(e.target.value)} />
        </label>
        <label className="fld">
          <span className="fld-label">Agreed value</span>
          <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button
          className="btn primary"
          disabled={!reference.trim() || !title.trim()}
          onClick={() =>
            onSave({
              reference: reference.trim(),
              title: title.trim(),
              effortHours: Number(effortHours) || 0,
              value: Number(value) || 0,
            })
          }
        >
          Record
        </button>
        <button className="btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Variations to one statement of work.
 *
 * The figures shown are the movements, signed, and the baseline above them never moves — see
 * `ChangeRequest`. A pending change is listed with its value and is visibly NOT in the
 * contracted total, because a client-facing figure that quietly includes something nobody has
 * agreed to is the worst thing this screen could do.
 */
function Changes({
  sow,
  changes,
  candidateIssues,
  mayRaise,
  mayDecide,
  actorName,
  onRaise,
  onDecide,
  onWithdraw,
}: {
  sow: Sow
  changes: ChangeRequest[]
  /** Issues under the engagement a raised change could be linking back to. See the caller. */
  candidateIssues: { id: string; subject: string }[]
  mayRaise: boolean
  mayDecide: boolean
  actorName: string
  onRaise: (sowId: string, c: { title: string; effortHours: number; value: number; reason: string; scope: string; effectiveFrom: string | null; issueId: string | null }, submit: boolean) => boolean
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => boolean
  onWithdraw: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [issueId, setIssueId] = useState('')
  const [refusing, setRefusing] = useState<string | null>(null)
  const [refusal, setRefusal] = useState('')

  const position = contractedPosition(sow, changes)
  const movement = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`
  const issueSubject = new Map(candidateIssues.map((i) => [i.id, i.subject]))

  const ready = title.trim() !== '' && reason.trim() !== '' && (Number(hours) !== 0 || Number(value) !== 0)

  return (
    <section className="comm-changes">
      <h5 className="est-h">Changes</h5>

      {changes.length === 0 ? (
        <p className="comm-position">
          No changes recorded. The figures above are the contract as signed.
        </p>
      ) : (
        <>
          <p className="comm-position">{describeContracted(position)}</p>
          <table className="cfg-table est-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Effort</th>
                <th>Value</th>
                <th>From</th>
                <th>Status</th>
                <th>Why</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.title}
                    {c.issueId && (
                      <div className="est-block-note">→ {issueSubject.get(c.issueId) ?? c.issueId}</div>
                    )}
                  </td>
                  <td className="mono">{movement(c.effortHours)}h</td>
                  <td className="mono">
                    {c.value < 0 ? '−' : c.value > 0 ? '+' : ''}
                    {c.currency} {Math.abs(c.value).toLocaleString()}
                  </td>
                  <td className="mono">{c.effectiveFrom ?? (c.decidedAt ? c.decidedAt.slice(0, 10) : '—')}</td>
                  <td>
                    <span className={`comm-status st-${c.status.toLowerCase()}`}>{c.status}</span>
                    {c.status === 'Submitted' && <span className="est-block-note"> · not in the total</span>}
                  </td>
                  <td>
                    {c.reason}
                    {c.decisionNote && <span className="est-block-note"> — {c.decisionNote}</span>}
                  </td>
                  <td>
                    {c.status === 'Submitted' && mayDecide ? (
                      c.requestedBy.trim().toLowerCase() === actorName.trim().toLowerCase() ? (
                        <span className="est-block-note">You raised this — somebody else decides it.</span>
                      ) : refusing === c.id ? (
                        <>
                          <input
                            className="fld-input"
                            placeholder="Why it is refused"
                            value={refusal}
                            onChange={(e) => setRefusal(e.target.value)}
                            aria-label="Reason for refusing"
                          />
                          <button
                            className="btn-link"
                            disabled={!refusal.trim()}
                            onClick={() => {
                              if (onDecide(c.id, 'rejected', refusal)) {
                                setRefusing(null)
                                setRefusal('')
                              }
                            }}
                          >
                            Refuse
                          </button>{' '}
                          <button className="btn-link" onClick={() => setRefusing(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-link" onClick={() => onDecide(c.id, 'approved')}>
                            Approve
                          </button>{' '}
                          <button className="btn-link" onClick={() => setRefusing(c.id)}>
                            Refuse
                          </button>
                        </>
                      )
                    ) : null}
                    {c.status !== 'Approved' && c.status !== 'Withdrawn' && mayRaise ? (
                      <>
                        {' '}
                        <button className="btn-link" onClick={() => onWithdraw(c.id)}>
                          Withdraw
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {mayRaise ? (
        open ? (
          <div className="time-form">
            <div className="time-row">
              <label className="fld time-fld-person">
                <span className="fld-label">What changes</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title" />
              </label>
              <label className="fld time-fld-hours">
                <span className="fld-label">Effort ±h</span>
                <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" />
              </label>
              <label className="fld time-fld-hours">
                <span className="fld-label">Value ±</span>
                <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
              </label>
              <label className="fld">
                <span className="fld-label">Effective from</span>
                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </label>
            </div>
            <div className="time-row">
              <label className="fld time-fld-note">
                <span className="fld-label">Why</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What prompted it" />
              </label>
              <label className="fld time-fld-note">
                <span className="fld-label">Scope</span>
                <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What is being added or removed" />
              </label>
              <label className="fld">
                <span className="fld-label">Linked issue</span>
                <select
                  value={issueId}
                  onChange={(e) => setIssueId(e.target.value)}
                  title="The issue in the register this change was raised against, if there is one"
                >
                  <option value="">None</option>
                  {candidateIssues.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.subject}
                    </option>
                  ))}
                </select>
              </label>
              {/*
                * Two buttons rather than one with a tick. Saving a draft and asking somebody to
                * commit the firm to it are different acts, and a checkbox makes the second one
                * possible to do by accident.
                */}
              <button
                className="btn"
                disabled={!ready}
                title={ready ? 'Keep working on it' : 'Needs a title, a reason, and a movement'}
                onClick={() => {
                  if (onRaise(sow.id, { title, effortHours: Number(hours) || 0, value: Number(value) || 0, reason, scope, effectiveFrom: effectiveFrom || null, issueId: issueId || null }, false)) {
                    setOpen(false)
                    setTitle(''); setHours(''); setValue(''); setReason(''); setScope(''); setEffectiveFrom(''); setIssueId('')
                  }
                }}
              >
                Save draft
              </button>
              <button
                className="btn primary"
                disabled={!ready}
                title={ready ? 'Send it for a decision' : 'Needs a title, a reason, and a movement'}
                onClick={() => {
                  if (onRaise(sow.id, { title, effortHours: Number(hours) || 0, value: Number(value) || 0, reason, scope, effectiveFrom: effectiveFrom || null, issueId: issueId || null }, true)) {
                    setOpen(false)
                    setTitle(''); setHours(''); setValue(''); setReason(''); setScope(''); setEffectiveFrom(''); setIssueId('')
                  }
                }}
              >
                Submit for decision
              </button>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setOpen(true)}>
            Raise a change
          </button>
        )
      ) : null}
    </section>
  )
}

/**
 * The payment schedule.
 *
 * Two columns for state rather than one, because delivery and acceptance are two axes — this
 * firm sells "50% upfront, 50% credited vs implementation" alongside "4 milestones
 * (25/35/25/15)", and one lane cannot hold the first. It is also what makes "delivered but not
 * accepted" a question the screen can answer, which the audit records as one the product could
 * not ask.
 *
 * A statement of work with no milestones is not shown as 0% billed. Six of the firm's services
 * are monthly retainers and legitimately have none, and reporting a fault that is not there is
 * how a screen stops being read.
 */
function Milestones({
  sow,
  milestones,
  contracted,
  today,
  warnBeforeDays,
  mayEdit,
  mayAccept,
  actorName,
  onUpsert,
  onRemove,
  onDeliver,
  onDecide,
}: {
  sow: Sow
  milestones: Milestone[]
  contracted: ReturnType<typeof contractedPosition>
  today: string
  warnBeforeDays: number
  mayEdit: boolean
  mayAccept: boolean
  actorName: string
  onUpsert: (sowId: string, id: string | null, patch: Partial<Milestone>) => boolean
  onRemove: (id: string) => void
  onDeliver: (id: string) => boolean
  onDecide: (id: string, decision: 'Accepted' | 'Rejected', note?: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [pct, setPct] = useState('')
  const [billOn, setBillOn] = useState<BillingTrigger>('acceptance')
  const [planned, setPlanned] = useState('')
  const [returning, setReturning] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  /* One row at a time, like the Rates tab's correction row. */
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPct, setEditPct] = useState('')
  const [editDue, setEditDue] = useState('')

  const position = milestonePosition(sow.id, milestones, contracted)
  const gap = scheduleProblem(position)
  const ordered = milestones.slice().sort((a, b) => a.sequence - b.sequence)
  const ready = name.trim() !== '' && Number(pct) > 0 && Number(pct) <= 100

  return (
    <section className="comm-changes">
      <h5 className="est-h">Payment schedule</h5>
      <p className="comm-position">{describeMilestones(position)}</p>
      {gap && <p className="comm-position warn">{gap}</p>}

      {ordered.length > 0 && (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Milestone</th>
              <th>Worth</th>
              <th>Due</th>
              <th>Delivery</th>
              <th>Acceptance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.flatMap((m) => {
              const value = milestoneValue(m, contracted)
              /* The deliverer cannot accept — the reducer refuses it, so the control is not
                 offered either. A button that can never succeed is worse than no button. */
              const theirs = m.deliveredBy?.trim().toLowerCase() === actorName.trim().toLowerCase()
              const risk = milestoneRisk(m, today, warnBeforeDays)
              return [
                <tr key={m.id} title={describeMilestone(m, value)}>
                  <td className="mono">{m.sequence}</td>
                  <td>{m.name}</td>
                  <td className="mono">
                    {value === null ? '—' : `${m.currency} ${Math.round(value).toLocaleString()}`}
                    {m.basis === 'percentage' && <span className="est-block-note"> {m.percentage}%</span>}
                    {m.acceptedValue !== null && <span className="est-block-note"> · fixed at acceptance</span>}
                  </td>
                  <td className="mono">
                    {m.plannedDate ?? '—'}
                    {risk === 'overdue' && (
                      <span className="est-block-note warn">
                        {' '}
                        {workingDaysBetween(m.plannedDate!, today)} working day
                        {workingDaysBetween(m.plannedDate!, today) === 1 ? '' : 's'} overdue
                      </span>
                    )}
                    {risk === 'dueSoon' && (
                      <span className="est-block-note">
                        {' '}
                        {workingDaysBetween(today, m.plannedDate!)} working day
                        {workingDaysBetween(today, m.plannedDate!) === 1 ? '' : 's'} left
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`comm-status st-${m.delivery.toLowerCase()}`}>{m.delivery}</span>
                  </td>
                  <td>
                    <span className={`comm-status st-${m.acceptance.toLowerCase()}`}>{m.acceptance}</span>
                    {isBillable(m) && <span className="est-block-note"> · billable</span>}
                    {m.acceptance === 'Accepted' && !m.evidenceDocumentId && (
                      <span className="est-block-note"> · no signed acceptance held</span>
                    )}
                    {m.rejectionNote && <span className="est-block-note"> — {m.rejectionNote}</span>}
                  </td>
                  <td>
                    {mayEdit && m.delivery !== 'Delivered' && m.acceptance !== 'Accepted' && (
                      <>
                        <button className="btn-link" onClick={() => onDeliver(m.id)}>
                          Delivered
                        </button>{' '}
                      </>
                    )}
                    {mayAccept && m.acceptance !== 'Accepted' && !theirs && (m.delivery === 'Delivered' || m.billOn === 'signature') && (
                      returning === m.id ? (
                        <>
                          <input
                            className="fld-input"
                            placeholder="What has to change"
                            value={why}
                            onChange={(e) => setWhy(e.target.value)}
                            aria-label="Reason for returning"
                          />
                          <button
                            className="btn-link"
                            disabled={!why.trim()}
                            onClick={() => {
                              if (onDecide(m.id, 'Rejected', why)) {
                                setReturning(null)
                                setWhy('')
                              }
                            }}
                          >
                            Return
                          </button>{' '}
                          <button className="btn-link" onClick={() => setReturning(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-link" onClick={() => onDecide(m.id, 'Accepted')}>
                            Accept
                          </button>{' '}
                          <button className="btn-link" onClick={() => setReturning(m.id)}>
                            Return
                          </button>{' '}
                        </>
                      )
                    )}
                    {mayAccept && theirs && m.acceptance !== 'Accepted' && (
                      <span className="est-block-note">You recorded this delivered — somebody else accepts it.</span>
                    )}
                    {mayEdit && m.acceptance !== 'Accepted' && (
                      <>
                        {/*
                          * The edit path. Without it `upsertMilestone`'s whole existing-record
                          * branch is unreachable and a typo in a milestone name is permanent —
                          * the "built, but no way in" fault the audit calls its most actionable
                          * finding.
                          *
                          * Not offered on an accepted milestone, because the reducer refuses it:
                          * the value was frozen and the client signed against this name.
                          */}
                        <button
                          className="btn-link"
                          onClick={() => {
                            setEditing(editing === m.id ? null : m.id)
                            setEditName(m.name)
                            setEditPct(m.percentage === null ? '' : String(m.percentage))
                            setEditDue(m.plannedDate ?? '')
                          }}
                        >
                          {editing === m.id ? 'Cancel' : 'Edit'}
                        </button>{' '}
                        <button className="btn-link" onClick={() => onRemove(m.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>,
                editing === m.id ? (
                  <tr key={`${m.id}-edit`}>
                    <td colSpan={7}>
                      <div className="time-row">
                        <label className="fld time-fld-person">
                          <span className="fld-label">Milestone</span>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </label>
                        <label className="fld time-fld-hours">
                          <span className="fld-label">% of contract</span>
                          <input type="number" min={0} max={100} step="0.001" value={editPct} onChange={(e) => setEditPct(e.target.value)} />
                        </label>
                        <label className="fld">
                          <span className="fld-label">Due</span>
                          <input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} />
                        </label>
                        {/*
                          * `billOn` is deliberately not editable here. When a milestone becomes
                          * billable is a term somebody negotiated, and changing it on a live
                          * schedule is a commercial amendment rather than a correction — that is
                          * what a change request is for.
                          */}
                        <span className="est-block-note">
                          Billable on {m.billOn}. Changing that is an amendment, not a correction.
                        </span>
                        <button
                          className="btn"
                          disabled={!editName.trim() || !(Number(editPct) > 0 && Number(editPct) <= 100)}
                          onClick={() => {
                            if (
                              onUpsert(sow.id, m.id, {
                                name: editName,
                                percentage: Number(editPct),
                                plannedDate: editDue || null,
                              })
                            ) {
                              setEditing(null)
                            }
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      )}

      {mayEdit ? (
        open ? (
          <div className="time-form">
            <div className="time-row">
              <label className="fld time-fld-person">
                <span className="fld-label">Milestone</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Design sign-off" />
              </label>
              <label className="fld time-fld-hours">
                <span className="fld-label">% of contract</span>
                <input type="number" min={0} max={100} step="0.001" value={pct} onChange={(e) => setPct(e.target.value)} />
              </label>
              <label className="fld">
                <span className="fld-label">Billable on</span>
                <select value={billOn} onChange={(e) => setBillOn(e.target.value as BillingTrigger)}>
                  {BILLING_TRIGGERS.map((b) => (
                    <option key={b} value={b}>
                      {b === 'acceptance' ? 'Acceptance' : b === 'signature' ? 'Signature (upfront)' : 'Delivery'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld">
                <span className="fld-label">Due</span>
                <input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} />
              </label>
              {/*
                * Percentage only on this form. A fixed-amount milestone is supported by the model
                * and is the rarer shape; offering both here would make the common case a choice
                * before it is an entry. The total is reported above, never enforced — a schedule
                * is half-finished for as long as somebody is typing it.
                */}
              <button
                className="btn"
                disabled={!ready}
                title={ready ? 'Add it' : 'Needs a name and a percentage between 0 and 100'}
                onClick={() => {
                  if (
                    onUpsert(sow.id, null, {
                      name,
                      basis: 'percentage',
                      percentage: Number(pct),
                      billOn,
                      plannedDate: planned || null,
                      description: '',
                    })
                  ) {
                    setOpen(false)
                    setName(''); setPct(''); setPlanned('')
                  }
                }}
              >
                Add
              </button>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setOpen(true)}>
            Add a milestone
          </button>
        )
      ) : null}
    </section>
  )
}

/**
 * What the statement of work says it will deliver.
 *
 * Above the payment schedule, deliberately: what is being delivered is prior to what it is
 * billed at, and reading the money first is how a scope conversation turns into a pricing one.
 *
 * Recorded and agreed are shown as different things. A line somebody typed while reading a draft
 * is not scope, and its hours stay out of the total the contract is compared against — which is
 * the whole reason `decideScopeItem` exists as a separate act.
 */
function Scope({
  sow,
  items,
  contractedHours,
  mayEdit,
  mayApprove,
  onUpsert,
  onRemove,
  onDecide,
}: {
  sow: Sow
  items: ScopeItem[]
  contractedHours: number
  mayEdit: boolean
  mayApprove: boolean
  onUpsert: (sowId: string, id: string | null, patch: Partial<ScopeItem>) => boolean
  onRemove: (id: string) => void
  onDecide: (id: string, approved: boolean) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ScopeKind>('deliverable')
  const [text, setText] = useState('')
  const [hours, setHours] = useState('')
  const [under, setUnder] = useState('')

  const position = scopePosition(sow.id, items, contractedHours)
  const ordered = scopeFor(items, sow.id)
  const gap = effortProblem(position)
  /* Only top-level lines can be parents — scope is one level deep, and the reducer refuses more. */
  const parents = ordered.filter((i) => !i.parentId)
  const carriesEffort = WORK_KINDS.includes(kind)
  const ready = text.trim() !== ''

  return (
    <section className="comm-changes">
      <h5 className="est-h">Scope</h5>
      <p className="comm-position">{describeScope(position)}</p>
      {gap && <p className="comm-position warn">{gap}</p>}

      {ordered.length > 0 && (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>What</th>
              <th>Kind</th>
              <th>Effort</th>
              <th>Agreed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((i) => (
              <tr key={i.id}>
                <td style={i.parentId ? { paddingLeft: 22 } : undefined}>
                  {i.parentId && <span className="est-block-note">↳ </span>}
                  {i.text}
                  {i.source === 'extracted' && <span className="est-block-note"> · proposed by extraction</span>}
                </td>
                <td>{SCOPE_KIND_LABEL[i.kind]}</td>
                <td className="mono">{i.effortHours === null ? '—' : `${i.effortHours}h`}</td>
                <td>
                  {i.approvedAt ? (
                    <span className="comm-status st-accepted">Agreed</span>
                  ) : (
                    <span className="comm-status st-pending">Recorded</span>
                  )}
                  {i.approvedBy && <span className="est-block-note"> — {i.approvedBy}</span>}
                </td>
                <td>
                  {mayApprove && (
                    <>
                      <button className="btn-link" onClick={() => onDecide(i.id, !i.approvedAt)}>
                        {i.approvedAt ? 'Un-agree' : 'Agree'}
                      </button>{' '}
                    </>
                  )}
                  {/*
                    * Neither edit nor remove is offered on an agreed line — the reducer refuses
                    * both, because changing what was agreed without a decision is how a contract
                    * and a plan stop matching. Un-agree first.
                    */}
                  {mayEdit && !i.approvedAt && (
                    <button className="btn-link" onClick={() => onRemove(i.id)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mayEdit ? (
        open ? (
          <div className="time-form">
            <div className="time-row">
              <label className="fld">
                <span className="fld-label">Kind</span>
                <select
                  value={kind}
                  onChange={(e) => {
                    const next = e.target.value as ScopeKind
                    setKind(next)
                    // Hours belong to work, not to statements about the agreement. Cleared here
                    // as well as refused by the reducer, so the field cannot be left looking set.
                    if (!WORK_KINDS.includes(next)) setHours('')
                  }}
                >
                  {SCOPE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SCOPE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fld time-fld-note">
                <span className="fld-label">What was agreed</span>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="One line, as the contract puts it" />
              </label>
              {carriesEffort && (
                <label className="fld time-fld-hours">
                  <span className="fld-label">Effort</span>
                  <input type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
                </label>
              )}
              {parents.length > 0 && (
                <label className="fld time-fld-person">
                  <span className="fld-label">Under</span>
                  <select value={under} onChange={(e) => setUnder(e.target.value)}>
                    <option value="">Nothing — a line of its own</option>
                    {parents.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.text.slice(0, 44)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="btn"
                disabled={!ready}
                title={ready ? 'Record it' : 'A line of scope needs to say something'}
                onClick={() => {
                  if (
                    onUpsert(sow.id, null, {
                      kind,
                      text,
                      parentId: under || null,
                      effortHours: carriesEffort && hours !== '' ? Number(hours) : null,
                      source: 'stated',
                    })
                  ) {
                    setOpen(false)
                    setText('')
                    setHours('')
                    setUnder('')
                  }
                }}
              >
                Record
              </button>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setOpen(true)}>
            Record a line of scope
          </button>
        )
      ) : null}
    </section>
  )
}
