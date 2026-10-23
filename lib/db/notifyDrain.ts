import 'server-only'
import { loadWorkspace } from './repo'
import { persistActions } from './persist'
import { sendAsMailbox } from '../comms/mail'
import { entraConfig } from '../auth/entra'
import { scopeChainOf, type Action, type WorkspaceState } from '../workspace'
import type { Actor } from '../actor'
import type { Delivery } from '../comms/notifications'
import type { TenantId } from '../tenant'

/**
 * Email-channel notifications finally leave the building.
 *
 * The rules have always written them as `pending`, honestly: there was no transport. The
 * transport exists now — the same app-only Graph client the outward door uses, restricted by
 * the tenant's access policy to the intake mailbox group — so the scheduled pass drains the
 * queue after each run.
 *
 * Why here and not inside the pass's transaction: a network send inside a Serializable
 * transaction would hold locks for as long as Microsoft takes to answer, and a retry of the
 * transaction would send the mail twice. The drain runs after, sends, and then records what
 * actually happened through the same reducer funnel as every other write — so a delivered
 * notification says delivered because it was, not because it was about to be.
 */

const PER_RUN = 20

/**
 * Whether Microsoft's refusal is the kind that clears on its own.
 *
 * `lib/queue.ts`'s `verdictFor` drew this line once already, for the autosave queue: 408 and
 * 429 "live in a range that is otherwise permanent" but improve by waiting, and every other
 * 4xx is refused identically on replay. That reasoning applies here unchanged — Graph's 429 is
 * the same throttling signal, not a verdict on this message — so this reuses the line rather
 * than drawing a second one. 5xx is treated as transient too, matching that module's own
 * fallback for "a 5xx that could clear": Graph does not hand this client a way to tell a
 * deterministic 5xx from an outage, unlike the endpoint `verdictFor` reads a `permanent` flag
 * from, so every 5xx here is given the benefit of the doubt rather than none of it.
 */
export function isTransientGraphFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function mark(id: string, delivery: Delivery, note: string, now: string): Action {
  return { t: 'markNotificationDelivery', id, delivery, note, now } as Action
}

/** The mailbox that speaks for this record — nearest on the chain, or the firm's first. */
function mailboxFor(state: WorkspaceState, aboutId: string): string | null {
  const enabled = state.model.intake.filter((m) => m.enabled)
  if (!enabled.length) return null
  const issue = state.issues[aboutId]
  if (issue) {
    for (const scopeId of scopeChainOf(state, issue.parentId)) {
      const hit = enabled.find((m) => m.scopeId === scopeId)
      if (hit) return hit.address
    }
  }
  return enabled[0].address
}

export async function drainEmailNotifications(
  tenantId: TenantId,
  actor: Actor,
  now: string,
): Promise<{ attempted: number; sent: number; failed: number; note?: string }> {
  if (!entraConfig()) {
    return { attempted: 0, sent: 0, failed: 0, note: 'Entra is not configured; email notifications stay pending.' }
  }

  const { state } = await loadWorkspace(tenantId)
  const pending = Object.values(state.notifications)
    .filter((n) => n.channel === 'email' && n.delivery === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, PER_RUN)

  const stamps: Action[] = []
  let sent = 0
  let failed = 0
  for (const n of pending) {
    const person = Object.values(state.model.people).find(
      (p) => p.name.trim().toLowerCase() === n.to.trim().toLowerCase() && p.email,
    )
    if (!person?.email) {
      // Stays pending, with the reason updated: an address added to the directory tomorrow
      // makes this deliverable, and "failed" would stop anyone retrying it.
      stamps.push(mark(n.id, 'pending', `No directory email for “${n.to}”, so there is no address to send to yet.`, now))
      failed++
      continue
    }
    const mailbox = mailboxFor(state, n.aboutId)
    if (!mailbox) {
      stamps.push(mark(n.id, 'pending', 'No enabled intake mailbox to send as — Configuration → Routing & intake.', now))
      failed++
      continue
    }
    const res = await sendAsMailbox(
      mailbox,
      person.email,
      n.subject,
      `${n.body}\n\nAbout ${n.aboutId}. Raised by rule ${n.ruleId}; open Axiomate to act on it.`,
    )
    if (res.ok) {
      stamps.push(mark(n.id, 'delivered', `Emailed to ${person.email} as ${mailbox}.`, now))
      sent++
    } else if (isTransientGraphFailure(res.status)) {
      // Stays pending, the same treatment as no-directory-email and no-enabled-mailbox above:
      // nothing is wrong with this message, only with this attempt, and the next run tries
      // again on its own. A refusal that will not improve still goes to 'failed', below.
      console.error(`notification ${n.id} deferred: ${res.status} ${res.detail}`)
      stamps.push(mark(n.id, 'pending', `Microsoft could not be reached (${res.status}) — retrying next run.`, now))
      failed++
    } else {
      // A refusal is terminal for this notification: it names the outcome the operator must
      // investigate, and retrying the same refusal every morning would only bury it.
      console.error(`notification ${n.id} refused: ${res.status} ${res.detail}`)
      stamps.push(mark(n.id, 'failed', `Microsoft refused the send (${res.status}). See the server log.`, now))
      failed++
    }
  }

  if (stamps.length) await persistActions(tenantId, actor, stamps)
  return { attempted: pending.length, sent, failed }
}
