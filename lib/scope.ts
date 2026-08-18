/**
 * What a statement of work actually says it will deliver.
 *
 * Pure — no clock, no I/O. Every function is given what it needs to reason about.
 *
 * ---------------------------------------------------------------------------
 * Scope items, not tree tiers
 *
 * The revised operating model puts Process, Scenario and Configuration Deliverable in a work
 * hierarchy beneath Process Area. They are recorded here instead, as kinds of scope item hanging
 * off a SOW — settled 18 August, and it is the cheaper answer by a wide margin: the tree stays
 * where it is, and `NODE_KINDS`, `ALLOWED_PARENTS`, `canParent`, the tree builder,
 * `CREATABLE_KINDS`, the scope-override chain and the intake parent check are all untouched. The
 * last of those once refused every client email with a 409 nobody saw.
 *
 * `Sow.scope` remains what it always was — the agreement in the document's own words, read by
 * people. This is the structured version, and the two are not required to agree: a paragraph and
 * a list of line items are different renderings of one negotiation, and forcing them to match
 * would mean editing the contract's wording to satisfy a table.
 *
 * ---------------------------------------------------------------------------
 * `milestone` is deliberately NOT a kind here
 *
 * The audit proposed the kind union as
 * `deliverable | assumption | exclusion | acceptance | milestone`, and that was written before
 * `Milestone` existed as a record. It exists now — with a payment schedule, two independent
 * delivery and acceptance axes, and a value frozen at acceptance — so a scope item of kind
 * `milestone` would be a second home for one concept. Two homes for one concept is the fault
 * this codebase has spent several days removing, so the union drops it.
 *
 * ---------------------------------------------------------------------------
 * Three questions, and this record answers one of them
 *
 * A deliverable can be asked three different things, and they are genuinely separate:
 *
 *   1. **Is it in the agreed scope?**   — approval. What this record answers.
 *   2. **Has it been delivered?**       — a delivery state.
 *   3. **Has the client accepted it?**  — an acceptance state.
 *
 * Only the first is built here. Two and three are the two-axis model `lib/milestone.ts` already
 * implements, and adding a second copy of it before deciding how a delivered *deliverable*
 * relates to an accepted *milestone* would be duplicating the thing rather than reusing it. So
 * this carries the acceptance CRITERIA — the text a reviewer judges against — and not yet the
 * states. That reconciliation is the baseline decision recorded in
 * `docs/plans/2026-08-18-operating-model.md` §1a.
 */

/**
 * What a line of scope is.
 *
 * `acceptance` is a criterion in its own right rather than a field on a deliverable, because a
 * criterion is frequently negotiated separately, frequently numbered in the contract, and
 * frequently attaches to more than the one deliverable somebody would have hung it on. It uses
 * `parentId` to say which deliverable it judges.
 */
export const SCOPE_KINDS = [
  'deliverable',
  'acceptance',
  'assumption',
  'exclusion',
  'process',
  'scenario',
  'configuration',
] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

export const SCOPE_KIND_LABEL: Record<ScopeKind, string> = {
  deliverable: 'Deliverable',
  acceptance: 'Acceptance criterion',
  assumption: 'Assumption',
  exclusion: 'Exclusion',
  process: 'Process',
  scenario: 'Scenario',
  configuration: 'Configuration deliverable',
}

/**
 * Kinds that represent work somebody has to do, and therefore carry effort.
 *
 * An assumption, an exclusion and an acceptance criterion are statements about the agreement
 * rather than things anybody builds. Letting them carry hours would put figures into the scope
 * total that nobody is ever going to work.
 */
export const WORK_KINDS: ScopeKind[] = ['deliverable', 'process', 'scenario', 'configuration']

/**
 * Where the line came from.
 *
 * The same vocabulary as `ResourceProfile.source` and `intake.confidence`, for the same reason:
 * a figure and its provenance get separated the moment they can be.
 *
 * **`extracted` has no producer today.** SOW intelligence — reading a signed document and
 * proposing scope from it — is blocked on a document library that needs one administrator
 * consent, so every item in the product is `stated` until that lands. The value exists now
 * rather than later because retrofitting provenance onto rows already recorded means guessing at
 * it, and a guessed provenance is worse than none.
 */
export const SCOPE_SOURCES = ['stated', 'extracted'] as const
export type ScopeSource = (typeof SCOPE_SOURCES)[number]

export interface ScopeItem {
  /** `scope-12`, minted from the durable workspace counter. */
  id: string
  sowId: string
  kind: ScopeKind
  /** What was agreed, in a line. The contract's own words live on `Sow.scope`. */
  text: string
  /**
   * One level only, and enforced as one level.
   *
   * An acceptance criterion hangs off the deliverable it judges; a scenario hangs off its
   * process. What this is NOT is a work breakdown — that was the question settled on 18 August,
   * and a scope list that grew arbitrary depth would become one by accident. A parent must
   * itself have no parent, which is a rule that can be checked in one comparison and cannot
   * produce a cycle.
   */
  parentId: string | null
  /** Null on kinds that are statements rather than work. See `WORK_KINDS`. */
  effortHours: number | null
  source: ScopeSource
  /** Presentation order, and the order the scope reads in. Not a dependency. */
  sequence: number

  /**
   * When this line became part of the agreed scope, and who said so.
   *
   * The only one of the three questions in the module note that this record answers. Null means
   * recorded but not agreed — which is the normal state of anything a machine proposed, and a
   * perfectly normal state for something a person typed while reading a draft.
   */
  approvedBy: string | null
  approvedAt: string | null

  recordedBy: string
  recordedAt: string
  deletedAt: string | null
}

/* ================================================================== *
 * Rules
 * ================================================================== */

/** Why this scope item cannot be recorded as it stands, or null. */
export function checkScopeItem(
  item: Pick<ScopeItem, 'kind' | 'text' | 'effortHours'>,
): string | null {
  if (!item.text.trim()) return 'A line of scope needs to say something.'
  if (!(SCOPE_KINDS as readonly string[]).includes(item.kind)) {
    return 'That is not a kind of scope this product knows.'
  }
  if (item.effortHours !== null) {
    if (!WORK_KINDS.includes(item.kind)) {
      return `A${item.kind === 'acceptance' ? 'n' : ''} ${SCOPE_KIND_LABEL[item.kind].toLowerCase()} is a statement about the agreement, not work somebody does, so it carries no hours.`
    }
    if (!Number.isFinite(item.effortHours) || item.effortHours < 0) {
      return 'Effort is a number of hours, and not a negative one.'
    }
  }
  return null
}

/**
 * Why this item cannot hang off that parent, or null.
 *
 * One level, checked as one level. See `ScopeItem.parentId`.
 */
export function parentProblem(items: ScopeItem[], childId: string | null, parentId: string): string | null {
  if (childId && parentId === childId) return 'A line of scope cannot sit under itself.'
  const parent = items.find((i) => i.id === parentId && !i.deletedAt)
  if (!parent) return 'That line of scope no longer exists.'
  if (parent.parentId) {
    return `“${parent.text.slice(0, 40)}” already sits under something else. Scope is one level deep — it lists what was agreed, and a work breakdown is a different thing.`
  }
  return null
}

/* ================================================================== *
 * The position
 * ================================================================== */

export interface ScopePosition {
  sowId: string
  /** Every live line, whatever its kind or approval. */
  count: number
  approved: number
  /** Recorded and not yet agreed. Reported, never counted as scope. */
  pending: number
  /** Lines a machine proposed. Zero until SOW intelligence exists — see `SCOPE_SOURCES`. */
  extracted: number
  byKind: Record<ScopeKind, number>
  /**
   * Hours across APPROVED work lines only.
   *
   * Pending lines are excluded deliberately: a proposal nobody has agreed to is not scope, and
   * adding its hours to a total that gets compared against a contract would make the comparison
   * report a variance somebody invented rather than one anybody agreed.
   */
  approvedEffortHours: number
  /** Hours across every work line, agreed or not. Shown beside the above, never instead of it. */
  totalEffortHours: number
  /** What the contract says, so the two can be compared. See `effortProblem`. */
  contractedHours: number
}

export function scopePosition(
  sowId: string,
  items: ScopeItem[],
  contractedHours: number,
): ScopePosition {
  const mine = items.filter((i) => i.sowId === sowId && !i.deletedAt)
  const byKind = Object.fromEntries(SCOPE_KINDS.map((k) => [k, 0])) as Record<ScopeKind, number>
  for (const i of mine) byKind[i.kind] += 1

  const work = mine.filter((i) => WORK_KINDS.includes(i.kind))
  const sum = (rows: ScopeItem[]) => round(rows.reduce((n, i) => n + (i.effortHours ?? 0), 0))

  return {
    sowId,
    count: mine.length,
    approved: mine.filter((i) => i.approvedAt).length,
    pending: mine.filter((i) => !i.approvedAt).length,
    extracted: mine.filter((i) => i.source === 'extracted').length,
    byKind,
    approvedEffortHours: sum(work.filter((i) => i.approvedAt)),
    totalEffortHours: sum(work),
    contractedHours,
  }
}

/**
 * How the scope's effort compares with the contract's, as a sentence, or null.
 *
 * **Reported, never enforced**, and the reason is the same one the milestone schedule gives: a
 * firm entering forty deliverables passes through every intermediate total on the way, so a
 * reducer that refused any set not summing to the contracted figure would make the second line
 * impossible to save.
 *
 * That the two figures have a stated relationship at all is the point. `Sow.effortHours` is what
 * was contracted and `ScopeItem.effortHours` is what the work is thought to take, and the moment
 * both exist somebody will sum the second and compare it with the first. Two effort figures with
 * no stated relationship is precisely how `SowPosition` came to measure consumption against a
 * baseline that had been formally varied.
 */
export function effortProblem(p: ScopePosition): string | null {
  if (!p.contractedHours || !p.approvedEffortHours) return null
  const delta = round(p.approvedEffortHours - p.contractedHours)
  if (delta === 0) return null
  const pct = Math.abs(round((delta / p.contractedHours) * 100))
  // A line or two of rounding is not a finding. Five per cent is where it starts being one.
  if (pct < 5) return null
  return delta > 0
    ? `The agreed scope adds up to ${p.approvedEffortHours}h against ${p.contractedHours}h contracted — ${delta}h more than was sold, which is either an estimate to revisit or a change request nobody raised.`
    : `The agreed scope adds up to ${p.approvedEffortHours}h against ${p.contractedHours}h contracted, leaving ${Math.abs(delta)}h unaccounted for. Either something agreed has not been written down, or the contract carries more than the scope does.`
}

/** How the scope reads. Says what is agreed before what merely exists. */
export function describeScope(p: ScopePosition): string {
  if (!p.count) {
    return 'No scope is recorded against this statement of work. The agreement is whatever the document says, and nothing here can be measured against it.'
  }
  const parts = [`${p.count} ${p.count === 1 ? 'line' : 'lines'}`, `${p.approved} agreed`]
  if (p.pending) parts.push(`${p.pending} recorded and not yet agreed`)
  if (p.extracted) parts.push(`${p.extracted} proposed by extraction`)

  const effort = p.approvedEffortHours
    ? ` ${p.approvedEffortHours}h of agreed work${p.totalEffortHours !== p.approvedEffortHours ? ` (${p.totalEffortHours}h including what is not yet agreed)` : ''}.`
    : ''
  const gap = effortProblem(p)
  return `${parts.join(', ')}.${effort}${gap ? ` ${gap}` : ''}`
}

/** The next position in a SOW's scope list. Counts withdrawn lines, as milestones do. */
export function nextScopeSequence(items: Record<string, ScopeItem>, sowId: string): number {
  return Object.values(items)
    .filter((i) => i.sowId === sowId)
    .reduce((n, i) => Math.max(n, i.sequence), 0) + 1
}

/** Live lines for one SOW, parents before their children, in sequence. */
export function scopeFor(items: ScopeItem[], sowId: string): ScopeItem[] {
  const mine = items.filter((i) => i.sowId === sowId && !i.deletedAt)
  const tops = mine.filter((i) => !i.parentId).sort((a, b) => a.sequence - b.sequence)
  const out: ScopeItem[] = []
  for (const top of tops) {
    out.push(top)
    out.push(...mine.filter((i) => i.parentId === top.id).sort((a, b) => a.sequence - b.sequence))
  }
  // Anything whose parent has been withdrawn still belongs to the SOW and must not vanish.
  out.push(...mine.filter((i) => i.parentId && !tops.some((t) => t.id === i.parentId)))
  return out
}

const round = (n: number) => Math.round(n * 100) / 100
