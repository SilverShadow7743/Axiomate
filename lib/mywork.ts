/**
 * What one person has to do, gathered from everywhere it is scattered.
 *
 * Pure — the clock is a parameter.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * The tree is organised by client and project. That is right for delivery and wrong for a
 * consultant deciding what to do next: their work sits across three engagements, in six different
 * collections, and the only way to see it together is to configure a filter and then reconfigure
 * it. `Inbox` in the toolbar is notifications — what the rules have told somebody — not work.
 *
 * So this is the view the connected-workspace design named as a prerequisite rather than a
 * follow-on: turning mail into actions is worth little if the actions land somewhere nobody can
 * prioritise. It needs no consent, no tokens and no integration — every record it reads already
 * exists.
 *
 * ---------------------------------------------------------------------------
 * The ranking, and a correction to how this file used to describe it
 *
 * This said "there is deliberately no priority score", and that was two claims: one right and
 * one false.
 *
 * **Right:** no score is stored, and no bare number is shown. A blended figure kept as a column
 * is a derived value presented as fact, and `73` on a row is opaque — two people looking at it
 * have no way to disagree, so one person's weighting quietly becomes the product's.
 *
 * **False:** that this had no scoring function. It has one and always did — a lexicographic sort
 * over (reason, date), which is a score whose weights happen to be `reason` dominating absolutely
 * and `date` breaking ties. Describing that as "no score" hid the weights instead of removing
 * them, and hid one weight in particular: **severity was zero.** A Low-severity issue ten days
 * late outranked a High one three days late, and in the open group a High and a Low sorted
 * identically. That is not a philosophical position, it is a defect, and the framing is what
 * concealed it.
 *
 * So the rank is now written down rather than implied, and it is three parts in order:
 *
 *   1. **reason** — why this wants you at all. Still dominant, because a decision holding up
 *      another person outranks anything only you are waiting on.
 *   2. **severity** — High before Medium before Low, within a reason. The field existed the whole
 *      time and was being ignored.
 *   3. **date** — oldest first, breaking the tie. For work with no date of its own that is
 *      `lastActivity`: an issue nobody has touched since May is a different proposition from one
 *      touched yesterday, and without it the largest group on the list fell through to
 *      alphabetical order by title.
 *
 * Every row shows the two components that placed it, so the ordering is legible on the screen and
 * not only in this comment. That is the actual difference from a score: not that no judgement is
 * made, but that the judgement is decomposed and visible. `scheduleHealth` in `lib/schedule.ts`
 * already does exactly this — it blends dates, status and dependencies into one of six words,
 * recomputed and explained rather than stored — and it is the precedent this now follows.
 *
 * The group order is itself an argument rather than a preference:
 *
 *   1. `decide`  — somebody else is stopped until you act. Their waiting is the strongest claim
 *                  on your attention, and it is the only reason here that is about another person.
 *   2. `overdue` — a date you committed to has passed.
 *   3. `blocked` — waiting on somebody, and it will keep waiting unless chased.
 *   4. `attest`  — your own hours, unsubmitted. Small, and it holds up everybody's month end.
 *   5. `due`     — coming up.
 *   6. `open`    — yours, no date, nothing pressing.
 *
 * A firm that disagrees with that order changes `REASON_ORDER` and every caller follows, which is
 * the same shape `refusesTimeEntry` uses for a policy over a judgement.
 *
 * ---------------------------------------------------------------------------
 * "Mine" is a name join, and that is a known weakness
 *
 * `Issue.owner`, `TimeEntry.person` and `Timesheet.person` hold display names, while rates,
 * skills and versions key on a directory id. This resolves the actor to a directory entry and
 * then matches on name, which is what the rest of the product does — and it means somebody whose
 * display name differs from the name on their issues sees an empty list rather than an error.
 *
 * That is the structural gap `docs/pending-actions.md` records and the operating-model document
 * names as the prerequisite for three of its sections. It is not fixed here; it is named, and the
 * empty-list case is called out in `describeWork` so a person sees "nothing found for this name"
 * rather than concluding they have no work.
 */

import { can, directoryPersonFor, rolesFor } from './access'
import { BLOCKED_STATUSES, isTerminal } from './schedule'
import { weekStarting } from './timesheet'
import type { Actor } from './actor'
import type { Severity } from './types'
import type { WorkspaceState } from './workspace'

export const REASON_ORDER = ['decide', 'overdue', 'blocked', 'attest', 'due', 'open'] as const
export type WorkReason = (typeof REASON_ORDER)[number]

export const REASON_LABEL: Record<WorkReason, string> = {
  decide: 'Waiting on your decision',
  overdue: 'Past its date',
  blocked: 'Blocked',
  attest: 'Your hours',
  due: 'Coming up',
  open: 'Yours, open',
}

/**
 * The same six, phrased to sit in a comma-separated sentence.
 *
 * Separate from `REASON_LABEL` because a heading and a clause want different words, and reusing
 * the heading produced "2 blocked, 2 your hours, 30 yours, open." — where the comma inside
 * "Yours, open" reads as the next item in the list.
 */
export const REASON_PHRASE: Record<WorkReason, string> = {
  decide: 'awaiting your decision',
  overdue: 'past its date',
  blocked: 'blocked',
  attest: 'weeks of hours to submit',
  due: 'coming up',
  open: 'open with nothing pressing',
}

/**
 * The clause with its count, pluralised where the noun needs it.
 *
 * Only `attest` carries a countable noun — "1 weeks of hours to submit" was the giveaway. The
 * other five are adjectival and read correctly at any number, so this is one exception rather
 * than a pluralisation scheme nothing else needs.
 */
export function phraseFor(reason: WorkReason, n: number): string {
  if (reason === 'attest' && n === 1) return `${n} week of hours to submit`
  return `${n} ${REASON_PHRASE[reason]}`
}

export const REASON_WHY: Record<WorkReason, string> = {
  decide: 'Somebody else cannot proceed until you decide. First, because it is the only thing here that is holding up another person.',
  overdue: 'A date that was committed to has passed.',
  blocked: 'Waiting on somebody outside the delivery team, and it will keep waiting unless it is chased.',
  attest: 'Hours you have recorded and not yet submitted. Small, and it holds up a month end.',
  due: 'Coming up within the week.',
  open: 'Yours and open, with nothing pressing about it.',
}

export interface WorkItem {
  /** Stable within a list, so a screen can key on it. */
  key: string
  reason: WorkReason
  /**
   * The second component of the rank, and null where the record has no severity.
   *
   * Null sorts last within its reason rather than first: an approval carries no severity, and
   * treating "not applicable" as "most urgent" would put every decision above every High issue
   * for a reason nobody chose.
   */
  severity: Severity | null
  /** What to select when this is clicked, when there is something to select. */
  subjectId: string | null
  title: string
  /** Why this row is in front of this person, in words. */
  why: string
  /** The date that put it here. Sorted on, and shown. */
  when: string | null
}

/** How far ahead `due` looks. A week: further out is a plan, not a queue. */
export const DUE_WITHIN_DAYS = 7

export interface WorkList {
  /** Every item, in group order and then by date. */
  items: WorkItem[]
  counts: Record<WorkReason, number>
  /** True when the actor resolved to nobody in the directory — see the module note. */
  unrecognised: boolean
  /** The name that was matched on, so a screen can say what it looked for. */
  matchedName: string
}

/** High before Medium before Low; anything without one sorts after all three. */
const SEVERITY_RANK: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 }
const severityRank = (s: Severity | null) => (s ? SEVERITY_RANK[s] : 3)

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

/**
 * Everything that wants this person, and why.
 *
 * Takes the whole state because it reads six collections; taking six parameters would put the
 * question of which six into every caller.
 */
export function myWork(state: WorkspaceState, actor: Actor, today: string): WorkList {
  const person = directoryPersonFor(state.model, actor)
  const name = (person?.name ?? actor.name ?? '').trim()
  const mine = name.toLowerCase()
  const items: WorkItem[] = []

  const holds = (key: Parameters<typeof can>[2]) => can(state.model, actor, key).allowed
  const isMe = (who: string | null | undefined) => (who ?? '').trim().toLowerCase() === mine

  /* ---------------- 1. decisions somebody is waiting on ---------------- */

  const roles = new Set(rolesFor(state.model, actor))
  for (const a of Object.values(state.approvals)) {
    if (a.decision) continue
    const rule = state.model.approvalRules.find((r) => r.id === a.ruleId)
    // A rule that no longer exists cannot say who may decide, so it is not claimed by anybody
    // rather than being offered to everybody.
    if (!rule || !rule.deciderRoleIds.some((r) => roles.has(r))) continue
    if (isMe(a.requestedBy)) continue
    items.push({
      key: `appr:${a.id}`,
      reason: 'decide',
      severity: null,
      subjectId: a.subjectId,
      title: a.question || 'Approval',
      why: `${a.requestedBy} asked on ${a.requestedAt.slice(0, 10)}.`,
      when: a.requestedAt.slice(0, 10),
    })
  }

  if (holds('time.approve')) {
    for (const t of Object.values(state.timesheets)) {
      if (t.status !== 'Submitted' || isMe(t.person)) continue
      items.push({
        key: `ts:${t.id}`,
        reason: 'decide',
        severity: null,
        subjectId: null,
        title: `${t.person}'s week of ${t.weekStarting}`,
        why: 'Submitted and awaiting approval. Hours are frozen until it is decided.',
        when: t.submittedAt.slice(0, 10),
      })
    }
  }

  if (holds('milestone.accept')) {
    for (const m of Object.values(state.milestones)) {
      if (m.deletedAt || m.delivery !== 'Delivered' || m.acceptance !== 'Pending') continue
      // The reducer refuses acceptance by whoever recorded the delivery, so offering it here
      // would be a row that cannot be acted on.
      if (isMe(m.deliveredBy)) continue
      items.push({
        key: `ms:${m.id}`,
        reason: 'decide',
        severity: null,
        subjectId: m.sowId,
        title: `Milestone: ${m.name}`,
        why: `Delivered on ${m.deliveredAt?.slice(0, 10) ?? 'an unrecorded date'} and not billable until accepted.`,
        when: m.deliveredAt?.slice(0, 10) ?? null,
      })
    }
  }

  if (holds('change.approve')) {
    for (const c of Object.values(state.changes)) {
      if (c.deletedAt || c.status !== 'Submitted' || isMe(c.requestedBy)) continue
      items.push({
        key: `cr:${c.id}`,
        reason: 'decide',
        severity: null,
        subjectId: c.sowId,
        title: `Change: ${c.title}`,
        why: `${c.requestedBy} raised it. ${c.effortHours > 0 ? '+' : ''}${c.effortHours}h, and not in the contracted total until decided.`,
        when: c.requestedAt.slice(0, 10),
      })
    }
  }

  if (holds('scope.approve')) {
    const pending = Object.values(state.scopeItems).filter((i) => !i.deletedAt && !i.approvedAt)
    // Grouped per statement of work rather than one row per line: forty unagreed lines is one
    // job, and forty rows would bury everything else on this list.
    const bySow = new Map<string, number>()
    for (const i of pending) bySow.set(i.sowId, (bySow.get(i.sowId) ?? 0) + 1)
    for (const [sowId, n] of bySow) {
      items.push({
        key: `scope:${sowId}`,
        reason: 'decide',
        severity: null,
        subjectId: sowId,
        title: `${n} line${n === 1 ? '' : 's'} of scope to agree`,
        why: 'Recorded and not yet agreed, so the hours are left out of the scope total.',
        when: null,
      })
    }
  }

  /* ---------------- 2. your own work ---------------- */

  for (const issue of Object.values(state.issues)) {
    if (issue.deletedAt || !isMe(issue.owner) || isTerminal(issue.status)) continue

    if (BLOCKED_STATUSES.includes(issue.status)) {
      items.push({
        key: `issue:${issue.id}`,
        reason: 'blocked',
        severity: issue.severity,
        subjectId: issue.id,
        title: `${issue.id} ${issue.subject}`,
        why: `${issue.severity} · “${issue.status}” since ${issue.lastActivity}.`,
        when: issue.lastActivity,
      })
      continue
    }

    const due = issue.plannedEnd
    if (due && due < today) {
      const late = daysBetween(due, today)
      items.push({
        key: `issue:${issue.id}`,
        reason: 'overdue',
        severity: issue.severity,
        subjectId: issue.id,
        title: `${issue.id} ${issue.subject}`,
        // Both components of the rank, so the order on screen explains itself.
        why: `${issue.severity} · due ${due}, ${late} day${late === 1 ? '' : 's'} ago.`,
        when: due,
      })
      continue
    }
    if (due && daysBetween(today, due) <= DUE_WITHIN_DAYS) {
      items.push({
        key: `issue:${issue.id}`,
        reason: 'due',
        severity: issue.severity,
        subjectId: issue.id,
        title: `${issue.id} ${issue.subject}`,
        why: `${issue.severity} · due ${due}.`,
        when: due,
      })
      continue
    }
    /*
     * Undated work sorts on how long it has been quiet.
     *
     * This group is most of the list — thirty of thirty-four for one real person — and every row
     * in it had `when: null`, so the third sort key did nothing and the order fell through to
     * alphabetical by title. Severity separated High from Low and then stopped, which is not an
     * answer to "what do I do next".
     *
     * `lastActivity` is the honest substitute. It is not a commitment and is not presented as
     * one — the row says "nothing since" rather than "due" — but an issue nobody has touched
     * since May is a different proposition from one touched yesterday, and that is exactly the
     * distinction somebody scanning this list is trying to make.
     */
    items.push({
      key: `issue:${issue.id}`,
      reason: 'open',
      severity: issue.severity,
      subjectId: issue.id,
      title: `${issue.id} ${issue.subject}`,
      why: due
        ? `${issue.severity} · due ${due}.`
        : `${issue.severity} · no date set, nothing since ${issue.lastActivity}.`,
      when: due ?? issue.lastActivity,
    })
  }

  /* ---------------- 3. your own hours ---------------- */

  if (name) {
    const weeks = new Set<string>()
    for (const e of Object.values(state.timeEntries)) {
      if (e.deletedAt || !isMe(e.person)) continue
      weeks.add(weekStarting(e.date))
    }
    for (const week of weeks) {
      /*
       * Only weeks that have ended.
       *
       * The current week is always "recorded and not submitted", every day, until it finishes —
       * a row that is permanently true is a row people learn to scroll past, and it would have
       * been on this list from Monday morning. Somebody wanting to submit early still can, from
       * the Time tab; this list is what NEEDS them, and an unfinished week does not yet.
       */
      if (weekStarting(today) === week) continue

      const sheet = Object.values(state.timesheets).find(
        (t) => isMe(t.person) && t.weekStarting === week,
      )
      // A returned week is unsubmitted again and belongs here; an approved one does not.
      if (sheet && sheet.status !== 'Rejected') continue
      items.push({
        key: `week:${week}`,
        reason: 'attest',
        severity: null,
        subjectId: null,
        title: `Your week of ${week}`,
        why: sheet ? `Returned: ${sheet.reason ?? 'no reason recorded'}.` : 'Recorded and not submitted.',
        when: week,
      })
    }
  }

  /* ---------------- order ---------------- */

  const rank = (r: WorkReason) => REASON_ORDER.indexOf(r)
  items.sort(
    (a, b) =>
      // 1. Why it wants you.
      rank(a.reason) - rank(b.reason) ||
      // 2. How bad it is. This was missing, and its absence was the defect the old "no score"
      //    framing concealed — severity is the field a delivery firm ranks by first.
      severityRank(a.severity) - severityRank(b.severity) ||
      // 3. How long it has waited. A null date sorts last: no claim to urgency.
      (a.when === b.when ? a.title.localeCompare(b.title) : (a.when ?? '9999').localeCompare(b.when ?? '9999')),
  )

  const counts = Object.fromEntries(REASON_ORDER.map((r) => [r, 0])) as Record<WorkReason, number>
  for (const i of items) counts[i.reason] += 1

  return { items, counts, unrecognised: !person, matchedName: name }
}

/**
 * One sentence for the top of the list.
 *
 * The empty case is two different statements and they must not be collapsed. "Nothing is waiting
 * for you" is good news; "nothing matched your name" is a join that failed, and a person told the
 * first when the second is true concludes they are up to date.
 */
export function describeWork(list: WorkList): string {
  if (list.unrecognised) {
    return `Nothing here is matched to you: “${list.matchedName}” is not in the directory, and work is found by name. That is a gap in the record rather than an empty in-tray.`
  }
  if (!list.items.length) {
    return `Nothing is waiting for you under “${list.matchedName}”.`
  }
  const lead = REASON_ORDER.filter((r) => list.counts[r]).map((r) => phraseFor(r, list.counts[r]))
  const decide = list.counts.decide
  return decide
    ? `${lead.join(', ')}. The ${decide === 1 ? 'one' : decide} awaiting your decision ${decide === 1 ? 'is' : 'are'} holding somebody else up.`
    : `${lead.join(', ')}.`
}
