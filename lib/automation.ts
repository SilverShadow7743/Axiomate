import type { DomainEvent, EventType } from './events'
import type { Channel } from './notifications'
import type { Action, IssueRecord, WorkspaceState } from './workspace'

/**
 * Event → condition → action, and the one design decision that makes it safe.
 *
 * ---------------------------------------------------------------------------
 * Automation acts by dispatching actions
 *
 * A rule does not write to state. It produces the same `Action` values a person's click
 * produces, and those go through the same reducer, the same permission check, the same
 * transition graph and the same audit trail. Three consequences, all of them the point:
 *
 *  - **A rule cannot do anything a person could not.** It cannot close an issue that has no
 *    evidence, or move one along a route the graph forbids, because it is refused by the same
 *    code that would refuse the person.
 *  - **Everything it does is attributed.** The trail names the actor the rule ran as, and the
 *    audit entry carries the rule that caused it. "Why did this record change" has an answer.
 *  - **A failure is visible and partial rather than silent and total.** Actions apply one at a
 *    time; if the third is refused, the first two stand and the refusal is recorded against the
 *    rule. Nothing is half-written, because each action is whole.
 *
 * The alternative — an engine with its own write path — is faster to build and produces a
 * second set of rules about what may happen, free to disagree with the first.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately cannot do
 *
 * There is no schedule. Every rule here is a reaction to something that happened, so "every
 * day at 7am, escalate what is about to breach" is not expressible — that needs a clock and a
 * process to run it, and neither exists. The SLA watch the agent registry describes is exactly
 * this shape, and it stays declared until there is something to run it.
 */

/* ================================================================== *
 * Conditions
 * ================================================================== */

/** Fields a rule may test. Narrow on purpose: each one is a field a firm actually routes on. */
export const CONDITION_FIELDS = [
  { key: 'severity', label: 'Severity' },
  { key: 'status', label: 'Status' },
  { key: 'type', label: 'Work type' },
  { key: 'client', label: 'Client' },
  { key: 'accountable', label: 'Accountable party' },
  { key: 'owner', label: 'Owner' },
  { key: 'to', label: 'The value it changed to' },
  { key: 'from', label: 'The value it changed from' },
] as const

export type ConditionField = (typeof CONDITION_FIELDS)[number]['key']
export type ConditionOp = 'is' | 'is not' | 'is one of' | 'is empty' | 'is not empty'

export interface Condition {
  field: ConditionField
  op: ConditionOp
  /** Compared case-insensitively. For `is one of`, a comma-separated list. */
  value: string
}

/* ================================================================== *
 * Actions
 * ================================================================== */

export type RuleActionKind = 'notify' | 'setNextAction' | 'addNote' | 'requestApproval'

export interface RuleAction {
  kind: RuleActionKind
  /**
   * Who to tell. `owner`, `raisedBy`, or `role:<id>` — a role addresses every person holding
   * it, and if nobody holds it the rule says so rather than silently reaching nobody.
   */
  audience?: string
  channel?: Channel
  /** Message or field text. `{id}`, `{subject}`, `{from}`, `{to}` and `{by}` are substituted. */
  text?: string
  /** For `requestApproval`. */
  ruleId?: string
}

export interface AutomationRule {
  id: string
  label: string
  on: EventType
  when: Condition[]
  then: RuleAction[]
  enabled: boolean
}

/**
 * The shipped rules.
 *
 * Two, and both are things a delivery firm does by hand every week. They are switched on
 * because a rule that ships disabled is a rule nobody discovers; they are also both
 * notifications, which is the one action that cannot make a mess of a record.
 */
export const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'AUTO_HIGH_RAISED',
    label: 'Tell the engagement lead when High-severity work is raised',
    on: 'issue.created',
    when: [{ field: 'severity', op: 'is', value: 'High' }],
    then: [
      {
        kind: 'notify',
        audience: 'role:ROLE_ENGAGEMENT_LEAD',
        channel: 'in-app',
        text: '{id} was raised at High severity: {subject}',
      },
    ],
    enabled: true,
  },
  {
    id: 'AUTO_OWNER_CHANGED',
    label: 'Tell somebody when work becomes theirs',
    on: 'issue.owner',
    when: [{ field: 'to', op: 'is not empty', value: '' }],
    then: [
      {
        kind: 'notify',
        audience: 'owner',
        channel: 'in-app',
        text: '{id} is now yours — {subject} (was {by}’s call, from {from})',
      },
    ],
    enabled: true,
  },
]

export function defaultAutomationRules(): AutomationRule[] {
  return DEFAULT_AUTOMATION_RULES.map((r) => ({
    ...r,
    when: r.when.map((c) => ({ ...c })),
    then: r.then.map((a) => ({ ...a })),
  }))
}

/* ================================================================== *
 * Evaluation
 * ================================================================== */

function valueOf(field: ConditionField, event: DomainEvent, issue: IssueRecord | undefined): string {
  if (field === 'to') return event.to
  if (field === 'from') return event.from
  return String((issue as unknown as Record<string, unknown>)?.[field] ?? '')
}

export function matches(rule: AutomationRule, event: DomainEvent, issue: IssueRecord | undefined): boolean {
  if (!rule.enabled || rule.on !== event.type) return false
  return rule.when.every((c) => {
    const actual = valueOf(c.field, event, issue).trim().toLowerCase()
    const expected = c.value.trim().toLowerCase()
    switch (c.op) {
      case 'is':
        return actual === expected
      case 'is not':
        return actual !== expected
      case 'is one of':
        return expected.split(',').map((v) => v.trim()).filter(Boolean).includes(actual)
      case 'is empty':
        return !actual
      case 'is not empty':
        return Boolean(actual)
      default:
        return false
    }
  })
}

/** `{id}` and friends, filled from the event and the record it happened to. */
export function fill(text: string, event: DomainEvent, issue: IssueRecord | undefined): string {
  return text
    .replace(/\{id\}/g, issue?.id ?? event.subjectId)
    .replace(/\{subject\}/g, issue?.subject ?? '')
    .replace(/\{from\}/g, event.from || '—')
    .replace(/\{to\}/g, event.to || '—')
    .replace(/\{by\}/g, event.by)
}

/**
 * Who an audience string resolves to.
 *
 * Returns names, and an empty list is a real answer: a rule addressed to a role nobody holds
 * reaches nobody, and the runner reports that rather than pretending it worked.
 */
export function resolveAudience(
  audience: string,
  state: WorkspaceState,
  issue: IssueRecord | undefined,
): string[] {
  if (audience === 'owner') return issue?.owner ? [issue.owner] : []
  if (audience === 'raisedBy') return issue?.raisedBy ? [issue.raisedBy] : []
  if (audience.startsWith('role:')) {
    const roleId = audience.slice(5)
    return Object.values(state.model.people)
      .filter((p) => p.roleIds.includes(roleId))
      .map((p) => p.name)
  }
  return audience.trim() ? [audience.trim()] : []
}

/* ================================================================== *
 * What a run produced
 * ================================================================== */

/** A rule that fired and reached nobody, or asked for something impossible. */
export interface RuleMiss {
  ruleId: string
  label: string
  why: string
}

/**
 * What the rules want done about these events.
 *
 * Pure: it reads state and returns actions, and applying them is somebody else's job. That is
 * what lets the same planner run in the browser for an immediate result and on the server for
 * the durable one, and produce the same answer — the only inputs are the state, the events and
 * the clock, and all three are passed in.
 */
export function planActions(
  state: WorkspaceState,
  events: DomainEvent[],
  now: string,
): { actions: Action[]; misses: RuleMiss[] } {
  const actions: Action[] = []
  const misses: RuleMiss[] = []

  for (const event of events) {
    const issue = state.issues[event.subjectId]
    for (const rule of state.model.automationRules) {
      if (!matches(rule, event, issue)) continue

      for (const step of rule.then) {
        switch (step.kind) {
          case 'notify': {
            const people = resolveAudience(step.audience ?? '', state, issue)
            if (!people.length) {
              // Reported rather than skipped. A rule addressed to a role nobody holds looks
              // exactly like a rule that worked, until somebody asks why they were not told.
              misses.push({
                ruleId: rule.id,
                label: rule.label,
                why: `Reached nobody — "${step.audience}" resolves to no one in the directory.`,
              })
              break
            }
            for (const person of people) {
              actions.push({
                t: 'notify',
                to: person,
                channel: step.channel ?? 'in-app',
                subject: fill(step.text ?? '', event, issue).slice(0, 120),
                body: fill(step.text ?? '', event, issue),
                aboutId: event.subjectId,
                ruleId: rule.id,
                now,
              })
            }
            break
          }
          case 'setNextAction':
            actions.push({
              t: 'updateIssue',
              id: event.subjectId,
              patch: { nextAction: fill(step.text ?? '', event, issue) },
              now,
            })
            break
          case 'addNote':
            actions.push({
              t: 'addNote',
              issueId: event.subjectId,
              body: fill(step.text ?? '', event, issue),
              noteType: 'General Update',
              pinned: false,
              now,
            })
            break
          case 'requestApproval':
            if (!step.ruleId) {
              misses.push({ ruleId: rule.id, label: rule.label, why: 'No approval rule named.' })
              break
            }
            actions.push({
              t: 'requestApproval',
              subjectId: event.subjectId,
              ruleId: step.ruleId,
              note: fill(step.text ?? '', event, issue),
              now,
            })
            break
        }
      }
    }
  }

  return { actions, misses }
}
