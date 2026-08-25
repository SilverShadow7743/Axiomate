import type { WorkspaceState } from '../workspace'
import { clientView } from '../clientBoundary'
import { isTerminal } from '../schedule'

/**
 * Weekly and monthly packs handed to a client — built on `clientView()`, never re-deriving what
 * counts as client-safe. See `docs/plans/2026-08-25-client-pack-design.md`.
 *
 * Both packs are for exactly one client. Neither is scheduled or stored: like
 * `lib/reports/dailyIms.ts`, everything here is computed live from state already loaded, on the
 * same "a report that can disagree with the tree behind it stops being trusted" reasoning that
 * file's own header states.
 *
 * ---------------------------------------------------------------------------
 * The disclosure line
 *
 * `{ shown, total }` on every pack — how many of the client's records survived `clientView()`
 * against how many exist. Deliberate, not incidental: a client reading "3 open issues" has no
 * way to tell a quiet engagement from one where almost nothing has been marked visible yet. Both
 * numbers come from walking the same ancestry `clientView()` itself uses (`underScopeOf` below,
 * a deliberate duplicate of that function's own inline `underScope` — the pre-boundary count has
 * to ask the same question `clientView()` asks internally, since only the post-boundary answer
 * is ever returned to a caller), so this total can never silently disagree with what `clientView`
 * would let through.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately absent
 *
 * No `sowId`, no `Milestone`, nothing commercial: `clientView()`'s own rule is that everything
 * commercial is withheld unconditionally, and a governance rollup that surfaced milestone
 * delivery state would be carving a quiet exception into an already-shipped boundary. See the
 * design document's own "What this deliberately is not".
 */

interface Position {
  total: number
  open: number
  closed: number
  high: number
  medium: number
  low: number
}

export interface ClientPackLine {
  id: string
  subject: string
  owner: string
  status: string
  severity: string
  due: string
  lastActivity: string
}

export interface ClientPackDisclosure {
  shown: number
  total: number
}

export interface WeeklyClientPack {
  client: string
  asOf: string
  disclosure: ClientPackDisclosure
  /** Across the whole client-visible subset, not windowed — same split `dailyIms` makes between
   *  its position figure and its movement/sections. */
  position: Position
  window: { from: string; to: string }
  /** Client-visible issues with activity inside the window. */
  lines: ClientPackLine[]
}

export interface MonthlyGovernancePack {
  client: string
  asOf: string
  disclosure: ClientPackDisclosure
  position: Position
  window: { from: string; to: string }
  movement: {
    /** False when the trail holds nothing at all for the window — not the same as a quiet
     *  month. Mirrors `dailyIms`'s own `trailAvailable` distinction. */
    trailAvailable: boolean
    raised: number
    resolved: number
  }
}

/** Resolves a client name (what `filters.client` carries) to that client's own node id. */
export function clientScopeIdFor(state: WorkspaceState, clientName: string): string | null {
  return (
    Object.values(state.nodes).find((n) => n.kind === 'client' && n.name === clientName)?.id ?? null
  )
}

/** Duplicates `clientView`'s own inline `underScope` — the pre-boundary total needs to ask the
 *  same ancestry question, since `clientView` never returns what it withheld. */
function underScopeOf(
  state: WorkspaceState,
  parentId: string | null | undefined,
  clientScopeId: string,
): boolean {
  let cur = parentId
  while (cur) {
    if (cur === clientScopeId) return true
    cur = state.nodes[cur]?.parentId
  }
  return false
}

function isoDateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function lineOf(i: { id: string; subject: string; owner: string; status: string; severity: string; plannedEnd: string | null; lastActivity: string }): ClientPackLine {
  return {
    id: i.id,
    subject: i.subject,
    owner: i.owner,
    status: i.status,
    severity: i.severity,
    due: i.plannedEnd ?? '',
    lastActivity: i.lastActivity,
  }
}

function positionOf(issues: { status: string; severity: string }[]): Position {
  const open = issues.filter((i) => !isTerminal(i.status as never))
  return {
    total: issues.length,
    open: open.length,
    closed: issues.length - open.length,
    high: open.filter((i) => i.severity === 'High').length,
    medium: open.filter((i) => i.severity === 'Medium').length,
    low: open.filter((i) => i.severity === 'Low').length,
  }
}

export function buildWeeklyClientPack(
  state: WorkspaceState,
  clientScopeId: string,
  asOf: string,
): WeeklyClientPack {
  const visible = clientView(state, clientScopeId)
  const visibleIssues = Object.values(visible.issues)
  const total = Object.values(state.issues).filter(
    (i) => !i.deletedAt && underScopeOf(state, i.parentId, clientScopeId),
  ).length

  const from = isoDateMinusDays(asOf, 7)
  const lines = visibleIssues
    .filter((i) => i.lastActivity >= from && i.lastActivity <= asOf)
    .map(lineOf)

  return {
    client: state.nodes[clientScopeId]?.name ?? clientScopeId,
    asOf,
    disclosure: { shown: visibleIssues.length, total },
    position: positionOf(visibleIssues),
    window: { from, to: asOf },
    lines,
  }
}

export function buildMonthlyGovernancePack(
  state: WorkspaceState,
  clientScopeId: string,
  asOf: string,
): MonthlyGovernancePack {
  const visible = clientView(state, clientScopeId)
  const visibleIssues = Object.values(visible.issues)
  const total = Object.values(state.issues).filter(
    (i) => !i.deletedAt && underScopeOf(state, i.parentId, clientScopeId),
  ).length

  const from = isoDateMinusDays(asOf, 30)
  const since = Date.parse(`${from}T00:00:00Z`)
  const visibleIds = new Set(visibleIssues.map((i) => i.id))
  /*
   * Read exactly the way `dailyIms` reads its own movement — the same audit trail, the same
   * `field` vocabulary — so a raised/resolved count here can never disagree with that report's
   * own count for the identical window and records because a second, differently-shaped
   * movement mechanism was written instead of reusing this one's logic.
   */
  const inWindow = state.audit.filter((e) => {
    const t = Date.parse(e.at)
    return !Number.isNaN(t) && t >= since && visibleIds.has(e.rowId)
  })
  const raised = inWindow.filter((e) => e.field === 'created').length
  const resolved = inWindow.filter((e) => e.field === 'status' && isTerminal(e.to as never)).length

  return {
    client: state.nodes[clientScopeId]?.name ?? clientScopeId,
    asOf,
    disclosure: { shown: visibleIssues.length, total },
    position: positionOf(visibleIssues),
    window: { from, to: asOf },
    movement: {
      trailAvailable: inWindow.length > 0 || state.audit.some((e) => Date.parse(e.at) >= since),
      raised,
      resolved,
    },
  }
}
