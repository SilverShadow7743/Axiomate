import type { ScheduleRow, Severity, SlaPolicy } from './types'
import { isTerminal, proposeTargetDate } from './schedule'

/**
 * Turning the SLA policy into actual due dates.
 *
 * The policy has always been able to *suggest* — a dashed bar on the timeline, a proposal on
 * one issue at a time. What it could not do was commit, which left the imported log with no
 * due dates at all and every schedule-derived signal inert: nothing was ever Overdue, nothing
 * was ever At Risk, and the daily IMS had a section that was structurally always empty.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 *
 * A derived value becoming a recorded one is the sharpest thing this codebase does, and it is
 * only defensible when a person chooses it deliberately and the trail says exactly how the
 * number was reached. So:
 *
 *  - Nothing here writes. This produces a plan; applying it is a separate, confirmed action.
 *  - Every date carries its arithmetic into the audit entry — severity, working days, and the
 *    raised date it counted from — so a due date can always be traced back to the policy
 *    rather than looking like somebody's judgement.
 *  - Records that already have a due date are never touched. A date somebody set is a
 *    commitment, and silently replacing it with a computed one would be the worst outcome
 *    available here.
 *
 * ---------------------------------------------------------------------------
 * The uncomfortable part, stated up front
 *
 * The policy counts from the date an issue was raised, and this log holds issues raised months
 * ago. Applying it therefore lands most targets in the past, and those records become Overdue
 * the moment it is done.
 *
 * That is the correct answer, not a bug: an issue raised in May with a five-working-day target
 * and still open in August *is* overdue, and the only reason it did not say so is that nobody
 * had ever written the target down. The plan reports how many will land in the past before
 * anything is committed, because being told that afterwards would feel like the tool did
 * something to you.
 */

export interface SlaPlanRow {
  id: string
  subject: string
  severity: Severity
  /** Counted from here — the recorded raised date. */
  raised: string
  target: string
  /** Working days the policy allows for this severity. */
  allowed: number
  /** True when the computed target is already behind `today`. */
  alreadyPast: boolean
}

export interface SlaPlan {
  policy: SlaPolicy
  rows: SlaPlanRow[]
  /** Counted so the preview can explain what it is *not* doing, which is most of the records. */
  skipped: {
    closed: number
    alreadyScheduled: number
    noRaisedDate: number
  }
  bySeverity: Record<Severity, number>
  /** How many targets land behind today — the number that turns into Overdue. */
  past: number
}

/**
 * Which records would get a date, and what it would be.
 *
 * Takes rows rather than the whole workspace so the caller's filters decide the scope: the
 * same rule the daily IMS follows, and for the same reason — a bulk action whose reach differs
 * from what is on screen is one people apply once and then distrust.
 */
export function planSlaDates(rows: ScheduleRow[], sla: SlaPolicy, today: string): SlaPlan {
  const issues = rows.filter((r) => r.kind === 'issue')
  const skipped = { closed: 0, alreadyScheduled: 0, noRaisedDate: 0 }
  const out: SlaPlanRow[] = []

  for (const r of issues) {
    if (isTerminal(r.status)) {
      skipped.closed += 1
      continue
    }
    // A date already here is a commitment somebody made. Never overwritten.
    if (r.plannedEndDate) {
      skipped.alreadyScheduled += 1
      continue
    }
    const raised = r.issue?.raised
    if (!raised) {
      // Nothing to count from. Inventing a start date would make the target fiction.
      skipped.noRaisedDate += 1
      continue
    }
    const severity = (r.severity ?? 'Medium') as Severity
    const target = proposeTargetDate(raised, severity, sla)
    out.push({
      id: r.displayId || r.id,
      subject: r.name,
      severity,
      raised,
      target,
      allowed: sla[severity],
      alreadyPast: target < today,
    })
  }

  const bySeverity: Record<Severity, number> = { High: 0, Medium: 0, Low: 0 }
  for (const r of out) bySeverity[r.severity] += 1

  return {
    policy: sla,
    // Soonest target first: the ones already furthest past are what a reader wants to see.
    rows: out.sort((a, b) => a.target.localeCompare(b.target)),
    skipped,
    bySeverity,
    past: out.filter((r) => r.alreadyPast).length,
  }
}

/**
 * The sentence written into the audit entry for one date.
 *
 * Carries the whole derivation, so a due date can never be mistaken later for a commitment
 * somebody made by hand — which, once these dates start driving Overdue in a status report,
 * is a distinction people will need.
 */
export function slaReason(row: SlaPlanRow): string {
  return `Set from the SLA policy: ${row.severity} allows ${row.allowed} working days from the raised date (${row.raised}).`
}
