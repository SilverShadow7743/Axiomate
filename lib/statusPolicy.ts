import { ISSUE_STATUSES, type IssueStatus } from './types'

/**
 * Which status changes are allowed, and what a change has to carry.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * Until this module, an issue could move from any status to any other in one step. Open to
 * Closed - confirmed, with no investigation, no client involvement, no evidence and no
 * comment, was a single click in the grid — and the workspace accepted it silently. The
 * product looked as though it had a lifecycle because it *had* one, in two other senses: a
 * plan of activities (`ACTIVITY_PHASES`) and a pipeline of agents (`WorkflowRecord`). Neither
 * governs the status field, so nothing did.
 *
 * ---------------------------------------------------------------------------
 * What it is, and where it lives
 *
 * A transition table over the status vocabulary, held in the operating model rather than in
 * this file. The vocabulary itself is fixed — `STATUS_PROGRESS` derives percent complete from
 * it, so a firm inventing a status would produce records with no progress — but *how work is
 * allowed to move through it* is a delivery process, and delivery processes differ between
 * firms and sometimes between engagements. So the vocabulary is code and the graph is
 * configuration, which is the same split the product already makes between a severity and the
 * number of days that severity is allowed.
 *
 * ---------------------------------------------------------------------------
 * The one rule worth arguing about
 *
 * `Closed - confirmed` is reachable only from `Awaiting client confirmation`. It is the only
 * status whose name asserts something about the client, and reaching it directly from
 * In Progress means a consultant confirmed on the client's behalf. Every other closure route
 * stays open — `Closed - no defect` and `Superseded` are both reachable from ordinary work,
 * because deciding there is nothing to fix does not need the client's word.
 *
 * A firm that disagrees edits the table. A firm that wants none of this sets `enforced` to
 * false, which is honest in a way that shipping an unenforced table is not: the setting says
 * plainly that transitions are advisory here, rather than implying a control that does not
 * run.
 */

/** What a transition into a status must carry beyond the change itself. */
export interface StatusPolicy {
  /**
   * Whether the graph is applied at all.
   *
   * Default true. An unenforced default would reproduce the exact defect this module fixes:
   * configuration that describes a process and changes nothing.
   */
  enforced: boolean
  /** For each status, the statuses it may move to. A status absent from its own list cannot self-transition, which is a no-op anyway. */
  transitions: Record<IssueStatus, IssueStatus[]>
  /** Statuses that cannot be reached unless the issue carries at least one evidence item. */
  requireEvidence: IssueStatus[]
  /** Statuses whose transition must be explained, so the audit entry carries a why. */
  requireReason: IssueStatus[]
}

/**
 * The shipped graph.
 *
 * Read it as the route work actually takes: something arrives Open, someone picks it up, it
 * may bounce to the client and back, and it ends in one of three places — confirmed by the
 * client, agreed to be no defect, or replaced by other work. Every terminal status can be
 * reopened, because being wrong about closure is normal and archiving is a different act.
 */
export const DEFAULT_STATUS_POLICY: StatusPolicy = {
  enforced: true,
  transitions: {
    Open: ['In Progress', 'Needs clarification', 'Closed - no defect', 'Superseded'],
    'In Progress': [
      'Awaiting client confirmation',
      'Needs clarification',
      'Closed - no defect',
      'Superseded',
      'Open',
    ],
    'Needs clarification': ['In Progress', 'Open', 'Closed - no defect', 'Superseded'],
    'Awaiting client confirmation': ['Closed - confirmed', 'In Progress', 'Needs clarification'],
    // Reopening is one step and goes to In Progress: work that has been closed and is being
    // looked at again is, by definition, in progress.
    'Closed - confirmed': ['In Progress'],
    'Closed - no defect': ['In Progress'],
    Superseded: ['In Progress'],
  },
  /**
   * Only the status that claims the client agreed. Something has to be producible later, and
   * "the client said so" is the claim most likely to be disputed.
   */
  requireEvidence: ['Closed - confirmed'],
  /**
   * The two outcomes where the firm decided not to do the work. Both are defensible and both
   * get asked about months later, usually by someone who was not in the conversation.
   */
  requireReason: ['Closed - no defect', 'Superseded'],
}

export interface TransitionProblem {
  /** What to tell the person, in their terms. */
  message: string
  /** Which requirement failed, so a caller can ask for the missing thing rather than just refusing. */
  kind: 'route' | 'evidence' | 'reason'
}

export interface TransitionContext {
  /** Whether the issue has at least one live evidence item. */
  hasEvidence: boolean
  /** The reason supplied with the change, if any. */
  reason?: string
}

/** The statuses this one may move to, plus itself — what a control should offer. */
export function allowedNext(policy: StatusPolicy, from: IssueStatus | null): IssueStatus[] {
  if (!from) return [...ISSUE_STATUSES]
  if (!policy.enforced) return [...ISSUE_STATUSES]
  const next = policy.transitions[from] ?? []
  // `from` is included so a select showing the current value is not showing an invalid option.
  return [from, ...next.filter((s) => s !== from)]
}

/**
 * Check a proposed move.
 *
 * Returns null when it is allowed. Note what is *not* checked: whether the issue was ever in
 * a valid state to begin with. Six hundred records arrived from a client's spreadsheet and
 * some of them sit in combinations this graph would never produce; refusing to let those
 * records move would make the import read-only and punish people for history they did not
 * write. The graph governs changes, not the past.
 */
export function checkTransition(
  policy: StatusPolicy,
  from: IssueStatus | null,
  to: IssueStatus,
  ctx: TransitionContext,
): TransitionProblem | null {
  if (!policy.enforced) return null
  if (!from || from === to) return null

  const allowed = policy.transitions[from] ?? []
  if (!allowed.includes(to)) {
    const routes = allowed.length ? allowed.join(', ') : 'nothing'
    return {
      kind: 'route',
      message: `“${from}” cannot move straight to “${to}”. From here the work can go to: ${routes}.`,
    }
  }

  if (policy.requireEvidence.includes(to) && !ctx.hasEvidence) {
    return {
      kind: 'evidence',
      message: `“${to}” needs at least one piece of evidence on the record — that is what makes the closure producible later.`,
    }
  }

  if (policy.requireReason.includes(to) && !ctx.reason?.trim()) {
    return {
      kind: 'reason',
      message: `“${to}” needs a reason. This is the outcome people ask about months later.`,
    }
  }

  return null
}

/**
 * Problems with a transition table itself, checked before it is stored.
 *
 * A graph that cannot reach a closure is worse than no graph: work enters and never leaves,
 * and the person who edited the table finds out weeks later from someone who cannot close an
 * issue. Both checks below are reachability, from opposite ends.
 */
export function policyProblems(policy: StatusPolicy): string[] {
  const out: string[] = []

  for (const [from, to] of Object.entries(policy.transitions)) {
    for (const t of to) {
      if (!ISSUE_STATUSES.includes(t as IssueStatus)) {
        out.push(`“${from}” lists “${t}”, which is not a status.`)
      }
    }
  }

  const terminal: IssueStatus[] = ['Closed - confirmed', 'Closed - no defect', 'Superseded']
  const reaches = (start: IssueStatus, targets: IssueStatus[]): boolean => {
    const seen = new Set<IssueStatus>([start])
    const queue = [start]
    while (queue.length) {
      const cur = queue.shift()!
      if (targets.includes(cur) && cur !== start) return true
      for (const n of policy.transitions[cur] ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          queue.push(n)
        }
      }
    }
    return false
  }

  for (const s of ISSUE_STATUSES) {
    if (terminal.includes(s)) continue
    if (!reaches(s, terminal)) {
      out.push(`Work in “${s}” could never be closed — no route from it reaches a closing status.`)
    }
  }

  if (!ISSUE_STATUSES.some((s) => (policy.transitions[s] ?? []).length)) {
    out.push('Every status is a dead end. Nothing could ever move.')
  }

  return out
}

/** Restore the shipped graph, deep enough that editing the result cannot reach back into it. */
export function defaultStatusPolicy(): StatusPolicy {
  return {
    enforced: DEFAULT_STATUS_POLICY.enforced,
    transitions: Object.fromEntries(
      ISSUE_STATUSES.map((s) => [s, [...(DEFAULT_STATUS_POLICY.transitions[s] ?? [])]]),
    ) as Record<IssueStatus, IssueStatus[]>,
    requireEvidence: [...DEFAULT_STATUS_POLICY.requireEvidence],
    requireReason: [...DEFAULT_STATUS_POLICY.requireReason],
  }
}
