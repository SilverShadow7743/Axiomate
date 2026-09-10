import type { FilterState } from './types'
import { NO_CLIENT_CHOSEN } from './types'

/**
 * The Client facet's presentation rules, as pure functions.
 *
 * These rules used to live inline in four components — FilterBar's `isSet` and its resting
 * option, FiltersHeader's `activeCount`, TreeGrid's empty caption, and IssueWorkspace's
 * `scopeLabel` and client-pack refusal — which meant the UI half of AC1 and the sentinel half
 * of AC13 (ART-20260905-023) could be read but never proved: the scenario harness cannot
 * render a component. Holding them here lets `scripts/scenario-validation.ts` pin them (CD5,
 * CD6) the way it pins a reducer arm, and lets the components call one rule instead of four
 * copies of it.
 *
 * Nothing in this module reads React, the operating model or the clock. Every input is passed
 * in by the caller — the filters in force, whether the signed-in actor resolved to a directory
 * person, how many stakeholder projects and clients the scope holds, and the tier label — so a
 * result depends on its arguments alone. Stakeholder counts arrive as numbers because the set
 * itself is derived at read by `clientFilterScopeFor` (`lib/projectBoundary.ts`) and is never
 * stored or recomputed here (BR3).
 */

/**
 * Whether one facet deviates from its resting value.
 *
 * Each key needs its own test: search rests at empty, `showCompleted`/`raidOnly`/`triageOnly`
 * rest at false, and every other facet rests at 'All' — except the Client facet, which rests at
 * `NO_CLIENT_CHOSEN`, a sentinel that is not a choice (BR7), so it must not arm Clear or count
 * towards More. Comparing a boolean against 'All' would have made Clear look permanently
 * armed; comparing the sentinel against 'All' would do the same. The Discipline facet's 'None'
 * is a real query ("records without a discipline") and is active like any other choice — the
 * two tokens are never one.
 */
export function isActiveFilter(key: keyof FilterState, value: string | boolean): boolean {
  if (key === 'search') return value !== ''
  if (key === 'showCompleted' || key === 'raidOnly' || key === 'triageOnly') return value === true
  return value !== 'All' && value !== NO_CLIENT_CHOSEN
}

/**
 * How many facets deviate from the resting view — the number the Filters chip shows.
 *
 * The chip ignores the search box: search has its own visible input, so counting it would
 * report a deviation the person can already see. Every other key goes through
 * `isActiveFilter`, so the chip and Clear agree on what "resting" means per facet.
 */
export function activeFilterCount(filters: FilterState): number {
  return (Object.keys(filters) as (keyof FilterState)[]).filter(
    (k) => k !== 'search' && isActiveFilter(k, filters[k]),
  ).length
}

/**
 * The caption on the Client dropdown's resting option.
 *
 * The bare sentinel is never shown; the option reads as an instruction — "Client: choose one"
 * — so the person knows nothing is listed because nothing has been picked. It is never the
 * word 'None', which the Discipline facet uses beside it with the opposite meaning (BR7).
 */
export function clientRestingCaption(label: string): string {
  return `${label}: choose one`
}

/**
 * Why the grid is empty, in words — or null when the ordinary "no match" caption is right.
 *
 * Consulted only when there are no rows to show, and in this order, because each reason
 * precedes the next: an actor the directory cannot resolve has no stakeholder projects
 * whatever the filters say (BR11); a resolved person on no project sees nothing under any
 * client (AC3, BR18); and only then does the resting sentinel explain an empty grid (AC1).
 * Anything else is a genuine filter miss, and TreeGrid keeps its own wording for that.
 *
 * The first two texts are deliberately distinct from the boot banner's ("there is nothing to
 * show", "You aren't staffed on any project yet" — `lib/db/boot.ts`): the banner speaks about
 * the whole workspace, these speak about the list in front of the person, and the same words
 * in two places would make one look like the other.
 */
export function emptyGridReason({
  filters,
  personResolved,
  stakeholderProjects,
  clientLabel,
}: {
  filters: FilterState
  /** Whether the signed-in actor resolved to a directory Person. */
  personResolved: boolean
  /** How many stakeholder projects the person's scope holds — `memberProjectIds.size`. */
  stakeholderProjects: number
  /** The client tier's display label — `labels.TIER_ORGANIZATION`. */
  clientLabel: string
}): string | null {
  if (!personResolved) {
    return 'This sign-in matches no directory entry, so no client work can be listed — ask the firm to add you.'
  }
  if (stakeholderProjects === 0) {
    return 'You are not a member of any project, so All lists nothing — ask your project manager to add you.'
  }
  if (filters.client === NO_CLIENT_CHOSEN) {
    return `Choose a ${clientLabel.toLowerCase()} in the Filters row to list its issues.`
  }
  return null
}

/**
 * What a report covers, in words, taken from the filters actually in force.
 *
 * The Daily IMS prints this at the top. A status report whose scope is implicit is one people
 * misread once and stop trusting afterwards — and "everything" is itself a scope worth stating
 * rather than leaving blank. Two rules on the Client part:
 *
 * - At `NO_CLIENT_CHOSEN` the first part is 'No client chosen' — the resting value is not a
 *   client and not 'All', and a report built there must say so rather than print a wider
 *   scope over an empty view (AC13).
 * - At 'All' with no other part the base names the person's own scope — how many stakeholder
 *   projects on how many clients, at which organisation — and never the phrase 'All clients'.
 *   Under scoped-All the rows were computed from the person's projects only, and a report
 *   never states a scope wider than the rows it was computed from (BR15).
 *
 * The counts are the scope's, passed in: the label describes what the caller already narrowed
 * to, it does not narrow anything itself.
 */
export function scopeLabelFor(
  filters: FilterState,
  {
    organization,
    stakeholderProjects,
    stakeholderClients,
  }: {
    /** The tenant's organisation name — `state.model.organization.name`. */
    organization: string
    /** How many stakeholder projects the scope holds — `memberProjectIds.size`. */
    stakeholderProjects: number
    /** How many clients those projects (and any ungated records) fall under — the scoped facet's length. */
    stakeholderClients: number
  },
): string {
  const parts: string[] = []
  if (filters.client === NO_CLIENT_CHOSEN) parts.push('No client chosen')
  else if (filters.client !== 'All') parts.push(filters.client)
  if (filters.module !== 'All') parts.push(filters.module)
  if (filters.type !== 'All') parts.push(filters.type)
  if (filters.status !== 'All') parts.push(`status ${filters.status}`)
  if (filters.severity !== 'All') parts.push(`severity ${filters.severity}`)
  if (filters.owner !== 'All') parts.push(`owner ${filters.owner}`)
  if (filters.accountable !== 'All') parts.push(`accountable ${filters.accountable}`)
  if (filters.health !== 'All') parts.push(filters.health)
  if (filters.search.trim()) parts.push(`matching “${filters.search.trim()}”`)
  const base = parts.length
    ? parts.join(' · ')
    : `My projects — ${count(stakeholderProjects, 'project')} on ${count(stakeholderClients, 'client')}, ${organization}`
  return filters.showCompleted ? base : `${base} (completed hidden in the view; counted here)`
}

/**
 * Why a client pack cannot be built from the current Client facet — or null when it can.
 *
 * A pack is for a single client. 'All' is every client the person can see and the resting
 * sentinel is no client at all; both refuse with the same teaching message, because to the
 * person asking for a pack the difference is not the point — picking one client is (AC13).
 */
export function clientPackProblem(client: string): string | null {
  if (client === 'All' || client === NO_CLIENT_CHOSEN) {
    return 'Pick one client first — a client pack is for a single client, not the whole workspace.'
  }
  return null
}

/** `1 project`, `3 projects` — the label's counts read as English, not as `3 project(s)`. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
