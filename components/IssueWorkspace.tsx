'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { FilterState, IssueRelationship, ScheduleRow, SlaPolicy, ZoomLevel } from '@/lib/types'
import type { Actor } from '@/lib/actor'
import type { DocumentRecord } from '@/lib/documents'
import type { IssueNote } from '@/lib/notes'
import { wrapPlainText } from '@/lib/richText'
import MyWorkPanel from './MyWorkPanel'
import MyCalendarPanel from './MyCalendarPanel'
import MailLog from './MailLog'
import PortfolioPanel from './PortfolioPanel'
import { myWork } from '@/lib/mywork'
import { can, directoryPersonFor } from '@/lib/access'
import { DEFAULT_SLA, EMPTY_FILTERS, isGroupRow } from '@/lib/types'
import { COLUMNS, DEFAULT_FROZEN, DEFAULT_VISIBLE, labelColumn } from '@/lib/columns'
import {
  ROOT_SCOPE,
  liveWorkTypes,
  loadModel,
  resolveAutonomy,
  resolveLabels,
  saveModel,
  tiersOf,
  externalPartyKinds,
  type Autonomy,
} from '@/lib/config'
import { LabelProvider } from './labels'
import {
  apply,
  applyWithRules,
  clientNodeId,
  initWorkspace,
  canParent,
  kindOf,
  moduleNodeId,
  scopeChainOf,
  createMenuFor,
  type Action,
  type CreatableKind,
  type IssueRecord,
  type SeedIssueInput,
  type WorkspaceState,
} from '@/lib/workspace'
import type { IssueIndexEntry, Proposal } from '@/lib/chat'
import { buildTree, facetsOf, matchesFilters, parentIds, visibleRows } from '@/lib/tree'
import { sortTree } from '@/lib/sort'
import { availabilityForAssignment, refusesAssignment } from '@/lib/assignment'
import UserMenu from './UserMenu'
import { addDays, maxIso, minIso } from '@/lib/dates'
import { criticalResolutionPath, proposeTargetDate, validateChange } from '@/lib/schedule'
import { DOMAIN_PAD_DAYS, ROW_H } from '@/lib/layout'
import type { PanelState } from '@/lib/panel'
import { buildScale } from '@/lib/timeline'
import { buildDailyIms, renderImsCsv, renderImsText } from '@/lib/reports/dailyIms'
import { buildWeeklyClientPack, buildMonthlyGovernancePack, clientScopeIdFor, type WeeklyClientPack, type MonthlyGovernancePack } from '@/lib/reports/clientPack'
import ClientPackView from './ClientPackView'
import FinanceReportDialog from './FinanceReportDialog'
import FirstRunCard from './FirstRunCard'
import SearchResults from './SearchResults'
import { searchWorkspace, type SearchHit } from '@/lib/search'
import { planSlaDates, slaReason } from '@/lib/sla'
import FilterBar from './FilterBar'
import TreeGrid from './TreeGrid'
import BoardView from './BoardView'
import CalendarView from './CalendarView'
import { loadStoredView, saveView, type WorkspaceView } from '@/lib/viewChoice'
import { applyBlueprint } from '@/lib/blueprint'
import type { RowActions } from './RowMenu'
import GanttChart from './GanttChart'
import DetailPanel, { type Tab as DetailTab } from './DetailPanel'
import Inbox from './Inbox'
import AuthNotice from './AuthNotice'
import SelectionToolbar from './SelectionToolbar'
import DetailDrawer from './DetailDrawer'
import AppSidebar from './AppSidebar'
import { unreadCount } from '@/lib/notifications'
import type { DialogState } from './Dialogs'
import type { AddEvidenceInput } from './EvidencePanel'
import type { ApplyOutcome } from './ChatPanel'

/*
 * Dynamically imported rather than bundled in with everything above.
 *
 * Every one of these is gated behind a boolean or a dialog-state check — never mounted on
 * first paint — and ConfigWorkspace alone is ~4,900 lines. Statically importing them put the
 * whole admin surface, every modal, and the timesheet/archive/chat panels into the one chunk
 * every visitor downloads before the tree even renders. `ssr: false` is correct as well as an
 * optimisation: nothing here can render before the interaction that opens it happens, so there
 * is no server-rendered markup for these to produce.
 */
const Dialogs = dynamic(() => import('./Dialogs'), { ssr: false })
const EvidencePanel = dynamic(() => import('./EvidencePanel'), { ssr: false })
const ChatPanel = dynamic(() => import('./ChatPanel'), { ssr: false })
const ConfigWorkspace = dynamic(() => import('./ConfigWorkspace'), { ssr: false })
const ArchivePanel = dynamic(() => import('./ArchivePanel'), { ssr: false })
const TimesheetPanel = dynamic(() => import('./TimesheetPanel'), { ssr: false })
const SlaPlanPanel = dynamic(() => import('./SlaPlanPanel'), { ssr: false })
const ProfilePanel = dynamic(() => import('./ProfilePanel'), { ssr: false })
import { useAutosave } from './useAutosave'
import {
  describeSave,
  describeSaveDetail,
  hasLocalWorkspace,
  loadWorkspaceLocally,
  saveWorkspaceLocally,
} from '@/lib/autosave'
import type { ConfigOp } from '@/lib/workspace'

/**
 * Views whose own content is the point, not a row list meant to be read alongside a record's
 * detail — opening a record here (`onOpen`) navigates away rather than pairing with a
 * selection, unlike Tree/Board/Calendar/My work/Portfolio/My calendar, which pass
 * `onSelect`/`onSelectWork`.
 *
 * Under the dock these views forced the pane compact; under the drawer they simply do not
 * show it. The selection itself is kept, exactly as it was then — switching to Timesheets and
 * back to the Tree reopens the record that was open, rather than silently forgetting it.
 */
const DETAIL_INCOMPATIBLE_VIEWS = new Set<WorkspaceView>(['timesheet', 'inbox', 'mail'])

interface Props {
  issues: SeedIssueInput[]
  relationships: IssueRelationship[]
  /** Supplied when a database served the workspace; null means the seed file did. */
  initialState: WorkspaceState | null
  persistence: { enabled: boolean; note: string; error?: string }
  /** Which engine the Assistant panel answers with, decided server-side from ANTHROPIC_API_KEY. */
  assistant: { engine: 'claude' | 'offline' }
  /** When the scheduled pass last ran (null: never), read from the database at page load. */
  pass: { lastRunAt: string | null; lastSummary: string | null }
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
  /** True when a provider is configured and nobody has signed in. */
  signInRequired?: boolean
  /** True only when an identity provider verified the actor. */
  verified?: boolean
  /**
   * The `auth_error` code the sign-in callback redirected with, when it refused.
   *
   * A code, never a message: the wording belongs to `AuthNotice`, because this value comes off
   * the URL and anything on the URL was written by whoever last edited it.
   */
  authError?: string
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
  assistant,
  pass,
  tenantId,
  actor,
  signInRequired,
  verified,
  authError,
  meta,
  today,
}: Props) {
  /* ---------------- workspace state ---------------- */
  const [state, setState] = useState<WorkspaceState>(
    () => initialState ?? initWorkspace(issues, relationships),
  )
  const [toasts, setToasts] = useState<{ id: number; msg: string; error: boolean }[]>([])
  const [dialog, setDialog] = useState<DialogState>(null)
  /** Issue whose evidence manager is open, if any. */
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null)
  /** Whether the archive drawer is open. */
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  /** Narrow-screen navigation overlay — a hamburger under 900px, a fixed rail above it. */
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [slaOpen, setSlaOpen] = useState(false)
  /** Which client pack is open for print, if any. */
  const [clientPack, setClientPack] = useState<{ kind: 'weekly' | 'monthly'; pack: WeeklyClientPack | MonthlyGovernancePack } | null>(null)
  const [financeReportOpen, setFinanceReportOpen] = useState(false)
  /** The directory person whose profile panel is open, if any. */
  const [openProfileId, setOpenProfileId] = useState<string | null>(null)
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

  /** The owner change awaiting a second press. See the owner case in the cell editor. */
  const pendingAssign = useRef<{ rowId: string; owner: string } | null>(null)
  /*
   * Stacked, not replaced: the old single slot meant a refusal could be overwritten by the
   * save confirmation that landed half a second later, and the person never saw why their
   * change did not stick. Each toast gets its own full duration; a burst is capped at four
   * so a batch of automation misses cannot wallpaper the screen.
   */
  const toastSeq = useRef(0)
  const toastTimers = useRef(new Map<number, number>())
  const notify = useCallback((msg: string, error = false) => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev.slice(-3), { id, msg, error }])
    toastTimers.current.set(
      id,
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
        toastTimers.current.delete(id)
      }, 4500),
    )
  }, [])
  useEffect(
    () => () => {
      for (const t of toastTimers.current.values()) window.clearTimeout(t)
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

  /**
   * Record what the person could see, so a stale write can be told from a fresh one.
   *
   * Done here rather than at each call site, because there are a dozen of them — the grid's
   * inline editors, the detail panel, the focus form, the assistant's applied proposals — and
   * the one that forgets is the one that silently overwrites a colleague. The values come from
   * the state the browser is rendering, which is precisely what the person was looking at when
   * they decided.
   *
   * Only for `updateIssue`, and only when nothing has stamped it already: an automation rule
   * has nothing to be stale against, having acted on what it observed a moment earlier.
   */
  const withExpectation = useCallback(
    (action: Action, from: WorkspaceState): Action => {
      if (action.t !== 'updateIssue' || action.expected) return action
      const current = from.issues[action.id]
      if (!current) return action
      const expected: Record<string, unknown> = {}
      for (const key of Object.keys(action.patch)) {
        expected[key] = (current as unknown as Record<string, unknown>)[key]
      }
      return { ...action, expected: expected as Partial<IssueRecord> }
    },
    [],
  )

  /** Single funnel for every mutation, so validation and audit are never bypassed. */
  const dispatch = useCallback(
    (action: Action): boolean => {
      // Through the same runner as a batch. Almost everything dispatched singly — a note, a
      // time entry, an approval, an allocation — is exactly what the rules react to, and
      // running them only on batches meant the server planned follow-ups the browser had not:
      // the ids diverged and the notification did not appear until a reload.
      const stamped = withExpectation(action, state)
      const res = applyWithRules(state, stamped, actor)
      if (res.error) {
        notify(res.error, true)
        return false
      }
      setState(res.state)
      if (res.createdId) setSelectedId(res.createdId)
      if (res.message) notify(res.message)
      persist(stamped)
      return true
    },
    [state, notify, persist, actor, withExpectation],
  )

  /**
   * Store a file, then bring the record it produced into this browser's copy.
   *
   * The one write in the application that does NOT go through `dispatch`, and it is worth being
   * explicit about why rather than letting it look like an oversight.
   *
   * `dispatch` applies an action locally and queues the same action to `/api/workspace`. That
   * shape depends on the action being replayable — the server reaching the same answer from the
   * same input. An upload is not: the input is 25 MB of bytes, the store assigns a locator that
   * only exists once the bytes are written, and replaying it would store the file twice.
   *
   * So the server does it once, and hands back the record. What lands here is therefore not
   * optimistic — it already happened — which is also why a failure is returned as a sentence for
   * the panel to show rather than raised as a toast: the person is looking at the file they
   * chose, and that is where the answer belongs.
   */
  const uploadDocument = useCallback(
    async (
      file: File,
      subjectKind: 'issue' | 'sow' | 'node' | 'change',
      subjectId: string,
      evidenceId: string | null,
      /** A new version of an existing document — the reducer validates the chain. */
      supersedesId?: string,
    ): Promise<{ document: DocumentRecord } | { error: string }> => {
      const form = new FormData()
      form.append('file', file)
      form.append('subjectKind', subjectKind)
      form.append('subjectId', subjectId)
      form.append('note', '')
      if (evidenceId) form.append('evidenceId', evidenceId)
      if (supersedesId) form.append('supersedesId', supersedesId)

      let res: Response
      try {
        res = await fetch('/api/documents', { method: 'POST', body: form })
      } catch {
        return { error: 'The file could not be sent. Check the connection and try again — nothing has been stored.' }
      }
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; document?: DocumentRecord; evidenceId?: string | null }
        | null

      if (!res.ok || !body?.ok || !body.document?.id) {
        return { error: body?.error ?? `The file could not be stored (${res.status}).` }
      }

      /*
       * Merged straight into state rather than replayed through the reducer. The reducer has
       * already run — on the server, over the real locator — and running it again here would
       * mint a second id from this browser's counter and queue a duplicate write.
       */
      const doc = body.document
      setState((s) => ({
        ...s,
        documents: { ...s.documents, [doc.id]: doc },
        evidence:
          body.evidenceId && s.evidence[body.evidenceId]
            ? {
                ...s.evidence,
                [body.evidenceId]: { ...s.evidence[body.evidenceId], documentId: doc.id },
              }
            : s.evidence,
      }))
      notify(`${doc.name} stored.`)
      return { document: doc }
    },
    [notify],
  )

  /**
   * An image pasted, dropped or inserted into a rich-text description or note — the same
   * `uploadDocument` path `EvidencePanel` uses, so an embedded image stays visible in the
   * issue's own Documents list too, rather than living in a second, editor-only store nothing
   * else can see. Unlike evidence, an inline image is never itself the evidence for something
   * (`evidenceId: null`), and it can never supersede an earlier version.
   */
  const uploadInlineImage = useCallback(
    async (issueId: string, file: File): Promise<{ documentId: string; alt: string } | null> => {
      const res = await uploadDocument(file, 'issue', issueId, null)
      if ('error' in res) {
        notify(res.error)
        return null
      }
      return { documentId: res.document.id, alt: res.document.name }
    },
    [uploadDocument, notify],
  )

  /**
   * A client reply the server has already sent and recorded.
   *
   * Merged like an uploaded document, and for the same reason: the write happened server-side
   * — the mail went out, the note was persisted with the server's own id — so replaying it
   * through `dispatch` would mint a second id here and queue a duplicate write. The seq is
   * pulled forward to the note's own so a note added next in this browser cannot locally
   * reuse the id the server just spent.
   */
  const mailSent = useCallback((note: IssueNote) => {
    const noteSeq = Number(note.id.replace(/^note-/, ''))
    setState((s) => {
      /*
       * A note typed here moments ago may have minted this very id locally while its action
       * still sits in the save queue — the server, unaware, spent the same number on the mail
       * note. Overwriting would make the typed note vanish from the screen it was written on.
       * Skip the merge instead: the mail note is durably stored and appears on reload, which
       * is the reconciliation this workspace already lives with when ids diverge.
       */
      if (s.notes[note.id]) return s
      return {
        ...s,
        notes: { ...s.notes, [note.id]: note },
        issues: s.issues[note.issueId]
          ? {
              ...s.issues,
              [note.issueId]: { ...s.issues[note.issueId], lastActivity: note.createdAt.slice(0, 10) },
            }
          : s.issues,
        seq: Number.isFinite(noteSeq) ? Math.max(s.seq, noteSeq) : s.seq,
      }
    })
  }, [])

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
      /** What is actually sent: the stamped actions, not the ones handed in. */
      const sent: Action[] = []
      for (const action of actions) {
        /**
         * Rules run here as well as on the server, and that is deliberate rather than
         * duplicated work: both funnels plan from the same state with the same clock, so both
         * reach the same follow-up actions and mint the same ids. It is what lets a
         * notification appear the moment somebody reassigns an issue while the queue still
         * sends nothing but the reassignment.
         */
        // Stamped against `cur` rather than the batch's starting state: within one batch the
        // earlier actions are this person's own, and treating their effects as somebody else's
        // change would make a two-action save conflict with itself.
        const stamped = withExpectation(action, cur)
        sent.push(stamped)
        const res = applyWithRules(cur, stamped, actor)
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
      for (const miss of missed) notify(miss, true)
      setState(cur)
      if (createdId) setSelectedId(createdId)
      if (message) notify(message)
      // Queued as one batch, in the order they were folded, so the server replays them the
      // way the client did. Each is validated again there; a batch that only half-applies
      // reports which action failed rather than being papered over.
      autosave.enqueueAll(sent)
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
   *
   * Reports whether the selection actually moved, so a caller that was going to do something
   * *to* the newly selected row — the row menu's Log time opens the Time tab on it — does not
   * do it to the row the person chose to stay on.
   */
  /* ---------------- global search (docs/plans/2026-08-30-global-search-design.md) ----------------
   * The box's row-filtering path (`filters.search` → matchesFilters) is untouched: the
   * dropdown is purely additive, computed over the SAME already-redacted boot state, so it
   * can only ever show what this reader may see (GS1 pins the composition). The query is
   * deferred so the grid keeps narrowing at full keystroke speed while the scan lags a paint
   * behind at worst. */
  const [searchFocus, setSearchFocus] = useState(false)
  const [searchActive, setSearchActive] = useState(0)
  const deferredSearch = useDeferredValue(filters.search)
  const searchHits = useMemo(
    () => (deferredSearch.trim().length >= 2 ? searchWorkspace(state, deferredSearch, today) : []),
    [state, deferredSearch, today],
  )
  const searchOpen = searchFocus && filters.search.trim().length >= 2
  useEffect(() => setSearchActive(0), [deferredSearch])

  const requestSelect = useCallback(
    (id: string | null): boolean => {
      if (dirty && id !== selectedId) {
        const go = window.confirm(
          'This issue has unsaved changes. Leaving it will discard them.\n\nLeave anyway?',
        )
        if (!go) return false
        setDirty(false)
      }
      setSelectedId(id)
      return true
    },
    [dirty, selectedId],
  )

  /** Open a search hit's anchor through the SAME dirty-checking gate every row click uses. */
  const openSearchHit = useCallback(
    (hit: SearchHit) => {
      if (!hit.anchorId) return
      if (requestSelect(hit.anchorId)) setSearchFocus(false)
    },
    [requestSelect],
  )

  /**
   * A detail-pane tab the workspace has asked for, cleared as soon as the pane has taken it.
   *
   * Set by the row menu's Log time, which opens the Time tab on the issue rather than growing
   * a second time-entry form: the one on that tab already defaults to today and to the person
   * using it, and two forms writing `addTime` would be two sets of rules about the same hours.
   */
  const [requestTab, setRequestTab] = useState<DetailTab | null>(null)

  /**
   * Set alongside `revealIssue` by Row-menu/toolbar "Edit" — DetailPanel's own `editing` is
   * local state it does not otherwise expose, so this is how a click outside the panel puts it
   * straight into edit mode instead of merely opening it. Mirrors `requestTab` above exactly.
   */
  const [requestEdit, setRequestEdit] = useState<string | null>(null)

  const [zoom, setZoom] = useState<ZoomLevel>('Week')
  const [view, setViewState] = useState<WorkspaceView>('tree')
  useEffect(() => {
    const stored = loadStoredView()
    if (stored) {
      setViewState(stored)
      return
    }
    // No stored choice: land on what needs you, if anything does. The tree stays the
    // default for an empty queue — structure beats an empty list. Deliberately once, on
    // mount — a landing rule that kept re-firing would yank the view away mid-session.
    if (myWork(state, actor, today).items.length > 0) setViewState('mywork')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setView = useCallback((v: WorkspaceView) => { setViewState(v); saveView(v) }, [])
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
  // Clamped to the viewport on mount: 760px of tree on a 1000px window left the Gantt a
  // sliver, and nothing else ever corrected the initial guess. The drag already clamps.
  useEffect(() => {
    setTreeWidth((w) => Math.min(w, Math.max(320, Math.floor(window.innerWidth * 0.55))))
  }, [])

  /* ---------------- detail drawer ---------------- */
  const [viewportH, setViewportH] = useState(900)

  /* ---------------- derived tree ---------------- */
  const allRows = useMemo(() => buildTree(state, today), [state, today])
  /*
   * The badge count. Computed here rather than inside the panel because the toolbar needs it
   * whether or not the panel is open — a queue whose size is only visible once you open it is a
   * queue nobody opens.
   */
  const myWorkCount = useMemo(() => myWork(state, actor, today).items.length, [state, actor, today])
  /** The retired toolbar bell's number, now the sidebar Notifications badge. */
  const notificationsUnread = useMemo(
    () => unreadCount(state.notifications, actor.name, directoryPersonFor(state.model, actor)?.id ?? null),
    [state.notifications, state.model, actor],
  )

  const sortedRows = useMemo(
    () => (sort ? sortTree(allRows, COLUMNS.find((c) => c.key === sort.key), sort.dir) : allRows),
    [allRows, sort],
  )

  const rows = useMemo(
    () => visibleRows(sortedRows, filters, collapsed, externalPartyKinds(tiersOf(state.model))),
    [sortedRows, filters, collapsed, state.model],
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
  /** A section the Configuration dialog should open on — the blueprint row-menu entry. */
  const [configIntent, setConfigIntent] = useState<{ tab: 'blueprints'; source: string } | null>(null)

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
      // The same unsaved-work guard every selection path must pass. A notification click or
      // a My-work row used to bypass it with a raw setSelectedId, silently discarding a
      // half-edited form or a typed client reply.
      if (!requestSelect(id)) return
      // Revealing means SEEING: from a view that pairs with no record detail (Timesheets,
      // Notifications, Mail — the main path since the toolbar bell retired into the
      // Notifications view), hop to the tree, where the revealed row and its drawer live.
      if (DETAIL_INCOMPATIBLE_VIEWS.has(view)) setView('tree')
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
      setRevealTarget(id)
    },
    [allRows, filters, notify, requestSelect, view, setView],
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
          // p.patch is Record<string, string> (the assistant only ever proposes plain text) —
          // wrap description explicitly rather than casting the whole object, so a plain string
          // can never reach the RichDoc column silently. The `as` on the rest is unavoidable
          // (the assistant's patch is a loose string bag validated against IssueRecord's other
          // fields upstream in lib/chat.ts, not re-derivable here), but description gets no cast.
          const { description, ...rest } = p.patch
          const patch: Partial<IssueRecord> = {
            ...(rest as Partial<IssueRecord>),
            ...(description !== undefined ? { description: wrapPlainText(description) } : {}),
          }
          actions.push({ t: 'updateIssue', id: p.id, patch, now })
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
   *
   * `reason` is supplied for status alone, and is required there — see the case below.
   */
  const commitCell = useCallback(
    (rowId: string, colKey: string, raw: string, reason?: string): boolean => {
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
          if (isIssue) {
            /**
             * Ask before the reducer refuses, so the refusal has a way through.
             *
             * The reducer declines to name an owner who is away for the whole window, and its
             * message says to assign anyway if that is the decision — but `acceptUnavailable`
             * is the only way to say so, and nothing could set it. A veto with no override is
             * worse than no veto: it does not prevent the assignment, it prevents the person
             * recording what they have already decided, and they route around the system.
             *
             * Confirmed by repeating rather than by a dialog, because this app has no modal and
             * a browser `confirm()` blocks everything. The same pure function the reducer uses
             * decides, so the two cannot drift into disagreeing about who is available.
             */
            const owner = value || 'Unassigned'
            const issue = state.issues[rowId]
            const verdict = issue
              ? availabilityForAssignment(state, issue, owner, now)
              : null
            if (verdict && refusesAssignment(verdict)) {
              const again = pendingAssign.current
              if (!again || again.rowId !== rowId || again.owner !== owner) {
                pendingAssign.current = { rowId, owner }
                notify(`${verdict.message} Set the same owner again to assign anyway — it will be recorded as a decision.`, true)
                return false
              }
              pendingAssign.current = null
              return dispatch({
                t: 'updateIssue', id: rowId, patch: { owner }, now, acceptUnavailable: true,
              })
            }
            pendingAssign.current = null
            return dispatch({ t: 'updateIssue', id: rowId, patch: { owner }, now })
          }
          if (act)
            return dispatch({ t: 'updateActivity', id: rowId, patch: { owner: value || 'Unassigned' }, now })
          return false
        }

        /**
         * A status change carries a reason, and the check is here rather than only in the
         * editor that collects it.
         *
         * The popover disables its own Save until something has been typed, which is the
         * courteous half. This is the half that holds: `commitCell` is the funnel every inline
         * edit passes through, so a caller that forgot — a later screen, a keyboard path
         * nobody thought about — is refused rather than quietly writing a status change with
         * nothing behind it. Nothing is dispatched with an empty reason, because the reducer
         * stamps it onto the audit entry and a blank one there reads as an answered question.
         */
        case 'status': {
          const why = reason?.trim()
          if (!why) {
            notify(
              'A status change needs a short reason — it is what this record is read for later.',
              true,
            )
            return false
          }
          return dispatch({
            t: 'updateIssue',
            id: rowId,
            patch: { status: value as never },
            now,
            reason: why,
          })
        }

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

  /* ---------------- row verbs, shared by the toolbar and the ⋮ menu ---------------- */

  /**
   * One implementation of each verb, for both surfaces that offer it.
   *
   * `SelectionToolbar` reaches these through its own props — one-line adapters that supply the
   * selected row — and `TreeGrid` hands the object straight to the `⋮` menu. That is the whole
   * arrangement: "Add a child" is one function, called from two places, so the toolbar and the
   * row menu cannot drift into doing different things under the same word. Copying the
   * handlers into the grid would have been half a day shorter and is precisely the failure
   * being avoided — two paths that agree on the day they are written and not afterwards.
   *
   * Nothing here selects the row first. The menu is opened *on* a row and every verb is told
   * which one, so acting on it does not have to disturb a selection somebody set deliberately.
   * The two that are about the selection — Schedule, and Log time's detail pane — say so.
   */
  const rowActions = useMemo<RowActions>(
    () => ({
      childKinds: (row) => createMenuFor(row.kind, tiersOf(state.model)),
      /**
       * A sibling is the same `create` arm with the parent of the selection, so what may be
       * created beside a row is whatever may be created under its parent — read off the parent
       * row rather than recomputed, so the two menus cannot disagree.
       */
      siblingKinds: (row) => {
        if (!row.parentId) return []
        const parent = sortedRows.find((r) => r.id === row.parentId)
        return parent ? createMenuFor(parent.kind, tiersOf(state.model)) : []
      },
      addChild: (row, kind) => setDialog({ t: 'add', parentId: row.id, kind }),
      addSibling: (row, kind) => {
        if (!row.parentId) return
        setDialog({ t: 'add', parentId: row.parentId, kind })
      },
      // An issue opens the canonical detail panel, straight into edit mode — everything else
      // (a hierarchy node) still goes through the Dialogs form, unchanged.
      edit: (row) => {
        if (row.kind !== 'issue') {
          setDialog({ t: 'edit', id: row.id })
          return
        }
        if (requestSelect(row.id)) setRequestEdit(row.id)
      },
      move: (row) => setDialog({ t: 'move', id: row.id }),
      link: (row) => setDialog({ t: 'link', issueId: row.id }),
      archive: (row) => setDialog({ t: 'delete', id: row.id }),
      saveBlueprint: (row) => {
        setConfigIntent({ tab: 'blueprints', source: row.id })
        setConfigOpen(true)
      },
      /**
       * Duplicate mints the copy AND the `DUPLICATE_OF` back to the original — that is the
       * arm's own guarantee (design §5), not something this menu arranges, which is why there
       * is no relationship type to choose here and no way to skip it.
       *
       * `note` is the note carried on that relationship, and the arm states plainly that an
       * empty one is legitimate. It is not a reason for anything, so an empty string here is
       * not a blank standing in for an answer.
       */
      duplicate: (row) =>
        dispatch({ t: 'duplicate', issueId: row.id, note: '', now: new Date().toISOString() }),
      logTime: (row) => {
        // Activities report under their issue; hours belong to the issue either way.
        const issueId = row.kind === 'issue' ? row.id : (row.parentId ?? '')
        if (!state.issues[issueId]) {
          notify('Time is recorded against an issue.', true)
          return
        }
        if (requestSelect(issueId)) setRequestTab('Time')
      },
      /**
       * Schedule is a *view* verb: it selects the row, which is what the timeline highlights,
       * and brings its window into sight. Selecting a bar that sits three months off the left
       * edge looks exactly like nothing having happened.
       */
      schedule: (row) => {
        if (!requestSelect(row.id)) return
        const start = row.plannedStartDate ?? row.actualStartDate
        const g = ganttBodyRef.current
        if (g && start) g.scrollLeft = Math.max(0, scale.x(start) - g.clientWidth / 3)
      },
      convertTypes: (row) => {
        const issue = state.issues[row.id]
        if (!issue) return []
        return liveWorkTypes(state.model)
          .map((t) => t.label)
          .filter((label) => label !== issue.type)
      },
      // The existing `updateIssue` arm, so a reclassification is audited field-by-field like
      // any other change rather than being a second way to write the same record.
      convert: (row, type) =>
        dispatch({ t: 'updateIssue', id: row.id, patch: { type }, now: new Date().toISOString() }),
    }),
    [sortedRows, state, dispatch, notify, requestSelect, scale],
  )

  /* ---------------- dialog submission ---------------- */
  const submitDialog = useCallback(
    (p: Record<string, string>) => {
      const now = new Date().toISOString()
      if (!dialog) return
      let ok = false

      if (dialog.t === 'add') {
        // The focus form may have re-picked the parent; the reducer's canParent rule still
        // validates it. Dropped from the draft so it does not ride into the record's fields.
        const parentId = p.parentId || dialog.parentId
        const draft = { ...p }
        delete draft.parentId
        const blueprintId = draft.blueprintId
        delete draft.blueprintId
        const bp = blueprintId ? state.model.blueprints[blueprintId] : undefined
        if (dialog.kind === 'engagement' && bp) {
          /*
           * Create-and-apply as ONE batch. The blueprint is planned against a simulation of
           * the create (apply is pure), so the plan's ids match what the batch will mint;
           * the batch then folds the create, every step, and the provenance record
           * atomically — a refusal anywhere leaves nothing half-built.
           */
          const createAction = { t: 'create', parentId, kind: dialog.kind, draft, now } as Action
          const sim = applyWithRules(state, createAction, actor)
          if (!sim.error && sim.createdId) {
            const anchor = now.slice(0, 10)
            const run = applyBlueprint(sim.state, bp, sim.createdId, anchor, actor, new Set(bp.entries.map((e) => e.id)), now)
            const batch: Action[] = [createAction, ...run.steps.map((st) => st.action)]
            batch.push({
              t: 'config',
              op: {
                k: 'upsertBlueprint',
                id: bp.id,
                patch: {
                  applications: [
                    ...bp.applications,
                    { at: now, by: actor.name, targetId: sim.createdId, version: bp.version },
                  ],
                },
              },
              now,
            } as Action)
            const res = dispatchMany(batch)
            ok = res.ok
            if (res.ok) {
              notify(
                `${bp.name} applied — ${run.steps.length} steps${run.refusals.length ? `, ${run.refusals.length} skipped` : ''}.`,
              )
              if (res.state && sim.createdId) revealIssue(sim.createdId, buildTree(res.state, today))
            }
          } else {
            ok = dispatch(createAction)
          }
        } else {
          ok = dispatch({ t: 'create', parentId, kind: dialog.kind, draft, now })
        }
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
              description: wrapPlainText(p.description),
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
            /*
             * Carried, not dropped. The form only sets this when the configured policy asks for
             * it on the status being moved to; without it the reducer refused every move to a
             * `requireReason` status, and the message named a field the form had no box for.
             */
            reason: p.reason || undefined,
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
    [dialog, dispatch, dispatchMany, notify, revealIssue, state, selectedId, actor, today],
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
   * Default parent for "+ New Issue" when nothing is selected. An external party's node is a
   * predictable landing place; dropping the issue into whichever process area happened to be
   * created first would be arbitrary. Falls back to the coarsest non-root tier for a chain
   * with no externalParty tier at all — a flat internal org still needs a default, and the
   * root is the one place an issue may not sit. The Add dialog names the parent either way.
   */
  const defaultParentId = useMemo(() => {
    const tiers = tiersOf(state.model)
    const external = externalPartyKinds(tiers)
    const live = Object.values(state.nodes).filter((n) => !n.deletedAt)
    const externalNode = live.find((n) => external.has(n.kind))
    if (externalNode) return externalNode.id
    const secondTier = tiers[1]?.kind
    return (secondTier && live.find((n) => n.kind === secondTier)?.id) ?? null
  }, [state.nodes, state.model])

  /* ---------------- detail drawer sizing ---------------- */

  const shellRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const measure = () => setViewportH(window.innerHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  /** Whether the current view pairs with the detail drawer at all. */
  const drawerOffered = !DETAIL_INCOMPATIBLE_VIEWS.has(view)
  const [drawerWide, setDrawerWide] = useState(false)

  /**
   * DetailPanel's dock-era size verbs, mapped onto the drawer. Collapse means close — routed
   * through the same dirty-checking gate every deselection passes, so DetailPanel's own
   * Escape listener and its ▼ button both reach the unsaved-changes confirm. Expand widens
   * the drawer instead of growing a dock that no longer exists.
   */
  const drawerSetPanel = useCallback(
    (next: PanelState) => {
      if (next === 'compact') requestSelect(null)
      else setDrawerWide(next === 'expanded')
    },
    [requestSelect],
  )

  /**
   * Create an issue from wherever the person is. Selection-independent: the parent is
   * pre-filled from the selected scope, the selected issue's own scope, or the first client —
   * and stays changeable in the form. Lives on the top bar (the one global primary action)
   * AND on the drawer's toolbar via SelectionToolbar, both through this single handler.
   */
  const newIssue = useCallback(() => {
    const sel = selected
    const fromSelection =
      sel && state.nodes[sel.id] && canParent('issue', state.nodes[sel.id].kind)
        ? sel.id
        : sel && state.issues[sel.id]
          ? state.issues[sel.id].parentId
          : null
    const parent = fromSelection ?? defaultParentId
    if (parent) setDialog({ t: 'add', parentId: parent, kind: 'issue' })
    else notify('Create a client first.', true)
  }, [selected, state.nodes, state.issues, defaultParentId, notify])

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
      if (e.key === 'Escape' && dialog) {
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
  }, [dialog])

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
    download(`daily-ims-${today}.txt`, renderImsText(report, state.model.organization.name), 'text/plain')
    download(`daily-ims-${today}.csv`, renderImsCsv(report), 'text/csv')
    notify(
      `Daily IMS exported — ${report.position.open} open of ${report.position.total}, ${report.sections.length} section(s) needing attention.`,
    )
  }, [state, sortedRows, filters, today, scopeLabel, download, notify])

  /**
   * A client pack is for exactly one client — the same precondition `clientView` itself has —
   * so this refuses before building anything when the screen isn't scoped to one, rather than
   * silently picking a client or building against an ambiguous filter.
   */
  const openClientPack = useCallback(
    (kind: 'weekly' | 'monthly') => {
      if (filters.client === 'All') {
        notify('Pick one client first — a client pack is for a single client, not the whole workspace.', true)
        return
      }
      const scopeId = clientScopeIdFor(state, filters.client)
      if (!scopeId) {
        notify(`No client scope found for "${filters.client}".`, true)
        return
      }
      const pack =
        kind === 'weekly'
          ? buildWeeklyClientPack(state, scopeId, today)
          : buildMonthlyGovernancePack(state, scopeId, today)
      setClientPack({ kind, pack })
    },
    [state, filters.client, today, notify],
  )

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
        {/* Narrow screens only (CSS): the rail collapses behind this. */}
        <button
          className="btn ghost nav-burger"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-expanded={sidebarOpen}
          aria-label="Open navigation"
        >
          ☰
        </button>
        <span className="wordmark">
          axiomate<i>.</i>
        </span>
        {/* The firm's name and the page title used to sit here. Both were removed from the
            header deliberately: the firm is the one running the product and does not need
            telling, and the tree itself is the page — labelling it competes with the row that
            is actually selected. The organisation name is still configured and still used
            wherever it disambiguates, such as the filter summary for "All clients". */}

        <div className="search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            role="combobox"
            aria-expanded={searchOpen}
            aria-controls="gs-results"
            aria-haspopup="listbox"
            placeholder="Search issue ID, subject, owner, next action…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            onKeyDown={(e) => {
              if (!searchOpen) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSearchActive((i) => Math.min(i + 1, searchHits.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSearchActive((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                const hit = searchHits[searchActive]
                if (hit?.anchorId) openSearchHit(hit)
              } else if (e.key === 'Escape') {
                setSearchFocus(false)
              }
            }}
          />
          {searchOpen && (
            <SearchResults
              hits={searchHits}
              activeIndex={searchActive}
              onOpen={openSearchHit}
              onHover={setSearchActive}
            />
          )}
        </div>

        {/* The bell retired with the clean shell: its unread count lives on the sidebar's
            Notifications entry, and the full surface — the same routing included — is the
            Notifications view itself. One place, not a dropdown twin of it. */}

        <span className="grow" />
        {/* The one global primary action. It lived on the dock's toolbar; the dock is gone,
            and creating an issue was never about the selection anyway — the handler pre-fills
            the parent from wherever the person is and the form lets them change it. */}
        <button className="btn primary" onClick={newIssue}>
          + New Issue
        </button>
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
        {/* My week and the saved views both moved into the sidebar — navigation lives on the
            rail; this row keeps only actions. */}
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
                  openClientPack('weekly')
                }}
              >
                Weekly client pack
                <span className="menu-sub">Print-ready — client-safe records only</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportMenu(false)
                  openClientPack('monthly')
                }}
              >
                Monthly governance pack
                <span className="menu-sub">Print-ready — a rollup, not a row list</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportMenu(false)
                  setFinanceReportOpen(true)
                }}
              >
                Finance timesheet…
                <span className="menu-sub">Approved hours for a period — .xlsx or PDF, no rates</span>
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
        {/* Configuration moved to the sidebar's foot — it is a place, and places live on
            the rail. */}
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
        <UserMenu
          actor={actor}
          verified={Boolean(verified)}
          signInRequired={Boolean(signInRequired)}
          myProfileId={directoryPersonFor(state.model, actor)?.id ?? null}
          onOpenProfile={setOpenProfileId}
        />
      </div>

      {/* Below the topbar rather than over the grid, because it is about this page and not
          about a record — and directly under the Sign in button it is telling people to press
          again. Not shown to a verified session: a signed-in workspace reporting that the
          sign-in failed would be contradicting itself, and a stale `?auth_error=` on a
          bookmarked or forwarded address is enough to produce exactly that. */}
      {!verified && <AuthNotice code={authError} />}

      {/* The clean shell's two regions under the one top bar: the navigation rail, then
          everything the chosen view renders. */}
      <div className="shell">
      <AppSidebar
        view={view}
        setView={setView}
        myWorkCount={myWorkCount}
        timesheetQueue={
          can(state.model, actor, 'time.approve').allowed
            ? Object.values(state.timesheets).filter((t) => t.status === 'Submitted').length
            : null
        }
        notificationsUnread={notificationsUnread}
        savedViews={state.model.savedViews}
        onApplySavedView={(v) => {
          setFilters(v.filters)
          setView(v.view)
        }}
        onDeleteSavedView={(id) =>
          dispatch({ t: 'deleteSavedView', id, now: new Date().toISOString() })
        }
        onSaveCurrentView={(name) =>
          dispatch({
            t: 'upsertSavedView',
            view: { name, filters, view },
            now: new Date().toISOString(),
          })
        }
        onOpenConfig={() => setConfigOpen(true)}
        archivedCount={archivedCount}
        onOpenArchive={() => setArchiveOpen(true)}
        open={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
      />
      <div className="main">

      <FilterBar
        actor={actor}
        model={state.model}
        filters={filters}
        setFilters={setFilters}
        facets={facets}
        zoom={zoom}
        setZoom={setZoom}
        view={view}
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
        slaCandidates={slaPlan.rows.length}
        onPlanSla={() => setSlaOpen(true)}
      />

      {view === 'mywork' ? (
        <>
          <FirstRunCard state={state} actor={actor} />
          <MyWorkPanel state={state} actor={actor} today={today} onSelect={revealIssue} docked />
        </>
      ) : view === 'portfolio' ? (
        <PortfolioPanel state={state} today={today} onSelect={revealIssue} docked />
      ) : view === 'calendar' ? (
        <CalendarView rows={rows} today={today} selectedId={selectedId} onSelect={requestSelect} />
      ) : view === 'board' ? (
        <BoardView
          rows={rows}
          policy={state.model.statusPolicy}
          hasEvidence={(id) =>
            Object.values(state.evidence).some((e) => e.issueId === id && !e.deletedAt)
          }
          selectedId={selectedId}
          onSelect={requestSelect}
          onCommitStatus={(rowId, status, reason) => commitCell(rowId, 'status', status, reason)}
        />
      ) : view === 'timesheet' ? (
        <TimesheetPanel
          state={state}
          actor={actor}
          today={today}
          onSubmitWeek={(person, week) =>
            dispatch({ t: 'submitTimesheet', person, weekStarting: week, now: new Date().toISOString() })
          }
          onDecideWeek={(id, decision, reason) =>
            dispatch({ t: 'decideTimesheet', id, decision, reason, now: new Date().toISOString() })
          }
          onDecideMany={(ids) => {
            const now = new Date().toISOString()
            dispatchMany(ids.map((tid) => ({ t: 'decideTimesheet', id: tid, decision: 'approved', now }) as Action))
          }}
          onDecideLeave={(id, decision, note) =>
            dispatch({ t: 'decideLeave', id, decision, note, now: new Date().toISOString() })
          }
          onOpen={(issueId) => {
            revealIssue(issueId)
            setRequestTab('Time' as DetailTab)
          }}
          onClose={() => {}}
          docked
        />
      ) : view === 'inbox' ? (
        <Inbox
          state={state}
          actor={actor}
          onRead={(id) => dispatch({ t: 'markNotificationRead', id, now: new Date().toISOString() })}
          onSetPref={(personId, kind, mode) =>
            dispatch({ t: 'setNotificationPref', personId, kind, mode, now: new Date().toISOString() })
          }
          onReadAll={(ids) => {
            const now = new Date().toISOString()
            dispatchMany(ids.map((nid) => ({ t: 'markNotificationRead', id: nid, now }) as Action))
          }}
          onOpen={(issueId, n) => {
            // The bell's old routing, now the only mount of it: approval traffic goes to its surface,
            // a discussion click to its scope's Discussion tab (issue or project row alike),
            // a meeting to My calendar.
            if (n.ruleId.startsWith('meeting-')) { setView('mycalendar'); return }
            if (n.ruleId === 'leave-decided') { setView('mycalendar'); return }
            if (n.ruleId === 'leave-requested' || n.ruleId === 'timesheet-submitted' || n.ruleId === 'timesheet-decided') {
              setView('timesheet')
              return
            }
            if (n.ruleId === 'discussion-message') {
              revealIssue(n.aboutId)
              setRequestTab('Discussion' as DetailTab)
              return
            }
            revealIssue(issueId)
            const tab =
              n.ruleId === 'assignment'
                ? 'Overview'
                : /timesheet|hours|\btime\b/i.test(`${n.subject} ${n.ruleId}`)
                  ? 'Time'
                  : /note|mail|reply/i.test(`${n.subject} ${n.ruleId}`)
                    ? 'Notes'
                    : null
            if (tab) setRequestTab(tab as DetailTab)
          }}
          docked
        />
      ) : view === 'mycalendar' ? (
        <MyCalendarPanel
          state={state}
          actor={actor}
          today={today}
          onAdd={(input) => dispatch({ t: 'addPersonalEvent', ...input, now: new Date().toISOString() })}
          onUpdate={(id, patch) =>
            dispatch({ t: 'updatePersonalEvent', id, patch, now: new Date().toISOString() })
          }
          onRemove={(id) => dispatch({ t: 'removePersonalEvent', id, now: new Date().toISOString() })}
          onSelectWork={revealIssue}
          onRequestLeave={(input) =>
            dispatch({
              t: 'upsertCommitment', id: null, person: actor.name, kind: 'Leave',
              startDate: input.startDate, endDate: input.endDate, hoursPerDay: input.hoursPerDay,
              note: input.note, reason: input.reason, now: new Date().toISOString(),
            })
          }
          onUpdateLeave={(id, input) =>
            dispatch({
              t: 'upsertCommitment', id, person: actor.name, kind: 'Leave',
              startDate: input.startDate, endDate: input.endDate, hoursPerDay: input.hoursPerDay,
              note: input.note, reason: input.reason, now: new Date().toISOString(),
            })
          }
          onWithdrawLeave={(id) => dispatch({ t: 'removeCommitment', id, now: new Date().toISOString() })}
          onUpsertMeeting={(id, input) =>
            dispatch({
              t: 'upsertMeeting', id, title: input.title, startAt: input.startAt, endAt: input.endAt,
              attendeeIds: input.attendeeIds, note: input.note, now: new Date().toISOString(),
            })
          }
          onCancelMeeting={(id) => dispatch({ t: 'cancelMeeting', id, now: new Date().toISOString() })}
        />
      ) : view === 'mail' ? (
        <MailLog state={state} />
      ) : (
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
          actions={rowActions}
          />
        </div>

        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- resize is a pointer comfort affordance; every pane's content stays keyboard-reachable at any width */}
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
      )}

      </div>
      </div>

      {/* The record detail, in a right-hand overlay drawer. Open exactly when a record is
          selected on a view that pairs with one; closing goes through requestSelect(null),
          the same dirty-checking gate as every row switch. The selected row's verbs ride
          along at the top — beside the record they act on. */}
      {selectedId !== null && drawerOffered && (
      <DetailDrawer wide={drawerWide} onClose={() => requestSelect(null)}>
      <div className="context-bar">
        <SelectionToolbar
          row={selected}
          hasLifecycle={selected?.kind === 'issue' ? hasLifecycle(selected.id) : false}
          onAdd={(kind: CreatableKind) => selected && rowActions.addChild(selected, kind)}
          onEdit={() => selected && rowActions.edit(selected)}
          onMove={() => selected && rowActions.move(selected)}
          onLink={() => selected && rowActions.link(selected)}
          onDependency={() => selected && setDialog({ t: 'dependency', activityId: selected.id })}
          onMarkComplete={markComplete}
          onDelete={() => selected && rowActions.archive(selected)}
          onBuildLifecycle={() => selected && toggleLifecycle(selected.id)}
          onNewIssue={newIssue}
        />
      </div>

      {/* Everything below is about ONE record, so it uses that record's terminology rather
          than the organisation's. Nested provider, nearest wins — same rule as the resolver. */}
      <LabelProvider value={scopedLabels}>
      <DetailPanel
        assistSuggest={
          assistantOffered !== 'off' && (assistantAutonomy === 'propose' || assistantAutonomy === 'act')
            ? {
                index: chatIndex,
                config: {
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
                  modelId: state.model.agents['AGENT_WORKSPACE_ASSISTANT']?.modelId,
                },
                modelId: state.model.agents['AGENT_WORKSPACE_ASSISTANT']?.modelId,
                onApply: applyProposal,
              }
            : undefined
        }
          row={selected}
          allRows={sortedRows}
          relationships={state.relationships}
          dependencies={state.dependencies}
          crp={crp}
          audit={state.audit}
          height={viewportH}
          panelState={drawerWide ? 'expanded' : 'standard'}
          panelLocked={false}
          onResize={() => {}}
          onSetPanel={drawerSetPanel}
          onTabChange={() => {}}
          requestTab={requestTab}
          onTabRequestHandled={() => setRequestTab(null)}
          requestEdit={requestEdit}
          onEditRequestHandled={() => setRequestEdit(null)}
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
          onUploadImage={(issueId, file) => uploadInlineImage(issueId, file)}
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
          onCommitCell={commitCell}
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
          onAllocate={(projectId, a) =>
            dispatch({ t: 'upsertAllocation', id: null, projectId, ...a, now: new Date().toISOString() })
          }
          onRelease={(id) => dispatch({ t: 'removeAllocation', id, now: new Date().toISOString() })}
          onAddMember={(projectId, person, projectRoleId) =>
            dispatch({ t: 'addProjectMember', projectId, person, projectRoleId, now: new Date().toISOString() })
          }
          onUpdateMemberRole={(id, projectRoleId) =>
            dispatch({ t: 'updateProjectMember', id, projectRoleId, now: new Date().toISOString() })
          }
          onRemoveMember={(id) => dispatch({ t: 'removeProjectMember', id, now: new Date().toISOString() })}
          onUpsertSow={(id, engagementId, patch) =>
            dispatch({ t: 'upsertSow', id, engagementId, patch, now: new Date().toISOString() })
          }
          onArchiveSow={(id) => dispatch({ t: 'archiveSow', id, now: new Date().toISOString() })}
          onRaiseChange={(sowId, c, submit) =>
            dispatch({ t: 'upsertChangeRequest', id: null, sowId, patch: c, submit, now: new Date().toISOString() })
          }
          onDecideChange={(id, decision, note) =>
            dispatch({ t: 'decideChangeRequest', id, decision, note, now: new Date().toISOString() })
          }
          onWithdrawChange={(id) =>
            dispatch({ t: 'withdrawChangeRequest', id, now: new Date().toISOString() })
          }
          onUpsertMilestone={(sowId, id, patch) =>
            dispatch({ t: 'upsertMilestone', id, sowId, patch, now: new Date().toISOString() })
          }
          onRemoveMilestone={(id) =>
            dispatch({ t: 'removeMilestone', id, now: new Date().toISOString() })
          }
          onDeliverMilestone={(id) =>
            dispatch({ t: 'deliverMilestone', id, now: new Date().toISOString() })
          }
          onDecideMilestone={(id, decision, note) =>
            dispatch({ t: 'decideMilestone', id, decision, note, now: new Date().toISOString() })
          }
          onUpsertScope={(sowId, id, patch) =>
            dispatch({ t: 'upsertScopeItem', id, sowId, patch, now: new Date().toISOString() })
          }
          onRemoveScope={(id) =>
            dispatch({ t: 'removeScopeItem', id, now: new Date().toISOString() })
          }
          onDecideScope={(id, approved) =>
            dispatch({ t: 'decideScopeItem', id, approved, now: new Date().toISOString() })
          }
          onAttributeToSow={(nodeId, sowId) =>
            dispatch({ t: 'attributeToSow', nodeId, sowId, now: new Date().toISOString() })
          }
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
          onCorrectPattern={(versionId, validFrom, reason) =>
            dispatch({ t: 'correctVersion', id: versionId, patch: { validFrom }, reason, now: new Date().toISOString() })
          }
          onCommit={(c) =>
            dispatch({ t: 'upsertCommitment', id: null, ...c, now: new Date().toISOString() })
          }
          onReleaseCommitment={(id) =>
            dispatch({ t: 'removeCommitment', id, now: new Date().toISOString() })
          }
          onDecideLeave={(id, decision) =>
            dispatch({ t: 'decideLeave', id, decision, now: new Date().toISOString() })
          }
          onUpdateTime={(id, patch) =>
            dispatch({ t: 'updateTime', id, patch, now: new Date().toISOString() })
          }
          onRecordPattern={(personId, from, hoursPerDay, daysPerWeek, reason) =>
            dispatch({
              t: 'recordVersion',
              subjectKind: 'person.workingPattern',
              subjectId: personId,
              validFrom: from,
              // Open-ended. A change to somebody's working week runs until the next one is
              // recorded; naming an end date now would be inventing when it stops.
              validTo: null,
              value: { hoursPerDay, daysPerWeek },
              reason,
              now: new Date().toISOString(),
            })
          }
          onSubmitWeek={(person, week) =>
            dispatch({ t: 'submitTimesheet', person, weekStarting: week, now: new Date().toISOString() })
          }
          onDecideWeek={(id, decision, reason) =>
            dispatch({ t: 'decideTimesheet', id, decision, reason, now: new Date().toISOString() })
          }
          onAddNote={(issueId, body, noteType, pinned, clientVisible) =>
            dispatch({
              t: 'addNote',
              issueId,
              body,
              noteType,
              pinned,
              clientVisible,
              now: new Date().toISOString(),
            })
          }
          onUpdateNote={(id, patch) =>
            dispatch({ t: 'updateNote', id, patch, now: new Date().toISOString() })
          }
          onDeleteNote={(id) => dispatch({ t: 'removeNote', id, now: new Date().toISOString() })}
          onMailSent={mailSent}
          mailEnabled={persistence.enabled}
          onSetAssignment={(issueId, responsibilityId, values) =>
            dispatch({ t: 'setAssignment', issueId, responsibilityId, values, now: new Date().toISOString() })
          }
        />
      </LabelProvider>
      </DetailDrawer>
      )}

      {/* Issue edits now open the canonical detail panel (above), straight into edit mode via
          requestEdit. Dialogs handles everything else: hierarchy-node edits, and issue/node
          creation alike — "+ New Issue" lands here too, now that nothing intercepts it first.
          OUTSIDE the drawer on purpose: the top bar's + New Issue must open this with nothing
          selected, when no drawer is mounted at all. Still under the record-scoped labels —
          with no selection they resolve to the organisation's own. Its modal layer stacks
          above the drawer, so a dialog opened from inside one reads as on top of it. */}
      <LabelProvider value={scopedLabels}>
        <Dialogs
          dialog={dialog}
          state={state}
          rows={sortedRows}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
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
          documents={Object.values(state.documents).filter(
            (d) => d.subjectKind === 'issue' && d.subjectId === evidenceFor,
          )}
          mayAttach={can(state.model, actor, 'document.upload')}
          mayAddEvidence={can(state.model, actor, 'evidence.add')}
          mayRemove={can(state.model, actor, 'evidence.remove')}
          onUpload={async (file, evidenceId) => {
            const res = await uploadDocument(file, 'issue', evidenceFor, evidenceId)
            return 'error' in res ? res.error : null
          }}
          onWithdrawDocument={(id) =>
            dispatch({ t: 'removeDocument', id, now: new Date().toISOString() })
          }
          onSetDocumentVisibility={(id, clientVisible) =>
            dispatch({ t: 'setDocumentVisibility', id, clientVisible, now: new Date().toISOString() })
          }
          allDocuments={state.documents}
          reviews={state.documentReviews}
          people={Object.values(state.model.people).map((p) => p.name)}
          actorName={actor.name}
          mayReview={can(state.model, actor, 'document.review')}
          onAskReview={(documentId, reviewers, question) =>
            dispatch({ t: 'requestDocumentReview', documentId, reviewers, question, now: new Date().toISOString() })
          }
          onDecideReview={(reviewId, verdict, note) =>
            dispatch({ t: 'decideDocumentReview', reviewId, verdict, note, now: new Date().toISOString() })
          }
          onWithdrawReview={(reviewId) =>
            dispatch({ t: 'withdrawDocumentReview', reviewId, now: new Date().toISOString() })
          }
          onUploadVersion={async (file, supersedesId) => {
            const res = await uploadDocument(file, 'issue', evidenceFor, null, supersedesId)
            return 'error' in res ? res.error : null
          }}
          onClose={() => setEvidenceFor(null)}
        />
      )}

      {chatOpen && assistantOffered !== 'off' && (
        <ChatPanel
          index={chatIndex}
          today={today}
          engine={assistant.engine}
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
            // E5: the registry's model choice rides the same posted slice as autonomy;
            // absent lands on the route's code default.
            modelId: state.model.agents['AGENT_WORKSPACE_ASSISTANT']?.modelId,
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

      {clientPack && (
        <ClientPackView
          pack={clientPack.pack}
          org={state.model.organization}
          onClose={() => setClientPack(null)}
        />
      )}
      {financeReportOpen && (
        <FinanceReportDialog state={state} today={today} onClose={() => setFinanceReportOpen(false)} />
      )}

      {configOpen && (
        <ConfigWorkspace
          state={state}
          actor={actor}
          signedIn={Boolean(verified)}
          pass={pass}
          initialTab={configIntent?.tab}
          initialBlueprintSource={configIntent?.source}
          onConfig={applyConfigOp}
          onApplyBlueprint={(blueprintId, targetIdArg, anchorArg, keepIds) => {
            /*
             * Plan against the CURRENT state, then replay the planned actions through the
             * ordinary dispatch. The reducer assigns ids from seq, so replaying the same
             * ordered actions against the same state yields the simulation's ids - and any
             * interleaved refusal surfaces exactly as a hand edit's would.
             */
            const bp = state.model.blueprints[blueprintId]
            if (!bp) return { applied: 0, refused: [{ entryName: blueprintId, error: 'Blueprint not found.' }] }
            const run = applyBlueprint(state, bp, targetIdArg, anchorArg, actor, new Set(keepIds), new Date().toISOString())
            let applied = 0
            for (const step of run.steps) {
              if (dispatch(step.action)) applied++
              else break
            }
            if (applied === run.steps.length && run.steps.length > 0) {
              dispatch({
                t: 'config',
                op: {
                  k: 'upsertBlueprint',
                  id: bp.id,
                  patch: {
                    applications: [
                      ...bp.applications,
                      { at: new Date().toISOString(), by: actor.name, targetId: targetIdArg, version: bp.version },
                    ],
                  },
                },
                now: new Date().toISOString(),
              })
            }
            return { applied, refused: run.refusals.map((r) => ({ entryName: r.entryName, error: r.error })) }
          }}
          onClose={() => {
            setConfigOpen(false)
            setConfigIntent(null)
          }}
          onRecordRate={(r) =>
            dispatch({ t: 'recordRate', ...r, now: new Date().toISOString() })
          }
          onCorrectRate={(id, patch, reason) =>
            dispatch({ t: 'correctRate', id, patch, reason, now: new Date().toISOString() })
          }
          onRecordSkill={(r) =>
            dispatch({ t: 'recordPersonSkill', ...r, now: new Date().toISOString() })
          }
          onCorrectSkill={(id, patch) =>
            dispatch({ t: 'correctPersonSkill', id, patch, now: new Date().toISOString() })
          }
          onRemoveSkill={(id) =>
            dispatch({ t: 'removePersonSkill', id, now: new Date().toISOString() })
          }
          onOpenProfile={setOpenProfileId}
        />
      )}

      {openProfileId && (
        <ProfilePanel
          key={openProfileId}
          state={state}
          actor={actor}
          personId={openProfileId}
          onNavigate={setOpenProfileId}
          onUpdateCareer={(id, patch) =>
            dispatch({ t: 'updateCareerProfile', id, patch, now: new Date().toISOString() })
          }
          onClose={() => setOpenProfileId(null)}
        />
      )}

      {/* aria-live on the container so refusals reach assistive tech; errors are also
          role=alert for immediate announcement. */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role={t.error ? 'alert' : undefined} className={`toast${t.error ? ' error' : ''}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
    </LabelProvider>
  )
}
