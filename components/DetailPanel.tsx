'use client'

import { Fragment, useEffect, useState } from 'react'
import type {
  AuditEntry,
  IssueDependency,
  IssueRelationship,
  ScheduleRow,
  SlaPolicy,
} from '@/lib/types'
import type { CrpResult } from '@/lib/schedule'
import type { PanelState } from '@/lib/panel'
import { proposeTargetDate } from '@/lib/schedule'
import { formatIso } from '@/lib/dates'
import { useLabels } from './labels'
import OverviewTab from './OverviewTab'
import NotesTab from './NotesTab'
import EstimationTab from './EstimationTab'
import TimeTab from './TimeTab'
import type { TimeActivity } from '@/lib/time'
import type { ApprovalDecision } from '@/lib/approval'
import type { Estimate } from '@/lib/estimation'
import type { Actor } from '@/lib/actor'
import type { IssueNote, NoteType } from '@/lib/notes'
import type { IssueRecord } from '@/lib/workspace'
import ScopePanel from './ScopePanel'
import type { EngagementDetail } from '@/lib/engagement'
import { liveResponsibilities, resolveRequired } from '@/lib/config'
import { readAssignment, scopeChainOf, type WorkspaceState } from '@/lib/workspace'
import {
  KIND_ICON,
  KIND_LABEL,
  detectSourceDocument,
  formatBytes,
  type EvidenceItem,
  type EvidenceKind,
} from '@/lib/evidence'

/**
 * The bottom pane inspects and manages; the full-page focus editor edits. Naming the first tab
 * "Overview" rather than "Details" keeps that split unambiguous — otherwise "Details" here
 * and the "Edit Issue" form there look like two routes to the same thing.
 */
type Tab =
  | 'Overview'
  | 'Notes'
  | 'Estimation'
  | 'Time'
  | 'Schedule'
  | 'Lifecycle'
  | 'Relationships'
  | 'Resolution Path'
  | 'Evidence'
  | 'History'
  | 'Data Source'

interface Props {
  row: ScheduleRow | null
  allRows: ScheduleRow[]
  relationships: IssueRelationship[]
  dependencies: IssueDependency[]
  crp: CrpResult | null
  audit: AuditEntry[]
  height: number
  panelState: PanelState
  /** Report a dragged pixel height; the workspace stores it as a fraction. */
  onResize: (px: number) => void
  onSetPanel: (s: PanelState) => void
  onTabChange: (tab: string) => void
  onBuildLifecycle: (id: string) => void
  onClearLifecycle: (id: string) => void
  onAcceptProposal: (id: string) => void
  onUnlink: (relationshipId: string) => void
  onRemoveDependency: (dependencyId: string) => void
  evidence: EvidenceItem[]
  onManageEvidence: (issueId: string) => void
  hasLifecycle: (id: string) => boolean
  sla: SlaPolicy
  meta: {
    source: string
    issueCount: number
    provenance: {
      recordedDates: string[]
      absentFromSource: string[]
      derived: Record<string, string>
      notGenerated: string[]
    }
  }
  today: string
  /** Needed for the configured responsibility types and their current values. */
  state: WorkspaceState
  onSetAssignment: (issueId: string, responsibilityId: string, values: string[]) => void
  /** Who is acting — for attribution on notes and for the permission checks. */
  actor: Actor
  /** Commit an Overview edit. Returns false if the reducer refused it. */
  onSaveIssue: (
    id: string,
    patch: Partial<IssueRecord>,
    dates: { start: string; end: string } | null,
    /** Why, when the transition graph demands one. */
    reason?: string,
  ) => boolean
  onAddNote: (issueId: string, body: string, noteType: NoteType, pinned: boolean) => void
  onUpdateNote: (id: string, patch: Partial<Pick<IssueNote, 'body' | 'noteType' | 'pinned'>>) => void
  onDeleteNote: (id: string) => void
  /**
   * Raised while an Overview edit has uncommitted changes.
   *
   * The workspace owns the consequence rather than this panel: it is the thing that changes
   * the selection, so it is the only place that can stop a click on another row from
   * discarding work silently.
   */
  onDirtyChange: (dirty: boolean) => void
  onSaveEstimate: (issueId: string, patch: Partial<Estimate>, reason?: string) => boolean
  onAddTime: (
    issueId: string,
    entry: { person: string; date: string; hours: number; activity: TimeActivity; billable: boolean; note: string },
  ) => boolean
  onRemoveTime: (id: string) => void
  onRequestApproval: (subjectId: string, ruleId: string, note: string) => void
  onDecideApproval: (id: string, decision: ApprovalDecision, note: string) => void
  onBaselineEstimate: (issueId: string) => void
  onUpdateEngagement: (nodeId: string, patch: Partial<EngagementDetail>) => void
}

export default function DetailPanel({
  row,
  allRows,
  relationships,
  dependencies,
  crp,
  audit,
  height,
  panelState,
  onResize,
  onSetPanel,
  onTabChange,
  onBuildLifecycle,
  onClearLifecycle,
  onAcceptProposal,
  onUnlink,
  onRemoveDependency,
  evidence,
  onManageEvidence,
  hasLifecycle,
  sla,
  meta,
  today,
  state,
  onSetAssignment,
  onUpdateEngagement,
  actor,
  onSaveIssue,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onDirtyChange,
  onSaveEstimate,
  onAddTime,
  onRemoveTime,
  onRequestApproval,
  onDecideApproval,
  onBaselineEstimate,
}: Props) {
  const labels = useLabels()
  const [tab, setTab] = useState<Tab>('Overview')
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!resizing) return
    const move = (e: MouseEvent) => onResize(window.innerHeight - e.clientY)
    const up = () => setResizing(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [resizing, onResize])

  // The issue that owns the selection: an activity row reports under its parent issue.
  const issueRow =
    row?.kind === 'issue'
      ? row
      : row?.parentId
        ? (allRows.find((r) => r.id === row.parentId && r.kind === 'issue') ?? null)
        : null
  const issue = issueRow?.issue ?? null

  /**
   * Responsibility types that are NOT one of the three bound to a column.
   *
   * The built-in three already have their own rows above; listing them twice would imply two
   * places to change the same value. Anything configured after that has nowhere else to live,
   * so it is shown — and edited — here, which is what gives cardinality, requiredness and
   * eligibility something to actually govern.
   */
  /**
   * Whether Overview is in edit mode.
   *
   * Held by the panel rather than the tab so switching to Notes and back does not silently
   * drop a half-finished edit, and reset on the issue id so it never carries across records.
   */
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    setEditing(false)
  }, [issue?.id])

  const customResponsibilities = issue
    ? liveResponsibilities(state.model)
        .filter((t) => !t.systemField)
        .map((t) => ({
          id: t.id,
          label: t.label,
          maxCount: t.maxCount,
          requiredHere: resolveRequired(state.model, t.id, scopeChainOf(state, issue.id)),
          values: state.issues[issue.id] ? readAssignment(state.issues[issue.id], t) : [],
        }))
    : []

  const TABS: Tab[] = [
    'Overview',
    'Notes',
    'Estimation',
    'Time',
    'Schedule',
    'Lifecycle',
    'Relationships',
    'Resolution Path',
    'Evidence',
    'History',
    'Data Source',
  ]

  return (
    <div className="detail" style={{ height }}>
      <div
        className={`detail-grip${resizing ? ' dragging' : ''}`}
        onMouseDown={() => setResizing(true)}
        title="Drag to resize"
      >
        <span className="grip-marks" />
      </div>
      <div className="detail-head">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={tab === t ? 'active' : ''}
              onClick={() => {
                setTab(t)
                onTabChange(t)
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="grow" />
        {row && (
          <span className="idtag">
            {row.displayId || row.name} · {row.type}
          </span>
        )}
        {/* Explicit size controls, so the pane never has to be dragged to be usable. */}
        <div className="panel-controls">
          <button
            className="btn ghost"
            onClick={() => onSetPanel(panelState === 'compact' ? 'standard' : 'compact')}
            title={panelState === 'compact' ? 'Open the detail pane' : 'Collapse to tabs'}
            aria-label={panelState === 'compact' ? 'Open detail pane' : 'Collapse detail pane'}
          >
            {panelState === 'compact' ? '▲' : '▼'}
          </button>
          <button
            className="btn ghost"
            onClick={() => onSetPanel(panelState === 'expanded' ? 'standard' : 'expanded')}
            title={panelState === 'expanded' ? 'Restore normal height' : 'Expand the detail pane'}
            aria-label="Expand detail pane"
          >
            {panelState === 'expanded' ? '⤡' : '⤢'}
          </button>
        </div>
      </div>

      {panelState === 'compact' ? null : (
      <div className="detail-body">
        {!row ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
            Select a row to see its detail. {meta.issueCount} issues loaded from {meta.source}.
          </div>
        ) : tab === 'Data Source' ? (
          <DataSource meta={meta} />
        ) : tab === 'History' && !issue ? (
          // Engagement and client edits are audited like everything else, so History has to
          // work on these rows too — otherwise the tab is visible and inert, which reads as
          // broken rather than as not-applicable.
          <History audit={audit} />
        ) : !issue && (row.kind === 'engagement' || row.kind === 'client') ? (
          <ScopePanel
            row={row}
            state={state}
            onUpdateEngagement={onUpdateEngagement}
          />
        ) : !issue ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
            <b>{row.name}</b> is a {row.kind} summary row covering{' '}
            {allRows.filter((r) => r.parentId === row.id).length} child rows. Its dates and
            progress roll up from the rows beneath it. Select an issue for full detail.
          </div>
        ) : tab === 'Overview' ? (
          <OverviewTab
            row={issueRow!}
            issue={issue}
            state={state}
            actor={actor}
            customResponsibilities={customResponsibilities}
            onSetAssignment={(rid, values) => onSetAssignment(issue.id, rid, values)}
            onSave={(patch, dates, reason) => onSaveIssue(issue.id, patch, dates, reason)}
            onDirtyChange={onDirtyChange}
            onRequestApproval={(ruleId, note) => onRequestApproval(issue.id, ruleId, note)}
            onDecideApproval={onDecideApproval}
            editing={editing}
            setEditing={setEditing}
          />
        ) : tab === 'Estimation' ? (
          <EstimationTab
            issueId={issue.id}
            state={state}
            actor={actor}
            today={today}
            onSave={(patch, reason) => onSaveEstimate(issue.id, patch, reason)}
            onBaseline={() => onBaselineEstimate(issue.id)}
          />
        ) : tab === 'Time' ? (
          <TimeTab
            issueId={issue.id}
            state={state}
            actor={actor}
            today={today}
            onAdd={(entry) => onAddTime(issue.id, entry)}
            onRemove={onRemoveTime}
          />
        ) : tab === 'Notes' ? (
          <NotesTab
            issueId={issue.id}
            state={state}
            actor={actor}
            onAdd={(body, noteType, pinned) => onAddNote(issue.id, body, noteType, pinned)}
            onUpdate={onUpdateNote}
            onDelete={onDeleteNote}
          />
        ) : tab === 'Schedule' ? (
          <div className="cols-2">
            <dl className="kv">
              <dt>Schedule mode</dt>
              <dd>
                {issueRow!.scheduleMode === 'MANUAL' ? 'Manual' : 'Auto roll-up'}
                <span style={{ color: 'var(--text-faint)' }}>
                  {issueRow!.scheduleMode === 'MANUAL'
                    ? ' — roll-up will not overwrite these dates'
                    : ' — derived from child activities'}
                </span>
              </dd>
              <dt>Planned start</dt>
              <dd className="mono">{formatIso(issueRow!.plannedStartDate)}</dd>
              <dt>Planned end</dt>
              <dd className="mono">{formatIso(issueRow!.plannedEndDate)}</dd>
              <dt>Duration</dt>
              <dd className="mono">
                {issueRow!.duration != null
                  ? `${issueRow!.duration} calendar days (${issueRow!.workingDuration} working)`
                  : '—'}
              </dd>
              <dt>% complete</dt>
              <dd>
                {issueRow!.percentComplete}%{' '}
                <span style={{ color: 'var(--text-faint)' }}>
                  (
                  {issueRow!.progressOrigin === 'status-derived'
                    ? 'derived from status'
                    : issueRow!.progressOrigin === 'rolled-up'
                      ? 'rolled up from activities'
                      : 'user entered'}
                  )
                </span>
              </dd>
              <dt>Schedule health</dt>
              <dd className={`hl-${issueRow!.scheduleHealth.toLowerCase().replace(/\s/g, '')}`}>
                {issueRow!.scheduleHealth}
              </dd>
            </dl>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <dl className="kv">
                <dt>Actual start</dt>
                <dd className="mono">
                  {formatIso(issueRow!.actualStartDate)}
                  <span style={{ color: 'var(--text-faint)' }}> — date raised (recorded)</span>
                </dd>
                <dt>Actual end</dt>
                <dd className="mono">
                  {issueRow!.actualEndDate ? (
                    <>
                      {formatIso(issueRow!.actualEndDate)}
                      <span style={{ color: 'var(--text-faint)' }}> — last recorded activity</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>still open</span>
                  )}
                </dd>
              </dl>

              {!issueRow!.plannedEndDate && (
                <div className="panel-note warn">
                  <b>No due date exists for this issue.</b> The imported log records when the
                  issue was raised and when it last moved, but no commitment date. The SLA policy
                  suggests{' '}
                  <b className="mono">
                    {formatIso(proposeTargetDate(issue.raised, issue.severity, sla))}
                  </b>{' '}
                  ({sla[issue.severity]} working days for {issue.severity} severity).
                  <div style={{ marginTop: 7 }}>
                    <button className="btn primary" onClick={() => onAcceptProposal(issue.id)}>
                      Commit this target date
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : tab === 'Lifecycle' ? (
          <Lifecycle
            issueRow={issueRow!}
            allRows={allRows}
            hasLifecycle={hasLifecycle(issue.id)}
            onBuild={() => onBuildLifecycle(issue.id)}
            onClear={() => onClearLifecycle(issue.id)}
            sla={sla}
            severity={issue.severity}
          />
        ) : tab === 'Relationships' ? (
          <Relationships
            issueId={issue.id}
            relationships={relationships}
            dependencies={dependencies}
            allRows={allRows}
            onUnlink={onUnlink}
            onRemoveDependency={onRemoveDependency}
          />
        ) : tab === 'Evidence' ? (
          <Evidence
            issue={issue}
            items={evidence.filter((e) => e.issueId === issue.id && !e.deletedAt)}
            onManage={() => onManageEvidence(issue.id)}
          />
        ) : tab === 'Resolution Path' ? (
          <ResolutionPath
            crp={crp}
            allRows={allRows}
            issueRow={issueRow!}
            today={today}
            activityCount={allRows.filter((r) => r.parentId === issueRow!.id).length}
            dependencyCount={
              dependencies.filter((d) => d.predecessorId.startsWith(`${issue.id}#`)).length
            }
            hasLifecycle={hasLifecycle(issue.id)}
            onBuildLifecycle={() => onBuildLifecycle(issue.id)}
          />
        ) : (
          <History audit={audit} />
        )}
      </div>
      )}
    </div>
  )
}

function Lifecycle({
  issueRow,
  allRows,
  hasLifecycle,
  onBuild,
  onClear,
  sla,
  severity,
}: {
  issueRow: ScheduleRow
  allRows: ScheduleRow[]
  hasLifecycle: boolean
  onBuild: () => void
  onClear: () => void
  sla: SlaPolicy
  severity: 'High' | 'Medium' | 'Low'
}) {
  const acts = allRows.filter((r) => r.parentId === issueRow.id)

  if (!hasLifecycle) {
    return (
      <div style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="panel-note">
          The source issue log records a single lifecycle <i>status</i> per issue, not a breakdown
          of activities. Nothing here was imported, so no activity dates have been invented.
          <br />
          <br />
          Building a plan creates the five standard activities — Investigation, Root Cause
          Analysis, Corrective Action, Verification and Closure — linked finish-to-start, sized
          against the <b>{severity}</b> SLA window of <b>{sla[severity]} working days</b> from the
          raised date.
          <br />
          <br />
          Both the dates and the per-activity percentages are <b>generated</b>: the dates split
          that SLA window across the phases, and the percentages apportion this issue&rsquo;s
          status-derived figure. Neither was reported by anyone, so the rows stay marked as
          derived until you edit them — at which point they become yours, and the Critical
          Resolution Path becomes computable.
        </div>
        <div>
          <button className="btn primary" onClick={onBuild}>
            Build lifecycle plan
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {acts.length} activities · issue rolls up to {issueRow.percentComplete}%
        </span>
        <button className="btn" onClick={onClear}>
          Remove plan
        </button>
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, maxWidth: 860 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-faint)', fontSize: 10.5 }}>
            <th style={{ padding: '3px 10px 3px 0' }}>ACTIVITY</th>
            <th style={{ padding: '3px 10px' }}>START</th>
            <th style={{ padding: '3px 10px' }}>END</th>
            <th style={{ padding: '3px 10px' }}>DAYS</th>
            <th style={{ padding: '3px 10px' }}>PROGRESS</th>
            <th style={{ padding: '3px 10px' }}>HEALTH</th>
          </tr>
        </thead>
        <tbody>
          {acts.map((a) => (
            <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '4px 10px 4px 0' }}>
                {a.isMilestone && '◆ '}
                {a.name}
              </td>
              <td className="mono" style={{ padding: '4px 10px' }}>
                {formatIso(a.plannedStartDate)}
              </td>
              <td className="mono" style={{ padding: '4px 10px' }}>
                {formatIso(a.plannedEndDate)}
              </td>
              <td className="mono" style={{ padding: '4px 10px' }}>
                {a.duration ?? 0}
              </td>
              <td style={{ padding: '4px 10px' }}>{a.percentComplete}%</td>
              <td
                style={{ padding: '4px 10px' }}
                className={`hl-${a.scheduleHealth.toLowerCase().replace(/\s/g, '')}`}
              >
                {a.scheduleHealth}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Relationships({
  issueId,
  relationships,
  dependencies,
  allRows,
  onUnlink,
  onRemoveDependency,
}: {
  issueId: string
  relationships: IssueRelationship[]
  dependencies: IssueDependency[]
  allRows: ScheduleRow[]
  onUnlink: (id: string) => void
  onRemoveDependency: (id: string) => void
}) {
  const rels = relationships.filter(
    (r) => r.sourceIssueId === issueId || r.targetIssueId === issueId,
  )
  const deps = dependencies.filter(
    (d) => d.predecessorId.startsWith(issueId) || d.successorId.startsWith(issueId),
  )
  const nameOf = (id: string) => allRows.find((r) => r.id === id)?.name ?? id

  return (
    <div className="cols-2">
      <div>
        <div className="menu-title" style={{ padding: '0 0 5px' }}>
          Issue relationships — business links
        </div>
        {rels.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            No business relationships recorded for this issue.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {rels.map((r) => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ flex: 1 }}>
                  <span className="mono">{r.sourceIssueId}</span>{' '}
                  <span style={{ color: 'var(--accent)' }}>
                    {r.relationshipType.replace(/_/g, ' ').toLowerCase()}
                  </span>{' '}
                  <span className="mono">{r.targetIssueId}</span>
                  {r.note && (
                    <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{r.note}</div>
                  )}
                </span>
                <button className="btn ghost" onClick={() => onUnlink(r.id)} title="Remove this relationship">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="panel-note" style={{ marginTop: 9 }}>
          A relationship is a logical connection between issues. It carries no scheduling meaning
          and never moves a date.
        </div>
      </div>

      <div>
        <div className="menu-title" style={{ padding: '0 0 5px' }}>
          Schedule dependencies — timing constraints
        </div>
        {deps.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            No scheduling dependencies. They are created when a lifecycle plan is built.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {deps.map((d) => (
              <li key={d.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ flex: 1 }}>
                  {nameOf(d.predecessorId)}{' '}
                  <span className="mono" style={{ color: 'var(--accent)' }}>
                    ──{d.dependencyType}
                    {d.lagDays ? `+${d.lagDays}d` : ''}──▸
                  </span>{' '}
                  {nameOf(d.successorId)}
                </span>
                <button
                  className="btn ghost"
                  onClick={() => onRemoveDependency(d.id)}
                  title="Remove this scheduling dependency"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="panel-note" style={{ marginTop: 9 }}>
          A dependency constrains when work can happen. Moving a predecessor is validated against
          these before the change is saved.
        </div>
      </div>
    </div>
  )
}

function ResolutionPath({
  crp,
  allRows,
  issueRow,
  today,
  activityCount,
  dependencyCount,
  hasLifecycle,
  onBuildLifecycle,
}: {
  crp: CrpResult | null
  allRows: ScheduleRow[]
  issueRow: ScheduleRow
  today: string
  activityCount: number
  dependencyCount: number
  hasLifecycle: boolean
  onBuildLifecycle: () => void
}) {
  if (!crp || !crp.sufficient) {
    // An empty state that says what is missing and offers the action that fixes it, rather
    // than only reporting that nothing could be computed.
    const checks: [boolean, string][] = [
      [true, 'Issue exists'],
      [activityCount >= 2, `At least two scheduled activities (${activityCount} present)`],
      [dependencyCount >= 1, `Dependencies linking them (${dependencyCount} present)`],
      [
        // With no activities this would tick vacuously, implying the requirement is met.
        activityCount > 0 &&
          allRows.filter((r) => r.parentId === issueRow.id).every((a) => a.plannedStartDate),
        'Every activity has planned dates',
      ],
    ]
    return (
      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Resolution path not available</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {crp?.reason ??
            'This issue does not yet have enough scheduled activities and dependency links.'}{' '}
          A speculative chain would be worse than none, so this stays empty until the data
          exists.
        </div>
        <ul className="req-list">
          {checks.map(([ok, label]) => (
            <li key={label} className={ok ? 'ok' : 'missing'}>
              <span className="req-mark">{ok ? '✓' : '✕'}</span>
              {label}
            </li>
          ))}
        </ul>
        {!hasLifecycle && (
          <div>
            <button className="btn primary" onClick={onBuildLifecycle}>
              Build lifecycle plan
            </button>
          </div>
        )}
      </div>
    )
  }

  const nameOf = (id: string) => allRows.find((r) => r.id === id)?.name ?? id
  const blocking = crp.criticalBlockingDependency

  return (
    <div className="cols-2">
      <div>
        <div className="menu-title" style={{ padding: '0 0 6px' }}>
          Critical resolution path
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          {crp.chain.map((id, i) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ color: 'var(--accent)' }}>◆</span>
              <span>{nameOf(id)}</span>
              <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                {formatIso(crp.nodes[id]?.earliestStart ?? null)} →{' '}
                {formatIso(crp.nodes[id]?.earliestFinish ?? null)}
              </span>
              {i < crp.chain.length - 1 && <span style={{ color: 'var(--text-faint)' }}>↓</span>}
            </div>
          ))}
        </div>
      </div>
      <dl className="kv">
        <dt>Projected resolution</dt>
        <dd className="mono">
          {formatIso(crp.projectedResolutionDate)}
          {crp.projectedResolutionDate && crp.projectedResolutionDate < today && (
            <span className="hl-overdue"> — already passed</span>
          )}
        </dd>
        <dt>Planned end</dt>
        <dd className="mono">{formatIso(issueRow.plannedEndDate)}</dd>
        <dt>Schedule variance</dt>
        <dd className="mono">
          {crp.scheduleVarianceDays == null ? (
            '—'
          ) : crp.scheduleVarianceDays > 0 ? (
            <span className="hl-overdue">+{crp.scheduleVarianceDays}d late</span>
          ) : crp.scheduleVarianceDays < 0 ? (
            <span className="hl-ontrack">{crp.scheduleVarianceDays}d early</span>
          ) : (
            'on plan'
          )}
        </dd>
        <dt>Critical blocking dependency</dt>
        <dd>
          {blocking ? (
            <>
              {nameOf(blocking.predecessorId)} <span style={{ color: 'var(--accent)' }}>→</span>{' '}
              {nameOf(blocking.successorId)}
            </>
          ) : (
            '—'
          )}
        </dd>
      </dl>
    </div>
  )
}

function History({ audit }: { audit: AuditEntry[] }) {
  if (!audit.length) {
    return (
      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        No schedule changes recorded in this session. Dragging a bar, committing a target date or
        building a lifecycle plan is logged here.
      </div>
    )
  }
  return (
    <ul style={{ listStyle: 'none', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[...audit].reverse().map((a) => (
        <li key={a.id} style={{ borderLeft: '2px solid var(--border-strong)', paddingLeft: 9 }}>
          <span className="mono" style={{ color: 'var(--text-faint)', fontSize: 11 }}>
            {a.at.slice(0, 19).replace('T', ' ')}
          </span>{' '}
          — <b className="mono">{a.rowId}</b> {a.field}:{' '}
          <span style={{ color: 'var(--text-muted)' }}>{a.from ?? '(unset)'}</span> →{' '}
          <span>{a.to}</span>
          {a.reason && (
            <div style={{ color: 'var(--text-faint)', fontSize: 11 }}>{a.reason}</div>
          )}
        </li>
      ))}
    </ul>
  )
}

function DataSource({ meta }: { meta: Props['meta'] }) {
  const p = meta.provenance
  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12 }}>
      <div className="panel-note">
        <b>{meta.issueCount} issues</b> loaded from {meta.source}.
      </div>
      <dl className="kv">
        <dt>Recorded in source</dt>
        <dd>{p.recordedDates.join(', ')}</dd>
        <dt>Absent from source</dt>
        <dd className="hl-atrisk">{p.absentFromSource.join(', ')}</dd>
        <dt>Derived here</dt>
        <dd>
          {Object.entries(p.derived).map(([k, v]) => (
            <div key={k}>
              <b>{k}</b> — {v}
            </div>
          ))}
        </dd>
        <dt>Never generated</dt>
        <dd>{p.notGenerated.join(', ')}</dd>
      </dl>
      <div className="panel-note warn">
        The log carries no due dates, so most issues show as <b>Unscheduled</b> rather than being
        given an invented deadline. Bars drawn solid are real elapsed time — raised date through
        last recorded activity. Dashed bars are SLA suggestions and are not commitments until
        accepted.
      </div>
    </div>
  )
}

/**
 * Evidence tab — what supports the issue.
 *
 * Deliberately distinct from History (what happened to the issue) and Data Source (where the
 * record was imported from). All three answer different questions and are easy to conflate.
 */
function Evidence({
  issue,
  items,
  onManage,
}: {
  issue: NonNullable<ScheduleRow['issue']>
  items: EvidenceItem[]
  onManage: () => void
}) {
  const source = detectSourceDocument(issue)
  const groups: EvidenceKind[] = ['snapshot', 'data', 'document', 'link']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {items.length} item{items.length === 1 ? '' : 's'} attached
        </span>
        <button className="btn primary" onClick={onManage}>
          Manage evidence
        </button>
      </div>

      <dl className="kv">
        <dt>Source artifact</dt>
        <dd>
          {source ? (
            <>
              {KIND_ICON.data} {source.fileName}
              <span style={{ color: 'var(--text-faint)' }}>
                {' '}
                — detected in the issue {source.detectedIn}, file not held by this app
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--text-faint)' }}>
              No originating file named in this row ({issue.source})
            </span>
          )}
        </dd>
        {issue.evidence && (
          <>
            <dt>Recorded in the log</dt>
            <dd style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              “{issue.evidence}”
              {issue.evidenceDate && (
                <span className="mono" style={{ color: 'var(--text-faint)' }}>
                  {' '}
                  · {formatIso(issue.evidenceDate)}
                </span>
              )}
              <div style={{ color: 'var(--text-faint)', fontSize: 10.5, marginTop: 2 }}>
                A quoted snippet from the source log — text, not an attachment.
              </div>
            </dd>
          </>
        )}
      </dl>

      {items.length === 0 ? (
        <div className="panel-note">
          Nothing attached. The imported log has no attachment field, so every file here has to
          be added deliberately — which is what makes it evidence.
        </div>
      ) : (
        <div className="cols-2">
          {groups
            .filter((k) => items.some((i) => i.kind === k))
            .map((k) => (
              <div key={k}>
                <div className="menu-title" style={{ padding: '0 0 4px' }}>
                  {KIND_ICON[k]} {KIND_LABEL[k]}
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {items
                    .filter((i) => i.kind === k)
                    .map((i) => (
                      <li key={i.id} style={{ fontSize: 12 }}>
                        {i.url ? (
                          <a href={i.url} target="_blank" rel="noreferrer">
                            {i.name}
                          </a>
                        ) : (
                          i.name
                        )}
                        {i.purpose && <span className="evi-purpose"> {i.purpose}</span>}
                        {i.sizeBytes != null && (
                          <span style={{ color: 'var(--text-faint)' }}> · {formatBytes(i.sizeBytes)}</span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
