'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  AuditEntry,
  IssueDependency,
  IssueRelationship,
  ScheduleRow,
  SlaPolicy,
} from '@/lib/types'
import type { CrpResult } from '@/lib/schedule'
import { allowedNext } from '@/lib/statusPolicy'
import { dropOutcome } from '@/lib/board'
import { can } from '@/lib/access'
import { isOutboundRefusal, sendingMailboxFor } from '@/lib/outbound'
import type { IssueStatus } from '@/lib/types'
import type { PanelState } from '@/lib/panel'
import { proposeTargetDate } from '@/lib/schedule'
import { formatIso } from '@/lib/dates'
import { useLabels } from './labels'
import OverviewTab from './OverviewTab'
import NotesTab from './NotesTab'
import DiscussionTab, { type SuggestWiring } from './DiscussionTab'
import EstimationTab from './EstimationTab'
import TimeTab from './TimeTab'
import type { CommitmentKind } from '@/lib/capacity'
import CommercialPanel from './CommercialPanel'
import CapacityPanel from './CapacityPanel'
import ProjectMembersPanel from './ProjectMembersPanel'
import type { Sow } from '@/lib/sow'
import type { TimeActivity } from '@/lib/time'
import type { ApprovalDecision } from '@/lib/approval'
import type { Estimate } from '@/lib/estimation'
import type { Actor } from '@/lib/actor'
import type { Milestone } from '@/lib/milestone'
import type { ScopeItem } from '@/lib/scope'
import type { IssueNote, NoteType } from '@/lib/notes'
import type { RichDoc } from '@/lib/richText'
import type { IssueRecord } from '@/lib/workspace'
import ScopePanel from './ScopePanel'
import type { EngagementDetail } from '@/lib/engagement'
import { holidaySetOf, isExternalPartyKind, liveResponsibilities, resolveRequired, tiersOf } from '@/lib/config'
import { describeForecast, forecastFor } from '@/lib/forecast'
import { profileAt } from '@/lib/capacity'
import { directoryIdByName } from '@/lib/access'
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
/**
 * The tab bar's own values — what `TABS` (below) actually ever assembles from, for any row
 * kind. `Lifecycle`, `Resolution Path`, `Relationships`, `Evidence` and `Data Source` are NOT
 * separate tabs and were removed from this union 2026-08-31: the consolidation itself ("seven,
 * down from twelve", see `TABS`) already happened — Lifecycle and Resolution Path render as
 * sections inside `Schedule`, Relationships and Evidence as sections inside `Links`, and Data
 * Source moved to the empty-selection state (`<DataSource>` below `!row`). This union had kept
 * all five as dead type members with zero references anywhere in the codebase, which is worse
 * than harmless — it makes the tab bar look uncondensed to anyone reading the type alone.
 */
export type Tab =
  | 'Overview'
  | 'Capacity'
  | 'Members'
  | 'Discussion'
  | 'Notes'
  | 'Estimation'
  | 'Time'
  | 'Schedule'
  | 'Links'
  | 'History'

interface Props {
  /** E5: present only when the assistant may propose — threads to the Discussion tab. */
  assistSuggest?: SuggestWiring
  row: ScheduleRow | null
  allRows: ScheduleRow[]
  relationships: IssueRelationship[]
  dependencies: IssueDependency[]
  crp: CrpResult | null
  audit: AuditEntry[]
  height: number
  panelState: PanelState
  /** True on views (Timesheets, Notifications, Mail log) that force `panelState` to 'compact'
   *  regardless of preference — the size controls below have nothing to change, so they render
   *  disabled rather than as live buttons that silently do nothing. */
  panelLocked?: boolean
  /** Report a dragged pixel height; the workspace stores it as a fraction. */
  onResize: (px: number) => void
  onSetPanel: (s: PanelState) => void
  onTabChange: (tab: string) => void
  /**
   * A tab the workspace is asking for — the row menu's Log time lands on Time.
   *
   * A request rather than a controlled value: the tab belongs to this panel, and taking it
   * over would mean every click on a tab had to travel up and come back. Cleared through
   * `onTabRequestHandled` so asking for the same tab twice still moves the panel.
   */
  requestTab?: Tab | null
  onTabRequestHandled?: () => void
  /**
   * An issue id the workspace is asking to be edited — Row-menu/toolbar "Edit" opening this
   * panel already in edit mode rather than merely open. `editing` below is this panel's own
   * local state, not otherwise reachable from outside; this is how a click elsewhere still
   * reaches it. Same shape as `requestTab` above, cleared the same way.
   */
  requestEdit?: string | null
  onEditRequestHandled?: () => void
  onBuildLifecycle: (id: string) => void
  onClearLifecycle: (id: string) => void
  onAcceptProposal: (id: string) => void
  onUnlink: (relationshipId: string) => void
  onRemoveDependency: (dependencyId: string) => void
  evidence: EvidenceItem[]
  onManageEvidence: (issueId: string) => void
  /** An image pasted, dropped or inserted through a description's or note's rich editor. */
  onUploadImage: (issueId: string, file: File) => Promise<{ documentId: string; alt: string } | null>
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
  onAddNote: (
    issueId: string,
    body: RichDoc,
    noteType: NoteType,
    pinned: boolean,
    clientVisible: boolean,
  ) => void
  onUpdateNote: (
    id: string,
    patch: Partial<Pick<IssueNote, 'body' | 'noteType' | 'pinned' | 'clientVisible'>>,
  ) => void
  onDeleteNote: (id: string) => void
  /** A reply the mail endpoint sent and recorded — merged into the browser's copy upstream. */
  onMailSent: (note: IssueNote) => void
  /** False when no database backs the workspace, where a send could never be recorded. */
  mailEnabled: boolean
  /**
   * Raised while an Overview edit has uncommitted changes.
   *
   * The workspace owns the consequence rather than this panel: it is the thing that changes
   * the selection, so it is the only place that can stop a click on another row from
   * discarding work silently.
   */
  onDirtyChange: (dirty: boolean) => void
  /** The same cell-commit funnel the grid and board use — status carries a reason. */
  onCommitCell: (rowId: string, colKey: string, raw: string, reason?: string) => boolean
  onSaveEstimate: (issueId: string, patch: Partial<Estimate>, reason?: string) => boolean
  onAddTime: (
    issueId: string,
    entry: { person: string; date: string; hours: number; activity: TimeActivity; billable: boolean; note: string; activityId?: string; justification?: string },
  ) => boolean
  onRemoveTime: (id: string) => void
  onSubmitWeek: (person: string, week: string) => boolean
  onDecideWeek: (id: string, decision: 'approved' | 'rejected', reason?: string) => boolean
  onRequestApproval: (subjectId: string, ruleId: string, note: string) => void
  onDecideApproval: (id: string, decision: ApprovalDecision, note: string) => void
  onBaselineEstimate: (issueId: string) => void
  onUpdateEngagement: (nodeId: string, patch: Partial<EngagementDetail>) => void
  onUpsertSow: (id: string | null, engagementId: string, patch: Partial<Sow>) => void
  onAttributeToSow: (nodeId: string, sowId: string | null) => void
  onArchiveSow: (id: string) => void
  onRaiseChange: (sowId: string, c: { title: string; effortHours: number; value: number; reason: string; scope: string; effectiveFrom: string | null }, submit: boolean) => boolean
  onDecideChange: (id: string, decision: 'approved' | 'rejected', note?: string) => boolean
  onWithdrawChange: (id: string) => void
  onUpsertMilestone: (sowId: string, id: string | null, patch: Partial<Milestone>) => boolean
  onRemoveMilestone: (id: string) => void
  onDeliverMilestone: (id: string) => boolean
  onDecideMilestone: (id: string, decision: 'Accepted' | 'Rejected', note?: string) => boolean
  onUpsertScope: (sowId: string, id: string | null, patch: Partial<ScopeItem>) => boolean
  onRemoveScope: (id: string) => void
  onDecideScope: (id: string, approved: boolean) => boolean
  onAllocate: (
    projectId: string,
    a: { person: string; startDate: string; endDate: string; percentage: number; note: string; acceptOverallocation?: boolean },
  ) => boolean
  onRelease: (id: string) => void
  onRecordPattern: (personId: string, from: string, hoursPerDay: number, daysPerWeek: number, reason: string) => boolean
  onCorrectPattern: (versionId: string, validFrom: string, reason: string) => boolean
  onCommit: (c: { person: string; kind: CommitmentKind; startDate: string; endDate: string; hoursPerDay: number; note: string }) => boolean
  onReleaseCommitment: (id: string) => void
  onDecideLeave: (id: string, decision: 'approved' | 'returned') => void
  onAddMember: (projectId: string, person: string, projectRoleId: string) => boolean
  onUpdateMemberRole: (id: string, projectRoleId: string) => void
  onRemoveMember: (id: string) => void
  /** Correct an existing time entry. The reducer arm existed with no way to reach it. */
  onUpdateTime: (
    id: string,
    patch: { hours?: number; note?: string; billable?: boolean; justification?: string },
  ) => boolean
}

export default function DetailPanel({
  assistSuggest,
  row,
  allRows,
  relationships,
  dependencies,
  crp,
  audit,
  height,
  panelState,
  panelLocked = false,
  onResize,
  onSetPanel,
  onTabChange,
  requestTab,
  onTabRequestHandled,
  requestEdit,
  onEditRequestHandled,
  onBuildLifecycle,
  onClearLifecycle,
  onAcceptProposal,
  onUnlink,
  onRemoveDependency,
  evidence,
  onManageEvidence,
  onUploadImage,
  hasLifecycle,
  sla,
  meta,
  today,
  state,
  onSetAssignment,
  onUpdateEngagement,
  onUpsertSow,
  onAttributeToSow,
  onArchiveSow,
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
  onAllocate,
  onRelease,
  onAddMember,
  onUpdateMemberRole,
  onRemoveMember,
  onRecordPattern,
  onCorrectPattern,
  onCommit,
  onReleaseCommitment,
  onDecideLeave,
  onUpdateTime,
  actor,
  onSaveIssue,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onMailSent,
  mailEnabled,
  onDirtyChange,
  onCommitCell,
  onSaveEstimate,
  onAddTime,
  onRemoveTime,
  onSubmitWeek,
  onDecideWeek,
  onRequestApproval,
  onDecideApproval,
  onBaselineEstimate,
}: Props) {
  const labels = useLabels()
  const [tab, setTab] = useState<Tab>('Overview')
  const [resizing, setResizing] = useState(false)

  // The issue that owns the selection: an activity row reports under its parent issue.
  /*
   * What this workspace holds now, as against what was imported into it. The two diverge the
   * moment anybody creates an issue, and the empty-detail line below reports them separately.
   */
  const liveIssues = Object.values(state.issues).filter((i) => !i.deletedAt).length

  const issueRow =
    row?.kind === 'issue'
      ? row
      : row?.parentId
        ? (allRows.find((r) => r.id === row.parentId && r.kind === 'issue') ?? null)
        : null
  const issue = issueRow?.issue ?? null

  /**
   * The tabs this row actually has, rather than a fixed list.
   *
   * It was fixed, and it was misleading in a way that made a whole panel unfindable. A project
   * row shows the capacity panel for EVERY tab except two, so the bar offered Notes, Estimation
   * and Time on a project and showed capacity whichever you picked — and somebody looking for
   * capacity had no reason to think clicking the row was the way to it. There is no affordance
   * for "this tab does nothing here"; the honest fix is not to offer it.
   *
   * Issues keep the full set. Structural rows get what they have: Capacity for a project,
   * History everywhere (they are audited like everything else). Data Source is not one of
   * these tabs at all — see the next comment.
   */
  /*
   * Seven, down from twelve. The scheduling story was split across four tabs that
   * cross-referenced each other's empty states; it is one tab with sections now. Links holds
   * what connects this record to others (relationships, evidence). Data Source rendered the
   * same app-level import provenance for every record, so it lives with the empty-selection
   * state instead of costing every record a tab.
   */
  const TABS: Tab[] = issue
    ? ['Overview', 'Notes', 'Discussion', 'Estimation', 'Time', 'Schedule', 'Links', 'History']
    : row?.kind === 'project'
      ? ['Capacity', 'Members', 'Discussion', 'History']
      : ['Overview', 'History']

  /**
   * Land on a tab this row actually has.
   *
   * Selecting a project while sitting on Notes used to leave `tab` on a value the new row does
   * not offer. The body fell through to the capacity panel anyway, so nothing looked broken —
   * and the active tab was one the bar no longer contained, which is how a control ends up
   * highlighted and unreachable.
   *
   * It reads `TABS` above rather than building its own list. It used to build one from
   * `row.issue` — the row's OWN field, which an activity row never has (see `lib/tree.ts`) —
   * while the bar was built from the RESOLVED issue, which walks an activity up to its parent.
   * So an activity showed eleven tabs and bounced off eight of them: click Time, and this
   * effect put you straight back on Overview.
   *
   * Eleven was the right answer. Every tab body already renders against `issue.id`, so they
   * all work for an activity — the parent's time, the parent's evidence. Only this list
   * disagreed. Deriving both from one constant is the fix; correcting either copy on its own
   * would have left the pair free to drift apart again.
   */
  useEffect(() => {
    if (!row) return
    // Both directions. Moving from a project back to an issue while on Capacity would otherwise
    // leave the body with no branch to take, which renders as an empty panel.
    if (!TABS.includes(tab)) setTab(TABS[0])
    // Keyed on the list's CONTENT, not its identity: `TABS` is a fresh array every render, so
    // depending on it directly would re-run this on every keystroke elsewhere in the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TABS.join('|'), tab, row])

  /**
   * Honour a tab the workspace asked for.
   *
   * `onTabChange` is called as well as `setTab`, and that is the load-bearing half: it is what
   * opens a collapsed pane. Without it, Log time on a workspace with the details hidden would
   * switch to a tab nobody can see and look like it had done nothing at all.
   */
  useEffect(() => {
    if (!requestTab) return
    setTab(requestTab)
    onTabChange(requestTab)
    onTabRequestHandled?.()
  }, [requestTab, onTabChange, onTabRequestHandled])

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

  /**
   * Escape collapses the pane, the same place the header's own ▲ button leaves it.
   *
   * Deliberately NOT `useOverlay` — that hook makes the app shell `inert` and traps Tab, which
   * is exactly right for a modal and exactly wrong here: a docked detail pane leaves the rest
   * of the workspace reachable on purpose. This is only the one key, with no side effects
   * beyond the same state change the button already makes. A no-op once already collapsed,
   * so it is safe to leave listening rather than conditioning it on `panelState`.
   *
   * Skipped while focus sits in a text field. Several inline prompts in this panel (the
   * status-change reason input, for one) already give Escape a narrower, local meaning —
   * cancel just that prompt — via their own `onKeyDown`. Collapsing the whole pane underneath
   * an input the person is mid-edit in would be a second, unrelated thing happening on the
   * same keypress; deferring to focus lets each Escape mean one thing at a time.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || panelState === 'compact') return
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      onSetPanel('compact')
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panelState, onSetPanel])


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

  // Declared after the reset above: both depend on issue?.id, and within one commit effects
  // run in declaration order, so a fresh request's setEditing(true) is what sticks rather than
  // being immediately undone by the reset. Also lands on Overview, the same way requestTab
  // would, since edit mode only exists there.
  useEffect(() => {
    if (requestEdit && issue?.id === requestEdit) {
      setEditing(true)
      setTab('Overview')
      onEditRequestHandled?.()
    }
  }, [requestEdit, issue?.id, onEditRequestHandled])

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


  return (
    <div className="detail" style={{ height }}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- resize is a pointer comfort affordance; the panel's content stays keyboard-reachable at any height */}
      <div
        className={`detail-grip${resizing ? ' dragging' : ''}${panelLocked ? ' locked' : ''}`}
        onMouseDown={() => !panelLocked && setResizing(true)}
        title={panelLocked ? 'The detail pane is not shown on this tab' : 'Drag to resize'}
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
            disabled={panelLocked}
            title={
              panelLocked
                ? 'The detail pane is not shown on this tab'
                : panelState === 'compact'
                  ? 'Open the detail pane'
                  : 'Collapse to tabs'
            }
            aria-label={panelState === 'compact' ? 'Open detail pane' : 'Collapse detail pane'}
          >
            {panelState === 'compact' ? '▲' : '▼'}
          </button>
          <button
            className="btn ghost"
            onClick={() => onSetPanel(panelState === 'expanded' ? 'standard' : 'expanded')}
            disabled={panelLocked}
            title={
              panelLocked
                ? 'The detail pane is not shown on this tab'
                : panelState === 'expanded'
                  ? 'Restore normal height'
                  : 'Expand the detail pane'
            }
            aria-label="Expand detail pane"
          >
            {panelState === 'expanded' ? '⤡' : '⤢'}
          </button>
        </div>
      </div>

      {/* The record's vital signs, pinned above every tab. They lived only inside Overview's
          edit mode, four clicks from the Time tab — and the fields a delivery manager touches
          most must never be more than one click away, whichever tab is open. */}
      {issue && issueRow && panelState !== 'compact' && (
        <FieldStrip row={issueRow} issue={issue} state={state} onCommitCell={onCommitCell} />
      )}

      {/*
        * Compact used to render nothing at all — the tab bar with an empty space under it, which
        * reads as a broken panel rather than as a collapsed one. It is reached automatically on
        * a viewport under 700px tall, so somebody on a laptop could select a row, see the tabs,
        * and conclude the feature was missing. One line, naming the control that opens it.
        */}
      {panelState === 'compact' ? (
        row ? (
          <div className="detail-body">
            <div className="panel-note">
              The detail pane is collapsed. Use ▲ above, or drag the handle, to see{' '}
              {/* `issue`, not `row.issue` — the same resolution the pane itself uses, so an
                  activity row says "this issue" rather than "this row" about a pane that is
                  about to show its parent issue. */}
              {issue ? 'this issue' : row.kind === 'project' ? 'capacity for this project' : 'this row'}.
            </div>
          </div>
        ) : null
      ) : (
      <div className="detail-body">
        {!row ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
            {/*
              * Two figures that are both true and are not the same, so they are labelled rather
              * than run together. This read "{meta.issueCount} issues loaded from {meta.source}"
              * — which rendered as "216 issues loaded from … (v2), 179 issues", three numbers in
              * one sentence, none of them the workspace's actual total.
              */}
            Select a row to see its detail. {liveIssues} issues here
            {liveIssues === meta.issueCount ? '' : `, ${meta.issueCount} of them imported`} from{' '}
            {meta.source}.
            <div style={{ marginTop: 14 }}>
              <DataSource meta={meta} />
            </div>
          </div>
        ) : tab === 'History' && !issue ? (
          // Engagement and client edits are audited like everything else, so History has to
          // work on these rows too — otherwise the tab is visible and inert, which reads as
          // broken rather than as not-applicable.
          <History audit={audit} />
        ) : !issue && (row.kind === 'engagement' || isExternalPartyKind(tiersOf(state.model), row.kind)) ? (
          <>
            <ScopePanel row={row} state={state} onUpdateEngagement={onUpdateEngagement} />
            {/* Commercial detail belongs on the engagement, under the scope it is about,
                rather than on a tab an issue would also show and never use. */}
            {row.kind === 'engagement' && (
              <CommercialPanel
                row={row}
                state={state}
                actor={actor}
                today={today}
                allRows={allRows}
                onUpsert={onUpsertSow}
                onAttribute={onAttributeToSow}
                onArchive={onArchiveSow}
                onRaiseChange={onRaiseChange}
                onDecideChange={onDecideChange}
                onWithdrawChange={onWithdrawChange}
                onUpsertMilestone={onUpsertMilestone}
                onRemoveMilestone={onRemoveMilestone}
                onDeliverMilestone={onDeliverMilestone}
                onDecideMilestone={onDecideMilestone}
                onUpsertScope={onUpsertScope}
                onRemoveScope={onRemoveScope}
                onDecideScope={onDecideScope}
              />
            )}
          </>
        ) : !issue && row.kind === 'project' && tab === 'Members' ? (
          <ProjectMembersPanel
            row={row}
            state={state}
            actor={actor}
            onAdd={(person, projectRoleId) => onAddMember(row.id, person, projectRoleId)}
            onUpdateRole={onUpdateMemberRole}
            onRemove={onRemoveMember}
          />
        ) : !issue && row.kind === 'project' && tab === 'Discussion' ? (
          <DiscussionTab
            state={state}
            actor={actor}
            scopeKind="project"
            scopeId={row.id}
            scopeName={row.name}
            suggest={assistSuggest}
          />
        ) : !issue && row.kind === 'project' && tab !== 'Overview' ? (
          <CapacityPanel
            row={row}
            state={state}
            actor={actor}
            allRows={allRows}
            today={today}
            onAllocate={(a) => onAllocate(row.id, a)}
            onRelease={onRelease}
            onRecordPattern={onRecordPattern}
            onCorrectPattern={onCorrectPattern}
            onCommit={onCommit}
            onDecideLeave={onDecideLeave}
            onReleaseCommitment={onReleaseCommitment}
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
            onMailSent={onMailSent}
            mailEnabled={mailEnabled}
            onRequestApproval={(ruleId, note) => onRequestApproval(issue.id, ruleId, note)}
            onDecideApproval={onDecideApproval}
            editing={editing}
            setEditing={setEditing}
            onUploadImage={(file) => onUploadImage(issue.id, file)}
            onManageEvidence={onManageEvidence}
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
            onSubmitWeek={onSubmitWeek}
            onDecideWeek={onDecideWeek}
            onUpdate={onUpdateTime}
          />
        ) : tab === 'Discussion' ? (
          <DiscussionTab
            state={state}
            actor={actor}
            scopeKind="issue"
            scopeId={issue.id}
            ownerName={issue.owner}
            scopeName={issue.subject}
            suggest={assistSuggest}
          />
        ) : tab === 'Notes' ? (
          <NotesTab
            issueId={issue.id}
            state={state}
            actor={actor}
            onAdd={(body, noteType, pinned, clientVisible) =>
              onAddNote(issue.id, body, noteType, pinned, clientVisible)
            }
            onUpdate={onUpdateNote}
            onDelete={onDeleteNote}
            onUploadImage={(file) => onUploadImage(issue.id, file)}
            onWriteReply={
              mailEnabled &&
              can(state.model, actor, 'mail.send').allowed &&
              !isOutboundRefusal(sendingMailboxFor(state, issue.id))
                ? () => {
                    setTab('Overview')
                    onTabChange('Overview')
                  }
                : undefined
            }
          />
        ) : tab === 'Schedule' ? (
          <>
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
              {/* The future, beside the health that reads the past — deliberately separate
                  vocabularies (the E1 design). One sentence, from the one place sentences
                  come from, so Portfolio can never disagree with this tab. */}
              <dt>Forecast</dt>
              <dd>
                {describeForecast(
                  forecastFor({
                    issueId: issue.id,
                    owner: issue.owner,
                    ownerId: directoryIdByName(state.model, issue.owner),
                    plannedEnd: issueRow!.plannedEndDate,
                    estimate: state.estimates[issue.id],
                    bands: state.model.sizeBands,
                    timeEntries: state.timeEntries,
                    profile: profileAt(
                      Object.values(state.versions),
                      state.model.resourceProfiles,
                      directoryIdByName(state.model, issue.owner) ?? '',
                      today,
                    ),
                    commitments: Object.values(state.commitments),
                    allocations: Object.values(state.allocations),
                    today,
                    holidays: holidaySetOf(state.model),
                    // E4: the owner's meetings now price into the same sentence.
                    meetings: Object.values(state.meetings),
                  }),
                  issue.owner,
                )}
              </dd>
              {/* E4: meetings booked about this record, read-only — booking lives on My
                  calendar. Rendered only when any exist, so the list is never dead space. */}
              {Object.values(state.meetings).some((m) => !m.deletedAt && m.scopeId === issue.id) && (
                <>
                  <dt>Meetings</dt>
                  <dd>
                    {Object.values(state.meetings)
                      .filter((m) => !m.deletedAt && m.scopeId === issue.id)
                      .sort((x, y) => x.startAt.localeCompare(y.startAt))
                      .map((m) => (
                        <div key={m.id}>
                          {formatIso(m.startAt.slice(0, 10))} {m.startAt.slice(11, 16)}–{m.endAt.slice(11, 16)} · {m.title} ·{' '}
                          {m.attendeeIds.map((pid) => state.model.people[pid]?.name ?? pid).join(', ')}
                        </div>
                      ))}
                  </dd>
                </>
              )}
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
          <section className="tab-sect">
            <h4 className="est-h">Lifecycle</h4>
            <Lifecycle
              issueRow={issueRow!}
              allRows={allRows}
              hasLifecycle={hasLifecycle(issue.id)}
              onBuild={() => onBuildLifecycle(issue.id)}
              onClear={() => onClearLifecycle(issue.id)}
              sla={sla}
              severity={issue.severity}
            />
          </section>
          <section className="tab-sect">
            <h4 className="est-h">Resolution path</h4>
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
          </section>
          </>
        ) : tab === 'Links' ? (
          <>
          <section className="tab-sect">
            <h4 className="est-h">Relationships</h4>
            <Relationships
              issueId={issue.id}
              relationships={relationships}
              dependencies={dependencies}
              allRows={allRows}
              onUnlink={onUnlink}
              onRemoveDependency={onRemoveDependency}
            />
          </section>
          <section className="tab-sect">
            <h4 className="est-h">Evidence</h4>
            <Evidence
              issue={issue}
              items={evidence.filter((e) => e.issueId === issue.id && !e.deletedAt)}
              onManage={() => onManageEvidence(issue.id)}
            />
          </section>
          </>
        ) : (
          <History audit={audit} forId={issue.id} />
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

/**
 * Status, owner, due and severity — editable in place from every tab, through the same
 * commit funnel as the grid and the board. A status change collects its reason here, in a
 * line that appears when a new status is chosen: the funnel refuses reasonless moves, and a
 * control that silently failed that rule would read as broken rather than as governed.
 */
function FieldStrip({
  row,
  issue,
  state,
  onCommitCell,
}: {
  row: ScheduleRow
  issue: NonNullable<ScheduleRow['issue']>
  state: WorkspaceState
  onCommitCell: (rowId: string, colKey: string, raw: string, reason?: string) => boolean
}) {
  const labels = useLabels()
  const policy = state.model.statusPolicy
  const routes = allowedNext(policy, issue.status)
  const hasEvidence = useMemo(
    () => Object.values(state.evidence).some((e) => e.issueId === issue.id && !e.deletedAt),
    [state.evidence, issue.id],
  )
  const [pendingStatus, setPendingStatus] = useState<IssueStatus | null>(null)
  const [statusNote, setStatusNote] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [ownerDraft, setOwnerDraft] = useState(issue.owner)
  useEffect(() => {
    setPendingStatus(null)
    setStatusNote('')
    setRefusal(null)
    setOwnerDraft(issue.owner)
  }, [issue.id, issue.owner, issue.status])

  const chooseStatus = (to: IssueStatus) => {
    setRefusal(null)
    if (to === issue.status) {
      setPendingStatus(null)
      return
    }
    const out = dropOutcome(policy, row, to, hasEvidence)
    if (out.kind === 'refused') {
      setPendingStatus(null)
      setRefusal(out.message)
      return
    }
    setPendingStatus(to)
  }

  const commitStatus = () => {
    if (!pendingStatus || !statusNote.trim()) return
    if (onCommitCell(row.id, 'status', pendingStatus, statusNote.trim())) {
      setPendingStatus(null)
      setStatusNote('')
    }
  }

  return (
    <div className="field-strip">
      <label className="fs-fld">
        <span>{labels.FIELD_STATUS}</span>
        <select
          value={pendingStatus ?? issue.status}
          onChange={(e) => chooseStatus(e.target.value as IssueStatus)}
        >
          {[issue.status, ...routes.filter((sx) => sx !== issue.status)].map((sx) => (
            <option key={sx}>{sx}</option>
          ))}
        </select>
      </label>
      {pendingStatus && (
        <span className="fs-ask">
          <input
            autoFocus
            value={statusNote}
            placeholder={`Why is this “${pendingStatus}”?`}
            onChange={(e) => setStatusNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitStatus()
              if (e.key === 'Escape') setPendingStatus(null)
            }}
            aria-label="Reason for this status change"
          />
          <button className="btn primary" disabled={!statusNote.trim()} onClick={commitStatus}>
            Move
          </button>
          <button className="btn ghost" onClick={() => setPendingStatus(null)}>
            Cancel
          </button>
        </span>
      )}
      {refusal && <span className="fs-refusal">{refusal}</span>}
      <label className="fs-fld">
        <span>{labels.ISSUE_OWNER}</span>
        <input
          value={ownerDraft}
          onChange={(e) => setOwnerDraft(e.target.value)}
          onBlur={() => {
            if (ownerDraft.trim() !== issue.owner) onCommitCell(row.id, 'owner', ownerDraft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          aria-label={labels.ISSUE_OWNER}
        />
      </label>
      <label className="fs-fld">
        <span>{labels.FIELD_DUE_DATE}</span>
        <input
          type="date"
          value={row.plannedEndDate ?? ''}
          onChange={(e) => {
            if (e.target.value) onCommitCell(row.id, 'due', e.target.value)
          }}
          aria-label={labels.FIELD_DUE_DATE}
        />
      </label>
      <label className="fs-fld">
        <span>{labels.FIELD_SEVERITY}</span>
        <select
          value={issue.severity}
          onChange={(e) => onCommitCell(row.id, 'severity', e.target.value)}
          aria-label={labels.FIELD_SEVERITY}
        >
          {['High', 'Medium', 'Low'].map((sx) => (
            <option key={sx}>{sx}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function History({ audit, forId }: { audit: AuditEntry[]; forId?: string }) {
  /*
   * Scoped to the selected record when one is given. Unfiltered, a tab sitting inside issue
   * A's detail pane showed every change ever made to issues B through Z — read as A's
   * history by anyone who did not study the ids. Structural rows still get the global view:
   * their changes are sparse and the whole log is the honest answer there.
   */
  const shown = forId ? audit.filter((a) => a.rowId === forId) : audit
  if (!shown.length) {
    return (
      <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
        {forId
          ? `No changes recorded for ${forId} in this session. Editing a field, moving a date or changing its status is logged here.`
          : 'No schedule changes recorded in this session. Dragging a bar, committing a target date or building a lifecycle plan is logged here.'}
      </div>
    )
  }
  return (
    <ul style={{ listStyle: 'none', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[...shown].reverse().map((a) => (
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
