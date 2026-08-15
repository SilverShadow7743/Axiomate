'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import type { IssueStatus, Severity } from '@/lib/types'
import { STATUS_PROGRESS } from '@/lib/schedule'
import { daysBetween, formatIso } from '@/lib/dates'
import { nameOf, type WorkspaceState } from '@/lib/workspace'
import { liveWorkTypes } from '@/lib/config'
import { useLabels } from './labels'
import {
  KIND_ICON,
  KIND_LABEL,
  detectSourceDocument,
  latestOf,
  tallyByKind,
  type EvidenceKind,
} from '@/lib/evidence'

/**
 * Full-page edit workspace.
 *
 * When someone deliberately clicks Edit, editing is the job — so it gets the page, not a
 * column beside a tree they cannot use while typing. The form is a responsive grid rather
 * than one long vertical list, so a wide screen shortens the form instead of just padding it.
 *
 * This renders as a fixed overlay above the still-mounted workspace. That is deliberate:
 * nothing below unmounts, so filters, expansion, zoom, selection and both scroll positions
 * are exactly as they were when the user returns. Leaving is a pure unmount — there is no
 * state to restore, and therefore nothing to restore incorrectly.
 */

const SEVERITIES: Severity[] = ['High', 'Medium', 'Low']
const ACTIVE_STATUSES: IssueStatus[] = [
  'Open',
  'In Progress',
  'Needs clarification',
  'Awaiting client confirmation',
]
const CLOSING_STATUSES: IssueStatus[] = ['Closed - confirmed', 'Closed - no defect', 'Superseded']

export interface IssueFocusProps {
  mode: 'edit' | 'add'
  targetId: string
  state: WorkspaceState
  ownerOptions: string[]
  onClose: () => void
  onSubmit: (payload: Record<string, string>) => void
  /** Opens the evidence manager; kept out of this form so it stays a form. */
  onManageEvidence: (issueId: string) => void
}

export default function IssueFocus({
  mode,
  targetId,
  state,
  ownerOptions,
  onClose,
  onSubmit,
  onManageEvidence,
}: IssueFocusProps) {
  const labels = useLabels()
  const issue = mode === 'edit' ? state.issues[targetId] : null
  const parentName = mode === 'add' ? nameOf(state, targetId) : null

  const activityCount = useMemo(
    () =>
      issue
        ? Object.values(state.activities).filter((a) => a.issueId === issue.id && !a.deletedAt).length
        : 0,
    [state.activities, issue],
  )
  const evidenceItems = useMemo(
    () =>
      issue
        ? Object.values(state.evidence).filter((e) => e.issueId === issue.id && !e.deletedAt)
        : [],
    [state.evidence, issue],
  )
  const evidenceTally = useMemo(() => tallyByKind(evidenceItems), [evidenceItems])
  const latestEvidence = useMemo(() => latestOf(evidenceItems), [evidenceItems])
  const sourceDoc = useMemo(() => (issue ? detectSourceDocument(issue) : null), [issue])

  const relationshipCount = useMemo(
    () =>
      issue
        ? state.relationships.filter(
            (r) => r.sourceIssueId === issue.id || r.targetIssueId === issue.id,
          ).length
        : 0,
    [state.relationships, issue],
  )

  const initial = useMemo(
    (): Record<string, string> =>
      issue
        ? {
            subject: issue.subject,
            description: issue.description,
            status: issue.status,
            severity: issue.severity,
            owner: issue.owner,
            accountable: issue.accountable,
            nextAction: issue.nextAction,
            plannedStart: issue.plannedStart ?? '',
            plannedEnd: issue.plannedEnd ?? '',
            percent: issue.percentOverride != null ? String(issue.percentOverride) : '',
          }
        : {
            name: '',
            description: '',
            status: 'Open',
            severity: 'Medium',
            // Blank rather than a hardcoded 'Defect': the select resolves it to the first
            // configured type, so a workspace with a different registry gets its own default.
            type: '',
            owner: '',
            accountable: 'Unassigned',
            nextAction: '',
            plannedStart: '',
            plannedEnd: '',
            id: '',
          },
    [issue],
  )

  const [f, setF] = useState<Record<string, string>>(initial)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  // The configured vocabularies, not copies of them. Both used to be module constants here,
  // which meant adding a work type or an accountable party in configuration changed every
  // filter and column and left this form — where records are actually classified — behind.
  const workTypes = liveWorkTypes(state.model).map((t) => t.label)
  const parties = state.model.parties

  const [manualProgress, setManualProgress] = useState(initial.percent !== '')
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const dirty = useMemo(
    () =>
      Object.keys(initial).some((k) => (f[k] ?? '') !== (initial[k] ?? '')) ||
      manualProgress !== (initial.percent !== ''),
    [f, initial, manualProgress],
  )

  const firstField = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Trap Tab, inert the shell behind, and restore focus to the Edit button on close.
  useOverlay(rootRef)
  useEffect(() => {
    firstField.current?.focus()
  }, [])

  const attemptClose = () => {
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') attemptClose()
      // Ctrl/Cmd+Enter saves without reaching for the mouse.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const autoSource = activityCount
    ? `Rolled up from ${activityCount} lifecycle ${activityCount === 1 ? 'activity' : 'activities'}`
    : `Derived from status — “${f.status}” maps to ${STATUS_PROGRESS[f.status as IssueStatus]}%`

  const shownProgress = manualProgress
    ? Number(f.percent || 0)
    : activityCount
      ? rolledUp(state, issue?.id)
      : STATUS_PROGRESS[f.status as IssueStatus]

  const duration =
    f.plannedStart && f.plannedEnd && f.plannedEnd >= f.plannedStart
      ? daysBetween(f.plannedStart, f.plannedEnd)
      : null

  const submit = () => {
    onSubmit({ ...f, percent: manualProgress ? f.percent || '0' : '' })
  }

  const body = (
    <div
      className="focus"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      // Names the dialog from its own heading rather than a hardcoded string, so screen
      // readers announce which issue is being edited.
      aria-labelledby="focus-title"
    >
      {/* --- context bar: where the user came from, and what they are editing --- */}
      <div className="focus-bar">
        <button className="btn ghost back" onClick={attemptClose}>
          ← Issue Tree &amp; Resolution Schedule
        </button>
        <span className="grow" />
        {issue && <span className="idtag">{issue.id}</span>}
        {dirty && <span className="dirty-flag">Unsaved changes</span>}
      </div>

      <div className="focus-scroll">
        <div className="focus-inner">
          <header className="focus-head">
            {issue ? (
              <>
                {/* Identity first: which record, then which action, then its title. */}
                <div className="focus-eyebrow">
                  <span className="mono focus-eyebrow-id">{issue.id}</span>
                  <span className="dot-sep">·</span>
                  <span>{mode === 'edit' ? 'Edit Issue' : 'New Issue'}</span>
                </div>
                <h1 className="focus-title" id="focus-title">{f.subject || issue.subject}</h1>
                <div className="ident-badges">
                  <span className="badge">Issue</span>
                  <span className="badge">{issue.client}</span>
                  <span className="badge">{issue.module}</span>
                  <span className="badge">{issue.type}</span>
                  <span className={`badge sev-${f.severity}`}>
                    <span className="dot" style={{ background: 'currentColor' }} />
                    {f.severity}
                  </span>
                </div>

                {/* Compact system metadata in a fixed row; the narrative field below it,
                    because a sentence does not belong in a four-cell fact strip. */}
                <div className="focus-ctx">
                  <div>
                    <span className="ctx-label">Raised</span>
                    <span className="mono">{formatIso(issue.raised)}</span>
                  </div>
                  <div>
                    <span className="ctx-label">Last activity</span>
                    <span className="mono">{formatIso(issue.lastActivity)}</span>
                  </div>
                  <div>
                    <span className="ctx-label">Lifecycle</span>
                    <span>{activityCount ? `${activityCount} activities` : 'Not planned'}</span>
                  </div>
                  <div>
                    <span className="ctx-label">Relationships</span>
                    <span>{relationshipCount ? `${relationshipCount} linked` : 'None'}</span>
                  </div>
                </div>
                {issue.raisedBy && (
                  <p className="focus-ctx-note">
                    <span className="ctx-label">Raised context</span>
                    {issue.raisedBy}
                  </p>
                )}

                {/* Traceability to the artifact the issue was raised from. Detected from the
                    text, and labelled as such — the log has no attachment field and this app
                    does not hold the file, so it must not offer to open it. */}
                {sourceDoc && (
                  <div className="focus-source">
                    <span className="evi-icon">{KIND_ICON.data}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="ctx-label">Source artifact</div>
                      <div className="evi-source-name">{sourceDoc.fileName}</div>
                      <div className="evi-source-meta">
                        Detected in the issue {sourceDoc.detectedIn} · file not held by this app
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <h1 className="focus-title" id="focus-title">New issue</h1>
                <div className="ident-badges">
                  <span className="badge">Creating under {parentName}</span>
                </div>
              </>
            )}
          </header>

          <div className="focus-grid">
            {/* ① ISSUE — spans the grid: subject and description want the width. */}
            <section className="zone card span-all">
              <h3 className="zone-title">
                <span className="zone-num">1</span> Issue
              </h3>
              <label className="fld">
                <span className="fld-label">Subject *</span>
                <input
                  ref={firstField}
                  value={mode === 'edit' ? f.subject : f.name}
                  onChange={(e) => set(mode === 'edit' ? 'subject' : 'name', e.target.value)}
                  required
                />
              </label>
              {mode === 'add' && (
                <div className="fld-row">
                  <label className="fld">
                    <span className="fld-label">Issue ID</span>
                    <input value={f.id} placeholder="auto" onChange={(e) => set('id', e.target.value)} />
                    <span className="fld-hint">Leave blank to allocate the next free number.</span>
                  </label>
                  <label className="fld">
                    <span className="fld-label">Type</span>
                    <select value={f.type || workTypes[0] || ''} onChange={(e) => set('type', e.target.value)}>
                      {workTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <label className="fld">
                <span className="fld-label">Description</span>
                <AutoTextarea
                  value={f.description}
                  onChange={(v) => set('description', v)}
                  placeholder="What happened, what was expected, and any evidence."
                />
              </label>
            </section>

            {/* ② CURRENT STATE */}
            <section className="zone card">
              <h3 className="zone-title">
                <span className="zone-num">2</span> Current state
              </h3>
              <div className="fld-row">
                <label className="fld">
                  <span className="fld-label">Status</span>
                  <select
                    className={`status-select st-${isClosing(f.status) ? 'closing' : 'active'}`}
                    value={f.status}
                    onChange={(e) => set('status', e.target.value)}
                  >
                    <optgroup label="Active">
                      {ACTIVE_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Closing">
                      {CLOSING_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <label className="fld">
                  <span className="fld-label">Severity</span>
                  <select value={f.severity} onChange={(e) => set('severity', e.target.value)}>
                    {SEVERITIES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Progressive disclosure: automatic is the common case, so the manual
                  controls stay out of the way until they are actually wanted. */}
              {mode === 'edit' && (
                <div className="fld">
                  <div className="progress-head">
                    <span className="fld-label">Progress</span>
                    <span className="progress-val mono">{shownProgress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${shownProgress}%` }} />
                  </div>

                  {manualProgress ? (
                    <>
                      <div className="progress-slider">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Number(f.percent || 0)}
                          onChange={(e) => set('percent', e.target.value)}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={f.percent}
                          onChange={(e) => set('percent', e.target.value)}
                          className="progress-num"
                        />
                      </div>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setManualProgress(false)
                          set('percent', '')
                        }}
                      >
                        Use automatic progress instead
                      </button>
                    </>
                  ) : (
                    <div className="progress-auto">
                      <span className="fld-hint">{autoSource}</span>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setManualProgress(true)
                          set('percent', String(shownProgress))
                        }}
                      >
                        Override manually
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ③ RESPONSIBILITY */}
            <section className="zone card">
              <h3 className="zone-title">
                <span className="zone-num">3</span> Responsibility
              </h3>
              {/* Owner and Accountable are separate roles in this governance model and are
                  frequently the same value, so each says what it means. */}
              <label className="fld">
                <span className="fld-label">{labels.ISSUE_OWNER}</span>
                <input
                  value={f.owner}
                  list="focus-owners"
                  placeholder="Unassigned"
                  onChange={(e) => set('owner', e.target.value)}
                />
                <datalist id="focus-owners">
                  {ownerOptions.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
                <span className="fld-hint">Who is progressing the issue day to day.</span>
              </label>
              <label className="fld">
                <span className="fld-label">Accountable party</span>
                <select value={f.accountable} onChange={(e) => set('accountable', e.target.value)}>
                  {parties.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                <span className="fld-hint">
                  Which organisation is answerable for resolution.
                </span>
              </label>
            </section>

            {/* ④ NEXT STEP */}
            <section className="zone card">
              <h3 className="zone-title">
                <span className="zone-num">4</span> Next step
              </h3>
              <label className="fld">
                <span className="fld-label">Next action</span>
                <AutoTextarea
                  value={f.nextAction}
                  onChange={(v) => set('nextAction', v)}
                  placeholder="The single next thing that moves this issue forward, and who does it."
                />
              </label>
            </section>

            {/* ⑤ SCHEDULE */}
            <section className="zone card">
              <h3 className="zone-title">
                <span className="zone-num">5</span> Schedule
              </h3>
              <div className="fld-row">
                <label className="fld">
                  <span className="fld-label">Planned start</span>
                  <input
                    type="date"
                    value={f.plannedStart}
                    onChange={(e) => set('plannedStart', e.target.value)}
                  />
                </label>
                <label className="fld">
                  <span className="fld-label">Due date</span>
                  <input
                    type="date"
                    value={f.plannedEnd}
                    onChange={(e) => set('plannedEnd', e.target.value)}
                  />
                </label>
                <div className="fld" style={{ maxWidth: 100 }}>
                  <span className="fld-label">Duration</span>
                  <div className="derived-val mono">{duration != null ? `${duration}d` : '—'}</div>
                </div>
              </div>
              {issue && activityCount > 0 && (
                <p className="zone-note">
                  This issue has a lifecycle plan, so its dates normally roll up from its
                  activities. Setting dates here switches it to manual scheduling and the
                  roll-up will stop overwriting them.
                </p>
              )}
              {!f.plannedEnd && (
                <p className="zone-note">
                  The imported log carries no due dates. Leaving this blank keeps the issue
                  <b> Unscheduled</b> rather than giving it an invented deadline.
                </p>
              )}
            </section>

            {/* ⑥ EVIDENCE — a summary and a way in, not a document library. Managing files
                inside the form would make the form heavy again, which is the problem the
                full-page editor was built to solve. */}
            {mode === 'edit' && issue && (
              <section className="zone card span-all">
                <h3 className="zone-title">
                  <span className="zone-num">6</span> Evidence &amp; documents
                  <span className="grow" />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onManageEvidence(issue.id)}
                  >
                    Manage evidence →
                  </button>
                </h3>

                <div className="evi-strip">
                  {(['snapshot', 'data', 'document', 'link'] as EvidenceKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`evi-cat${evidenceTally[k] === 0 ? ' empty' : ''}`}
                      onClick={() => onManageEvidence(issue.id)}
                    >
                      <span className="evi-cat-top">
                        {KIND_ICON[k]} {KIND_LABEL[k]}
                      </span>
                      <span className="evi-cat-n">{evidenceTally[k]}</span>
                    </button>
                  ))}
                </div>

                {latestEvidence ? (
                  <div className="evi-latest">
                    <span className="ctx-label">Latest</span>
                    <span>
                      {KIND_ICON[latestEvidence.kind]} {latestEvidence.name}
                    </span>
                    {latestEvidence.purpose && (
                      <span className="evi-purpose">{latestEvidence.purpose}</span>
                    )}
                    <span className="mono" style={{ color: 'var(--text-faint)' }}>
                      {formatIso(latestEvidence.addedAt.slice(0, 10))}
                    </span>
                  </div>
                ) : (
                  <p className="zone-note">
                    Nothing attached yet. The imported log records evidence only as quoted text,
                    never as files — attach snapshots, data files or documents to build an
                    auditable record.
                  </p>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      <footer className="focus-foot">
        <div className="focus-foot-inner">
          <span className="foot-note">
            {dirty && <span className="dirty-dot" aria-hidden="true" />}
            {dirty
              ? 'Unsaved changes'
              : issue
                ? `Last activity ${formatIso(issue.lastActivity)} · every change is recorded in History`
                : 'The new issue is recorded in History on save'}
          </span>
          <div className="foot-actions">
            <button type="button" className="btn" onClick={attemptClose}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={submit}>
              {mode === 'edit' ? 'Save changes' : 'Create issue'}
            </button>
          </div>
        </div>
      </footer>

      {/* An in-page confirmation rather than a browser dialog, which would block the app. */}
      {confirmDiscard && (
        <div className="discard-bar">
          <span>You have unsaved changes. Leave without saving?</span>
          <button className="btn" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
          <button className="btn danger-solid" onClick={onClose}>
            Discard
          </button>
        </div>
      )}
    </div>
  )

  // Portaled to <body> so the overlay sits outside the inert app shell and stays
  // interactive while everything behind it is removed from the tab order.
  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}

/**
 * A textarea that fits its content.
 *
 * A fixed six-row box spends ~120px on a one-line description and pushes everything below it
 * off the fold. This starts small and grows with the text, capping before it can take over
 * the page.
 */
function AutoTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Collapse first, otherwise scrollHeight only ever ratchets upwards.
    el.style.height = 'auto'
    el.style.height = `${Math.min(AUTO_TA_MAX, Math.max(AUTO_TA_MIN, el.scrollHeight))}px`
  }, [])

  // Layout effect so the box is the right size on first paint, not after a visible jump.
  useLayoutEffect(fit, [value, fit])

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ minHeight: AUTO_TA_MIN, maxHeight: AUTO_TA_MAX, overflowY: 'auto', resize: 'none' }}
    />
  )
}

const AUTO_TA_MIN = 76
const AUTO_TA_MAX = 240

function isClosing(status: string): boolean {
  return (CLOSING_STATUSES as string[]).includes(status)
}

function rolledUp(state: WorkspaceState, issueId?: string): number {
  if (!issueId) return 0
  const acts = Object.values(state.activities).filter((a) => a.issueId === issueId && !a.deletedAt)
  if (!acts.length) return 0
  return Math.round(acts.reduce((s, a) => s + a.percentComplete, 0) / acts.length)
}
