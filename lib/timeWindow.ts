import { daysBetween, formatShort, startOfWeek } from './dates'
import { isTerminal } from './schedule'
import { valueAt, type Version } from './versioning'
import { frozenMessage } from './timesheet'
import { WORKING_PATTERN } from './capacity'
import type { PermissionKey } from './access'
import type { IssueStatus } from './types'

/**
 * When time may be recorded against a piece of work, and against whose day.
 *
 * ---------------------------------------------------------------------------
 * Why this is one module and not four checks in the reducer
 *
 * `addTime` currently always succeeds. The window rule is the first thing that will refuse it,
 * and the person it lands on is a consultant at the end of a week with hours to record — which
 * is the worst possible audience for a guard that is subtly wrong. So the rule is stated once,
 * here, pure: no clock, no database, no framework, every date a parameter. It can be driven
 * directly before anything depends on it, and a refusal can be shown on screen *before* the
 * user tries to save rather than after they have typed the entry.
 *
 * Nothing here is stored. There is no `TimesheetEnabled` flag, for the reason nothing else
 * derived is stored either: a flag and the dates it was computed from are free to disagree, and
 * only one of them is true.
 *
 * ---------------------------------------------------------------------------
 * The window closes with the issue, not with the due date
 *
 * The obvious design closes the window at the planned end date and offers an extension when the
 * issue is still open. It is the wrong way round. Every issue that runs past its due date —
 * which is most of the ones needing attention — would generate an extension request before
 * anybody could log the time they are genuinely spending. Extensions become a formality people
 * click through, the trail fills with approvals nobody read, and a control that fires on the
 * common case has stopped being a control.
 *
 * So passing the due date produces a **warning** and never a refusal: "logged 3 days after the
 * due date, still open" is something a delivery lead can act on, and recording something true
 * should not require permission. Extension-with-reason is kept for the case that warrants it —
 * logging against an issue that is already **closed**.
 *
 * ---------------------------------------------------------------------------
 * Two absences that are not zeroes
 *
 * The opening date falls back from `plannedStart` to `raised`, and says so. A derived date is
 * free to fall back; it is not free to present the fallback as a recorded plan. The vocabulary
 * is the one `lib/intake.ts` already uses for exactly this — `stated | guessed | default`.
 *
 * The daily cap comes from the person's working pattern *on the work date*, through `valueAt`,
 * which answers null when nothing was recorded then. That null is reported as **unenforced**,
 * not replaced with eight. Eight hours is a copy of something nobody said, and checking a
 * consultant's day against it is the invention this codebase is built to refuse — the same rule
 * `availabilityOf` keeps when it answers `unknown` rather than `clear`.
 */

/* ================================================================== *
 * What the rule reads
 * ================================================================== */

/**
 * The issue, in the four fields the window depends on.
 *
 * Structural rather than `Pick<IssueRecord, …>` so this module imports nothing from the
 * reducer: the rule is meant to run in a browser control, in a test and in `addTime` without
 * dragging a workspace behind it.
 *
 * `deletedAt` is deliberately absent. Archiving is a different act from closing — the reducer
 * already refuses an archived record in its own words — and folding it in here would tell
 * somebody their issue is closed when it has been withdrawn.
 */
export interface WindowIssue {
  id: string
  /** null for a record whose status was never set; that is not closed, so the window is open. */
  status: IssueStatus | null
  /** Whose work it is. Anybody else recording against it needs the permission below. */
  owner: string
  /** `raisedDate` on the schema, `raised` on the reducer's record. The fallback opening. */
  raised: string
  plannedStart: string | null
  /** The due date. Drives a warning, never a refusal — see the header. */
  plannedEnd: string | null
}

/**
 * The person doing the recording, and what they hold.
 *
 * Permissions are passed in rather than resolved from the operating model, because resolving
 * them needs `can()`, which needs the model, which would make this module impure for the sake
 * of a set membership test.
 */
export interface WindowPerson {
  name: string
  permissions: readonly PermissionKey[]
}

/**
 * The permission that lets somebody record hours that are not their own.
 *
 * The design writes this `time.logForOthers`. The permission that exists is
 * `time.recordForOthers` (`lib/access.ts`), and it is already what the `addTime` arm checks —
 * so the real key wins over the design's spelling, and the type import means a rename cannot
 * leave this silently checking a permission nobody holds.
 */
export const LOG_FOR_OTHERS: PermissionKey = 'time.recordForOthers'

/**
 * What is known about the person's week.
 *
 * A timesheet is `(person, week starting Monday, status)` and none is created in advance, so
 * `none` — nobody has submitted anything for this week — is a real state and the common one,
 * not a missing value. `rejected` is not frozen: a returned week is editable again, which is
 * the whole point of sending it back.
 */
export type WeekState = 'none' | 'submitted' | 'approved' | 'rejected'

/* ================================================================== *
 * When the window opens
 * ================================================================== */

/**
 * Where the opening date came from.
 *
 * `guessed` cannot occur today and the union carries it anyway. Nothing infers a start date:
 * deriving one from the SLA, or from the raised date plus a few days, would cover more records
 * and invent a plan for every one of them — the same refusal `AssignmentWindow` makes when it
 * declines to stretch one planned date into a period. The value is declared so that the day
 * something *does* guess, it has a word for it and does not have to borrow `stated`.
 */
export type WindowSource = 'stated' | 'guessed' | 'default'

export interface WindowOpening {
  /** The first date hours may be recorded against. */
  date: string
  source: WindowSource
  /** The second line under the window in the UI, so a fallback is never shown as a plan. */
  because: string
}

/**
 * How the window reads inside a sentence, provenance and all.
 *
 * The provenance travels with the date everywhere the date appears, which is the point of §2 of
 * the design: a window shown as "29 Jul → 20 Aug" and a window shown as "29 Jul → 20 Aug, opens
 * at the raised date — no start date set" are different claims, and only the second is true.
 */
function windowPhrase(issue: Pick<WindowIssue, 'id'>, opening: WindowOpening): string {
  return `${issue.id}'s time entry window, which ${opening.because} (${opening.date})`
}

export function windowOpening(issue: Pick<WindowIssue, 'raised' | 'plannedStart'>): WindowOpening {
  if (issue.plannedStart) {
    return { date: issue.plannedStart, source: 'stated', because: 'opens at the planned start date' }
  }
  return {
    date: issue.raised,
    source: 'default',
    because: 'opens at the raised date — no start date set',
  }
}

/* ================================================================== *
 * The verdict
 * ================================================================== */

/**
 * Why the answer is what it is.
 *
 * Enumerated rather than a boolean for the reason `AvailabilityKind` is: the caller wants to
 * offer the missing thing — a reason box for a closed issue, an approval route — and cannot do
 * that from a false. `allowed` is one kind rather than the absence of a refusal, so a verdict
 * always says something.
 */
export type TimeEntryOutcome =
  /** The hours can be recorded. Check `warnings` — allowed is not the same as unremarkable. */
  | 'allowed'
  /** The issue is finished. The only case that needs an extension with a reason. */
  | 'issue-closed'
  /** Somebody else's hours, without the permission for it. */
  | 'not-permitted'
  /** Before the work existed to be worked on. */
  | 'before-window'
  /** The week is submitted or approved, and its hours are frozen. */
  | 'week-frozen'

export interface TimeEntryVerdict {
  kind: TimeEntryOutcome
  /** The work date judged, carried back so a refusal can be placed against a row. */
  workDate: string
  /** Always populated, including on a refusal — the UI shows the window whichever way it went. */
  opening: WindowOpening
  /**
   * Things true of an allowed entry that somebody should still see.
   *
   * A list rather than a second kind, because past-the-due-date co-occurs with `allowed` and
   * collapsing the two would force the choice this module exists to avoid: warn and refuse, or
   * stay silent.
   */
  warnings: string[]
  /** One sentence naming both sides, for a refusal, a screen or the audit trail. */
  message: string
}

/**
 * Whether this person may record these hours against this issue on this day.
 *
 * The order of the checks is the order of the rule as written, and it matters: a person with no
 * right to be recording somebody else's time should be told that, not told the window opened in
 * August. The first true refusal wins and the rest are not evaluated.
 */
export function timeEntryAllowed(
  issue: WindowIssue,
  person: WindowPerson,
  workDate: string,
  /**
   * The state of that person's week. Supplied by the caller; no timesheet is read from here.
   *
   * Required, with no default. A default of `none` would let a caller skip the freeze by
   * omission and never know it had — and the freeze is the whole point of an attestation:
   * without it an approver approves a number that can change underneath them. Passing `'none'`
   * is one word, and it is a claim somebody made rather than a check nobody ran.
   */
  week: WeekState,
): TimeEntryVerdict {
  const opening = windowOpening(issue)
  const base = { workDate, opening, warnings: [] as string[] }
  const window = windowPhrase(issue, opening)

  if (isTerminal(issue.status)) {
    return {
      ...base,
      kind: 'issue-closed',
      message: `${issue.id} is “${issue.status}”, so its time entry window is shut and ${workDate} falls outside it. Hours genuinely spent on closed work can still be recorded, with a reason and an approval to reopen the window — that is what the extension is for.`,
    }
  }

  const owns = person.name.trim().toLowerCase() === issue.owner.trim().toLowerCase()
  if (!owns && !person.permissions.includes(LOG_FOR_OTHERS)) {
    return {
      ...base,
      kind: 'not-permitted',
      message: `${issue.id} belongs to ${issue.owner || 'nobody named'}, not to ${person.name}, and recording somebody else's hours needs “${LOG_FOR_OTHERS}”. Time is recorded by the person who did the work.`,
    }
  }

  if (workDate < opening.date) {
    return {
      ...base,
      kind: 'before-window',
      message: `${workDate} is before ${window}, so hours on that day were spent on something other than ${issue.id}.`,
    }
  }

  // Last, and only for a week somebody has actually presented. The freeze is what makes an
  // attestation mean anything: without it an approver approves a number that can change
  // underneath them.
  if (week === 'submitted' || week === 'approved') {
    return {
      ...base,
      kind: 'week-frozen',
      /*
       * Delegated to `lib/timesheet.ts`, which owns the freeze and its wording.
       *
       * This carried its own two sentences, and they had already drifted: the submitted one
       * matched and the approved one did not. `addTime` would then have refused in different
       * words from `updateTime` and `removeTime` for the identical situation — worse than the
       * duplication, because today those three at least agree with each other.
       *
       * This module still decides WHEN the freeze applies to a time entry. What it no longer
       * does is decide how the freeze describes itself.
       */
      message: frozenMessage(week === 'submitted' ? 'Submitted' : 'Approved', startOfWeek(workDate)),
    }
  }

  return {
    ...base,
    warnings: warningsFor(issue, workDate),
    kind: 'allowed',
    message: `${person.name} may record time against ${issue.id} on ${workDate}: the issue is still open, and ${window} was open by then.`,
  }
}

/**
 * What is worth saying about an entry that is going to be accepted anyway.
 *
 * Separate from the verdict so that the set can grow — remaining effort against the estimate is
 * the next one, and it is issue-level in a way no daily cap is — without any caller having to
 * learn a new field.
 */
function warningsFor(issue: WindowIssue, workDate: string): string[] {
  const out: string[] = []
  if (issue.plannedEnd && workDate > issue.plannedEnd) {
    const days = daysBetween(issue.plannedEnd, workDate) - 1
    out.push(
      `Logged ${days} day${days === 1 ? '' : 's'} after the due date (${issue.plannedEnd}). Still open.`,
    )
  }
  return out
}

/**
 * Whether this verdict stops the entry.
 *
 * Separate from the verdict, exactly as `refusesAssignment` is, so the judgement and the policy
 * over it move independently: a firm that wants a closed issue to warn rather than refuse
 * changes this one function and every caller obeys.
 */
export function refusesTimeEntry(v: TimeEntryVerdict): boolean {
  return v.kind !== 'allowed'
}

/** What the audit trail should carry, or nothing when the entry was unremarkable. */
export function timeEntryNote(v: TimeEntryVerdict): string | undefined {
  if (v.kind !== 'allowed') return v.message
  return v.warnings.length ? v.warnings.join(' ') : undefined
}

/* ================================================================== *
 * Backdating
 * ================================================================== */

/**
 * How late an entry may be before it has to explain itself, in days.
 *
 * A week, because that is the shape of the honest case: somebody catching up on Friday for work
 * done on Monday is inside a normal working rhythm and asking them to justify it would put a
 * reason box in front of the most ordinary act in the product. Past a week the entry is
 * reconstruction rather than recall, which is precisely when somebody should have to say why —
 * and when a second person should see it.
 */
export const BACKDATING_ALLOWANCE_DAYS = 7

export interface Backdating {
  /**
   * Whole days between the work and the claim. `daysBetween` is inclusive — same day is 1 — so
   * the subtraction is what makes this a difference rather than a span. Off by one here would
   * move the allowance a day in silence, which is why the scenario asserts both sides of it.
   */
  days: number
  backdated: boolean
  justificationRequired: boolean
  approvalRequired: boolean
  /** Null when the entry is inside the allowance and has nothing to answer for. */
  message: string | null
}

export function backdated(workDate: string, entryDate: string): Backdating {
  // Negative when the entry precedes the work, which `checkEntry` already refuses as a day that
  // has not happened. Reported as not backdated rather than as a large negative lateness.
  const days = daysBetween(workDate, entryDate) - 1
  const over = days > BACKDATING_ALLOWANCE_DAYS
  return {
    days,
    backdated: over,
    justificationRequired: over,
    approvalRequired: over,
    message: over
      ? `Recorded ${days} days after the work happened, and the allowance is ${BACKDATING_ALLOWANCE_DAYS}. An entry this late needs a reason on it and an approval behind it — a week reconstructed from memory is exactly what an auditor asks about.`
      : null,
  }
}

/* ================================================================== *
 * The daily cap
 * ================================================================== */

/** The kind `valueAt` is asked about. Also the only subject kind `recordVersion` accepts today. */
/**
 * Re-exported from `lib/capacity.ts` rather than declared again.
 *
 * It WAS declared again — the same string in two modules, which is the shape that let the
 * detail panel's tab list disagree with its own guard. Two constants that must be equal are two
 * constants that can stop being equal, and the day one of them changed, capacity and the daily
 * cap would have read different versions of the same fact while both looking correct.
 */
export { WORKING_PATTERN }

/**
 * The part of a working pattern this rule reads.
 *
 * `recordVersion` types a version's value as opaque, so nothing guarantees the shape of what
 * was stored. A version that exists but carries no usable `hoursPerDay` is therefore a second
 * unknown, not a zero — and it is reported the same way as no version at all.
 */
export interface WorkingPatternValue {
  hoursPerDay?: unknown
}

export interface DailyCap {
  kind: 'enforced' | 'unenforced'
  /** Null whenever the cap is unenforced. There is no number to fall back to. */
  hoursPerDay: number | null
  /** Which version it came from, so an applied cap can be traced to what was recorded. */
  fromVersion: string | null
  message: string
}

/**
 * The most hours this person's day held, on the day they worked.
 *
 * Read at `workDate` rather than today, which is the point of effective dating: hours logged in
 * June are checked against June's pattern even if the person moved to a four-day week in July.
 *
 * **Unenforced is the honest answer, not a gap.** `valueAt` returns null when nothing covered
 * the date — before somebody joined, or for a person nobody has described — and the tempting
 * fix of defaulting to eight would still produce a plausible number while destroying the only
 * property this check has. A consultant is not told their day is too long on the authority of a
 * working week nobody entered.
 *
 * Note also what this cap is *not*: a per-issue maximum. A person splitting a day across three
 * issues has one day, and three caps of eight would permit twenty-four hours in it. The cap
 * belongs to the person and the date, which is why both are arguments and the issue is not.
 */
export function dailyCap(
  versions: Version<unknown>[],
  personId: string,
  workDate: string,
): DailyCap {
  const version = valueAt(versions, WORKING_PATTERN, personId, workDate)
  if (!version) {
    return {
      kind: 'unenforced',
      hoursPerDay: null,
      fromVersion: null,
      message: `No working pattern is recorded for ${personId} on ${workDate}, so there is no daily cap to check against. The entry stands; what a normal day was for them then is not known, and eight would be a number nobody entered.`,
    }
  }

  const hours = (version.value as WorkingPatternValue | null)?.hoursPerDay
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) {
    return {
      kind: 'unenforced',
      hoursPerDay: null,
      fromVersion: version.id,
      message: `${personId}'s working pattern at ${workDate} (${version.id}) carries no usable hours per day, so the cap is unenforced. A version that exists is not the same as a figure that can be checked.`,
    }
  }

  return {
    kind: 'enforced',
    hoursPerDay: hours,
    fromVersion: version.id,
    message: `${personId}'s day at ${workDate} is ${hours}h, from the pattern recorded in ${version.id}.`,
  }
}

/**
 * What to say when a day's total runs past the cap, or nothing.
 *
 * A warning rather than a refusal, and never anything at all when the cap is unenforced —
 * which is the whole reason `dailyCap` reports unenforced instead of substituting eight. People
 * do work eleven-hour days at go-live, and a system that refuses to record one produces hours
 * booked to the wrong day rather than fewer hours worked.
 */
export function dailyCapWarning(cap: DailyCap, hoursOnDate: number): string | null {
  if (cap.kind === 'unenforced' || cap.hoursPerDay === null) return null
  if (hoursOnDate <= cap.hoursPerDay) return null
  return `${hoursOnDate}h recorded against a ${cap.hoursPerDay}h day. Long days happen; this is worth a look rather than a refusal.`
}
