'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { canEditIssue } from '@/lib/permissions'
import { ISSUE_STATUSES, type IssueStatus, type ScheduleRow, type Severity } from '@/lib/types'
import { liveWorkTypes } from '@/lib/config'
import type { IssueRecord, WorkspaceState } from '@/lib/workspace'
import { formatIso } from '@/lib/dates'
import { useLabels } from './labels'

/**
 * The current state of an issue, and where it is changed.
 *
 * This was a read-only summary with a separate full-page editor behind it, which meant the
 * commonest action in a delivery tool — read a row, change one field, move on — cost a screen
 * transition each way and lost the surrounding context every time.
 *
 * Two things it deliberately does not do:
 *
 *  - **Save on blur.** The rest of this panel commits per field, which is right for a single
 *    cell but wrong here: an explicit Save is what makes Cancel meaningful, and a form of
 *    twelve fields that writes as you tab through it cannot be abandoned.
 *  - **Edit what the tree owns.** Client and Process Area are read-only below. They are not
 *    stored opinions, they are where the record *sits*; the reducer keeps them in step with
 *    the record's position on Move. A text box here would let an issue claim OAPIL while
 *    living under SLG, and nothing would notice.
 */

export interface IssueDraft {
  subject: string
  description: string
  type: string
  status: IssueStatus
  severity: Severity
  owner: string
  accountable: string
  nextAction: string
  plannedStart: string
  plannedEnd: string
}

function draftOf(i: IssueRecord): IssueDraft {
  return {
    subject: i.subject,
    description: i.description,
    type: i.type,
    status: i.status,
    severity: i.severity,
    owner: i.owner,
    accountable: i.accountable,
    nextAction: i.nextAction,
    plannedStart: i.plannedStart ?? '',
    plannedEnd: i.plannedEnd ?? '',
  }
}

export default function OverviewTab({
  row,
  issue,
  state,
  actor,
  customResponsibilities,
  onSetAssignment,
  onSave,
  onDirtyChange,
  editing,
  setEditing,
}: {
  row: ScheduleRow
  issue: NonNullable<ScheduleRow['issue']>
  state: WorkspaceState
  actor: Actor
  customResponsibilities: { id: string; label: string; requiredHere: boolean; values: string[] }[]
  onSetAssignment: (responsibilityId: string, values: string[]) => void
  onSave: (patch: Partial<IssueRecord>, dates: { start: string; end: string } | null) => boolean
  onDirtyChange: (dirty: boolean) => void
  editing: boolean
  setEditing: (v: boolean) => void
}) {
  const labels = useLabels()
  const record = state.issues[issue.id]
  const may = canEditIssue(state.model, actor)
  const workTypes = useMemo(() => liveWorkTypes(state.model).map((t) => t.label), [state.model])

  const [draft, setDraft] = useState<IssueDraft>(() => (record ? draftOf(record) : draftOf(issue as IssueRecord)))

  // Re-seed when the underlying record changes identity or is saved from elsewhere. Keyed on
  // the id so switching issues never carries one record's draft onto another.
  useEffect(() => {
    if (record && !editing) setDraft(draftOf(record))
  }, [record, editing, issue.id])

  const dirty = useMemo(() => {
    if (!record) return false
    const base = draftOf(record)
    return (Object.keys(base) as (keyof IssueDraft)[]).some((k) => base[k] !== draft[k])
  }, [record, draft])

  useEffect(() => {
    onDirtyChange(editing && dirty)
  }, [editing, dirty, onDirtyChange])

  const set = <K extends keyof IssueDraft>(k: K, v: IssueDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const cancel = () => {
    if (record) setDraft(draftOf(record))
    setEditing(false)
  }

  const save = () => {
    if (!record) return
    const base = draftOf(record)
    const patch: Partial<IssueRecord> = {}
    for (const k of Object.keys(base) as (keyof IssueDraft)[]) {
      if (k === 'plannedStart' || k === 'plannedEnd') continue
      if (base[k] !== draft[k]) (patch as Record<string, unknown>)[k] = draft[k]
    }
    // Dates go through their own action so the schedule's validation and reason-tracking
    // apply — writing them as plain fields would bypass both.
    const datesChanged =
      base.plannedStart !== draft.plannedStart || base.plannedEnd !== draft.plannedEnd
    const dates =
      datesChanged && draft.plannedStart && draft.plannedEnd
        ? { start: draft.plannedStart, end: draft.plannedEnd }
        : null
    if (onSave(patch, dates)) setEditing(false)
  }

  /* ---------------- view ---------------- */

  if (!editing) {
    return (
      <>
        <div className="ov-actions">
          {may.allowed ? (
            <button className="btn primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : (
            <span className="prov">{may.reason ?? 'Read only.'}</span>
          )}
        </div>
        <div className="cols-2">
          <dl className="kv">
            <dt>Issue</dt>
            <dd className="mono">{issue.id}</dd>
            <dt>Subject</dt>
            <dd>{issue.subject}</dd>
            <dt>Description</dt>
            <dd className="ov-prose">{issue.description || '—'}</dd>
            <dt>{labels.TIER_ORGANIZATION} / {labels.TIER_MODULE}</dt>
            <dd>
              {issue.client} · {issue.module}
              <span className="prov"> · follows its place in the tree; use Move to change it</span>
            </dd>
            <dt>Type</dt>
            <dd>
              {issue.type}
              {issue.sourceType && issue.sourceType !== issue.type && (
                <span className="prov"> · recorded in the log as “{issue.sourceType}”</span>
              )}
            </dd>
            <dt>{labels.FIELD_SEVERITY}</dt>
            <dd className={`sev-${issue.severity}`}>{issue.severity}</dd>
            <dt>{labels.FIELD_STATUS}</dt>
            <dd>{issue.status}</dd>
          </dl>
          <dl className="kv">
            <dt>{labels.ISSUE_OWNER}</dt>
            <dd>{issue.owner}</dd>
            <dt>{labels.ISSUE_RAISED_BY}</dt>
            <dd>{issue.raisedBy || '—'}</dd>
            <dt>{labels.ISSUE_ACCOUNTABLE}</dt>
            <dd>{issue.accountable}</dd>
            <dt>{labels.FIELD_NEXT_ACTION}</dt>
            <dd className="ov-prose">{issue.nextAction || '—'}</dd>
            <dt>{labels.FIELD_START_DATE} / {labels.FIELD_DUE_DATE}</dt>
            <dd className="mono">
              {row.plannedStartDate ? formatIso(row.plannedStartDate) : '—'} ·{' '}
              {row.plannedEndDate ? formatIso(row.plannedEndDate) : '—'}
              {row.plannedOrigin === 'derived' && (
                <span className="prov"> · rolled up from its lifecycle</span>
              )}
            </dd>
            <dt>Raised</dt>
            <dd className="mono">
              {formatIso(issue.raised)}{' '}
              <span style={{ color: 'var(--text-faint)' }}>({issue.age}d ago)</span>
            </dd>
            <dt>Last activity</dt>
            <dd className="mono">
              {formatIso(issue.lastActivity)}{' '}
              <span style={{ color: 'var(--text-faint)' }}>({issue.daysSinceActivity}d ago)</span>
            </dd>
            {customResponsibilities.map((t) => (
              <Fragment key={t.id}>
                <dt>
                  {t.label}
                  {t.requiredHere && <span style={{ color: 'var(--h-overdue)' }}> *</span>}
                </dt>
                <dd>
                  <input
                    className="resp-input"
                    defaultValue={t.values.join(', ')}
                    onBlur={(e) => {
                      const next = e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean)
                      if (next.join(', ') !== t.values.join(', ')) onSetAssignment(t.id, next)
                    }}
                  />
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </>
    )
  }

  /* ---------------- edit ---------------- */

  return (
    <>
      <div className="ov-actions">
        <span className={`ov-dirty${dirty ? ' on' : ''}`}>
          {dirty ? 'Unsaved changes' : 'No changes yet'}
        </span>
        <span className="grow" />
        <button className="btn" onClick={cancel}>
          {dirty ? 'Discard changes' : 'Cancel'}
        </button>
        <button className="btn primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>

      <div className="cols-2">
        <dl className="kv">
          <dt>Issue</dt>
          <dd className="mono">
            {issue.id} <span className="prov">· not editable</span>
          </dd>
          <dt>Subject</dt>
          <dd>
            <input value={draft.subject} onChange={(e) => set('subject', e.target.value)} aria-label="Subject" />
          </dd>
          <dt>Description</dt>
          <dd>
            <textarea
              rows={4}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              aria-label="Description"
            />
          </dd>
          <dt>{labels.TIER_ORGANIZATION} / {labels.TIER_MODULE}</dt>
          <dd>
            {issue.client} · {issue.module}
            <span className="prov"> · not editable here; Move changes where the record sits</span>
          </dd>
          <dt>Type</dt>
          <dd>
            <select value={draft.type} onChange={(e) => set('type', e.target.value)} aria-label="Type">
              {/* A record can carry a type since archived from the registry; keep it selectable
                  rather than silently reclassifying the record on the next save. */}
              {(workTypes.includes(draft.type) ? workTypes : [draft.type, ...workTypes]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </dd>
          <dt>{labels.FIELD_SEVERITY}</dt>
          <dd>
            <select
              value={draft.severity}
              onChange={(e) => set('severity', e.target.value as Severity)}
              aria-label={labels.FIELD_SEVERITY}
            >
              {(['High', 'Medium', 'Low'] as Severity[]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </dd>
          <dt>{labels.FIELD_STATUS}</dt>
          <dd>
            <select
              value={draft.status}
              onChange={(e) => set('status', e.target.value as IssueStatus)}
              aria-label={labels.FIELD_STATUS}
            >
              {ISSUE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </dd>
        </dl>

        <dl className="kv">
          <dt>{labels.ISSUE_OWNER}</dt>
          <dd>
            <input value={draft.owner} onChange={(e) => set('owner', e.target.value)} aria-label={labels.ISSUE_OWNER} />
          </dd>
          <dt>{labels.ISSUE_RAISED_BY}</dt>
          <dd>
            {issue.raisedBy || '—'} <span className="prov">· recorded once, not reassigned</span>
          </dd>
          <dt>{labels.ISSUE_ACCOUNTABLE}</dt>
          <dd>
            <select
              value={draft.accountable}
              onChange={(e) => set('accountable', e.target.value)}
              aria-label={labels.ISSUE_ACCOUNTABLE}
            >
              {state.model.parties.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </dd>
          <dt>{labels.FIELD_NEXT_ACTION}</dt>
          <dd>
            <textarea
              rows={2}
              value={draft.nextAction}
              onChange={(e) => set('nextAction', e.target.value)}
              aria-label={labels.FIELD_NEXT_ACTION}
            />
          </dd>
          <dt>{labels.FIELD_START_DATE}</dt>
          <dd>
            <input
              type="date"
              value={draft.plannedStart}
              onChange={(e) => set('plannedStart', e.target.value)}
              aria-label={labels.FIELD_START_DATE}
            />
          </dd>
          <dt>{labels.FIELD_DUE_DATE}</dt>
          <dd>
            <input
              type="date"
              value={draft.plannedEnd}
              onChange={(e) => set('plannedEnd', e.target.value)}
              aria-label={labels.FIELD_DUE_DATE}
            />
            {row.plannedOrigin === 'derived' && (
              <span className="prov"> · currently rolled up from its lifecycle; setting a date here overrides that</span>
            )}
          </dd>
          <dt>Raised</dt>
          <dd className="mono">
            {formatIso(issue.raised)} <span className="prov">· recorded</span>
          </dd>
          <dt>Last activity</dt>
          <dd className="mono">
            {formatIso(issue.lastActivity)} <span className="prov">· maintained by the system</span>
          </dd>
        </dl>
      </div>
    </>
  )
}
