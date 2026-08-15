import 'server-only'

/**
 * Who this workspace belongs to.
 *
 * Axiomate is operated by a delivery firm — Axiocloud Solutions here — which serves clients,
 * runs engagements against them, and files issues under those. The *tenant* is the firm, not
 * the client: two firms running Axiomate must never see each other's clients, issues, people
 * or configuration, while OAPIL and SLG are two clients of the same firm and belong in the
 * same tree.
 *
 * That boundary sits above the hierarchy rather than inside it. The `company:root` node is
 * how the firm appears *in* the tree — a tier a user can rename and archive. The tenant is
 * the isolation key the tree hangs from, and nothing in the application may edit it.
 *
 * ---------------------------------------------------------------------------
 * What this is, and what it is not
 *
 * It is a scoped data model: every table carries the tenant, every application-supplied id is
 * unique only *within* one, and every query and write in `lib/db` names one. That is the part
 * that is expensive to retrofit, so it is done before the first migration is applied.
 *
 * It is **not** enforced isolation. There is no identity in this application — no user, no
 * session, no role binding (see the Governance & Security row of the capability matrix) — so
 * nothing establishes *which* tenant a request belongs to. `currentTenantId` resolves one
 * configured tenant and is the single seam where real resolution plugs in. Until it does,
 * isolation is a discipline the code follows, not a guarantee the database enforces; the
 * guarantee is row-level security, and it arrives with identity, not before it.
 */

/**
 * A tenant id that has been through `currentTenantId`.
 *
 * Branded so an arbitrary string cannot reach a repository function. Every query in `lib/db`
 * takes one of these as its first argument and there is no un-scoped alternative to reach
 * for, which turns "remember to filter by tenant" from a convention into a compile error —
 * the same move as `isNodeKind`, for the same reason.
 */
export type TenantId = string & { readonly __brand: unique symbol }

/**
 * The tenant this deployment serves when nothing says otherwise.
 *
 * A slug rather than a generated key: it appears in browser storage keys and in operational
 * queries, and a readable one makes both legible. It is deliberately not the firm's display
 * name — the same separation `partyCode` keeps from `OrganizationIdentity.name`, so renaming
 * the firm never orphans the rows filed under it.
 */
export const DEFAULT_TENANT_ID = 'axiocloud'

/** Slug rules, applied at the seam so nothing downstream has to re-check them. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/**
 * The tenant for this request.
 *
 * Today it reads one configured value, because there is no identity to derive it from. When
 * there is, this is the function that changes — resolving from the session, a subdomain or a
 * header — and nothing downstream moves, because everything downstream already takes the
 * result as a parameter.
 *
 * A malformed value throws rather than falling back. Quietly serving the default tenant to a
 * request that asked for another one is precisely the failure this whole boundary exists to
 * prevent, and it would be invisible.
 */
export function currentTenantId(): TenantId {
  const configured = process.env.AXIOMATE_TENANT?.trim()
  if (!configured) return DEFAULT_TENANT_ID as TenantId
  if (!SLUG.test(configured)) {
    throw new Error(
      `AXIOMATE_TENANT must be a lowercase slug (letters, digits, hyphens), not "${configured}".`,
    )
  }
  return configured as TenantId
}

/**
 * The display name written when a tenant row is first created.
 *
 * A provisioning label, not the configured one: `OperatingModel.organization.name` is what the
 * application renders and what a user edits, and it supersedes this everywhere it exists. This
 * is here for the case that one cannot cover — a tenant that has been created but has no
 * operating model yet — and for operational queries that must not have to open a JSON column
 * to find out whose data they are looking at.
 */
export function provisioningName(id: TenantId): string {
  return id === DEFAULT_TENANT_ID ? 'Axiocloud Solutions' : id
}
