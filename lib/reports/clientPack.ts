import type { WorkspaceState } from '../workspace'
import { clientView } from '../clientBoundary'
import { externalPartyKinds, tiersOf } from '../config'
import { isTerminal } from '../schedule'
import { buildTree } from '../tree'

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
 * No rate, no cost, no margin: `clientView()`'s own rule is that everything commercial is
 * withheld unconditionally from the general boundary, and this file never weakens that for the
 * issue/progress halves above. The monthly pack's payment-schedule section (`milestonesOf`,
 * below) is a narrow, deliberate exception to the "no Milestone" half of that rule specifically
 * — not a change to `clientView()` itself, which every other reader of this app still goes
 * through unmodified. A milestone's own contracted value (`amount`/`percentage`/`currency`) is
 * data the client already agreed to in the SOW; it is not the firm's internal cost or margin,
 * and neither of those ever appears here. See the design document's own "What this deliberately
 * is not", and the 2026-09-02 revision that scoped this specific carve-out.
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

/**
 * One row of a client's own payment schedule — fields read directly off `Milestone` itself,
 * never derived from SOW-level cost or rate data. `sowReference`/`sowTitle` group the rows by
 * contract; neither carries the SOW's own value or cost totals.
 */
export interface MilestonePackLine {
  id: string
  sowReference: string
  sowTitle: string
  name: string
  sequence: number
  plannedDate: string | null
  delivery: string
  deliveredAt: string | null
  acceptance: string
  acceptedAt: string | null
  basis: string
  percentage: number | null
  amount: number | null
  currency: string
  billOn: string
}

/**
 * Progress for the period — "understanding of progress", the user's own requirement.
 *
 * Computed from `clientView()`'s RETURN and nothing else, so only client-visible records feed
 * every number here; the disclosure line keeps counting what was withheld. The deltas come from
 * record dates (`actualEnd`, `raised`) deliberately rather than from the capped audit trail, so
 * they are complete however old the period — the monthly pack's audit-based `movement` (with
 * its own honesty flag) stays beside them, measuring the same month from a different source.
 * The schedule half reuses `buildTree`'s own row logic (override → activity roll-up →
 * status-derived), so a pack can never disagree with the grid; projected finish is the latest
 * planned end — a SCHEDULE field, never estimate hours, which `clientView` strips anyway.
 */
export interface PackProgress {
  periodDeltas: { closed: number; raised: number }
  schedule: {
    /** Mean per-record completion, 0–100, rounded. Null when nothing is visible. */
    pctComplete: number | null
    onTrack: number
    overdue: number
    projectedFinish: string | null
  }
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
  progress: PackProgress
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
  progress: PackProgress
  /** The client's own payment schedule — see `milestonesOf`'s own doc comment for scope. */
  milestones: MilestonePackLine[]
}

/** Resolves a client name (what `filters.client` carries) to that client's own node id — a
 *  node on an externalParty tier, by flag rather than by the literal kind. */
export function clientScopeIdFor(state: WorkspaceState, clientName: string): string | null {
  const external = externalPartyKinds(tiersOf(state.model))
  return (
    Object.values(state.nodes).find((n) => external.has(n.kind) && n.name === clientName)?.id ??
    null
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

/**
 * The client's own payment schedule — the one deliberate, narrow exception to `clientView()`'s
 * "no Milestone" rule, scoped to this file alone. Reads `Milestone`/`Sow` straight off the FULL
 * `state`, not off `clientView()`'s already-zeroed `visible.milestones`/`visible.sows` — this is
 * what makes the carve-out narrow: `clientView()` itself is never touched, so every other reader
 * of a redacted state (the live sign-in boundary, the discussion boundary) keeps withholding
 * milestones exactly as before. Scoping mirrors `underScopeOf`: a milestone survives only when
 * its SOW's engagement sits under the reader's own client node.
 *
 * Only fields carried directly on `Milestone` itself are exposed — never a resolved dollar
 * value pulled from `ContractedPosition`/`milestoneValue()`, and never anything from
 * `lib/rates.ts`. A milestone's own `amount`/`percentage`/`currency` is the figure the client
 * already agreed to in the SOW; the firm's cost or margin against it is a different question
 * this function does not answer.
 */
function milestonesOf(state: WorkspaceState, clientScopeId: string): MilestonePackLine[] {
  return Object.values(state.milestones)
    .filter((m) => {
      const sow = state.sows[m.sowId]
      return sow && underScopeOf(state, sow.engagementId, clientScopeId)
    })
    .map((m) => {
      const sow = state.sows[m.sowId]
      return {
        id: m.id,
        sowReference: sow.reference,
        sowTitle: sow.title,
        name: m.name,
        sequence: m.sequence,
        plannedDate: m.plannedDate,
        delivery: m.delivery,
        deliveredAt: m.deliveredAt,
        acceptance: m.acceptance,
        acceptedAt: m.acceptedAt,
        basis: m.basis,
        percentage: m.percentage,
        amount: m.amount,
        currency: m.currency,
        billOn: m.billOn,
      }
    })
    .sort((a, b) => (a.sowReference === b.sowReference ? a.sequence - b.sequence : a.sowReference.localeCompare(b.sowReference)))
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

/**
 * `visible` MUST be `clientView()`'s return, never the raw state — passing the raw state here
 * would put internal records' existence into a client document with nothing on screen looking
 * wrong. RP2's sentinel scan is the tripwire for exactly that mistake.
 */
function progressOf(visible: WorkspaceState, from: string, asOf: string): PackProgress {
  const issues = Object.values(visible.issues).filter((i) => !i.deletedAt)
  const inWindow = (d: string | null) => d != null && d >= from && d <= asOf
  const rows = buildTree(visible, asOf).filter((r) => r.kind === 'issue')
  const open = rows.filter((r) => !isTerminal(r.status as never))
  const ends = open.map((r) => r.plannedEndDate).filter((d): d is string => d != null)
  return {
    periodDeltas: {
      closed: issues.filter((i) => inWindow(i.actualEnd)).length,
      raised: issues.filter((i) => inWindow(i.raised)).length,
    },
    schedule: {
      pctComplete: rows.length
        ? Math.round(rows.reduce((t, r) => t + r.percentComplete, 0) / rows.length)
        : null,
      onTrack: open.filter((r) => r.scheduleHealth === 'On Track').length,
      overdue: open.filter((r) => r.scheduleHealth === 'Overdue').length,
      projectedFinish: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    },
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
    progress: progressOf(visible, from, asOf),
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
    progress: progressOf(visible, from, asOf),
    milestones: milestonesOf(state, clientScopeId),
  }
}
