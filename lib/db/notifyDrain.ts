import 'server-only'
import { loadWorkspace } from './repo'
import { persistActions } from './persist'
import { sendAsMailbox } from '../mail'
import { entraConfig } from '../auth/entra'
import { scopeChainOf, type Action, type WorkspaceState } from '../workspace'
import type { Actor } from '../actor'
import type { Delivery } from '../notifications'
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
