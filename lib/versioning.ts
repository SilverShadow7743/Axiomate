/**
 * What was true, from when, and why it changed.
 *
 * Resource data is overwritten today. A working pattern — and later a role, a manager, a
 * location, a cost rate — holds one value, the current one, and a change destroys the previous
 * one. That is fine until something has to be explained: a utilisation figure computed last
 * quarter, a margin on work delivered in March, a report that said something different when it
 * was run. None of that can be recovered afterwards, which is why this is worth building before
 * there is much history to lose rather than after.
 *
 * ---------------------------------------------------------------------------
 * One time axis, not two
 *
 * A correction rewrites the timeline. It does not record what was previously believed, because
 * the audit trail already does: a correction is itself an audited change carrying from, to, when
 * and who. So "what did we believe on the eighteenth" is answerable by *reading* the trail even
 * though it is not *queryable* as a second axis — which was the trade deliberately made against
 * full bitemporality, at roughly half the mechanism.
 *
 * What makes that safe rather than reckless is `Stamped`. Anything that acts on a value copies
 * it and records which version it came from, so a later correction moves the timeline and the
 * committed figure does not move. Without it there are only two systems available and both are
 * bad: one where corrections are forbidden, so the data stays wrong forever, and one where a
 * correction silently rewrites money already invoiced.
 *
 * ---------------------------------------------------------------------------
 * Pure
 *
 * No clock, no database, no framework. Every date is passed in. That is what lets the scenario
 * harness drive the boundary arithmetic directly, before any of this has a caller — and boundary
 * arithmetic is where this kind of code goes wrong, quietly.
 */

/* ================================================================== *
 * The records
 * ================================================================== */

/**
 * One period, and the whole value that was true throughout it.
 *
 * A snapshot rather than a delta, for the reason `EstimateRevision` already found: a snapshot
 * renders as history without assembly and cannot be half-reconstructed. The cost is that
 * changing one field writes a whole new value, which is storage — and storage is cheaper than
 * an answer nobody can put back together.
 */
export interface Version<T = unknown> {
  /** `ver-12`, minted from the workspace counter. */
  id: string
  /**
   * What kind of thing this is a version of — `person.workingPattern` today, roles and rates
   * later.
   *
   * Present from the first version rather than added when the second entity needs it. The
   * alternative is a table per kind, and a table per kind is four chances to implement the
   * overlap rule differently.
   */
  subjectKind: string
  /** The person, node or record it belongs to. */
  subjectId: string
  /** ISO date. When it became true in the world, not when anybody typed it. */
  validFrom: string
  /**
   * ISO date, exclusive, or null while it is still true.
   *
   * Exclusive so that a period ending on the thirtieth and one beginning on the first do not
   * overlap, and a query for the thirtieth finds the first of them. Inclusive-versus-exclusive
   * is the classic place this arithmetic goes wrong and it goes wrong silently, so every
   * boundary test in the harness states which it is.
   */
  validTo: string | null
  value: T
  /** When we were told. Distinct from `validFrom`, and usually later. */
  recordedAt: string
  /** Attribution, taken from the same actor the audit entry gets — see `identityOf`. */
  by: string
  byId?: string
  byEmail?: string | null
  /** Why. A version that cannot explain itself later is most of the point thrown away. */
  reason: string
}

/**
 * A value copied at the moment something acted on it.
 *
 * The rate on an approved timesheet line, the working pattern a utilisation figure was computed
 * from. `stampedFrom` names the version it came from, so a discrepancy between a stamped figure
 * and the current timeline can be explained rather than merely noticed.
 */
export interface Stamped<T = unknown> {
  value: T
  /** The `Version.id` this was taken from. */
  stampedFrom: string
  stampedAt: string
}

/** Anything holding a stamp, for reporting what a correction would affect. */
export interface StampReference {
  stampedFrom: string
  /** What it is, in the words a person would use: "the week of 17 Aug, approved". */
  describes: string
}

/* ================================================================== *
 * Reading
 * ================================================================== */

const of = <T>(versions: Version<T>[], kind: string, id: string) =>
  versions.filter((v) => v.subjectKind === kind && v.subjectId === id)

/** ISO dates compare correctly as strings, which is most of why they are stored as strings. */
const covers = (v: Version<unknown>, on: string) =>
  v.validFrom <= on && (v.validTo === null || on < v.validTo)

/**
 * What was true on a date, or null.
 *
 * **Null is the feature.** A date before somebody joined has no working pattern, and answering
 * seven and a half hours would invent one — which is the failure this whole mechanism exists to
 * prevent, reintroduced at the last step. Every caller treats null as "not known then"; the
 * tempting fix of falling back to the current value, or to a default, silently destroys the
 * property and still returns a plausible number.
 *
 * It is the same rule kept elsewhere in this codebase: `availabilityOf` answers `unknown` rather
 * than `clear` for a person nobody has described, and a seeded working pattern reads
 * `source: 'default'` so that an assumed week is never mistaken for a stated one.
 */
export function valueAt<T>(
  versions: Version<T>[],
  kind: string,
  id: string,
  on: string,
): Version<T> | null {
  return of(versions, kind, id).find((v) => covers(v, on)) ?? null
}

/** Every period for one subject, oldest first. For a history panel, and for `overlapProblem`. */
export function timelineOf<T>(versions: Version<T>[], kind: string, id: string): Version<T>[] {
  return [...of(versions, kind, id)].sort((a, b) => a.validFrom.localeCompare(b.validFrom))
}

/* ================================================================== *
 * The invariant
 * ================================================================== */

/** What a period is being asked to be, before it exists or when it is being corrected. */
export interface Candidate {
  /** Set when correcting an existing period, so it is not compared against itself. */
  id?: string
  subjectKind: string
  subjectId: string
  validFrom: string
  validTo: string | null
}

const OPEN = '9999-12-31'
const endOf = (v: { validTo: string | null }) => v.validTo ?? OPEN

const readable = (v: { validFrom: string; validTo: string | null }) =>
  v.validTo ? `${v.validFrom} to ${v.validTo}` : `${v.validFrom} onwards`

/**
 * Whether this period can exist alongside the ones already recorded.
 *
 * Two rules, and the second is the one people expect to be the other way round.
 *
 * **Overlaps are refused.** Two versions of one subject cannot both be true on a date, because
 * then `valueAt` has to choose and any rule it uses is arbitrary. This is the invariant worth
 * the most test coverage.
 *
 * **Gaps are allowed.** Somebody who left and rejoined has one, and so does a contractor between
 * engagements. Forcing contiguity would invent employment to satisfy a data model, which is the
 * same class of mistake as inventing a working week.
 */
export function overlapProblem(versions: Version<unknown>[], candidate: Candidate): string | null {
  if (candidate.validTo !== null && candidate.validTo <= candidate.validFrom) {
    return `A period has to end after it starts, and this one runs ${readable(candidate)}.`
  }

  const clash = of(versions, candidate.subjectKind, candidate.subjectId)
    .filter((v) => v.id !== candidate.id)
    .find((v) => candidate.validFrom < endOf(v) && v.validFrom < endOf(candidate))

  if (!clash) return null
  return `That period overlaps one already recorded: ${readable(clash)}. Two versions of the same thing cannot both be true on one date — close the earlier period first.`
}

/* ================================================================== *
 * Correcting
 * ================================================================== */

/**
 * What a correction to this version would affect, in the words of the things affected.
 *
 * Reported, never blocked. Somebody correcting a date usually knows something the system does
 * not — that a promotion was backdated, that a contract started earlier than anybody filed. What
 * they should not do is change it without being told that three approved timesheets were
 * computed from it.
 *
 * Those figures do not move: a stamp holds its own copy of the value. The point of saying so is
 * that the person can then explain the difference, rather than discovering it in a finance
 * conversation.
 */
export function correctionImpact(stamps: StampReference[], versionId: string): string[] {
  return stamps.filter((s) => s.stampedFrom === versionId).map((s) => s.describes)
}

/** One sentence for a refusal or a warning, or null when nothing was stamped from it. */
export function describeImpact(affected: string[]): string | null {
  if (!affected.length) return null
  const list = affected.slice(0, 3).join(', ')
  const more = affected.length > 3 ? `, and ${affected.length - 3} more` : ''
  return `${affected.length} record${affected.length === 1 ? ' was' : 's were'} computed from this version — ${list}${more}. ${affected.length === 1 ? 'It keeps' : 'They keep'} the value used at the time; correcting this does not change ${affected.length === 1 ? 'it' : 'them'}.`
}

/* ================================================================== *
 * Stamping
 * ================================================================== */

/**
 * Take a copy of what is true now, so that a later correction cannot move it.
 *
 * Returns null when nothing covers the date — a caller cannot stamp what was never known, and
 * inventing a value at exactly the moment it becomes load-bearing would be the worst possible
 * place to do it.
 */
export function stamp<T>(version: Version<T> | null, at: string): Stamped<T> | null {
  if (!version) return null
  return { value: version.value, stampedFrom: version.id, stampedAt: at }
}
