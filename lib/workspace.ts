/**
 * Workspace state and operations.
 *
 * Architectural rule (deliberate): four operation families are kept separate even though the
 * toolbar presents them together, because they mean different things.
 *
 *   CRUD          — create / edit / soft-delete a record
 *   HIERARCHY     — where a record sits in the tree (add child, move, indent, outdent)
 *   RELATIONSHIPS — business links between issues (related to, duplicate of, caused by)
 *   SCHEDULING    — dates, duration, dependencies, milestones
 *   CONFIGURATION — the operating model itself: terminology, roles, responsibilities, agents
 *
 * A hierarchy parent is not a business relationship and neither is a schedule dependency.
 * Collapsing them would make it impossible to answer "why did this date move?".
 *
 * Configuration is a fifth family rather than a settings blob edited off to one side. Changing
 * what "Owner" means, or who is allowed to be one, is exactly the kind of change the audit
 * trail exists for — so it goes through the same reducer and lands in the same History.
 */

import type {
  AccountableParty,
  ActivityPhase,
  AuditEntry,
  DependencyType,
  IssueDependency,
  IssueRelationship,
  IssueStatus,
  NodeKind,
  RowKind,
  Severity,
  SlaPolicy,
} from './types'
import { ACTIVITY_PHASES, isNodeKind } from './types'

/**
 * Re-exported so the many callers that reach for `NodeKind` from the workspace keep working.
 * It is *declared* in `./types` alongside `RowKind`, because a tier being a node and a tier
 * being a row are two views of one list — see `NODE_KINDS`.
 */
export type { NodeKind }
import type { EvidenceItem, EvidenceKind, SnapshotPurpose } from './evidence'
import { DEFAULT_NOTE_TYPE, type IssueNote, type NoteType } from './notes'
import { accessProblems, can, permissionForAction, rolesFor, type AccessPolicy, type PermissionKey } from './access'
import { canEditNote } from './permissions'
import {
  checkTransition,
  policyProblems,
  type StatusPolicy,
} from './statusPolicy'
import { checkEntry, type TimeActivity, type TimeEntry } from './time'
import {
  capacityFor,
  checkAllocation,
  defaultProfile,
  describeCapacity,
  type Allocation,
  type Commitment,
  type CommitmentKind,
  type ResourceProfile,
} from './capacity'
import {
  availabilityForAssignment,
  availabilityNote,
  refusesAssignment,
} from './availability'
import { checkSow, LIVE_SOW_STATUSES, type Sow, type SowStatus } from './sow'
import { deriveEvents, type DomainEvent, type EventType } from './events'
import type { WatchPolicy } from './watch'
import {
  diffObservations,
  eventTypeFor,
  observe,
  type Observation,
  type WatchDiff,
} from './watch'
import { planActions, type AutomationRule, type RuleMiss } from './automation'
import { deliveryFor, type Channel, type Notification } from './notifications'
import {
  approvalsFor,
  blockingRule,
  ruleProblems,
  type Approval,
  type ApprovalDecision,
  type ApprovalRule,
} from './approval'
import {
  bandProblems,
  emptyEstimate,
  summarise,
  summariesDiffer,
  type Estimate,
  type EstimateRevision,
  type IssueEstimate,
  type SizeBand,
} from './estimation'
import { blankEngagement, type EngagementDetail } from './engagement'
import { addWorkingDays } from './dates'
import { isTerminal, STATUS_PROGRESS } from './schedule'
import type { Actor } from './actor'
import {
  KIND_LABEL_KEY,
  DEFAULT_ORGANIZATION,
  ROOT_SCOPE,
  checkAssignment,
  emptyOverride,
  initModel,
  liveWorkTypes,
  type WorkType,
  resolveLabel,
  type Autonomy,
  type IntakeMailbox,
  type LabelKey,
  type OperatingModel,
  type OrganizationIdentity,
  type OrgRole,
  type Person,
  type ResponsibilityType,
  type RoutingRule,
} from './config'

/* ================================================================== *
 * Record shapes
 * ================================================================== */

export interface HierarchyNode {
  id: string
  kind: NodeKind
  name: string
  parentId: string | null
  owner: string | null
  /**
   * The statement of work this is delivered under. Projects only, and nullable.
   *
   * On the node rather than on each record, following the domain model: a SOW sits between the
   * engagement and the project, and work inherits it by where it lives. Per-record attribution
   * would let two issues in one project belong to different contracts, which is not a thing
   * that happens — and would make "what has this SOW consumed" a question with no reliable
   * answer.
   */
  sowId?: string | null
  /** Soft delete — records are archived, never destroyed. */
  deletedAt: string | null
}

export interface IssueRecord {
  id: string
  /** Parent may be a hierarchy node or another issue (a sub-issue). */
  parentId: string
  client: string
  module: string
  subject: string
  description: string
  type: string
  /**
   * The classification the source log recorded, when `type` has been mapped onto a different
   * taxonomy. Empty for records this workspace created — they were never anything else.
   */
  sourceType: string
  severity: Severity
  status: IssueStatus
  owner: string
  raisedBy: string
  accountable: AccountableParty
  raised: string
  lastActivity: string
  actualEnd: string | null
  age: number
  daysSinceActivity: number
  nextAction: string
  evidence: string
  evidenceDate: string
  verification: string
  source: string
  reference: string
  clientImpact: string
  /** Planned dates live here once a user sets them. */
  plannedStart: string | null
  plannedEnd: string | null
  /** null => progress falls back to the status-derived value. */
  percentOverride: number | null
  scheduleMode: 'MANUAL' | 'AUTO'
  /**
   * Values for responsibility types that are NOT backed by a column above.
   *
   * The three seeded responsibilities (Owner, Accountable Party, Raised By) keep their own
   * fields so the grid, filters, sorting and the assistant keep working on them unchanged.
   * Anything configured after that lands here, keyed by responsibility type id.
   */
  assignments: Record<string, string[]>
  deletedAt: string | null
}

export interface ActivityRec {
  id: string
  issueId: string
  phase: ActivityPhase | string
  order: number
  plannedStartDate: string
  plannedEndDate: string
  percentComplete: number
  owner: string
  scheduleMode: 'MANUAL' | 'AUTO'
  isMilestone: boolean
  /**
   * Where this activity's dates and progress came from.
   *
   * `generated` rows were synthesised by the lifecycle generator: their dates are an SLA
   * window split across phases, and their percentages are apportioned from the issue's
   * status-derived figure. Neither was reported by anyone, so they must not be presented as
   * user-entered. A row flips to `user` the moment someone edits or drags it.
   */
  origin: 'generated' | 'user'
  deletedAt: string | null
}

export interface WorkspaceState {
  nodes: Record<string, HierarchyNode>
  issues: Record<string, IssueRecord>
  activities: Record<string, ActivityRec>
  dependencies: IssueDependency[]
  relationships: IssueRelationship[]
  /** Snapshots, data files, documents and links attached to issues (spec: Evidence). */
  evidence: Record<string, EvidenceItem>
  /** The working record of how each issue progressed. See `./notes`. */
  notes: Record<string, IssueNote>
  /** One estimate per issue, keyed by issue id. See `./estimation`. */
  estimates: Record<string, IssueEstimate>
  /** What changed to an agreed estimate, and why. */
  estimateRevisions: Record<string, EstimateRevision>
  /** Hours spent, against the work they were spent on. See `./time`. */
  timeEntries: Record<string, TimeEntry>
  /** Decisions asked for and given. See `./approval`. */
  approvals: Record<string, Approval>
  /** Messages raised for people, and whether they got anywhere. See `./notifications`. */
  notifications: Record<string, Notification>
  /** What has been contracted, per engagement. See `./sow`. */
  sows: Record<string, Sow>
  /** Who is committed to what, and for how long. See `./capacity`. */
  allocations: Record<string, Allocation>
  /** Leave, holidays and internal work — what comes off capacity before anything is sold. */
  commitments: Record<string, Commitment>
  /** Commercial and delivery envelope per engagement node. Keyed by node id. */
  engagements: Record<string, EngagementDetail>
  /** The operating model: terminology, roles, responsibilities, agents, routing, intake. */
  model: OperatingModel
  audit: AuditEntry[]
  /** Sequence used to mint new ids. */
  seq: number
}

/* ================================================================== *
 * Hierarchy rules
 * ================================================================== */

/**
 * What a user can create. Every structural tier except `company`, which is the root the
 * workspace is anchored at rather than something anyone adds — derived from the tier list so
 * a new tier is creatable without a second edit here.
 */
export type CreatableKind =
  | Exclude<NodeKind, 'company'>
  | 'issue'
  | 'sub-issue'
  | ActivityPhase
  | 'Milestone'

/**
 * What `+ Add` offers for the selected row. The parent is always implied by the selection.
 *
 * Keyed exhaustively over `RowKind` rather than `string`: a new tier now fails to compile
 * until someone says what can be created under it, instead of silently offering nothing.
 */
export const CREATE_MENU: Record<RowKind, CreatableKind[]> = {
  company: ['client'],
  client: ['engagement', 'project', 'module', 'issue'],
  engagement: ['project', 'module', 'issue'],
  project: ['module', 'issue'],
  module: ['issue'],
  issue: ['sub-issue', ...ACTIVITY_PHASES, 'Milestone'],
  activity: ['Milestone'],
  milestone: [],
}

/**
 * The configured term for a kind, resolved against organisation-level terminology.
 *
 * There is no local table of shipped names behind this any more. One used to sit here —
 * `company: 'Company' … module: 'Process Area'` — as a fallback for kinds the configuration
 * plane did not name. It was a seventh copy of the tier vocabulary, every key it held was
 * already in `KIND_LABEL_KEY`, so the fallback was unreachable, and nothing outside this file
 * imported it. The shipped defaults live in `LABEL_KEYS`, which is where they are edited.
 *
 * Anything with no configured name — a lifecycle phase — is called what it is called.
 */
function termFor(state: WorkspaceState, kind: string): string {
  const key = KIND_LABEL_KEY[kind as keyof typeof KIND_LABEL_KEY]
  return key ? resolveLabel(state.model, key) : kind
}

/** Which parents each kind may legally sit under — enforced by Move. */
/**
 * Keyed exhaustively over every row kind that can have a parent — `company` is excluded
 * because it is the root. A new tier is a compile error here until its legal parents are
 * stated, which is the point: this table decides what Move will accept.
 */
const ALLOWED_PARENTS: Record<Exclude<RowKind, 'company'>, RowKind[]> = {
  // Without this, `canParent('client', 'company')` is false and Move refuses to reparent a
  // client — leaving a root tier nothing can legally sit under.
  client: ['company'],
  engagement: ['client'],
  project: ['client', 'engagement'],
  module: ['client', 'engagement', 'project'],
  issue: ['client', 'engagement', 'project', 'module', 'issue'],
  activity: ['issue'],
  milestone: ['issue', 'activity'],
}

/** Kinds arrive here as plain strings from dialogs and actions, so the lookup is defensive. */
export function canParent(childKind: string, parentKind: string): boolean {
  const allowed: readonly string[] | undefined =
    ALLOWED_PARENTS[childKind as Exclude<RowKind, 'company'>]
  return allowed ? allowed.includes(parentKind) : false
}

/* ================================================================== *
 * Initialisation
 * ================================================================== */

export interface SeedIssueInput {
  id: string
  client: string
  /**
   * Which engagement under that client this issue belongs to.
   *
   * Absent in the imported client log, which names a client and a process area and never an
   * engagement — those fall back to the client's single default engagement. Present on work
   * that genuinely knows its engagement, such as Axiocloud's own internal projects.
   */
  engagement?: string
  module: string
  subject: string
  description: string
  type: string
  /** What the source log called this, when the imported type was mapped onto another taxonomy. */
  sourceType?: string
  severity: Severity
  status: IssueStatus
  owner: string
  raisedBy: string
  accountable: AccountableParty
  raised: string
  lastActivity: string
  actualEnd: string | null
  age: number
  daysSinceActivity: number
  nextAction: string
  evidence: string
  evidenceDate: string
  verification: string
  source: string
  reference: string
  clientImpact: string
}

/** One company per workspace, so the id is a constant rather than a name that can be edited. */
export const COMPANY_NODE_ID = 'company:root'
export const clientNodeId = (client: string) => `client:${client}`
/** Stable and constructed, never minted from `seq` — it becomes a configuration scope key. */
export const engagementNodeId = (client: string, name?: string) =>
  name ? `engagement:${client}:${name.replace(/[^A-Za-z0-9]+/g, '-')}` : `engagement:${client}`
export const moduleNodeId = (client: string, mod: string) => `module:${client}:${mod}`

/**
 * Materialise the tiers implied by the log (Client → Process Area) into real nodes, so that
 * every row in the tree is an addressable record the user can act on. Engagement and Project
 * tiers are not created here — nothing in the log identifies them, so they exist only once a
 * user adds them.
 */
/**
 * First occurrence wins, order preserved.
 *
 * First rather than last because the two are identical where this is needed, and where they
 * are not, the earlier record is the one anything already loaded will have been shown.
 */
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
}

export function initWorkspace(
  seedIssues: SeedIssueInput[],
  relationships: IssueRelationship[],
): WorkspaceState {
  const nodes: Record<string, HierarchyNode> = {}
  const issues: Record<string, IssueRecord> = {}
  const engagements: Record<string, EngagementDetail> = {}

  /**
   * The delivery chain, in full: Company ▸ Client ▸ Engagement ▸ Process Area ▸ Issue.
   *
   * One company, which may hold many clients; each client one or more engagements; each
   * engagement its own issues. The log names the client and the process area for every issue
   * and never names an engagement — but with exactly one engagement per client, which one an
   * issue belongs to is settled by the structure rather than inferred, so the process areas
   * hang off the engagement rather than off the client.
   *
   * A second engagement for a client is a `create` followed by `Move`; nothing here assumes
   * there will only ever be one.
   */
  nodes[COMPANY_NODE_ID] = {
    id: COMPANY_NODE_ID,
    kind: 'company',
    // Seeded from the configured organisation once. Not bound to it afterwards: this is a
    // tree label a user may rename, and that is a different thing from the firm's identity.
    name: DEFAULT_ORGANIZATION.name,
    parentId: null,
    owner: null,
    deletedAt: null,
  }

  for (const i of seedIssues) {
    const cId = clientNodeId(i.client)
    const eId = engagementNodeId(i.client, i.engagement)
    if (!nodes[cId]) {
      nodes[cId] = {
        id: cId,
        kind: 'client',
        name: i.client,
        parentId: COMPANY_NODE_ID,
        owner: null,
        deletedAt: null,
      }
    }
    if (!nodes[eId]) {
      nodes[eId] = {
        id: eId,
        kind: 'engagement',
        // Named when the work knows its engagement; otherwise the client's single default.
        name: i.engagement ?? `${i.client} Engagement`,
        parentId: cId,
        owner: null,
        deletedAt: null,
      }
      engagements[eId] = blankEngagement(eId, i.client)
    }
    // Process areas belong to an engagement, so the same area name under two engagements is
    // two nodes — Inventory on one programme is not Inventory on another.
    const mId = moduleNodeId(i.client, i.module) + (i.engagement ? `@${eId}` : '')
    if (!nodes[mId]) {
      nodes[mId] = { id: mId, kind: 'module', name: i.module, parentId: eId, owner: null, deletedAt: null }
    }
    issues[i.id] = {
      ...i,
      parentId: mId,
      sourceType: i.sourceType ?? '',
      plannedStart: null,
      plannedEnd: null,
      percentOverride: null,
      scheduleMode: 'AUTO',
      assignments: {},
      deletedAt: null,
    }
  }

  // Seed the person directory from the names already in the log, with no roles attached —
  // the log records who worked an issue, never what they are.
  const owners = [...new Set(seedIssues.flatMap((i) => [i.owner, i.raisedBy]))]

  return {
    nodes,
    issues,
    activities: {},
    dependencies: [],
    /**
     * One record per id, because the id is the identity.
     *
     * `relationships` is an array rather than a keyed record — links are read as a list far
     * more often than they are looked up — and an array cannot refuse a duplicate the way a
     * record does. The seed carries one: two byte-identical entries for
     * `rel-slg-024-slg-018`, the same pair, type and note recorded twice in the source log.
     *
     * In memory that is merely untidy. Against a database it is fatal, and quietly so: the
     * importer writes each link with `create`, the second collides on the primary key, the
     * whole seeding transaction rolls back, and the deployment falls back to the seed file
     * with "changes are not being saved" — on every page load, forever, because nothing was
     * ever written for the next boot to find. That is exactly how the first Azure deployment
     * behaved, and the reason it was hard to see is that the fallback looks like a working app.
     *
     * Deduplicated here rather than in the importer or the seed file, because this is where
     * identity is established. Fixing it downstream would leave the browser mirror and the
     * reducer holding a state the database would refuse.
     */
    relationships: dedupeById(relationships),
    evidence: {},
    notes: {},
    estimates: {},
    estimateRevisions: {},
    timeEntries: {},
    approvals: {},
    notifications: {},
    sows: {},
    allocations: {},
    commitments: {},
    engagements,
    model: initModel(owners, seedIssues.map((i) => i.type)),
    audit: [],
    seq: 1,
  }
}

/**
 * The override chain for a record: itself, then every ancestor, fine → coarse.
 *
 * Configuration resolution walks this and takes the nearest value, so a term redefined on one
 * project does not leak to its siblings. `ROOT` is appended by the resolvers rather than here,
 * so callers cannot accidentally skip it.
 */
export function scopeChainOf(state: WorkspaceState, id: string | null): string[] {
  const chain: string[] = []
  let cursor = id
  const guard = new Set<string>()
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor)
    chain.push(cursor)
    cursor = parentOf(state, cursor)
  }
  return chain
}

/* ================================================================== *
 * Actions
 * ================================================================== */

export type Action =
  /* ---- CRUD ---- */
  | { t: 'create'; parentId: string; kind: CreatableKind; draft: Record<string, string>; now: string }
  | { t: 'updateNode'; id: string; patch: Partial<HierarchyNode>; now: string }
  | {
      t: 'updateIssue'
      id: string
      patch: Partial<IssueRecord>
      now: string
      reason?: string
      /**
       * What the person could see when they decided to make this change.
       *
       * Only the fields being changed, and only their previous values. The reducer refuses the
       * action if any of them has moved since — which is what turns two people editing one
       * record from a silent overwrite into a question somebody answers.
       *
       * Stamped by `dispatch` from the state the browser was showing, so no call site has to
       * remember it. Absent means unchecked, which is right for the two callers that have
       * nothing to be stale against: an automation rule acting on what it observed a moment
       * ago, and the intake endpoint creating a record nobody else has seen.
       */
      expected?: Partial<IssueRecord>
      /**
       * Name an owner who is not at work over the window this is planned for.
       *
       * Refused by default and allowed explicitly, on the same reasoning as
       * `acceptOverallocation`: assigning somebody who is on leave is sometimes exactly right —
       * they pick it up on their return, and somebody decided that. What the workspace owes is
       * the difference between that decision and a name typed into the wrong row.
       */
      acceptUnavailable?: boolean
    }
  | { t: 'updateActivity'; id: string; patch: Partial<ActivityRec>; now: string }
  | { t: 'softDelete'; id: string; mode: 'cascade' | 'reparent'; now: string }
  | { t: 'restore'; id: string; now: string }
  /* ---- HIERARCHY ---- */
  | { t: 'move'; id: string; newParentId: string; now: string }
  /* ---- RELATIONSHIPS ---- */
  | { t: 'link'; sourceIssueId: string; targetIssueId: string; relationshipType: string; note: string; now: string }
  | { t: 'unlink'; id: string; now: string }
  /* ---- SCHEDULING ---- */
  | { t: 'setDates'; id: string; start: string; end: string; now: string; reason?: string }
  | { t: 'addDependency'; predecessorId: string; successorId: string; dependencyType: DependencyType; lagDays: number; now: string }
  | { t: 'removeDependency'; id: string; now: string }
  /* ---- EVIDENCE ---- */
  | {
      t: 'addEvidence'
      issueId: string
      kind: EvidenceKind
      name: string
      purpose: SnapshotPurpose | null
      url: string | null
      mimeType: string | null
      sizeBytes: number | null
      note: string
      now: string
    }
  | { t: 'updateEvidence'; id: string; patch: Partial<EvidenceItem>; now: string }
  /* ---- NOTES ---- */
  | { t: 'addNote'; issueId: string; body: string; noteType: NoteType; pinned: boolean; now: string }
  | {
      t: 'updateNote'
      id: string
      patch: Partial<Pick<IssueNote, 'body' | 'noteType' | 'pinned'>>
      now: string
    }
  | { t: 'removeNote'; id: string; now: string }
  /* ---- ESTIMATION ---- */
  | { t: 'setEstimate'; issueId: string; patch: Partial<Estimate>; reason?: string; now: string }
  | { t: 'baselineEstimate'; issueId: string; now: string }
  /* ---- TIME ---- */
  | {
      t: 'addTime'
      issueId: string
      person: string
      date: string
      hours: number
      activity: TimeActivity
      billable: boolean
      note: string
      now: string
    }
  | { t: 'updateTime'; id: string; patch: Partial<TimeEntry>; now: string }
  | { t: 'removeTime'; id: string; now: string }
  /* ---- APPROVAL ---- */
  | { t: 'requestApproval'; subjectId: string; ruleId: string; note: string; now: string }
  | { t: 'decideApproval'; id: string; decision: ApprovalDecision; note: string; now: string }
  /* ---- NOTIFICATION ---- */
  /**
   * Raised by a rule, never by a person — which is why it is not on the write endpoint's
   * allowlist. The browser plans the same rules the server does, so it has no reason to send
   * one, and no way to send one it invented.
   */
  | {
      t: 'notify'
      to: string
      channel: Channel
      subject: string
      body: string
      aboutId: string
      ruleId: string
      now: string
    }
  | { t: 'markNotificationRead'; id: string; now: string }
  /* ---- COMMERCIAL ---- */
  | { t: 'upsertSow'; id: string | null; engagementId: string; patch: Partial<Sow>; now: string }
  | { t: 'archiveSow'; id: string; now: string }
  /** Which SOW a project is delivered under. `sowId: null` detaches it. */
  | { t: 'attributeToSow'; nodeId: string; sowId: string | null; now: string }
  /* ---- CAPACITY ---- */
  | {
      t: 'upsertAllocation'
      id: string | null
      person: string
      projectId: string
      startDate: string
      endDate: string
      percentage: number
      note: string
      /**
       * Commit somebody who does not have the time.
       *
       * Refused by default and allowed explicitly, because short-term overallocation is a real
       * decision a delivery manager makes with their eyes open — and the difference between
       * that and an accident is whether anybody said so. Recorded in the audit trail either way.
       */
      acceptOverallocation?: boolean
      now: string
    }
  | { t: 'removeAllocation'; id: string; now: string }
  | {
      t: 'upsertCommitment'
      id: string | null
      person: string
      kind: CommitmentKind
      startDate: string
      endDate: string
      hoursPerDay: number
      note: string
      now: string
    }
  | { t: 'removeCommitment'; id: string; now: string }
  | { t: 'removeEvidence'; id: string; now: string }
  | { t: 'buildLifecycle'; issueId: string; slaDays: number; now: string }
  | { t: 'clearLifecycle'; issueId: string; now: string }
  /* ---- CONFIGURATION ---- */
  | { t: 'config'; op: ConfigOp; now: string }
  | { t: 'updateEngagement'; nodeId: string; patch: Partial<EngagementDetail>; now: string }
  | {
      t: 'setAssignment'
      issueId: string
      responsibilityId: string
      values: string[]
      /** See `updateIssue`. The same escape hatch, because it is the same refusal. */
      acceptUnavailable?: boolean
      now: string
    }

/**
 * Operations on the operating model.
 *
 * Every one carries the scope it applies to where scoping is meaningful, so the same action
 * can redefine a term for the whole organisation or for one project.
 */
export type ConfigOp =
  /** An empty `label` removes the override and lets the parent scope through again. */
  | { k: 'setLabel'; scopeId: string; key: LabelKey; label: string }
  | { k: 'upsertRole'; id: string | null; label: string; description: string }
  | { k: 'deleteRole'; id: string }
  | { k: 'upsertWorkType'; id: string | null; label: string; description: string }
  | { k: 'deleteWorkType'; id: string }
  | { k: 'setSla'; patch: Partial<SlaPolicy> }
  | { k: 'setSizeBands'; bands: SizeBand[] }
  | { k: 'setStatusPolicy'; patch: Partial<StatusPolicy> }
  | { k: 'setAccess'; patch: Partial<AccessPolicy> }
  | { k: 'setApprovalRules'; rules: ApprovalRule[] }
  | { k: 'setAutomationRules'; rules: AutomationRule[] }
  | { k: 'setResourceProfile'; personId: string; patch: Partial<ResourceProfile> }
  | { k: 'setWatch'; patch: Partial<WatchPolicy> }
  | { k: 'upsertPerson'; id: string | null; name: string; roleIds: string[]; email?: string }
  | { k: 'deletePerson'; id: string }
  | { k: 'upsertResponsibility'; id: string | null; patch: Partial<ResponsibilityType> }
  | { k: 'deleteResponsibility'; id: string }
  | { k: 'setParties'; parties: string[] }
  | { k: 'setAgent'; id: string; patch: { enabled?: boolean; autonomy?: Autonomy; requireApproval?: boolean } }
  | { k: 'setWorkflowEnabled'; id: string; enabled: boolean }
  /** `null` clears the override so the parent scope decides again. */
  | { k: 'setScopeAgent'; scopeId: string; agentId: string; value: boolean | null }
  | { k: 'setScopeRequired'; scopeId: string; responsibilityId: string; value: boolean | null }
  | { k: 'adoptTemplate'; scopeId: string; templateId: string | null }
  | { k: 'upsertRoutingRule'; id: string | null; patch: Partial<RoutingRule> }
  | { k: 'deleteRoutingRule'; id: string }
  | { k: 'upsertIntake'; id: string | null; patch: Partial<IntakeMailbox> }
  | { k: 'deleteIntake'; id: string }
  | { k: 'setOrganization'; patch: Partial<OrganizationIdentity> }
  /** Throw the whole operating model away and rebuild it from the shipped seed. */
  | { k: 'resetAll' }

export interface OpResult {
  state: WorkspaceState
  error?: string
  message?: string
  /** id of a newly created record, so the UI can select it. */
  createdId?: string
}

let auditSeq = 0
function log(
  actor: Actor,
  state: WorkspaceState,
  entry: Omit<AuditEntry, 'id' | 'byId' | 'byEmail'>,
): AuditEntry[] {
  auditSeq += 1
  return [...state.audit, { ...entry, ...identityOf(actor), id: `aud-${auditSeq}-${entry.rowId}` }]
}

/**
 * The identity behind the name, stamped in one place.
 *
 * Thirty-four call sites append audit entries, and every one of them supplied a display name
 * because that was all an entry had room for. Adding two more fields at each would be
 * thirty-four chances to forget one, and a trail is worth exactly as much as its least
 * complete entry — so the actor became a parameter of `log` and the stamping happens here.
 *
 * `byEmail` is null rather than absent for a machine: the scheduled pass and the intake
 * connector have stable ids and no mailbox, and null says "asked, and there is none" where
 * undefined would say "never asked".
 */
function identityOf(actor: Actor): Pick<AuditEntry, 'byId' | 'byEmail'> {
  return { byId: actor.id, byEmail: actor.email ?? null }
}

/**
 * Several entries from one action.
 *
 * `log` reads `state.audit` and returns a new array, so calling it twice against the same
 * state drops the first entry. One action that changes several records needs this instead —
 * archiving a record and moving its children up a level changes every one of them, and each
 * deserves its own line in its own history.
 */
function logAll(
  actor: Actor,
  state: WorkspaceState,
  entries: Omit<AuditEntry, 'id' | 'byId' | 'byEmail'>[],
): AuditEntry[] {
  return [
    ...state.audit,
    ...entries.map((e) => {
      auditSeq += 1
      return { ...e, ...identityOf(actor), id: `aud-${auditSeq}-${e.rowId}` }
    }),
  ]
}

/**
 * Next free issue id for a client, e.g. OAPIL-180.
 *
 * Derived from the highest existing number for that prefix rather than from the workspace
 * sequence — the sequence also counts nodes and activities, so using it would hand out ids
 * that collide with issues already in the log. Archived issues still reserve their id.
 */
function nextIssueId(state: WorkspaceState, client: string): string {
  /**
   * The prefix comes from the ids this client's issues already carry, not from its name.
   *
   * They usually agree — OAPIL's issues are `OAPIL-nnn`. They do not always: Axiocloud's own
   * internal work is logged as `AXM-nnn`, and deriving the prefix from the client name would
   * start a second, parallel series under the same client the first time anyone added one.
   */
  const existing = Object.values(state.issues)
    .filter((i) => i.client === client)
    .map((i) => i.id.match(/^(.+)-(\d+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)

  const counts = new Map<string, number>()
  for (const m of existing) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  const prefix =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    client.toUpperCase().replace(/[^A-Z0-9]+/g, '')

  let max = 0
  for (const id of Object.keys(state.issues)) {
    const m = id.match(/^(.+)-(\d+)$/)
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]))
  }
  let n = max + 1
  while (state.issues[`${prefix}-${String(n).padStart(3, '0')}`]) n++
  return `${prefix}-${String(n).padStart(3, '0')}`
}

export function kindOf(state: WorkspaceState, id: string): string | null {
  if (state.nodes[id]) return state.nodes[id].kind
  if (state.issues[id]) return 'issue'
  const a = state.activities[id]
  if (a) return a.isMilestone ? 'milestone' : 'activity'
  return null
}

export function nameOf(state: WorkspaceState, id: string): string {
  return (
    state.nodes[id]?.name ??
    state.issues[id]?.subject ??
    state.activities[id]?.phase ??
    id
  )
}

export function parentOf(state: WorkspaceState, id: string): string | null {
  if (state.nodes[id]) return state.nodes[id].parentId
  if (state.issues[id]) return state.issues[id].parentId
  if (state.activities[id]) return state.activities[id].issueId
  return null
}

export function childrenOf(state: WorkspaceState, id: string): string[] {
  const out: string[] = []
  for (const n of Object.values(state.nodes)) if (n.parentId === id && !n.deletedAt) out.push(n.id)
  for (const i of Object.values(state.issues)) if (i.parentId === id && !i.deletedAt) out.push(i.id)
  for (const a of Object.values(state.activities)) if (a.issueId === id && !a.deletedAt) out.push(a.id)
  return out
}

/** All descendants, used by delete and by the circular-move check. */
export function descendantsOf(state: WorkspaceState, id: string): string[] {
  const out: string[] = []
  const stack = [...childrenOf(state, id)]
  while (stack.length) {
    const cur = stack.pop()!
    out.push(cur)
    stack.push(...childrenOf(state, cur))
  }
  return out
}

/* ================================================================== *
 * Reducer
 * ================================================================== */

/**
 * The profile for a person named on an allocation.
 *
 * Matched by name, like everything else that joins to the directory until people have real
 * keys. Returns undefined rather than a default, so `capacityFor` is the single place that
 * decides what an unknown person's week looks like.
 */
function profileFor(state: WorkspaceState, person: string): ResourceProfile | undefined {
  const key = person.trim().toLowerCase()
  const match = Object.values(state.model.people).find((p) => p.name.toLowerCase() === key)
  return match ? state.model.resourceProfiles[match.id] : undefined
}

export function apply(state: WorkspaceState, a: Action, actor: Actor): OpResult {
  /**
   * May this actor do this at all?
   *
   * At the funnel rather than in each arm, because the reducer is the only way state changes:
   * one check here covers the grid, the forms, the dialogs, the assistant's applied proposals
   * and the server's replay, and none of them can forget it. A check per arm would be
   * twenty-odd chances to miss one, and a missed one is invisible — the action keeps working.
   *
   * The screens ask the same questions through `./permissions`, so a control is grey for the
   * same reason the action would be refused. That is a convenience, not the enforcement: a
   * request that never touched a screen lands here just the same.
   */
  {
    /**
     * Closing *and* reopening both count as `work.close`.
     *
     * Reopening is not an ordinary edit: it moves a record back out of the done set, which
     * changes what the daily report counts, what a client has been told is finished, and
     * whether an actualEnd exists. A firm that trusts an analyst to triage but not to close
     * would not expect that analyst to be able to un-close a client-confirmed resolution —
     * and without this, they could, because "In Progress" is not a terminal status and the
     * action would resolve to `work.edit`.
     *
     * Disagreeing with a closure without the grant is still possible, and is a note.
     */
    const closing =
      a.t === 'updateIssue' &&
      typeof (a as { patch?: { status?: string } }).patch?.status === 'string' &&
      (isTerminal((a as { patch: { status: IssueStatus } }).patch.status) ||
        isTerminal(state.issues[(a as { id: string }).id]?.status ?? null))
    const need = permissionForAction(a.t, { closing })
    if (need) {
      const verdict = can(state.model, actor, need)
      if (!verdict.allowed) return { state, error: verdict.reason ?? 'Not permitted.' }
    }
  }

  // Who gets recorded against everything this action touches.
  //
  // A parameter, not a module constant and not a field of `Action`. As a constant it made
  // this function impure and attributed every change in every workspace to one hardcoded
  // name; as a field of `Action` the browser would be telling the server who it was, and
  // the server replays actions verbatim. Passing it in means the value that reaches the
  // database is the one the *server* resolved for that request — see `lib/identity.ts`.
  //
  // The client passes its own and applies optimistically, so a History entry can briefly
  // show the client's attribution before the server's write lands. The server's is
  // authoritative; the client's is a local preview of it.
  const by = actor.name
  switch (a.t) {
    /* ---------------- CRUD: create ---------------- */
    case 'create': {
      const parentKind = kindOf(state, a.parentId)
      if (!parentKind) return { state, error: 'The parent record no longer exists.' }

      const seq = state.seq + 1
      const name = (a.draft.name || '').trim()
      if (!name) return { state, error: 'A name is required.' }

      // -- structural node
      if (isNodeKind(a.kind)) {
        if (!canParent(a.kind, parentKind)) {
          return { state, error: `A ${termFor(state, a.kind)} cannot sit under a ${termFor(state, parentKind)}.` }
        }
        const id = `${a.kind}:${seq}`
        const node: HierarchyNode = {
          id,
          kind: a.kind,
          name,
          parentId: a.parentId,
          owner: a.draft.owner || null,
          deletedAt: null,
        }
        return {
          state: {
            ...state,
            seq,
            nodes: { ...state.nodes, [id]: node },
            audit: log(actor, state, {
              rowId: id,
              field: 'created',
              from: null,
              to: `${termFor(state, a.kind)} "${name}" under ${nameOf(state, a.parentId)}`,
              at: a.now,
              by,
            }),
          },
          createdId: id,
          message: `${termFor(state, a.kind)} "${name}" created.`,
        }
      }

      // -- issue or sub-issue
      if (a.kind === 'issue' || a.kind === 'sub-issue') {
        if (!canParent('issue', parentKind)) {
          return { state, error: `An issue cannot sit under a ${parentKind}.` }
        }
        // Inherit client/module from wherever it was created.
        let client = ''
        let mod = ''
        let cursor: string | null = a.parentId
        while (cursor) {
          const n = state.nodes[cursor]
          if (n?.kind === 'module' && !mod) mod = n.name
          if (n?.kind === 'client') client = n.name
          const iss = state.issues[cursor]
          if (iss) {
            client = client || iss.client
            mod = mod || iss.module
          }
          cursor = parentOf(state, cursor)
        }
        const id = a.draft.id?.trim() || nextIssueId(state, client || 'NEW')
        if (state.issues[id]) return { state, error: `Issue ${id} already exists.` }

        const status = (a.draft.status as IssueStatus) || 'Open'
        const issue: IssueRecord = {
          id,
          parentId: a.parentId,
          client: client || 'Unassigned',
          module: mod || 'Unclassified',
          subject: name,
          description: a.draft.description || '',
          // Falls back to the first configured type rather than a literal. `'Defect'` was
          // hardcoded here, so a workspace that had archived Defect — or never had one —
          // would still mint records classified as it, and no filter would show them.
          type: a.draft.type || liveWorkTypes(state.model)[0]?.label || '',
          // Created here, so there is no earlier classification to preserve.
          sourceType: '',
          severity: (a.draft.severity as Severity) || 'Medium',
          status,
          owner: a.draft.owner || 'Unassigned',
          raisedBy: a.draft.raisedBy || by,
          accountable: (a.draft.accountable as AccountableParty) || 'Unassigned',
          raised: a.draft.raised || a.now.slice(0, 10),
          lastActivity: a.now.slice(0, 10),
          actualEnd: null,
          age: 0,
          daysSinceActivity: 0,
          nextAction: a.draft.nextAction || '',
          evidence: '',
          evidenceDate: '',
          verification: 'Entered in Axiomate',
          source: 'Axiomate',
          reference: a.draft.reference || '',
          clientImpact: '',
          plannedStart: a.draft.plannedStart || null,
          plannedEnd: a.draft.plannedEnd || null,
          percentOverride: null,
          scheduleMode: a.draft.plannedEnd ? 'MANUAL' : 'AUTO',
          assignments: {},
          deletedAt: null,
        }
        return {
          state: {
            ...state,
            seq,
            issues: { ...state.issues, [id]: issue },
            audit: log(actor, state, {
              rowId: id,
              field: 'created',
              from: null,
              to: `${a.kind === 'sub-issue' ? 'Sub-issue' : 'Issue'} "${name}" under ${nameOf(state, a.parentId)}`,
              at: a.now,
              by,
            }),
          },
          createdId: id,
          message: `${id} created.`,
        }
      }

      // -- lifecycle activity or milestone (parent must be an issue, or an activity for a milestone)
      const issueId =
        parentKind === 'issue' ? a.parentId : state.activities[a.parentId]?.issueId
      if (!issueId) return { state, error: 'Activities must be created under an issue.' }

      const siblings = Object.values(state.activities).filter(
        (x) => x.issueId === issueId && !x.deletedAt,
      )
      const isMilestone = a.kind === 'Milestone'
      const start = a.draft.plannedStart || a.now.slice(0, 10)
      const end = isMilestone ? start : a.draft.plannedEnd || addWorkingDays(start, 2)
      const id = `${issueId}#${seq}`

      const rec: ActivityRec = {
        id,
        issueId,
        phase: isMilestone ? name : (a.kind as ActivityPhase),
        order: siblings.length,
        plannedStartDate: start,
        plannedEndDate: end,
        percentComplete: Number(a.draft.percent ?? 0),
        owner: a.draft.owner || state.issues[issueId]?.owner || 'Unassigned',
        scheduleMode: 'MANUAL',
        isMilestone,
        origin: 'user',
        deletedAt: null,
      }
      return {
        state: {
          ...state,
          seq,
          activities: { ...state.activities, [id]: rec },
          audit: log(actor, state, {
            rowId: id,
            field: 'created',
            from: null,
            to: `${isMilestone ? 'Milestone' : a.kind} on ${issueId}`,
            at: a.now,
            by,
          }),
        },
        createdId: id,
        message: `${isMilestone ? 'Milestone' : a.kind} added to ${issueId}.`,
      }
    }

    /* ---------------- CRUD: update ---------------- */
    case 'updateNode': {
      const n = state.nodes[a.id]
      if (!n) return { state, error: 'Record not found.' }
      const changed = Object.entries(a.patch).filter(
        ([k, v]) => (n as unknown as Record<string, unknown>)[k] !== v,
      )
      if (!changed.length) return { state }
      let audit = state.audit
      for (const [k, v] of changed) {
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: a.id,
            field: k,
            from: String((n as unknown as Record<string, unknown>)[k] ?? ''),
            to: String(v ?? ''),
            at: a.now,
            by,
          },
        )
      }
      return {
        state: { ...state, nodes: { ...state.nodes, [a.id]: { ...n, ...a.patch } }, audit },
        message: 'Saved.',
      }
    }

    case 'updateIssue': {
      const i = state.issues[a.id]
      if (!i) return { state, error: 'Issue not found.' }

      /**
       * Has somebody else changed this since it was read?
       *
       * Field by field, rather than by a version on the row, and the difference matters. A row
       * version refuses a due-date change because a colleague set the owner — a conflict that
       * is not one, and the reason people switch optimistic locking off. Comparing only the
       * fields being written means two people working the same record at once are stopped when
       * they genuinely disagree and left alone when they do not.
       *
       * Checked before the transition graph, because a stale status change should be reported
       * as stale rather than as an illegal move: telling somebody their transition is not
       * allowed, when the real answer is that the record already moved, sends them to argue
       * with the wrong rule.
       */
      if (a.expected) {
        for (const [key, was] of Object.entries(a.expected)) {
          const now = (i as unknown as Record<string, unknown>)[key]
          if (now === was) continue
          const field = String(key)
          return {
            state,
            error: `${a.id} has changed since you opened it: ${field} is now “${String(now ?? '—')}”, not “${String(was ?? '—')}”. Your change was not saved. Reload to see theirs, then decide.`,
          }
        }
      }

      /**
       * A status change is a transition, and the graph decides whether it is allowed.
       *
       * Checked before anything else in the arm, so a refused move leaves the record exactly
       * as it was — including the other fields in the same patch. Saving the rest and dropping
       * the status would be the worst outcome: the form would report success while quietly
       * discarding the change the person actually came to make.
       */
      if (a.patch.status != null && a.patch.status !== i.status) {
        const problem = checkTransition(state.model.statusPolicy, i.status, a.patch.status, {
          hasEvidence: Object.values(state.evidence).some(
            (e) => e.issueId === a.id && !e.deletedAt,
          ),
          reason: a.reason,
        })
        if (problem) return { state, error: problem.message }

        /**
         * And whether anybody with authority has agreed to it.
         *
         * The approval gate rides on the transition rather than sitting beside it, so there is
         * one answer to "may this record move" instead of two that can disagree. A rejected
         * decision blocks exactly as a missing one does and does not clear itself: somebody has
         * to ask again, and the refusal stays where a reader can see the change was declined
         * rather than never considered.
         */
        const blocked = blockingRule(
          state.model.approvalRules,
          state.approvals,
          a.id,
          i.type,
          a.patch.status,
        )
        if (blocked) {
          const asked = approvalsFor(state.approvals, a.id).find((x) => x.ruleId === blocked.id)
          return {
            state,
            error: asked
              ? asked.decision === 'rejected'
                ? `${blocked.label}: this was rejected by ${asked.decidedBy}. ${asked.decisionNote || 'Ask again if something has changed.'}`
                : `${blocked.label}: asked for, and nobody has decided yet.`
              : `${blocked.label} is needed before this can move to “${a.patch.status}”.`,
          }
        }
      }
      /**
       * Is the person being named actually there?
       *
       * Guarded on the owner having *changed*, not on the key being in the patch, for the
       * reason spelled out under `actualEnd` below: the edit form submits the whole record, so
       * a presence test would re-judge the existing owner on every unrelated save and refuse a
       * typo fix because the person who owns the row went on leave last week.
       *
       * The window comes from the patched record rather than the stored one, so setting an
       * owner and a plan in one save is checked against the plan being saved.
       */
      const ownerVerdict =
        a.patch.owner != null && a.patch.owner !== i.owner
          ? availabilityForAssignment(state, { ...i, ...a.patch }, a.patch.owner, a.now)
          : null
      if (ownerVerdict && refusesAssignment(ownerVerdict) && !a.acceptUnavailable) {
        return {
          state,
          error: `${ownerVerdict.message} Assign it anyway if that is the decision — it will be recorded as one.`,
        }
      }

      const changed = Object.entries(a.patch).filter(
        ([k, v]) => (i as unknown as Record<string, unknown>)[k] !== v,
      )
      if (!changed.length) return { state }
      let audit = state.audit
      for (const [k, v] of changed) {
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: a.id,
            field: k,
            from: String((i as unknown as Record<string, unknown>)[k] ?? ''),
            to: String(v ?? ''),
            at: a.now,
            by,
            // Only on the field the reason was given about. Stamping it on every field in the
            // patch would attribute a closure rationale to an unrelated typo fix.
            //
            // Owner carries a reason of its own, and one nobody typed: what was known about
            // that person's time when the work was handed to them. It is written whenever the
            // answer was anything other than "clear", including when it was "nothing is
            // known" — a reader six weeks later needs to see that the question was asked and
            // could not be answered, which is not what an empty reason says.
            reason:
              k === 'status'
                ? a.reason?.trim() || undefined
                : k === 'owner' && ownerVerdict
                  ? availabilityNote(ownerVerdict)
                  : undefined,
          },
        )
      }
      const next = { ...i, ...a.patch, lastActivity: a.now.slice(0, 10) }

      // Closing an issue records its completion date; reopening clears it.
      //
      // Guard on the status having actually CHANGED, not merely being present in the patch.
      // The edit form always submits the full record, so a key-presence test would rewrite
      // actualEnd on every save — overwriting a closure date recorded in the source log with
      // today's date, silently, on an unrelated edit such as fixing a typo.
      const terminal = ['Closed - confirmed', 'Closed - no defect', 'Superseded']
      const statusChanged = a.patch.status != null && a.patch.status !== i.status
      if (statusChanged) {
        const derivedEnd = terminal.includes(a.patch.status!) ? a.now.slice(0, 10) : null
        if (derivedEnd !== i.actualEnd) {
          next.actualEnd = derivedEnd
          // A derived write is still a write, so it belongs in the audit trail.
          audit = log(
            actor,
            { ...state, audit },
            {
              rowId: a.id,
              field: 'actualEnd',
              from: i.actualEnd ?? '',
              to: derivedEnd ?? '(cleared)',
              at: a.now,
              by,
              reason: `Derived from the status change to “${a.patch.status}”.`,
            },
          )
        }
      }
      // The warning rides back on the success message, because a note only the audit trail
      // sees arrives too late to be acted on by the person who could still change their mind.
      const ownerNote = ownerVerdict ? availabilityNote(ownerVerdict) : undefined
      return {
        state: { ...state, issues: { ...state.issues, [a.id]: next }, audit },
        message: ownerNote ? `Saved. ${ownerNote}` : 'Saved.',
      }
    }

    case 'updateActivity': {
      const act = state.activities[a.id]
      if (!act) return { state, error: 'Activity not found.' }
      let audit = state.audit
      for (const [k, v] of Object.entries(a.patch)) {
        if ((act as unknown as Record<string, unknown>)[k] === v) continue
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: a.id,
            field: k,
            from: String((act as unknown as Record<string, unknown>)[k] ?? ''),
            to: String(v ?? ''),
            at: a.now,
            by,
          },
        )
      }
      return {
        state: {
          ...state,
          // Touching an activity makes its values the user's, not the generator's.
          activities: { ...state.activities, [a.id]: { ...act, ...a.patch, origin: 'user' } },
          audit,
        },
        message: 'Saved.',
      }
    }

    /* ---------------- CRUD: soft delete ---------------- */
    case 'softDelete': {
      const kind = kindOf(state, a.id)
      if (!kind) return { state, error: 'Record not found.' }
      const kids = childrenOf(state, a.id)

      const nodes = { ...state.nodes }
      const issues = { ...state.issues }
      const activities = { ...state.activities }
      /** Records this archive reparents, so each can be audited and later put back. */
      const moves: { id: string; from: string | null }[] = []
      /** Where they were moved to — needed by the audit entries built after the branch. */
      let newParentForAudit: string | null = null

      const markDeleted = (id: string) => {
        if (nodes[id]) nodes[id] = { ...nodes[id], deletedAt: a.now }
        else if (issues[id]) issues[id] = { ...issues[id], deletedAt: a.now }
        else if (activities[id]) activities[id] = { ...activities[id], deletedAt: a.now }
      }

      let detail: string
      if (a.mode === 'cascade') {
        const all = [a.id, ...descendantsOf(state, a.id)]
        all.forEach(markDeleted)
        detail = `archived with ${all.length - 1} child record(s)`
      } else {
        // Re-attach children to the deleted record's parent rather than destroying them.
        const newParent = parentOf(state, a.id)
        newParentForAudit = newParent
        if (!newParent && kids.length) {
          return {
            state,
            error: 'This is a root record — its children have nowhere to move to. Archive the whole branch instead.',
          }
        }
        /**
         * Each move is a change to that record, and gets its own audit entry.
         *
         * It used to write one line against the record being archived — "3 child record(s)
         * moved up one level" — and nothing at all against the three records whose parent
         * actually changed. Their History showed no reason for having moved, which in an
         * application whose whole claim is that every change goes through one audited reducer
         * is the wrong kind of quiet. A move a user performs has always been audited; a move
         * an archive performs is the same change and now reads the same way.
         *
         * These entries share `a.now` with the archive that caused them, which is also what
         * lets restore find and reverse them.
         */
        for (const k of kids) {
          if (nodes[k]) {
            moves.push({ id: k, from: nodes[k].parentId })
            nodes[k] = { ...nodes[k], parentId: newParent }
          } else if (issues[k]) {
            moves.push({ id: k, from: issues[k].parentId })
            issues[k] = { ...issues[k], parentId: newParent! }
          } else if (activities[k]) {
            // An activity cannot be reparented out of its issue; archive it with the issue.
            activities[k] = { ...activities[k], deletedAt: a.now }
          }
        }
        markDeleted(a.id)
        detail = kids.length ? `archived; ${kids.length} child record(s) moved up one level` : 'archived'
      }

      return {
        state: {
          ...state,
          nodes,
          issues,
          activities,
          audit: logAll(actor, state, [
            {
              rowId: a.id,
              field: 'archived',
              from: 'active',
              to: detail,
              at: a.now,
              by,
              reason: 'Soft delete — the record is retained in history and can be restored.',
            },
            ...moves.map((m) => ({
              rowId: m.id,
              field: 'parent',
              from: m.from,
              to: newParentForAudit,
              at: a.now,
              by,
              reason: `Moved up one level when “${nameOf(state, a.id)}” was archived.`,
            })),
          ]),
        },
        message: `"${nameOf(state, a.id)}" ${detail}.`,
      }
    }

    /**
     * Undo an archive.
     *
     * This used to clear `deletedAt` on one record and stop, which was wrong in both
     * directions and unreachable besides — nothing in the UI dispatched it, so archiving was
     * a one-way door while the audit entry promised the opposite.
     *
     * Archiving a branch stamps *one* timestamp across the whole subtree. Restoring only the
     * top of it therefore brought back an empty shell: the record reappeared and everything it
     * contained stayed archived. Restoring a child while its parent was still archived was the
     * mirror image — a record that exists and renders nowhere, because the tree never reaches
     * it, so it reads as though the restore silently failed.
     */
    case 'restore': {
      const target = state.nodes[a.id] ?? state.issues[a.id] ?? state.activities[a.id]
      if (!target) return { state, error: 'Record not found.' }
      if (!target.deletedAt) return { state, message: 'That record is already active.' }

      // Reachability first: a restored record whose ancestor is archived is invisible.
      let cursor = parentOf(state, a.id)
      while (cursor) {
        const ancestor = state.nodes[cursor] ?? state.issues[cursor] ?? state.activities[cursor]
        if (ancestor?.deletedAt) {
          return {
            state,
            error: `“${nameOf(state, cursor)}” is archived, so this would be restored somewhere nothing can see it. Restore that first.`,
          }
        }
        cursor = parentOf(state, cursor)
      }

      /**
       * Everything archived by the same action, and nothing else.
       *
       * The cascade's shared timestamp is what identifies it. A child archived separately
       * carries its own timestamp and stays archived — restoring a branch must not silently
       * undo a decision somebody made about one record inside it.
       *
       * Walks the subtree ignoring `deletedAt`, because `childrenOf` filters archived records
       * out and every record in question is archived.
       */
      const stamp = target.deletedAt
      const childIdsOf = (id: string): string[] => {
        const out: string[] = []
        for (const n of Object.values(state.nodes)) if (n.parentId === id) out.push(n.id)
        for (const i of Object.values(state.issues)) if (i.parentId === id) out.push(i.id)
        for (const ac of Object.values(state.activities)) if (ac.issueId === id) out.push(ac.id)
        return out
      }

      const nodes = { ...state.nodes }
      const issues = { ...state.issues }
      const activities = { ...state.activities }
      const revive = (id: string) => {
        if (nodes[id]) nodes[id] = { ...nodes[id], deletedAt: null }
        else if (issues[id]) issues[id] = { ...issues[id], deletedAt: null }
        else if (activities[id]) activities[id] = { ...activities[id], deletedAt: null }
      }

      revive(a.id)
      let restored = 1
      const stack = [...childIdsOf(a.id)]
      const seen = new Set<string>([a.id])
      while (stack.length) {
        const id = stack.pop()!
        if (seen.has(id)) continue
        seen.add(id)
        const rec = state.nodes[id] ?? state.issues[id] ?? state.activities[id]
        if (rec?.deletedAt === stamp) {
          revive(id)
          restored += 1
        }
        stack.push(...childIdsOf(id))
      }

      /**
       * Put back the records this archive moved rather than archived.
       *
       * The other archive mode moves children up a level instead of taking them with it. That
       * is a change to the tree as well as an archive, and restoring the record used to leave
       * it — the record came back empty while its former children stayed where they had been
       * put, with nothing on screen explaining why.
       *
       * The moves are audited now, sharing the archive's timestamp, so the trail says exactly
       * which records went where and as part of what. Same identifying rule as the cascade.
       *
       * A record is only moved back if it is *still* where the archive put it: anyone who has
       * since moved it made a decision of their own, and undoing that silently would be the
       * same fault in the opposite direction. Entries aged out of the capped trail simply do
       * not match, so the worst case is the old behaviour rather than a wrong one.
       */
      let movedBack = 0
      for (const entry of state.audit) {
        if (entry.at !== stamp || entry.field !== 'parent') continue
        const rec = nodes[entry.rowId] ?? issues[entry.rowId]
        if (!rec || rec.parentId !== entry.to) continue
        if (nodes[entry.rowId]) nodes[entry.rowId] = { ...nodes[entry.rowId], parentId: entry.from }
        else if (issues[entry.rowId] && entry.from) {
          issues[entry.rowId] = { ...issues[entry.rowId], parentId: entry.from }
        } else continue
        movedBack += 1
      }

      const detail =
        restored > 1
          ? `restored with ${restored - 1} child record(s)`
          : movedBack > 0
            ? `restored; ${movedBack} record(s) moved back into it`
            : 'restored'
      return {
        state: {
          ...state,
          nodes,
          issues,
          activities,
          audit: log(actor, state, {
            rowId: a.id,
            field: 'restored',
            from: 'archived',
            to: detail,
            at: a.now,
            by,
          }),
        },
        message:
          restored > 1
            ? `Restored “${nameOf(state, a.id)}” and ${restored - 1} record(s) archived with it.`
            : movedBack > 0
              ? `Restored “${nameOf(state, a.id)}” and moved ${movedBack} record(s) back into it.`
              : `Restored “${nameOf(state, a.id)}”.`,
      }
    }

    /* ---------------- HIERARCHY: move ---------------- */
    case 'move': {
      const kind = kindOf(state, a.id)
      const parentKind = kindOf(state, a.newParentId)
      if (!kind || !parentKind) return { state, error: 'Record not found.' }
      if (a.id === a.newParentId) return { state, error: 'A record cannot be its own parent.' }
      if (!canParent(kind, parentKind)) {
        return { state, error: `A ${kind} cannot sit under a ${parentKind}.` }
      }
      if (descendantsOf(state, a.id).includes(a.newParentId)) {
        return { state, error: 'That would create a circular hierarchy — the target sits beneath this record.' }
      }
      const from = parentOf(state, a.id)
      if (from === a.newParentId) return { state, message: 'Already in that position.' }

      const nodes = { ...state.nodes }
      const issues = { ...state.issues }
      if (nodes[a.id]) nodes[a.id] = { ...nodes[a.id], parentId: a.newParentId }
      else if (issues[a.id]) {
        // Keep the denormalised client/module in step with the new position.
        let client = issues[a.id].client
        let mod = issues[a.id].module
        let cursor: string | null = a.newParentId
        while (cursor) {
          const n: HierarchyNode | undefined = nodes[cursor]
          if (n?.kind === 'module') mod = n.name
          if (n?.kind === 'client') client = n.name
          const next: string | null = n ? n.parentId : (issues[cursor]?.parentId ?? null)
          cursor = next
        }
        issues[a.id] = { ...issues[a.id], parentId: a.newParentId, client, module: mod }
      } else return { state, error: 'Only structural records and issues can be moved.' }

      return {
        state: {
          ...state,
          nodes,
          issues,
          audit: log(actor, state, {
            rowId: a.id,
            field: 'parent',
            from: from ? nameOf(state, from) : '(root)',
            to: nameOf(state, a.newParentId),
            at: a.now,
            by,
          }),
        },
        message: `Moved to ${nameOf(state, a.newParentId)}.`,
      }
    }

    /* ---------------- RELATIONSHIPS ---------------- */
    case 'link': {
      if (a.sourceIssueId === a.targetIssueId) {
        return { state, error: 'An issue cannot be related to itself.' }
      }
      if (!state.issues[a.targetIssueId]) {
        return { state, error: `Issue ${a.targetIssueId} does not exist.` }
      }
      const exists = state.relationships.some(
        (r) =>
          r.sourceIssueId === a.sourceIssueId &&
          r.targetIssueId === a.targetIssueId &&
          r.relationshipType === a.relationshipType,
      )
      if (exists) return { state, error: 'That relationship already exists.' }
      const rel: IssueRelationship = {
        id: `rel-${state.seq + 1}`,
        sourceIssueId: a.sourceIssueId,
        targetIssueId: a.targetIssueId,
        relationshipType: a.relationshipType,
        note: a.note,
      }
      return {
        state: {
          ...state,
          seq: state.seq + 1,
          relationships: [...state.relationships, rel],
          audit: log(actor, state, {
            rowId: a.sourceIssueId,
            field: 'relationship',
            from: null,
            to: `${a.relationshipType.replace(/_/g, ' ')} ${a.targetIssueId}`,
            at: a.now,
            by,
            reason: 'Business relationship — carries no scheduling effect.',
          }),
        },
        message: `Linked to ${a.targetIssueId}.`,
      }
    }

    case 'unlink': {
      const rel = state.relationships.find((r) => r.id === a.id)
      if (!rel) return { state, error: 'Relationship not found.' }
      return {
        state: {
          ...state,
          relationships: state.relationships.filter((r) => r.id !== a.id),
          audit: log(actor, state, {
            rowId: rel.sourceIssueId,
            field: 'relationship',
            from: `${rel.relationshipType} ${rel.targetIssueId}`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: 'Relationship removed.',
      }
    }

    /* ---------------- SCHEDULING ---------------- */
    case 'setDates': {
      if (a.end < a.start) return { state, error: 'End date cannot fall before the start date.' }
      if (state.issues[a.id]) {
        const i = state.issues[a.id]
        return {
          state: {
            ...state,
            issues: {
              ...state.issues,
              [a.id]: { ...i, plannedStart: a.start, plannedEnd: a.end, scheduleMode: 'MANUAL' },
            },
            audit: log(actor, state, {
              rowId: a.id,
              field: 'plannedDates',
              // "— → —" reads as a date range rather than as "there wasn't one".
              from: i.plannedStart && i.plannedEnd ? `${i.plannedStart} → ${i.plannedEnd}` : 'not scheduled',
              to: `${a.start} → ${a.end}`,
              at: a.now,
              by,
              reason: a.reason,
            }),
          },
          message: `${a.id} rescheduled.`,
        }
      }
      const act = state.activities[a.id]
      if (!act) return { state, error: 'Only issues and activities carry dates.' }
      return {
        state: {
          ...state,
          activities: {
            ...state.activities,
            [a.id]: {
              ...act,
              plannedStartDate: a.start,
              plannedEndDate: act.isMilestone ? a.start : a.end,
              scheduleMode: 'MANUAL',
              origin: 'user',
            },
          },
          audit: log(actor, state, {
            rowId: a.id,
            field: 'plannedDates',
            from: `${act.plannedStartDate} → ${act.plannedEndDate}`,
            to: `${a.start} → ${a.end}`,
            at: a.now,
            by,
            reason: a.reason,
          }),
        },
        message: 'Rescheduled.',
      }
    }

    case 'addDependency': {
      if (a.predecessorId === a.successorId) {
        return { state, error: 'An activity cannot depend on itself.' }
      }
      const dup = state.dependencies.some(
        (d) => d.predecessorId === a.predecessorId && d.successorId === a.successorId,
      )
      if (dup) return { state, error: 'That dependency already exists.' }
      // Reject cycles in the dependency graph.
      const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
        if (from === target) return true
        if (seen.has(from)) return false
        seen.add(from)
        return state.dependencies
          .filter((d) => d.predecessorId === from)
          .some((d) => reaches(d.successorId, target, seen))
      }
      if (reaches(a.successorId, a.predecessorId)) {
        return { state, error: 'That link would create a circular dependency.' }
      }
      const dep: IssueDependency = {
        id: `dep-${state.seq + 1}`,
        predecessorId: a.predecessorId,
        successorId: a.successorId,
        dependencyType: a.dependencyType,
        lagDays: a.lagDays,
        createdAt: a.now,
        createdBy: by,
      }
      return {
        state: {
          ...state,
          seq: state.seq + 1,
          dependencies: [...state.dependencies, dep],
          audit: log(actor, state, {
            rowId: a.successorId,
            field: 'dependency',
            from: null,
            to: `${a.dependencyType}${a.lagDays ? `+${a.lagDays}d` : ''} from ${nameOf(state, a.predecessorId)}`,
            at: a.now,
            by,
            reason: 'Scheduling constraint — distinct from a business relationship.',
          }),
        },
        message: 'Dependency created.',
      }
    }

    case 'removeDependency': {
      const dep = state.dependencies.find((d) => d.id === a.id)
      if (!dep) return { state, error: 'Dependency not found.' }
      return {
        state: {
          ...state,
          dependencies: state.dependencies.filter((d) => d.id !== a.id),
          audit: log(actor, state, {
            rowId: dep.successorId,
            field: 'dependency',
            from: `${dep.dependencyType} from ${nameOf(state, dep.predecessorId)}`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: 'Dependency removed.',
      }
    }

    /* ---------------- EVIDENCE ---------------- */
    case 'addEvidence': {
      if (!state.issues[a.issueId]) return { state, error: 'Issue not found.' }
      const name = a.name.trim()
      if (!name) return { state, error: 'A name is required.' }
      if (a.kind === 'link' && !/^https?:\/\//i.test(a.url ?? '')) {
        return { state, error: 'A link must be a full http(s) URL.' }
      }
      const seq = state.seq + 1
      const id = `ev-${seq}`
      const item: EvidenceItem = {
        id,
        issueId: a.issueId,
        kind: a.kind,
        name,
        purpose: a.kind === 'snapshot' ? a.purpose : null,
        url: a.url,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        note: a.note,
        addedAt: a.now,
        addedBy: by,
        origin: 'user',
        deletedAt: null,
      }
      return {
        state: {
          ...state,
          seq,
          evidence: { ...state.evidence, [id]: item },
          audit: log(actor, state, {
            rowId: a.issueId,
            field: 'evidence',
            from: null,
            to: `${a.kind}: ${name}${a.purpose ? ` (${a.purpose})` : ''}`,
            at: a.now,
            by,
          }),
        },
        message: `Attached “${name}”.`,
      }
    }

    case 'updateEvidence': {
      const ev = state.evidence[a.id]
      if (!ev) return { state, error: 'Evidence item not found.' }
      if (ev.origin === 'imported') {
        return { state, error: 'Evidence reconstructed from the issue log is read-only.' }
      }
      let audit = state.audit
      for (const [k, v] of Object.entries(a.patch)) {
        if ((ev as unknown as Record<string, unknown>)[k] === v) continue
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: ev.issueId,
            field: `evidence.${k}`,
            from: String((ev as unknown as Record<string, unknown>)[k] ?? ''),
            to: String(v ?? ''),
            at: a.now,
            by,
          },
        )
      }
      return {
        state: { ...state, evidence: { ...state.evidence, [a.id]: { ...ev, ...a.patch } }, audit },
        message: 'Saved.',
      }
    }

    case 'removeEvidence': {
      const ev = state.evidence[a.id]
      if (!ev) return { state, error: 'Evidence item not found.' }
      if (ev.origin === 'imported') {
        return { state, error: 'Evidence reconstructed from the issue log cannot be removed.' }
      }
      return {
        state: {
          ...state,
          // Soft delete, consistent with every other record in this model.
          evidence: { ...state.evidence, [a.id]: { ...ev, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: ev.issueId,
            field: 'evidence',
            from: `${ev.kind}: ${ev.name}`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: `Removed “${ev.name}”.`,
      }
    }

    case 'buildLifecycle': {
      const issue = state.issues[a.issueId]
      if (!issue) return { state, error: 'Issue not found.' }
      if (Object.values(state.activities).some((x) => x.issueId === a.issueId && !x.deletedAt)) {
        return { state, error: `${a.issueId} already has a lifecycle plan.` }
      }

      const weights: Record<string, number> = {
        Investigation: 0.25,
        'Root Cause Analysis': 0.2,
        'Corrective Action': 0.35,
        Verification: 0.2,
        Closure: 0,
      }
      const issueProgress = STATUS_PROGRESS[issue.status]
      const phaseShare = 100 / (ACTIVITY_PHASES.length - 1)

      const activities = { ...state.activities }
      const deps = [...state.dependencies]
      let cursor = issue.raised
      let consumed = 0
      let seq = state.seq

      ACTIVITY_PHASES.forEach((phase, i) => {
        seq += 1
        const isMilestone = phase === 'Closure'
        const wd = Math.max(1, Math.round(a.slaDays * weights[phase]))
        const start = i === 0 ? cursor : addWorkingDays(cursor, 1)
        const end = isMilestone ? start : addWorkingDays(start, wd - 1)

        let pct = 0
        if (!isMilestone) {
          const remaining = issueProgress - consumed
          pct = Math.max(0, Math.min(100, Math.round((remaining / phaseShare) * 100)))
          consumed += Math.min(phaseShare, Math.max(0, remaining))
        } else {
          pct = issueProgress >= 100 ? 100 : 0
        }

        const id = `${a.issueId}#${i + 1}`
        activities[id] = {
          id,
          issueId: a.issueId,
          phase,
          order: i,
          plannedStartDate: start,
          plannedEndDate: end,
          percentComplete: pct,
          owner: issue.owner,
          scheduleMode: 'AUTO',
          isMilestone,
          origin: 'generated',
          deletedAt: null,
        }
        if (i > 0) {
          deps.push({
            id: `dep-lc-${a.issueId}-${i}`,
            predecessorId: `${a.issueId}#${i}`,
            successorId: id,
            dependencyType: 'FS',
            lagDays: 0,
            createdAt: a.now,
            createdBy: 'lifecycle-generator',
          })
        }
        cursor = end
      })

      return {
        state: {
          ...state,
          seq,
          activities,
          dependencies: deps,
          audit: log(actor, state, {
            rowId: a.issueId,
            field: 'lifecycle',
            from: null,
            to: `${ACTIVITY_PHASES.length} activities linked finish-to-start`,
            at: a.now,
            by,
            reason: `Sized against a ${a.slaDays} working-day SLA window from the raised date. The log contains no activity breakdown, so these dates originate here, not from the source.`,
          }),
        },
        message: `Lifecycle plan created for ${a.issueId}.`,
      }
    }

    case 'clearLifecycle': {
      const activities = { ...state.activities }
      let n = 0
      for (const k of Object.keys(activities)) {
        if (activities[k].issueId === a.issueId) {
          delete activities[k]
          n++
        }
      }
      return {
        state: {
          ...state,
          activities,
          dependencies: state.dependencies.filter(
            (d) => !d.predecessorId.startsWith(`${a.issueId}#`) && !d.successorId.startsWith(`${a.issueId}#`),
          ),
          audit: log(actor, state, {
            rowId: a.issueId,
            field: 'lifecycle',
            from: `${n} activities`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: `Lifecycle plan removed from ${a.issueId}.`,
      }
    }

    /* ---------------- NOTES ---------------- */

    /**
     * Notes are written, not derived, so the reducer's job here is narrow: mint an id, stamp
     * who and when, and move the issue's last-activity date.
     *
     * That last part is the reason this is an action rather than a field edit. Somebody
     * recording what a client said on the phone *is* activity on the issue, and an issue whose
     * last-activity date ignores three weeks of investigation notes reports itself as stale
     * when it is the opposite.
     */
    case 'addNote': {
      const issue = state.issues[a.issueId]
      if (!issue) return { state, error: 'Issue not found.' }
      const body = a.body.trim()
      if (!body) return { state, error: 'A note needs something in it.' }

      const seq = state.seq + 1
      const id = `note-${seq}`
      const note: IssueNote = {
        id,
        issueId: a.issueId,
        body,
        noteType: a.noteType ?? DEFAULT_NOTE_TYPE,
        pinned: a.pinned,
        createdBy: by,
        createdAt: a.now,
        updatedBy: null,
        updatedAt: null,
        deletedAt: null,
      }
      return {
        state: {
          ...state,
          notes: { ...state.notes, [id]: note },
          issues: { ...state.issues, [a.issueId]: { ...issue, lastActivity: a.now.slice(0, 10) } },
          seq,
          audit: log(actor, state, {
            rowId: a.issueId,
            field: 'note',
            from: null,
            to: note.noteType,
            at: a.now,
            by,
            reason: body.length > 120 ? `${body.slice(0, 117)}…` : body,
          }),
        },
        // Deliberately no `createdId`. That field means "a row appeared, select it", and the
        // workspace acts on it — so returning a note id selected the note as though it were a
        // row, found nothing in the tree, and emptied the panel the note was just added to.
        // A note is not a row; there is nothing to reveal.
        message: 'Note added.',
      }
    }

    /**
     * Editing preserves the original authorship.
     *
     * `createdBy` and `createdAt` are never touched: a correction weeks later must not
     * reassign who first made the observation, or when. The edit is recorded separately.
     */
    case 'updateNote': {
      const note = state.notes[a.id]
      if (!note) return { state, error: 'Note not found.' }
      if (note.deletedAt) return { state, error: 'That note has been deleted.' }
      // Checked here as well as in the panel, and this is the one that counts. The panel had
      // been asking the question and greying the control since notes shipped, while the
      // reducer accepted the action from anyone — so the rule held for people using the
      // button and not for anything else that could dispatch.
      {
        const mayEdit = canEditNote(state.model, actor, note)
        if (!mayEdit.allowed) return { state, error: mayEdit.reason ?? 'Not permitted.' }
      }
      const body = a.patch.body !== undefined ? a.patch.body.trim() : note.body
      if (!body) return { state, error: 'A note needs something in it.' }

      const next: IssueNote = {
        ...note,
        ...a.patch,
        body,
        updatedBy: by,
        updatedAt: a.now,
      }
      const changed = (Object.keys(a.patch) as (keyof IssueNote)[]).filter(
        (k) => note[k] !== next[k],
      )
      if (!changed.length) return { state, message: 'Nothing changed.' }

      const issue = state.issues[note.issueId]
      return {
        state: {
          ...state,
          notes: { ...state.notes, [a.id]: next },
          issues: issue
            ? { ...state.issues, [note.issueId]: { ...issue, lastActivity: a.now.slice(0, 10) } }
            : state.issues,
          audit: log(actor, state, {
            rowId: note.issueId,
            field: 'note',
            from: String(note[changed[0]] ?? ''),
            to: String(next[changed[0]] ?? ''),
            at: a.now,
            by,
            reason: `Note edited (${changed.join(', ')}).`,
          }),
        },
        message: 'Note updated.',
      }
    }

    case 'removeNote': {
      const note = state.notes[a.id]
      if (!note) return { state, error: 'Note not found.' }
      {
        const mayEdit = canEditNote(state.model, actor, note)
        if (!mayEdit.allowed) return { state, error: mayEdit.reason ?? 'Not permitted.' }
      }
      return {
        state: {
          ...state,
          // Soft, like every other record: a working record that can be silently removed is
          // not a record of anything.
          notes: { ...state.notes, [a.id]: { ...note, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: note.issueId,
            field: 'note',
            from: note.noteType,
            to: '(deleted)',
            at: a.now,
            by,
          }),
        },
        message: 'Note deleted.',
      }
    }

    /* ---------------- ESTIMATION ---------------- */

    /**
     * Edit an estimate, and record the revision if one has been agreed.
     *
     * Before a baseline exists this is ordinary editing — somebody is still working out what
     * the number is, and every keystroke does not owe an explanation. Once the estimate has
     * been agreed, changing anything a reader would notice becomes an event: it needs a
     * reason, and both halves of the before and after are kept, because effort and timeline
     * move independently. Scope can grow without the date slipping if people are added, and
     * the date can slip with no change in effort at all when a client goes quiet.
     */
    case 'setEstimate': {
      const issue = state.issues[a.issueId]
      if (!issue) return { state, error: 'Issue not found.' }

      const bands = state.model.sizeBands
      const existing = state.estimates[a.issueId]
      const base: IssueEstimate = existing ?? {
        ...emptyEstimate(a.now.slice(0, 10)),
        issueId: a.issueId,
        baselinedAt: null,
        baselinedBy: null,
        updatedAt: a.now,
        updatedBy: by,
      }
      const next: IssueEstimate = { ...base, ...a.patch, updatedAt: a.now, updatedBy: by }

      const before = summarise(base, bands)
      const after = summarise(next, bands)
      const material = summariesDiffer(before, after)

      if (base.baselinedAt && material && !a.reason?.trim()) {
        return {
          state,
          error:
            'This estimate has been agreed. Changing the effort, size, duration, date or confidence needs a reason.',
        }
      }

      const revisions = { ...state.estimateRevisions }
      let seq = state.seq
      if (base.baselinedAt && material) {
        seq += 1
        const id = `rev-${seq}`
        revisions[id] = {
          id,
          issueId: a.issueId,
          at: a.now,
          by,
          reason: a.reason!.trim(),
          from: before,
          to: after,
        }
      }

      return {
        state: {
          ...state,
          estimates: { ...state.estimates, [a.issueId]: next },
          estimateRevisions: revisions,
          seq,
          audit: material
            ? log(actor, state, {
                rowId: a.issueId,
                field: 'estimate',
                from: `${before.effortHours ?? '—'}h / ${before.workingDays ?? '—'}d`,
                to: `${after.effortHours ?? '—'}h / ${after.workingDays ?? '—'}d`,
                at: a.now,
                by,
                reason: a.reason?.trim() || undefined,
              })
            : state.audit,
        },
        message: base.baselinedAt && material ? 'Estimate revised.' : undefined,
      }
    }

    /**
     * Agree the estimate.
     *
     * Nothing about the numbers changes; what changes is that they are now somebody's word,
     * so every later edit that moves them has to say why.
     */
    case 'baselineEstimate': {
      const est = state.estimates[a.issueId]
      if (!est) return { state, error: 'There is no estimate to agree yet.' }
      if (est.baselinedAt) return { state, message: 'Already agreed.' }
      const s = summarise(est, state.model.sizeBands)
      if (s.effortHours === null) {
        return { state, error: 'Score the five parameters, or set an effort figure, before agreeing it.' }
      }
      return {
        state: {
          ...state,
          estimates: {
            ...state.estimates,
            [a.issueId]: { ...est, baselinedAt: a.now, baselinedBy: by, updatedAt: a.now, updatedBy: by },
          },
          audit: log(actor, state, {
            rowId: a.issueId,
            field: 'estimate',
            from: 'draft',
            to: `agreed — ${s.effortHours}h / ${s.workingDays ?? '—'}d / ${s.size ?? 'no size'}`,
            at: a.now,
            by,
          }),
        },
        message: 'Estimate agreed. Later changes will ask for a reason.',
      }
    }

    /* ---------------- TIME ---------------- */

    /**
     * Record hours against an issue.
     *
     * Two things happen that are easy to miss. The entry moves the issue's `lastActivity`,
     * because somebody working on it *is* activity — the same rule notes follow, and for the
     * same reason: an issue with four hours logged today is not stale. And logging time on
     * somebody else's behalf is a separate permission, checked here rather than in the action
     * map, because only this arm knows whose name is on the entry.
     */
    case 'addTime': {
      const issue = state.issues[a.issueId]
      if (!issue) return { state, error: 'Issue not found.' }
      if (issue.deletedAt) return { state, error: 'That record is archived.' }

      const today = a.now.slice(0, 10)
      const problem = checkEntry({ hours: a.hours, date: a.date, person: a.person }, today)
      if (problem) return { state, error: problem.message }

      if (a.person.trim().toLowerCase() !== by.toLowerCase()) {
        const may = can(state.model, actor, 'time.recordForOthers')
        if (!may.allowed) {
          return {
            state,
            error: `${may.reason ?? 'Not permitted.'} Time is recorded by the person who did the work.`,
          }
        }
      }

      const seq = state.seq + 1
      const id = `time-${seq}`
      const entry: TimeEntry = {
        id,
        issueId: a.issueId,
        person: a.person.trim(),
        date: a.date,
        hours: a.hours,
        activity: a.activity,
        billable: a.billable,
        note: a.note.trim(),
        createdBy: by,
        createdAt: a.now,
        updatedBy: null,
        updatedAt: null,
        deletedAt: null,
      }

      return {
        state: {
          ...state,
          timeEntries: { ...state.timeEntries, [id]: entry },
          issues: { ...state.issues, [a.issueId]: { ...issue, lastActivity: today } },
          seq,
          audit: log(actor, state, {
            rowId: a.issueId,
            field: 'time',
            from: '',
            to: `${a.hours}h · ${a.activity} · ${a.person}${a.billable ? '' : ' · non-billable'}`,
            at: a.now,
            by,
          }),
        },
        message: `${a.hours}h recorded.`,
      }
    }

    /**
     * Correct an entry.
     *
     * Authorship again, and the same rule as notes: hours are somebody's account of their own
     * day. Correcting another person's is a supervisor act, and it keeps their name on the
     * entry while recording who changed it.
     */
    case 'updateTime': {
      const entry = state.timeEntries[a.id]
      if (!entry) return { state, error: 'That time entry no longer exists.' }
      if (entry.deletedAt) return { state, error: 'That entry has been removed.' }

      if (entry.person.toLowerCase() !== by.toLowerCase()) {
        const may = can(state.model, actor, 'time.recordForOthers')
        if (!may.allowed) {
          return { state, error: `Recorded by ${entry.person}. Correcting somebody else's hours needs the grant for it.` }
        }
      }

      const next: TimeEntry = { ...entry, ...a.patch, updatedBy: by, updatedAt: a.now }
      const problem = checkEntry(
        { hours: next.hours, date: next.date, person: next.person },
        a.now.slice(0, 10),
      )
      if (problem) return { state, error: problem.message }

      const changed = (Object.keys(a.patch) as (keyof TimeEntry)[]).filter((k) => entry[k] !== next[k])
      if (!changed.length) return { state, message: 'Nothing changed.' }

      let audit = state.audit
      for (const k of changed) {
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: entry.issueId,
            field: `time.${String(k)}`,
            from: String(entry[k] ?? ''),
            to: String(next[k] ?? ''),
            at: a.now,
            by,
          },
        )
      }
      return { state: { ...state, timeEntries: { ...state.timeEntries, [a.id]: next }, audit }, message: 'Saved.' }
    }

    /**
     * Withdraw an entry.
     *
     * Soft, like every other record here — and more pointedly than most. Hours drive money;
     * an entry that can be made to vanish is an entry nobody can reconcile against an invoice.
     */
    case 'removeTime': {
      const entry = state.timeEntries[a.id]
      if (!entry) return { state, error: 'That time entry no longer exists.' }
      if (entry.person.toLowerCase() !== by.toLowerCase()) {
        const may = can(state.model, actor, 'time.recordForOthers')
        if (!may.allowed) {
          return { state, error: `Recorded by ${entry.person}. Removing somebody else's hours needs the grant for it.` }
        }
      }
      return {
        state: {
          ...state,
          timeEntries: { ...state.timeEntries, [a.id]: { ...entry, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: entry.issueId,
            field: 'time',
            from: `${entry.hours}h · ${entry.activity} · ${entry.person}`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: 'Entry removed.',
      }
    }

    /* ---------------- APPROVAL ---------------- */

    /**
     * Ask somebody to decide.
     *
     * The question is copied from the rule onto the approval rather than referenced, so editing
     * the rule later cannot rewrite what a person was actually asked. That is the same reason a
     * revision keeps its own before-and-after instead of pointing at a calibration that moves.
     */
    case 'requestApproval': {
      const issue = state.issues[a.subjectId]
      if (!issue) return { state, error: 'That record no longer exists.' }
      const rule = state.model.approvalRules.find((r) => r.id === a.ruleId)
      if (!rule) return { state, error: 'That approval rule no longer exists.' }
      if (!rule.enabled) return { state, error: `${rule.label} is switched off.` }

      const open = approvalsFor(state.approvals, a.subjectId).find(
        (x) => x.ruleId === rule.id && !x.decision,
      )
      if (open) return { state, error: `${rule.label} has already been asked for and is waiting on a decision.` }

      const seq = state.seq + 1
      const id = `appr-${seq}`
      const approval: Approval = {
        id,
        subjectId: a.subjectId,
        ruleId: rule.id,
        question: rule.question,
        note: a.note.trim(),
        requestedBy: by,
        requestedAt: a.now,
        decision: null,
        decidedBy: null,
        decidedAt: null,
        decisionNote: '',
        deletedAt: null,
      }
      return {
        state: {
          ...state,
          approvals: { ...state.approvals, [id]: approval },
          seq,
          audit: log(actor, state, {
            rowId: a.subjectId,
            field: 'approval',
            from: '',
            to: `${rule.label} — requested`,
            at: a.now,
            by,
            reason: a.note.trim() || undefined,
          }),
        },
        message: `${rule.label} requested.`,
      }
    }

    /**
     * Decide it.
     *
     * Two checks beyond the permission, and both are the point of the mechanism. The rule names
     * the roles that may decide, so holding the general grant is not enough — a project manager
     * with `approval.decide` still cannot approve a change the client sponsor is meant to.
     * And the person who asked may never be the person who answers: a self-approval is not a
     * weaker control, it is the absence of one, which is why this has no configuration switch.
     */
    case 'decideApproval': {
      const approval = state.approvals[a.id]
      if (!approval) return { state, error: 'That approval no longer exists.' }
      if (approval.decision) {
        return { state, error: `Already ${approval.decision} by ${approval.decidedBy}.` }
      }
      const rule = state.model.approvalRules.find((r) => r.id === approval.ruleId)
      if (!rule) return { state, error: 'The rule behind this approval no longer exists.' }

      if (approval.requestedBy.toLowerCase() === by.toLowerCase()) {
        return {
          state,
          error: 'You asked for this approval, so you cannot be the one who gives it.',
        }
      }

      const held = rolesFor(state.model, actor)
      if (rule.deciderRoleIds.length && !rule.deciderRoleIds.some((r) => held.includes(r))) {
        const names = rule.deciderRoleIds.map((r) => state.model.roles[r]?.label ?? r).join(' or ')
        return { state, error: `${rule.label} is decided by ${names}.` }
      }

      const next: Approval = {
        ...approval,
        decision: a.decision,
        decidedBy: by,
        decidedAt: a.now,
        decisionNote: a.note.trim(),
      }
      return {
        state: {
          ...state,
          approvals: { ...state.approvals, [a.id]: next },
          audit: log(actor, state, {
            rowId: approval.subjectId,
            field: 'approval',
            from: `${rule.label} — requested by ${approval.requestedBy}`,
            to: `${a.decision}`,
            at: a.now,
            by,
            reason: a.note.trim() || undefined,
          }),
        },
        message: a.decision === 'approved' ? `${rule.label} approved.` : `${rule.label} rejected.`,
      }
    }

    /* ---------------- NOTIFICATION ---------------- */

    case 'notify': {
      const seq = state.seq + 1
      const id = `notif-${seq}`
      const { delivery, deliveryNote } = deliveryFor(a.channel)
      const notification: Notification = {
        id,
        to: a.to,
        channel: a.channel,
        subject: a.subject,
        body: a.body,
        aboutId: a.aboutId,
        ruleId: a.ruleId,
        createdAt: a.now,
        delivery,
        deliveryNote,
        readAt: null,
      }
      return {
        state: {
          ...state,
          notifications: { ...state.notifications, [id]: notification },
          seq,
          // Audited against the record it is about, and carrying the rule that caused it, so
          // "why did I get this" and "why did this record change" have the same answer.
          audit: log(actor, state, {
            rowId: a.aboutId,
            field: 'notification',
            from: '',
            to: `${a.channel} → ${a.to}${delivery === 'delivered' ? '' : ` (${delivery})`}`,
            at: a.now,
            by,
            reason: a.ruleId,
          }),
        },
      }
    }

    case 'markNotificationRead': {
      const n = state.notifications[a.id]
      if (!n) return { state, error: 'That notification no longer exists.' }
      if (n.readAt) return { state }
      return {
        state: {
          ...state,
          notifications: { ...state.notifications, [a.id]: { ...n, readAt: a.now } },
        },
      }
    }

    /* ---------------- COMMERCIAL ---------------- */

    case 'upsertSow': {
      const engagement = state.nodes[a.engagementId]
      if (!engagement || engagement.kind !== 'engagement') {
        return { state, error: 'A statement of work belongs to an engagement.' }
      }
      const existing = a.id ? state.sows[a.id] : null
      if (a.id && !existing) return { state, error: 'That statement of work no longer exists.' }

      const seq = existing ? state.seq : state.seq + 1
      const id = existing?.id ?? `sow-${seq}`
      const blank: Sow = {
        id,
        engagementId: a.engagementId,
        reference: '',
        title: '',
        status: 'Draft',
        signedOn: null,
        startDate: null,
        endDate: null,
        effortHours: 0,
        value: 0,
        currency: 'GBP',
        scope: '',
        exclusions: '',
        acceptanceCriteria: '',
        createdBy: existing?.createdBy ?? by,
        createdAt: existing?.createdAt ?? a.now,
        updatedBy: existing ? by : null,
        updatedAt: existing ? a.now : null,
        deletedAt: null,
      }
      // Built in three layers so the last word is unambiguous: defaults, then whatever is
      // stored, then the patch — and finally the identity fields again, because a patch is a
      // set of edits and must never be able to move a record onto another engagement.
      const next: Sow = {
        ...blank,
        ...existing,
        ...a.patch,
        id,
        engagementId: a.engagementId,
      }
      const problem = checkSow(next)
      if (problem) return { state, error: problem.message }

      /**
       * One reference per engagement, checked here because the database checks it too.
       *
       * A constraint the schema enforces and the reducer does not is the worst kind: the
       * browser accepts the record, the mirror keeps it, and the write fails on a machine
       * nobody is looking at. Every rule the database holds should be refused here first, in
       * words, while there is still somebody to read them.
       */
      const clash = Object.values(state.sows).find(
        (s) =>
          s.id !== id &&
          !s.deletedAt &&
          s.engagementId === a.engagementId &&
          s.reference.trim().toLowerCase() === next.reference.trim().toLowerCase(),
      )
      if (clash) {
        return { state, error: `${clash.reference} is already recorded against this engagement.` }
      }

      /**
       * A baseline that moves is a variation, and it is recorded as one.
       *
       * Changing agreed effort or value on a signed SOW is exactly the event a firm argues
       * about six months later, so the audit entry carries both figures either side rather
       * than the generic "updated".
       */
      let audit = state.audit
      if (existing) {
        for (const key of ['effortHours', 'value', 'status'] as const) {
          if (existing[key] !== next[key]) {
            audit = log(
              actor,
              { ...state, audit },
              {
                rowId: a.engagementId,
                field: `sow.${key}`,
                from: String(existing[key]),
                to: String(next[key]),
                at: a.now,
                by,
                reason: `${next.reference} — ${next.title}`,
              },
            )
          }
        }
      } else {
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: a.engagementId,
            field: 'sow',
            from: '',
            to: `${next.reference} — ${next.effortHours}h, ${next.currency} ${next.value}`,
            at: a.now,
            by,
          },
        )
      }

      return {
        state: { ...state, sows: { ...state.sows, [id]: next }, seq, audit },
        message: existing ? 'Statement of work saved.' : `${next.reference} recorded.`,
      }
    }

    case 'archiveSow': {
      const sow = state.sows[a.id]
      if (!sow) return { state, error: 'That statement of work no longer exists.' }
      const attached = Object.values(state.nodes).filter((n) => n.sowId === a.id && !n.deletedAt)
      if (attached.length) {
        return {
          state,
          error: `${attached.length} project(s) are delivered under this. Detach them first — an archived contract with live work under it is a record nobody can reconcile.`,
        }
      }
      return {
        state: {
          ...state,
          sows: { ...state.sows, [a.id]: { ...sow, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: sow.engagementId,
            field: 'sow',
            from: sow.reference,
            to: '(archived)',
            at: a.now,
            by,
          }),
        },
        message: 'Statement of work archived.',
      }
    }

    case 'attributeToSow': {
      const node = state.nodes[a.nodeId]
      if (!node) return { state, error: 'That record no longer exists.' }
      if (node.kind !== 'project') {
        return { state, error: 'Work is attributed by project, so the statement of work goes on the project.' }
      }
      if (a.sowId) {
        const sow = state.sows[a.sowId]
        if (!sow || sow.deletedAt) return { state, error: 'That statement of work no longer exists.' }
        // The engagement has to match, or consumption would count work the contract never covered.
        const chain = scopeChainOf(state, a.nodeId)
        if (!chain.includes(sow.engagementId)) {
          return { state, error: `${sow.reference} belongs to a different engagement.` }
        }
        if (!LIVE_SOW_STATUSES.includes(sow.status)) {
          return { state, error: `${sow.reference} is ${sow.status.toLowerCase()}. Work cannot be delivered under it yet.` }
        }
      }
      const was = node.sowId ? state.sows[node.sowId]?.reference ?? node.sowId : ''
      const now = a.sowId ? state.sows[a.sowId]!.reference : ''
      return {
        state: {
          ...state,
          nodes: { ...state.nodes, [a.nodeId]: { ...node, sowId: a.sowId } },
          audit: log(actor, state, {
            rowId: a.nodeId,
            field: 'sow',
            from: was,
            to: now,
            at: a.now,
            by,
          }),
        },
        message: a.sowId ? 'Attributed.' : 'Detached from the statement of work.',
      }
    }

    /* ---------------- CAPACITY ---------------- */

    case 'upsertAllocation': {
      const project = state.nodes[a.projectId]
      if (!project || project.kind !== 'project') {
        return { state, error: 'People are allocated to a project.' }
      }
      const problem = checkAllocation(a)
      if (problem) return { state, error: problem.message }

      const existing = a.id ? state.allocations[a.id] : null
      if (a.id && !existing) return { state, error: 'That allocation no longer exists.' }

      const seq = existing ? state.seq : state.seq + 1
      const id = existing?.id ?? `alloc-${seq}`
      const next: Allocation = {
        id,
        person: a.person.trim(),
        projectId: a.projectId,
        startDate: a.startDate,
        endDate: a.endDate,
        percentage: a.percentage,
        note: a.note.trim(),
        createdBy: existing?.createdBy ?? by,
        createdAt: existing?.createdAt ?? a.now,
        deletedAt: null,
      }

      /**
       * Is there time for this?
       *
       * Checked against the person's whole window rather than this project's share of it,
       * because the conflict a delivery manager needs to see is with the *other* projects —
       * an allocation that fits inside this project's plan and still cannot be delivered is
       * exactly the surprise this exists to prevent.
       */
      const others = Object.values(state.allocations).filter((x) => x.id !== id)
      const profile = profileFor(state, next.person)
      const position = capacityFor(
        next.person,
        profile,
        Object.values(state.commitments),
        [...others, next],
        a.startDate,
        a.endDate,
      )
      if (position.overallocated && !a.acceptOverallocation) {
        return {
          state,
          error: `${describeCapacity(position)} Commit it anyway if that is the decision — it will be recorded as one.`,
        }
      }

      return {
        state: {
          ...state,
          allocations: { ...state.allocations, [id]: next },
          seq,
          audit: log(actor, state, {
            rowId: a.projectId,
            field: 'allocation',
            from: existing ? `${existing.person} ${existing.percentage}%` : '',
            to: `${next.person} ${next.percentage}% ${next.startDate} → ${next.endDate}`,
            at: a.now,
            by,
            reason: position.overallocated
              ? `Deliberately overallocated: ${describeCapacity(position)}`
              : undefined,
          }),
        },
        message: position.overallocated
          ? `Committed, and ${next.person} is now over capacity.`
          : 'Committed.',
      }
    }

    case 'removeAllocation': {
      const alloc = state.allocations[a.id]
      if (!alloc) return { state, error: 'That allocation no longer exists.' }
      return {
        state: {
          ...state,
          allocations: { ...state.allocations, [a.id]: { ...alloc, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: alloc.projectId,
            field: 'allocation',
            from: `${alloc.person} ${alloc.percentage}%`,
            to: '(released)',
            at: a.now,
            by,
          }),
        },
        message: 'Released.',
      }
    }

    case 'upsertCommitment': {
      if (!a.person.trim()) return { state, error: 'Time off belongs to somebody.' }
      if (!a.startDate || !a.endDate) return { state, error: 'A period needs a start and an end.' }
      if (a.endDate < a.startDate) return { state, error: 'The end date falls before the start date.' }
      if (!Number.isFinite(a.hoursPerDay) || a.hoursPerDay <= 0) {
        return { state, error: 'How many hours a day does this take?' }
      }

      const existing = a.id ? state.commitments[a.id] : null
      if (a.id && !existing) return { state, error: 'That record no longer exists.' }
      const seq = existing ? state.seq : state.seq + 1
      const id = existing?.id ?? `commit-${seq}`
      const next: Commitment = {
        id,
        person: a.person.trim(),
        kind: a.kind,
        startDate: a.startDate,
        endDate: a.endDate,
        hoursPerDay: a.hoursPerDay,
        note: a.note.trim(),
        createdBy: existing?.createdBy ?? by,
        createdAt: existing?.createdAt ?? a.now,
        deletedAt: null,
      }

      /**
       * Booking leave can push somebody over on work already committed, and that is worth
       * saying rather than refusing: the leave is not the problem, the plan around it is.
       */
      const position = capacityFor(
        next.person,
        profileFor(state, next.person),
        [...Object.values(state.commitments).filter((c) => c.id !== id), next],
        Object.values(state.allocations),
        a.startDate,
        a.endDate,
      )

      return {
        state: {
          ...state,
          commitments: { ...state.commitments, [id]: next },
          seq,
          audit: log(actor, state, {
            rowId: 'CAPACITY',
            field: 'commitment',
            from: existing ? `${existing.kind} ${existing.startDate}→${existing.endDate}` : '',
            to: `${next.person}: ${next.kind} ${next.startDate}→${next.endDate}`,
            at: a.now,
            by,
          }),
        },
        message: position.overallocated
          ? `Recorded. ${describeCapacity(position)}`
          : 'Recorded.',
      }
    }

    case 'removeCommitment': {
      const c = state.commitments[a.id]
      if (!c) return { state, error: 'That record no longer exists.' }
      return {
        state: {
          ...state,
          commitments: { ...state.commitments, [a.id]: { ...c, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: 'CAPACITY',
            field: 'commitment',
            from: `${c.person}: ${c.kind}`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: 'Removed.',
      }
    }

    /* ---------------- CONFIGURATION ---------------- */
    case 'config':
      return applyConfig(state, a.op, a.now, actor)

    /**
     * Record what is known about an engagement.
     *
     * Only the recorded fields — nothing derived is accepted here, because everything derived
     * is computed from the issues on every render and a stored copy could only ever be stale.
     */
    case 'updateEngagement': {
      const node = state.nodes[a.nodeId]
      if (!node || node.deletedAt) return { state, error: 'That engagement no longer exists.' }
      if (node.kind !== 'engagement') {
        return { state, error: `${node.name} is a ${node.kind}, not an engagement.` }
      }
      const current =
        state.engagements[a.nodeId] ?? blankEngagement(a.nodeId, node.parentId?.split(':')[1] ?? '')

      const next: EngagementDetail = { ...current, ...a.patch, nodeId: a.nodeId }
      if (next.startDate && next.endDate && next.endDate < next.startDate) {
        return { state, error: 'The end date falls before the start date.' }
      }

      const changed = Object.keys(a.patch).filter(
        (k) =>
          (current as unknown as Record<string, unknown>)[k] !==
          (next as unknown as Record<string, unknown>)[k],
      )
      if (!changed.length) return { state }

      let audit = state.audit
      for (const k of changed) {
        audit = log(
          actor,
          { ...state, audit },
          {
            rowId: a.nodeId,
            field: k,
            from: String((current as unknown as Record<string, unknown>)[k] ?? '') || '(not recorded)',
            to: String((next as unknown as Record<string, unknown>)[k] ?? '') || '(cleared)',
            at: a.now,
            by,
          },
        )
      }

      return {
        state: {
          ...state,
          engagements: {
            ...state.engagements,
            [a.nodeId]: { ...next, updatedAt: a.now, updatedBy: by },
          },
          audit,
        },
        message: `${node.name} updated.`,
      }
    }

    case 'setAssignment': {
      const issue = state.issues[a.issueId]
      if (!issue) return { state, error: 'Issue not found.' }
      const type = state.model.responsibilities[a.responsibilityId]
      if (!type || type.deletedAt) return { state, error: 'That responsibility no longer exists.' }

      const values = a.values.map((v) => v.trim()).filter(Boolean)
      const check = checkAssignment(state.model, type, values, scopeChainOf(state, a.issueId))
      if (!check.ok) return { state, error: check.errors[0] }

      // Seeded responsibilities write to their own column so the grid, filters, sort and the
      // assistant keep seeing them; everything else lands in the assignments map.
      const next = { ...issue, lastActivity: a.now.slice(0, 10) }
      const before = readAssignment(issue, type)
      if (type.systemField) {
        const v = values[0] ?? ''
        if (type.systemField === 'owner') next.owner = v || 'Unassigned'
        else if (type.systemField === 'accountable') next.accountable = (v || 'Unassigned') as AccountableParty
        else next.raisedBy = v
      } else {
        next.assignments = { ...issue.assignments, [type.id]: values }
      }

      const after = readAssignment(next, type)
      if (before.join(', ') === after.join(', ')) return { state }

      /**
       * And are the people being named there to do it?
       *
       * Only the names being *added* — the ones already holding the responsibility were judged
       * when they were given it, and re-judging them here would refuse removing a second
       * reviewer because the first is on leave.
       *
       * Every person-valued responsibility, not just Owner. A firm that adds "Technical lead"
       * has made it a way of putting work on somebody, and a check that only knew about the
       * three seeded fields would go quiet exactly when the model was configured properly.
       */
      const verdicts =
        type.valueKind === 'person'
          ? after
              .filter((v) => !before.includes(v))
              .map((v) => availabilityForAssignment(state, next, v, a.now))
          : []
      const away = verdicts.find(refusesAssignment)
      if (away && !a.acceptUnavailable) {
        return {
          state,
          error: `${away.message} Assign it anyway if that is the decision — it will be recorded as one.`,
        }
      }
      const notes = verdicts.map(availabilityNote).filter(Boolean).join(' ')

      return {
        state: {
          ...state,
          issues: { ...state.issues, [a.issueId]: next },
          audit: log(actor, state, {
            rowId: a.issueId,
            field: type.label,
            from: before.join(', ') || '—',
            to: after.join(', ') || '—',
            at: a.now,
            by,
            reason: notes || undefined,
          }),
        },
        message: notes ? `${type.label} updated. ${notes}` : `${type.label} updated.`,
      }
    }

    default:
      return { state }
  }
}

/** Current values of a responsibility on an issue, whichever side of the split it lives on. */
export function readAssignment(issue: IssueRecord, type: ResponsibilityType): string[] {
  if (type.systemField) {
    const v = issue[type.systemField]
    return v && v !== 'Unassigned' ? [v] : []
  }
  return issue.assignments?.[type.id] ?? []
}

/* ================================================================== *
 * Configuration reducer
 * ================================================================== */

/** Mutate one scope's override block, creating it on demand. */
function withOverride(
  model: OperatingModel,
  scopeId: string,
  fn: (o: ReturnType<typeof emptyOverride>) => ReturnType<typeof emptyOverride>,
): OperatingModel {
  const current = model.overrides[scopeId] ?? emptyOverride()
  return { ...model, overrides: { ...model.overrides, [scopeId]: fn({ ...current }) } }
}

function applyConfig(state: WorkspaceState, op: ConfigOp, now: string, actor: Actor): OpResult {
  const by = actor.name
  const m = state.model
  const scopeName = (id: string) => (id === ROOT_SCOPE ? 'the organisation' : nameOf(state, id))
  const done = (model: OperatingModel, entry: Omit<AuditEntry, 'id'>, message: string): OpResult => ({
    state: { ...state, model, audit: log(actor, state, entry) },
    message,
  })

  switch (op.k) {
    case 'setLabel': {
      const key = op.key
      const label = op.label.trim()
      const previous = m.overrides[op.scopeId]?.labels?.[key] ?? ''
      if (previous === label) return { state }
      const model = withOverride(m, op.scopeId, (o) => {
        const labels = { ...o.labels }
        // An empty label is not a blank name — it removes the override entirely so the
        // parent scope (and ultimately the shipped default) shows through again.
        if (label) labels[key] = label
        else delete labels[key]
        return { ...o, labels }
      })
      return done(
        model,
        {
          rowId: op.scopeId,
          field: `label:${key}`,
          from: previous || '(inherited)',
          to: label || '(inherited)',
          at: now,
          by,
          reason: `Terminology for ${scopeName(op.scopeId)}.`,
        },
        label ? `“${key}” now reads “${label}”.` : 'Term reset to the inherited value.',
      )
    }

    case 'upsertRole': {
      const label = op.label.trim()
      if (!label) return { state, error: 'A role needs a name.' }
      const id = op.id ?? `ROLE_${m.seq}`
      const existing = m.roles[id]
      const role: OrgRole = {
        id,
        label,
        description: op.description.trim(),
        seeded: existing?.seeded ?? false,
        deletedAt: null,
      }
      return done(
        { ...m, roles: { ...m.roles, [id]: role }, seq: m.seq + (op.id ? 0 : 1) },
        {
          rowId: id,
          field: 'role',
          from: existing?.label ?? null,
          to: label,
          at: now,
          by,
        },
        existing ? `Role “${label}” updated.` : `Role “${label}” added.`,
      )
    }

    case 'deleteRole': {
      const role = m.roles[op.id]
      if (!role) return { state, error: 'Role not found.' }
      if (role.seeded) {
        return { state, error: `“${role.label}” is a built-in role. Rename it rather than removing it.` }
      }
      const used = Object.values(m.people).filter((p) => p.roleIds.includes(op.id))
      if (used.length) {
        return {
          state,
          error: `${used.length} ${used.length === 1 ? 'person holds' : 'people hold'} “${role.label}”. Reassign them first.`,
        }
      }
      return done(
        { ...m, roles: { ...m.roles, [op.id]: { ...role, deletedAt: now } } },
        { rowId: op.id, field: 'role', from: role.label, to: '(archived)', at: now, by },
        `Role “${role.label}” archived.`,
      )
    }

    case 'setSizeBands': {
      const problems = bandProblems(op.bands)
      // Refused rather than warned about: a calibration with a gap produces scores that map to
      // no size at all, and the estimate screen would have nothing to show for them.
      if (problems.length) return { state, error: problems[0] }
      for (const b of op.bands) {
        if (b.storyPoints < 0 || b.effortHours < 0) {
          return { state, error: `${b.size}: story points and hours cannot be negative.` }
        }
      }
      return done(
        { ...m, sizeBands: op.bands },
        { rowId: 'SIZE_BANDS', field: 'sizeBands', from: `${m.sizeBands.length} sizes`, to: `${op.bands.length} sizes`, at: now, by },
        'T-shirt sizing updated.',
      )
    }

    case 'setWatch': {
      const next: WatchPolicy = { ...m.watch, ...op.patch }
      if (!Number.isInteger(next.staleAfterDays) || next.staleAfterDays < 1 || next.staleAfterDays > 365) {
        return { state, error: 'Staleness is a whole number of days between 1 and 365.' }
      }
      if (!Number.isInteger(next.warnBeforeDays) || next.warnBeforeDays < 0 || next.warnBeforeDays > 60) {
        return { state, error: 'The warning window is a whole number of days between 0 and 60.' }
      }
      return done(
        { ...m, watch: next },
        {
          rowId: 'WATCH',
          field: 'watch',
          from: `${m.watch.enabled ? 'on' : 'off'}, ${m.watch.conditions.length} conditions`,
          to: `${next.enabled ? 'on' : 'off'}, ${next.conditions.length} conditions`,
          at: now,
          by,
        },
        next.enabled ? 'Scheduled pass updated.' : 'The scheduled pass will not run.',
      )
    }

    case 'setResourceProfile': {
      const person = m.people[op.personId]
      if (!person) return { state, error: 'That person is not in the directory.' }
      const existing = m.resourceProfiles[op.personId]
      const next: ResourceProfile = {
        ...defaultProfile(op.personId),
        ...existing,
        ...op.patch,
        // Last, because a patch describes a week rather than whose it is.
        personId: op.personId,
      }
      if (next.hoursPerDay <= 0 || next.hoursPerDay > 24) {
        return { state, error: 'A working day is between 0 and 24 hours.' }
      }
      if (next.daysPerWeek <= 0 || next.daysPerWeek > 7) {
        return { state, error: 'A working week is between 0 and 7 days.' }
      }
      if (next.billableTargetPct < 0 || next.billableTargetPct > 100) {
        return { state, error: 'A billable target is a percentage.' }
      }
      return done(
        { ...m, resourceProfiles: { ...m.resourceProfiles, [op.personId]: next } },
        {
          rowId: 'CAPACITY',
          field: 'resourceProfile',
          from: existing ? `${existing.hoursPerDay}h × ${existing.daysPerWeek}d` : '(default)',
          to: `${next.hoursPerDay}h × ${next.daysPerWeek}d`,
          at: now,
          by,
        },
        `${person.name}'s week updated.`,
      )
    }

    case 'setAutomationRules': {
      for (const r of op.rules) {
        if (!r.label.trim()) return { state, error: 'A rule needs a name.' }
        if (!r.then.length) return { state, error: `“${r.label}” does nothing.` }
      }
      return done(
        { ...m, automationRules: op.rules },
        {
          rowId: 'AUTOMATION_RULES',
          field: 'automationRules',
          from: `${m.automationRules.filter((r) => r.enabled).length} firing`,
          to: `${op.rules.filter((r) => r.enabled).length} firing`,
          at: now,
          by,
        },
        'Automation updated.',
      )
    }

    case 'setApprovalRules': {
      const problems = ruleProblems(op.rules)
      if (problems.length) return { state, error: problems[0] }
      return done(
        { ...m, approvalRules: op.rules },
        {
          rowId: 'APPROVAL_RULES',
          field: 'approvalRules',
          from: `${m.approvalRules.filter((r) => r.enabled).length} in force`,
          to: `${op.rules.filter((r) => r.enabled).length} in force`,
          at: now,
          by,
        },
        'Approval rules updated.',
      )
    }

    case 'setAccess': {
      const next: AccessPolicy = {
        ...m.access,
        ...op.patch,
        grants: { ...m.access.grants, ...(op.patch.grants ?? {}) },
      }
      const roleIdsWithHolders = Object.values(m.people)
        .flatMap((p) => p.roleIds)
        .filter((id) => m.roles[id] && !m.roles[id].deletedAt)
      const problems = accessProblems(next, roleIdsWithHolders)
      // Refused rather than warned about, and one of the checks is self-preservation: a change
      // that leaves nobody able to configure the platform would also leave nobody able to undo
      // it, and the screen that could fix it is the screen it locks.
      if (problems.length) return { state, error: problems[0] }

      const count = (p: AccessPolicy) =>
        Object.values(p.grants).reduce((n, k) => n + k.length, 0)
      return done(
        { ...m, access: next },
        { rowId: 'ACCESS', field: 'access', from: `${next.enforced ? '' : 'was '}${count(m.access)} grants`, to: `${count(next)} grants, ${next.enforced ? 'enforced' : 'advisory'}`, at: now, by },
        next.enforced ? 'Permissions updated.' : 'Permissions are now advisory.',
      )
    }

    case 'setStatusPolicy': {
      const next: StatusPolicy = {
        ...m.statusPolicy,
        ...op.patch,
        transitions: { ...m.statusPolicy.transitions, ...(op.patch.transitions ?? {}) },
      }
      // Refused rather than warned about, like the size bands: a graph with no route to a
      // closing status produces work that can never be finished, and the person who edited it
      // finds out weeks later from somebody who cannot close an issue.
      const problems = policyProblems(next)
      if (problems.length) return { state, error: problems[0] }

      const was = m.statusPolicy
      const describe = (p: StatusPolicy) =>
        `${p.enforced ? 'enforced' : 'advisory'}, ${Object.values(p.transitions).reduce((n, t) => n + t.length, 0)} routes`
      return done(
        { ...m, statusPolicy: next },
        { rowId: 'STATUS_POLICY', field: 'statusPolicy', from: describe(was), to: describe(next), at: now, by },
        next.enforced ? 'Status transitions updated.' : 'Status transitions are now advisory.',
      )
    }

    case 'setSla': {
      const next = { ...m.sla, ...op.patch }
      /**
       * Validated rather than trusted, because these numbers now decide what a status report
       * calls overdue. A zero would make every issue overdue on the day it was raised; a
       * fractional or negative value would move targets backwards through `addWorkingDays`
       * and produce due dates before the raise date.
       */
      for (const [sev, days] of Object.entries(next)) {
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          return {
            state,
            error: `${sev} must be a whole number of working days between 1 and 365.`,
          }
        }
      }
      const before = `High ${m.sla.High} / Medium ${m.sla.Medium} / Low ${m.sla.Low}`
      const after = `High ${next.High} / Medium ${next.Medium} / Low ${next.Low}`
      if (before === after) return { state, message: 'Nothing changed.' }
      return done(
        { ...m, sla: next },
        { rowId: 'SLA', field: 'sla', from: before, to: after, at: now, by },
        `Service levels updated — ${after}.`,
      )
    }

    case 'upsertWorkType': {
      const label = op.label.trim()
      if (!label) return { state, error: 'A work type needs a name.' }
      const id = op.id ?? `WT_${m.seq}`
      const existing = m.workTypes[id]
      // Two types with one name would make the filter ambiguous and the assistant's choice
      // arbitrary, so the name is the thing that must stay unique — not just the key.
      const clash = liveWorkTypes(m).find(
        (t) => t.id !== id && t.label.toLowerCase() === label.toLowerCase(),
      )
      if (clash) return { state, error: `A work type called "${clash.label}" already exists.` }
      const workType: WorkType = {
        id,
        label,
        description: op.description.trim(),
        fromSource: existing?.fromSource ?? false,
        deletedAt: null,
      }
      return done(
        { ...m, workTypes: { ...m.workTypes, [id]: workType }, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'workType', from: existing?.label ?? null, to: label, at: now, by },
        existing ? `Work type "${label}" updated.` : `Work type "${label}" added.`,
      )
    }

    case 'deleteWorkType': {
      const workType = m.workTypes[op.id]
      if (!workType) return { state, error: 'Work type not found.' }
      // Archiving a type that records still carry would leave those records classified as
      // something the workspace no longer offers — invisible to the filter, and unexplained.
      const used = Object.values(state.issues).filter(
        (i) => !i.deletedAt && i.type === workType.label,
      )
      if (used.length) {
        return {
          state,
          error: `${used.length} ${used.length === 1 ? 'record is' : 'records are'} classified as "${workType.label}". Reclassify them first.`,
        }
      }
      return done(
        { ...m, workTypes: { ...m.workTypes, [op.id]: { ...workType, deletedAt: now } } },
        { rowId: op.id, field: 'workType', from: workType.label, to: '(archived)', at: now, by },
        `Work type "${workType.label}" archived.`,
      )
    }

    case 'upsertPerson': {
      const name = op.name.trim()
      if (!name) return { state, error: 'A person needs a name.' }
      const id = op.id ?? `PERSON_${m.seq}`
      const existing = m.people[id]
      const clash = Object.values(m.people).find((p) => p.id !== id && p.name === name)
      if (clash) return { state, error: `“${name}” is already in the directory.` }
      const email = op.email?.trim().toLowerCase()
      // Two people cannot share an address, and the check is worth having precisely because
      // this is the field a signed-in person is matched on.
      const sameEmail = email
        ? Object.values(m.people).find((p) => p.id !== id && p.email?.toLowerCase() === email)
        : undefined
      if (sameEmail) return { state, error: `${sameEmail.name} already has that address.` }

      const person: Person = {
        id,
        name,
        roleIds: op.roleIds.filter((r) => m.roles[r] && !m.roles[r].deletedAt),
        fromSource: existing?.fromSource ?? false,
        // Undefined when cleared rather than an empty string, so "no address recorded" is one
        // state rather than two that compare unequal.
        ...(email ? { email } : existing?.email && op.email === undefined ? { email: existing.email } : {}),
      }
      const roleNames = person.roleIds.map((r) => m.roles[r].label).join(', ') || 'no role'
      return done(
        { ...m, people: { ...m.people, [id]: person }, seq: m.seq + (op.id ? 0 : 1) },
        {
          rowId: id,
          field: 'person',
          from: existing ? `${existing.name} — ${existing.roleIds.map((r) => m.roles[r]?.label ?? r).join(', ') || 'no role'}` : null,
          to: `${name} — ${roleNames}`,
          at: now,
          by,
        },
        existing ? `${name} updated.` : `${name} added to the directory.`,
      )
    }

    case 'deletePerson': {
      const person = m.people[op.id]
      if (!person) return { state, error: 'Person not found.' }
      const people = { ...m.people }
      delete people[op.id]
      return done(
        { ...m, people },
        { rowId: op.id, field: 'person', from: person.name, to: '(removed)', at: now, by },
        `${person.name} removed from the directory.`,
      )
    }

    case 'upsertResponsibility': {
      const id = op.id ?? `RESP_${m.seq}`
      const existing = m.responsibilities[id]
      const label = (op.patch.label ?? existing?.label ?? '').trim()
      if (!label) return { state, error: 'A responsibility needs a name.' }

      const maxCount = op.patch.maxCount === undefined ? (existing?.maxCount ?? 1) : op.patch.maxCount
      const minCount = op.patch.minCount ?? existing?.minCount ?? 0
      if (maxCount != null && maxCount < 1) return { state, error: 'The maximum must be at least 1.' }
      if (maxCount != null && minCount > maxCount) {
        return { state, error: 'The minimum cannot exceed the maximum.' }
      }

      const type: ResponsibilityType = {
        id,
        label,
        description: op.patch.description ?? existing?.description ?? '',
        // A seeded responsibility is bound to a column; changing its value kind would
        // silently reinterpret 179 stored values, so the binding is fixed.
        valueKind: existing?.seeded ? existing.valueKind : (op.patch.valueKind ?? existing?.valueKind ?? 'person'),
        minCount,
        maxCount,
        required: op.patch.required ?? existing?.required ?? false,
        eligibleRoleIds: op.patch.eligibleRoleIds ?? existing?.eligibleRoleIds ?? [],
        systemField: existing?.systemField ?? null,
        seeded: existing?.seeded ?? false,
        order: op.patch.order ?? existing?.order ?? Object.keys(m.responsibilities).length,
        deletedAt: null,
      }
      return done(
        { ...m, responsibilities: { ...m.responsibilities, [id]: type }, seq: m.seq + (op.id ? 0 : 1) },
        {
          rowId: id,
          field: 'responsibility',
          from: existing ? describeResponsibility(m, existing) : null,
          to: describeResponsibility(m, type),
          at: now,
          by,
        },
        existing ? `“${label}” updated.` : `Responsibility “${label}” added.`,
      )
    }

    case 'deleteResponsibility': {
      const type = m.responsibilities[op.id]
      if (!type) return { state, error: 'Responsibility not found.' }
      if (type.seeded) {
        return {
          state,
          error: `“${type.label}” is backed by a column on every issue. Rename it rather than removing it.`,
        }
      }
      const assigned = Object.values(state.issues).filter((i) => (i.assignments?.[op.id] ?? []).length)
      return done(
        { ...m, responsibilities: { ...m.responsibilities, [op.id]: { ...type, deletedAt: now } } },
        {
          rowId: op.id,
          field: 'responsibility',
          from: type.label,
          to: '(archived)',
          at: now,
          by,
          reason: assigned.length ? `${assigned.length} issues still hold values for it; they are kept.` : undefined,
        },
        `“${type.label}” archived.`,
      )
    }

    case 'setOrganization': {
      const org = { ...m.organization, ...op.patch }
      const name = org.name.trim()
      if (!name) return { state, error: 'The organisation needs a name.' }
      /**
       * `partyCode` is a stored value on the imported issues, not a label. Changing it while
       * rows carry it would leave every one of them pointing at a party that does not exist.
       *
       * The message says what is actually true rather than offering a route. `setParties` has
       * the mirror-image guard — it refuses to drop a party that is still assigned — so with
       * issues on the books both doors are correctly locked, and pointing at the other one
       * would send someone to a screen that rejects them for the same reason.
       */
      if (op.patch.partyCode && op.patch.partyCode !== m.organization.partyCode) {
        const inUse = Object.values(state.issues).filter(
          (i) => i.accountable === m.organization.partyCode,
        ).length
        if (inUse) {
          return {
            state,
            error: `${inUse} issues are recorded against “${m.organization.partyCode}”, so that code cannot change. Reassign them to another party first. The display name above can be changed freely.`,
          }
        }
      }
      const unchanged =
        org.name === m.organization.name &&
        org.shortName === m.organization.shortName &&
        org.description === m.organization.description &&
        org.partyCode === m.organization.partyCode
      if (unchanged) return { state }

      return done(
        { ...m, organization: { ...org, name } },
        {
          rowId: ROOT_SCOPE,
          field: 'organization',
          from: m.organization.name,
          to: name,
          at: now,
          by,
        },
        `This workspace now belongs to ${name}.`,
      )
    }

    case 'setParties': {
      const parties = [...new Set(op.parties.map((p) => p.trim()).filter(Boolean))]
      if (!parties.length) return { state, error: 'At least one party is needed.' }
      const inUse = new Set(Object.values(state.issues).map((i) => i.accountable))
      const missing = [...inUse].filter((p) => p && p !== 'Unassigned' && !parties.includes(p))
      if (missing.length) {
        return {
          state,
          error: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still assigned on existing issues and cannot be removed.`,
        }
      }
      return done(
        { ...m, parties },
        {
          rowId: ROOT_SCOPE,
          field: 'parties',
          from: m.parties.join(', '),
          to: parties.join(', '),
          at: now,
          by,
        },
        'Accountable parties updated.',
      )
    }

    case 'setAgent': {
      const agent = m.agents[op.id]
      if (!agent) return { state, error: 'Agent not found.' }
      const next = { ...agent, ...op.patch }
      // The ceiling comes from what the build implements, never from stored settings.
      if (op.patch.autonomy) next.autonomy = clampToMax(op.patch.autonomy, agent.maxAutonomy)
      const from = `${agent.enabled ? 'on' : 'off'} · ${agent.autonomy}${agent.requireApproval ? ' · approval required' : ''}`
      const to = `${next.enabled ? 'on' : 'off'} · ${next.autonomy}${next.requireApproval ? ' · approval required' : ''}`
      if (from === to) return { state }
      return done(
        { ...m, agents: { ...m.agents, [op.id]: next } },
        { rowId: op.id, field: 'agent', from, to, at: now, by },
        `${agent.name}: ${to}.`,
      )
    }

    case 'setWorkflowEnabled': {
      const wf = m.workflows[op.id]
      if (!wf) return { state, error: 'Workflow not found.' }
      if (wf.runtime === 'declared' && op.enabled) {
        return {
          state,
          error: `“${wf.name}” has no runtime in this build, so enabling it would do nothing.`,
        }
      }
      return done(
        { ...m, workflows: { ...m.workflows, [op.id]: { ...wf, enabled: op.enabled } } },
        {
          rowId: op.id,
          field: 'workflow',
          from: wf.enabled ? 'on' : 'off',
          to: op.enabled ? 'on' : 'off',
          at: now,
          by,
        },
        `${wf.name} ${op.enabled ? 'enabled' : 'disabled'}.`,
      )
    }

    case 'setScopeAgent': {
      const agent = m.agents[op.agentId]
      if (!agent) return { state, error: 'Agent not found.' }
      const model = withOverride(m, op.scopeId, (o) => {
        const agentEnabled = { ...o.agentEnabled }
        if (op.value === null) delete agentEnabled[op.agentId]
        else agentEnabled[op.agentId] = op.value
        return { ...o, agentEnabled }
      })
      return done(
        model,
        {
          rowId: op.scopeId,
          field: `agent:${op.agentId}`,
          from: null,
          to: op.value === null ? '(inherited)' : op.value ? 'on' : 'off',
          at: now,
          by,
          reason: `${agent.name} for ${scopeName(op.scopeId)}.`,
        },
        op.value === null
          ? `${agent.name} follows the parent scope again.`
          : `${agent.name} ${op.value ? 'on' : 'off'} for ${scopeName(op.scopeId)}.`,
      )
    }

    case 'setScopeRequired': {
      const type = m.responsibilities[op.responsibilityId]
      if (!type) return { state, error: 'Responsibility not found.' }
      const model = withOverride(m, op.scopeId, (o) => {
        const responsibilityRequired = { ...o.responsibilityRequired }
        if (op.value === null) delete responsibilityRequired[op.responsibilityId]
        else responsibilityRequired[op.responsibilityId] = op.value
        return { ...o, responsibilityRequired }
      })
      return done(
        model,
        {
          rowId: op.scopeId,
          field: `required:${op.responsibilityId}`,
          from: null,
          to: op.value === null ? '(inherited)' : op.value ? 'required' : 'optional',
          at: now,
          by,
          reason: `${type.label} for ${scopeName(op.scopeId)}.`,
        },
        `${type.label} is now ${op.value === null ? 'inherited' : op.value ? 'required' : 'optional'} for ${scopeName(op.scopeId)}.`,
      )
    }

    case 'adoptTemplate': {
      const tpl = op.templateId ? m.templates[op.templateId] : null
      if (op.templateId && !tpl) return { state, error: 'Template not found.' }
      let model = withOverride(m, op.scopeId, (o) => ({ ...o, templateId: op.templateId }))
      if (tpl) {
        // Adopting a template writes explicit per-agent enablement at this scope, so the
        // effect is visible and individually adjustable afterwards rather than magic.
        model = withOverride(model, op.scopeId, (o) => {
          const agentEnabled = { ...o.agentEnabled }
          for (const id of Object.keys(m.agents)) agentEnabled[id] = tpl.agentIds.includes(id)
          return { ...o, agentEnabled }
        })
      }
      return done(
        model,
        {
          rowId: op.scopeId,
          field: 'template',
          from: m.overrides[op.scopeId]?.templateId ?? '(none)',
          to: tpl?.name ?? '(none)',
          at: now,
          by,
          reason: tpl ? `Enabled ${tpl.agentIds.length} agents for ${scopeName(op.scopeId)}.` : undefined,
        },
        tpl ? `${scopeName(op.scopeId)} now follows “${tpl.name}”.` : 'Template cleared.',
      )
    }

    case 'upsertRoutingRule': {
      const id = op.id ?? `RULE_${m.seq}`
      const existing = m.routingRules.find((r) => r.id === id)
      const name = (op.patch.name ?? existing?.name ?? '').trim()
      if (!name) return { state, error: 'A rule needs a name.' }
      const rule: RoutingRule = {
        id,
        name,
        when: op.patch.when ?? existing?.when ?? { module: '', severity: '', keyword: '' },
        then: op.patch.then ?? existing?.then ?? { responsibilityTypeId: 'ISSUE_OWNER', value: '' },
        enabled: op.patch.enabled ?? existing?.enabled ?? true,
        order: op.patch.order ?? existing?.order ?? m.routingRules.length,
      }
      if (!rule.then.value.trim()) return { state, error: 'A rule needs a value to assign.' }
      const routingRules = existing
        ? m.routingRules.map((r) => (r.id === id ? rule : r))
        : [...m.routingRules, rule]
      return done(
        { ...m, routingRules, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'routingRule', from: existing?.name ?? null, to: name, at: now, by },
        existing ? `Rule “${name}” updated.` : `Rule “${name}” added.`,
      )
    }

    case 'deleteRoutingRule': {
      const rule = m.routingRules.find((r) => r.id === op.id)
      if (!rule) return { state, error: 'Rule not found.' }
      return done(
        { ...m, routingRules: m.routingRules.filter((r) => r.id !== op.id) },
        { rowId: op.id, field: 'routingRule', from: rule.name, to: '(removed)', at: now, by },
        `Rule “${rule.name}” removed.`,
      )
    }

    case 'upsertIntake': {
      const id = op.id ?? `INBOX_${m.seq}`
      const existing = m.intake.find((i) => i.id === id)
      const address = (op.patch.address ?? existing?.address ?? '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        return { state, error: 'That is not a valid email address.' }
      }
      const clash = m.intake.find((i) => i.id !== id && i.address.toLowerCase() === address.toLowerCase())
      if (clash) return { state, error: `${address} is already configured.` }
      const box: IntakeMailbox = {
        id,
        address,
        scopeId: op.patch.scopeId ?? existing?.scopeId ?? ROOT_SCOPE,
        workflowId: op.patch.workflowId ?? existing?.workflowId ?? null,
        enabled: op.patch.enabled ?? existing?.enabled ?? false,
      }
      const intake = existing ? m.intake.map((i) => (i.id === id ? box : i)) : [...m.intake, box]
      return done(
        { ...m, intake, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'intake', from: existing?.address ?? null, to: address, at: now, by },
        existing ? `${address} updated.` : `${address} configured.`,
      )
    }

    case 'deleteIntake': {
      const box = m.intake.find((i) => i.id === op.id)
      if (!box) return { state, error: 'Mailbox not found.' }
      return done(
        { ...m, intake: m.intake.filter((i) => i.id !== op.id) },
        { rowId: op.id, field: 'intake', from: box.address, to: '(removed)', at: now, by },
        `${box.address} removed.`,
      )
    }

    /**
     * A configuration screen that can rename every term in the product needs a way back.
     * Rebuilt from the live issue log rather than from a stored copy, so the directory is
     * re-seeded the same way a first run would seed it.
     *
     * Issue data is untouched — this resets the operating model, not the work. Values already
     * assigned to responsibility types that no longer exist stay on their issues rather than
     * being scrubbed; the audit note says so.
     */
    case 'resetAll': {
      const owners = [
        ...new Set(Object.values(state.issues).flatMap((i) => [i.owner, i.raisedBy])),
      ]
      const changed =
        Object.keys(m.overrides).length +
        m.routingRules.length +
        m.intake.length +
        Object.values(m.responsibilities).filter((r) => !r.seeded).length
      return done(
        initModel(owners),
        {
          rowId: ROOT_SCOPE,
          field: 'operatingModel',
          from: `${Object.keys(m.roles).length} roles, ${Object.keys(m.responsibilities).length} responsibilities, ${m.routingRules.length} rules`,
          to: '(shipped defaults)',
          at: now,
          by,
          reason: `Reset ${changed} configured items. Issue data was not changed.`,
        },
        'Operating model reset to the shipped defaults.',
      )
    }

    default:
      return { state }
  }
}

const AUTONOMY_RANK: Autonomy[] = ['off', 'suggest', 'propose', 'act']
function clampToMax(want: Autonomy, max: Autonomy): Autonomy {
  return AUTONOMY_RANK.indexOf(want) > AUTONOMY_RANK.indexOf(max) ? max : want
}

function describeResponsibility(m: OperatingModel, t: ResponsibilityType): string {
  const bounds = t.maxCount == null ? `${t.minCount}+` : `${t.minCount}–${t.maxCount}`
  const roles = t.eligibleRoleIds.length
    ? t.eligibleRoleIds.map((r) => m.roles[r]?.label ?? r).join('/')
    : 'any role'
  return `${t.label} · ${t.valueKind} · ${bounds} · ${t.required ? 'required' : 'optional'} · ${roles}`
}

/* ================================================================== *
 * Automation
 * ================================================================== */

export interface RunOutcome {
  state: WorkspaceState
  error?: string
  message?: string
  createdId?: string
  /**
   * Every action this run applied, in order, each with the state either side of it.
   *
   * The first is always the action that was asked for; the rest are what the rules did about
   * it. Pairs rather than a bare list, because the write path persists one action at a time
   * against the change *that action* made — handing it a before and after spanning the whole
   * run would make it guess which rows moved for which reason.
   */
  steps: { action: Action; before: WorkspaceState; after: WorkspaceState }[]
  /** What the rules did, and what they could not. Empty when nothing fired. */
  automation: {
    applied: Action[]
    misses: RuleMiss[]
    /** Actions the rules asked for and the reducer refused, with its reason. */
    refusals: { action: Action; error: string }[]
  }
}

/**
 * Apply an action, then let the rules react to what it changed.
 *
 * This is the funnel both callers use — the browser for the optimistic result and the server
 * for the durable one — and it is deterministic on purpose: the only inputs are the state, the
 * action and the actor, so both arrive at the same follow-up actions and the same minted ids.
 * That is what allows the browser to show a notification immediately while sending the server
 * nothing but the original action.
 *
 * A refused follow-up does not roll back what preceded it. Each action is whole on its own, so
 * a partial run leaves a consistent workspace and a recorded reason — which is a better outcome
 * than an all-or-nothing rule engine that discards a correct notification because a later step
 * was not permitted.
 */
export function applyWithRules(state: WorkspaceState, action: Action, actor: Actor): RunOutcome {
  const first = apply(state, action, actor)
  if (first.error) {
    return { ...first, steps: [], automation: { applied: [], misses: [], refusals: [] } }
  }

  const steps = [{ action, before: state, after: first.state }]
  const events = deriveEvents(state, first.state, action.now, actor.name)
  if (!events.length) {
    return { ...first, steps, automation: { applied: [], misses: [], refusals: [] } }
  }

  const { actions, misses } = planActions(first.state, events, action.now)
  let current = first.state
  const applied: Action[] = []
  const refusals: { action: Action; error: string }[] = []

  for (const step of actions) {
    const result = apply(current, step, actor)
    if (result.error) {
      // Recorded rather than thrown. A rule asking for something the reducer refuses is a
      // configuration problem, and the person who caused the original change is not the person
      // who should be stopped by it.
      refusals.push({ action: step, error: result.error })
      continue
    }
    steps.push({ action: step, before: current, after: result.state })
    current = result.state
    applied.push(step)
  }

  return {
    ...first,
    state: current,
    steps,
    automation: { applied, misses, refusals },
  }
}

/* ================================================================== *
 * The scheduled pass
 * ================================================================== */

export interface WatchRun {
  state: WorkspaceState
  /** What changed since the last pass, including what is merely continuing. */
  diff: WatchDiff
  /** Store this and hand it back next time. It is the whole memory of the pass. */
  observation: Observation
  /** Every action the rules took, paired for the write path exactly as `applyWithRules` does. */
  steps: { action: Action; before: WorkspaceState; after: WorkspaceState }[]
  /** Rules that reached nobody, or asked for something the reducer refused. */
  misses: RuleMiss[]
  refusals: { action: Action; error: string }[]
}

/**
 * Look at the clock, and tell the rules what became true.
 *
 * The one thing worth understanding here is the memory. A pass with no memory re-reports every
 * overdue issue every morning, which trains people to ignore the message and then to ignore the
 * new one. This takes an observation — the conditions true right now — compares it with the
 * observation the previous pass stored, and raises only what has appeared since. A condition
 * that is still true is counted, not repeated; a condition that cleared and came back is news
 * again, because a date somebody moved and then missed is a different fact from the first miss.
 *
 * Everything after the comparison is ordinary. The onsets become events, the same rules react
 * to them as react to a person's click, and the actions go through the same reducer with the
 * same permission check — under the machine actor, whose grants are narrow and stated.
 */
export function runWatch(
  state: WorkspaceState,
  previous: Observation,
  today: string,
  now: string,
  actor: Actor,
): WatchRun {
  const policy = state.model.watch
  const empty: WatchRun = {
    state,
    diff: { onset: [], cleared: [], continuing: 0, seeded: 0 },
    observation: previous,
    steps: [],
    misses: [],
    refusals: [],
  }
  // Switched off means switched off: the previous observation is returned untouched, so
  // turning it back on later does not raise a month of accumulated onsets in one go.
  if (!policy?.enabled) return empty

  const { observation, findings } = observe(state, today, policy)
  const diff = diffObservations(previous, observation, findings)
  if (!diff.onset.length) return { ...empty, observation, diff }

  const events: DomainEvent[] = diff.onset.map((f) => ({
    type: eventTypeFor(f.condition) as EventType,
    subjectId: f.subjectId,
    from: '',
    // The detail is the event's `to`, so a rule's message can carry the actual numbers —
    // "{to}" reads as "Due 2026-08-10, and 3 working days have passed."
    to: f.detail,
    at: now,
    by: actor.name,
  }))

  const { actions, misses } = planActions(state, events, now)
  let current = state
  const steps: { action: Action; before: WorkspaceState; after: WorkspaceState }[] = []
  const refusals: { action: Action; error: string }[] = []

  for (const action of actions) {
    const result = apply(current, action, actor)
    if (result.error) {
      refusals.push({ action, error: result.error })
      continue
    }
    steps.push({ action, before: current, after: result.state })
    current = result.state
  }

  return { state: current, diff, observation, steps, misses, refusals }
}
