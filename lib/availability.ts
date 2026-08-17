import { capacityFor, profileAt, describeCapacity, type Allocation, type Commitment, type CapacityPosition } from './capacity'
import type { IssueRecord, WorkspaceState } from './workspace'

/**
 * Whether the person being given work is there to do it.
 *
 * ---------------------------------------------------------------------------
 * What was missing
 *
 * Capacity was already modelled — a working pattern, leave, and allocations, with the
 * arithmetic in `./capacity` — and `upsertAllocation` consults it before committing somebody's
 * hours. Assignment did not. Ownership is the field a delivery firm actually changes twenty
 * times a day, and it went through the reducer untouched: an issue could be handed to a person
 * on leave for the fortnight, to somebody already committed past their week, or to a name that
 * exists nowhere but in the cell it was typed into.
 *
 * ---------------------------------------------------------------------------
 * Three answers, not two
 *
 * The verdict is deliberately not a boolean. A capacity model over a half-filled directory
 * produces two very different "no problem"s, and collapsing them is the failure this module
 * exists to avoid:
 *
 *  - **clear** — computed. There are records about this person's time, and they leave room.
 *  - **unknown** — there are no records. `capacityFor` will still return a number here,
 *    because it falls back to a default working pattern, and that number is 7.5 hours a day of
 *    somebody nobody has ever described. Reporting it as availability would be inventing the
 *    fact the whole check exists to establish.
 *
 * A firm importing sixty owner names from a spreadsheet is in the second case for every one of
 * them. Telling them "Priya is free" on that evidence is worse than telling them nothing: it is
 * the same silence, wearing a number.
 *
 * ---------------------------------------------------------------------------
 * Refusing versus saying so
 *
 * Only absence refuses. The line is between a fact and a judgement:
 *
 *  - **away** — every working hour in the window is leave, a public holiday or an internal
 *    commitment. The person is not at work. Naming them owner asserts something that is not
 *    true, and the reducer refuses it — with the same escape hatch `upsertAllocation` gives
 *    overallocation, because a manager assigning cover for someone's return is making a real
 *    decision and a system that forbids it gets worked around.
 *  - **committed** — they are at work and have nothing left. That is a load judgement, and
 *    ownership consumes no hours in this model: refusing it would block the triage that names
 *    who is looking at something. It is recorded, in the audit trail, against the change that
 *    caused it — which is the part that was missing, not the veto.
 */

export type AvailabilityKind =
  /** Nothing in the window is theirs to work. */
  | 'away'
  /** At work, with nothing left over the window. */
  | 'committed'
  /** Room to spare, and records to say so. */
  | 'clear'
  /** No records. Not the same as free. */
  | 'unknown'

/**
 * When the work is expected to be done.
 *
 * Planned dates when the record carries them; otherwise the day the decision is being made.
 * The fallback is not a guess about the plan — it is the narrowest honest question, "is this
 * person at work today", and it is the only one an unplanned record supports. `source` travels
 * with the dates so a refusal can say which window it judged, rather than quoting figures the
 * reader cannot place.
 *
 * The alternative was to derive a window from the SLA due date, which would have covered more
 * records and invented a start date for every one of them.
 */
export interface AssignmentWindow {
  from: string
  to: string
  source: 'planned' | 'today'
}

export interface AvailabilityVerdict {
  kind: AvailabilityKind
  person: string
  window: AssignmentWindow
  /** null when nothing is known — the arithmetic would be over a default nobody entered. */
  position: CapacityPosition | null
  /** One sentence naming the person, the window and the work, for a refusal or the audit trail. */
  message: string
}

export function assignmentWindow(
  issue: Pick<IssueRecord, 'plannedStart' | 'plannedEnd'>,
  now: string,
): AssignmentWindow {
  const today = now.slice(0, 10)
  const from = issue.plannedStart || ''
  const to = issue.plannedEnd || ''
  // Both ends, or neither. One planned date describes a deadline, not a period, and stretching
  // it to the other end of the window would be reading a plan nobody wrote.
  if (from && to && to >= from) return { from, to, source: 'planned' }
  return { from: today, to: today, source: 'today' }
}

/** How the window reads inside a sentence about somebody's time. */
function windowPhrase(w: AssignmentWindow): string {
  return w.source === 'planned'
    ? `over ${w.from} → ${w.to}, when this work is planned`
    : `today (${w.from})`
}

/** Live records of this person's that touch the window at all. */
function touching<T extends { person: string; startDate: string; endDate: string; deletedAt: string | null }>(
  records: T[],
  key: string,
  w: AssignmentWindow,
): T[] {
  return records.filter(
    (r) =>
      !r.deletedAt &&
      r.person.trim().toLowerCase() === key &&
      r.startDate <= w.to &&
      r.endDate >= w.from,
  )
}

/**
 * What is known about one person's time over one window.
 *
 * Everything is read from the commitment and allocation records on each call. Nothing about
 * availability is stored on a person, and could not be: it is true of a window, and the window
 * moves every time somebody drags a date.
 */
export function availabilityOf(
  state: WorkspaceState,
  person: string,
  window: AssignmentWindow,
  /** What is being assigned, so a refusal names both sides of the clash. */
  about: string,
): AvailabilityVerdict {
  const name = person.trim()
  const base = { person: name, window, position: null }

  // "Unassigned" is the absence of an owner, not a person with a diary.
  if (!name || name === 'Unassigned') {
    return { ...base, kind: 'clear', message: `${about} has no owner named, so there is nobody whose time it could clash with.` }
  }

  const key = name.toLowerCase()
  const match = Object.values(state.model.people).find((p) => p.name.trim().toLowerCase() === key)
  if (!match) {
    return {
      ...base,
      kind: 'unknown',
      message: `“${name}” is not in the people directory, so nothing can be checked about their time — ${about} has an owner the workspace cannot find, which is not the same as one who is free.`,
    }
  }

  // At the start of the window, not as it stands today — the same reading `profileFor` takes.
  const profile = profileAt(
    Object.values(state.versions),
    state.model.resourceProfiles,
    match.id,
    window.from,
  )
  const commitments = touching(Object.values(state.commitments) as Commitment[], key, window)
  const allocations = touching(Object.values(state.allocations) as Allocation[], key, window)

  /**
   * No working pattern, no leave, no allocations — and `capacityFor` would answer anyway, from
   * a default profile. That answer is arithmetic over an assumption, so it is not reported.
   */
  if (!profile && !commitments.length && !allocations.length) {
    return {
      ...base,
      kind: 'unknown',
      message: `Nothing is recorded about ${name}'s time ${windowPhrase(window)}: no working pattern, no leave and no allocations. ${about} may be going to somebody who is not there — the workspace cannot say either way.`,
    }
  }

  const position = capacityFor(name, profile, commitments, allocations, window.from, window.to)

  if (position.availableHours === 0) {
    return {
      ...base,
      position,
      kind: 'away',
      message: `${name} is not at work ${windowPhrase(window)}: ${position.grossHours}h of working time in that window and all of it is leave, holiday or internal commitment. Owning ${about} means being on it while they are away.`,
    }
  }

  if (position.remainingHours <= 0) {
    return {
      ...base,
      position,
      kind: 'committed',
      message: `${name} is already committed to ${position.allocatedHours}h against ${position.availableHours}h available ${windowPhrase(window)}, so ${about} goes to somebody with no time left for it.`,
    }
  }

  return { ...base, position, kind: 'clear', message: describeCapacity(position) }
}

/**
 * The verdict on giving one record to one person.
 *
 * Takes the whole workspace and returns a judgement, so the rule can be exercised — and
 * argued with — without a database, a request or a screen.
 */
export function availabilityForAssignment(
  state: WorkspaceState,
  issue: Pick<IssueRecord, 'id' | 'plannedStart' | 'plannedEnd'>,
  person: string,
  now: string,
): AvailabilityVerdict {
  return availabilityOf(state, person, assignmentWindow(issue, now), issue.id)
}

/**
 * Whether this verdict stops the assignment.
 *
 * Separate from the verdict so the judgement and the policy over it can move independently: a
 * firm that wants overcommitment to refuse as well changes this, and every caller obeys.
 */
export function refusesAssignment(v: AvailabilityVerdict): boolean {
  return v.kind === 'away'
}

/**
 * What the audit trail should carry about this assignment, if anything.
 *
 * Absent for a clear verdict — a change that had nothing wrong with it needs no explanation,
 * and a reason on every owner change would make the ones that matter unreadable.
 */
export function availabilityNote(v: AvailabilityVerdict): string | undefined {
  return v.kind === 'clear' ? undefined : v.message
}
