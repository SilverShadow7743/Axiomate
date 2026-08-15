'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import { LIVE_SOW_STATUSES, SOW_STATUSES, describePosition, sowPosition, type Sow, type SowStatus } from '@/lib/sow'
import type { ScheduleRow } from '@/lib/types'
import type { WorkspaceState } from '@/lib/workspace'
import { formatIso } from '@/lib/dates'

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
  allRows,
  onUpsert,
  onAttribute,
}: {
  row: ScheduleRow
  state: WorkspaceState
  actor: Actor
  allRows: ScheduleRow[]
  onUpsert: (id: string | null, engagementId: string, patch: Partial<Sow>) => void
  onAttribute: (nodeId: string, sowId: string | null) => void
}) {
  const mayEdit = can(state.model, actor, 'sow.edit')
  const mayAttribute = can(state.model, actor, 'sow.attribute')
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

  const positions = useMemo(() => {
    return sows.map((sow) => {
      const ids = projects
        .filter((p) => p.sowId === sow.id)
        .flatMap((p) => issuesUnder[p.id] ?? [])
      return sowPosition(sow, ids, state.estimates, state.timeEntries, state.model.sizeBands)
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
