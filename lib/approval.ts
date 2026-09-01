import { ISSUE_STATUSES, type IssueStatus } from './types'

/**
 * A decision somebody with authority has to make before work may proceed.
 *
 * ---------------------------------------------------------------------------
 * What makes this an approval rather than a field called "approved"
 *
 * Three things, and a mechanism missing any of them is decoration:
 *
 *  1. **It gates something.** An approval that blocks nothing is a checkbox. Here a rule names
 *     a transition, and the record cannot make that transition until the approval exists and
 *     says yes. The gate rides on the transition graph the status field already goes through,
 *     rather than being a second, parallel notion of "allowed".
 *  2. **Not everybody can give it.** A rule names the roles that may decide. Without that,
 *     "approved" means "somebody clicked", which is exactly what a client disputing a change
 *     order will point out.
 *  3. **Not the person who asked.** Requesting and deciding are different acts by different
 *     people. This is the one rule with no configuration switch: a self-approval is not a
 *     weaker control, it is the absence of one, and a firm that wants it can widen the decider
 *     roles instead.
 *
 * ---------------------------------------------------------------------------
 * Why a rule rather than a flag on the work type
 *
 * Because the interesting cases differ along two axes at once — *which* work needs approval and
 * *which move* it needs approval for. A change request needs approving before work starts; a
 * closure above a value threshold needs approving before it finishes. One flag on a type could
 * express neither without inventing a second flag next to it.
 */

export interface ApprovalRule {
  id: string
  label: string
  /**
   * Work types this applies to, by label. Empty means every type.
   *
   * By label rather than id, because work types are configuration a firm creates and the label
   * is what they typed. A rule naming a type that does not exist here simply never matches,
   * which is the honest behaviour for a shipped default: no work is blocked by a rule about a
   * kind of work this firm does not do.
   */
  workTypes: string[]
  /** The move it gates. The record cannot enter this status without an approved decision. */
  status: IssueStatus
  /** Roles permitted to decide. Empty means nobody can — which `ruleProblems` refuses. */
  deciderRoleIds: string[]
  /** Shown to whoever is asked, so the decision is made against a stated question. */
  question: string
  enabled: boolean
}

export type ApprovalDecision = 'approved' | 'rejected'

export interface Approval {
  /** `appr-12`, minted from the workspace counter. */
  id: string
  /** The record it is about. Issues today; the shape does not assume that. */
  subjectId: string
  ruleId: string
  /** Copied from the rule when requested, so a later edit to the rule cannot rewrite what was asked. */
  question: string
  note: string
  requestedBy: string
  requestedAt: string
  decision: ApprovalDecision | null
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string
  deletedAt: string | null
}

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  {
    id: 'APPR_CR_START',
    label: 'Change request approval',
    workTypes: ['Change Request'],
    // Before the work starts, not before it finishes. A change approved after delivery is a
    // record of what was already done, which is the failure mode this is meant to prevent.
    status: 'In Progress',
    deciderRoleIds: ['ROLE_ENGAGEMENT_LEAD', 'ROLE_CLIENT_SPONSOR'],
    question: 'Do you approve this change, its effort and its effect on the agreed scope?',
    enabled: true,
  },
]

export function defaultApprovalRules(): ApprovalRule[] {
  return DEFAULT_APPROVAL_RULES.map((r) => ({ ...r, workTypes: [...r.workTypes], deciderRoleIds: [...r.deciderRoleIds] }))
}

/** Live approvals against one record, newest first. */
export function approvalsFor(all: Record<string, Approval>, subjectId: string): Approval[] {
  return Object.values(all)
    .filter((a) => a.subjectId === subjectId && !a.deletedAt)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
}

/** Rules that apply to a given work type moving to a given status. */
export function rulesFor(rules: ApprovalRule[], workType: string, status: IssueStatus): ApprovalRule[] {
  return rules.filter(
    (r) => r.enabled && r.status === status && (!r.workTypes.length || r.workTypes.includes(workType)),
  )
}

/** Every rule that could ever gate a work type, whichever status it is heading for. */
export function applicableApprovalRules(rules: ApprovalRule[], workType: string): ApprovalRule[] {
  return ISSUE_STATUSES.flatMap((s) => rulesFor(rules, workType, s))
}

/**
 * Whether a record is blocked on an approval right now — a fact for another screen to show,
 * never a score. `not-applicable` means no rule could ever gate this work type; the rest name
 * exactly one of the states `ApprovalsBlock` already renders per rule.
 */
export type ApprovalGateStatus = 'not-applicable' | 'not-asked' | 'open' | 'approved' | 'rejected'

export function issueApprovalGate(
  rules: ApprovalRule[],
  approvals: Record<string, Approval>,
  issue: { id: string; type: string },
): ApprovalGateStatus {
  const applicable = applicableApprovalRules(rules, issue.type)
  if (!applicable.length) return 'not-applicable'

  const mine = approvalsFor(approvals, issue.id).filter((a) => applicable.some((r) => r.id === a.ruleId))
  if (!mine.length) return 'not-asked'

  if (mine.some((a) => !a.decision)) return 'open'

  // `approvalsFor` sorts newest first, so the first decided entry is the most recent.
  const decided = mine.find((a) => a.decision)!
  return decided.decision === 'approved' ? 'approved' : 'rejected'
}

/**
 * Whether a transition is blocked for want of an approval.
 *
 * Returns the rule that is not satisfied, or null. A rejected decision blocks exactly as a
 * missing one does, and deliberately does not clear itself: somebody has to ask again, and the
 * refusal stays on the record where a reader can see the change was declined rather than
 * never considered.
 */
export function blockingRule(
  rules: ApprovalRule[],
  approvals: Record<string, Approval>,
  subjectId: string,
  workType: string,
  status: IssueStatus,
): ApprovalRule | null {
  for (const rule of rulesFor(rules, workType, status)) {
    const satisfied = approvalsFor(approvals, subjectId).some(
      (a) => a.ruleId === rule.id && a.decision === 'approved',
    )
    if (!satisfied) return rule
  }
  return null
}

/** How an approval reads on screen, in one line. */
export function describeApproval(a: Approval): string {
  if (!a.decision) return `Awaiting a decision — asked by ${a.requestedBy}`
  return `${a.decision === 'approved' ? 'Approved' : 'Rejected'} by ${a.decidedBy} on ${a.decidedAt?.slice(0, 10)}`
}

/** Problems with a set of rules, checked before they are stored. */
export function ruleProblems(rules: ApprovalRule[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of rules) {
    if (!r.label.trim()) out.push('A rule needs a name.')
    if (seen.has(r.id)) out.push(`Two rules share the id “${r.id}”.`)
    seen.add(r.id)
    // A rule nobody can satisfy is a wall, not a control: the work reaches that status never.
    if (r.enabled && !r.deciderRoleIds.length) {
      out.push(`“${r.label}” names no role that can decide it, so nothing it gates could ever proceed.`)
    }
    if (r.enabled && !r.question.trim()) {
      out.push(`“${r.label}” asks no question. Somebody has to be told what they are approving.`)
    }
  }
  return out
}
