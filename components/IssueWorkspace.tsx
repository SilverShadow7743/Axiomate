'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilterState, IssueRelationship, ScheduleRow, SlaPolicy, ZoomLevel } from '@/lib/types'
import type { Actor } from '@/lib/actor'
import { DEFAULT_SLA, EMPTY_FILTERS, isGroupRow } from '@/lib/types'
import { COLUMNS, DEFAULT_FROZEN, DEFAULT_VISIBLE, labelColumn } from '@/lib/columns'
import {
  ROOT_SCOPE,
  liveWorkTypes,
  loadModel,
  resolveAutonomy,
  resolveLabels,
  saveModel,
  type Autonomy,
} from '@/lib/config'
import { LabelProvider } from './labels'
import {
  apply,
  applyWithRules,
  clientNodeId,
  initWorkspace,
  kindOf,
  moduleNodeId,
  scopeChainOf,
  type Action,
  type CreatableKind,
  type IssueRecord,
  type SeedIssueInput,
  type WorkspaceState,
} from '@/lib/workspace'
import type { IssueIndexEntry, Proposal } from '@/lib/chat'
import { buildTree, facetsOf, matchesFilters, parentIds, visibleRows } from '@/lib/tree'
import { sortTree } from '@/lib/sort'
import { addDays, maxIso, minIso } from '@/lib/dates'
import { criticalResolutionPath, proposeTargetDate, validateChange } from '@/lib/schedule'
import { DOMAIN_PAD_DAYS, ROW_H } from '@/lib/layout'
import {
  autoStateFor,
  CONTENT_HEAVY_TABS,
  defaultFraction,
  loadPrefs,
  panelHeight,
  savePrefs,
  type PanelPref,
  type PanelState,
} from '@/lib/panel'
import { buildScale } from '@/lib/timeline'
import { buildDailyIms, renderImsCsv, renderImsText } from '@/lib/reports/dailyIms'
import { planSlaDates, slaReason } from '@/lib/sla'
import SlaPlanPanel from './SlaPlanPanel'
import FilterBar from './FilterBar'
import TreeGrid from './TreeGrid'
import GanttChart from './GanttChart'
import DetailPanel from './DetailPanel'
import Inbox from './Inbox'
import SelectionToolbar from './SelectionToolbar'
import Dialogs, { type DialogState } from './Dialogs'
import IssueFocus from './IssueFocus'
import EvidencePanel, { type AddEvidenceInput } from './EvidencePanel'
import ChatPanel, { type ApplyOutcome } from './ChatPanel'
import ConfigWorkspace from './ConfigWorkspace'
import ArchivePanel from './ArchivePanel'
import { useAutosave } from './useAutosave'
import {
  describeSave,
  describeSaveDetail,
  hasLocalWorkspace,
  loadWorkspaceLocally,
  saveWorkspaceLocally,
} from '@/lib/autosave'
import type { ConfigOp } from '@/lib/workspace'

/** Keep a dragged pane between a usable minimum and leaving room for the workspace above. */
function clampFraction(f: number): number {
  return Math.max(0.1, Math.min(0.7, f))
}

interface Props {
  issues: SeedIssueInput[]
  relationships: IssueRelationship[]
  /** Supplied when a database served the workspace; null means the seed file did. */
  initialState: WorkspaceState | null
  persistence: { enabled: boolean; note: string; error?: string }
  /**
   * Which tenant this workspace belongs to, resolved on the server.
   *
   * Used here only as a namespace for browser storage, so two firms opened on one machine
   * never merge. It is not an authority: the server never trusts a tenant the client sends.
   */
  tenantId: string
  /**
   * Who this session's changes are attributed to, resolved on the server.
   *
   * Used for the optimistic audit entries the reducer writes locally, so History reads the
   * same before and after the server confirms. The server does not trust it — it resolves
   * its own and that is what is stored.
   */
  actor: Actor
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
}

export default function IssueWorkspace({
  issues,
  relationships,
  initialState,
  persistence,
  tenantId,
  actor,
  meta,
  today,
}: Props) {
  /* ---------------- workspace state ---------------- */
  const [state, setState] = useState<WorkspaceState>(
    () => initialState ?? initWorkspace(issues, relationships),
  )
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  /** Issue whose evidence manager is open, if any. */
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null)
  /** Whether the archive drawer is open. */
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const [slaOpen, setSlaOpen] = useState(false)
  const exportWrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportMenu) return
    const away = (e: MouseEvent) => {
      if (exportWrap.current && !exportWrap.current.contains(e.target as Node)) setExportMenu(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [exportMenu])
  /**
   * Set while the detail panel holds an uncommitted Overview edit.
   *
   * Lives here rather than in the panel because this component owns the selection, and the
   * selection is what would destroy the edit. A panel cannot defend work against a click it
   * never sees.
   */
  const [dirty, setDirty] = useState(false)

  // Track the timer so a second message gets its own full duration instead of inheriting
  // the first one's remaining time, and so nothing fires after unmount.
  const toastTimer = useRef<number | null>(null)
  const notify = useCallback((msg: string, error = false) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    setToast({ msg, error })
    toastTimer.current = window.setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, 4500)
  }, [])
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    },
    [],
  )

  /**
   * Autosave.
   *
   * There is no Save button and there should not be one: every change already passes through
   * one reducer, so saving is a consequence of the change rather than a decision about it.
   *
   * Actions are queued and drained one request at a time, in order — see `useAutosave`. That
   * matters because the server replays each action against stored state, so parallel requests
   * would all read the same pre-change snapshot. `dispatch` stays synchronous either way: its
   * callers read the folded state back in the same tick, and queueing is instant.
   */
  const autosave = useAutosave(persistence.enabled)
  const persist = autosave.enqueue

  /**
   * What the indicator reports.
   *
   * Without a database there is no queue to watch, so the honest status is the mode itself:
   * work is being kept, in this browser, and nowhere else.
   */
  const saveStatus = persistence.enabled
    ? autosave.state
    : { status: 'local' as const, pending: 0, savedAt: null }

/**
   * How wide the timeline pane actually is.
   *
   * The scale needs it: at coarse zoom the whole domain can be narrower than the pane, and
   * without this the timeline stopped short and left the rest of the pane blank. Observed
   * rather than assumed, because the split is draggable and the window resizes.
   */
  const ganttPaneRef = useRef<HTMLDivElement>(null)
  const [ganttWidth, setGanttWidth] = useState(0)
  useEffect(() => {
    const el = ganttPaneRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setGanttWidth(entry.contentRect.width))
    ro.observe(el)
    setGanttWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  /** Single funnel for every mutation, so validation and audit are never bypassed. */
  const dispatch = useCallback(
    (action: Action): boolean => {
      const res = apply(state, action, actor)
      if (res.error) {
        notify(res.error, true)
        return false
      }
      setState(res.state)
      if (res.createdId) setSelectedId(res.createdId)
      if (res.message) notify(res.message)
      persist(action)
      return true
    },
    [state, notify, persist, actor],
  )


  /**
   * The same funnel for a batch that has to land atomically.
   *
   * `dispatch` closes over `state`, so two calls in one tick both read the pre-change state
   * and the second `setState` silently discards the first. Nothing in the UI did that until
   * the assistant arrived: accepting a proposal that changes fields *and* dates is two
   * actions. This folds them over one `apply` chain — same validation, same audit entries —
   * and aborts without touching state if any step is rejected.
   */
  const dispatchMany = useCallback(
    (actions: Action[]): { ok: boolean; createdId?: string; state?: WorkspaceState } => {
      let cur = state
      let createdId: string | undefined
      let message: string | undefined
      const missed: string[] = []
      for (const action of actions) {
        /**
         * Rules run here as well as on the server, and that is deliberate rather than
         * duplicated work: both funnels plan from the same state with the same clock, so both
         * reach the same follow-up actions and mint the same ids. It is what lets a
         * notification appear the moment somebody reassigns an issue while the queue still
         * sends nothing but the reassignment.
         */
        const res = applyWithRules(cur, action, actor)
        if (res.error) {
          notify(res.error, true)
          return { ok: false }
        }
        cur = res.state
        if (res.createdId) createdId = res.createdId
        if (res.message) message = res.message
        // A rule that reached nobody, or asked for something the reducer refused, is surfaced
        // rather than swallowed — an automation that silently does nothing is indistinguishable
        // from one that worked.
        for (const miss of res.automation.misses) missed.push(`${miss.label}: ${miss.why}`)
        for (const r of res.automation.refusals) missed.push(`${r.action.t}: ${r.error}`)
      }
      if (missed.length) notify(missed[0], true)
      setState(cur)
      if (createdId) setSelectedId(createdId)
      if (message) notify(message)
      // Queued as one batch, in the order they were folded, so the server replays them the
      // way the client did. Each is validated again there; a batch that only half-applies
      // reports which action failed rather than being papered over.
      autosave.enqueueAll(actions)
      // The folded state is returned as well as committed: `setState` is batched, so a caller
      // that needs to reason about the *result* of the batch in the same tick cannot read it
      // back off `state`.
      return { ok: true, createdId, state: cur }
    },
    [state, notify, autosave, actor],
  )

  /* ---------------- configuration ---------------- */

  /**
   * Hydrate the operating model from local storage after mount.
   *
   * Not in the `useState` initializer: that runs during server rendering too, where there is
   * no storage, and reading it there would make the server and client markup disagree. The
   * workspace itself is deliberately in-memory, but configuration is the *shape* of the
   * workspace — a renamed term that vanished on refresh would read as broken, not as unsaved.
   *
   * Hydration is tracked in state, not a ref, and that is load-bearing.
   *
   * A save effect and a load effect share one storage key, so their order decides whether
   * configuration survives a refresh. A ref set in the effect body flips before the loaded
   * model has been committed, so the save effect runs against the *seed* and overwrites the
   * stored model with defaults — the settings appear to save and are gone on reload. Setting
   * a ref inside the updater instead has the opposite failure: when nothing is stored the
   * updater returns identical state, React bails out, and the first change of a fresh session
   * is skipped by a flag that never flipped.
   *
   * Both `setState` calls below are batched into one render, so the save effect first runs on
   * a commit where the model is already merged and the flag is already true. There is no
   * ordering left to get wrong.
   */
  const [modelHydrated, setModelHydrated] = useState(false)
  /** Set when the browser mirror is full — reported once, not on every keystroke. */
  const [mirrorError, setMirrorError] = useState<string | null>(null)

  useEffect(() => {
    // With a database, the server is the authority and local storage must stay out of it
    // entirely — reading it here would let a stale browser copy overwrite what another session
    // saved, and writing it would leave two stores disagreeing about the same record. The
    // mirror exists for the no-database mode, and only for that.
    if (persistence.enabled) {
      setModelHydrated(true)
      return
    }
    setState((s) => {
      // The whole workspace, not just configuration. Without a database this is the only
      // thing standing between a refresh and a lost afternoon.
      const mirrored = loadWorkspaceLocally(tenantId, s)
      if (mirrored) return mirrored
      const model = loadModel(tenantId, s.model)
      return model === s.model ? s : { ...s, model }
    })
    setModelHydrated(true)
  }, [persistence.enabled, tenantId])

  /**
   * Mirror the workspace after it settles.
   *
   * Debounced rather than written per action: serialising ~180 issues on every committed cell
   * edit is work the main thread does not need to repeat mid-drag, and the only thing that
   * matters is that the last state reaches storage.
   */
  useEffect(() => {
    if (!modelHydrated || persistence.enabled) return
    const t = window.setTimeout(() => {
      const res = saveWorkspaceLocally(tenantId, state)
      saveModel(tenantId, state.model)
      setMirrorError(res.ok ? null : (res.error ?? 'Could not write to browser storage.'))
    }, 400)
    return () => window.clearTimeout(t)
  }, [state, modelHydrated, persistence.enabled, tenantId])

  useEffect(() => {
    if (mirrorError) notify(`${mirrorError} Changes are no longer being kept.`, true)
  }, [mirrorError, notify])

  /**
   * A browser mirror left over from a session that had no database.
   *
   * Not deleted: it may hold work that was never sent anywhere, and discarding it silently
   * would be the worst possible way to find that out. Not loaded either — the database is the
   * authority now. Said out loud instead, once, so the choice is the user's.
   */
  useEffect(() => {
    if (!persistence.enabled) return
    if (hasLocalWorkspace(tenantId)) {
      notify('Work saved in this browser by an earlier offline session is not being used, now that a database is configured.')
    }
  }, [persistence.enabled, notify, tenantId])

  /** Organisation-wide terminology, for chrome that is not about one record. */
  const orgLabels = useMemo(() => resolveLabels(state.model), [state.model])


  /** Column headings follow configured terminology; widths and sorting do not change. */
  const labelledColumns = useMemo(
    () => COLUMNS.map((c) => ({ ...c, label: labelColumn(c, orgLabels) })),
    [orgLabels],
  )

  /* ---------------- view state ---------------- */
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /**
   * Change the selected row, unless that would silently discard an edit.
   *
   * A confirm dialog rather than a blocked click: refusing to move would leave someone stuck
   * on a row with no obvious way off, and saving for them would commit a change they may have
   * been in the middle of reconsidering. Asking is the only option that does not decide on
   * their behalf.
   *
   * Re-selecting the row already open is always allowed — that is not leaving anything.
   */
  const requestSelect = useCallback(
    (id: string | null) => {
      if (dirty && id !== selectedId) {
        const go = window.confirm(
          'This issue has unsaved changes. Leaving it will discard them.\n\nLeave anyway?',
        )
        if (!go) return
        setDirty(false)
      }
      setSelectedId(id)
    },
    [dirty, selectedId],
  )

  const [zoom, setZoom] = useState<ZoomLevel>('Week')
  /**
   * The configured service levels.
   *
   * Read from the operating model rather than held here, so editing them in Configuration
   * moves every proposal, every at-risk window and the daily report at once — and so the
   * change is audited like any other configuration edit.
   */
  const sla = state.model.sla
  const [showProposed, setShowProposed] = useState(false)

  const [visibleCols, setVisibleCols] = useState<string[]>(DEFAULT_VISIBLE)
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])),
  )
  const [colOrder, setColOrder] = useState<string[]>(COLUMNS.map((c) => c.key))
  const [frozenCount, setFrozenCount] = useState(DEFAULT_FROZEN)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)

  const [treeWidth, setTreeWidth] = useState(760)

  /* ---------------- adaptive detail pane ---------------- */
  const [panelPref, setPanelPref] = useState<PanelPref>('auto')
  const [panelFraction, setPanelFraction] = useState<number | null>(null)
  const [viewportH, setViewportH] = useState(900)
  /** Height of the header bands above the split view, measured rather than assumed. */
  const [chromeH, setChromeH] = useState(150)

  /* ---------------- derived tree ---------------- */
  const allRows = useMemo(() => buildTree(state, today), [state, today])

  const sortedRows = useMemo(
    () => (sort ? sortTree(allRows, COLUMNS.find((c) => c.key === sort.key), sort.dir) : allRows),
    [allRows, sort],
  )

  const rows = useMemo(
    () => visibleRows(sortedRows, filters, collapsed),
    [sortedRows, filters, collapsed],
  )

  const hasChildren = useMemo(() => parentIds(sortedRows), [sortedRows])
  const facets = useMemo(() => facetsOf(state), [state])

  const counts = useMemo(() => {
    const issueRows = sortedRows.filter((r) => r.kind === 'issue')
    const shown = issueRows.filter((r) => matchesFilters(r, filters))
    const tally = (h: string) => shown.filter((r) => r.scheduleHealth === h).length
    /**
     * "Done" is counted against the facets but not against the completed toggle.
     *
     * Every other figure here describes what is on screen, and should. This one cannot: with
     * completed work hidden — the default — counting only visible rows reported "0 done" in a
     * workspace where seventy-three were finished. A summary that reads as *nothing has been
     * completed* because completed things are hidden is worse than not showing the figure.
     */
    const completed = issueRows.filter(
      (r) => matchesFilters(r, { ...filters, showCompleted: true }) && r.scheduleHealth === 'Completed',
    ).length
    return {
      total: issueRows.length,
      shown: shown.length,
      overdue: tally('Overdue'),
      atRisk: tally('At Risk'),
      blocked: tally('Blocked'),
      completed,
      unscheduled: tally('Unscheduled'),
    }
  }, [sortedRows, filters])

  /**
   * Archived records, counted so the entry point can hide itself.
   *
   * A permanent Archive button on a workspace with an empty archive is a control that does
   * nothing; one that appears the moment something is archived is a route back that is
   * discoverable exactly when it matters.
   */
  const archivedCount = useMemo(
    () =>
      Object.values(state.nodes).filter((n) => n.deletedAt).length +
      Object.values(state.issues).filter((i) => i.deletedAt).length +
      Object.values(state.activities).filter((a) => a.deletedAt).length,
    [state.nodes, state.issues, state.activities],
  )

  /* ---------------- timeline domain ---------------- */
  const scale = useMemo(() => {
    const dates: (string | null)[] = []
    for (const r of sortedRows) {
      dates.push(r.actualStartDate, r.actualEndDate, r.plannedStartDate, r.plannedEndDate)
    }
    dates.push(today)
    if (showProposed) {
      for (const i of Object.values(state.issues)) {
        if (!i.deletedAt) dates.push(proposeTargetDate(i.raised, i.severity, sla))
      }
    }
    const lo = minIso(dates) ?? today
    const hi = maxIso(dates) ?? today
    const pad = DOMAIN_PAD_DAYS[zoom]
    return buildScale(addDays(lo, -pad), addDays(hi, pad), zoom, ganttWidth)
  }, [sortedRows, today, zoom, showProposed, state.issues, sla, ganttWidth])

  const selected = useMemo(
    () => sortedRows.find((r) => r.id === selectedId) ?? null,
    [sortedRows, selectedId],
  )

  const crp = useMemo(() => {
    if (!selected) return null
    const issueId = selected.kind === 'issue' ? selected.id : selected.parentId
    if (!issueId) return null
    const issueRow = sortedRows.find((r) => r.id === issueId)
    if (!issueRow) return null
    const acts = sortedRows.filter((r) => r.parentId === issueId)
    return criticalResolutionPath(acts, state.dependencies, issueRow.plannedEndDate)
  }, [selected, sortedRows, state.dependencies])

  const criticalIds = useMemo(() => new Set(crp?.sufficient ? crp.chain : []), [crp])

  const hasLifecycle = useCallback(
    (issueId: string) =>
      Object.values(state.activities).some((a) => a.issueId === issueId && !a.deletedAt),
    [state.activities],
  )

  /**
   * Terminology for the selected record, resolved along its own scope chain.
   *
   * The grid header has to pick one vocabulary because it spans every client at once, but a
   * detail pane, a form and a dialog are each about a single record — so they get the terms
   * configured for *that* record's project, falling back through its ancestors to the
   * organisation default.
   */
  const scopedLabels = useMemo(
    () => resolveLabels(state.model, scopeChainOf(state, selectedId)),
    [state, selectedId],
  )

  /**
   * Two different questions, deliberately answered by two different resolutions.
   *
   * *Is the assistant offered at all* is an organisation-level question. Resolving it against
   * the selected row would make the button appear and disappear as the user moved between
   * clients, and — worse — would unmount an open conversation, transcript included, the moment
   * they clicked a row in a scope where the agent is switched off.
   *
   * *What a turn may do* is the scoped question, and that is the one the assistant is sent.
   */
  const assistantOffered: Autonomy = useMemo(
    () => resolveAutonomy(state.model, 'AGENT_WORKSPACE_ASSISTANT', []),
    [state.model],
  )
  const assistantAutonomy: Autonomy = useMemo(
    () => resolveAutonomy(state.model, 'AGENT_WORKSPACE_ASSISTANT', scopeChainOf(state, selectedId)),
    [state, selectedId],
  )

  /* ---------------- configuration screen ---------------- */
  const [configOpen, setConfigOpen] = useState(false)

  /** Configuration changes take the same funnel as everything else, audit included. */
  const applyConfigOp = useCallback(
    (op: ConfigOp) => dispatch({ t: 'config', op, now: new Date().toISOString() }),
    [dispatch],
  )

  /* ---------------- assistant ---------------- */
  const [chatOpen, setChatOpen] = useState(false)
  /** Set after a reveal so the scroll happens once `rows` has actually recomputed. */
  const [revealTarget, setRevealTarget] = useState<string | null>(null)

  /** The assistant's entire view of the workspace: one flat row per live issue. */
  const chatIndex = useMemo<IssueIndexEntry[]>(
    () =>
      allRows
        .filter((r) => r.kind === 'issue' && r.issue)
        .map((r) => ({
          id: r.id,
          subject: r.name,
          client: r.issue!.client,
          module: r.issue!.module,
          status: r.status ?? '',
          severity: r.severity ?? '',
          owner: r.owner ?? '',
          accountable: r.accountable ?? '',
          health: r.scheduleHealth,
          plannedStart: r.plannedStartDate,
          plannedEnd: r.plannedEndDate,
          nextAction: r.nextAction ?? '',
        })),
    [allRows],
  )

  /* ---------------- scroll synchronisation ---------------- */
  const treeBodyRef = useRef<HTMLDivElement>(null)
  const ganttBodyRef = useRef<HTMLDivElement>(null)
  const treeHeadRef = useRef<HTMLDivElement>(null)
  const ganttHeadRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  const syncFrom = useCallback((source: 'tree' | 'gantt') => {
    if (syncing.current) return
    const tree = treeBodyRef.current
    const gantt = ganttBodyRef.current
    if (!tree || !gantt) return
    syncing.current = true
    if (source === 'tree') {
      gantt.scrollTop = tree.scrollTop
      if (treeHeadRef.current) treeHeadRef.current.scrollLeft = tree.scrollLeft
    } else {
      tree.scrollTop = gantt.scrollTop
      if (ganttHeadRef.current) ganttHeadRef.current.scrollLeft = gantt.scrollLeft
    }
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }, [])

  /* ---------------- view interactions ---------------- */
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /**
   * Bring a row into view: select it, expand every collapsed ancestor, and clear the filters
   * if they would hide it. A chip that selects an invisible row looks broken, and the user
   * has no way to tell selection-not-shown from nothing-happened.
   */
  const revealIssue = useCallback(
    /**
     * `against` exists because `setState` is batched: a caller revealing a row it just created
     * or just changed must hand in the tree built from the *post*-mutation state. Reading
     * `allRows` there would test a row that does not exist yet, or test the old field values
     * against the filters — and then fail to clear filters that now hide it.
     */
    (id: string, against?: ScheduleRow[]) => {
      const source = against ?? allRows
      const row = source.find((r) => r.id === id)
      if (!row) {
        notify(`${id} is no longer in the workspace.`, true)
        return
      }
      setCollapsed((prev) => {
        const next = new Set(prev)
        let cursor: string | null = row.parentId
        while (cursor) {
          next.delete(cursor)
          cursor = source.find((r) => r.id === cursor)?.parentId ?? null
        }
        return next
      })
      if (!matchesFilters(row, filters)) {
        setFilters(EMPTY_FILTERS)
        notify(`Filters cleared so ${id} is visible.`)
      }
      setSelectedId(id)
      setRevealTarget(id)
    },
    [allRows, filters, notify],
  )

  useEffect(() => {
    if (!revealTarget) return
    const idx = rows.findIndex((r) => r.id === revealTarget)
    setRevealTarget(null)
    if (idx < 0) return
    const body = treeBodyRef.current
    if (!body) return
    const top = idx * ROW_H
    if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - ROW_H) {
      body.scrollTop = Math.max(0, top - body.clientHeight / 2)
      syncFrom('tree')
    }
  }, [revealTarget, rows, syncFrom])

  /**
   * Accept an assistant proposal. Every write still goes through `apply`, so validation and
   * the History trail are identical to editing the row by hand — the assistant only ever
   * chose the arguments.
   */
  const applyProposal = useCallback(
    (p: Proposal): ApplyOutcome => {
      const now = new Date().toISOString()
      const why = p.rationale ? `Accepted from the assistant — ${p.rationale}` : 'Accepted from the assistant.'

      if (p.kind === 'update') {
        const actions: Action[] = []
        if (Object.keys(p.patch).length) {
          actions.push({ t: 'updateIssue', id: p.id, patch: p.patch as Partial<IssueRecord>, now })
        }
        if (p.dates) {
          actions.push({ t: 'setDates', id: p.id, start: p.dates.start, end: p.dates.end, now, reason: why })
        }
        if (!actions.length) return { ok: false, message: 'Nothing to change.' }
        const res = dispatchMany(actions)
        if (res.ok && res.state) revealIssue(p.id, buildTree(res.state, today))
        return { ok: res.ok, message: res.ok ? `${p.id} updated.` : 'The workspace rejected the change.' }
      }

      // File it under the named process area when that exists, else under the client.
      const modId = p.module ? moduleNodeId(p.client, p.module) : ''
      const parentId =
        modId && state.nodes[modId] && !state.nodes[modId].deletedAt ? modId : clientNodeId(p.client)
      if (!state.nodes[parentId] || state.nodes[parentId].deletedAt) {
        return { ok: false, message: `There is no live ${p.client} node to file this under.` }
      }
      const res = dispatchMany([{ t: 'create', parentId, kind: 'issue', draft: p.draft, now }])
      if (res.ok && res.createdId && res.state) revealIssue(res.createdId, buildTree(res.state, today))
      return { ok: res.ok, message: res.ok ? `${res.createdId} created.` : 'The workspace rejected the new issue.' }
    },
    [dispatchMany, revealIssue, state.nodes, today],
  )

  const expandAll = useCallback(() => setCollapsed(new Set()), [])
  const collapseAll = useCallback(() => {
    setCollapsed(
      new Set(sortedRows.filter((r) => r.kind !== 'issue' && hasChildren.has(r.id)).map((r) => r.id)),
    )
  }, [sortedRows, hasChildren])

  const scrollToToday = useCallback(() => {
    const g = ganttBodyRef.current
    if (!g) return
    g.scrollLeft = Math.max(0, scale.x(today) - g.clientWidth / 2)
  }, [scale, today])

  const centredOnce = useRef(false)
  useEffect(() => {
    if (centredOnce.current || !ganttBodyRef.current) return
    centredOnce.current = true
    scrollToToday()
  }, [scrollToToday])

  // Selecting a bar on the timeline must bring its grid row into view, and vice versa —
  // otherwise the two panes stop feeling like one workspace.
  useEffect(() => {
    if (!selectedId) return
    const tree = treeBodyRef.current
    if (!tree) return
    const idx = rows.findIndex((r) => r.id === selectedId)
    if (idx < 0) return
    const top = idx * ROW_H
    const viewTop = tree.scrollTop
    const viewBottom = viewTop + tree.clientHeight
    if (top < viewTop || top + ROW_H > viewBottom) {
      tree.scrollTop = Math.max(0, top - tree.clientHeight / 2)
      syncFrom('tree')
    }
  }, [selectedId, rows, syncFrom])

  /* ---------------- scheduling from the Gantt ---------------- */
  const commitDrag = useCallback(
    (rowId: string, start: string, end: string): boolean => {
      const map = new Map(sortedRows.map((r) => [r.id, r]))
      const row = map.get(rowId)
      if (!row) return false
      // Every structural tier, not just the two named here originally — an Engagement bar
      // was draggable, and the resulting `setDates` wrote a date the row recomputes away.
      if (isGroupRow(row.kind)) {
        notify('Summary rows roll up from their children and cannot be scheduled directly.', true)
        return false
      }
      const violations = validateChange(row, { start, end }, map, state.dependencies)
      const error = violations.find((v) => v.severity === 'error')
      if (error) {
        notify(error.message, true)
        return false
      }
      const warn = violations.find((v) => v.severity === 'warning')
      const ok = dispatch({
        t: 'setDates',
        id: rowId,
        start,
        end,
        now: new Date().toISOString(),
        reason: warn?.message,
      })
      if (ok && warn) notify(`Saved with a warning: ${warn.message}`)
      return ok
    },
    [sortedRows, state.dependencies, dispatch, notify],
  )

  /**
   * Commit an inline cell edit.
   *
   * Routed through the same `dispatch` funnel as the dialogs, so an inline change gets the
   * identical validation and audit entry — the grid is a faster way to reach an operation,
   * not a way around it. Date edits additionally go through `commitDrag` so dependency and
   * parent-constraint checks apply exactly as they do when dragging a bar.
   */
  const commitCell = useCallback(
    (rowId: string, colKey: string, raw: string): boolean => {
      const now = new Date().toISOString()
      const row = sortedRows.find((r) => r.id === rowId)
      if (!row) return false
      const value = raw.trim()

      const isNode = !!state.nodes[rowId]
      const isIssue = !!state.issues[rowId]
      const act = state.activities[rowId]

      switch (colKey) {
        case 'name': {
          if (!value) {
            notify('A name cannot be empty.', true)
            return false
          }
          if (isNode) return dispatch({ t: 'updateNode', id: rowId, patch: { name: value }, now })
          if (isIssue) return dispatch({ t: 'updateIssue', id: rowId, patch: { subject: value }, now })
          if (act) return dispatch({ t: 'updateActivity', id: rowId, patch: { phase: value }, now })
          return false
        }

        case 'owner': {
          if (isNode) return dispatch({ t: 'updateNode', id: rowId, patch: { owner: value || null }, now })
          if (isIssue)
            return dispatch({ t: 'updateIssue', id: rowId, patch: { owner: value || 'Unassigned' }, now })
          if (act)
            return dispatch({ t: 'updateActivity', id: rowId, patch: { owner: value || 'Unassigned' }, now })
          return false
        }

        case 'status':
          return dispatch({ t: 'updateIssue', id: rowId, patch: { status: value as never }, now })

        case 'severity':
          return dispatch({ t: 'updateIssue', id: rowId, patch: { severity: value as never }, now })

        case 'accountable':
          return dispatch({ t: 'updateIssue', id: rowId, patch: { accountable: value as never }, now })

        case 'next':
          return dispatch({ t: 'updateIssue', id: rowId, patch: { nextAction: value }, now })

        case 'pct': {
          if (value === '') {
            // Clearing hands progress back to the status-derived rule rather than pinning 0.
            if (isIssue) return dispatch({ t: 'updateIssue', id: rowId, patch: { percentOverride: null }, now })
            // An activity owns its percentage outright — there is nothing to fall back to,
            // so an empty submission is simply no change rather than an error.
            return true
          }
          const n = Math.max(0, Math.min(100, Number(value)))
          if (Number.isNaN(n)) {
            notify('Progress must be a number between 0 and 100.', true)
            return false
          }
          if (isIssue) return dispatch({ t: 'updateIssue', id: rowId, patch: { percentOverride: n }, now })
          if (act) return dispatch({ t: 'updateActivity', id: rowId, patch: { percentComplete: n }, now })
          return false
        }

        case 'start':
        case 'due':
        case 'duration': {
          // Establish the current window, falling back to the raised date so a due date can
          // be typed against an issue that has never been scheduled.
          const start = row.plannedStartDate ?? row.actualStartDate
          const end = row.plannedEndDate ?? start
          if (!start) {
            notify('This row has no start date to schedule from.', true)
            return false
          }

          let nextStart = start
          let nextEnd = end!

          if (colKey === 'start') {
            if (!value) {
              notify('A start date is required once a row is scheduled.', true)
              return false
            }
            const span = row.duration ?? 1
            nextStart = value
            // Moving the start carries the existing duration with it, as MS Project does.
            nextEnd = row.plannedEndDate ? addDays(value, span - 1) : value
          } else if (colKey === 'due') {
            if (!value) {
              notify('Clear a schedule from the Edit dialog rather than the grid.', true)
              return false
            }
            nextEnd = value
            if (value < nextStart) nextStart = value
          } else {
            const n = Number(value)
            if (!Number.isFinite(n) || n < 1) {
              notify('Duration must be at least one day.', true)
              return false
            }
            nextEnd = addDays(nextStart, n - 1)
          }

          return commitDrag(rowId, nextStart, nextEnd)
        }

        default:
          return false
      }
    },
    [sortedRows, state, dispatch, notify, commitDrag],
  )

  /** Which pending dialog is an issue form, and therefore opens in full-page focus mode. */
  const issueForm = useMemo((): { mode: 'edit' | 'add'; targetId: string } | null => {
    if (!dialog) return null
    if (dialog.t === 'edit' && state.issues[dialog.id]) return { mode: 'edit', targetId: dialog.id }
    if (dialog.t === 'add' && (dialog.kind === 'issue' || dialog.kind === 'sub-issue')) {
      return { mode: 'add', targetId: dialog.parentId }
    }
    return null
  }, [dialog, state.issues])

  /* ---------------- dialog submission ---------------- */
  const submitDialog = useCallback(
    (p: Record<string, string>) => {
      const now = new Date().toISOString()
      if (!dialog) return
      let ok = false

      if (dialog.t === 'add') {
        ok = dispatch({ t: 'create', parentId: dialog.parentId, kind: dialog.kind, draft: p, now })
      } else if (dialog.t === 'edit') {
        const id = dialog.id
        if (state.nodes[id]) {
          ok = dispatch({ t: 'updateNode', id, patch: { name: p.name, owner: p.owner || null }, now })
        } else if (state.issues[id]) {
          ok = dispatch({
            t: 'updateIssue',
            id,
            patch: {
              subject: p.subject,
              description: p.description,
              status: p.status as never,
              severity: p.severity as never,
              owner: p.owner,
              accountable: p.accountable as never,
              nextAction: p.nextAction,
              plannedStart: p.plannedStart || null,
              plannedEnd: p.plannedEnd || null,
              scheduleMode: p.plannedEnd ? 'MANUAL' : 'AUTO',
              percentOverride: p.percent === '' ? null : Number(p.percent),
            },
            now,
          })
        } else if (state.activities[id]) {
          ok = dispatch({
            t: 'updateActivity',
            id,
            patch: {
              phase: p.name,
              owner: p.owner,
              plannedStartDate: p.plannedStart,
              plannedEndDate: state.activities[id].isMilestone ? p.plannedStart : p.plannedEnd,
              percentComplete: Number(p.percent || 0),
              scheduleMode: 'MANUAL',
            },
            now,
          })
        }
      } else if (dialog.t === 'move') {
        ok = dispatch({ t: 'move', id: dialog.id, newParentId: p.newParentId, now })
      } else if (dialog.t === 'link') {
        ok = dispatch({
          t: 'link',
          sourceIssueId: dialog.issueId,
          targetIssueId: p.targetIssueId,
          relationshipType: p.relationshipType,
          note: p.note,
          now,
        })
      } else if (dialog.t === 'dependency') {
        ok = dispatch({
          t: 'addDependency',
          predecessorId: p.predecessorId,
          successorId: dialog.activityId,
          dependencyType: p.dependencyType as never,
          lagDays: Number(p.lagDays || 0),
          now,
        })
      } else if (dialog.t === 'delete') {
        ok = dispatch({
          t: 'softDelete',
          id: dialog.id,
          mode: p.mode as 'cascade' | 'reparent',
          now,
        })
        if (ok && selectedId === dialog.id) setSelectedId(null)
      }

      if (ok) setDialog(null)
    },
    [dialog, dispatch, state, selectedId],
  )

  /* ---------------- toolbar handlers ---------------- */
  const buildLifecycle = useCallback(
    (issueId: string) => {
      const issue = state.issues[issueId]
      if (!issue) return
      dispatch({
        t: 'buildLifecycle',
        issueId,
        slaDays: sla[issue.severity],
        now: new Date().toISOString(),
      })
      setCollapsed((prev) => {
        const next = new Set(prev)
        next.delete(issueId)
        return next
      })
    },
    [state.issues, sla, dispatch],
  )

  const toggleLifecycle = useCallback(
    (issueId: string) => {
      if (hasLifecycle(issueId)) {
        dispatch({ t: 'clearLifecycle', issueId, now: new Date().toISOString() })
      } else {
        buildLifecycle(issueId)
      }
    },
    [hasLifecycle, dispatch, buildLifecycle],
  )

  const markComplete = useCallback(() => {
    if (!selected) return
    dispatch({
      t: 'updateActivity',
      id: selected.id,
      patch: { percentComplete: 100 },
      now: new Date().toISOString(),
    })
  }, [selected, dispatch])

  /**
   * Default parent for "+ New Issue" when nothing is selected. A client is a predictable
   * landing place; dropping the issue into whichever process area happened to be created
   * first would be arbitrary. The Add dialog names the parent either way.
   */
  const defaultParentId = useMemo(
    () => Object.values(state.nodes).find((n) => n.kind === 'client' && !n.deletedAt)?.id ?? null,
    [state.nodes],
  )

  /* ---------------- adaptive detail pane sizing ---------------- */

  // Restore the stored preference and track the viewport, so the pane scales with the
  // window instead of holding a pixel height that is wrong on a different screen.
  const shellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const p = loadPrefs()
    setPanelPref(p.pref)
    setPanelFraction(p.fraction)
    const measure = () => {
      setViewportH(window.innerHeight)
      const top = shellRef.current?.querySelector('.split') as HTMLElement | null
      if (top) setChromeH(top.getBoundingClientRect().top)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const availableH = Math.max(320, viewportH - chromeH)
  const naturalPanelState: PanelState =
    panelPref === 'auto' ? autoStateFor(!!selectedId, viewportH) : panelPref

  /**
   * Note: the pane is NOT collapsed while the focus editor is open. Focus mode covers the
   * page entirely, so collapsing would change nothing the user can see — but it would resize
   * the split above, which clamps the tree and Gantt scroll positions and loses the very
   * context focus mode is meant to preserve.
   */
  const panelState: PanelState = naturalPanelState

  const detailHeight = panelHeight(
    panelState,
    panelFraction ?? defaultFraction(viewportH),
    availableH,
  )

  const setPanel = useCallback(
    (next: PanelState) => {
      setPanelPref(next)
      savePrefs({ pref: next, fraction: panelFraction })
    },
    [panelFraction],
  )

  // Selecting a row is the signal that the detail pane is wanted. Only overrides an
  // *automatic* compact state — an explicit collapse is left alone.
  const prevSelection = useRef<string | null>(null)
  useEffect(() => {
    const had = prevSelection.current
    prevSelection.current = selectedId
    if (!selectedId || had === selectedId) return
    if (panelPref === 'compact') setPanel('standard')
  }, [selectedId, panelPref, setPanel])

  /** Opening a table-shaped tab from a collapsed pane must actually reveal something. */
  const onTabChange = useCallback(
    (tab: string) => {
      // Compare against the user's own state rather than any transient override, so
      // opening a tab never persists a preference the user did not choose.
      if (naturalPanelState === 'compact' && CONTENT_HEAVY_TABS.has(tab)) setPanel('standard')
    },
    [naturalPanelState, setPanel],
  )

  /** Drag stores a fraction of the available height, not a pixel value. */
  const onPanelResize = useCallback(
    (px: number) => {
      const f = clampFraction(px / availableH)
      setPanelFraction(f)
      const next: PanelState = panelState === 'compact' ? 'standard' : panelState
      setPanelPref(next)
      savePrefs({ pref: next, fraction: f })
    },
    [availableH, panelState],
  )

  /* ---------------- splitter ---------------- */
  const [dragSplit, setDragSplit] = useState(false)
  useEffect(() => {
    if (!dragSplit) return
    const move = (e: MouseEvent) =>
      setTreeWidth(Math.max(260, Math.min(e.clientX, window.innerWidth - 320)))
    const up = () => setDragSplit(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragSplit])

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape is checked FIRST, before the form-field bail-out below.
      //
      // A dialog opens with focus in its first field — that is exactly where useOverlay puts
      // it — so bailing out on INPUT/SELECT/TEXTAREA before testing Escape made Escape dead
      // in every dialog it was supposed to close.
      //
      // The focus editor is excluded: it runs its own Escape handler that checks for unsaved
      // changes first. Both listeners are on `window`, so stopPropagation would not help.
      if (e.key === 'Escape' && dialog && !issueForm) {
        setDialog(null)
        return
      }

      const el = e.target as HTMLElement
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
      // Arrow-key row navigation lives on the grid itself (see TreeGrid.onGridKeyDown).
      // On `window` it fired wherever focus happened to be, and gave keyboard users no way
      // to reach the grid in the first place.
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, issueForm])

  const orderedCols = useMemo(
    () =>
      colOrder
        .map((k) => labelledColumns.find((c) => c.key === k)!)
        .filter((c) => c && visibleCols.includes(c.key)),
    [colOrder, visibleCols, labelledColumns],
  )

  /** One place that turns text into a file, so the three exports cannot drift apart. */
  const download = useCallback((name: string, text: string, mime: string) => {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  /**
   * What the report covers, in words, taken from the filters actually in force.
   *
   * The report prints this at the top. A status report whose scope is implicit is one people
   * misread once and stop trusting afterwards — and "everything" is itself a scope worth
   * stating rather than leaving blank.
   */
  const scopeLabel = useMemo(() => {
    const parts: string[] = []
    if (filters.client !== 'All') parts.push(filters.client)
    if (filters.module !== 'All') parts.push(filters.module)
    if (filters.type !== 'All') parts.push(filters.type)
    if (filters.status !== 'All') parts.push(`status ${filters.status}`)
    if (filters.severity !== 'All') parts.push(`severity ${filters.severity}`)
    if (filters.owner !== 'All') parts.push(`owner ${filters.owner}`)
    if (filters.accountable !== 'All') parts.push(`accountable ${filters.accountable}`)
    if (filters.health !== 'All') parts.push(filters.health)
    if (filters.search.trim()) parts.push(`matching “${filters.search.trim()}”`)
    const base = parts.length ? parts.join(' · ') : `All clients — ${state.model.organization.name}`
    return filters.showCompleted ? base : `${base} (completed hidden in the view; counted here)`
  }, [filters, state.model.organization.name])

  /**
   * Daily IMS.
   *
   * Built from the rows currently in view rather than from the whole workspace, so the report
   * and the screen behind it can never disagree — with one deliberate exception, handled in
   * the report: completed records are hidden by default in the grid but still counted in the
   * position figures, because a status report that says "0 done" would be worse than useless.
   */
  const exportDailyIms = useCallback(() => {
    const inScope = sortedRows.filter(
      (r) => r.kind === 'issue' && matchesFilters(r, { ...filters, showCompleted: true }),
    )
    const report = buildDailyIms(state, inScope, today, scopeLabel)
    download(`daily-ims-${today}.txt`, renderImsText(report), 'text/plain')
    download(`daily-ims-${today}.csv`, renderImsCsv(report), 'text/csv')
    notify(
      `Daily IMS exported — ${report.position.open} open of ${report.position.total}, ${report.sections.length} section(s) needing attention.`,
    )
  }, [state, sortedRows, filters, today, scopeLabel, download, notify])

  /**
   * What applying the SLA policy would do. Computed on demand; nothing is written here.
   *
   * Scoped to the rows in view, like the IMS, so a bulk write can never reach further than
   * the screen implies. Completed records are excluded by the planner itself rather than by
   * the filter, so the result does not change depending on whether they happen to be shown.
   */
  const slaPlan = useMemo(
    () =>
      planSlaDates(
        sortedRows.filter((r) => r.kind === 'issue' && matchesFilters(r, { ...filters, showCompleted: true })),
        sla,
        today,
      ),
    [sortedRows, filters, sla, today],
  )

  /**
   * Commit the plan.
   *
   * One batch through the same funnel as everything else, so each date is validated and
   * audited individually — and each audit entry carries the arithmetic that produced it. If
   * any single date is refused the whole batch aborts rather than leaving the workspace half
   * scheduled, which is what `dispatchMany` already guarantees.
   */
  const applySlaDates = useCallback(() => {
    const now = new Date().toISOString()
    const actions: Action[] = slaPlan.rows.map((r) => ({
      t: 'setDates',
      id: r.id,
      start: r.raised,
      end: r.target,
      now,
      reason: slaReason(r),
    }))
    if (!actions.length) return
    const res = dispatchMany(actions)
    if (res.ok) {
      setSlaOpen(false)
      notify(
        `Set ${actions.length} due date${actions.length === 1 ? '' : 's'} from the SLA policy${slaPlan.past ? `; ${slaPlan.past} are already past and now report as overdue` : ''}.`,
      )
    }
  }, [slaPlan, dispatchMany, notify])

  const exportCsv = useCallback(() => {
    const cell = (r: ScheduleRow, key: string): string => {
      switch (key) {
        case 'id':
          return r.displayId
        case 'name':
          return `${'  '.repeat(r.depth)}${r.name}`
        case 'type':
          return String(r.type)
        case 'status':
          return r.status ?? ''
        case 'severity':
          return r.severity ?? ''
        case 'health':
          return r.scheduleHealth
        case 'owner':
          return r.owner ?? ''
        case 'accountable':
          return r.accountable ?? ''
        case 'start':
          return r.plannedStartDate ?? r.actualStartDate ?? ''
        case 'due':
          return r.plannedEndDate ?? ''
        case 'duration':
          return r.duration != null ? String(r.duration) : ''
        case 'pct':
          return `${r.percentComplete}%${r.progressOrigin === 'status-derived' ? ' (status-derived)' : ''}`
        case 'mode':
          return r.scheduleMode
        case 'next':
          return r.nextAction ?? ''
        case 'dependency':
          return r.predecessorIds.join('; ')
        default:
          return ''
      }
    }
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = [orderedCols.map((c) => esc(c.label)).join(',')]
    for (const r of rows) lines.push(orderedCols.map((c) => esc(cell(r, c.key))).join(','))
    download(`issue-schedule-${today}.csv`, lines.join('\r\n'), 'text/csv')
    notify(`Exported ${rows.length} rows.`)
  }, [rows, orderedCols, today, notify, download])

  return (
    <LabelProvider value={orgLabels}>
    <div className="app" id="app-shell" ref={shellRef}>
      <div className="topbar">
        <span className="wordmark">
          axiomate<i>.</i>
        </span>
        {/* Axiomate is the product; this is the firm running it. The tree's top tier is that
            firm's client, so naming the firm is what makes "Client" mean anything. */}
        <span className="org-name" title={state.model.organization.description}>
          {state.model.organization.name}
        </span>
        <span className="sep" />
        <span className="page-title">Issue Tree &amp; Resolution Schedule</span>

        <div className="search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search issue ID, subject, owner, next action…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>

        <Inbox
          state={state}
          actor={actor}
          onRead={(id) => dispatch({ t: 'markNotificationRead', id, now: new Date().toISOString() })}
          onOpen={(issueId) => setSelectedId(issueId)}
        />

        <span className="sep" />

        <SelectionToolbar
        row={selected}
        hasLifecycle={selected?.kind === 'issue' ? hasLifecycle(selected.id) : false}
        onAdd={(kind: CreatableKind) =>
          selected && setDialog({ t: 'add', parentId: selected.id, kind })
        }
        onEdit={() => selected && setDialog({ t: 'edit', id: selected.id })}
        onMove={() => selected && setDialog({ t: 'move', id: selected.id })}
        onLink={() => selected && setDialog({ t: 'link', issueId: selected.id })}
        onDependency={() => selected && setDialog({ t: 'dependency', activityId: selected.id })}
        onMarkComplete={markComplete}
        onDelete={() => selected && setDialog({ t: 'delete', id: selected.id })}
        onBuildLifecycle={() => selected && toggleLifecycle(selected.id)}
        onNewIssue={() =>
          defaultParentId
            ? setDialog({ t: 'add', parentId: defaultParentId, kind: 'issue' })
            : notify('Create a client first.', true)
        }
      />

        <span className="grow" />
        {/* The assistant button follows the agent registry: an agent configured off is not a
            button that explains why it is disabled, it is a button that is not there. */}
        {assistantOffered !== 'off' && (
          <button
            className={`btn${chatOpen ? ' primary' : ''}`}
            onClick={() => setChatOpen((v) => !v)}
            aria-pressed={chatOpen}
            title={
              assistantAutonomy === 'suggest'
                ? 'Find issues by describing them. Configured to answer only.'
                : 'Find, log or change an issue by describing it'
            }
          >
            Assistant
          </button>
        )}
        <div ref={exportWrap} style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setExportMenu((v) => !v)} aria-expanded={exportMenu}>
            Export ▾
          </button>
          {exportMenu && (
            <div className="menu" style={{ top: 30, right: 0, left: 'auto', minWidth: 260 }}>
              <div className="menu-title">Export</div>
              <button
                className="menu-item"
                onClick={() => {
                  setExportMenu(false)
                  exportDailyIms()
                }}
              >
                Daily IMS — status report
                <span className="menu-sub">Text to paste, plus a CSV of the open rows</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportMenu(false)
                  exportCsv()
                }}
              >
                Visible rows
                <span className="menu-sub">The grid as it stands, with your columns</span>
              </button>
            </div>
          )}
        </div>
        <button
          className={`btn${configOpen ? ' primary' : ''}`}
          onClick={() => setConfigOpen(true)}
          title="Terminology, roles, responsibilities, agents"
        >
          Configuration
        </button>
        {/* Whether work is safe is not a detail to leave someone guessing about, so this
            reports the live state of the queue rather than a static capability. */}
        <span
          className={`persist-tag ${saveStatus.status}`}
          title={
            persistence.error
              ? `${describeSaveDetail(saveStatus, persistence.enabled)} ${persistence.error}`
              : describeSaveDetail(saveStatus, persistence.enabled)
          }
          aria-live="polite"
        >
          <span className="persist-dot" aria-hidden="true" />
          {describeSave(saveStatus)}
        </span>
        <button
          className="btn"
          onClick={() => setPanel(panelState === 'compact' ? 'standard' : 'compact')}
          title={panelState === 'compact' ? 'Show the detail pane' : 'Collapse the detail pane'}
        >
          {panelState === 'compact' ? 'Show details' : 'Hide details'}
        </button>
      </div>

      <FilterBar
        actor={actor}
        filters={filters}
        setFilters={setFilters}
        facets={facets}
        zoom={zoom}
        setZoom={setZoom}
        counts={counts}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onToday={scrollToToday}
        columns={labelledColumns}
        visibleCols={visibleCols}
        setVisibleCols={setVisibleCols}
        frozenCount={frozenCount}
        setFrozenCount={setFrozenCount}
        showProposed={showProposed}
        setShowProposed={setShowProposed}
        sla={sla}
        archivedCount={archivedCount}
        slaCandidates={slaPlan.rows.length}
        onPlanSla={() => setSlaOpen(true)}
        onOpenArchive={() => setArchiveOpen(true)}
      />

      <div className="split">
        <div className="pane-tree" style={{ width: treeWidth }}>
          <TreeGrid
            rows={rows}
            columns={orderedCols}
            colWidths={colWidths}
            setColWidths={setColWidths}
            colOrder={colOrder}
            setColOrder={setColOrder}
            frozenCount={frozenCount}
            collapsed={collapsed}
            hasChildren={hasChildren}
            onToggle={toggle}
            selectedId={selectedId}
            onSelect={requestSelect}
            sort={sort}
            setSort={setSort}
            bodyRef={treeBodyRef}
            headRef={treeHeadRef}
            onScroll={() => syncFrom('tree')}
            criticalIds={criticalIds}
            onCellCommit={commitCell}
            ownerOptions={facets.owners}
          statusPolicy={state.model.statusPolicy}
          />
        </div>

        <div
          className={`splitter${dragSplit ? ' dragging' : ''}`}
          onMouseDown={() => setDragSplit(true)}
          role="separator"
          aria-orientation="vertical"
        />

        <div className="pane-gantt" ref={ganttPaneRef}>
          <GanttChart
            rows={rows}
            scale={scale}
            zoom={zoom}
            today={today}
            selectedId={selectedId}
            onSelect={requestSelect}
            dependencies={state.dependencies}
            criticalIds={criticalIds}
            bodyRef={ganttBodyRef}
            headRef={ganttHeadRef}
            onScroll={() => syncFrom('gantt')}
            onCommitDrag={commitDrag}
            showProposed={showProposed}
            proposalFor={(row) => {
              if (row.kind !== 'issue' || row.plannedEndDate || !row.issue) return null
              return {
                start: row.issue.raised,
                end: proposeTargetDate(row.issue.raised, row.issue.severity, sla),
              }
            }}
          />
        </div>
      </div>

      {/* Everything below is about ONE record, so it uses that record's terminology rather
          than the organisation's. Nested provider, nearest wins — same rule as the resolver. */}
      <LabelProvider value={scopedLabels}>
      <DetailPanel
          row={selected}
          allRows={sortedRows}
          relationships={state.relationships}
          dependencies={state.dependencies}
          crp={crp}
          audit={state.audit}
          height={detailHeight}
          panelState={panelState}
          onResize={onPanelResize}
          onSetPanel={setPanel}
          onTabChange={onTabChange}
          onBuildLifecycle={buildLifecycle}
          onClearLifecycle={(id) =>
            dispatch({ t: 'clearLifecycle', issueId: id, now: new Date().toISOString() })
          }
          onAcceptProposal={(id) => {
            const i = state.issues[id]
            if (!i) return
            dispatch({
              t: 'setDates',
              id,
              start: i.raised,
              end: proposeTargetDate(i.raised, i.severity, sla),
              now: new Date().toISOString(),
              reason: `Accepted the ${i.severity} SLA proposal (${sla[i.severity]} working days from ${i.raised}).`,
            })
          }}
          onUnlink={(id) => dispatch({ t: 'unlink', id, now: new Date().toISOString() })}
          evidence={Object.values(state.evidence)}
          onManageEvidence={setEvidenceFor}
          onRemoveDependency={(id) =>
            dispatch({ t: 'removeDependency', id, now: new Date().toISOString() })
          }
          hasLifecycle={hasLifecycle}
          sla={sla}
          meta={meta}
          today={today}
          state={state}
          onUpdateEngagement={(nodeId, patch) =>
            dispatch({ t: 'updateEngagement', nodeId, patch, now: new Date().toISOString() })
          }
          actor={actor}
          onDirtyChange={setDirty}
          onSaveEstimate={(issueId, patch, reason) =>
            dispatch({ t: 'setEstimate', issueId, patch, reason, now: new Date().toISOString() })
          }
          onBaselineEstimate={(issueId) =>
            dispatch({ t: 'baselineEstimate', issueId, now: new Date().toISOString() })
          }
          /**
           * One commit, two possible actions.
           *
           * Field edits and date changes are different actions on purpose — dates carry
           * scheduling validation and a reason — but a user pressing Save once expects one
           * outcome, so they are folded through a single batch that either lands or does not.
           */
          onSaveIssue={(id, patch, dates, reason) => {
            const now = new Date().toISOString()
            const actions: Action[] = []
            if (Object.keys(patch).length) actions.push({ t: 'updateIssue', id, patch, now, reason })
            if (dates) actions.push({ t: 'setDates', id, start: dates.start, end: dates.end, now })
            if (!actions.length) return true
            const res = dispatchMany(actions)
            if (res.ok) setDirty(false)
            return res.ok
          }}
          onRequestApproval={(subjectId, ruleId, note) =>
            dispatch({ t: 'requestApproval', subjectId, ruleId, note, now: new Date().toISOString() })
          }
          onDecideApproval={(id, decision, note) =>
            dispatch({ t: 'decideApproval', id, decision, note, now: new Date().toISOString() })
          }
          onAddTime={(issueId, entry) =>
            dispatch({ t: 'addTime', issueId, ...entry, now: new Date().toISOString() })
          }
          onRemoveTime={(id) => dispatch({ t: 'removeTime', id, now: new Date().toISOString() })}
          onAddNote={(issueId, body, noteType, pinned) =>
            dispatch({ t: 'addNote', issueId, body, noteType, pinned, now: new Date().toISOString() })
          }
          onUpdateNote={(id, patch) =>
            dispatch({ t: 'updateNote', id, patch, now: new Date().toISOString() })
          }
          onDeleteNote={(id) => dispatch({ t: 'removeNote', id, now: new Date().toISOString() })}
          onSetAssignment={(issueId, responsibilityId, values) =>
            dispatch({ t: 'setAssignment', issueId, responsibilityId, values, now: new Date().toISOString() })
          }
        />

      {/* Editing an issue is a job in its own right, so it takes the page. Transactional
          operations (move, link, dependency, archive, structural adds) stay as modals — each
          is a single decision, not a working surface. Small field changes never come here at
          all: they are edited inline in the grid. */}
      {issueForm ? (
        <IssueFocus
          mode={issueForm.mode}
          targetId={issueForm.targetId}
          state={state}
          ownerOptions={facets.owners}
          statusPolicy={state.model.statusPolicy}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
          onManageEvidence={setEvidenceFor}
        />
      ) : (
        <Dialogs
          dialog={dialog}
          state={state}
          rows={sortedRows}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      )}
      </LabelProvider>

      {evidenceFor && state.issues[evidenceFor] && (
        <EvidencePanel
          issue={state.issues[evidenceFor]}
          items={Object.values(state.evidence).filter((e) => e.issueId === evidenceFor)}
          onAdd={(input: AddEvidenceInput) =>
            dispatch({ t: 'addEvidence', issueId: evidenceFor, ...input, now: new Date().toISOString() })
          }
          onUpdate={(id, patch) =>
            dispatch({ t: 'updateEvidence', id, patch, now: new Date().toISOString() })
          }
          onRemove={(id) => dispatch({ t: 'removeEvidence', id, now: new Date().toISOString() })}
          onClose={() => setEvidenceFor(null)}
        />
      )}

      {chatOpen && assistantOffered !== 'off' && (
        <ChatPanel
          index={chatIndex}
          today={today}
          config={{
            terms: {
              owner: scopedLabels.ISSUE_OWNER,
              accountable: scopedLabels.ISSUE_ACCOUNTABLE,
              raisedBy: scopedLabels.ISSUE_RAISED_BY,
              issue: scopedLabels.RECORD_ISSUE,
              module: scopedLabels.TIER_MODULE,
              organization: scopedLabels.TIER_ORGANIZATION,
            },
            parties: state.model.parties,
            workTypes: liveWorkTypes(state.model).map((t) => t.label),
            autonomy: assistantAutonomy,
          }}
          onReveal={revealIssue}
          onApply={applyProposal}
          onClose={() => setChatOpen(false)}
        />
      )}

      {slaOpen && (
        <SlaPlanPanel
          plan={slaPlan}
          scope={scopeLabel}
          today={today}
          onApply={applySlaDates}
          onClose={() => setSlaOpen(false)}
        />
      )}

      {archiveOpen && (
        <ArchivePanel
          state={state}
          onRestore={(id) => dispatch({ t: 'restore', id, now: new Date().toISOString() })}
          onClose={() => setArchiveOpen(false)}
        />
      )}

      {configOpen && (
        <ConfigWorkspace state={state} onConfig={applyConfigOp} onClose={() => setConfigOpen(false)} />
      )}

      {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.msg}</div>}
    </div>
    </LabelProvider>
  )
}
