import type { IntakeMailbox, OperatingModel, RoutingRule } from './config'
import { liveWorkTypes } from './config'
import type { IssueRelationship, Severity } from './types'
import type { IssueRecord, WorkspaceState } from './workspace'

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
  /**
   * Exchange's own thread id — stable across every message in the same conversation, unlike
   * `messageId`, which is unique per message. Null for anything that isn't email (the intake
   * form) or arrived before the connector was updated to send it. See
   * `docs/plans/2026-08-25-intake-reply-threading-design.md`.
   */
  conversationId: string | null
}

/**
 * A kept record of a message that arrived — the reader `classify()`'s discard never had.
 *
 * `lib/intake.ts`'s prior stance was that storing a second copy of every message was "a cost
 * with no reader" — true when it was written, and answered rather than ignored now that a
 * reference log has one. `body` is already `htmlToText`-converted, the same plain form every
 * other consumer of a message sees, not a second HTML copy.
 *
 * Refused messages are kept too: `issueId` and `refusalReason` are mutually exclusive, and a
 * reference log that silently dropped what got bounced would not be a complete reference.
 */
export interface InboundMail {
  id: string
  mailbox: string
  from: string
  subject: string
  body: string
  messageId: string
  receivedAt: string
  issueId: string | null
  refusalReason: string | null
  createdAt: string
  /** See `InboundMessage.conversationId` — carried through unchanged onto the kept record. */
  conversationId: string | null
}

/**
 * Has this message already been received — extracted so `POST /api/intake` can be driven by
 * the scenario harness on this specific question, rather than the check only being inferable
 * from the route's own behaviour. Direct on `messageId`, replacing the substring search over
 * note bodies the route used before `InboundMail` existed to check something more direct.
 */
export function alreadyReceived(state: WorkspaceState, messageId: string): boolean {
  return Object.values(state.inboundMail).some((m) => m.messageId === messageId)
}

/**
 * Which issue a reply belongs to, if any — `null` meaning "create a new issue", today's
 * behaviour for everything this does not recognise.
 *
 * Matches on `conversationId` only, never on subject. See
 * `docs/plans/2026-08-25-intake-reply-threading-design.md`: *"subjects get edited, translated
 * and reused, and a wrong match files a client's message against another client's issue."*
 * `conversationId` is Exchange's own thread id, so every candidate this finds already shares
 * the real thread — the tie-break below only has to pick among genuine candidates, never guess
 * whether one is genuine.
 */
export function matchingIssue(
  mail: Record<string, InboundMail>,
  issues: Record<string, IssueRecord>,
  conversationId: string | null,
): string | null {
  if (!conversationId) return null
  // A refused message has no `issueId` — it named no issue, so it cannot be one of the
  // candidates a later reply might attach to. Left in, a reply on a thread whose first message
  // was refused would silently create a new issue exactly as it should; this filter is what
  // stops it from instead matching a refusal that names nothing.
  const candidateIds = new Set(
    Object.values(mail)
      .filter((m) => m.conversationId === conversationId && m.issueId)
      .map((m) => m.issueId as string),
  )
  if (candidateIds.size === 0) return null
  if (candidateIds.size === 1) return [...candidateIds][0]
  // More than one issue shares this thread — legacy data from before this matched at all, or a
  // thread a person split by hand. The most-recently-active one, never a refusal to pick.
  let best: string | null = null
  for (const id of candidateIds) {
    const issue = issues[id]
    if (!issue) continue
    if (!best || issue.lastActivity > issues[best].lastActivity) best = id
  }
  return best
}

/**
 * Strip a leading run of reply/forward markers — `Re:`, `Fw:`, `Fwd:`, any case, any number of
 * repeats (`"Re: Re: Fwd: X"` → `"X"`) — and surrounding whitespace.
 *
 * Cleanup-only. Never used by `matchingIssue` above, and never will be — see that function's own
 * comment on why a subject is not a safe signal to match a live reply against. This exists for
 * `duplicateGroups`, which groups *existing* issues that never had a real thread id to match on
 * in the first place, where a person reviews the result before anything is linked.
 */
export function normalizeSubject(subject: string): string {
  let s = subject.trim()
  const prefix = /^(re|fw|fwd)\s*:\s*/i
  while (prefix.test(s)) s = s.replace(prefix, '').trim()
  return s
}

/**
 * Existing issues that are almost certainly the same email thread, filed more than once —
 * the shape the bug this module now fixes already left behind. Grouped by client, parent node
 * and normalized subject; only groups of more than one issue are returned, each naming a
 * `canonical` (most recently active) and the rest as `duplicates`, in the order a caller should
 * link each to the canonical one.
 *
 * Deliberately keyed on the issue's own fields rather than joined through `InboundMail` — an
 * issue created before that table existed, or by any path that never recorded a mail row, is
 * still a real issue with a client, a parent and a subject, and a duplicate of it is exactly as
 * real. The mailbox is dropped from the key for the same reason: it is only ever known for
 * issues with a mail row, so requiring it made a mail-linked and a mail-less duplicate
 * structurally impossible to group together — the case this function exists to catch.
 *
 * A report to review, not a decision already made — see
 * `docs/plans/2026-08-25-intake-reply-threading-design.md`'s own send-back condition: a
 * false-positive group here is the dry run's job to catch, not this function's to avoid by
 * being cleverer about matching.
 */
export function duplicateGroups(
  issues: Record<string, IssueRecord>,
): { canonical: string; duplicates: string[] }[] {
  const groups = new Map<string, Set<string>>()
  for (const issue of Object.values(issues)) {
    if (issue.deletedAt) continue
    const key = `${issue.client} ${issue.parentId} ${normalizeSubject(issue.subject)}`
    const group = groups.get(key) ?? new Set<string>()
    group.add(issue.id)
    groups.set(key, group)
  }

  const out: { canonical: string; duplicates: string[] }[] = []
  for (const ids of groups.values()) {
    if (ids.size < 2) continue
    let canonical: string | null = null
    for (const id of ids) {
      if (!canonical || issues[id].lastActivity > issues[canonical].lastActivity) canonical = id
    }
    out.push({
      canonical: canonical as string,
      duplicates: [...ids].filter((id) => id !== canonical),
    })
  }
  return out
}

/**
 * `duplicateGroups`, narrowed to what a reviewer still has a decision to make about.
 *
 * `duplicateGroups` itself stays untouched — same signature, same result, still what the CLI
 * script and IT6/IT7/IT9 exercise — because it groups by subject alone and has no reason to
 * know about relationships. This is the UI's own concern: a group where every duplicate is
 * already `DUPLICATE_OF` its canonical has nothing left to review, and a screen that kept
 * showing it forever would never be able to say "nothing to review" honestly.
 */
export function openDuplicateGroups(
  issues: Record<string, IssueRecord>,
  relationships: IssueRelationship[],
): { canonical: string; duplicates: string[] }[] {
  return duplicateGroups(issues)
    .map((g) => ({
      canonical: g.canonical,
      duplicates: g.duplicates.filter(
        (dupId) =>
          !relationships.some(
            (r) =>
              r.sourceIssueId === dupId &&
              r.targetIssueId === g.canonical &&
              r.relationshipType === 'DUPLICATE_OF',
          ),
      ),
    }))
    .filter((g) => g.duplicates.length > 0)
}

/* ================================================================== *
 * HTML bodies
 * ================================================================== */

/**
 * A mail body as something a person can read.
 *
 * Client mail arrives as HTML, and it arrives that way **on purpose**. `infra/intake.bicep`
 * records the decision: the Content Conversion connector was rejected because it is in preview,
 * it doubles the per-message connector cost, and — the reason that actually mattered — by its own
 * documentation it discards hyperlinks and hard-wraps at eighty characters. Losing a link a
 * client sent, silently, is worse than showing somebody tags.
 *
 * That reasoning was right and it was only half a decision. Nothing on this side then converted
 * anything, so issues were created with raw markup in the description. This is the other half,
 * and it is here rather than in the Logic App for three reasons: it is pure and therefore
 * testable, it costs nothing per message, and it can keep the links that the rejected connector
 * would have thrown away.
 *
 * What it deliberately does NOT do:
 *
 *   - **Hard-wrap.** That was one of the two objections to the connector. Lines stay long and the
 *     screen decides where to break them.
 *   - **Sanitise for rendering.** Nothing here is trusted as markup afterwards; the output is
 *     plain text stored in a description field. Escaping is not this function's job and pretending
 *     otherwise would invite somebody to render the result as HTML because "it has been cleaned".
 *   - **Keep the original.** The message stays in the mailbox it arrived in, which the intake note
 *     already names. Storing a second copy of every client email as markup nobody reads is a cost
 *     with no reader.
 */
export function htmlToText(body: string): string {
  if (!body) return ''
  // Plain text passes through untouched. A body with no tag at all must not be rewritten by a
  // function that only exists for markup — and mail servers do still send text/plain.
  if (!/<[a-z!/][^>]*>/i.test(body)) return body

  let out = body

  /*
   * Content that is not prose, removed with its content rather than just its tags. Stripping
   * `<style>` as a tag pair alone leaves the entire stylesheet sitting in the description, which
   * is the single ugliest thing an Outlook message would otherwise produce.
   */
  out = out.replace(/<!--[\s\S]*?-->/g, ' ')
  out = out.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')

  /*
   * Links keep their target. This is the whole reason the conversion is done here: the connector
   * that was rejected would have dropped it. `text (url)` unless the text already IS the url, in
   * which case repeating it reads as a fault.
   */
  out = out.replace(
    /<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      const target = href.trim()
      if (!target || /^(mailto:|tel:)/i.test(target)) return label || target
      if (!label) return target
      // A link whose text is its own address, or a fragment of it, gains nothing from the pair.
      return label === target || target.includes(label) ? label : `${label} (${target})`
    },
  )

  // Structure that means a line break. Order does not matter; each is independent.
  out = out.replace(/<br\b[^>]*>/gi, '\n')
  out = out.replace(/<\/(p|div|tr|h[1-6]|blockquote|section|article)\s*>/gi, '\n\n')
  out = out.replace(/<\/(li)\s*>/gi, '\n')
  out = out.replace(/<li\b[^>]*>/gi, '- ')
  // A table cell boundary is a space, not a line break: a two-column row reads as one line.
  out = out.replace(/<\/(td|th)\s*>/gi, '  ')

  // Everything else that is a tag, including Outlook's `<o:p>` and every MSO artefact.
  out = out.replace(/<[^>]+>/g, '')

  out = decodeEntities(out)

  /*
   * Whitespace last, and only after the entities: `&nbsp;` becomes a space here and would
   * otherwise survive as a character no collapse rule recognises. Outlook produces long runs of
   * them.
   */
  out = out.replace(/\r\n?/g, '\n')
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trimEnd())
    .join('\n')
  // Three or more blank lines is Outlook padding, not somebody's paragraphing.
  out = out.replace(/\n{3,}/g, '\n\n')
  /*
   * A list reads as a list. `</li>` contributes a newline and the source usually carries one of
   * its own between items, so consecutive bullets arrive double-spaced — which turns a four-point
   * list from a client into what looks like four separate paragraphs.
   */
  out = out.replace(/(^|\n)(- [^\n]*)\n\n(?=- )/g, '$1$2\n')

  return out.trim()
}

/** The named entities that actually turn up in mail, plus every numeric one. */
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '\u2013',
  mdash: '\u2014',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  hellip: '\u2026',
  bull: '\u2022',
  pound: '\u00a3',
  euro: '\u20ac',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
}

/**
 * Entities, decoded once.
 *
 * `&amp;` is handled in the same pass as everything else rather than first or last, because a
 * second pass over the result would turn `&amp;lt;` — which a client genuinely sends when quoting
 * code — into `<`, and that is data corruption rather than tidying.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      // Anything outside the range, or a control character, is left as written rather than
      // turned into a replacement glyph nobody can interpret.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    const named = NAMED[body.toLowerCase()]
    return named === undefined ? whole : named
  })
}

export interface IntakeDraft {
  /** Where it should be filed — the mailbox's configured scope. */
  parentId: string
  subject: string
  description: string
  type: string
  severity: Severity
  raisedBy: string
  /** Classification for the filed record, when the mailbox states one (see
   *  IntakeMailbox.classification). Absent: the create arm's ancestor walk decides. */
  module?: string
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

  return { draft: draftFor(mailbox.scopeId, message, model, undefined, mailbox.classification) }
}

/**
 * The shareable half of classification: rules, guesses, draft.
 *
 * `classify` above resolves a mailbox and calls this; `classifyForm` below resolves a form and
 * calls this. One copy, deliberately — two would drift, and the drift would be invisible until
 * a form-raised record routed differently from the identical email.
 *
 * `stated` carries what the sender themselves declared — a form's urgency choice. It wins over
 * the rules' severity and is recorded as `stated`, the same vocabulary as a rule naming it:
 * in both cases somebody decided, rather than the words being guessed at.
 */
export function draftFor(
  scopeId: string,
  message: InboundMessage,
  model: OperatingModel,
  stated?: { severity: Severity },
  classification?: string | null,
): IntakeDraft {
  const haystack = `${message.subject} ${message.body}`.toLowerCase()

  /* ---- rules, in their configured order ---- */
  const matchedOn: string[] = []
  const assignments: { responsibilityTypeId: string; value: string }[] = []
  let severity: Severity | null = stated?.severity ?? null
  let type: string | null = null

  const rules = [...model.routingRules].filter((r) => r.enabled).sort((a, b) => a.order - b.order)
  for (const rule of rules) {
    if (!ruleMatches(rule, haystack, message)) continue
    matchedOn.push(rule.name)
    if (rule.then.responsibilityTypeId && rule.then.value) {
      assignments.push({ responsibilityTypeId: rule.then.responsibilityTypeId, value: rule.then.value })
    }
    // A rule that names a severity states it; the first one to do so wins, which is what the
    // order is for. A severity the sender stated outranks both.
    if (!severity && rule.when.severity) severity = rule.when.severity as Severity
  }

  /* ---- what neither the sender nor the rules said ---- */
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
    parentId: scopeId,
    ...(classification ? { module: classification } : {}),
    subject: message.subject.trim() || firstLine(message.body),
    description: message.body.trim(),
    type,
    severity,
    raisedBy: message.from.trim(),
    assignments,
    matchedOn,
    confidence: { severity: severityConfidence, type: typeConfidence },
  }
}

/** A form's urgency words, mapped without interpretation. */
export function urgencyToSeverity(urgency: 'urgent' | 'normal' | 'low'): Severity {
  return urgency === 'urgent' ? 'High' : urgency === 'low' ? 'Low' : 'Medium'
}

/**
 * Match a submission to a form, and produce a draft through the same second half as mail.
 *
 * The refusal vocabulary mirrors `classify`'s. Note what the CALLER must add on top: an
 * unknown token and a disabled form must be indistinguishable at the endpoint — this function
 * distinguishes them because configuration screens need the difference; the wire must not.
 */
export function classifyForm(
  form: { id: string; name: string; scopeId: string; enabled: boolean },
  message: InboundMessage,
  model: OperatingModel,
  urgency: 'urgent' | 'normal' | 'low',
): { draft: IntakeDraft } | { refused: IntakeRefusal } {
  if (!message.subject.trim() && !message.body.trim()) {
    return { refused: { code: 'empty', reason: 'The submission has neither a subject nor a description.' } }
  }
  if (!form.enabled) {
    return { refused: { code: 'mailbox-disabled', reason: `The ${form.name} form is switched off.` } }
  }
  if (!form.scopeId) {
    return {
      refused: {
        code: 'no-scope',
        reason: `The ${form.name} form has no scope, so there is nowhere to file what arrives.`,
      },
    }
  }
  return { draft: draftFor(form.scopeId, message, model, { severity: urgencyToSeverity(urgency) }) }
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
