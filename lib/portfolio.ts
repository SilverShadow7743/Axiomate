import { forecastFor } from './forecast'
import { availabilityFor } from './availability'
import { profileAt } from './capacity'
import { addDays } from './dates'
import { holidaySetOf } from './config'
import { directoryIdByName } from './access'
import { BLOCKED_STATUSES, isTerminal } from './schedule'
import { issuesUnder } from './engagement'

import type { IssueRecord, WorkspaceState } from './workspace'
import type { Severity } from './types'

/**
 * Every engagement at once, so "which of these is in trouble" is one screen rather than three.
 *
 * ---------------------------------------------------------------------------
 * There is no health score, and there will not be one
 *
 * The obvious shape for a portfolio is a number per engagement — a percentage, a RAG light, a
 * weighted index. Every one of those is a derived value presented as a fact, which is the rule
 * this codebase is built around breaking as rarely as possible. Worse, it is the specific way
 * that rule fails invisibly: a score is a sentence about weights nobody can see, and the weights
 * are exactly what a partner would want to argue with.
 *
 * This module was written a week after `mywork` shipped claiming to have "no priority score"
 * while in fact weighting severity at zero — a Low issue ten days late outranked a High three
 * days late, and the framing hid it. The lesson taken from that is not "be careful with scores".
 * It is: name the concerns, count them, and let the reader do the weighing.
 *
 * So an engagement carries a list of CONCERNS. Each one is a plain claim with a number attached,
 * checkable against the tree in one click. An engagement with none says so.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately not here
 *
 * **Money.** Contracted value, milestones accepted, what is unbilled — all of it is derivable
 * and none of it is shown. There is no read grant for commercial figures: `sow.edit` is a write
 * permission and using it to gate a read would conflate two different questions, and inventing a
 * `sow.view` mid-feature is how coarse access gets quietly widened. It also needs the treatment
 * `rate.view` and `skill.view` get — withheld from the page payload, not hidden on screen —
 * which is its own piece of work. Delivery health first, and honestly, rather than a commercial
 * column that leaks.
 *
 * **Anything recorded but empty.** An engagement with no recorded status shows no status. The
 * `EngagementDetail` fields start empty by design and are rendered as absent, never guessed.
 */

/** Nothing has happened here for this many days, and something open is waiting. */
const STALE_DAYS = 14

/**
 * The concerns, worst first.
 *
 * The order is the argument: `overdue` outranks `blocked` because a date that has passed is a
 * commitment already broken, where a blocked item is one being honestly waited on. `unowned`
 * comes next because work with nobody's name on it is the only kind that cannot progress by
 * itself. `stale` is last of the four because quiet is weaker evidence than any of the others —
 * a fortnight of silence on a small engagement may be correct.
 */
export const CONCERN_ORDER = ['overdue', 'forecast', 'capacity', 'blocked', 'unowned', 'stale'] as const
export type ConcernKind = (typeof CONCERN_ORDER)[number]

export interface Concern {
  kind: ConcernKind
  /** How many records this is true of. For `stale`, the number of days. */
  count: number
  /** One clause, written to sit in a comma-separated sentence. */
  phrase: string
}

export interface PortfolioLine {
  nodeId: string
  name: string
  /** The client this sits under, by name. Empty when the engagement has no client above it. */
  client: string
  /** Recorded engagement status, or '' when nobody has said. Never inferred from the issues. */
  status: string
  issues: number
  open: number
  /** Project tiers nested inside this engagement. Their issues are already in the counts above. */
  projects: number
  /** Open issues at High severity. Shown beside the concerns, not folded into them. */
  high: number
  concerns: Concern[]
  lastActivity: string | null
}

/**
 * One line per engagement, ordered by what most wants attention.
 *
 * ---------------------------------------------------------------------------
 * Why this is not simply "every engagement and project node"
 *
 * It was, for about ten minutes, and run against the real tree it listed everything twice. The
 * shape here is `OAPIL → OAPIL Engagement → D365 Implementation`, engagement then project, so
 * both tiers matched and both reported the same 94 issues — the project's work counted once
 * under its own name and again under its parent's. Two lines, identical figures, and a portfolio
 * whose totals were double the truth.
 *
 * The rule is now the OUTERMOST of the two kinds: an engagement always, and a project only when
 * nothing of either kind sits above it. That is what makes a firm which files projects directly
 * under a client still get a screen, without counting anybody's work twice.
 *
 * Nested projects are not lost — `issuesUnder` walks the whole subtree, so their issues are in
 * the engagement's figures, and `projects` says how many are in there. Naming the engagement
 * rather than the project is deliberate: a portfolio answers "which job is in trouble", and the
 * job is what the client signed.
 *
 * Anything without a client above it still appears. An engagement filed at the top of the tree
 * is a tree problem, and hiding it here would make it harder to see rather than fixing it.
 */
export function portfolio(state: WorkspaceState, today: string): PortfolioLine[] {
  const lines: PortfolioLine[] = []

  for (const node of Object.values(state.nodes)) {
    if (node.deletedAt) continue
    if (node.kind !== 'engagement' && node.kind !== 'project') continue
    if (node.kind === 'project' && hasPortfolioAncestor(state, node.parentId)) continue

    const issues = issuesUnder(state, node.id)
    const open = issues.filter((i) => !isTerminal(i.status))
    const parent = node.parentId ? state.nodes[node.parentId] : null
    const detail = state.engagements[node.id]

    const activity = issues.map((i) => i.lastActivity).filter(Boolean).sort()
    const lastActivity = activity[activity.length - 1] ?? null

    lines.push({
      nodeId: node.id,
      name: node.name,
      client: parent?.name ?? '',
      status: detail?.status ?? '',
      issues: issues.length,
      open: open.length,
      projects: projectsUnder(state, node.id),
      high: open.filter((i) => i.severity === ('High' satisfies Severity)).length,
      concerns: concernsFor(state, open, lastActivity, today, node.id),
      lastActivity,
    })
  }

  return lines.sort(compareLines)
}

/** Whether an engagement or a project already sits above this node. */
function hasPortfolioAncestor(state: WorkspaceState, parentId: string | null): boolean {
  const seen = new Set<string>()
  let at = parentId
  while (at && !seen.has(at)) {
    seen.add(at)
    const node = state.nodes[at]
    if (!node) return false
    if (node.kind === 'engagement' || node.kind === 'project') return true
    at = node.parentId
  }
  return false
}

/** Project tiers anywhere beneath a node. Counted, not listed — the line is one row. */
function projectsUnder(state: WorkspaceState, nodeId: string): number {
  return Object.values(state.nodes).filter(
    (n) => !n.deletedAt && n.kind === 'project' && hasAncestor(state, n.parentId, nodeId),
  ).length
}

function hasAncestor(state: WorkspaceState, from: string | null, target: string): boolean {
  const seen = new Set<string>()
  let at = from
  while (at && !seen.has(at)) {
    if (at === target) return true
    seen.add(at)
    at = state.nodes[at]?.parentId ?? null
  }
  return false
}

/**
 * Every project-tier id an allocation could legally target under this line — descendants,
 * the same subtree `projectsUnder` counts, PLUS the node itself when the line's own node is
 * a project (the outermost-project case, no engagement layer above it). `upsertAllocation`
 * (lib/workspace.ts) refuses any `projectId` whose node isn't `kind === 'project'`, so an
 * engagement's own id is never a valid target and is correctly never added here.
 */
function projectIdsUnder(state: WorkspaceState, nodeId: string): string[] {
  const self = state.nodes[nodeId]
  const ids = Object.values(state.nodes)
    .filter((n) => !n.deletedAt && n.kind === 'project' && hasAncestor(state, n.parentId, nodeId))
    .map((n) => n.id)
  return self?.kind === 'project' ? [nodeId, ...ids] : ids
}

/**
 * What is wrong here, as claims rather than a rating.
 *
 * Each is computed from the open issues only. A closed issue that was once late is history, and
 * a portfolio that counted it would never improve no matter what anybody did — which is the
 * fastest way to make a screen ignored.
 */
function concernsFor(state: WorkspaceState, open: IssueRecord[], lastActivity: string | null, today: string, nodeId: string): Concern[] {
  const out: Concern[] = []

  const overdue = open.filter((i) => i.plannedEnd && i.plannedEnd < today).length
  if (overdue) {
    out.push({ kind: 'overdue', count: overdue, phrase: `${overdue} past its date` })
  }

  /*
   * The future, from the one forecast module — the same verdicts the Schedule tab shows, so
   * the two surfaces can never disagree about a record. Only records that CAN be forecast
   * participate (an estimate and a due date); the rest are honest absences, already counted
   * by the other concerns. The phrase names the worst shortfall rather than summing them:
   * shortfalls on different owners do not add up to anything a reader can act on.
   */
  const holidays = holidaySetOf(state.model)
  const commitments = Object.values(state.commitments)
  const allocations = Object.values(state.allocations)
  const versions = Object.values(state.versions)
  let shortCount = 0
  let worst: { name: string; by: number } | null = null
  for (const i of open) {
    if (!i.plannedEnd || i.plannedEnd < today || !state.estimates[i.id]) continue
    const ownerId = directoryIdByName(state.model, i.owner)
    const f = forecastFor({
      issueId: i.id,
      owner: i.owner,
      ownerId,
      plannedEnd: i.plannedEnd,
      estimate: state.estimates[i.id],
      bands: state.model.sizeBands,
      timeEntries: state.timeEntries,
      profile: profileAt(versions, state.model.resourceProfiles, ownerId ?? '', today),
      commitments,
      allocations,
      today,
      holidays,
    })
    if (f.kind !== 'short') continue
    shortCount++
    if (!worst || f.deltaHours > worst.by) worst = { name: i.id, by: f.deltaHours }
  }
  if (shortCount && worst) {
    out.push({
      kind: 'forecast',
      count: shortCount,
      phrase: `${shortCount} forecast short (worst ${worst.name}, by ${worst.by}h)`,
    })
  }

  /*
   * People, not records — the same forward-looking risk as `forecast`, read from the other
   * side. Checked against a person's TOTAL allocation (the full `allocations` array below,
   * never filtered to this engagement's projects) — someone over-committed here and
   * elsewhere is over-committed regardless of which line asks, per the design's own decision.
   * Only WHO to check is scoped to this engagement; the check itself is not.
   */
  const projectIds = new Set(projectIdsUnder(state, nodeId))
  const peopleHere = new Map<string, { person: string; personId: string | null }>()
  for (const a of allocations) {
    if (a.deletedAt || !projectIds.has(a.projectId)) continue
    const key = a.personId ?? a.person
    if (!peopleHere.has(key)) peopleHere.set(key, { person: a.person, personId: a.personId ?? null })
  }
  let overCount = 0
  let worstCapacity: { name: string; by: number } | null = null
  const windowEnd = addDays(today, 28)
  for (const { person, personId } of peopleHere.values()) {
    const profile = personId ? profileAt(versions, state.model.resourceProfiles, personId, today) : undefined
    const pos = availabilityFor(person, profile, commitments, allocations, today, windowEnd, personId, holidays)
    if (!pos.overallocated) continue
    overCount++
    const by = -pos.remainingHours
    if (!worstCapacity || by > worstCapacity.by) worstCapacity = { name: person, by }
  }
  if (overCount && worstCapacity) {
    out.push({
      kind: 'capacity',
      count: overCount,
      phrase: `${overCount} over-committed (worst ${worstCapacity.name}, by ${worstCapacity.by}h)`,
    })
  }

  const blocked = open.filter((i) => BLOCKED_STATUSES.includes(i.status)).length
  if (blocked) {
    out.push({ kind: 'blocked', count: blocked, phrase: `${blocked} blocked` })
  }

  /*
   * "Unassigned" is a real stored value here, not an absence — the import writes it. Both it and
   * an empty string mean the same thing to a reader, so both count.
   */
  const unowned = open.filter((i) => !i.owner.trim() || i.owner === 'Unassigned').length
  if (unowned) {
    out.push({ kind: 'unowned', count: unowned, phrase: `${unowned} with no owner` })
  }

  /*
   * Silence only counts while something is still open. An engagement that has finished and gone
   * quiet is not a concern, it is a delivered piece of work, and flagging it would train people
   * to dismiss this column.
   */
  if (open.length && lastActivity) {
    const quiet = daysBetweenIso(lastActivity, today)
    if (quiet >= STALE_DAYS) {
      out.push({ kind: 'stale', count: quiet, phrase: `nothing for ${quiet} days` })
    }
  }

  return out.sort((a, b) => CONCERN_ORDER.indexOf(a.kind) - CONCERN_ORDER.indexOf(b.kind))
}

/**
 * Worst concern first, then how much of it, then the name.
 *
 * Three keys, and all three earn their place — the middle one especially. Ranking on the concern
 * kind alone put an engagement with one late issue above one with forty, in alphabetical order,
 * which is the exact fault `mywork` shipped with and is why the count is here from the start.
 */
function compareLines(a: PortfolioLine, b: PortfolioLine): number {
  const rank = (l: PortfolioLine) =>
    l.concerns.length ? CONCERN_ORDER.indexOf(l.concerns[0].kind) : CONCERN_ORDER.length
  const worst = rank(a) - rank(b)
  if (worst) return worst

  const weight = (l: PortfolioLine) => (l.concerns.length ? l.concerns[0].count : 0)
  const heavier = weight(b) - weight(a)
  if (heavier) return heavier

  return a.name.localeCompare(b.name)
}

/**
 * One sentence for the whole portfolio.
 *
 * Phrased as a count of engagements rather than of issues: the reader has just asked "which of
 * these needs me", and totalling the issues across unrelated engagements answers a question
 * nobody asked.
 */
export function describePortfolio(lines: PortfolioLine[]): string {
  if (!lines.length) {
    return 'No engagements or projects yet. They are the tier beneath a client in the tree.'
  }
  const flagged = lines.filter((l) => l.concerns.length)
  if (!flagged.length) {
    return `${lines.length} ${lines.length === 1 ? 'engagement' : 'engagements'}, none with anything overdue, blocked, unowned or gone quiet.`
  }
  return `${flagged.length} of ${lines.length} ${lines.length === 1 ? 'engagement' : 'engagements'} ${flagged.length === 1 ? 'has' : 'have'} something wanting attention. Each line says what, and the figure is a count you can check — nothing here is scored.`
}

/** Whole days from one ISO day-string to another. Negative when the first is later. */
function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}
