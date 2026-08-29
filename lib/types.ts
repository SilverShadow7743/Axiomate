/**
 * Axiomate TMS — domain types for the Issue Tree & Resolution Schedule.
 *
 * Two concepts are deliberately kept apart (see spec §14):
 *   - IssueRelationship: a business/logical link between issues (OAPIL-007 RELATED TO OAPIL-008)
 *   - IssueDependency:   a *scheduling* constraint between activities (Corrective Action FS -> Verification)
 * They are stored in separate structures and never merged.
 */

import type { RichDoc } from './richText'

/* ================================================================== *
 * The tier vocabulary — declared once, derived everywhere
 * ================================================================== */

/**
 * The structural tiers of the delivery chain, ordered coarse → fine.
 *
 * **This is the only place these five strings are written down as a set.** They were
 * previously spelled out in three enumerations that had already drifted apart: `NodeKind`
 * carried five tiers, `RowKind` restated them plus three leaf kinds, and a third list called
 * the client tier `organization`, omitted `company` entirely, and had no consumer at all.
 * Three lists meant three places to edit when a tier is added, and the evidence that nobody
 * would is that they already disagreed.
 *
 * The strings themselves are load-bearing data, not just types: node ids are constructed from
 * them (`company:root`, `module:OAPIL:Inventory`), the mirror-reconciliation guard matches on
 * them, and the database enum is their uppercase form. So this consolidates the declarations
 * and changes no spelling — every id already stored in a browser or a database still parses.
 */
export const NODE_KINDS = ['company', 'client', 'engagement', 'project', 'outcome', 'module'] as const

/**
 * The DEFAULT tier kinds — the shipped structural vocabulary, no longer the only possible
 * one. Tiers are configurable per organisation (`tiersOf` in `./config`), so the closed set
 * in this file is `LEAF_ROW_KINDS`: the execution core every organisation shares. This list
 * remains load-bearing where only defaults can appear — the seed path, the mirror
 * reconciliation regex, and the database kind mapping that Step 4 of the E0 plan retires.
 */
export type DefaultNodeKind = (typeof NODE_KINDS)[number]

/**
 * A structural tier kind. Open, because the tier chain above Project is per-organisation
 * configuration — the invariant vocabulary is the leaf set below, not this.
 */
export type NodeKind = string

/** Rows that carry work rather than summarising it. THE closed vocabulary of this file. */
export const LEAF_ROW_KINDS = ['issue', 'activity', 'milestone'] as const
export type LeafRowKind = (typeof LEAF_ROW_KINDS)[number]

/** The default row kinds — default tiers plus the invariant leaves. */
export const ROW_KINDS = [...NODE_KINDS, ...LEAF_ROW_KINDS] as const
export type RowKind = string

const LEAF_KINDS: ReadonlySet<string> = new Set(LEAF_ROW_KINDS)

/**
 * Rows that summarise the rows beneath them rather than carrying work of their own.
 *
 * The membership test is INVERTED from what it used to be: it enumerates the leaves, not the
 * tiers, because the leaf set is the invariant execution core while the tier set is open
 * configuration. Any kind that is not a leaf is a group row — which is how an org-defined
 * tier gets the group treatment (banner rendering, no inline editors, rollup rows) without
 * anyone remembering to register it in a display list.
 */
export function isGroupRow(kind: RowKind): boolean {
  return !LEAF_KINDS.has(kind)
}

/*
 * There is deliberately no `isNodeKind` any more.
 *
 * It narrowed a string to the closed tier union, and callers used it on two DIFFERENT
 * vocabularies: row kinds (where "not a leaf" is the right test — that is `isGroupRow`) and
 * creatable kinds, which include `sub-issue`, the activity phases and `Milestone` — strings
 * that are neither leaves nor tiers, and which a complement test would misclassify as tiers
 * the moment the tier set opened up. The question those callers were really asking is "is
 * this one of THIS organisation's tiers", and that needs the organisation's tier list:
 * `isTierKind(tiersOf(model), kind)` in `./config`.
 */

/** Lifecycle activity phases an issue can be decomposed into (spec §5). */
export const ACTIVITY_PHASES = [
  'Investigation',
  'Root Cause Analysis',
  'Corrective Action',
  'Verification',
  'Closure',
] as const
export type ActivityPhase = (typeof ACTIVITY_PHASES)[number]

/*
 * There is deliberately no `RowType` union any more.
 *
 * It listed the Type column's permitted values — `'Issue' | 'Company' | … | 'Module'` — which
 * was a closed set only for as long as those names were hardcoded. The column now renders the
 * *configured* term, so a workspace that calls a Process Area a Workstream shows Workstream,
 * and the set of possible values is whatever the organisation has named its tiers. A union
 * kept for documentation after that point would be documenting a constraint that no longer
 * holds. `ActivityPhase` stays, because lifecycle phases really are a closed vocabulary.
 */

export type Severity = 'High' | 'Medium' | 'Low'

export type AccountableParty = 'Axiocloud' | 'OAPIL' | 'SLG' | 'Shared' | 'Unassigned'

/**
 * Source lifecycle statuses, exactly as they appear in the OAPIL/SLG issue log.
 * We do not invent new ones.
 */
export const ISSUE_STATUSES = [
  'Open',
  'In Progress',
  'Needs clarification',
  'Awaiting client confirmation',
  'Closed - confirmed',
  'Closed - no defect',
  'Superseded',
] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

/**
 * Schedule health (spec §10).
 * `Unscheduled` is a first-class state, not a failure: the imported log carries no due
 * dates, so an issue with no planned end genuinely has no schedule to be on track against.
 * We surface that rather than defaulting it to "On Track".
 */
export type ScheduleHealth =
  | 'On Track'
  | 'At Risk'
  | 'Overdue'
  | 'Blocked'
  | 'Completed'
  | 'Unscheduled'

/** Spec §4: manual vs auto roll-up scheduling. */
export type ScheduleMode = 'MANUAL' | 'AUTO'

/** Spec §6: Microsoft Project dependency types. */
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'

/** Provenance of a date, so the UI can never present a derived value as a recorded one. */
export type DateOrigin =
  /** Recorded in the source issue log. */
  | 'source'
  /** Computed from source data by a documented rule (e.g. rolled up from children). */
  | 'derived'
  /** Suggested by the SLA policy; not yet accepted by a user. Rendered as a hollow/dashed bar. */
  | 'proposed'
  /** Entered or confirmed by a user in this app. */
  | 'user'

/** A scheduling constraint between two schedulable rows (spec §14). */
export interface IssueDependency {
  id: string
  predecessorId: string
  successorId: string
  dependencyType: DependencyType
  lagDays: number
  createdAt: string
  createdBy: string
}

/** A business/logical link between issues — NOT a scheduling constraint (spec §14). */
export interface IssueRelationship {
  id: string
  sourceIssueId: string
  targetIssueId: string
  /** e.g. 'RELATED_TO' | 'DUPLICATE_OF' | 'SUPERSEDES' */
  relationshipType: string
  note: string
}

/** An audit entry for any schedule change (spec §8). */
export interface AuditEntry {
  id: string
  rowId: string
  field: string
  from: string | null
  to: string | null
  at: string
  /**
   * The display name, kept because it is what History shows and what a person recognises.
   *
   * It is not the identity. Two colleagues can share a name and one person's name can change,
   * so a trail keyed on this alone cannot answer "everything this account did" — only
   * "everything anyone called this did". The two fields below are the identity; this is the
   * label for it.
   */
  by: string
  /**
   * The provider's stable object id for the actor, and the address it supplied.
   *
   * Optional because entries written before these fields existed have neither, and because a
   * machine actor has an id and no mailbox. Absent means unknown — never "nobody".
   */
  byId?: string
  byEmail?: string | null
  reason?: string
}

/**
 * A single schedulable row. Clients, modules, issues, lifecycle activities and
 * milestones all share this shape so the grid and the Gantt can stay generic
 * over tree depth.
 */
export interface ScheduleRow {
  id: string
  parentId: string | null
  kind: RowKind
  depth: number

  /** Display identifier — e.g. "OAPIL-010", or "" for grouping rows. */
  displayId: string
  name: string
  /**
   * What this row is, in the organisation's own words — the configured term, resolved at the
   * organisation default. Display and sort only; nothing branches on it.
   */
  type: string

  /**
   * Which discipline resolves this, as the **label** — "Technical", not `DISC_TECHNICAL`.
   *
   * Display and sort only, like `type` above. The stored id lives on `issue.discipline` and is
   * what `matchesFilters` compares, so renaming a discipline changes what is shown without
   * changing what matches.
   *
   * Null on rows that are not issues. A structural tier does not have a discipline: an
   * engagement is resolved by everybody, and rolling one up would produce whichever discipline
   * happened to be commonest among its children, presented as a fact about the tier.
   */
  discipline: string | null

  status: IssueStatus | null
  severity: Severity | null
  owner: string | null
  accountable: AccountableParty | null

  scheduleMode: ScheduleMode

  plannedStartDate: string | null
  plannedEndDate: string | null
  actualStartDate: string | null
  actualEndDate: string | null

  /** Origin of the planned dates, so provenance is always visible. */
  plannedOrigin: DateOrigin | null
  actualOrigin: DateOrigin | null

  /** Calendar days spanned by the planned dates (inclusive), or null when unscheduled. */
  duration: number | null
  /** Working days (Mon-Fri) spanned by the planned dates. */
  workingDuration: number | null

  percentComplete: number
  /** How percentComplete was arrived at — status mapping vs rolled up from children. */
  progressOrigin: 'status-derived' | 'rolled-up' | 'user'

  projectedCompletionDate: string | null
  scheduleHealth: ScheduleHealth

  isMilestone: boolean
  milestoneDate: string | null

  nextAction: string | null

  /** Issue-only payload, used by the detail panel. */
  issue?: IssueDetail

  /** Convenience: ids of dependency predecessors (schedule constraints only). */
  predecessorIds: string[]

  /**
   * Governance roll-up shown on summary rows: how much work sits beneath this node and how
   * much of it needs attention. Counts every issue in the subtree, not just direct children.
   */
  rollup?: {
    issues: number
    open: number
    overdue: number
    atRisk: number
    blocked: number
  }
}

/** Full issue payload retained for the bottom detail pane (spec §13). */
export interface IssueDetail {
  id: string
  /**
   * The client this issue belongs to. Free text, because the set of clients is data the firm
   * edits — it was once typed as `'OAPIL' | 'SLG'`, which stopped being true the moment the
   * internal Axiomate log arrived carrying `Axiocloud`, and was held together by a cast that
   * asserted something already false.
   */
  client: string
  module: string
  subject: string
  description: RichDoc
  type: string
  /** What the source log called this, when `type` was mapped onto another taxonomy. */
  sourceType: string
  /** A `Discipline` id, or empty for unclassified. Independent of `type` and `module`. */
  discipline: string
  severity: Severity
  status: IssueStatus
  owner: string
  raisedBy: string
  accountable: AccountableParty
  raised: string
  lastActivity: string
  /** Days since raised, from the source log. */
  age: number
  /** Days since last activity, from the source log. */
  daysSinceActivity: number
  nextAction: string
  evidence: string
  evidenceDate: string
  /** How well the source row was verified: 'Verified from thread' | 'Snippet only' | 'From register'. */
  verification: string
  source: string
  reference: string
  clientImpact: string
}

/** Timeline zoom levels (spec §8). */
export type ZoomLevel = 'Day' | 'Week' | 'Month' | 'Quarter'

/** SLA policy used to *propose* target dates. Editable by the user, never applied silently. */
export interface SlaPolicy {
  High: number
  Medium: number
  Low: number
}

export const DEFAULT_SLA: SlaPolicy = { High: 5, Medium: 10, Low: 20 }

export interface FilterState {
  search: string
  /**
   * Whether finished work is listed.
   *
   * Off by default, which is a deliberate change to what the app opens on: of the records
   * loaded here the large majority are closed, so the resting view was mostly history and the
   * open work — the reason anyone opens a delivery tool — was scattered through it. Closed
   * records are hidden, never dropped: the toggle is in the bar, the counts strip keeps
   * reporting the full total beside the shown one, and every rollup still counts them.
   */
  showCompleted: boolean
  client: string
  /** Work type — the discriminator that keeps issues and change requests in one table. */
  type: string
  /**
   * Discipline — who resolves it, which is a different question from what kind of thing it is.
   * Filtering both at once is the point: "the technical defects" needs two axes, not one.
   */
  discipline: string
  module: string
  status: string
  severity: string
  owner: string
  accountable: string
  health: string
}

export const EMPTY_FILTERS: FilterState = {
  search: '',
  showCompleted: false,
  client: 'All',
  type: 'All',
  discipline: 'All',
  module: 'All',
  status: 'All',
  severity: 'All',
  owner: 'All',
  accountable: 'All',
  health: 'All',
}
