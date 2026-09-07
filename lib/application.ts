/**
 * A client's own technology landscape — what they run, and how it connects.
 *
 * Pure — no clock, no I/O, same discipline as `lib/milestone.ts`. See
 * `docs/plans/2026-09-07-application-suite-design.md` for why this exists and what it
 * deliberately does not do (no live telemetry, no cost tracking, no AI reasoning).
 *
 * ---------------------------------------------------------------------------
 * Health is named concerns, not a score
 *
 * `lib/portfolio.ts` already settled this argument for engagements, and the reasoning carries
 * over unchanged: "name the concerns, count them, and let the reader do the weighing." An
 * application with none says so. This module does not invent a second answer to a question
 * `lib/portfolio.ts` already answered once.
 */

export const APPLICATION_STATUSES = ['Planned', 'Live', 'Decommissioned'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const INTEGRATION_STATUSES = ['Active', 'Inactive', 'Deprecated'] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

export interface Application {
  /** `app-12`, minted from the durable workspace counter — same convention as `ms-N`. */
  id: string
  /** A HierarchyNode of one of this chain's externalParty tiers — see `isExternalPartyKind` in
   *  `./config`. Never checked against the literal string 'client': tiers are configurable per
   *  organisation, and this codebase stopped hardcoding that comparison for exactly this reason. */
  clientNodeId: string

  name: string
  /** D365 F&O | D365 Commerce | D365 CE | Salesforce | Power Platform | Azure service | Fabric |
   *  Custom | ... — free text, like `Engagement.type`, for the same reason: a firm running a
   *  platform this list doesn't name should not be blocked from recording it. */
  platform: string
  /** DEV | UAT | PROD | ... — matches `DISC_ENVIRONMENT`'s own vocabulary
   *  (`lib/config.ts`'s disciplines). Empty means not yet recorded, never guessed. */
  environment: string

  status: ApplicationStatus
  goLiveDate: string | null
  /** Free text, same accountable-party vocabulary pattern as `Issue.accountable`. */
  owner: string
  ownerId: string | null
  vendor: string
  description: string

  recordedBy: string
  recordedAt: string
  deletedAt: string | null
}

export interface IntegrationLink {
  /** `int-12`, minted from the same counter. */
  id: string
  sourceApplicationId: string
  targetApplicationId: string

  /** "OData export", "Power Automate flow", "SFTP batch" — free text, not a fixed technology
   *  enum; a firm's clients run every era of Microsoft integration tooling at once. */
  interface: string
  /** What the integration is FOR, in business terms — "Order fulfilment", "GL posting".
   *  Recorded even though nothing reasons over it yet — see the design doc's own note on why. */
  businessProcess: string
  frequency: string
  status: IntegrationStatus

  recordedBy: string
  recordedAt: string
  deletedAt: string | null
}

export function defaultApplication(id: string, clientNodeId: string): Application {
  return {
    id,
    clientNodeId,
    name: '',
    platform: '',
    environment: '',
    status: 'Planned',
    goLiveDate: null,
    owner: '',
    ownerId: null,
    vendor: '',
    description: '',
    recordedBy: '',
    recordedAt: '',
    deletedAt: null,
  }
}

/** Next `app-N`, counting withdrawn applications too — same reasoning as `nextSequence` in
 *  `lib/milestone.ts`: reusing a removed application's position would put a new one where an
 *  old one sits in an audit trail somebody may be reading beside it. Applications don't have
 *  their own visible sequence today, so this mints the id itself rather than a display number. */
export function nextApplicationId(applications: Record<string, Application>): string {
  let max = 0
  for (const id of Object.keys(applications)) {
    const m = /^app-(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `app-${max + 1}`
}

export function nextIntegrationLinkId(links: Record<string, IntegrationLink>): string {
  let max = 0
  for (const id of Object.keys(links)) {
    const m = /^int-(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `int-${max + 1}`
}

/** A name is the one thing an application record cannot be saved without — everything else
 *  (platform, environment, owner) is real, useful, and legitimately not known yet. */
export function checkApplication(app: Application): string | null {
  if (!app.name.trim()) return 'An application needs a name.'
  return null
}

export function checkIntegrationLink(link: IntegrationLink, applications: Record<string, Application>): string | null {
  if (!applications[link.sourceApplicationId] || applications[link.sourceApplicationId]?.deletedAt) {
    return 'The source application no longer exists.'
  }
  if (!applications[link.targetApplicationId] || applications[link.targetApplicationId]?.deletedAt) {
    return 'The target application no longer exists.'
  }
  if (link.sourceApplicationId === link.targetApplicationId) {
    return 'An integration needs two different applications.'
  }
  return null
}

/* ================================================================== *
 * Concerns — named, counted, never scored. See the module comment.
 * ================================================================== */

export const APPLICATION_CONCERN_ORDER = [
  'openHigh',
  'overdue',
  'integrationsInactive',
] as const
export type ApplicationConcernKind = (typeof APPLICATION_CONCERN_ORDER)[number]

export interface ApplicationConcern {
  kind: ApplicationConcernKind
  count: number
  phrase: string
}

interface ConcernIssueLike {
  applicationId: string | null
  deletedAt: string | null
  severity: string
  /** Caller-supplied, not recomputed here — pass `lib/watch.ts`'s own `overdue` condition
   *  (`kind: 'overdue'` in its findings) so this module counts exactly what that pass already
   *  decided rather than growing a second, possibly-drifting definition of "overdue." */
  overdue: boolean
}

/**
 * The concerns for one application, worst first.
 *
 * `openHigh` leads — `Severity` here is `'High' | 'Medium' | 'Low'` (`lib/types.ts`; there is no
 * `Critical`), so High is the top real signal, and a High-severity issue against a live system
 * is the one that shouldn't wait for a weekly read. `overdue` next, the same "a broken
 * commitment outranks a live one" ordering `lib/portfolio.ts` uses for engagements.
 * `integrationsInactive` last: an inactive integration is often a deliberate, already-known
 * state (deprecated, replaced), weaker evidence than either of the other two.
 */
export function applicationConcerns(
  applicationId: string,
  issues: ConcernIssueLike[],
  links: IntegrationLink[],
): ApplicationConcern[] {
  const mine = issues.filter((i) => i.applicationId === applicationId && !i.deletedAt)
  const openHigh = mine.filter((i) => i.severity === 'High').length
  const overdue = mine.filter((i) => i.overdue).length
  const inactiveLinks = links.filter(
    (l) =>
      !l.deletedAt &&
      l.status === 'Inactive' &&
      (l.sourceApplicationId === applicationId || l.targetApplicationId === applicationId),
  ).length

  const concerns: ApplicationConcern[] = []
  if (openHigh > 0) {
    concerns.push({
      kind: 'openHigh',
      count: openHigh,
      phrase: `${openHigh} open High-severity issue${openHigh === 1 ? '' : 's'}`,
    })
  }
  if (overdue > 0) {
    concerns.push({ kind: 'overdue', count: overdue, phrase: `${overdue} overdue` })
  }
  if (inactiveLinks > 0) {
    concerns.push({
      kind: 'integrationsInactive',
      count: inactiveLinks,
      phrase: `${inactiveLinks} integration${inactiveLinks === 1 ? '' : 's'} marked Inactive`,
    })
  }
  return concerns
}
