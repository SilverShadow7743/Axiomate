import type { IntakeMailbox } from './config'
import { scopeChainOf, type WorkspaceState } from './workspace'
import type { IssueNote } from './notes'

/**
 * Outbound mail: the other half of intake's loop, resolved before anything is sent.
 *
 * ---------------------------------------------------------------------------
 * The sending identity is the receiving one
 *
 * A reply goes out as the intake mailbox that would receive the answer — the NEAREST enabled
 * mailbox on the issue's scope chain, so an engagement's own mailbox beats a client-wide one.
 * Not new configuration: the mailbox that listens is the one that speaks. An issue no mailbox
 * covers refuses at the door, in words that say what to configure.
 *
 * ---------------------------------------------------------------------------
 * The recipient is a claim
 *
 * `raisedBy` carries "Name <email>" — written by intake and by the request form, both of
 * which record the sender's identity as claimed, never verified. A record whose claim carries
 * no parseable address gets no compose at all: writing to an address nobody stated is not a
 * fallback, it is a different feature.
 */

/** The same shape the intake form endpoint accepts. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface OutboundResolution {
  mailbox: IntakeMailbox
  recipient: string
  subject: string
}

export interface OutboundRefusal {
  reason: string
  code: 'no-issue' | 'no-recipient' | 'no-mailbox'
}

/**
 * The address inside a sender claim, or null when there is none to write to.
 *
 * "Ravi Mada <ravi@client.example>" and "ravi@client.example" both answer; a bare display
 * name answers null — the compose must not open on it.
 */
export function recipientOf(raisedBy: string): string | null {
  const claim = (raisedBy ?? '').trim()
  const angled = claim.match(/<([^<>\s]+)>\s*$/)
  const candidate = angled ? angled[1] : claim
  return EMAIL.test(candidate) ? candidate : null
}

/** `RE: <subject> [OAPIL-146]` — the reference is what threads the reply back through intake. */
export function outboundSubjectFor(issueId: string, subject: string): string {
  const base = subject.trim() || issueId
  return `RE: ${base} [${issueId}]`
}

/**
 * The nearest enabled mailbox on the issue's scope chain.
 *
 * The chain from `scopeChainOf` runs issue-upward; the first mailbox whose scope appears in
 * it wins. Iterating the CHAIN (not the mailbox list) is what makes "nearest" true.
 */
export function sendingMailboxFor(
  state: WorkspaceState,
  issueId: string,
): OutboundResolution | OutboundRefusal {
  const issue = state.issues[issueId]
  if (!issue || issue.deletedAt) {
    return { code: 'no-issue', reason: 'That record does not exist or is archived.' }
  }

  const recipient = recipientOf(issue.raisedBy)
  if (!recipient) {
    return {
      code: 'no-recipient',
      reason:
        'This record carries no email address for whoever raised it, so there is nobody to write to. Records arriving by mail or through a request form carry one.',
    }
  }

  const chain = scopeChainOf(state, issue.parentId)
  const enabled = state.model.intake.filter((m) => m.enabled)
  for (const scopeId of chain) {
    const mailbox = enabled.find((m) => m.scopeId === scopeId)
    if (mailbox) {
      return { mailbox, recipient, subject: outboundSubjectFor(issue.id, issue.subject) }
    }
  }

  return {
    code: 'no-mailbox',
    reason:
      'No enabled intake mailbox covers this part of the tree, so there is no address to send as. Configuration → Routing & intake is where one is pointed at a scope.',
  }
}

export function isOutboundRefusal(
  r: OutboundResolution | OutboundRefusal,
): r is OutboundRefusal {
  return 'code' in r
}

/**
 * The exact text recorded as a sent note's body. One function, called both to check whether a
 * message already went out and to build the record after it does, so the two can never drift
 * into comparing against a string the record was never actually written with.
 */
export function outboundNoteBody(resolved: OutboundResolution, text: string): string {
  return `Sent to ${resolved.recipient} as ${resolved.mailbox.address}\nSubject: ${resolved.subject}\n\n${text}`
}

/**
 * Has this exact message already been sent and recorded on this issue — checked BEFORE the send,
 * not after. The gap this closes: the send succeeds, but the response never reaches the browser
 * (a dropped connection, a closed tab), so the person sees a failure with their text still in
 * the box and, reasonably, tries again. Without this check, that retry mails the client the
 * message a second time.
 *
 * Matched on exact body text rather than a separately-minted idempotency key: once the mailbox,
 * recipient and subject are resolved, the note body is already fully determined by
 * `(issueId, text)`, so two genuinely identical requests always produce the identical string —
 * nothing new needs generating, storing, or threading through the client just to compare against
 * something the record already contains.
 *
 * Deliberately unconditional, not windowed by time: a person who genuinely wants to send the
 * exact same words again gets a silent no-op instead of a second email. The caller must report
 * this as a replay, not as an ordinary send, so nobody is told a message went out when it did
 * not — see `replayed` in `app/api/mail/send/route.ts`.
 */
export function alreadySent(
  state: WorkspaceState,
  issueId: string,
  noteBody: string,
): IssueNote | null {
  return (
    Object.values(state.notes).find(
      (n) =>
        n.issueId === issueId &&
        n.noteType === 'Client Communication' &&
        n.body === noteBody &&
        !n.deletedAt,
    ) ?? null
  )
}
