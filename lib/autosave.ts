import { COMPANY_NODE_ID, type WorkspaceState } from './workspace'
import { NODE_KINDS } from './types'
import { mergeModel } from './config'

/**
 * Autosave: what it means here, and where work actually goes.
 *
 * Nothing in this app has a Save button, and nothing should. Every change already goes through
 * one reducer, so saving is not a decision the user makes — it is a consequence of the change
 * having happened. This module is the part that makes that true rather than aspirational.
 *
 * Two stores, chosen by what is available, never both:
 *
 *   Postgres        when DATABASE_URL is set. Actions are queued and replayed server-side.
 *   Local mirror    when it is not. The whole workspace is written to this browser.
 *
 * The local mirror is a fallback, not a cache. Running one of these alongside a database would
 * mean two stores that can disagree about the same record, and the loser is always whichever
 * one the user did not look at.
 */

/**
 * `retrying` and `paused` are both "not saved yet", and the difference matters to the person
 * reading it: `retrying` is a request in flight right now, `paused` is a queue waiting out an
 * outage that will try again on its own. Collapsing them into `error` is what made a ten-second
 * outage look identical to a change the server refused.
 */
export type SaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'retrying'
  | 'paused'
  | 'error'
  | 'local'

export interface SaveState {
  status: SaveStatus
  /** Actions accepted locally but not yet acknowledged by the server. */
  pending: number
  /** Last successful save, ISO. */
  savedAt: string | null
  error?: string
}

/* ================================================================== *
 * Local mirror
 * ================================================================== */

/**
 * The mirror is per tenant, and the key says so.
 *
 * One machine can legitimately open two firms' workspaces — a consultant working across two
 * deployments, or anyone switching `AXIOMATE_TENANT`. On a single key the second load would
 * merge one firm's nodes and issues over the other's and write the result back as though it
 * were one workspace. Namespacing costs nothing and makes that impossible.
 *
 * The tenant is passed in from the server rather than resolved here: the browser has no
 * authority over which tenant it is, and reading one from client state would invent one.
 */
function storeKey(tenantId: string): string {
  return `axiomate.workspace.v1:${tenantId}`
}

/** What the key was before it was namespaced. Adopted once, then left alone. */
const LEGACY_STORE_KEY = 'axiomate.workspace.v1'

/**
 * Carry a mirror written before the key carried a tenant over to the new one.
 *
 * Without this the rename orphans it: the app looks under `…v1:axiocloud`, finds nothing,
 * falls back to the seed, and a user's unsaved afternoon is still on disk but invisible — the
 * same silent loss the mirror exists to prevent.
 *
 * Only ever adopted by the tenant this deployment is configured for, and only when that
 * tenant has no mirror of its own, so it can never overwrite newer work or hand one firm's
 * workspace to another. The legacy copy is left in place rather than deleted: it costs a
 * little quota and it is the only remaining copy if this goes wrong.
 */
function adoptLegacyMirror(tenantId: string): void {
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORE_KEY)
    if (!legacy) return
    if (window.localStorage.getItem(storeKey(tenantId)) !== null) return
    window.localStorage.setItem(storeKey(tenantId), legacy)
  } catch {
    /* A full or blocked quota just means the fallback is unavailable, not that we should throw. */
  }
}

/**
 * The audit trail is the one unbounded thing in the state, and local storage is not.
 *
 * Keeping the most recent entries rather than the oldest: History is read to answer "what just
 * happened", and a mirror that silently stopped recording months ago would answer it wrongly.
 * The cap is stated in the UI so a truncated trail is never mistaken for a complete one.
 */
const MAX_MIRRORED_AUDIT = 2000

export interface MirrorResult {
  ok: boolean
  /** Set when the write failed — almost always a full quota. */
  error?: string
  bytes?: number
}

export function saveWorkspaceLocally(tenantId: string, state: WorkspaceState): MirrorResult {
  if (typeof window === 'undefined') return { ok: false, error: 'No browser storage.' }
  try {
    const trimmed: WorkspaceState = {
      ...state,
      audit: state.audit.length > MAX_MIRRORED_AUDIT ? state.audit.slice(-MAX_MIRRORED_AUDIT) : state.audit,
    }
    const json = JSON.stringify(trimmed)
    window.localStorage.setItem(storeKey(tenantId), json)
    return { ok: true, bytes: json.length }
  } catch (err) {
    // A quota failure is the interesting case and must not be swallowed: the user is still
    // working, and every change from here is being lost.
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: /quota|exceeded/i.test(msg) ? 'Browser storage is full.' : msg }
  }
}

/**
 * Read the mirror back, merged over the current seed.
 *
 * Merged, not returned whole, and the difference is not cosmetic. A mirror is a snapshot of
 * one browser at one moment; the seed is what this build ships. Returning the mirror alone
 * means any record a later build adds — a new hierarchy tier, a new node — is invisible
 * forever to anyone who has used the app before, because their snapshot predates it and wins.
 * That is exactly how the Engagement tier failed to appear the first time it was added.
 *
 * The merge is per record and the mirror wins on conflict, so nothing a user changed is lost
 * and nothing they archived comes back: a deleted record is still *present* in the mirror
 * carrying `deletedAt`, so it overrides the seed's live copy rather than being refilled by it.
 *
 * Shape-checked rather than trusted, too: this is JSON that has sat in a browser across app
 * versions, and handing a malformed object to the reducer would fail far from the cause.
 */
export function loadWorkspaceLocally(tenantId: string, seed: WorkspaceState): WorkspaceState | null {
  if (typeof window === 'undefined') return null
  try {
    adoptLegacyMirror(tenantId)
    const raw = window.localStorage.getItem(storeKey(tenantId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.issues ||
      !parsed.nodes ||
      !parsed.model ||
      typeof parsed.seq !== 'number'
    ) {
      // Unreadable, and it will still be unreadable next time. Left in place it would sit
      // there consuming the quota that the working mirror needs.
      clearWorkspaceLocally(tenantId)
      return null
    }
    /**
     * Which seeded issues this browser has actually edited.
     *
     * Needed because "mirror wins" is the wrong rule for a record the user never touched. The
     * internal Axiomate log is maintained in the seed file and updated as work happens, so a
     * blanket mirror-wins means a closed issue stays open forever on any browser that has run
     * the app once — the update is written, shipped, and invisible.
     *
     * The audit trail is the signal: an issue is only the user's if something was recorded
     * against it. Caveat worth knowing — the mirrored trail is capped, so an edit old enough
     * to have aged out would let the seed take that issue back. `lastActivity` is checked as
     * well, which covers every edit the reducer makes, since all of them stamp it.
     */
    const editedHere = new Set((parsed.audit ?? []).map((a) => a.rowId))
    const userIssues: Record<string, (typeof seed.issues)[string]> = {}
    for (const [id, issue] of Object.entries(parsed.issues)) {
      const seeded = seed.issues[id]
      if (!seeded || editedHere.has(id) || issue.lastActivity !== seeded.lastActivity) {
        userIssues[id] = issue
      }
    }

    const merged: WorkspaceState = {
      nodes: { ...seed.nodes, ...parsed.nodes },
      issues: { ...seed.issues, ...userIssues },
      activities: parsed.activities ?? {},
      dependencies: parsed.dependencies ?? [],
      relationships: parsed.relationships ?? [],
      evidence: parsed.evidence ?? {},
      // Mirror wins, like evidence: notes are written in this browser and exist nowhere else
      // until a database does. `?? {}` because a mirror predating notes has no such key.
      notes: parsed.notes ?? {},
      estimates: parsed.estimates ?? {},
      estimateRevisions: parsed.estimateRevisions ?? {},
      timeEntries: parsed.timeEntries ?? {},
      approvals: parsed.approvals ?? {},
      notifications: parsed.notifications ?? {},
      sows: parsed.sows ?? {},
      allocations: parsed.allocations ?? {},
      commitments: parsed.commitments ?? {},
      // `?? {}` because a mirror written before versions existed has no such key.
      versions: parsed.versions ?? {},
      // `?? {}` because a mirror written before timesheets existed has no such key.
      timesheets: parsed.timesheets ?? {},
      // `?? {}` because a mirror written before rates existed has no such key — and because a
      // mirror written by somebody without `rate.view` legitimately has an empty one.
      rates: parsed.rates ?? {},
      changes: parsed.changes ?? {},
      engagements: { ...seed.engagements, ...(parsed.engagements ?? {}) },
      // Merged, not taken whole. The mirror's model predates every operating-model key added
      // since it was written, and adopting it verbatim made those keys `undefined` — which is
      // how a newly configurable work-type registry arrived empty on every existing browser.
      model: mergeModel(seed.model, parsed.model),
      audit: parsed.audit ?? [],
      // The mirror's counter is authoritative — it has minted ids the seed's has not.
      seq: Math.max(parsed.seq, seed.seq),
    }
    // After the merge, never before: the reconciliation needs the engagement and company
    // nodes the merge is what introduces.
    return reconcileHierarchy(merged, seed)
  } catch {
    clearWorkspaceLocally(tenantId)
    return null
  }
}

export function clearWorkspaceLocally(tenantId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storeKey(tenantId))
  } catch {
    /* nothing to do */
  }
}

/**
 * Whether a mirror exists, without paying to parse it.
 *
 * Only ever called when a database *is* configured, to warn that offline work is sitting
 * unused — so "exists" here means "abandoned", while the same legacy key means "adopt this"
 * to `loadWorkspaceLocally`, which only runs when there is no database. The two readings
 * cannot both apply in one session, and stating that is what stops the next edit from making
 * them contradict: this function must never adopt, and that one must never warn.
 */
export function hasLocalWorkspace(tenantId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.localStorage.getItem(storeKey(tenantId)) !== null ||
      // The legacy copy counts: this warns a user that offline work exists and is not being
      // used, and it would be a strange time to be silent about the one that predates the
      // key rename.
      window.localStorage.getItem(LEGACY_STORE_KEY) !== null
    )
  } catch {
    return false
  }
}

/* ================================================================== *
 * Status text
 * ================================================================== */

/** One short phrase for the indicator. Never ambiguous about whether work is safe. */
export function describeSave(s: SaveState): string {
  switch (s.status) {
    case 'saving':
      return s.pending > 1 ? `Saving ${s.pending} changes…` : 'Saving…'
    case 'retrying':
      return 'Retrying…'
    // "Not saved yet" rather than "Not saved": the work is held and will be sent. The two are
    // one word apart because the difference between them is whether the person needs to act.
    case 'paused':
      return s.pending > 1 ? `Not saved yet · ${s.pending} changes` : 'Not saved yet'
    case 'error':
      return s.pending > 1 ? `Not saved · ${s.pending} changes` : 'Not saved'
    case 'local':
      return 'Saved in this browser'
    case 'saved':
      return 'Saved'
    default:
      return 'Up to date'
  }
}

export function describeSaveDetail(s: SaveState, dbEnabled: boolean): string {
  /**
   * One sentence about what happened, then one about what is held — never two that disagree.
   *
   * They did. The message for an expired sign-in said "signing in and reloading will send it"
   * and the tail said "reloading will discard them", in the same tooltip, and the tail was the
   * true half: the queue is a ref and dies with the page. Each caller now supplies a complete
   * statement of the cause, and this adds only facts that hold for every cause.
   */
  if (s.status === 'error' || s.status === 'paused') {
    const n = s.pending
    const held =
      n === 0
        ? ''
        : ` ${n} change${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} held in this tab: ${
            s.status === 'paused'
              ? 'they will be sent when this succeeds'
              : 'nothing further will be sent'
          }, and reloading discards ${n === 1 ? 'it' : 'them'}.`
    const cause =
      s.error ?? (s.status === 'paused' ? 'The server is unreachable.' : 'The last change could not be saved.')
    const advice = s.status === 'error' ? ' Reload to see what is actually stored.' : ''
    return `${cause}${held}${advice}`
  }
  if (s.status === 'retrying') return 'The server did not respond. Trying again.'
  /**
   * Saved in the browser — and this branch has to come before the `dbEnabled` test below.
   *
   * Without it, the one case where the two disagree fell through to the final line and read
   * "Everything is saved." That case is a deployment whose database disappeared between the
   * page rendering and a write landing: the queue is deliberately discarded because there is
   * nothing to deliver to, the browser mirror was switched off because a database was
   * configured at render, and the user was told everything was safe when nothing had been
   * written anywhere at all.
   */
  if (s.status === 'local') {
    return dbEnabled
      ? 'The database this page loaded with is no longer configured, so the last changes could not be saved anywhere. Reload to see what is stored.'
      : 'No database is configured, so work is saved in this browser only. It will not be visible anywhere else, and clearing site data will remove it.'
  }
  if (s.status === 'saving') return `${s.pending} change${s.pending === 1 ? '' : 's'} in flight.`
  if (!dbEnabled) {
    return 'No database is configured, so work is saved in this browser only. It will not be visible anywhere else, and clearing site data will remove it.'
  }
  return s.savedAt ? `Everything is saved. Last write ${new Date(s.savedAt).toLocaleTimeString()}.` : 'Everything is saved.'
}

/**
 * Bring a mirror written against an older hierarchy up to the current one.
 *
 * The delivery chain gained two tiers after the first mirrors were written: a Company above
 * the clients, and an Engagement between a client and its process areas. A snapshot taken
 * before that change still parents its clients at the root and its process areas at the
 * client, so without this the merged state renders the old shape forever.
 *
 * Safe to run because the seeded ids are *constructed*, not minted: `module:OAPIL:Inventory`
 * is known to belong to `engagement:OAPIL` by name alone. Only nodes whose id matches that
 * construction are touched — anything a user created keeps the parent they gave it.
 *
 * Idempotent, because it runs on every load for the rest of the app's life: a node already in
 * the right place fails the guard and is left alone.
 */
/**
 * Whether a node id was *constructed by the seed* rather than minted for a user.
 *
 * The distinction decides whether the sweep below may remove a node, so it has to be exact.
 * Seeded ids embed the thing they name — `company:root`, `client:OAPIL`,
 * `module:OAPIL:Inventory`. User-created ids are the kind plus the workspace counter,
 * `${kind}:${seq}` — so `client:12`. Both start with a tier name, which is why a bare prefix
 * test is not enough: it reads a user's empty Engagement as a stale seed node and deletes it
 * on the next load. The numeric suffix is what separates them.
 *
 * The tier list comes from `NODE_KINDS` rather than being spelled out. It was spelled out,
 * and it had already lost `project` — a tier the sweep would therefore never have considered.
 */
const SEEDED_NODE_ID = new RegExp(`^(?:${NODE_KINDS.join('|')}):(?!\\d+$).+`)

function isSeededNodeId(id: string): boolean {
  return SEEDED_NODE_ID.test(id)
}

function reconcileHierarchy(state: WorkspaceState, seed: WorkspaceState): WorkspaceState {
  const nodes = { ...state.nodes }
  let changed = false

  /**
   * Drop seeded nodes a later build no longer defines.
   *
   * Merging keeps everything the mirror holds, which is right for anything a user made — but
   * a *seeded* node that the seed has since replaced is dead weight, and it shows: when the
   * internal project moved from a default engagement to a named one, both appeared, and the
   * old empty one sat beside the real one looking like a duplicate.
   *
   * Narrow on purpose. A node is only removed when all three hold: its id follows a seeded
   * construction, the current seed no longer defines it, and nothing at all lives under it.
   * Anything a user created fails the first test — see `isSeededNodeId` for why that took
   * more than a prefix match to get right.
   */
  for (const node of Object.values(nodes)) {
    if (!isSeededNodeId(node.id) || seed.nodes[node.id]) continue
    const hasChildNode = Object.values(nodes).some((n) => n.parentId === node.id)
    const hasIssue = Object.values(state.issues).some((i) => i.parentId === node.id)
    if (hasChildNode || hasIssue) continue
    delete nodes[node.id]
    changed = true
  }

  for (const node of Object.values(nodes)) {
    if (node.kind === 'client' && node.parentId === null && nodes[COMPANY_NODE_ID]) {
      nodes[node.id] = { ...node, parentId: COMPANY_NODE_ID }
      changed = true
      continue
    }
    // `module:<client>:<name>` sitting on `client:<client>` belongs under that client's
    // engagement now. The id carries the client, so no guessing is involved.
    if (node.kind === 'module' && node.parentId?.startsWith('client:')) {
      const client = node.parentId.slice('client:'.length)
      if (node.id.startsWith(`module:${client}:`)) {
        const engagementId = `engagement:${client}`
        if (nodes[engagementId] && !nodes[engagementId].deletedAt) {
          nodes[node.id] = { ...node, parentId: engagementId }
          changed = true
        }
      }
    }
  }

  return changed ? { ...state, nodes } : state
}
