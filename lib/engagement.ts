import type { WorkspaceState } from './workspace'

/**
 * Engagement details.
 *
 * An engagement is the commercial and delivery envelope around a body of work for one client:
 * what it is called, what kind of work it is, when it runs, and who on each side is answerable
 * for it. None of that is in the issue log — the log records issues, not contracts — so every
 * recorded field below starts empty and stays empty until somebody who knows fills it in.
 *
 * The split this file exists to enforce:
 *
 *   RECORDED   name, code, type, status, dates, leader, manager, sponsor, SOW reference.
 *              Stored. Empty until entered. Rendered as "Not recorded", never as a guess.
 *
 *   DERIVED    issue counts, date span, process areas, owners, accountable parties, status
 *              spread. Computed from the log on every render, never stored — the same rule
 *              that keeps `duration` and `scheduleHealth` out of the database.
 *
 * Inventing a plausible engagement name would make this screen look finished and be wrong,
 * and wrong in the way that is hardest to detect later: it would read exactly like a fact.
 */

export const ENGAGEMENT_TYPES = [
  'Implementation',
  'Rollout',
  'Support',
  'Hypercare',
  'Advisory',
  'Managed Service',
] as const
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number]

export const ENGAGEMENT_STATUSES = ['Active', 'On hold', 'Closed'] as const
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number]

export interface EngagementDetail {
  /** The hierarchy node this describes. */
  nodeId: string
  /** Client code the engagement belongs to, denormalised for display. */
  client: string
  /** Internal reference, e.g. a project code. Empty until recorded. */
  code: string
  type: EngagementType | ''
  status: EngagementStatus | ''
  startDate: string | null
  endDate: string | null
  /** Axiocloud side. */
  engagementLeader: string
  projectManager: string
  /** Client side. */
  clientSponsor: string
  /** Statement of work reference. */
  sowReference: string
  notes: string
  updatedAt: string | null
  updatedBy: string | null
}

export function blankEngagement(nodeId: string, client: string): EngagementDetail {
  return {
    nodeId,
    client,
    code: '',
    type: '',
    status: '',
    startDate: null,
    endDate: null,
    engagementLeader: '',
    projectManager: '',
    clientSponsor: '',
    sowReference: '',
    notes: '',
    updatedAt: null,
    updatedBy: null,
  }
}

/** Fields a person has to supply. Used to report how complete the record is, honestly. */
export const RECORDED_FIELDS: { key: keyof EngagementDetail; label: string }[] = [
  { key: 'code', label: 'Code' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'startDate', label: 'Start date' },
  { key: 'endDate', label: 'End date' },
  { key: 'engagementLeader', label: 'Engagement leader' },
  { key: 'projectManager', label: 'Project manager' },
  { key: 'clientSponsor', label: 'Client sponsor' },
  { key: 'sowReference', label: 'SOW reference' },
]

export function recordedCount(e: EngagementDetail): { filled: number; total: number } {
  const filled = RECORDED_FIELDS.filter((f) => {
    const v = e[f.key]
    return typeof v === 'string' ? v.trim().length > 0 : v != null
  }).length
  return { filled, total: RECORDED_FIELDS.length }
}

/* ================================================================== *
 * Derived facts
 * ================================================================== */

export interface ScopeSummary {
  issues: number
  open: number
  closed: number
  /** Earliest raised → latest activity across the issues in scope. */
  firstRaised: string | null
  lastActivity: string | null
  processAreas: string[]
  owners: number
  parties: string[]
  statusCounts: { status: string; count: number }[]
}

const CLOSED = ['Closed - confirmed', 'Closed - no defect', 'Superseded']

/**
 * Summarise everything beneath a node.
 *
 * Every figure here comes from the issues themselves, so it is always current and never needs
 * reconciling with a stored copy. An engagement with nothing assigned to it reports zeros,
 * which is the truthful answer rather than an error.
 */
export function summariseScope(state: WorkspaceState, nodeId: string): ScopeSummary {
  const issues = issuesUnder(state, nodeId)

  const raised = issues.map((i) => i.raised).filter(Boolean).sort()
  const activity = issues.map((i) => i.lastActivity).filter(Boolean).sort()
  const counts = new Map<string, number>()
  for (const i of issues) counts.set(i.status, (counts.get(i.status) ?? 0) + 1)

  return {
    issues: issues.length,
    open: issues.filter((i) => !CLOSED.includes(i.status)).length,
    closed: issues.filter((i) => CLOSED.includes(i.status)).length,
    firstRaised: raised[0] ?? null,
    lastActivity: activity[activity.length - 1] ?? null,
    processAreas: [...new Set(issues.map((i) => i.module).filter(Boolean))].sort(),
    owners: new Set(issues.map((i) => i.owner).filter((o) => o && o !== 'Unassigned')).size,
    parties: [...new Set(issues.map((i) => i.accountable).filter(Boolean))].sort(),
    statusCounts: [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  }
}

/** Live issues anywhere beneath a node, at any depth. */
function issuesUnder(state: WorkspaceState, nodeId: string) {
  const inScope = new Set<string>([nodeId])
  // Nodes are few and shallow; repeat until the frontier stops growing rather than recursing.
  let grew = true
  while (grew) {
    grew = false
    for (const n of Object.values(state.nodes)) {
      if (n.deletedAt || inScope.has(n.id)) continue
      if (n.parentId && inScope.has(n.parentId)) {
        inScope.add(n.id)
        grew = true
      }
    }
  }
  return Object.values(state.issues).filter((i) => !i.deletedAt && inScope.has(i.parentId))
}

/**
 * What sits directly under a client but not under any of its engagements.
 *
 * Seeded engagements start with nothing assigned: the log says which client an issue belongs
 * to and never says which engagement, so putting all 142 OAPIL issues under one engagement
 * would be asserting there is only one. This is the number that makes that state legible
 * instead of looking like a bug.
 */
export function unassignedUnder(state: WorkspaceState, clientNodeId: string): number {
  const engagements = Object.values(state.nodes).filter(
    (n) => n.kind === 'engagement' && !n.deletedAt && n.parentId === clientNodeId,
  )
  if (!engagements.length) return 0
  const total = summariseScope(state, clientNodeId).issues
  const assigned = engagements.reduce((n, e) => n + summariseScope(state, e.id).issues, 0)
  return total - assigned
}
