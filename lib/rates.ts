import { overlapProblem, valueAt, timelineOf, type Version } from './versioning'
import type { TimeEntry } from './time'

/**
 * What a person costs and what they are charged out at, over a period.
 *
 * Pure — no clock, no I/O. The arithmetic and the periods are here; who may see any of it is
 * decided in `lib/db/boot.ts` and `lib/access.ts`.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own record and not a `Version`
 *
 * `Version` already does effective dating properly, and `lib/versioning.ts` predicts this exact
 * use: *"a working pattern — and later a role, a manager, a location, a cost rate."* Reusing it
 * would have been one line of vocabulary.
 *
 * It is not reused, for one reason: `WorkspaceState.versions` is serialised into the page payload
 * and reaches the browser. `boot()` already learned this the expensive way — the gate withheld
 * the issues and shipped the summary of them, and the comment there records that emptying "the
 * two obvious collections" was not the whole job. Putting a cost rate in the same collection as
 * a working pattern would mean every reader of any dated fact is a reader of everybody's salary.
 *
 * So rates are a separate collection with a separate permission, redacted in `boot()` for anyone
 * without `rate.view`. The *mechanism* is still shared — every function below delegates to
 * `lib/versioning.ts`, so the exclusive `validTo`, the overlap refusal and the "null means not
 * known then" rule are the ones already proven, not a second implementation of them.
 *
 * ---------------------------------------------------------------------------
 * Two rates, not one
 *
 * `cost` is what the firm pays for an hour of somebody's time. `bill` is what a client is
 * charged for it. They move independently — a pay rise does not change a signed rate card, and a
 * renegotiated rate card does not change anybody's salary — and the difference between them is
 * the margin, which is the number this whole record exists to make computable.
 *
 * Keeping them in one table with a `kind` rather than two columns on one row is deliberate: they
 * have different effective dates. A row per rate per period is the only shape that can say "the
 * bill rate changed in April and the cost rate did not".
 */

export type RateKind = 'cost' | 'bill'

export interface PersonRate {
  /** `rate-12`, minted from the durable workspace counter. */
  id: string
  /** The directory id. Not a name — a rate outliving a rename is the point of a stable key. */
  personId: string
  kind: RateKind
  /** Inclusive. */
  validFrom: string
  /** EXCLUSIVE, and null means "still true". Same rule as `Version`. */
  validTo: string | null
  /** Per hour, in `currency`. Decimal in the database, because it is money and it will be summed. */
  amount: number
  currency: string
  recordedAt: string
  by: string
  byId?: string
  byEmail?: string | null
  reason: string
}

/** The subject key a rate is dated under, so the shared machinery can be reused verbatim. */
const subjectOf = (kind: RateKind) => `person.${kind}Rate`

/**
 * Rates as `Version`s, so `valueAt` and `overlapProblem` can be used unchanged.
 *
 * A view, not a copy that is stored. The alternative is reimplementing `covers` here, which is
 * exactly the second implementation of the boundary rule that the effective-dating design went
 * out of its way to avoid.
 */
function asVersions(rates: PersonRate[]): Version<{ amount: number; currency: string }>[] {
  return rates.map((r) => ({
    id: r.id,
    subjectKind: subjectOf(r.kind),
    subjectId: r.personId,
    validFrom: r.validFrom,
    validTo: r.validTo,
    value: { amount: r.amount, currency: r.currency },
    recordedAt: r.recordedAt,
    by: r.by,
    byId: r.byId,
    byEmail: r.byEmail,
    reason: r.reason,
  }))
}

/**
 * What this person cost, or was charged at, on this date.
 *
 * **Null is the answer when nothing was recorded for that date, and it does not fall back.**
 * A cost computed from an assumed rate is not a smaller version of the truth, it is a number
 * somebody will quote in a margin review. Where capacity could honestly default and label the
 * default, money cannot: there is no defensible shipped rate for a person.
 */
export function rateAt(
  rates: PersonRate[],
  personId: string,
  kind: RateKind,
  on: string,
): PersonRate | null {
  const hit = valueAt(asVersions(rates), subjectOf(kind), personId, on)
  return hit ? (rates.find((r) => r.id === hit.id) ?? null) : null
}

/** Every period recorded for one person and one kind, oldest first. */
export function rateTimeline(rates: PersonRate[], personId: string, kind: RateKind): PersonRate[] {
  const ids = new Set(timelineOf(asVersions(rates), subjectOf(kind), personId).map((v) => v.id))
  return rates.filter((r) => ids.has(r.id)).sort((a, b) => a.validFrom.localeCompare(b.validFrom))
}

/** Why this period cannot be recorded, or null. Delegates the boundary arithmetic. */
export function rateProblem(
  rates: PersonRate[],
  candidate: { id?: string; personId: string; kind: RateKind; validFrom: string; validTo: string | null },
): string | null {
  return overlapProblem(asVersions(rates), {
    id: candidate.id,
    subjectKind: subjectOf(candidate.kind),
    subjectId: candidate.personId,
    validFrom: candidate.validFrom,
    validTo: candidate.validTo,
  })
}

export interface CostOfWork {
  hours: number
  /** Null when any hour in the set had no rate on its own day — see `costOf`. */
  cost: number | null
  revenue: number | null
  margin: number | null
  marginPct: number | null
  currency: string | null
  /** Hours that had no rate on their date. The reason a total is null, and how big the hole is. */
  unratedHours: number
}

/**
 * What a set of worked hours cost and earned.
 *
 * Each hour is priced at the rate in force **on the day it was worked**, not today's — which is
 * the whole reason rates are dated. A pay rise in July does not retrospectively change what March
 * cost, and a margin recomputed after one would otherwise quietly move.
 *
 * **A single unrated hour makes the total null**, and `unratedHours` says how many. A partial sum
 * presented as a total is the failure this refuses: it looks like an answer, it is smaller than
 * the truth by an unknown amount, and nothing about it says so.
 *
 * Mixed currencies also yield null. Converting needs a rate on a date and this module has no
 * business inventing one.
 */
export function costOf(
  rates: PersonRate[],
  worked: { personId: string; date: string; hours: number }[],
): CostOfWork {
  let hours = 0
  let cost = 0
  let revenue = 0
  let unratedHours = 0
  let currency: string | null = null
  let mixed = false

  for (const w of worked) {
    hours += w.hours
    const c = rateAt(rates, w.personId, 'cost', w.date)
    const b = rateAt(rates, w.personId, 'bill', w.date)
    if (!c || !b) {
      unratedHours += w.hours
      continue
    }
    if (currency === null) currency = c.currency
    if (c.currency !== currency || b.currency !== currency) mixed = true
    cost += c.amount * w.hours
    revenue += b.amount * w.hours
  }

  const round = (n: number) => Math.round(n * 100) / 100
  const complete = unratedHours === 0 && !mixed && currency !== null
  if (!complete) {
    return { hours: round(hours), cost: null, revenue: null, margin: null, marginPct: null, currency: mixed ? null : currency, unratedHours: round(unratedHours) }
  }
  const margin = revenue - cost
  return {
    hours: round(hours),
    cost: round(cost),
    revenue: round(revenue),
    margin: round(margin),
    marginPct: revenue > 0 ? round((margin / revenue) * 100) : null,
    currency,
    unratedHours: 0,
  }
}

/**
 * What a SOW's real worked hours cost and earned — the join between "which hours belong to this
 * SOW" and `costOf`'s own pricing. No new pricing logic; this function only gathers the input.
 *
 * An entry with no resolvable `personId` (an unresolved name — the one place the person/personId
 * join still happens on a name rather than a stored id) folds into `unratedHours` exactly like an
 * entry with no rate on its day: two different causes, one honest absence, never two silent
 * failure modes wearing the same blank space.
 */
export function sowCostOf(
  rates: PersonRate[],
  issueIds: string[],
  timeEntries: Record<string, TimeEntry>,
): CostOfWork {
  const live = Object.values(timeEntries).filter((e) => !e.deletedAt && issueIds.includes(e.issueId))
  const withPerson = live.filter((e) => e.personId)
  const noPersonHours =
    withPerson.length === live.length
      ? 0
      : Math.round(live.filter((e) => !e.personId).reduce((n, e) => n + e.hours, 0) * 100) / 100

  const priced = costOf(
    rates,
    withPerson.map((e) => ({ personId: e.personId!, date: e.date, hours: e.hours })),
  )
  if (noPersonHours === 0) return priced

  return {
    hours: Math.round((priced.hours + noPersonHours) * 100) / 100,
    cost: null,
    revenue: null,
    margin: null,
    marginPct: null,
    currency: priced.currency,
    unratedHours: Math.round((priced.unratedHours + noPersonHours) * 100) / 100,
  }
}

/** How a cost position reads, leading with what is missing when anything is. */
export function describeCost(c: CostOfWork): string {
  if (c.cost === null) {
    return c.unratedHours > 0
      ? `${c.hours}h worked, and ${c.unratedHours}h of it has no rate on the day it was worked — so there is no cost to report rather than a smaller one.`
      : `${c.hours}h worked across more than one currency, which cannot be summed without a conversion nobody has recorded.`
  }
  return `${c.hours}h · cost ${c.currency} ${c.cost.toLocaleString()} · billed ${c.currency} ${(c.revenue ?? 0).toLocaleString()} · margin ${c.currency} ${(c.margin ?? 0).toLocaleString()}${c.marginPct === null ? '' : ` (${c.marginPct}%)`}`
}
