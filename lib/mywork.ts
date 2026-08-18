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
 * There is deliberately no priority score
 *
 * The obvious design is a number per item — severity times lateness plus a nudge for blocked —
 * and it is the wrong one twice over. A blended score is a derived value presented as a fact,
 * which is the thing this codebase most consistently refuses; and it is unarguable, because two
 * people looking at 73 have no way to disagree about it. Somebody's judgement then quietly
 * becomes the product's.
 *
 * Instead: items are grouped by **why they are in front of you**, the groups are ordered, and
 * every row says its reason in words. Within a group the order is the date — oldest first,
 * because the thing that has waited longest has usually waited long enough.
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
        subjectId: issue.id,
        title: `${issue.id} ${issue.subject}`,
        why: `“${issue.status}” since ${issue.lastActivity}.`,
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
        subjectId: issue.id,
        title: `${issue.id} ${issue.subject}`,
        why: `Due ${due} — ${late} day${late === 1 ? '' : 's'} ago.`,
        when: due,
      })
      continue
    }
    if (due && daysBetween(today, due) <= DUE_WITHIN_DAYS) {
      items.push({
        key: `issue:${issue.id}`,
        reason: 'due',
        subjectId: issue.id,
        title: `${issue.id} ${issue.subject}`,
        why: `Due ${due}.`,
        when: due,
      })
      continue
    }
    items.push({
      key: `issue:${issue.id}`,
      reason: 'open',
      subjectId: issue.id,
      title: `${issue.id} ${issue.subject}`,
      why: due ? `Due ${due}.` : `${issue.severity}, no date set.`,
      when: due,
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
      const sheet = Object.values(state.timesheets).find(
        (t) => isMe(t.person) && t.weekStarting === week,
      )
      // A returned week is unsubmitted again and belongs here; an approved one does not.
      if (sheet && sheet.status !== 'Rejected') continue
      items.push({
        key: `week:${week}`,
        reason: 'attest',
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
      rank(a.reason) - rank(b.reason) ||
      // Oldest first inside a group. A null date sorts last: it is the one with no claim to urgency.
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
  const lead = REASON_ORDER.filter((r) => list.counts[r]).map(
    (r) => `${list.counts[r]} ${REASON_LABEL[r].toLowerCase()}`,
  )
  const decide = list.counts.decide
  return decide
    ? `${lead.join(', ')}. The ${decide === 1 ? 'one' : decide} awaiting your decision ${decide === 1 ? 'is' : 'are'} holding somebody else up.`
    : `${lead.join(', ')}.`
}
