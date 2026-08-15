import type { IssueRecord } from './workspace'
import type { WorkspaceState } from './workspace'

/**
 * What happened, derived from what changed.
 *
 * ---------------------------------------------------------------------------
 * Derived rather than emitted
 *
 * The obvious design is for each reducer arm to emit its own events. This does the opposite:
 * it compares the state before an action with the state after, and works out what a consumer
 * would call that. The reason is the same one that keeps the permission check at the funnel
 * instead of in twenty-odd arms — an arm that forgets to emit is invisible, because the action
 * still works and nobody notices the event never fired. A comparison cannot forget.
 *
 * It also means an event is true by construction. `issue.status` cannot fire for a status that
 * did not change, because the only evidence it exists is that the two states differ.
 *
 * ---------------------------------------------------------------------------
 * What an event is not
 *
 * It is not stored, and it is not an audit entry. The audit trail is evidence — who changed
 * what, kept for as long as the record lives. An event is a message with a short life: it
 * exists to be handed to whatever cares, and then it is gone. Conflating them produces a table
 * with two retention policies and two audiences, which is the third of the three things this
 * codebase found being called "audit".
 */

export const EVENT_TYPES = [
  { key: 'issue.created', label: 'Work is raised' },
  { key: 'issue.status', label: 'Status changes' },
  { key: 'issue.owner', label: 'Owner changes' },
  { key: 'issue.severity', label: 'Severity changes' },
  { key: 'issue.scheduled', label: 'A due date is set or moved' },
  { key: 'time.recorded', label: 'Time is recorded' },
  { key: 'approval.requested', label: 'An approval is asked for' },
  { key: 'approval.decided', label: 'An approval is decided' },
  { key: 'estimate.agreed', label: 'An estimate is agreed' },
] as const

export type EventType = (typeof EVENT_TYPES)[number]['key']

export interface DomainEvent {
  type: EventType
  /** The record it happened to — an issue id for every event type so far. */
  subjectId: string
  /** For a change, what it changed from and to. Empty for a creation. */
  from: string
  to: string
  at: string
  by: string
}

/**
 * Everything that happened between two states.
 *
 * Deliberately narrow in what it inspects: issues, approvals and time. A rule cannot subscribe
 * to something this does not detect, so adding an event type is the honest cost of letting
 * firms automate against it, rather than emitting a wide stream nobody consumes.
 */
export function deriveEvents(
  before: WorkspaceState,
  after: WorkspaceState,
  at: string,
  by: string,
): DomainEvent[] {
  const out: DomainEvent[] = []
  const ev = (type: EventType, subjectId: string, from: string, to: string) =>
    out.push({ type, subjectId, from, to, at, by })

  for (const [id, issue] of Object.entries(after.issues)) {
    const was = before.issues[id] as IssueRecord | undefined
    if (!was) {
      // A record arriving from the seed import is not something that "happened" — it is
      // history being loaded. Only a creation inside a live workspace counts.
      if (Object.keys(before.issues).length) ev('issue.created', id, '', issue.status)
      continue
    }
    if (was === issue) continue
    if (was.status !== issue.status) ev('issue.status', id, was.status, issue.status)
    if (was.owner !== issue.owner) ev('issue.owner', id, was.owner, issue.owner)
    if (was.severity !== issue.severity) ev('issue.severity', id, was.severity, issue.severity)
    if (was.plannedEnd !== issue.plannedEnd) {
      ev('issue.scheduled', id, was.plannedEnd ?? '', issue.plannedEnd ?? '')
    }
  }

  for (const [id, entry] of Object.entries(after.timeEntries)) {
    if (before.timeEntries[id]) continue
    ev('time.recorded', entry.issueId, '', `${entry.hours}h`)
  }

  for (const [id, approval] of Object.entries(after.approvals)) {
    const was = before.approvals[id]
    if (!was) {
      ev('approval.requested', approval.subjectId, '', approval.ruleId)
      continue
    }
    if (!was.decision && approval.decision) {
      ev('approval.decided', approval.subjectId, approval.ruleId, approval.decision)
    }
  }

  for (const [issueId, estimate] of Object.entries(after.estimates)) {
    const was = before.estimates[issueId]
    if (!was?.baselinedAt && estimate.baselinedAt) ev('estimate.agreed', issueId, 'draft', 'agreed')
  }

  return out
}
