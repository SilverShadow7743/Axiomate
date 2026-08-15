import type { IntakeMailbox, OperatingModel, RoutingRule } from './config'
import { liveWorkTypes } from './config'
import type { Severity } from './types'

/**
 * Turning an arriving message into a work item.
 *
 * ---------------------------------------------------------------------------
 * What was wrong before
 *
 * Mailboxes and routing rules were configuration records, and nothing read them. A firm could
 * describe its intake in detail — which address, which scope, which rule routes what to whom —
 * and every word of it was inert. That is worse than an empty screen: the screen implied a
 * pipeline existed.
 *
 * This module is the pipeline, minus its first mile. It takes a message that has arrived from
 * *somewhere* and does the rest properly: matches it to a mailbox, applies the routing rules in
 * their configured order, and produces the draft of a work item under the right scope. What it
 * does not do is fetch mail. There is no mailbox connection, no credentials and no poller, and
 * writing one that pretends to work would be the same defect in a new place.
 *
 * ---------------------------------------------------------------------------
 * Deliberately not a classifier
 *
 * Severity and type are guessed from words the client used, and the guess is *reported as a
 * guess* — `confidence` and `matchedOn` come back with the draft, and the record is created
 * with a status that says somebody still has to look at it. An intake that silently decides a
 * client's problem is High severity is one wrong guess away from an SLA nobody agreed to.
 */

export interface InboundMessage {
  /** The address it was sent to, which is what selects the mailbox. */
  to: string
  from: string
  subject: string
  body: string
  /** The sender's own message id, used to refuse the same message twice. */
  messageId: string
  receivedAt: string
}

export interface IntakeDraft {
  /** Where it should be filed — the mailbox's configured scope. */
  parentId: string
  subject: string
  description: string
  type: string
  severity: Severity
  raisedBy: string
  /** Responsibility assignments the routing rules proposed. */
  assignments: { responsibilityTypeId: string; value: string }[]
  /** Which rules fired, in order, so a person can see why it landed where it did. */
  matchedOn: string[]
  /**
   * How much of this was decided rather than guessed.
   *
   * `stated` means a rule matched and named the outcome. `guessed` means the words in the
   * message suggested it. `default` means nothing did, and the shipped fallback was used.
   */
  confidence: { severity: 'stated' | 'guessed' | 'default'; type: 'stated' | 'guessed' | 'default' }
}

export interface IntakeRefusal {
  reason: string
  code: 'no-mailbox' | 'mailbox-disabled' | 'no-scope' | 'empty'
}

/** Words that make a client's message urgent. Crude, and honest about being crude. */
const HIGH_WORDS = /\b(urgent|critical|outage|down|blocked|blocking|cannot (?:process|invoice|ship|post)|production)\b/i
const LOW_WORDS = /\b(minor|cosmetic|typo|when you (?:get|have) (?:a chance|time)|no rush|nice to have)\b/i

/**
 * Match a message to a mailbox, apply the rules, and produce a draft.
 *
 * Pure, and takes the model rather than reading it, so the same function runs in the endpoint,
 * in a test, and in whatever eventually fetches the mail.
 */
export function classify(
  message: InboundMessage,
  model: OperatingModel,
): { draft: IntakeDraft } | { refused: IntakeRefusal } {
  if (!message.subject.trim() && !message.body.trim()) {
    return { refused: { code: 'empty', reason: 'The message has neither a subject nor a body.' } }
  }

  const address = message.to.trim().toLowerCase()
  const mailbox: IntakeMailbox | undefined = model.intake.find(
    (m) => m.address.trim().toLowerCase() === address,
  )
  if (!mailbox) {
    return {
      refused: {
        code: 'no-mailbox',
        reason: `No mailbox is configured for ${message.to}. Configuration → Routing & intake lists the addresses this workspace accepts.`,
      },
    }
  }
  if (!mailbox.enabled) {
    return { refused: { code: 'mailbox-disabled', reason: `${mailbox.address} is switched off.` } }
  }
  if (!mailbox.scopeId) {
    return {
      refused: {
        code: 'no-scope',
        reason: `${mailbox.address} has no scope, so there is nowhere to file what arrives there.`,
      },
    }
  }

  const haystack = `${message.subject} ${message.body}`.toLowerCase()

  /* ---- rules, in their configured order ---- */
  const matchedOn: string[] = []
  const assignments: { responsibilityTypeId: string; value: string }[] = []
  let severity: Severity | null = null
  let type: string | null = null

  const rules = [...model.routingRules].filter((r) => r.enabled).sort((a, b) => a.order - b.order)
  for (const rule of rules) {
    if (!ruleMatches(rule, haystack, message)) continue
    matchedOn.push(rule.name)
    if (rule.then.responsibilityTypeId && rule.then.value) {
      assignments.push({ responsibilityTypeId: rule.then.responsibilityTypeId, value: rule.then.value })
    }
    // A rule that names a severity states it; the first one to do so wins, which is what the
    // order is for.
    if (!severity && rule.when.severity) severity = rule.when.severity as Severity
  }

  /* ---- what the rules did not say ---- */
  const severityConfidence: IntakeDraft['confidence']['severity'] = severity
    ? 'stated'
    : HIGH_WORDS.test(haystack) || LOW_WORDS.test(haystack)
      ? 'guessed'
      : 'default'
  if (!severity) {
    severity = HIGH_WORDS.test(haystack) ? 'High' : LOW_WORDS.test(haystack) ? 'Low' : 'Medium'
  }

  const types = liveWorkTypes(model)
  const guessedType = types.find((t) => haystack.includes(t.label.toLowerCase()))
  type = guessedType?.label ?? types[0]?.label ?? ''
  const typeConfidence: IntakeDraft['confidence']['type'] = guessedType ? 'guessed' : 'default'

  return {
    draft: {
      parentId: mailbox.scopeId,
      subject: message.subject.trim() || firstLine(message.body),
      description: message.body.trim(),
      type,
      severity,
      raisedBy: message.from.trim(),
      assignments,
      matchedOn,
      confidence: { severity: severityConfidence, type: typeConfidence },
    },
  }
}

function ruleMatches(rule: RoutingRule, haystack: string, message: InboundMessage): boolean {
  const { module, keyword } = rule.when
  if (keyword && !haystack.includes(keyword.trim().toLowerCase())) return false
  if (module && !haystack.includes(module.trim().toLowerCase())) return false
  // A rule with no conditions at all matches everything, which is a legitimate catch-all and
  // the reason `order` exists.
  if (!keyword && !module && !rule.when.severity) return true
  return true
}

function firstLine(body: string): string {
  const line = body.trim().split('\n')[0] ?? ''
  return line.length > 120 ? `${line.slice(0, 117)}…` : line || 'Message with no subject'
}

/**
 * The note that goes on the record, so a consultant reading it knows what was decided by a
 * machine and what was decided by a person — which is to say, none of it yet.
 */
export function provenanceNote(message: InboundMessage, draft: IntakeDraft): string {
  const lines = [
    `Received from ${message.from} at ${message.receivedAt}, addressed to ${message.to}.`,
    draft.matchedOn.length
      ? `Routing rules applied: ${draft.matchedOn.join(', ')}.`
      : 'No routing rule matched, so this was filed at the mailbox default.',
    `Severity ${draft.confidence.severity === 'stated' ? 'set by a rule' : draft.confidence.severity === 'guessed' ? 'guessed from the wording — check it' : 'left at the default — check it'}.`,
    `Type ${draft.confidence.type === 'guessed' ? 'guessed from the wording' : 'left at the default'}.`,
    'Nobody has triaged this yet.',
  ]
  return lines.join(' ')
}
