import { startOfWeek, addDays, formatShort } from './dates'
import type { TimeEntry } from './time'
import type { ApprovalDecision } from './approval'

/**
 * A week of somebody's hours, and whether it is still theirs to change.
 *
 * Pure — no clock, no database. Every function is given the state it needs, so the whole of this
 * can be driven from a scenario before anything calls it.
 *
 * ---------------------------------------------------------------------------
 * What a timesheet is here, and what it deliberately is not
 *
 * It is an **attestation over a period**, not a container of lines. The hours stay in
 * `TimeEntry` where they already are; a timesheet says "I claim this week is complete and
 * correct" and carries who said so, when, and what an approver decided.
 *
 * The alternative — copying the entries onto the timesheet at submission — was turned down. It
 * makes the submitted total durable, which sounds like the point, and it does so by keeping a
 * second copy of every hour that is then free to disagree with the first. The total is derived
 * from the entries, and the freeze below is what stops the entries moving underneath it.
 *
 * ---------------------------------------------------------------------------
 * The week is a Monday and a string
 *
 * `startOfWeek` in `lib/dates.ts` already resolves to Monday, and it is reused rather than
 * reimplemented. Stored as `YYYY-MM-DD` rather than a week number, because ISO and US week
 * numbering disagree about which week is which and neither is readable in a database row.
 */

export type TimesheetStatus = 'Submitted' | 'Approved' | 'Rejected'

export interface Timesheet {
  /** `ts-12`, minted from the workspace counter. */
  id: string
  person: string
  /** The directory id, resolved at write time; null when the name did not uniquely resolve. */
  personId?: string | null
  /** Always a Monday. */
  weekStarting: string
  status: TimesheetStatus
  submittedAt: string
  submittedBy: string
  decidedAt: string | null
  decidedBy: string | null
  /** Why it was returned. Required on a rejection, absent on an approval — see `decideProblem`. */
  reason: string | null
}

/** The Monday of the week containing this date. */
export function weekStarting(date: string): string {
  return startOfWeek(date)
}

/** "week of 17 Aug" — for a refusal somebody has to read and act on. */
export function weekLabel(week: string): string {
  return `week of ${formatShort(week)}`
}

/** Monday to Sunday inclusive, as ISO dates. */
export function daysOfWeek(week: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i))
}

/**
 * One person's entries in one week.
 *
 * Archived entries are excluded. A withdrawn hour is not part of what somebody is attesting to,
 * and including it would make a submitted total disagree with what the screen shows.
 */
export function entriesInWeek(
  entries: TimeEntry[],
  person: string,
  week: string,
  /** The person's directory id when known — id-joined rows match through a rename. */
  personId?: string | null,
): TimeEntry[] {
  const end = addDays(week, 7)
  const who = person.trim().toLowerCase()
  return entries.filter(
    (e) =>
      !e.deletedAt &&
      (e.personId && personId ? e.personId === personId : e.person.trim().toLowerCase() === who) &&
      e.date >= week &&
      e.date < end,
  )
}

/** Hours in the week, and how many of them are chargeable. */
export function weekTotal(
  entries: TimeEntry[],
  person: string,
  week: string,
  personId?: string | null,
): { hours: number; billable: number } {
  const mine = entriesInWeek(entries, person, week, personId)
  const sum = (xs: TimeEntry[]) => Math.round(xs.reduce((t, e) => t + e.hours, 0) * 100) / 100
  return { hours: sum(mine), billable: sum(mine.filter((e) => e.billable)) }
}

/** The timesheet covering a person's week, or null. */
export function sheetFor(
  sheets: Timesheet[],
  person: string,
  week: string,
  personId?: string | null,
): Timesheet | null {
  const who = person.trim().toLowerCase()
  return (
    sheets.find(
      (s) =>
        (s.personId && personId ? s.personId === personId : s.person.trim().toLowerCase() === who) &&
        s.weekStarting === week,
    ) ?? null
  )
}

/**
 * Whether hours on this date may still be changed — and if not, by which of the two states.
 *
 * Returns the **status**, not a boolean, because the two refusals call for different next moves.
 * "Awaiting approval" means find your approver; "already approved" means it is closed and
 * changing it is a correction somebody has to undo deliberately. A boolean would collapse those
 * into one message that helps with neither.
 *
 * `Rejected` is not frozen. That is the whole point of returning a week: it becomes editable
 * again so the person can fix what was wrong and resubmit.
 */
export function isFrozen(
  sheets: Timesheet[],
  person: string,
  date: string,
): TimesheetStatus | null {
  const sheet = sheetFor(sheets, person, weekStarting(date))
  if (!sheet) return null
  return sheet.status === 'Rejected' ? null : sheet.status
}

/** The refusal to show, or null. One sentence, naming the week and what unblocks it. */
export function frozenMessage(status: TimesheetStatus, week: string): string {
  return status === 'Submitted'
    ? `The ${weekLabel(week)} is submitted and awaiting approval. Hours cannot be changed until it is approved or returned to you.`
    : `The ${weekLabel(week)} is approved. Hours cannot be changed — ask an approver to return it first.`
}

export interface Attester {
  /** The display name, which is what `TimeEntry.person` holds. */
  name: string
  /** Whether this actor may submit at all. Resolved by the caller from `time.submit`. */
  maySubmit: boolean
  /** Whether this actor may decide. Resolved by the caller from `time.approve`. */
  mayApprove: boolean
}

/**
 * Why this week cannot be submitted, or null.
 *
 * **An empty week is submittable.** "I was on leave" is a claim somebody is entitled to make,
 * and the one person with nothing to report is exactly the person a refusal would strand.
 */
export function submitProblem(
  sheets: Timesheet[],
  person: string,
  week: string,
  actor: Attester,
): string | null {
  if (weekStarting(week) !== week) {
    return 'A timesheet covers a week, and a week starts on a Monday.'
  }
  if (!actor.maySubmit) return 'Submitting a timesheet is not something this account may do.'
  /*
   * Somebody submits their own week. Holding the permission is not enough — the reducer compares
   * the actor to the person on the sheet, because a timesheet is a personal attestation and one
   * made on somebody else's behalf attests to nothing.
   */
  if (person.trim().toLowerCase() !== actor.name.trim().toLowerCase()) {
    return 'A timesheet is submitted by the person whose week it is.'
  }
  const existing = sheetFor(sheets, person, week)
  if (existing?.status === 'Submitted') {
    return `The ${weekLabel(week)} is already submitted and awaiting approval.`
  }
  if (existing?.status === 'Approved') {
    return `The ${weekLabel(week)} is already approved.`
  }
  return null
}

/**
 * Why this decision cannot be made, or null.
 *
 * The asker may never be the decider. That rule is `lib/approval.ts`'s and is reimplemented here
 * rather than imported, because only half of that module fits: `Approval` is genuinely generic,
 * but `ApprovalRule` gates entry into an `IssueStatus` for a `workType` and a timesheet has
 * neither. The decision, the decider and the reason live on the timesheet row itself, so no
 * `Approval` record is created at all.
 */
export function decideProblem(
  sheet: Timesheet | null,
  decision: ApprovalDecision,
  reason: string | undefined,
  actor: Attester,
  /** The decider's directory id. Compared as well as the name — a rename between submit and
   *  decide must not let somebody approve their own week. */
  deciderId?: string | null,
): string | null {
  if (!sheet) return 'That timesheet no longer exists.'
  if (!actor.mayApprove) return 'Deciding a timesheet is not something this account may do.'
  if (sheet.status !== 'Submitted') {
    return sheet.status === 'Approved'
      ? `The ${weekLabel(sheet.weekStarting)} has already been approved.`
      : `The ${weekLabel(sheet.weekStarting)} was returned and has not been resubmitted.`
  }
  if (
    sheet.submittedBy.trim().toLowerCase() === actor.name.trim().toLowerCase() ||
    (sheet.personId && deciderId && sheet.personId === deciderId)
  ) {
    return 'A timesheet is decided by somebody other than the person who submitted it.'
  }
  /*
   * A rejection needs a reason and an approval does not. "Yes" is complete on its own; "no"
   * leaves somebody holding a week they have to change without being told what was wrong with
   * it, and they will guess.
   */
  if (decision === 'rejected' && !reason?.trim()) {
    return 'Returning a timesheet needs a reason — the person has to know what to change.'
  }
  return null
}

/** What a decision does to the row. */
export function statusAfter(decision: ApprovalDecision): TimesheetStatus {
  return decision === 'approved' ? 'Approved' : 'Rejected'
}
