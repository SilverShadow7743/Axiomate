/**
 * Telling somebody something.
 *
 * ---------------------------------------------------------------------------
 * Why a record with a delivery state, rather than a call to a mail server
 *
 * Because the interesting question is not "was a message composed" but "did it arrive, and if
 * not, does anybody know". A `sendMail` call with a try/catch around it answers neither: a
 * failure becomes a log line nobody reads, and a success proves only that a server accepted
 * the bytes.
 *
 * So a notification is a record with an outcome. In-app is delivered the moment it is written,
 * because the inbox *is* the delivery. Every other channel is written as `pending` and stays
 * pending, because there is no transport — and that is the honest state to be in. A pending
 * count in the interface is a true statement about this deployment: work is being flagged, and
 * nothing is leaving the building.
 */

export const CHANNELS = ['in-app', 'email', 'teams'] as const
export type Channel = (typeof CHANNELS)[number]

export type Delivery = 'delivered' | 'pending' | 'failed'

export interface Notification {
  /** `note-12`… no: `notif-12`, minted from the workspace counter. */
  id: string
  /** Who it is for, by name — or a role label, when a rule addressed a role rather than a person. */
  to: string
  /** The directory id when `to` uniquely resolved to a person; null for role labels and unknowns. */
  toId?: string | null
  channel: Channel
  subject: string
  body: string
  /** The record it is about, so the inbox can take you there. */
  aboutId: string
  /** Which rule raised it, so a noisy rule can be found and switched off. */
  ruleId: string
  createdAt: string
  delivery: Delivery
  /** Why it is not delivered. Stated, never inferred from a blank. */
  deliveryNote: string
  readAt: string | null
}

/**
 * What happens to a message on this deployment.
 *
 * The only honest answer for anything but in-app is that nothing happens, and saying so at the
 * moment of writing is better than a queue that looks like it is trying.
 */
export function deliveryFor(channel: Channel): { delivery: Delivery; deliveryNote: string } {
  if (channel === 'in-app') return { delivery: 'delivered', deliveryNote: '' }
  if (channel === 'email') {
    // Written pending and DRAINED: the scheduled pass sends these through the same Graph
    // client as client mail and stamps what actually happened. Pending here means queued,
    // not abandoned — the stamp is the proof either way.
    return {
      delivery: 'pending',
      deliveryNote: 'Queued for the scheduled pass to email.',
    }
  }
  return {
    delivery: 'pending',
    deliveryNote: `No ${channel} transport is configured, so this was recorded and not sent.`,
  }
}

export function inboxFor(
  all: Record<string, Notification>,
  person: string,
  /** The viewer's directory id — the join that survives a rename. Name is the fallback. */
  personId?: string | null,
): Notification[] {
  const key = person.trim().toLowerCase()
  return Object.values(all)
    .filter((n) =>
      // An id-addressed notification belongs to that id, full stop — a viewer who resolved
      // to nobody must not receive it by matching a stale display name.
      n.toId ? n.toId === personId : n.to.trim().toLowerCase() === key,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function unreadCount(
  all: Record<string, Notification>,
  person: string,
  personId?: string | null,
): number {
  return inboxFor(all, person, personId).filter((n) => !n.readAt).length
}

/** Everything raised that has not left the building. Shown as a count, not hidden. */
export function undelivered(all: Record<string, Notification>): Notification[] {
  return Object.values(all).filter((n) => n.delivery !== 'delivered')
}
