import type { Person } from './config'
import { externalPartyKinds, tiersOf } from './config'
import { scopeChainOf, type WorkspaceState } from './workspace'

/**
 * Who may be named as a record's owner — the People directory, and only that.
 *
 * Until 12 Sep 2026 the owner was typed: a free-text name with, in two of the three places
 * it is entered, a datalist of suggestions drawn from the project's staffing or from names
 * already in use. The I25 Tier 3 decision kept it free so that a dual owner ("Michael Thomas
 * (POS) / Amolak (D365)", nine open issues at the time) stayed representable. Nishant reversed
 * that on 12 Sep — "where is the owner dropdown which should come from people" — and chose a
 * strict select over the directory: an owner is a person the firm knows, and a name that
 * matches nobody is exactly the mismatch `directoryIdByName` already fails to resolve on
 * every owner write. The nine dual-owner values are not rewritten: `unlisted` carries the
 * current value so the control can still show it, and it stops being offered the moment
 * somebody chooses a person instead.
 *
 * Two groups, because the two sides of a project are different answers to "who owns this":
 *
 *   team    every active person in the directory who holds no client role — the firm.
 *   client  every active client seat attached to THIS record's client node. A seat attached
 *           to another client, or to none, is not offered: a guest of one client is never
 *           named on another's work, the same boundary `clientView` draws for reading.
 *
 * Pure. The state and an anchor id (the record itself, or the parent a new record is being
 * created under) are the whole input; the client node is the nearest externalParty-tier
 * ancestor of the anchor, resolved through `scopeChainOf` like every other scoped lookup.
 */

/** The seeded client-side org roles — the same three `boot()`'s banner and the reducer's
 *  client-seat checks name. A seat holding any of these is on the client's side. */
export const CLIENT_ORG_ROLES: readonly string[] = ['ROLE_CLIENT_SPONSOR', 'ROLE_CLIENT_LEAD', 'ROLE_CLIENT_USER']

export interface OwnerChoices {
  /** The firm's active people, by name. */
  team: Person[]
  /** Active client seats attached to the anchor's client node, by name. Empty off a client. */
  client: Person[]
  /**
   * The stored owner when it names nobody offered above — a dual owner, a departed person,
   * or a name typed before the directory was the source. Null when the current value is
   * empty, "Unassigned", or one of the offered names.
   */
  unlisted: string | null
}

export const UNASSIGNED = 'Unassigned'

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name)

const isClientSeat = (p: Person) => p.roleIds.some((r) => CLIENT_ORG_ROLES.includes(r))

/** The nearest externalParty-tier ancestor of `anchorId` (inclusive), or null. */
export function clientNodeOf(state: WorkspaceState, anchorId: string | null): string | null {
  if (!anchorId) return null
  const external = externalPartyKinds(tiersOf(state.model))
  for (const id of scopeChainOf(state, anchorId)) {
    if (external.has(state.nodes[id]?.kind ?? '')) return id
  }
  return null
}

export function ownerChoicesFor(
  state: WorkspaceState,
  anchorId: string | null,
  current: string | null | undefined,
): OwnerChoices {
  const active = Object.values(state.model.people ?? {}).filter((p) => p.status !== 'Departed')
  const clientNode = clientNodeOf(state, anchorId)
  const team = active.filter((p) => !isClientSeat(p)).sort(byName)
  const client = clientNode
    ? active.filter((p) => isClientSeat(p) && p.clientScopeId === clientNode).sort(byName)
    : []
  const value = (current ?? '').trim()
  const offered = new Set([...team, ...client].map((p) => p.name))
  const unlisted = value && value !== UNASSIGNED && !offered.has(value) ? value : null
  return { team, client, unlisted }
}

/** The flat option list a plain `<select>` wants: Unassigned first, then the firm, then the
 *  client's seats, then the stored-but-unlisted value last so it is visible and never lost. */
export function ownerOptionValues(choices: OwnerChoices): string[] {
  return [
    UNASSIGNED,
    ...choices.team.map((p) => p.name),
    ...choices.client.map((p) => p.name),
    ...(choices.unlisted ? [choices.unlisted] : []),
  ]
}
