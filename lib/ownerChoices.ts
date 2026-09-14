import type { Person } from './config'
import type { WorkspaceState } from './workspace'

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
 * One group: every active person in the directory who holds no client role — the firm. A
 * client seat is never offered, on any record.
 *
 * Pure. The state and the record's current value are the whole input.
 *
 * 14 Sep 2026 reversal: from 12 Sep to 14 Sep this also offered a `client` group — active
 * seats of the record's own client node — so a client contact could be named as owner
 * alongside the firm's own people. Nishant reversed that ("owner field will be exactly
 * people from our organization"): an issue, and an engagement/project node, is owned by
 * the organization's own people only, going forward. `client` is not kept as a
 * degenerate always-empty field; it's gone, along with the anchor id that used to resolve
 * which client's seats to offer.
 */

/** The seeded client-side org roles — the same three `boot()`'s banner and the reducer's
 *  client-seat checks name. A seat holding any of these is on the client's side. */
export const CLIENT_ORG_ROLES: readonly string[] = ['ROLE_CLIENT_SPONSOR', 'ROLE_CLIENT_LEAD', 'ROLE_CLIENT_USER']

export interface OwnerChoices {
  /** The firm's active people, by name. */
  team: Person[]
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

export function ownerChoicesFor(state: WorkspaceState, current: string | null | undefined): OwnerChoices {
  const active = Object.values(state.model.people ?? {}).filter((p) => p.status !== 'Departed')
  const team = active.filter((p) => !isClientSeat(p)).sort(byName)
  const value = (current ?? '').trim()
  const offered = new Set(team.map((p) => p.name))
  const unlisted = value && value !== UNASSIGNED && !offered.has(value) ? value : null
  return { team, unlisted }
}

/** The flat option list a plain `<select>` wants: Unassigned first, then the firm, then the
 *  stored-but-unlisted value last so it is visible and never lost. */
export function ownerOptionValues(choices: OwnerChoices): string[] {
  return [UNASSIGNED, ...choices.team.map((p) => p.name), ...(choices.unlisted ? [choices.unlisted] : [])]
}
