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

import type { Blueprint } from './blueprint'
import { dueOccurrence, subjectFor, type Recurrence } from './recurrence'
import type { RichDoc } from './richText'
import { isEmptyRichDoc, richDocsEqual, richTextToPlainText, wrapPlainText } from './richText'
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
import { ACTIVITY_PHASES } from './types'

/**
 * Re-exported so the many callers that reach for `NodeKind` from the workspace keep working.
 * It is *declared* in `./types` alongside `RowKind`, because a tier being a node and a tier
 * being a row are two views of one list — see `NODE_KINDS`.
 */
export type { NodeKind }
import type { EvidenceItem, EvidenceKind, SnapshotPurpose } from './evidence'
import { DEFAULT_NOTE_TYPE, type IssueNote, type NoteType } from './notes'
import { ACTION_PERMISSIONS, MACHINE_ROLE_ID, accessProblems, can, directoryIdByName, directoryPersonFor, isStaffedOn, permissionForAction, rolesFor, type AccessPolicy, type PermissionKey } from './access'
import { rateProblem, type PersonRate, type RateKind } from './rates'
import {
  LOG_FOR_OTHERS,
  backdated,
  dailyCap,
  dailyCapWarning,
  refusesTimeEntry,
  timeEntryAllowed,
  timePolicyProblem,
  type TimePolicy,
  type WeekState,
} from './timeWindow'
import { checkPersonSkill, type PersonSkill, type Skill, type SkillLevel, type SkillSource } from './skills'
import {
  duplicateOf,
  formatBytes,
  subjectProblem,
  uploadProblem,
  type DocumentRecord,
  type DocumentSubject,
} from './documents'
import type { StoreKind } from './documents'
import {
  checkScopeItem,
  nextScopeSequence,
  parentProblem,
  type ScopeItem,
} from './scope'
import {
  acceptProblem,
  checkMilestone,
  deliverProblem,
  milestoneValue,
  nextSequence,
  type AcceptanceState,
  type Milestone,
} from './milestone'
import {
  checkChange,
  contractedPosition,
  decideChangeProblem,
  statusAfterDecision,
  type ChangeRequest,
} from './changeRequest'
import {
  isFrozen,
  frozenMessage,
  weekStarting,
  weekLabel,
  weekTotal,
  sheetFor,
  submitProblem,
  decideProblem,
  statusAfter,
  type Attester,
  type Timesheet,
} from './timesheet'
import { canEditNote } from './permissions'
import {
  checkTransition,
  policyProblems,
  type StatusPolicy,
} from './statusPolicy'
import { checkEntry, type TimeActivity, type TimeEntry } from './time'
import { overlapProblem, type Version } from './versioning'
import { memberProblem, type ProjectMember, type ProjectRole } from './staffing'
import { eventProblem, type PersonalEvent } from './personalEvents'
import type { InboundMail } from './intake'
import {
  allocationPolicyProblem,
  capacityFor,
  profileAt,
  checkAllocation,
  defaultProfile,
  describeCapacity,
  type Allocation,
  type AllocationPolicy,
  type Commitment,
  type CommitmentKind,
  type ResourceProfile,
} from './capacity'
import {
  availabilityForAssignment,
  availabilityNote,
  refusesAssignment,
} from './assignment'
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
import { deliveryFor, modeFor, notificationPrefProblem, type Channel, type Delivery, type Notification, type NotificationKind, type NotificationMode } from './notifications'
import { mentionsIn } from './mentions'
import { raidProblem } from './raid'
import { reviewStateOf, type DocumentReview, type ReviewVerdict } from './proofing'
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
import { addWorkingDays, daysBetween, workingDaysBetween } from './dates'
import { BLOCKED_STATUSES, isTerminal, STATUS_PROGRESS } from './schedule'
import type { Actor } from './actor'
import { type IntakeForm,
  KIND_LABEL_KEY,
  DEFAULT_ORGANIZATION,
  ROOT_SCOPE,
  checkAssignment,
  emptyOverride,
  initModel,
  wouldCreateManagerCycle,
  directReportsOf,
  liveWorkTypes,
  liveDisciplines,
  liveSkills,
  type Discipline,
  type WorkType,
  resolveLabel,
  type Autonomy,
  type IntakeMailbox,
  type LabelKey,
  type OperatingModel,
  type TierDef,
  type Holiday,
  holidaySetOf,
  DEFAULT_TIERS,
  tiersOf,
  isTierKind,
  isExternalPartyKind,
  externalPartyKinds,
  tierIndex,
  type OrganizationIdentity,
  type DocumentFiling,
  type OrgRole,
  type Person,
  type ResponsibilityType,
  type RoutingRule,
} from './config'
import { MEASURES, type Goal } from './goals'

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
  description: RichDoc
  type: string
  /**
   * The classification the source log recorded, when `type` has been mapped onto a different
   * taxonomy. Empty for records this workspace created — they were never anything else.
   */
  sourceType: string
  /**
   * Which discipline resolves this — a `Discipline` id, or empty.
   *
   * A THIRD axis, independent of `type` and `module`: a Technical issue can be a Defect or a
   * Change Request, and can sit in any module. See `Discipline` in lib/config.ts.
   *
   * **Empty means unclassified, and every imported issue is empty.** Nothing infers a discipline
   * from the module, the subject or the owner. The inference would often be right and would be
   * indistinguishable from a person's judgement when it was wrong, which is the whole objection:
   * a register that cannot tell a classification from a guess cannot be used to decide who works
   * on what. Classifying the back catalogue is a person's job, or a proposal carrying its own
   * provenance — never a default.
   */
  discipline: string
  severity: Severity
  status: IssueStatus
  owner: string
  /** The directory id, resolved at write time; null when the name did not uniquely resolve. */
  ownerId?: string | null
  /**
   * Whether a client-facing surface may show this record. Default false; born true only for
   * a client-role actor's own submission or an intake arrival — hiding somebody's own
   * request from them would be absurd. Absent (pre-boundary rows) reads as false.
   */
  clientVisible?: boolean
  /** A risk's judged halves, 1–5 each; null = not yet judged, never a default. Exposure is
   *  computed from these and NEVER stored — see `lib/raid.ts`. */
  riskLikelihood?: number | null
  riskImpact?: number | null
  /** A decision's recorded outcome. Meaningful on Decision-typed records; plain text. */
  decisionOutcome?: string | null
  raisedBy: string
  accountable: AccountableParty
  raised: string
  lastActivity: string
  actualEnd: string | null
  /** When the current status was entered — anchors the client-waiting pause clock. Null on imported rows. */
  statusSince: string | null
  /** Calendar days banked in client-waiting statuses. Health shifts the due comparison by these; the committed date never moves. */
  pausedDays: number
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
  /** Weeks presented for approval. The hours stay in `timeEntries`; see lib/timesheet.ts. */
  timesheets: Record<string, Timesheet>
  /**
   * What people cost and are charged at.
   *
   * **Redacted in `boot()` for anybody without `rate.view`**, so an actor who may not see rates
   * receives an empty map rather than a hidden one. The reducer still holds them, because it is
   * the single mutation funnel and an arm that bypassed it would lose the audit trail.
   */
  rates: Record<string, PersonRate>
  /** Variations to the contracts. Deltas — the SOW baseline is never edited by one. */
  changes: Record<string, ChangeRequest>
  /**
   * Who can do what, at what level, and who says so. See `./skills`.
   *
   * **Redacted field by field in `boot()`** for anybody without `skill.view` — unlike `rates`,
   * which is withheld whole. A skill row holds a directory fact (this person has touched this)
   * and a judgement (they are Practitioner, assessed, by name). The first is the reason the
   * collection exists; the second is the reason it cannot go out unredacted.
   */
  personSkills: Record<string, PersonSkill>
  /**
   * Files the application actually holds. See `./documents`.
   *
   * Metadata only. `locator` is null in every copy that leaves the server — unconditionally, not
   * per grant — because the browser downloads through `GET /api/documents/[id]` and has no use
   * for it. See the note on `DocumentRecord.locator`.
   *
   * This is the first collection here that grows without bound. `describeDocuments` records the
   * number at which that stops being free and what to do about it, deliberately instead of
   * capping the load: evidence exists to be produced at a governance meeting, and the piece
   * somebody asks for is usually an old one.
   */
  documents: Record<string, DocumentRecord>
  /** Deliverable reviews — see lib/proofing.ts. Keyed by review id. */
  documentReviews: Record<string, DocumentReview>
  /**
   * What was promised, when it lands, and what it is worth. See `./milestone`.
   *
   * A statement of work legitimately has none — a monthly retainer is billed by the month — and
   * `milestonePosition` reports that as a different thing from having made no progress.
   */
  milestones: Record<string, Milestone>
  /**
   * What each statement of work says it will deliver. See `./scope`.
   *
   * Scope items, not tree tiers — settled 18 August. `Sow.scope` keeps the agreement in the
   * document's own words; this is the structured version, and the two are not required to agree.
   */
  scopeItems: Record<string, ScopeItem>
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
  /**
   * What was true, from when. See `./versioning`.
   *
   * Keyed by id rather than by subject, because a stamp refers to a version by id and the
   * lookup that has to be fast is the one a correction makes.
   */
  versions: Record<string, Version<unknown>>
  /** Commercial and delivery envelope per engagement node. Keyed by node id. */
  engagements: Record<string, EngagementDetail>
  /**
   * Who may see and act on a project. See `./access`'s `canOnProject` and `projectOf`.
   *
   * Keyed to the same unit `Allocation.projectId` and a SOW's node attribution already are —
   * a `'project'` hierarchy node. Unlike `Allocation`, `personId` is required: a row that
   * cannot resolve to a directory id is an access fact nothing will ever match against a
   * signed-in session, so `addProjectMember` refuses to create one rather than storing it
   * silently useless.
   */
  projectMembers: Record<string, ProjectMember>
  /**
   * A person's own calendar entries — typed in, not synced. Private to their owner
   * unconditionally; see `lib/db/boot.ts`'s `redactForReader` and `./personalEvents`.
   */
  personalEvents: Record<string, PersonalEvent>
  /**
   * A kept record of every message intake has ever seen — accepted or refused. See
   * `./intake`'s `InboundMail`; `internal.view`-gated only, not narrowed further.
   */
  inboundMail: Record<string, InboundMail>
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
 * What a user can create: any non-root tier of the organisation's chain, plus the invariant
 * record kinds. A string rather than a union, because the tier part is open configuration —
 * the closed vocabulary here is the leaf set, and `canParent` is what validates a kind, not
 * this type.
 */
export type CreatableKind = string

/**
 * What `+ Add` offers for the selected row. The parent is always implied by the selection.
 *
 * Derived from the tier chain rather than tabulated: the offers under a tier are exactly the
 * kinds `canParent` would accept there, so the menu and the Move validation cannot drift —
 * they are two readings of one rule. (The table this replaces was keyed exhaustively over
 * `RowKind` so a new tier failed to compile until someone stated its offers; with tiers as
 * configuration that guarantee is impossible, and agreement-by-derivation replaces it.)
 */
export function createMenuFor(kind: RowKind, tiers: readonly TierDef[] = DEFAULT_TIERS): CreatableKind[] {
  if (kind === 'issue') return ['sub-issue', ...ACTIVITY_PHASES, 'Milestone']
  if (kind === 'activity') return ['Milestone']
  if (kind === 'milestone') return []
  const out: CreatableKind[] = tiers.filter((t) => canParent(t.kind, kind, tiers)).map((t) => t.kind)
  if (canParent('issue', kind, tiers)) out.push('issue')
  return out
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

/**
 * Which parents each kind may legally sit under — enforced by Move and Create.
 *
 * Derived from the tier chain rather than tabulated. The rule, which reproduces the old
 * exhaustive table exactly for the default tiers (proven by the Step 2 verification script
 * before the table was deleted):
 *
 *   - A tier may sit under any strictly coarser tier that is not the root — work belongs to
 *     the parties and containers beneath the root, not loose under the organisation itself —
 *     EXCEPT the second tier, whose only coarser tier is the root and which may sit there.
 *     (For the defaults: client under company; engagement/project/module skip freely among
 *     client/engagement/project but never sit under company.)
 *   - An issue may sit under any non-root tier, or under another issue.
 *   - Activities sit under issues; milestones under issues or activities. Invariant.
 *
 * Kinds arrive as plain strings from dialogs and actions, so unknown kinds simply fail every
 * test. Callers with a workspace in hand pass `tiersOf(state.model)`; the default keeps the
 * signature compatible for callers that can only mean the shipped chain.
 */
export function canParent(
  childKind: string,
  parentKind: string,
  tiers: readonly TierDef[] = DEFAULT_TIERS,
): boolean {
  if (childKind === 'activity') return parentKind === 'issue'
  if (childKind === 'milestone') return parentKind === 'issue' || parentKind === 'activity'
  if (childKind === 'issue') return parentKind === 'issue' || tierIndex(tiers, parentKind) > 0
  const child = tierIndex(tiers, childKind)
  if (child <= 0) return false // unknown kind, or the root, which has no parent
  const parent = tierIndex(tiers, parentKind)
  if (parent < 0 || parent >= child) return false
  return parent > 0 || child === 1
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
  /** A `Discipline` id. Absent in every seed, because nothing in the log records one. */
  discipline?: string
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
        // Literal by construction, not an unconverted flag test: the seed imports a client
        // log, whose shape IS the default chain — its node ids embed these kind strings
        // (`client:OAPIL`). An organisation with a different chain does not arrive by seed.
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
      description: wrapPlainText(i.description),
      sourceType: i.sourceType ?? '',
      // Empty, not guessed. The imported log has no discipline column and never had one.
      discipline: i.discipline ?? '',
      plannedStart: null,
      plannedEnd: null,
      percentOverride: null,
      scheduleMode: 'AUTO',
      assignments: {},
      statusSince: null,
      pausedDays: 0,
      clientVisible: false,
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
    // A fresh workspace has no history yet — the first version is recorded, never seeded.
    versions: {},
    timesheets: {},
    rates: {},
    changes: {},
    personSkills: {},
    documents: {},
    documentReviews: {},
    milestones: {},
    scopeItems: {},
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
    // A fresh workspace starts with nobody staffed on anything — the backfill migration is
    // what populates this against real history; a seed has none to backfill from.
    projectMembers: {},
    // A fresh workspace starts with nobody's calendar typed in — there is no history to
    // backfill this from at all, for anyone.
    personalEvents: {},
    // A fresh workspace has received no mail yet — the seed predates this record existing.
    inboundMail: {},
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

/**
 * The `'project'` node a record sits under, or null.
 *
 * Reuses `scopeChainOf` as-is — the same walk config-scope resolution and the SOW-engagement
 * check already use. Null covers two real cases, not an error: the id doesn't exist, or the
 * record genuinely sits directly under a bare `'client'`/`'engagement'` node with no project
 * ancestor, which `ALLOWED_PARENTS` has always permitted. Either way `canOnProject`
 * (`./access`) treats it as ungated, matching how such records are visible today.
 */
export function projectOf(state: WorkspaceState, id: string): string | null {
  for (const scopeId of scopeChainOf(state, id)) {
    if (state.nodes[scopeId]?.kind === 'project') return scopeId
  }
  return null
}

/**
 * Which project(s) an action touches, for the membership gate in `apply()`.
 *
 * `null` means not project-scoped — the action is either coarser than a project (a SOW spans
 * possibly many projects — see `Sow.projects`, a one-to-many — so milestones, scope items and
 * document reviews, which hang off a SOW rather than a project directly, cannot be resolved to
 * one project unambiguously; gating them would be guessing) or is not record-scoped at all
 * (config, rates, notification preferences, membership management itself).
 *
 * Most kinds resolve through `projectOf` directly: `parentOf` already understands nodes, issues
 * AND activities, so an id that names any of those needs no lookup here. The rest — notes,
 * evidence, time entries, approvals, relationships, dependencies — are records `parentOf` does
 * not know, so each is resolved to its owning issue first, by the same field every reducer arm
 * for that kind already reads.
 *
 * Two-record actions (`link`, `addDependency`, and their removals) return both ends: the actor
 * must be staffed on whichever project each side resolves to, which for a same-project link is
 * one check twice and for a genuinely cross-project link is the real question being asked.
 */
export function projectScopeOf(state: WorkspaceState, a: Action): string[] | null {
  const one = (id: string): string[] | null => {
    const p = projectOf(state, id)
    return p ? [p] : null
  }
  const two = (idA: string, idB: string): string[] | null => {
    const pa = projectOf(state, idA)
    const pb = projectOf(state, idB)
    const ps = [...new Set([pa, pb].filter((x): x is string => Boolean(x)))]
    return ps.length ? ps : null
  }

  switch (a.t) {
    case 'create':
      return one(a.parentId)
    case 'duplicate':
      return one(a.issueId)
    case 'updateIssue':
    case 'softDelete':
    case 'restore':
    case 'setDates':
    case 'updateActivity':
      return one(a.id)
    case 'move':
      return two(a.id, a.newParentId)
    case 'link':
      return two(a.sourceIssueId, a.targetIssueId)
    case 'unlink': {
      const rel = state.relationships.find((r) => r.id === a.id)
      return rel ? two(rel.sourceIssueId, rel.targetIssueId) : null
    }
    case 'addDependency':
      return two(a.predecessorId, a.successorId)
    case 'removeDependency': {
      const dep = state.dependencies.find((d) => d.id === a.id)
      return dep ? two(dep.predecessorId, dep.successorId) : null
    }
    case 'addEvidence':
    case 'addNote':
    case 'setEstimate':
    case 'baselineEstimate':
    case 'addTime':
    case 'buildLifecycle':
    case 'clearLifecycle':
    case 'setAssignment':
      return one(a.issueId)
    case 'requestApproval':
      return one(a.subjectId)
    case 'updateEvidence':
    case 'removeEvidence':
      return state.evidence[a.id] ? one(state.evidence[a.id].issueId) : null
    case 'updateNote':
    case 'removeNote':
      return state.notes[a.id] ? one(state.notes[a.id].issueId) : null
    case 'updateTime':
    case 'removeTime':
      return state.timeEntries[a.id] ? one(state.timeEntries[a.id].issueId) : null
    case 'decideApproval':
      return state.approvals[a.id] ? one(state.approvals[a.id].subjectId) : null
    default:
      return null
  }
}

/* ================================================================== *
 * Actions
 * ================================================================== */

export type Action =
  /* ---- CRUD ---- */
  | { t: 'create'; parentId: string; kind: CreatableKind; draft: Record<string, string>; now: string }
  /**
   * Copy an issue, and record that the copy is a copy.
   *
   * There is no `relationshipType` here and no flag to suppress it: the `DUPLICATE_OF` is minted
   * by the reducer, always, and a caller has no say in it. `note` is the note that rides on the
   * relationship — the same field `link` carries, and empty is a legitimate thing to send.
   */
  | { t: 'duplicate'; issueId: string; note: string; now: string }
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
  | { t: 'addNote'; issueId: string; body: RichDoc; noteType: NoteType; pinned: boolean; clientVisible?: boolean; now: string }
  | {
      t: 'updateNote'
      id: string
      patch: Partial<Pick<IssueNote, 'body' | 'noteType' | 'pinned' | 'clientVisible'>>
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
      /** Record against one task of the issue. Optional — absent means work-level, the shape
       *  every entry had before task-level time existed. Must belong to `issueId`. */
      activityId?: string
      person: string
      date: string
      hours: number
      activity: TimeActivity
      billable: boolean
      note: string
      /** Required by the arm when the entry lags the work past the workspace's allowance. */
      justification?: string
      now: string
    }
  | { t: 'updateTime'; id: string; patch: Partial<TimeEntry>; now: string }
  | { t: 'removeTime'; id: string; now: string }
  | {
      t: 'upsertChangeRequest'
      id: string | null
      sowId: string
      patch: Partial<Pick<ChangeRequest, 'issueId' | 'reference' | 'title' | 'effortHours' | 'value' | 'currency' | 'scope' | 'reason' | 'effectiveFrom'>>
      /** Submit it for a decision in the same action. Draft otherwise. */
      submit?: boolean
      now: string
    }
  | { t: 'withdrawChangeRequest'; id: string; now: string }
  | {
      t: 'decideChangeRequest'
      id: string
      decision: ApprovalDecision
      note?: string
      now: string
    }
  | {
      t: 'recordRate'
      personId: string
      kind: RateKind
      validFrom: string
      validTo: string | null
      amount: number
      currency: string
      reason: string
      now: string
    }
  | {
      t: 'correctRate'
      id: string
      patch: { validFrom?: string; validTo?: string | null; amount?: number; currency?: string }
      reason: string
      now: string
    }
  /**
   * Say that somebody can do something, at a level, and who says so.
   *
   * `personId` is the DIRECTORY id, not a name — the same choice `PersonRate` made and for the
   * same reason. Everything older in this reducer joins people by name; a skill is a record
   * about a person rather than a record of what they typed, and it survives a rename.
   */
  | {
      t: 'recordPersonSkill'
      personId: string
      skillId: string
      level: SkillLevel
      source: SkillSource
      assessedBy: string | null
      lastUsedOn: string | null
      note: string
      now: string
    }
  | {
      t: 'correctPersonSkill'
      id: string
      patch: {
        level?: SkillLevel
        source?: SkillSource
        assessedBy?: string | null
        lastUsedOn?: string | null
        note?: string
      }
      now: string
    }
  | { t: 'removePersonSkill'; id: string; now: string }
  /**
   * Record that a file has been stored. **The bytes are already in the store when this runs.**
   *
   * The reducer never sees a byte, and that is not squeamishness about size — it is the ordering
   * rule the whole entity rests on. Storing first and recording second means a crash between the
   * two leaves an object nobody can see, costing pennies. Recording first would leave a row
   * pointing at nothing: a screen offering a document that cannot be opened, which is precisely
   * the fault this entity was built to fix.
   *
   * So this action carries what the store returned — locator, checksum, the size actually
   * written — and not what a browser claimed.
   */
  | {
      t: 'recordDocument'
      subjectKind: DocumentSubject
      subjectId: string
      name: string
      mimeType: string
      sizeBytes: number
      checksum: string
      locator: string
      store: StoreKind
      note: string
      /** Attach it to an issue's evidence list in the same act, when one is being described. */
      evidenceId?: string | null
      /** The document this upload replaces — a new version in the chain. */
      supersedesId?: string | null
      clientVisible?: boolean
      now: string
    }
  | { t: 'removeDocument'; id: string; now: string }
  /** Documents have no update arm; visibility is the one field a person changes after upload. */
  | { t: 'setDocumentVisibility'; id: string; clientVisible: boolean; now: string }
  /* ---- PROOFING ---- */
  /** Ask named colleagues to judge a stored document. The checksum is pinned from the row. */
  | { t: 'requestDocumentReview'; documentId: string; reviewers: string[]; question: string; now: string }
  | { t: 'decideDocumentReview'; reviewId: string; verdict: ReviewVerdict; note: string; now: string }
  | { t: 'withdrawDocumentReview'; reviewId: string; now: string }
  /* ---- SCOPE ---- */
  /**
   * A line of what a statement of work says it will deliver. See `./scope`.
   *
   * Recording is one act and agreeing is another — `decideScopeItem` — because a line somebody
   * typed while reading a draft is not yet scope, and its hours must not reach a total that gets
   * compared against a contract.
   */
  | {
      t: 'upsertScopeItem'
      id: string | null
      sowId: string
      patch: Partial<Pick<ScopeItem, 'kind' | 'text' | 'parentId' | 'effortHours' | 'source' | 'sequence'>>
      now: string
    }
  | { t: 'removeScopeItem'; id: string; now: string }
  | { t: 'decideScopeItem'; id: string; approved: boolean; now: string }
  /* ---- MILESTONES ---- */
  | {
      t: 'upsertMilestone'
      id: string | null
      sowId: string
      patch: Partial<
        Pick<
          Milestone,
          | 'name'
          | 'description'
          | 'sequence'
          | 'basis'
          | 'percentage'
          | 'amount'
          | 'currency'
          | 'billOn'
          | 'plannedDate'
          | 'delivery'
        >
      >
      now: string
    }
  | { t: 'removeMilestone'; id: string; now: string }
  /** Say the work has landed. Deliberately separate from accepting it — see `lib/milestone.ts`. */
  | { t: 'deliverMilestone'; id: string; now: string }
  | {
      t: 'decideMilestone'
      id: string
      decision: AcceptanceState
      note?: string
      /** The signed acceptance, when one has been stored. Absence is normal and allowed. */
      evidenceDocumentId?: string | null
      now: string
    }
  | { t: 'submitTimesheet'; person: string; weekStarting: string; now: string }
  | {
      t: 'decideTimesheet'
      id: string
      decision: ApprovalDecision
      /** Required on a rejection, ignored on an approval. See `decideProblem`. */
      reason?: string
      now: string
    }
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
  | { t: 'setNotificationPref'; personId: string; kind: NotificationKind; mode: NotificationMode; now: string }
  /** The drain stamping what actually happened to a queued message. Server-internal, like `notify`. */
  | { t: 'markNotificationDelivery'; id: string; delivery: Delivery; note: string; now: string }
  /**
   * Self-or-admin, like `setNotificationPref` above — the profile screen's own edit path.
   * Typed to exactly these three fields, not `Partial<Person>` and not `upsertPerson`'s broader
   * op shape: the type itself is part of what stops a self-dispatch from ever carrying `roleIds`
   * or `managerId`, not just the reducer arm's runtime check.
   */
  | { t: 'updateCareerProfile'; id: string; patch: { grade?: string; track?: string; developingToward?: string }; now: string }
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
  /**
   * A new period for something that changes over time.
   *
   * `value` is unknown here and typed at the boundary by `subjectKind` — the reducer's job is
   * the period arithmetic, not the shape of a working pattern.
   */
  | {
      t: 'recordVersion'
      subjectKind: string
      subjectId: string
      validFrom: string
      validTo?: string | null
      value: unknown
      reason: string
      now: string
    }
  /**
   * Move a period, or change what it held.
   *
   * Distinct from recording a new one, and the distinction is the point: a correction says the
   * record was always wrong, where a new period says the world changed. Conflating them makes a
   * backdated promotion indistinguishable from a second promotion.
   */
  | {
      t: 'correctVersion'
      id: string
      patch: { validFrom?: string; validTo?: string | null; value?: unknown }
      reason: string
      now: string
    }
  /**
   * Withdraw a version whose subject no longer exists.
   *
   * Deliberately narrow, and the narrowness is the whole design. There was no way to remove a
   * version at all, which is a real gap — a working pattern recorded against the wrong person
   * could never be undone — but a general delete would be a footgun: erasing a live person's
   * dated history would change what `valueAt` answers for past dates with nothing left to say
   * why. So this refuses unless the subject is already gone from the directory, which confines
   * it to exactly the case it exists for: cleaning up after a person record was removed.
   *
   * A hard delete rather than a soft one. `Version` has no `deletedAt`, and adding one would
   * mean filtering it inside `valueAt`, `timelineOf` and `overlapProblem` — the proven boundary
   * arithmetic — to withdraw rows that by definition nothing can look up any more. The audit
   * entry is the record that it happened.
   */
  | { t: 'removeVersion'; id: string; now: string }
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
      /** Leave only: why, for the approver. Private — see redactForReader. */
      reason?: string
      now: string
    }
  /**
   * Decide a requested absence. Leave only, decider needs `leave.approve`, and never their
   * own — the timesheet rule, applied to the other thing a person asks somebody to grant.
   * There is deliberately NO status field on `upsertCommitment` itself: status is computed
   * in the arm from who is writing, so approval can never be smuggled in on a write.
   */
  | { t: 'decideLeave'; id: string; decision: 'approved' | 'returned'; note?: string; now: string }
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
  /* ---- PROJECT MEMBERSHIP ---- */
  | { t: 'addProjectMember'; projectId: string; person: string; projectRoleId: string; now: string }
  /** Role correction only — see `./staffing`. Nobody re-dates a tenure by editing it. */
  | { t: 'updateProjectMember'; id: string; projectRoleId: string; now: string }
  | { t: 'removeProjectMember'; id: string; now: string }
  /**
   * ---- PERSONAL CALENDAR ----
   * Deliberately no `personId` field on any of these three — see `./personalEvents`. The
   * reducer resolves the owner from the actor; the wire has nothing to carry a wrong value.
   */
  | { t: 'addPersonalEvent'; title: string; startAt: string; endAt: string; allDay: boolean; note: string; attendees: string; now: string }
  | {
      t: 'updatePersonalEvent'
      id: string
      patch: Partial<Pick<PersonalEvent, 'title' | 'startAt' | 'endAt' | 'allDay' | 'note' | 'attendees'>>
      now: string
    }
  | { t: 'removePersonalEvent'; id: string; now: string }
  /**
   * ---- MAIL LOG ----
   * Machine-written only. Deliberately absent from `app/api/workspace/route.ts`'s `KINDS` —
   * see the mail-log plan's step 2 — the same reasoning `notify` is absent: `POST
   * /api/intake` calls `persistActions` directly and never reaches that endpoint at all.
   */
  | {
      t: 'recordInboundMail'
      mailbox: string
      from: string
      subject: string
      body: string
      messageId: string
      receivedAt: string
      issueId: string | null
      refusalReason: string | null
      conversationId: string | null
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
  /* A separate registry from `roles` — see `OperatingModel.projectRoles`'s own comment. */
  | { k: 'upsertProjectRole'; id: string | null; label: string; description: string }
  | { k: 'deleteProjectRole'; id: string }
  | { k: 'upsertWorkType'; id: string | null; label: string; description: string }
  | { k: 'deleteWorkType'; id: string }
  | { k: 'upsertDiscipline'; id: string | null; label: string; description: string; ownerRoleId: string }
  | { k: 'deleteDiscipline'; id: string }
  /*
   * The skill CATALOGUE is configuration — a vocabulary the firm owns, like disciplines. The
   * LEVELS people are recorded at are not, and travel as their own actions: a `ConfigOp` carries
   * a whole operating model and takes `config.manage`, which is not the authority that should
   * let somebody write a judgement about a colleague.
   */
  | { k: 'upsertSkill'; id: string | null; name: string; category: string; description: string }
  | { k: 'deleteSkill'; id: string }
  | { k: 'setSla'; patch: Partial<SlaPolicy> }
  | { k: 'setHolidays'; holidays: Holiday[] }
  | { k: 'setSizeBands'; bands: SizeBand[] }
  | { k: 'setStatusPolicy'; patch: Partial<StatusPolicy> }
  | { k: 'setTimePolicy'; patch: Partial<TimePolicy> }
  | { k: 'setAllocationPolicy'; patch: Partial<AllocationPolicy> }
  | { k: 'setAccess'; patch: Partial<AccessPolicy> }
  | { k: 'setApprovalRules'; rules: ApprovalRule[] }
  | { k: 'setAutomationRules'; rules: AutomationRule[] }
  | {
      k: 'setResourceProfile'
      personId: string
      patch: Partial<ResourceProfile>
      /**
       * Whether a person chose these numbers, or a seeding pass supplied the shipped default.
       *
       * Absent means yes, because every edit through the interface is somebody choosing. It
       * sits on the operation rather than in the patch deliberately: `source` is not a field
       * anybody edits, and a patch able to carry it would let a caller declare its own guesses
       * confirmed. A caller can still understate its confidence by passing false, which is the
       * safe direction to be wrong in.
       */
      confirmed?: boolean
    }
  | { k: 'setWatch'; patch: Partial<WatchPolicy> }
  | {
      k: 'upsertPerson'
      id: string | null
      name: string
      roleIds: string[]
      email?: string
      /** The client node a client-role seat belongs to; null clears it. See Person. */
      clientScopeId?: string | null
      /** Who this person reports to; null clears it. See `Person.managerId`. */
      managerId?: string | null
      /** Seniority and specialism. See `Person` — deliberately not the same thing as a role. */
      grade?: string
      track?: string
      developingToward?: string
    }
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
  | { k: 'upsertBlueprint'; id: string | null; patch: Partial<Blueprint> }
  | { k: 'deleteBlueprint'; id: string }
  | { k: 'upsertIntakeForm'; id: string | null; patch: Partial<IntakeForm> }
  | { k: 'deleteIntakeForm'; id: string }
  | { k: 'upsertRecurrence'; id: string | null; patch: Partial<Recurrence> }
  | { k: 'deleteRecurrence'; id: string }
  | { k: 'setOrganization'; patch: Partial<OrganizationIdentity> }
  | { k: 'setDocumentFiling'; patch: Partial<DocumentFiling> }
  | { k: 'upsertGoal'; id: string | null; patch: Partial<Goal> }
  | { k: 'deleteGoal'; id: string }
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

/**
 * Which engagement or project a document belongs under, by name.
 *
 * Walks up from whatever the document was attached to until it reaches an engagement or a
 * project, because those are the two tiers a person thinks of as "the job". A module is too
 * fine — nobody looks for a contract in `Finance` — and a client is too coarse, since one client
 * can run several engagements whose documents should not be pooled.
 *
 * Returns null rather than guessing when nothing above it is either. The caller files those at
 * the root, which is honest: an unplaceable document is better at the top than under a folder
 * named after the wrong job.
 *
 * The name is taken as it stands. It is sanitised where it is used as a path segment, not here —
 * this answers "which job", and turning that into a safe folder name is the store's business.
 */
export function filingFolderFor(state: WorkspaceState, subjectId: string): string | null {
  const seen = new Set<string>()
  let at: string | null = subjectId
  while (at && !seen.has(at)) {
    seen.add(at)
    const node = state.nodes[at]
    if (node && (node.kind === 'engagement' || node.kind === 'project')) return node.name
    at = parentOf(state, at)
  }
  return null
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
/**
 * Whether this person's hours on this date are still theirs to change, as a refusal or null.
 *
 * One implementation, three call sites — `addTime`, `updateTime` and `removeTime`. Three copies
 * of a rule are three chances to disagree about it, and the disagreement would show up as a
 * consultant who can delete an hour out of a submitted week but not edit it.
 */
function frozenProblem(state: WorkspaceState, person: string, date: string): string | null {
  const status = isFrozen(Object.values(state.timesheets), person, date)
  return status ? frozenMessage(status, weekStarting(date)) : null
}

/**
 * That person's week, as `lib/timeWindow.ts` names the states.
 *
 * A translation and nothing more. `isFrozen` in `lib/timesheet.ts` remains the one place that
 * decides whether a week is frozen — this only renames its answer for a module that describes
 * the same fact with a different vocabulary. Two modules deciding it would be two rules.
 */
function weekStateFor(state: WorkspaceState, person: string, date: string): WeekState {
  const status = isFrozen(Object.values(state.timesheets), person, date)
  return status === 'Submitted' ? 'submitted' : status === 'Approved' ? 'approved' : 'none'
}

/**
 * Whether the day this entry lands in has run long, as a sentence or ''.
 *
 * Never a refusal. People do work eleven-hour days at go-live, and a system that refuses to
 * record one produces hours booked to the wrong day rather than fewer hours worked.
 *
 * The cap is per PERSON per DATE — not per issue, which would let three issues permit
 * twenty-four hours in one day — so the total counts every entry that person already has on
 * that date, plus the one being added.
 *
 * The name-to-id join is the weak link and it fails safely. `Version` keys on a directory id
 * while `TimeEntry.person` holds a name, so a person whose name does not resolve gets no cap
 * and therefore no warning — a missing remark, never a wrong refusal. That asymmetry is why the
 * cap is wired here at all while the same join would be unacceptable in a refusing check.
 */
function dayWarning(state: WorkspaceState, person: string, date: string, adding: number): string {
  const named = person.trim().toLowerCase()
  const pid = directoryIdByName(state.model, person)
  const directory = pid ? state.model.people[pid] : undefined
  if (!directory) return ''

  // Id-first over the entries, so a renamed person's old rows still count toward the day.
  const already = Object.values(state.timeEntries)
    .filter(
      (e) =>
        !e.deletedAt &&
        e.date === date &&
        (e.personId ? e.personId === directory.id : e.person.trim().toLowerCase() === named),
    )
    .reduce((n, e) => n + e.hours, 0)

  return dailyCapWarning(dailyCap(Object.values(state.versions), directory.id, date), already + adding) ?? ''
}

/**
 * What the timesheet rules need to know about whoever is asking.
 *
 * The permissions are resolved here and passed in, so `lib/timesheet.ts` stays pure and can be
 * driven from a scenario without an operating model. `name` is the display name, because that is
 * what `TimeEntry.person` and `Timesheet.person` hold — the same name join the rest of the
 * product uses until people have keys.
 */
function attesterFor(state: WorkspaceState, actor: Actor): Attester {
  return {
    name: actor.name,
    maySubmit: can(state.model, actor, 'time.submit').allowed,
    mayApprove: can(state.model, actor, 'time.approve').allowed,
  }
}

/**
 * Everyone a decision-traffic notification should reach: live-role holders of one grant,
 * minus the people the moment excludes (the subject of a request, the actor who wrote it).
 * Sorted and capped exactly as the intake-arrival mint walks work.assign, and for the same
 * reason — deterministic, so the server's replay mints the same records the browser's
 * optimistic copy did. Each recipient's own preference is still consulted AT the mint;
 * this only answers who is eligible to be told.
 */
function grantHolders(
  state: WorkspaceState,
  grant: PermissionKey,
  exclude: ReadonlySet<string>,
): { id: string; name: string }[] {
  const grants = state.model.access.grants
  return Object.values(state.model.people)
    .filter(
      (p) =>
        !exclude.has(p.id) &&
        p.roleIds.some((rid) => {
          const role = state.model.roles?.[rid]
          return role && !role.deletedAt && (grants[rid] ?? []).includes(grant)
        }),
    )
    .sort((x, y) => x.name.localeCompare(y.name))
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name }))
}

/**
 * Mint one `approval`-kind notification per recipient, per that recipient's own preference —
 * the assignment mint's contract, factored because four arms now share it. The preference is
 * consulted on the ONE `approval` kind; `ruleId` carries the finer rule name so the inbox can
 * route a click without a second preference existing. `mute` mints nothing and lands in
 * `muted` for the caller to audit — "why didn't I get this" must have a stored answer —
 * and `in-app+email` adds a SECOND record with its own id for the scheduled pass's drain.
 *
 * The private leave reason is never an input here: bodies are composed by the callers from
 * dates, hours and decision notes only. That absence is load-bearing (scenario E2C).
 */
function mintApproval(
  state: WorkspaceState,
  notifications: Record<string, Notification>,
  seq: number,
  recipients: { id: string | null; name: string }[],
  subject: string,
  body: string,
  aboutId: string,
  ruleId: string,
  now: string,
): { notifications: Record<string, Notification>; seq: number; muted: { id: string | null; name: string }[] } {
  let out = notifications
  let seqAfter = seq
  const muted: { id: string | null; name: string }[] = []
  for (const r of recipients) {
    const mode = modeFor(state.model.notificationPrefs, r.id, 'approval')
    if (mode === 'mute') {
      muted.push(r)
      continue
    }
    seqAfter += 1
    const nid = `notif-${seqAfter}`
    out = {
      ...out,
      [nid]: {
        id: nid,
        to: r.name,
        toId: r.id,
        channel: 'in-app',
        subject,
        body,
        aboutId,
        ruleId,
        createdAt: now,
        delivery: 'delivered',
        deliveryNote: '',
        readAt: null,
      },
    }
    if (mode === 'in-app+email') {
      seqAfter += 1
      const eid = `notif-${seqAfter}`
      const { delivery, deliveryNote } = deliveryFor('email')
      out = {
        ...out,
        [eid]: {
          id: eid,
          to: r.name,
          toId: r.id,
          channel: 'email',
          subject,
          body,
          aboutId,
          ruleId,
          createdAt: now,
          delivery,
          deliveryNote,
          readAt: null,
        },
      }
    }
  }
  return { notifications: out, seq: seqAfter, muted }
}

/**
 * The working pattern to use for this person **over this period**.
 *
 * Takes a date, and that is the whole of step 5. It used to return whatever profile is stored
 * today and hand it to `capacityFor` regardless of when the work is: an allocation running from
 * March was checked against the week somebody moved to in July.
 *
 * `on` is the START of the window being checked. A pattern that changes mid-allocation is a real
 * thing and this does not model it — the honest reading is "the pattern in force when this
 * period begins", which is what a delivery manager means when they commit somebody in March.
 * Splitting a window at every version boundary is a different feature and would change what
 * `capacityFor` returns, not just how it is called.
 *
 * The name-to-id join is `rolesFor`'s third and weakest, and it is what is available: profiles
 * are keyed by directory id and allocations by name.
 */
function profileFor(
  state: WorkspaceState,
  person: string,
  on: string,
): ResourceProfile | undefined {
  const key = person.trim().toLowerCase()
  const match = Object.values(state.model.people).find((p) => p.name.toLowerCase() === key)
  if (!match) return undefined
  return profileAt(Object.values(state.versions), state.model.resourceProfiles, match.id, on)
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
    /**
     * One narrow reclassification: advancing a recurrence's `lastRaisedOn` is the bookkeeping
     * of a raise, not configuration. The pass runs as a machine that may file work and may not
     * configure the platform, and the guard must advance in the same batch as the raise it
     * guards — so a config op whose entire patch is `lastRaisedOn` takes `work.create`, the
     * permission of the raise itself. Anything else on the patch, name included, is
     * configuration and keeps `config.manage`. Scenario RW3 holds both halves.
     */
    const guardOnly =
      a.t === 'config' &&
      (a as { op: { k: string; patch?: object } }).op.k === 'upsertRecurrence' &&
      (a as { op: { id?: string | null } }).op.id != null &&
      Object.keys((a as { op: { patch?: object } }).op.patch ?? {}).join(',') === 'lastRaisedOn'
    /**
     * One narrow self-exception (E2): asking for your OWN absence is not a claim on anybody
     * else's time — the arm lands it Requested, for somebody who holds the DECIDING grant to
     * answer. Requiring `capacity.record` here would make My calendar's "Request leave" a
     * dead button for exactly the people it exists for (DELIVERY_CORE deliberately lacks
     * that grant: it is the planner's, for recording the team's time off). Recording anybody
     * else's absence, or any non-Leave commitment, keeps the grant; withdrawing rides the
     * same exception only for your own Leave row. The subject join is the arm's own:
     * directory id when it resolves, trimmed name otherwise.
     */
    const isSelf = (person: string, personId?: string | null): boolean =>
      (personId ?? directoryIdByName(state.model, person) ?? '__none__') ===
        (directoryPersonFor(state.model, actor)?.id ?? '__self__') ||
      person.trim().toLowerCase() === actor.name.trim().toLowerCase()
    const ownLeave =
      (a.t === 'upsertCommitment' &&
        (a as { kind: string }).kind === 'Leave' &&
        isSelf((a as { person: string }).person)) ||
      (a.t === 'removeCommitment' &&
        (() => {
          const c = state.commitments[(a as { id: string }).id]
          return Boolean(c && c.kind === 'Leave' && isSelf(c.person, c.personId))
        })())
    const need = ownLeave ? null : guardOnly ? 'work.create' : permissionForAction(a.t, { closing })
    if (need) {
      const verdict = can(state.model, actor, need)
      if (!verdict.allowed) return { state, error: verdict.reason ?? 'Not permitted.' }
    }
  }

  /**
   * Is this actor staffed on the project this action touches?
   *
   * A second, independent gate — not folded into the capability check above, because it applies
   * regardless of how capability itself gets decided. `updateNote`/`removeNote` resolve `need`
   * to null and defer to `canEditNote`'s authorship rule inside the arm; the project gate still
   * has to hold for them, so it is asked here rather than only where `need` is non-null.
   *
   * `projectScopeOf` returns null for anything not resolvable to exactly one project — most
   * actions, and every action coarser than a project (a SOW spans possibly many). Nothing there
   * is newly gated; see its own comment for the boundary.
   */
  {
    const scopeIds = projectScopeOf(state, a)
    if (scopeIds) {
      const members = Object.values(state.projectMembers)
      for (const projectId of scopeIds) {
        if (!isStaffedOn(state.model, actor, projectId, members)) {
          return { state, error: `${actor.name} is not staffed on this project.` }
        }
      }
    }
  }

  /*
   * The check above is only as complete as the table behind it, and until now nothing made the
   * table complete. `ACTION_PERMISSIONS` is keyed by `string` — it has to be, because narrowing
   * it inside `access.ts` would mean importing `Action` from this file, which already imports
   * that one — so an action missing from it resolved to `null` and simply skipped the check.
   * `recordVersion` and `correctVersion` shipped unguarded that way.
   *
   * The assertion belongs here, where both `Action` and the table are in scope. It costs nothing
   * at runtime and turns the next omission into a build failure naming the action, which is the
   * guarantee `access.ts` had been claiming for itself all along.
   */
  void (ACTION_PERMISSIONS satisfies Record<Action['t'], PermissionKey | null>)

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
      /*
       * An archived parent is not a place work appears. `kindOf` answers for soft-deleted rows
       * — it has to, so history renders — which meant every filer (the form, intake, the
       * recurrence pass) could quietly create records inside the archive, visible to nobody.
       * Found by RW3's vanished-scope arm, fixed for all of them here.
       */
      const parentGone =
        state.nodes[a.parentId]?.deletedAt ??
        state.issues[a.parentId]?.deletedAt ??
        state.activities[a.parentId]?.deletedAt ??
        null
      if (parentGone) {
        return { state, error: 'That parent is archived. Restore it first, or file this somewhere live.' }
      }

      const seq = state.seq + 1
      const name = (a.draft.name || '').trim()
      if (!name) return { state, error: 'A name is required.' }

      // -- structural node. Membership in THIS organisation's tier chain, not "any non-leaf
      // string" — the open tier vocabulary means the complement test would mint a node of
      // whatever kind a caller typed, and validation is exactly what this arm is for.
      if (isTierKind(tiersOf(state.model), a.kind)) {
        if (!canParent(a.kind, parentKind, tiersOf(state.model))) {
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
        if (!canParent('issue', parentKind, tiersOf(state.model))) {
          return { state, error: `An issue cannot sit under a ${parentKind}.` }
        }
        // Inherit client/module from wherever it was created. "Client" is the nearest
        // ancestor on an externalParty tier — the flag, not the literal kind.
        const external = externalPartyKinds(tiersOf(state.model))
        let client = ''
        let mod = ''
        let cursor: string | null = a.parentId
        while (cursor) {
          const n = state.nodes[cursor]
          if (n?.kind === 'module' && !mod) mod = n.name
          if (n && external.has(n.kind)) client = n.name
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
        /*
         * The boundary's birth rule: a record is internal unless the person who raised it is
         * the client (their own submission must be visible to them) or the machine door
         * (intake — the claimed sender is the client). Everything else becomes visible only
         * by a person's later decision.
         */
        const actorRoles = rolesFor(state.model, actor)
        const clientRoles = ['ROLE_CLIENT_SPONSOR', 'ROLE_CLIENT_LEAD', 'ROLE_CLIENT_USER']
        const bornVisible =
          actorRoles.includes(MACHINE_ROLE_ID) || actorRoles.some((r) => clientRoles.includes(r))

        const issue: IssueRecord = {
          id,
          parentId: a.parentId,
          client: client || 'Unassigned',
          // An explicit classification on the draft wins; the ancestor walk is the default.
          // Free text like the walk's own value — the vocabulary is what work carries, not a
          // registry (see the E0 plan's step 8 amendment).
          module: a.draft.module?.trim() || mod || 'Unclassified',
          subject: name,
          description: wrapPlainText(a.draft.description || ''),
          // Falls back to the first configured type rather than a literal. `'Defect'` was
          // hardcoded here, so a workspace that had archived Defect — or never had one —
          // would still mint records classified as it, and no filter would show them.
          type: a.draft.type || liveWorkTypes(state.model)[0]?.label || '',
          // Created here, so there is no earlier classification to preserve.
          sourceType: '',
          /*
           * Unclassified unless the person creating it said otherwise, and NOT defaulted to the
           * first configured discipline the way `type` is above.
           *
           * The two look symmetrical and are not. Every issue has a type — the register cannot
           * describe a record without one, so falling back to the first is choosing a starting
           * point. Discipline answers "who resolves this", which is frequently not known at the
           * moment a client reports something, and defaulting it would route work to a team on
           * the strength of an alphabetical accident.
           */
          discipline: a.draft.discipline || '',
          severity: (a.draft.severity as Severity) || 'Medium',
          status,
          owner: a.draft.owner || 'Unassigned',
          ownerId: directoryIdByName(state.model, a.draft.owner || ''),
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
          statusSince: a.now.slice(0, 10),
          pausedDays: 0,
          clientVisible: bornVisible,
          deletedAt: null,
        }
        /*
         * Machine-created work must not land silently. A client's request that files itself
         * and tells nobody defeats the door it came through — so everyone who may hand work
         * out (a live role holding work.assign) is told, in-app, without any automation rule
         * having to exist. Deterministic (sorted, capped) so the server's replay mints the
         * same notifications the browser's optimistic copy did.
         */
        let seqAfter = seq
        let notifications = state.notifications
        if (actorRoles.includes(MACHINE_ROLE_ID)) {
          const grants = state.model.access.grants
          const triagers = Object.values(state.model.people)
            .filter((p) =>
              p.roleIds.some((rid) => {
                const role = state.model.roles?.[rid]
                return role && !role.deletedAt && (grants[rid] ?? []).includes('work.assign')
              }),
            )
            .sort((x, y) => x.name.localeCompare(y.name))
            .slice(0, 8)
          for (const p of triagers) {
            // Each triager's OWN preference; one person's mute must not silence the rest.
            const mode = modeFor(state.model.notificationPrefs, p.id, 'intake-arrival')
            if (mode === 'mute') continue
            seqAfter += 1
            const nid = `notif-${seqAfter}`
            notifications = {
              ...notifications,
              [nid]: {
                id: nid,
                to: p.name,
                toId: p.id,
                channel: 'in-app',
                subject: `New request ${id}`,
                body: `${issue.raisedBy} raised “${issue.subject}” — it is unowned until somebody takes it.`,
                aboutId: id,
                ruleId: 'intake-arrival',
                createdAt: a.now,
                delivery: 'delivered',
                deliveryNote: '',
                readAt: null,
              },
            }
            if (mode === 'in-app+email') {
              seqAfter += 1
              const eid = `notif-${seqAfter}`
              const { delivery, deliveryNote } = deliveryFor('email')
              notifications = {
                ...notifications,
                [eid]: {
                  id: eid,
                  to: p.name,
                  toId: p.id,
                  channel: 'email',
                  subject: `New request ${id}`,
                  body: `${issue.raisedBy} raised “${issue.subject}” — it is unowned until somebody takes it.`,
                  aboutId: id,
                  ruleId: 'intake-arrival',
                  createdAt: a.now,
                  delivery,
                  deliveryNote,
                  readAt: null,
                },
              }
            }
          }
        }
        return {
          state: {
            ...state,
            seq: seqAfter,
            notifications,
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
      //
      // Closed vocabulary, checked HERE and not only at the API boundary. This used to be the
      // fall-through branch: any kind that was neither a tier nor an issue landed here and was
      // cast into `phase`, which was safe only because `actionShape`'s allowlist refused
      // anything else before the reducer saw it. With tiers as open configuration that
      // allowlist can no longer be closed over tier kinds, so the leaf vocabulary — which IS
      // closed, per the design's invariant execution core — is enforced where the cast happens.
      if (a.kind !== 'Milestone' && !(ACTIVITY_PHASES as readonly string[]).includes(a.kind)) {
        return { state, error: `"${a.kind}" is not something that can be created.` }
      }
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

    /* ---------------- CRUD: duplicate ---------------- */
    /**
     * A copy of an issue, and a `DUPLICATE_OF` relationship from the copy to the original.
     *
     * Always. There is no field on the action to suppress the relationship and no branch below
     * that can skip it, because the relationship is the reason this arm exists rather than a
     * courtesy it performs. This register carried 48 issues that were the same client points
     * re-circulated on two spreadsheets, and they were deleted in a3ecd95 because nothing
     * recorded that they were copies — so the only way to tell the register the truth was to
     * throw the rows away. A copy that does not know what it copied is how a register grows a
     * second version of the truth.
     *
     * WHAT IS CARRIED — the description of the work. Where it sits, who it is for, what kind of
     * thing it is, how bad it is, who is on it, what it does to the client. Those are properties
     * of the point being raised, and a copy raised against the same point has the same ones.
     *
     * WHAT IS DROPPED — everything that is a record of what happened to the *original*:
     *
     *   status            starts at 'Open'. Inheriting "Awaiting client confirmation" would have
     *                     the copy claim a client had been asked something about a record that
     *                     did not exist when they were asked.
     *   dates, progress   raised and lastActivity are today; planned dates, percentOverride,
     *                     actualEnd and nextAction are empty. The copy has not been scheduled,
     *                     has not progressed, and has no agreed next step yet.
     *   raisedBy          the actor, not the original's raiser. This record was raised now, by
     *                     whoever ran this. Who raised the underlying point is one hop away
     *                     through the relationship, which is exactly what the relationship is
     *                     for — a copy does not need to restate what it can point at.
     *   reference         an external reference names one row in somebody else's system, and two
     *                     of our records claiming it is the same second-version-of-the-truth
     *                     problem read from the other end.
     *   evidence, verification
     *                     what was checked was checked on the original.
     *   time entries, approvals, the estimate, notes, evidence items, lifecycle activities,
     *   dependencies, and every other relationship
     *                     not copied and not re-pointed. A duplicate that arrives with somebody
     *                     else's logged hours — or with their approval already granted, or their
     *                     agreed estimate — is worse than no duplicate feature: it invents
     *                     attested work, and attested work is the thing this workspace is least
     *                     free to invent. Anyone who wants the original's hours can follow the
     *                     `DUPLICATE_OF` to them.
     *   the audit trail   the original's history belongs to the original. The copy's history
     *                     starts with the two entries below.
     *
     * The record is written out field by field rather than as `{ ...original, ... }`, so that
     * list is enforced by the compiler rather than by this comment: a field added to
     * `IssueRecord` later fails to compile here until somebody decides whether a copy carries
     * it. A spread would answer "yes" on their behalf, silently, which is how a copy quietly
     * starts carrying somebody else's hours again.
     */
    case 'duplicate': {
      const original = state.issues[a.issueId]
      if (!original) return { state, error: 'The issue being copied no longer exists.' }
      if (original.deletedAt) {
        return {
          state,
          error: 'An archived issue cannot be copied. Restore it first, so the copy points at something the register still shows.',
        }
      }

      /*
       * The funnel at the top of `apply` asked one question — `work.create`, because this mints
       * an issue. This arm does two things and the second one is the point, so the second grant
       * is asked for here. A role that can raise work but not relate it — the client roles, as
       * shipped — cannot duplicate. That is the intended answer, not a gap to be closed by
       * loosening this: the copy such a role could make would be a copy with no `DUPLICATE_OF`,
       * which is the defect.
       */
      const relate = can(state.model, actor, 'work.link')
      if (!relate.allowed) return { state, error: relate.reason ?? 'Not permitted.' }

      const seq = state.seq + 1
      // The issue's own id comes from the client series, like every other issue — `nextIssueId`
      // already walks past anything taken. `seq` is spent on the relationship below.
      const id = nextIssueId(state, original.client)

      const copy: IssueRecord = {
        id,
        parentId: original.parentId,
        client: original.client,
        module: original.module,
        subject: original.subject,
        description: original.description,
        type: original.type,
        // Carried, like type and severity: a copy is the same kind of work, resolved by the same
        // discipline. It is the *progress* of the original that must not come with it, not its
        // description.
        discipline: original.discipline,
        // Created here, so there is no earlier classification to preserve — as in `create`.
        sourceType: '',
        severity: original.severity,
        status: 'Open',
        owner: original.owner,
        ownerId: directoryIdByName(state.model, original.owner),
        raisedBy: by,
        accountable: original.accountable,
        raised: a.now.slice(0, 10),
        lastActivity: a.now.slice(0, 10),
        actualEnd: null,
        statusSince: a.now.slice(0, 10),
        pausedDays: 0,
        // A copy of a visible record is visible — a client following OAPIL-146 must not
        // lose its successor.
        clientVisible: original.clientVisible ?? false,
        age: 0,
        daysSinceActivity: 0,
        nextAction: '',
        evidence: '',
        evidenceDate: '',
        verification: 'Entered in Axiomate',
        source: 'Axiomate',
        reference: '',
        clientImpact: original.clientImpact,
        plannedStart: null,
        plannedEnd: null,
        percentOverride: null,
        scheduleMode: 'AUTO',
        // A fresh object rather than the original's. Two records sharing one nested value alias
        // each other's edits, and the write path decides what to persist by object identity.
        assignments: { ...original.assignments },
        deletedAt: null,
      }

      /*
       * The same record `link` builds — same id scheme, same fields, same store — rather than a
       * second way of saying the same thing. `link` remains the description of what a
       * relationship is; this arm is only the place one is minted without anybody asking.
       */
      const rel: IssueRelationship = {
        id: `rel-${seq}`,
        sourceIssueId: id,
        targetIssueId: original.id,
        relationshipType: 'DUPLICATE_OF',
        note: a.note,
      }

      /*
       * `logAll`, not two calls to `log`. `log` reads `state.audit` and returns a new array, so
       * a second call against the same state drops the first entry — and the entry it would drop
       * is the one saying this is a copy, which is the entry that matters.
       */
      return {
        state: {
          ...state,
          seq,
          issues: { ...state.issues, [id]: copy },
          relationships: [...state.relationships, rel],
          audit: logAll(actor, state, [
            {
              rowId: id,
              field: 'created',
              from: null,
              to: `Copy of ${original.id} under ${nameOf(state, original.parentId)}`,
              at: a.now,
              by,
            },
            {
              rowId: id,
              field: 'relationship',
              from: null,
              to: `duplicate of ${original.id}`,
              at: a.now,
              by,
              reason:
                a.note.trim() ||
                'Recorded with the copy, so it can never be read as a second report of the same point.',
            },
          ]),
        },
        createdId: id,
        message: `${id} created as a duplicate of ${original.id}.`,
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

      /* The RAID judgement's bounds, on the PATCH before any spread — validating the merged
         record would refuse an unrelated edit over stored values that were already fine. */
      {
        const raidBad = raidProblem(a.patch)
        if (raidBad) return { state, error: raidBad }
      }

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
      // The join half of the reference, re-resolved ONLY when the owner actually moves —
      // re-resolving on every save would let a later directory change rewrite old joins.
      if (a.patch.owner != null && a.patch.owner !== i.owner) {
        next.ownerId = directoryIdByName(state.model, a.patch.owner)
      }

      // Closing an issue records its completion date; reopening clears it.
      //
      // Guard on the status having actually CHANGED, not merely being present in the patch.
      // The edit form always submits the full record, so a key-presence test would rewrite
      // actualEnd on every save — overwriting a closure date recorded in the source log with
      // today's date, silently, on an unrelated edit such as fixing a typo.
      const terminal = ['Closed - confirmed', 'Closed - no defect', 'Superseded']
      const statusChanged = a.patch.status != null && a.patch.status !== i.status
      if (statusChanged) {
        /*
         * The clock stops while the client holds the ball. Leaving a client-waiting status
         * banks the calendar days spent in it (inclusive span, minus one — in and out the
         * same day banks nothing); health computations shift the due comparison by the bank.
         * The committed date itself never moves. Entry uses statusSince when it exists and
         * falls back to lastActivity for imported rows that predate the field.
         */
        if (BLOCKED_STATUSES.includes(i.status)) {
          const entered = i.statusSince ?? i.lastActivity
          const banked = Math.max(0, daysBetween(entered, a.now.slice(0, 10)) - 1)
          if (banked > 0) next.pausedDays = (i.pausedDays ?? 0) + banked
        }
        next.statusSince = a.now.slice(0, 10)
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
      /*
       * Being handed work is the one event everybody needs told about, and no automation
       * rule should have to exist for it. Raised straight from the arm — every path that
       * changes an owner (grid cell, field strip, board, edit form, the API) lands here, so
       * one mint covers them all. Skipped for self-assignment, which is not news, and for
       * clearing to Unassigned, which is nobody's inbox.
       */
      let notifications = state.notifications
      let seqAfter = state.seq
      const newOwner = a.patch.owner
      if (
        newOwner != null &&
        newOwner !== i.owner &&
        newOwner.trim() &&
        newOwner !== 'Unassigned' &&
        newOwner.trim().toLowerCase() !== by.trim().toLowerCase()
      ) {
        /*
         * The person's own preference, consulted at the mint. Mute skips the record but
         * NEVER the audit line — "why didn't I get this" must have a stored answer — and
         * in-app+email adds a second record for the scheduled pass's drain to send.
         */
        const ownerId = directoryIdByName(state.model, newOwner)
        const mode = modeFor(state.model.notificationPrefs, ownerId, 'assignment')
        if (mode !== 'mute') {
          seqAfter += 1
          const nid = `notif-${seqAfter}`
          notifications = {
            ...notifications,
            [nid]: {
              id: nid,
              to: newOwner,
              toId: ownerId,
              channel: 'in-app',
              subject: `${a.id} is now yours`,
              body: `${by} assigned you ${a.id} — “${next.subject}”.`,
              aboutId: a.id,
              ruleId: 'assignment',
              createdAt: a.now,
              delivery: 'delivered',
              deliveryNote: '',
              readAt: null,
            },
          }
        }
        if (mode === 'in-app+email') {
          seqAfter += 1
          const nid = `notif-${seqAfter}`
          const { delivery, deliveryNote } = deliveryFor('email')
          notifications = {
            ...notifications,
            [nid]: {
              id: nid,
              to: newOwner,
              toId: ownerId,
              channel: 'email',
              subject: `${a.id} is now yours`,
              body: `${by} assigned you ${a.id} — “${next.subject}”.`,
              aboutId: a.id,
              ruleId: 'assignment',
              createdAt: a.now,
              delivery,
              deliveryNote,
              readAt: null,
            },
          }
        }
        if (mode === 'mute') {
          audit = log(
            actor,
            { ...state, audit },
            {
              rowId: a.id,
              field: 'notification',
              from: '',
              to: `in-app → ${newOwner} (muted by their preference)`,
              at: a.now,
              by,
              reason: 'assignment',
            },
          )
        }
      }
      // The warning rides back on the success message, because a note only the audit trail
      // sees arrives too late to be acted on by the person who could still change their mind.
      const ownerNote = ownerVerdict ? availabilityNote(ownerVerdict) : undefined
      return {
        state: { ...state, issues: { ...state.issues, [a.id]: next }, audit, notifications, seq: seqAfter },
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
      if (!canParent(kind, parentKind, tiersOf(state.model))) {
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
        // Keep the denormalised client/module in step with the new position. Same flag-based
        // test as the create arm's inheritance walk — the two must agree or a move rewrites
        // what a create derived.
        const external = externalPartyKinds(tiersOf(state.model))
        let client = issues[a.id].client
        let mod = issues[a.id].module
        let cursor: string | null = a.newParentId
        while (cursor) {
          const n: HierarchyNode | undefined = nodes[cursor]
          if (n?.kind === 'module') mod = n.name
          if (n && external.has(n.kind)) client = n.name
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
        /*
         * Null, always, from this arm. Describing evidence and storing a file are two acts, and
         * this is the first — `recordDocument` stamps the join when bytes actually land. An
         * evidence row that claimed a document before one existed would be the fault the whole
         * entity was built to fix, written by the arm that predates it.
         */
        documentId: null,
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
      const body = a.body
      if (isEmptyRichDoc(body)) return { state, error: 'A note needs something in it.' }
      const bodyText = richTextToPlainText(body)

      const seq = state.seq + 1
      const id = `note-${seq}`
      const note: IssueNote = {
        id,
        issueId: a.issueId,
        body,
        noteType: a.noteType ?? DEFAULT_NOTE_TYPE,
        pinned: a.pinned,
        clientVisible: a.clientVisible ?? false,
        createdBy: by,
        createdAt: a.now,
        updatedBy: null,
        updatedAt: null,
        deletedAt: null,
      }
      /*
       * Naming a colleague tells them. One mint per DISTINCT person, never the author
       * (excluded by directory id — a name comparison would break on a rename), each
       * person's own preference consulted exactly as the other mints do, in sorted-by-id
       * order so the server's replay mints the same ids the optimistic copy did.
       */
      let seqAfter = seq
      let notifications = state.notifications
      let audit = log(actor, state, {
        rowId: a.issueId,
        field: 'note',
        from: null,
        to: note.noteType,
        at: a.now,
        by,
        reason: bodyText.length > 120 ? `${bodyText.slice(0, 117)}…` : bodyText,
      })
      {
        // mentionsIn on the flattened text, not the structural mentionedPeopleIn: nothing
        // produces a real `mention` node yet (the interim <textarea> only ever wraps plain
        // text), so mentionedPeopleIn would silently find nobody. richTextToPlainText(body) on
        // a wrapPlainText'd doc is exactly the trimmed original string, so this is byte-
        // identical to what shipped before body became a RichDoc. Revisit once Step 5's editor
        // produces real mention nodes — mentionedPeopleIn stays defined (RC4) for that.
        const selfId = directoryPersonFor(state.model, actor)?.id ?? null
        const named = mentionsIn(bodyText, Object.values(state.model.people))
          .filter((mn) => mn.id !== selfId)
          .sort((x, y) => x.id.localeCompare(y.id))
        for (const mn of named) {
          const mode = modeFor(state.model.notificationPrefs, mn.id, 'mention')
          if (mode === 'mute') {
            audit = log(
              actor,
              { ...state, audit },
              {
                rowId: a.issueId,
                field: 'notification',
                from: '',
                to: `in-app → ${mn.name} (muted by their preference)`,
                at: a.now,
                by,
                reason: 'mention',
              },
            )
            continue
          }
          seqAfter += 1
          const nid = `notif-${seqAfter}`
          notifications = {
            ...notifications,
            [nid]: {
              id: nid,
              to: mn.name,
              toId: mn.id,
              channel: 'in-app',
              subject: `You were mentioned on ${a.issueId}`,
              body: `${by}: “${bodyText.length > 140 ? `${bodyText.slice(0, 137)}…` : bodyText}”`,
              aboutId: a.issueId,
              ruleId: 'mention',
              createdAt: a.now,
              delivery: 'delivered',
              deliveryNote: '',
              readAt: null,
            },
          }
          if (mode === 'in-app+email') {
            seqAfter += 1
            const eid = `notif-${seqAfter}`
            const { delivery, deliveryNote } = deliveryFor('email')
            notifications = {
              ...notifications,
              [eid]: {
                id: eid,
                to: mn.name,
                toId: mn.id,
                channel: 'email',
                subject: `You were mentioned on ${a.issueId}`,
                body: `${by}: “${bodyText.length > 140 ? `${bodyText.slice(0, 137)}…` : bodyText}”`,
                aboutId: a.issueId,
                ruleId: 'mention',
                createdAt: a.now,
                delivery,
                deliveryNote,
                readAt: null,
              },
            }
          }
        }
      }
      return {
        state: {
          ...state,
          notes: { ...state.notes, [id]: note },
          issues: { ...state.issues, [a.issueId]: { ...issue, lastActivity: a.now.slice(0, 10) } },
          seq: seqAfter,
          notifications,
          audit,
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
      const body = a.patch.body !== undefined ? a.patch.body : note.body
      if (isEmptyRichDoc(body)) return { state, error: 'A note needs something in it.' }
      const bodyText = richTextToPlainText(body)

      const next: IssueNote = {
        ...note,
        ...a.patch,
        body,
        updatedBy: by,
        updatedAt: a.now,
      }
      const changed = (Object.keys(a.patch) as (keyof IssueNote)[]).filter((k) =>
        k === 'body' ? !richDocsEqual(note.body, next.body) : note[k] !== next[k],
      )
      if (!changed.length) return { state, message: 'Nothing changed.' }

      const issue = state.issues[note.issueId]
      return {
        state: (() => {
          /*
           * Only the NEWLY named are told: an edit that keeps a name does not re-ping it.
           * Diffed by directory id, not by offset — moving a name within the body is not a
           * new mention. Same per-person preference walk as addNote's mint.
           */
          let seqAfter = state.seq
          let notifications = state.notifications
          let audit = log(actor, state, {
            rowId: note.issueId,
            field: 'note',
            from: changed[0] === 'body' ? richTextToPlainText(note.body) : String(note[changed[0]] ?? ''),
            to: changed[0] === 'body' ? bodyText : String(next[changed[0]] ?? ''),
            at: a.now,
            by,
            reason: `Note edited (${changed.join(', ')}).`,
          })
          if (changed.includes('body')) {
            // Same reasoning as addNote: string-based mentionsIn on the flattened text until
            // Step 5's editor produces real mention nodes for mentionedPeopleIn to find.
            const selfId = directoryPersonFor(state.model, actor)?.id ?? null
            const people = Object.values(state.model.people)
            const before = new Set(mentionsIn(richTextToPlainText(note.body), people).map((mn) => mn.id))
            const added = mentionsIn(bodyText, people)
              .filter((mn) => !before.has(mn.id) && mn.id !== selfId)
              .sort((x, y) => x.id.localeCompare(y.id))
            for (const mn of added) {
              const mode = modeFor(state.model.notificationPrefs, mn.id, 'mention')
              if (mode === 'mute') {
                audit = log(
                  actor,
                  { ...state, audit },
                  {
                    rowId: note.issueId,
                    field: 'notification',
                    from: '',
                    to: `in-app → ${mn.name} (muted by their preference)`,
                    at: a.now,
                    by,
                    reason: 'mention',
                  },
                )
                continue
              }
              seqAfter += 1
              const nid = `notif-${seqAfter}`
              notifications = {
                ...notifications,
                [nid]: {
                  id: nid,
                  to: mn.name,
                  toId: mn.id,
                  channel: 'in-app',
                  subject: `You were mentioned on ${note.issueId}`,
                  body: `${by}: “${bodyText.length > 140 ? `${bodyText.slice(0, 137)}…` : bodyText}”`,
                  aboutId: note.issueId,
                  ruleId: 'mention',
                  createdAt: a.now,
                  delivery: 'delivered',
                  deliveryNote: '',
                  readAt: null,
                },
              }
              if (mode === 'in-app+email') {
                seqAfter += 1
                const eid = `notif-${seqAfter}`
                const { delivery, deliveryNote } = deliveryFor('email')
                notifications = {
                  ...notifications,
                  [eid]: {
                    id: eid,
                    to: mn.name,
                    toId: mn.id,
                    channel: 'email',
                    subject: `You were mentioned on ${note.issueId}`,
                    body: `${by}: “${bodyText.length > 140 ? `${bodyText.slice(0, 137)}…` : bodyText}”`,
                    aboutId: note.issueId,
                    ruleId: 'mention',
                    createdAt: a.now,
                    delivery,
                    deliveryNote,
                    readAt: null,
                  },
                }
              }
            }
          }
          return {
            ...state,
            notes: { ...state.notes, [a.id]: next },
            issues: issue
              ? { ...state.issues, [note.issueId]: { ...issue, lastActivity: a.now.slice(0, 10) } }
              : state.issues,
            seq: seqAfter,
            notifications,
            audit,
          }
        })(),
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

      /*
       * A task-level entry must name a live task of THIS issue. Checked before anything else
       * about the entry is judged, because an entry filed against another record's task would
       * pass every remaining rule and then sum into the wrong task's actual forever — hours
       * are the thing this workspace is least free to misattribute.
       */
      if (a.activityId) {
        const task = state.activities[a.activityId]
        if (!task || task.deletedAt) return { state, error: 'That task no longer exists.' }
        if (task.issueId !== a.issueId) {
          return { state, error: 'That task belongs to a different record.' }
        }
      }

      /*
       * Authority first, and this rule stays here rather than moving into `timeEntryAllowed`.
       *
       * The two are NOT the same question. This asks whether the actor may record hours for the
       * PERSON named on the entry; `timeEntryAllowed` asks whether that person owns the ISSUE.
       * Under the second, a consultant logging their own hours against a colleague's issue would
       * start being refused — an everyday thing on any shared piece of work, and not something
       * "wire the window rule" should quietly change. So this product's rule is the one below,
       * and the window rule is told the authority question has already been settled.
       */
      if (a.person.trim().toLowerCase() !== by.toLowerCase()) {
        const may = can(state.model, actor, 'time.recordForOthers')
        if (!may.allowed) {
          return {
            state,
            error: `${may.reason ?? 'Not permitted.'} Time is recorded by the person who did the work.`,
          }
        }
      }

      /*
       * The time entry window. `lib/timeWindow.ts` was built, proven and had no production
       * consumer at all; this is the step the work-management design names as carrying the most
       * regression risk, because it puts refusals in front of an arm that always succeeded and
       * lands on a consultant at the end of a week.
       *
       * It replaces the freeze check that used to sit here — the verdict carries it, phrased by
       * `lib/timesheet.ts` either way, so `addTime`, `updateTime` and `removeTime` still refuse
       * a frozen week in the same words. What it ADDS is two refusals that nothing enforced:
       * a closed issue, and a date before the work existed to be worked on.
       *
       * `LOG_FOR_OTHERS` is passed unconditionally, which makes the module's own ownership check
       * unreachable. That is deliberate and is explained above: the authority question was
       * already answered, by a different and narrower rule.
       */
      const verdict = timeEntryAllowed(
        {
          id: issue.id,
          status: issue.status,
          owner: issue.owner,
          raised: issue.raised,
          plannedStart: issue.plannedStart,
          plannedEnd: issue.plannedEnd,
        },
        { name: a.person, permissions: [LOG_FOR_OTHERS] },
        a.date,
        weekStateFor(state, a.person, a.date),
      )
      if (refusesTimeEntry(verdict)) return { state, error: verdict.message }

      /*
       * The grace gate. Lateness is judged by the SERVER's clock (`a.now`), never the
       * browser's — the form's live hint may disagree by a timezone, and this is the
       * authoritative half. Past the workspace's allowance the entry is reconstruction
       * rather than recall, and it records only with a reason on it; the week's decider
       * sees that reason at approval time, which is the second person the rule asks for.
       */
      const lateness = backdated(a.date, today, state.model.timePolicy.backdatingAllowanceDays)
      const justification = (a.justification ?? '').trim()
      if (lateness.justificationRequired && !justification) {
        return {
          state,
          error: `${lateness.message} Add a reason to record it.`,
        }
      }

      const seq = state.seq + 1
      const id = `time-${seq}`
      const entry: TimeEntry = {
        id,
        issueId: a.issueId,
        activityId: a.activityId ?? null,
        person: a.person.trim(),
        personId: directoryIdByName(state.model, a.person),
        date: a.date,
        hours: a.hours,
        activity: a.activity,
        billable: a.billable,
        note: a.note.trim(),
        justification: lateness.justificationRequired ? justification : null,
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
            to: `${a.hours}h · ${a.activity} · ${a.person}${a.activityId ? ` · on ${state.activities[a.activityId]?.phase ?? a.activityId}` : ''}${a.billable ? '' : ' · non-billable'}${lateness.justificationRequired ? ` · ${lateness.days} days late` : ''}`,
            at: a.now,
            by,
          }),
        },
        /*
         * Warnings travel with the confirmation rather than being dropped. `allowed` is not the
         * same as unremarkable — a day past the due date and an over-long day are both worth
         * seeing, and neither is a reason to refuse hours somebody actually worked. The design
         * is explicit that an overrun warns and never refuses.
         */
        message: [`${a.hours}h recorded.`, ...verdict.warnings, dayWarning(state, a.person, a.date, a.hours)]
          .filter(Boolean)
          .join(' '),
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
      // Only when the person actually moves — the same only-on-change rule as ownerId.
      if (next.person !== entry.person) next.personId = directoryIdByName(state.model, next.person)
      const problem = checkEntry(
        { hours: next.hours, date: next.date, person: next.person },
        a.now.slice(0, 10),
      )
      if (problem) return { state, error: problem.message }

      /*
       * The STORED date first, and then the new one if the patch moves it.
       *
       * Checking only the incoming date would let an entry walk out of a frozen week by editing
       * the very field the freeze exists to hold: move Thursday to next Monday, and a submitted
       * week silently loses an hour it was attested with. Both ends have to be open, and for the
       * same reason the person on the entry is read from the stored row rather than the patch.
       */
      const frozenFrom = frozenProblem(state, entry.person, entry.date)
      if (frozenFrom) return { state, error: frozenFrom }
      if (next.date !== entry.date || next.person !== entry.person) {
        const frozenTo = frozenProblem(state, next.person, next.date)
        if (frozenTo) return { state, error: frozenTo }
        /*
         * The window, against the DESTINATION. `addTime` refuses a closed issue and a date
         * before the work existed — and without this, the same entry could be added on a
         * legal date and edited onto an illegal one: a two-step around the refusal, which
         * TW1 recorded as making the control decorative.
         */
        const issueFor = state.issues[entry.issueId]
        if (issueFor) {
          const windowVerdict = timeEntryAllowed(
            {
              id: issueFor.id,
              status: issueFor.status,
              owner: issueFor.owner,
              raised: issueFor.raised,
              plannedStart: issueFor.plannedStart,
              plannedEnd: issueFor.plannedEnd,
            },
            { name: next.person, permissions: [LOG_FOR_OTHERS] },
            next.date,
            weekStateFor(state, next.person, next.date),
          )
          if (refusesTimeEntry(windowVerdict)) return { state, error: windowVerdict.message }
        }
      }

      /*
       * The grace gate, on the STORED entry's date first and the destination if the patch
       * moves it — the same both-ends rule as the freeze check above, and for the same
       * reason: editing is the two-step around any gate on adding. Only a patch that
       * changes the date or the hours is a reconstruction; relabelling the activity or
       * the billing of an old entry changes no claimed number.
       */
      if (next.date !== entry.date || next.hours !== entry.hours) {
        const allowance = state.model.timePolicy.backdatingAllowanceDays
        const today2 = a.now.slice(0, 10)
        const staleFrom = backdated(entry.date, today2, allowance)
        const staleTo = backdated(next.date, today2, allowance)
        const stale = staleFrom.justificationRequired || staleTo.justificationRequired
        const offered = (a.patch.justification ?? '').trim()
        if (stale && !offered) {
          const worst = staleFrom.days >= staleTo.days ? staleFrom : staleTo
          return { state, error: `${worst.message} Add a reason to change it.` }
        }
        if (stale) next.justification = offered
      }

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
      // The stored date, as in `updateTime`. Withdrawing an hour from a submitted week changes
      // the total somebody attested to just as surely as editing it does.
      const frozenHere = frozenProblem(state, entry.person, entry.date)
      if (frozenHere) return { state, error: frozenHere }
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

    /**
     * Present a week for approval.
     *
     * The sheet carries no hours. It says a person claims their week is complete, and the freeze
     * below is what stops the entries moving underneath that claim — see lib/timesheet.ts for why
     * copying the lines onto the sheet was turned down.
     *
     * Resubmission reuses the same row rather than minting a second: a week has one timesheet,
     * and the trail of what happened to it is the audit trail, not a pile of superseded rows.
     */
    /**
     * Record what somebody costs, or is charged out at, from a date.
     *
     * The same shape as `recordVersion` and for the same reasons: a period, a reason, and
     * identity taken from the actor rather than from the action. The differences are that the
     * value is money and that reading it needs a grant of its own.
     */
    /**
     * Raise or amend a variation.
     *
     * It does NOT touch the statement of work. `Sow.effortHours` and `Sow.value` stay as signed,
     * and the contracted position is `baseline + sum(approved changes)` computed on read — see
     * `contractedPosition`. Editing the SOW instead would give the same number today and destroy
     * the ability to say what was originally agreed.
     */
    case 'upsertChangeRequest': {
      const sow = state.sows[a.sowId]
      if (!sow || sow.deletedAt) return { state, error: 'That statement of work no longer exists.' }

      const existing = a.id ? state.changes[a.id] : null
      if (a.id && !existing) return { state, error: 'That change request no longer exists.' }
      /*
       * An approved change is closed. Editing one after the fact would move a contracted figure
       * with no record that it had moved — which is the exact failure this whole model exists to
       * prevent, arrived at from the other direction.
       */
      if (existing && existing.status !== 'Draft' && existing.status !== 'Rejected') {
        return { state, error: `That change request is ${existing.status.toLowerCase()} and cannot be edited. Raise another.` }
      }

      const merged: ChangeRequest = {
        id: existing?.id ?? `cr-${state.seq + 1}`,
        sowId: a.sowId,
        issueId: existing?.issueId ?? null,
        reference: existing?.reference ?? '',
        title: existing?.title ?? '',
        status: existing?.status ?? 'Draft',
        effortHours: existing?.effortHours ?? 0,
        value: existing?.value ?? 0,
        currency: existing?.currency ?? sow.currency,
        scope: existing?.scope ?? '',
        reason: existing?.reason ?? '',
        effectiveFrom: existing?.effectiveFrom ?? null,
        requestedBy: existing?.requestedBy ?? by,
        requestedAt: existing?.requestedAt ?? a.now,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        deletedAt: null,
        ...a.patch,
      }

      const problem = checkChange(merged)
      if (problem) return { state, error: problem.message }

      if (a.submit) merged.status = 'Submitted'

      const seq = existing ? state.seq : state.seq + 1
      return {
        state: {
          ...state,
          seq,
          changes: { ...state.changes, [merged.id]: merged },
          audit: log(actor, state, {
            rowId: merged.id,
            field: 'changeRequest',
            from: existing ? `${existing.status} · ${existing.effortHours}h · ${existing.value}` : null,
            to: `${merged.status} · ${merged.effortHours}h · ${merged.value}`,
            at: a.now,
            by,
            reason: merged.reason,
          }),
        },
        message: a.submit ? `${merged.title} submitted for a decision.` : `${merged.title} saved as a draft.`,
      }
    }

    case 'withdrawChangeRequest': {
      const change = state.changes[a.id]
      if (!change || change.deletedAt) return { state, error: 'That change request no longer exists.' }
      if (change.status === 'Approved') {
        return { state, error: 'An approved change cannot be withdrawn. Raise a reversing change instead, so both movements are on record.' }
      }
      const next: ChangeRequest = { ...change, status: 'Withdrawn' }
      return {
        state: {
          ...state,
          changes: { ...state.changes, [a.id]: next },
          audit: log(actor, state, {
            rowId: a.id, field: 'changeRequest', from: change.status, to: 'Withdrawn', at: a.now, by,
          }),
        },
        message: `${change.title} withdrawn.`,
      }
    }

    /**
     * Approve or refuse a variation.
     *
     * The asker may never be the decider, and that holds whatever grant they carry. Approving is
     * the moment the contracted position moves, so it is the one act here with its own
     * permission rather than sharing `sow.edit`.
     */
    case 'decideChangeRequest': {
      const change = state.changes[a.id] ?? null
      const problem = decideChangeProblem(change, a.decision, a.note, {
        name: actor.name,
        mayApprove: can(state.model, actor, 'change.approve').allowed,
      })
      if (problem) return { state, error: problem }

      const next: ChangeRequest = {
        ...change!,
        status: statusAfterDecision(a.decision),
        decidedBy: by,
        decidedAt: a.now,
        decisionNote: a.decision === 'rejected' ? (a.note ?? '').trim() : (a.note?.trim() || null),
      }
      return {
        state: {
          ...state,
          changes: { ...state.changes, [a.id]: next },
          audit: log(actor, state, {
            rowId: a.id,
            field: 'changeRequest',
            from: 'Submitted',
            to: `${next.status} · ${next.effortHours >= 0 ? '+' : ''}${next.effortHours}h · ${next.effortHours >= 0 ? '+' : ''}${next.value}`,
            at: a.now,
            by,
            reason: next.decisionNote ?? undefined,
          }),
        },
        message:
          a.decision === 'approved'
            ? `${next.title} approved — the contracted position has moved.`
            : `${next.title} refused.`,
      }
    }

    case 'recordRate': {
      if (!a.reason.trim()) {
        return { state, error: 'A rate needs a reason \u2014 "what changed and why" is the whole point of dating it.' }
      }
      if (!(a.amount > 0) || !Number.isFinite(a.amount)) {
        return { state, error: 'A rate is an amount per hour, greater than zero.' }
      }
      if (!state.model.people[a.personId]) {
        return { state, error: 'That person is not in the directory.' }
      }
      const clash = rateProblem(Object.values(state.rates), {
        personId: a.personId,
        kind: a.kind,
        validFrom: a.validFrom,
        validTo: a.validTo,
      })
      if (clash) return { state, error: clash }

      const seq = state.seq + 1
      const id = `rate-${seq}`
      const next: PersonRate = {
        id,
        personId: a.personId,
        kind: a.kind,
        validFrom: a.validFrom,
        validTo: a.validTo,
        amount: a.amount,
        currency: a.currency.trim() || 'GBP',
        recordedAt: a.now,
        by,
        byId: actor.id,
        byEmail: actor.email ?? null,
        reason: a.reason.trim(),
      }
      return {
        state: {
          ...state,
          seq,
          rates: { ...state.rates, [id]: next },
          audit: log(actor, state, {
            rowId: a.personId,
            field: `person.${a.kind}Rate`,
            from: null,
            // The AMOUNT is deliberately not in the trail. An audit row is readable by anybody
            // who may read history, and putting a salary in it would route round the grant that
            // exists to protect it. What changed and when is recorded; what it changed to is in
            // the rate itself, behind `rate.view`.
            to: `from ${a.validFrom}`,
            at: a.now,
            by,
            reason: next.reason,
          }),
        },
        message: `Recorded from ${a.validFrom}.`,
      }
    }

    case 'correctRate': {
      const existing = state.rates[a.id]
      if (!existing) return { state, error: 'That rate no longer exists.' }
      if (!a.reason.trim()) return { state, error: 'A correction needs a reason.' }
      if (a.patch.amount !== undefined && !(a.patch.amount > 0)) {
        return { state, error: 'A rate is an amount per hour, greater than zero.' }
      }
      const candidate = {
        id: existing.id,
        personId: existing.personId,
        kind: existing.kind,
        validFrom: a.patch.validFrom ?? existing.validFrom,
        validTo: a.patch.validTo === undefined ? existing.validTo : a.patch.validTo,
      }
      const clash = rateProblem(Object.values(state.rates), candidate)
      if (clash) return { state, error: clash }

      const next: PersonRate = {
        ...existing,
        ...candidate,
        amount: a.patch.amount ?? existing.amount,
        currency: a.patch.currency?.trim() || existing.currency,
        reason: a.reason.trim(),
      }
      return {
        state: {
          ...state,
          rates: { ...state.rates, [existing.id]: next },
          audit: log(actor, state, {
            rowId: existing.personId,
            field: `person.${existing.kind}Rate`,
            from: `from ${existing.validFrom}`,
            to: `from ${next.validFrom}`,
            at: a.now,
            by,
            reason: next.reason,
          }),
        },
        message: 'Corrected.',
      }
    }

    /**
     * Record what somebody can do.
     *
     * Two gates, and the second one is the point of the feature. `skill.record` got the action
     * through the funnel and covers your own, self-rated. Writing a level against ANOTHER
     * person, or attaching the words "assessed" or "certified" to any level including your own,
     * is a claim with somebody's reputation attached and takes `skill.assess`.
     *
     * The self-certification case is the one worth being explicit about: without the second
     * check, anybody could record themselves as Expert, `certified`, and the product would show
     * a certification nobody issued. `self` is the only source a person can put on their own
     * row unaided, and that is exactly what the word means.
     */
    case 'recordPersonSkill': {
      const person = state.model.people[a.personId]
      // No archived check: `Person` has no `deletedAt`. The directory does not retire people.
      if (!person) return { state, error: 'That person is not in the directory.' }
      const skill = state.model.skills?.[a.skillId]
      if (!skill || skill.deletedAt) {
        return { state, error: 'That skill is not in the catalogue, or has been retired.' }
      }

      const problem = checkPersonSkill({ level: a.level, source: a.source, assessedBy: a.assessedBy })
      if (problem) return { state, error: problem }

      const mine = directoryPersonFor(state.model, actor)
      const own = mine?.id === a.personId
      if (!own || a.source !== 'self') {
        const may = can(state.model, actor, 'skill.assess')
        if (!may.allowed) {
          return {
            state,
            error: own
              ? `${may.reason ?? 'Not permitted.'} You can record your own skills as self-rated; saying they are assessed or certified is somebody else's judgement to record.`
              : `${may.reason ?? 'Not permitted.'} Recording a level against another person needs the grant for it.`,
          }
        }
      }

      // One live row per person per skill. A second would make "what level is she at" a question
      // with two answers, and nothing downstream chooses between them.
      const already = Object.values(state.personSkills).find(
        (p) => !p.deletedAt && p.personId === a.personId && p.skillId === a.skillId,
      )
      if (already) {
        return { state, error: `${person.name} already has ${skill.name} recorded. Correct it rather than adding a second.` }
      }

      const seq = state.seq + 1
      const id = `pskill-${seq}`
      const next: PersonSkill = {
        id,
        personId: a.personId,
        skillId: a.skillId,
        level: a.level,
        source: a.source,
        assessedBy: a.source === 'assessed' ? (a.assessedBy?.trim() || by) : null,
        lastUsedOn: a.lastUsedOn,
        note: a.note.trim(),
        // Never true in storage. The boundary sets it on the copy that leaves.
        withheld: false,
        recordedBy: by,
        recordedAt: a.now,
        deletedAt: null,
      }
      return {
        state: {
          ...state,
          seq,
          personSkills: { ...state.personSkills, [id]: next },
          audit: log(actor, state, {
            rowId: a.personId,
            field: `person.skill.${a.skillId}`,
            from: null,
            // The LEVEL is in the trail, unlike a rate's amount. A rate is pay and the audit is
            // readable by anybody who may read history; a skill level is a delivery fact about
            // capability, and a change to one is the kind of thing a review should be able to
            // see happened. The judgement is protected at the boundary, not by omission here.
            to: `${a.level} (${a.source})`,
            at: a.now,
            by,
          }),
        },
        message: `${skill.name} recorded for ${person.name}.`,
      }
    }

    case 'correctPersonSkill': {
      const existing = state.personSkills[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That skill record no longer exists.' }

      const level = a.patch.level ?? existing.level
      const source = a.patch.source ?? existing.source
      const assessedBy = a.patch.assessedBy === undefined ? existing.assessedBy : a.patch.assessedBy
      const problem = checkPersonSkill({ level, source, assessedBy })
      if (problem) return { state, error: problem }

      const mine = directoryPersonFor(state.model, actor)
      const own = mine?.id === existing.personId
      if (!own || source !== 'self') {
        const may = can(state.model, actor, 'skill.assess')
        if (!may.allowed) {
          return {
            state,
            error: own
              ? `${may.reason ?? 'Not permitted.'} You can correct your own self-rated level; assessed and certified are not yours to set.`
              : `${may.reason ?? 'Not permitted.'} Changing somebody else's recorded level needs the grant for it.`,
          }
        }
      }

      const next: PersonSkill = {
        ...existing,
        level,
        source,
        assessedBy: source === 'assessed' ? (assessedBy?.trim() || by) : null,
        lastUsedOn: a.patch.lastUsedOn === undefined ? existing.lastUsedOn : a.patch.lastUsedOn,
        note: a.patch.note === undefined ? existing.note : a.patch.note.trim(),
        /*
         * `recordedBy` and `recordedAt` are NOT touched, matching `correctRate`.
         *
         * They say who wrote this down and when, and a correction does not change that — a PM
         * fixing a date on an assessment Nishant made must not turn it into a row recorded by
         * the PM. This is the distinction the identity work flagged as the one to get right:
         * a field that identifies WHO SOMEBODY IS moves on a rename, and a field recording WHAT
         * WAS WRITTEN AT THE TIME is never rewritten. These are the second kind.
         *
         * Who made the correction is in the audit trail below, which is where it belongs.
         */
      }
      return {
        state: {
          ...state,
          personSkills: { ...state.personSkills, [existing.id]: next },
          audit: log(actor, state, {
            rowId: existing.personId,
            field: `person.skill.${existing.skillId}`,
            from: `${existing.level} (${existing.source})`,
            to: `${next.level} (${next.source})`,
            at: a.now,
            by,
          }),
        },
        message: 'Corrected.',
      }
    }

    case 'removePersonSkill': {
      const existing = state.personSkills[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That skill record no longer exists.' }

      /*
       * The same two conditions as correcting, and they have to be the same.
       *
       * The first version checked only whether the row was yours, which made the two arms
       * disagree: a consultant could not correct a typo in an assessment written about them,
       * and could delete the whole thing. Withdrawing a signed judgement is the stronger act of
       * the two, so it cannot be the one with the weaker gate.
       *
       * Your own SELF-rated rows stay freely retractable. Saying you can no longer do something
       * is a claim about yourself, and nobody else has put their name to it.
       */
      const mine = directoryPersonFor(state.model, actor)
      if (mine?.id !== existing.personId || existing.source !== 'self') {
        const may = can(state.model, actor, 'skill.assess')
        if (!may.allowed) {
          return {
            state,
            error:
              mine?.id === existing.personId
                // Deliberately does NOT suggest recording a self-rated one alongside it: the
                // one-live-row rule above refuses that, and an error offering a way out the
                // product then blocks is worse than one that simply says who to ask.
                ? `${may.reason ?? 'Not permitted.'} This level was ${existing.source === 'certified' ? 'certified' : 'assessed'} by somebody else, so withdrawing it is theirs to do. Ask ${existing.assessedBy?.trim() || 'whoever recorded it'} if it is wrong.`
                : `${may.reason ?? 'Not permitted.'} Removing somebody else's recorded skill needs the grant for it.`,
          }
        }
      }
      /*
       * Soft, like everything else here. A withdrawn skill is not a skill nobody ever had, and
       * "why did she stop being listed for this" is a question a delivery review asks. It also
       * frees the one-live-row rule above, so the skill can be recorded again.
       */
      return {
        state: {
          ...state,
          personSkills: { ...state.personSkills, [a.id]: { ...existing, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: existing.personId,
            field: `person.skill.${existing.skillId}`,
            from: `${existing.level} (${existing.source})`,
            to: null,
            at: a.now,
            by,
          }),
        },
        message: 'Withdrawn.',
      }
    }

    /**
     * Record a file the store has already accepted.
     *
     * The subject is checked against the collection it names, and that check is here rather than
     * only at the endpoint because of what the intake bug taught: a record pointed at somewhere
     * it cannot live is refused by the reducer with a 409 nobody reads, and the symptom is
     * silence. A document attached to an issue id that does not exist would be worse than
     * silence — it would be an orphan holding real bytes that nothing ever lists, so nobody
     * would know to delete it.
     */
    case 'recordDocument': {
      const bad = subjectProblem(a.subjectKind, a.subjectId)
      if (bad) return { state, error: bad }

      const subjectExists =
        a.subjectKind === 'issue'
          ? Boolean(state.issues[a.subjectId] && !state.issues[a.subjectId].deletedAt)
          : a.subjectKind === 'sow'
            ? Boolean(state.sows[a.subjectId] && !state.sows[a.subjectId].deletedAt)
            : a.subjectKind === 'node'
              ? Boolean(state.nodes[a.subjectId] && !state.nodes[a.subjectId].deletedAt)
              : Boolean(state.changes[a.subjectId] && !state.changes[a.subjectId].deletedAt)
      if (!subjectExists) {
        return { state, error: 'That record no longer exists, so there is nothing to attach the file to.' }
      }

      const problem = uploadProblem({ name: a.name, sizeBytes: a.sizeBytes, mimeType: a.mimeType })
      if (problem) return { state, error: problem }

      /*
       * The same bytes already attached HERE is a double-click, and refusing it keeps a record
       * from showing one file twice. The same bytes on a different subject is two legitimate
       * attachments — one specification against two issues — and is allowed.
       *
       * This refuses AFTER the store has written, which is the cost of storing first. The
       * alternative is checking the checksum before uploading, which cannot be done without
       * reading the whole file anyway, so nothing is saved by reordering it.
       */
      const already = duplicateOf(Object.values(state.documents), {
        subjectKind: a.subjectKind,
        subjectId: a.subjectId,
        checksum: a.checksum,
      })
      if (already) {
        return { state, error: `That exact file is already attached here as “${already.name}”.` }
      }

      /*
       * A new version validates against the TARGET's stored row, never the client's claim:
       * same subject (chains must not cross records), still live, and not already replaced —
       * the chain is linear so “the newest” has one answer.
       */
      if (a.supersedesId) {
        const target = state.documents[a.supersedesId]
        if (!target || target.deletedAt) {
          return { state, error: 'The document this replaces no longer exists.' }
        }
        if (target.subjectKind !== a.subjectKind || target.subjectId !== a.subjectId) {
          return { state, error: 'A new version must live on the same record as the one it replaces.' }
        }
        if (Object.values(state.documents).some((d) => d.supersedesId === target.id && !d.deletedAt)) {
          return { state, error: 'That document already has a newer version.' }
        }
      }

      const seq = state.seq + 1
      const id = `doc-${seq}`
      const next: DocumentRecord = {
        id,
        subjectKind: a.subjectKind,
        subjectId: a.subjectId,
        name: a.name.trim(),
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        checksum: a.checksum,
        locator: a.locator,
        store: a.store,
        note: a.note.trim(),
        uploadedBy: by,
        uploadedById: actor.id,
        uploadedAt: a.now,
        supersedesId: a.supersedesId ?? null,
        clientVisible: a.clientVisible ?? false,
        deletedAt: null,
      }

      /*
       * Joined to an evidence row when one is being described in the same act — evidence says
       * WHY material is attached, a document IS it, and `lib/evidence.ts` opens by explaining
       * why those stay separate concepts. This is the join, not a merge.
       */
      const evidence =
        a.evidenceId && state.evidence[a.evidenceId]
          ? { ...state.evidence, [a.evidenceId]: { ...state.evidence[a.evidenceId], documentId: id } }
          : state.evidence

      return {
        state: {
          ...state,
          seq,
          documents: { ...state.documents, [id]: next },
          evidence,
          audit: log(actor, state, {
            rowId: a.subjectId,
            field: 'document',
            from: null,
            // The name and the size, and deliberately not the locator: an audit row is readable
            // by anybody who may read history, and a storage handle is not history.
            to: `${next.name} (${formatBytes(next.sizeBytes)})`,
            at: a.now,
            by,
          }),
        },
        createdId: id,
        message: `${next.name} attached.`,
      }
    }

    /**
     * Withdraw a file.
     *
     * Soft, and the bytes are deliberately NOT deleted from the store by this arm — the reducer
     * is pure and cannot reach the network. What that means in practice is stated rather than
     * hidden: withdrawing removes the file from every screen and from download, and the object
     * stays in the firm's own document library where an administrator can see it. For evidence
     * that is the right way round. A delete that reaches through to storage would make "withdraw"
     * an irreversible act performed by a single click on a record somebody else may be relying on.
     */
    case 'removeDocument': {
      const existing = state.documents[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That file is no longer attached.' }

      const mineToTouch =
        existing.uploadedById === actor.id ||
        existing.uploadedBy.trim().toLowerCase() === by.trim().toLowerCase()
      if (!mineToTouch) {
        const may = can(state.model, actor, 'document.remove')
        if (!may.allowed) {
          return { state, error: `${may.reason ?? 'Not permitted.'} ${existing.uploadedBy} attached this.` }
        }
      }

      /* The evidence row that pointed at it stops pointing, so nothing offers a dead link. */
      const evidence = Object.fromEntries(
        Object.entries(state.evidence).map(([k, e]) =>
          e.documentId === a.id ? [k, { ...e, documentId: null }] : [k, e],
        ),
      )

      return {
        state: {
          ...state,
          documents: { ...state.documents, [a.id]: { ...existing, deletedAt: a.now } },
          evidence,
          audit: log(actor, state, {
            rowId: existing.subjectId,
            field: 'document',
            from: existing.name,
            to: null,
            at: a.now,
            by,
          }),
        },
        message: 'Withdrawn. The file stays in the document library.',
      }
    }

    case 'upsertScopeItem': {
      const sow = state.sows[a.sowId]
      if (!sow || sow.deletedAt) return { state, error: 'That statement of work no longer exists.' }

      const existing = a.id ? state.scopeItems[a.id] : null
      if (a.id && !existing) return { state, error: 'That line of scope no longer exists.' }
      /*
       * An agreed line is not editable. Somebody confirmed this wording IS the scope, and
       * changing it afterwards would alter what was agreed without anybody deciding to — the
       * same rule an accepted milestone has, for the same reason. Un-agree it first, which is
       * `decideScopeItem` with `approved: false` and leaves both moves on the trail.
       */
      if (existing?.approvedAt) {
        return { state, error: 'That line has been agreed. Un-agree it first if the wording is wrong — changing agreed scope silently is how a contract and a plan stop matching.' }
      }

      const parentId = a.patch.parentId === undefined ? (existing?.parentId ?? null) : a.patch.parentId
      if (parentId) {
        const bad = parentProblem(Object.values(state.scopeItems), existing?.id ?? null, parentId)
        if (bad) return { state, error: bad }
        if (state.scopeItems[parentId].sowId !== a.sowId) {
          return { state, error: 'That line belongs to a different statement of work.' }
        }
      }

      const seq = existing ? state.seq : state.seq + 1
      const id = existing?.id ?? `scope-${seq}`
      const kind = a.patch.kind ?? existing?.kind ?? 'deliverable'
      const merged: ScopeItem = {
        id,
        sowId: a.sowId,
        kind,
        text: (a.patch.text ?? existing?.text ?? '').trim(),
        parentId,
        // Read against the MERGED kind, so switching a deliverable to an exclusion drops the
        // hours rather than leaving them behind a kind that cannot carry them.
        effortHours: a.patch.effortHours === undefined ? (existing?.effortHours ?? null) : a.patch.effortHours,
        source: a.patch.source ?? existing?.source ?? 'stated',
        sequence: a.patch.sequence ?? existing?.sequence ?? nextScopeSequence(state.scopeItems, a.sowId),
        approvedBy: existing?.approvedBy ?? null,
        approvedAt: existing?.approvedAt ?? null,
        recordedBy: by,
        recordedAt: a.now,
        deletedAt: null,
      }

      const problem = checkScopeItem(merged)
      if (problem) return { state, error: problem }

      return {
        state: {
          ...state,
          seq,
          scopeItems: { ...state.scopeItems, [id]: merged },
          audit: log(actor, state, {
            rowId: a.sowId,
            field: `scope.${merged.kind}`,
            from: existing?.text ?? null,
            to: merged.text,
            at: a.now,
            by,
          }),
        },
        createdId: existing ? undefined : id,
        message: existing ? 'Scope updated.' : 'Scope recorded. It is not agreed until somebody agrees it.',
      }
    }

    case 'removeScopeItem': {
      const existing = state.scopeItems[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That line of scope no longer exists.' }
      if (existing.approvedAt) {
        return { state, error: 'That line has been agreed. Un-agree it before removing it, so the trail says somebody decided rather than that it vanished.' }
      }
      /*
       * Children go with the parent. A criterion judging a deliverable that is no longer in
       * scope is judging nothing, and leaving it behind would put an orphan in a list that reads
       * as the agreement.
       */
      const orphans = Object.values(state.scopeItems).filter(
        (i) => i.parentId === a.id && !i.deletedAt,
      )
      const agreedChild = orphans.find((i) => i.approvedAt)
      if (agreedChild) {
        return { state, error: `“${agreedChild.text.slice(0, 40)}” sits under this and has been agreed. Un-agree it first.` }
      }

      const next = { ...state.scopeItems, [a.id]: { ...existing, deletedAt: a.now } }
      for (const child of orphans) next[child.id] = { ...child, deletedAt: a.now }

      return {
        state: {
          ...state,
          scopeItems: next,
          audit: log(actor, state, {
            rowId: existing.sowId,
            field: `scope.${existing.kind}`,
            from: existing.text,
            to: null,
            at: a.now,
            by,
          }),
        },
        message: orphans.length
          ? `Removed, with ${orphans.length} line${orphans.length === 1 ? '' : 's'} that sat under it.`
          : 'Removed.',
      }
    }

    /**
     * Agree a line into the scope, or take it back out.
     *
     * No "asker cannot be the decider" rule here, unlike a change request or a milestone, and
     * the reason is stated rather than omitted: transcribing a signed statement of work is not
     * proposing something, and the only other producer of scope lines is an extraction that
     * holds no grant at all. A firm wanting segregation withholds `scope.approve`.
     */
    case 'decideScopeItem': {
      const existing = state.scopeItems[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That line of scope no longer exists.' }
      if (Boolean(existing.approvedAt) === a.approved) {
        return { state, error: a.approved ? 'That line is already agreed.' : 'That line is not agreed.' }
      }
      if (a.approved && existing.parentId) {
        const parent = state.scopeItems[existing.parentId]
        if (parent && !parent.deletedAt && !parent.approvedAt) {
          return { state, error: `“${parent.text.slice(0, 40)}” has not been agreed yet, and this sits under it.` }
        }
      }

      const next: ScopeItem = {
        ...existing,
        approvedBy: a.approved ? by : null,
        approvedAt: a.approved ? a.now : null,
      }
      return {
        state: {
          ...state,
          scopeItems: { ...state.scopeItems, [a.id]: next },
          audit: log(actor, state, {
            rowId: existing.sowId,
            field: `scope.${existing.kind}`,
            from: existing.approvedAt ? 'agreed' : 'recorded',
            to: a.approved ? 'agreed' : 'recorded',
            at: a.now,
            by,
          }),
        },
        message: a.approved ? 'Agreed. Its hours now count toward the scope total.' : 'No longer agreed.',
      }
    }

    case 'upsertMilestone': {
      const sow = state.sows[a.sowId]
      if (!sow || sow.deletedAt) return { state, error: 'That statement of work no longer exists.' }

      const existing = a.id ? state.milestones[a.id] : null
      if (a.id && !existing) return { state, error: 'That milestone no longer exists.' }
      /*
       * An accepted milestone is not editable. Its value was frozen at acceptance and the client
       * has signed against a name and a description; changing either afterwards would alter what
       * was accepted without anybody deciding to. Withdraw it and record a new one, which leaves
       * both on the trail.
       */
      if (existing?.acceptance === 'Accepted') {
        return { state, error: 'That milestone has been accepted. Record a new one rather than changing what was signed off.' }
      }

      const seq = existing ? state.seq : state.seq + 1
      const id = existing?.id ?? `ms-${seq}`
      const merged: Milestone = {
        id,
        sowId: a.sowId,
        name: a.patch.name ?? existing?.name ?? '',
        description: a.patch.description ?? existing?.description ?? '',
        sequence: a.patch.sequence ?? existing?.sequence ?? nextSequence(state.milestones, a.sowId),
        basis: a.patch.basis ?? existing?.basis ?? 'percentage',
        // Read from the merged basis rather than the patch, so switching basis clears the other
        // side instead of leaving a stale amount behind a percentage.
        percentage: null,
        amount: null,
        currency: a.patch.currency ?? existing?.currency ?? sow.currency,
        billOn: a.patch.billOn ?? existing?.billOn ?? 'acceptance',
        plannedDate: a.patch.plannedDate === undefined ? (existing?.plannedDate ?? null) : a.patch.plannedDate,
        delivery: a.patch.delivery ?? existing?.delivery ?? 'Planned',
        deliveredAt: existing?.deliveredAt ?? null,
        deliveredBy: existing?.deliveredBy ?? null,
        acceptance: existing?.acceptance ?? 'Pending',
        acceptedAt: existing?.acceptedAt ?? null,
        acceptedBy: existing?.acceptedBy ?? null,
        rejectionNote: existing?.rejectionNote ?? null,
        acceptedValue: existing?.acceptedValue ?? null,
        evidenceDocumentId: existing?.evidenceDocumentId ?? null,
        recordedBy: by,
        recordedAt: a.now,
        deletedAt: null,
      }
      if (merged.basis === 'percentage') {
        merged.percentage = a.patch.percentage ?? existing?.percentage ?? null
      } else {
        merged.amount = a.patch.amount ?? existing?.amount ?? null
      }

      const problem = checkMilestone(merged)
      if (problem) return { state, error: problem }

      /*
       * The SET's total is deliberately NOT checked here. A firm entering four milestones passes
       * through 25, 60 and 85 on the way to 100, and refusing any set that does not total 100
       * would make the second one impossible to save. `scheduleProblem` reports it beside the
       * schedule instead — the same shape `describeCapacity` uses for an assumed working pattern.
       */
      return {
        state: {
          ...state,
          seq,
          milestones: { ...state.milestones, [id]: merged },
          audit: log(actor, state, {
            rowId: a.sowId,
            field: 'milestone',
            from: existing?.name ?? null,
            to: merged.name,
            at: a.now,
            by,
          }),
        },
        createdId: existing ? undefined : id,
        message: existing ? `${merged.name} updated.` : `${merged.name} added to the schedule.`,
      }
    }

    case 'removeMilestone': {
      const existing = state.milestones[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That milestone no longer exists.' }
      if (existing.acceptance === 'Accepted') {
        return { state, error: 'That milestone has been accepted. Removing it would delete a record the client signed against.' }
      }
      return {
        state: {
          ...state,
          milestones: { ...state.milestones, [a.id]: { ...existing, deletedAt: a.now } },
          audit: log(actor, state, {
            rowId: existing.sowId, field: 'milestone', from: existing.name, to: null, at: a.now, by,
          }),
        },
        message: `${existing.name} removed from the schedule.`,
      }
    }

    /**
     * Say the work has landed.
     *
     * Its own arm rather than a `delivery` patch through `upsertMilestone`, because this is the
     * act the acceptance rule is measured against: `deliveredBy` is what stops the same person
     * accepting it. Buried inside a general patch, that name would be set by whoever last edited
     * any field.
     */
    case 'deliverMilestone': {
      const existing = state.milestones[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That milestone no longer exists.' }
      const problem = deliverProblem(existing)
      if (problem) return { state, error: problem }

      const next: Milestone = {
        ...existing,
        delivery: 'Delivered',
        deliveredAt: a.now,
        deliveredBy: by,
        // A returned milestone presented again is Pending once more, not still Rejected.
        acceptance: existing.acceptance === 'Rejected' ? 'Pending' : existing.acceptance,
      }
      return {
        state: {
          ...state,
          milestones: { ...state.milestones, [a.id]: next },
          audit: log(actor, state, {
            rowId: existing.sowId,
            field: 'milestone.delivery',
            from: existing.delivery,
            to: 'Delivered',
            at: a.now,
            by,
          }),
        },
        message: `${existing.name} recorded as delivered. It is not billable until it is accepted.`,
      }
    }

    case 'decideMilestone': {
      const existing = state.milestones[a.id]
      if (!existing || existing.deletedAt) return { state, error: 'That milestone no longer exists.' }
      const problem = acceptProblem(existing, a.decision, a.note, by)
      if (problem) return { state, error: problem }

      if (a.evidenceDocumentId && !state.documents[a.evidenceDocumentId]) {
        return { state, error: 'That acceptance document is not held here.' }
      }

      /*
       * The value is frozen at acceptance, and this is the one place a derived figure becomes a
       * recorded fact in this entity. The argument is in `Milestone.acceptedValue`: an approved
       * change request correctly moves a percentage milestone that has not been signed off, and
       * moving one that HAS been signed off would retroactively change what the client agreed to
       * pay for work they have already accepted.
       */
      /*
       * Guarded, unlike the first version of this arm. `contractedPosition` dereferences the SOW,
       * so an archived one would throw from inside the reducer rather than return an `OpResult` —
       * and "the reducer always returns a result" is the invariant the whole funnel rests on.
       * `upsertMilestone` checks this; this arm did not, which is exactly how one path gets a
       * guard and its sibling does not.
       */
      const parent = state.sows[existing.sowId]
      if (!parent) return { state, error: 'That statement of work no longer exists.' }
      const contracted = contractedPosition(parent, Object.values(state.changes))
      const frozen = a.decision === 'Accepted' ? milestoneValue(existing, contracted) : null

      const next: Milestone = {
        ...existing,
        acceptance: a.decision,
        acceptedAt: a.now,
        acceptedBy: by,
        rejectionNote: a.decision === 'Rejected' ? (a.note?.trim() ?? '') : null,
        acceptedValue: frozen,
        evidenceDocumentId: a.evidenceDocumentId ?? existing.evidenceDocumentId,
      }
      return {
        state: {
          ...state,
          milestones: { ...state.milestones, [a.id]: next },
          audit: log(actor, state, {
            rowId: existing.sowId,
            field: 'milestone.acceptance',
            from: existing.acceptance,
            to: a.decision,
            at: a.now,
            by,
            reason: a.note?.trim() || undefined,
          }),
        },
        message:
          a.decision === 'Accepted'
            ? `${existing.name} accepted${frozen === null ? '' : ` at ${next.currency} ${frozen.toLocaleString()}`}.`
            : `${existing.name} returned.`,
      }
    }

    case 'submitTimesheet': {
      const attester = attesterFor(state, actor)
      const problem = submitProblem(
        Object.values(state.timesheets),
        a.person,
        a.weekStarting,
        attester,
      )
      if (problem) return { state, error: problem }

      const existing = sheetFor(Object.values(state.timesheets), a.person, a.weekStarting)
      const seq = existing ? state.seq : state.seq + 1
      const id = existing?.id ?? `ts-${seq}`
      const total = weekTotal(Object.values(state.timeEntries), a.person, a.weekStarting)
      const sheet: Timesheet = {
        id,
        person: a.person.trim(),
        personId: directoryIdByName(state.model, a.person),
        weekStarting: a.weekStarting,
        status: 'Submitted',
        submittedAt: a.now,
        submittedBy: by,
        // Cleared on resubmission. The previous decision is in the trail; leaving it on the row
        // would show a returned reason against a week that has since been sent back for review.
        decidedAt: null,
        decidedBy: null,
        reason: null,
      }
      /* The approvers hear a week is waiting — resubmissions included, since a returned week
       * coming back is exactly what a decider is waiting on. Counter continues from THIS
       * arm's seq: a new sheet already spent state.seq + 1 on its own id. */
      const submitterExcl = new Set(
        [sheet.personId, directoryPersonFor(state.model, actor)?.id].filter((x): x is string => Boolean(x)),
      )
      const deciders = grantHolders(state, 'time.approve', submitterExcl).filter(
        (h) => h.name.trim().toLowerCase() !== sheet.person.trim().toLowerCase(),
      )
      const minted = mintApproval(
        state,
        state.notifications,
        seq,
        deciders,
        `Timesheet to decide — ${sheet.person}`,
        `${sheet.person} submitted ${weekLabel(a.weekStarting)} — ${total.hours}h. Decide it on the Timesheets view.`,
        id,
        'timesheet-submitted',
        a.now,
      )
      let audit = log(actor, state, {
        rowId: id,
        field: 'timesheet',
        from: existing ? existing.status : null,
        to: `Submitted · ${total.hours}h`,
        at: a.now,
        by,
      })
      for (const m of minted.muted) {
        audit = log(actor, { ...state, audit }, {
          rowId: id,
          field: 'notification',
          from: '',
          to: `in-app → ${m.name} (muted by their preference)`,
          at: a.now,
          by,
          reason: 'approval',
        })
      }
      return {
        state: {
          ...state,
          seq: minted.seq,
          timesheets: { ...state.timesheets, [id]: sheet },
          notifications: minted.notifications,
          audit,
        },
        message: `${weekLabel(a.weekStarting)} submitted — ${total.hours}h.`,
      }
    }

    /**
     * Approve a week, or return it.
     *
     * The decision lives on the timesheet row rather than in an `Approval`. `ApprovalRule` gates
     * entry into an issue status for a work type, and a timesheet has neither — so what is reused
     * from that module is the `ApprovalDecision` type and the asker-is-not-the-decider rule,
     * which `decideProblem` restates.
     */
    case 'decideTimesheet': {
      const sheet = state.timesheets[a.id] ?? null
      const attester = attesterFor(state, actor)
      const problem = decideProblem(sheet, a.decision, a.reason, attester, directoryPersonFor(state.model, actor)?.id ?? null)
      if (problem) return { state, error: problem }

      const next: Timesheet = {
        ...sheet!,
        status: statusAfter(a.decision),
        decidedAt: a.now,
        decidedBy: by,
        reason: a.decision === 'rejected' ? (a.reason ?? '').trim() : null,
      }
      /* The submitter hears the answer, rejection reason included — a timesheet reason is a
       * working instruction, not a private fact like a leave reason. */
      const minted = mintApproval(
        state,
        state.notifications,
        state.seq,
        [{ id: next.personId ?? null, name: next.person }],
        `Your ${weekLabel(next.weekStarting)}: ${a.decision}`,
        a.decision === 'approved'
          ? `${by} approved your ${weekLabel(next.weekStarting)}.`
          : `${by} returned your ${weekLabel(next.weekStarting)}.${next.reason ? ` “${next.reason}”` : ''}`,
        a.id,
        'timesheet-decided',
        a.now,
      )
      let audit = log(actor, state, {
        rowId: a.id,
        field: 'timesheet',
        from: sheet!.status,
        to: next.status,
        at: a.now,
        by,
        reason: next.reason ?? undefined,
      })
      for (const m of minted.muted) {
        audit = log(actor, { ...state, audit }, {
          rowId: a.id,
          field: 'notification',
          from: '',
          to: `in-app → ${m.name} (muted by their preference)`,
          at: a.now,
          by,
          reason: 'approval',
        })
      }
      return {
        state: {
          ...state,
          timesheets: { ...state.timesheets, [a.id]: next },
          seq: minted.seq,
          notifications: minted.notifications,
          audit,
        },
        message:
          a.decision === 'approved'
            ? `${weekLabel(next.weekStarting)} approved.`
            : `${weekLabel(next.weekStarting)} returned to ${next.person}.`,
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
    case 'setDocumentVisibility': {
      const doc = state.documents[a.id]
      if (!doc || doc.deletedAt) return { state, error: 'That document does not exist or was removed.' }
      if ((doc.clientVisible ?? false) === a.clientVisible) return { state }
      return {
        state: {
          ...state,
          documents: { ...state.documents, [a.id]: { ...doc, clientVisible: a.clientVisible } },
          audit: log(actor, state, {
            rowId: doc.subjectId,
            field: 'document',
            from: doc.clientVisible ? 'client-visible' : 'internal',
            to: a.clientVisible ? 'client-visible' : 'internal',
            at: a.now,
            by,
            reason: `“${doc.name}” ${a.clientVisible ? 'made visible to the client' : 'made internal'}.`,
          }),
        },
        message: a.clientVisible ? 'Visible to the client.' : 'Internal again.',
      }
    }

    /* ---------------- PROOFING ---------------- */

    case 'requestDocumentReview': {
      const doc = state.documents[a.documentId]
      if (!doc || doc.deletedAt) return { state, error: 'That document does not exist or was removed.' }
      if (doc.subjectKind !== 'issue' || !state.issues[doc.subjectId] || state.issues[doc.subjectId].deletedAt) {
        return { state, error: 'Reviews are asked on documents attached to a live issue.' }
      }
      const reviewers = [...new Set(a.reviewers.map((r) => r.trim()).filter(Boolean))]
      if (!reviewers.length) return { state, error: 'Name at least one reviewer.' }
      if (reviewers.some((r) => r.toLowerCase() === by.trim().toLowerCase())) {
        return { state, error: 'The asker cannot be a reviewer — the same rule approvals hold to. Name somebody else.' }
      }
      const question = a.question.trim()
      if (!question) return { state, error: 'Say what the reviewers are judging.' }

      const seq = state.seq + 1
      const id = `rev-${seq}`
      const review: DocumentReview = {
        id,
        documentId: doc.id,
        /* Pinned from the STORED row — an action-supplied checksum could name bytes that
           were never stored. */
        checksum: doc.checksum,
        issueId: doc.subjectId,
        question,
        askedBy: by,
        askedAt: a.now,
        reviewers,
        verdicts: [],
        withdrawnAt: null,
        deletedAt: null,
      }
      return {
        state: {
          ...state,
          seq,
          documentReviews: { ...state.documentReviews, [id]: review },
          audit: log(actor, state, {
            rowId: doc.subjectId,
            field: 'review',
            from: null,
            to: `asked on “${doc.name}” → ${reviewers.join(', ')}`,
            at: a.now,
            by,
            reason: question,
          }),
        },
        message: `Review asked of ${reviewers.join(', ')}.`,
      }
    }

    case 'decideDocumentReview': {
      const review = state.documentReviews[a.reviewId]
      if (!review || review.deletedAt) return { state, error: 'That review no longer exists.' }
      if (review.withdrawnAt) return { state, error: 'This review was withdrawn; ask a new one if it still matters.' }
      if (review.askedBy.trim().toLowerCase() === by.trim().toLowerCase()) {
        return { state, error: 'The asker cannot be the decider — the rule holds here as it does for approvals.' }
      }
      if (!review.reviewers.some((r) => r.trim().toLowerCase() === by.trim().toLowerCase())) {
        return { state, error: 'This review names its reviewers, and you are not one of them.' }
      }
      const note = a.note.trim()
      if (a.verdict === 'changes' && !note) {
        return { state, error: 'A change request that names no change is noise — say what should change.' }
      }

      /* A second answer by the same reviewer REPLACES the first. Completion counts
         reviewers, not verdicts — changing your mind must not complete a review early. */
      const verdicts = [
        ...review.verdicts.filter((v) => v.by.trim().toLowerCase() !== by.trim().toLowerCase()),
        { by, verdict: a.verdict, note, at: a.now },
      ]
      const next: DocumentReview = { ...review, verdicts }

      let seq = state.seq
      let notes = state.notes
      const done = reviewStateOf(next)
      if (done.answered === done.total) {
        /* Minted inside the arm, so the server's replay writes the same note the browser's
           optimistic copy did — the assignment-notification precedent. */
        seq += 1
        const nid = `note-${seq}`
        const doc = state.documents[review.documentId]
        notes = {
          ...notes,
          [nid]: {
            id: nid,
            issueId: review.issueId,
            body: wrapPlainText(`Review of “${doc?.name ?? review.documentId}” — ${done.outcome === 'approved' ? 'APPROVED' : 'changes requested'}: ${verdicts
              .map((v) => `${v.by} (${v.verdict}${v.note ? ` — ${v.note}` : ''})`)
              .join('; ')}.
Question: ${review.question}`),
            noteType: 'Decision',
            pinned: true,
            createdBy: by,
            createdAt: a.now,
            updatedBy: null,
            updatedAt: null,
            deletedAt: null,
          },
        }
      }

      return {
        state: {
          ...state,
          seq,
          notes,
          documentReviews: { ...state.documentReviews, [a.reviewId]: next },
          audit: log(actor, state, {
            rowId: review.issueId,
            field: 'review',
            from: review.id,
            to: `${a.verdict}${note ? ` — ${note.length > 90 ? `${note.slice(0, 87)}…` : note}` : ''}`,
            at: a.now,
            by,
          }),
        },
        message:
          done.answered === done.total
            ? `Review complete — ${done.outcome === 'approved' ? 'approved' : 'changes requested'}. Recorded in Notes.`
            : 'Recorded.',
      }
    }

    case 'withdrawDocumentReview': {
      const review = state.documentReviews[a.reviewId]
      if (!review || review.deletedAt) return { state, error: 'That review no longer exists.' }
      if (review.withdrawnAt) return { state, message: 'Already withdrawn.' }
      return {
        state: {
          ...state,
          documentReviews: {
            ...state.documentReviews,
            [a.reviewId]: { ...review, withdrawnAt: a.now },
          },
          audit: log(actor, state, {
            rowId: review.issueId,
            field: 'review',
            from: review.id,
            to: 'withdrawn',
            at: a.now,
            by,
          }),
        },
        message: 'Review withdrawn.',
      }
    }

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
      /*
       * The person's overlay on a rule's channel — only when the target resolves to a
       * directory person, because a preference belongs to a person and a role label is
       * not one. Mute suppresses whatever the rule chose, with the audit line saying so;
       * in-app+email adds the email record only when the rule was not already emailing.
       */
      const prefId = directoryIdByName(state.model, a.to)
      const prefMode = modeFor(state.model.notificationPrefs, prefId, 'automation')
      if (prefMode === 'mute') {
        return {
          state: {
            ...state,
            audit: log(actor, state, {
              rowId: a.aboutId,
              field: 'notification',
              from: '',
              to: `${a.channel} → ${a.to} (muted by their preference)`,
              at: a.now,
              by,
              reason: a.ruleId,
            }),
          },
        }
      }
      const seq = state.seq + 1
      const id = `notif-${seq}`
      const { delivery, deliveryNote } = deliveryFor(a.channel)
      const notification: Notification = {
        id,
        to: a.to,
        // Role labels and unknowns stay null by design — see directoryIdByName.
        toId: directoryIdByName(state.model, a.to),
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
      let notifications: Record<string, Notification> = { ...state.notifications, [id]: notification }
      let seqAfter = seq
      if (prefMode === 'in-app+email' && a.channel !== 'email') {
        seqAfter += 1
        const eid = `notif-${seqAfter}`
        const emailOutcome = deliveryFor('email')
        notifications = {
          ...notifications,
          [eid]: {
            ...notification,
            id: eid,
            channel: 'email',
            delivery: emailOutcome.delivery,
            deliveryNote: emailOutcome.deliveryNote,
          },
        }
      }
      return {
        state: {
          ...state,
          notifications,
          seq: seqAfter,
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

    case 'setNotificationPref': {
      const problem = notificationPrefProblem(a.kind, a.mode)
      if (problem) return { state, error: problem }
      const person = state.model.people[a.personId]
      if (!person) {
        return { state, error: 'Preferences belong to a directory person, and that id resolves to nobody.' }
      }
      /*
       * Self-service is the gate, not a grant: preferences are the person's own, and the
       * one exception is the operator who configures the platform. The same shape as note
       * authorship — the arm knows whose record this is, the permission table cannot.
       */
      const self = directoryPersonFor(state.model, actor)?.id === a.personId
      if (!self && !can(state.model, actor, 'config.manage').allowed) {
        return {
          state,
          error: `Preferences are the person's own. Changing ${person.name}'s needs “Configure the platform”.`,
        }
      }
      const current = modeFor(state.model.notificationPrefs, a.personId, a.kind)
      if (current === a.mode) return { state, message: 'Nothing changed.' }
      return {
        state: {
          ...state,
          model: {
            ...state.model,
            notificationPrefs: {
              ...state.model.notificationPrefs,
              [a.personId]: {
                ...(state.model.notificationPrefs[a.personId] ?? {}),
                [a.kind]: a.mode,
              },
            },
          },
          audit: log(actor, state, {
            rowId: a.personId,
            field: 'notification.prefs',
            from: `${a.kind}: ${current}`,
            to: `${a.kind}: ${a.mode}`,
            at: a.now,
            by,
          }),
        },
        message: `Noted — ${a.kind} is now ${a.mode} for ${person.name}.`,
      }
    }

    case 'updateCareerProfile': {
      const person = state.model.people[a.id]
      if (!person) {
        return { state, error: 'A career profile belongs to a directory person, and that id resolves to nobody.' }
      }
      /*
       * The same shape as `setNotificationPref` just above: self-service is the gate, not a
       * grant, and the one exception is the operator who configures the platform. The arm knows
       * whose record this is; the permission table cannot.
       */
      const self = directoryPersonFor(state.model, actor)?.id === a.id
      if (!self && !can(state.model, actor, 'config.manage').allowed) {
        return {
          state,
          error: `Grade, track and development are the person's own to state. Changing ${person.name}'s needs “Configure the platform”.`,
        }
      }
      /*
       * `career()` omits a field entirely from its returned patch when it resolves to "clear it"
       * — that's how `upsertPerson` reads as a fresh `Person` object literal instead of a merge,
       * so an absent key never falls back to a stale one. `{ ...person, ...career(...) }` would
       * break that: object spread only overwrites keys present in the source, so a cleared field
       * would silently keep its old value instead of clearing. Dropping the three career fields
       * from the base before applying the patch keeps this arm's semantics identical to
       * upsertPerson's, the one other caller of `career()`.
       */
      const { grade: _grade, track: _track, developingToward: _developingToward, source: _source, ...rest } = person
      const nextPerson: Person = { ...rest, ...career(a.patch, person) }
      // Career-only, not the wider `${name} — roles` shape upsertPerson's audit uses — name and
      // roles never move through this arm, so showing them would pad every entry with two facts
      // that never changed.
      const fmt = (p: Person) =>
        `grade: ${p.grade ?? '—'}, track: ${p.track ?? '—'}, developing toward: ${p.developingToward ?? '—'}`
      if (fmt(person) === fmt(nextPerson)) return { state, message: 'Nothing changed.' }
      return {
        state: {
          ...state,
          model: { ...state.model, people: { ...state.model.people, [a.id]: nextPerson } },
          audit: log(actor, state, {
            rowId: a.id,
            field: 'person.career',
            from: fmt(person),
            to: fmt(nextPerson),
            at: a.now,
            by,
          }),
        },
        message: `${person.name}'s career profile updated.`,
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

    case 'markNotificationDelivery': {
      const n = state.notifications[a.id]
      if (!n) return { state, error: 'That notification no longer exists.' }
      if (n.delivery === a.delivery && n.deliveryNote === a.note) return { state }
      return {
        state: {
          ...state,
          notifications: {
            ...state.notifications,
            [a.id]: { ...n, delivery: a.delivery, deliveryNote: a.note },
          },
          // "Was anyone told" is part of the record's story, so the outcome is audited
          // against the record the message was about — same rowId as the raise.
          audit: log(actor, state, {
            rowId: n.aboutId,
            field: 'notification',
            from: n.delivery,
            to: a.note ? `${a.delivery} — ${a.note}` : a.delivery,
            at: a.now,
            by,
            reason: n.ruleId,
          }),
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
                // The SOW, not the engagement. Filed under `engagementId` this was not a queryable
          // history: two statements of work under one engagement interleaved into one stream,
          // and `ScheduleAudit` is indexed on `(tenantId, rowId, at)`.
          rowId: next.id,
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

    case 'recordVersion': {
      if (!a.reason.trim()) {
        return { state, error: 'A version needs a reason — a record that cannot explain itself later is most of the point thrown away.' }
      }
      /*
       * A version records what was true. Null records nothing, and storing it would produce a
       * row that reads as an answer — `valueAt` would return it, and the caller would take it
       * for a working pattern rather than for the absence of one. Absence is already expressed,
       * by there being no version covering the date.
       */
      if (a.value === null || a.value === undefined) {
        return { state, error: 'A version needs a value. Nothing recorded is said by there being no version, not by an empty one.' }
      }
      const candidate = {
        subjectKind: a.subjectKind,
        subjectId: a.subjectId,
        validFrom: a.validFrom,
        validTo: a.validTo ?? null,
      }
      const clash = overlapProblem(Object.values(state.versions), candidate)
      if (clash) return { state, error: clash }

      const seq = state.seq + 1
      const id = `ver-${seq}`
      const next: Version<unknown> = {
        id,
        ...candidate,
        value: a.value,
        recordedAt: a.now,
        // From the actor, like the audit entry — never from the action, which would let a
        // client attribute a version to somebody else.
        by,
        byId: actor.id,
        byEmail: actor.email ?? null,
        reason: a.reason.trim(),
      }
      return {
        state: {
          ...state,
          seq,
          versions: { ...state.versions, [id]: next },
          audit: log(actor, state, {
            rowId: a.subjectId,
            field: a.subjectKind,
            from: null,
            to: `from ${a.validFrom}`,
            at: a.now,
            by,
            reason: next.reason,
          }),
        },
        message: `Recorded from ${a.validFrom}.`,
      }
    }

    case 'correctVersion': {
      const existing = state.versions[a.id]
      if (!existing) return { state, error: 'That version no longer exists.' }
      if (!a.reason.trim()) return { state, error: 'A correction needs a reason.' }
      // `undefined` means "not part of this patch" and leaves the value alone; an explicit null
      // would be emptying it, which `recordVersion` refuses and a correction cannot smuggle in.
      if (a.patch.value === null) {
        return { state, error: 'A version needs a value. Nothing recorded is said by there being no version, not by an empty one.' }
      }

      const candidate = {
        id: existing.id,
        subjectKind: existing.subjectKind,
        subjectId: existing.subjectId,
        validFrom: a.patch.validFrom ?? existing.validFrom,
        validTo: a.patch.validTo === undefined ? existing.validTo : a.patch.validTo,
      }
      const clash = overlapProblem(Object.values(state.versions), candidate)
      if (clash) return { state, error: clash }

      const next: Version<unknown> = {
        ...existing,
        ...candidate,
        value: a.patch.value === undefined ? existing.value : a.patch.value,
        reason: a.reason.trim(),
      }
      /*
       * The correction is audited with both sides, which is what makes the transaction-time
       * question answerable without a second axis: the trail says what the period used to be,
       * when it was changed and by whom. Anything already stamped from this version keeps its
       * own copy and does not move — see `correctionImpact`.
       */
      return {
        state: {
          ...state,
          versions: { ...state.versions, [existing.id]: next },
          audit: log(actor, state, {
            rowId: existing.subjectId,
            field: existing.subjectKind,
            from: `from ${existing.validFrom}`,
            to: `from ${next.validFrom}`,
            at: a.now,
            by,
            reason: next.reason,
          }),
        },
        message: 'Corrected.',
      }
    }

    /**
     * Withdraw a version whose subject is gone. See the note on the action.
     *
     * The guard is the feature. Without it this is a way to erase somebody's dated history —
     * with it, the only rows it can touch are ones nothing is able to look up, because every
     * consumer resolves a version through a subject id that no longer resolves to anybody.
     */
    case 'removeVersion': {
      const existing = state.versions[a.id]
      if (!existing) return { state, error: 'That version no longer exists.' }

      if (!existing.subjectKind.startsWith('person.')) {
        /*
         * Refused rather than allowed, for a subject kind this rule cannot check. `subjectKind`
         * is open by design — roles and rates were named as future users of it — and a guard
         * that silently permitted everything it did not recognise would grow into the general
         * delete this deliberately is not.
         */
        return { state, error: `Only a person's versions can be withdrawn this way, and this one is “${existing.subjectKind}”.` }
      }
      if (state.model.people[existing.subjectId]) {
        return {
          state,
          error: `${state.model.people[existing.subjectId].name} is still in the directory, so this is part of their history. Correct it rather than removing it.`,
        }
      }

      const versions = { ...state.versions }
      delete versions[a.id]
      return {
        state: {
          ...state,
          versions,
          audit: log(actor, state, {
            rowId: existing.subjectId,
            field: existing.subjectKind,
            from: `from ${existing.validFrom}`,
            to: null,
            at: a.now,
            by,
            reason: 'The subject is no longer in the directory.',
          }),
        },
        message: 'Withdrawn.',
      }
    }

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
        personId: directoryIdByName(state.model, a.person),
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
      // The start of the window, so an allocation is checked against the pattern in force when
      // it begins rather than against whatever is true today.
      const profile = profileFor(state, next.person, a.startDate)
      const position = capacityFor(
        next.person,
        profile,
        Object.values(state.commitments),
        [...others, next],
        a.startDate,
        a.endDate,
      )
      /*
       * The cap, as the workspace has it set. HARD refuses regardless of the override flag
       * — the policy is read from stored state at apply time, never from the wire, so a
       * queued allocation drained after a mode flip is judged by the mode in force when it
       * applies. ADVISORY is the original two-step, byte for byte: warn once, accept on an
       * explicit second ask, record the acceptance as a deliberate decision.
       */
      if (position.overallocated && state.model.allocationPolicy.cap === 'hard') {
        return {
          state,
          error: `${describeCapacity(position)} This workspace enforces the allocation cap — free up the person, shorten the window, or lower the share. The cap is set on the Configuration screen, under Allocation.`,
        }
      }
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
      /*
       * Leave carries an approval status, COMPUTED here and never accepted from the wire —
       * the boundary refuses unknown keys, and this arm deciding from who is writing is what
       * keeps approval from being smuggled in on a write (the E1 design's own send-back
       * clause). The rule:
       *
       *   - An approver recording somebody ELSE's absence lands Approved in one step — they
       *     could approve it anyway, and recorder ≠ subject keeps the never-your-own rule
       *     intact. This is also what preserves today's one-step flow for the person who has
       *     always recorded the team's leave.
       *   - Anyone writing their OWN leave — approver included — lands Requested.
       *   - Editing a decided row's dates or hours re-opens it: the thing that was approved
       *     is not the thing now recorded. An edit that changes neither keeps the decision.
       *
       * Non-Leave kinds are recorded facts: both fields stay null, exactly as before.
       */
      const isLeave = a.kind === 'Leave'
      const selfWrite =
        (directoryIdByName(state.model, a.person) ?? '__none__') ===
          (directoryPersonFor(state.model, actor)?.id ?? '__self__') ||
        a.person.trim().toLowerCase() === by.trim().toLowerCase()
      const mayDecide = can(state.model, actor, 'leave.approve').allowed
      const datesChanged =
        !!existing && (existing.startDate !== a.startDate || existing.endDate !== a.endDate || existing.hoursPerDay !== a.hoursPerDay)
      const status: Commitment['status'] = !isLeave
        ? null
        : mayDecide && !selfWrite
          ? 'Approved'
          : existing && !datesChanged
            ? (existing.status ?? 'Approved')
            : 'Requested'
      const next: Commitment = {
        id,
        person: a.person.trim(),
        personId: directoryIdByName(state.model, a.person),
        kind: a.kind,
        startDate: a.startDate,
        endDate: a.endDate,
        hoursPerDay: a.hoursPerDay,
        note: a.note.trim(),
        status,
        reason: isLeave ? (a.reason ?? existing?.reason ?? '').trim() || null : null,
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
        profileFor(state, next.person, a.startDate),
        [...Object.values(state.commitments).filter((c) => c.id !== id), next],
        Object.values(state.allocations),
        a.startDate,
        a.endDate,
      )

      /*
       * Decision traffic, discriminated by the status const above — never by restating the
       * who-writes rule:
       *   - lands Requested where it was not Requested before (a new request, or a decided
       *     row re-opened by an edit) → the leave.approve holders are asked. Editing a
       *     still-pending request re-mints nothing; the queue shows current dates anyway.
       *   - lands Approved from not-Approved by somebody else's hand (the approver-records-
       *     other flow, or an approver's edit settling a pending row) → the subject is told
       *     their absence is on the calendar.
       * Bodies carry dates and working days only; the private reason never travels (E2C).
       * The mint counter starts from THIS arm's seq — a new row already spent state.seq + 1
       * on its own id — and the returned state carries the final counter.
       */
      let notifications = state.notifications
      let seqAfter = seq
      let muted: { id: string | null; name: string }[] = []
      const wasRequested = !!existing && (existing.status ?? 'Approved') === 'Requested'
      const wasApproved = !!existing && (existing.status ?? 'Approved') === 'Approved'
      if (isLeave && status === 'Requested' && !wasRequested) {
        const days = workingDaysBetween(a.startDate, a.endDate, holidaySetOf(state.model))
        const excl = new Set(
          [next.personId, directoryPersonFor(state.model, actor)?.id].filter((x): x is string => Boolean(x)),
        )
        const holders = grantHolders(state, 'leave.approve', excl).filter(
          (h) => h.name.trim().toLowerCase() !== next.person.trim().toLowerCase(),
        )
        const minted = mintApproval(
          state,
          notifications,
          seqAfter,
          holders,
          `Leave to decide — ${next.person}`,
          `${next.person} requests leave ${next.startDate}→${next.endDate} (${days} working day${days === 1 ? '' : 's'}). Decide it on the Timesheets view.`,
          id,
          'leave-requested',
          a.now,
        )
        notifications = minted.notifications
        seqAfter = minted.seq
        muted = minted.muted
      } else if (isLeave && status === 'Approved' && !selfWrite && !wasApproved) {
        const minted = mintApproval(
          state,
          notifications,
          seqAfter,
          [{ id: next.personId ?? null, name: next.person }],
          'Your leave is on the calendar',
          `${by} recorded your leave ${next.startDate}→${next.endDate} — approved.`,
          id,
          'leave-decided',
          a.now,
        )
        notifications = minted.notifications
        seqAfter = minted.seq
        muted = minted.muted
      }

      let audit = log(actor, state, {
        rowId: 'CAPACITY',
        field: 'commitment',
        from: existing ? `${existing.kind} ${existing.startDate}→${existing.endDate}` : '',
        to: `${next.person}: ${next.kind} ${next.startDate}→${next.endDate}`,
        at: a.now,
        by,
      })
      for (const m of muted) {
        audit = log(actor, { ...state, audit }, {
          rowId: 'CAPACITY',
          field: 'notification',
          from: '',
          to: `in-app → ${m.name} (muted by their preference)`,
          at: a.now,
          by,
          reason: 'approval',
        })
      }

      return {
        state: {
          ...state,
          commitments: { ...state.commitments, [id]: next },
          seq: seqAfter,
          notifications,
          audit,
        },
        message:
          (next.status === 'Requested' ? 'Requested — awaiting a decision. ' : 'Recorded. ') +
          (position.overallocated ? describeCapacity(position) : ''),
      }
    }

    /**
     * Decide a requested absence. The mirror of `decideTimesheet`, for the other thing a
     * person asks somebody to grant: Leave only, `leave.approve` required, never your own.
     */
    case 'decideLeave': {
      const c = state.commitments[a.id]
      if (!c || c.deletedAt) return { state, error: 'That request no longer exists.' }
      if (c.kind !== 'Leave') return { state, error: 'Only leave carries a decision.' }
      if ((c.status ?? 'Approved') !== 'Requested') {
        return { state, error: 'This is not awaiting a decision.' }
      }
      const may = can(state.model, actor, 'leave.approve')
      if (!may.allowed) return { state, error: may.reason ?? 'Deciding leave needs the leave.approve grant.' }
      const deciderId = directoryPersonFor(state.model, actor)?.id ?? null
      const own =
        (c.personId && deciderId && c.personId === deciderId) ||
        c.person.trim().toLowerCase() === by.trim().toLowerCase()
      if (own) {
        return { state, error: 'Your own request is not yours to decide, whatever you hold. Ask another approver.' }
      }
      const next: Commitment = {
        ...c,
        status: a.decision === 'approved' ? 'Approved' : 'Returned',
      }
      /* The subject hears the answer. The decision note travels (it is not private); the
       * reason never does — it is already on the row for those allowed to read it. */
      const note = (a.note ?? '').trim()
      const minted = mintApproval(
        state,
        state.notifications,
        state.seq,
        [{ id: c.personId ?? null, name: c.person }],
        `Your leave ${c.startDate}→${c.endDate}: ${a.decision}`,
        a.decision === 'approved'
          ? `${by} approved your leave ${c.startDate}→${c.endDate}.`
          : `${by} returned your leave ${c.startDate}→${c.endDate}.${note ? ` “${note}”` : ''}`,
        c.id,
        'leave-decided',
        a.now,
      )
      let audit = log(actor, state, {
        rowId: 'CAPACITY',
        field: 'leave',
        from: `${c.person}: Requested ${c.startDate}→${c.endDate}`,
        to: a.decision === 'approved' ? 'Approved' : 'Returned',
        at: a.now,
        by,
        reason: note || undefined,
      })
      for (const m of minted.muted) {
        audit = log(actor, { ...state, audit }, {
          rowId: 'CAPACITY',
          field: 'notification',
          from: '',
          to: `in-app → ${m.name} (muted by their preference)`,
          at: a.now,
          by,
          reason: 'approval',
        })
      }
      return {
        state: {
          ...state,
          commitments: { ...state.commitments, [a.id]: next },
          seq: minted.seq,
          notifications: minted.notifications,
          audit,
        },
        message:
          a.decision === 'approved'
            ? `${c.person}'s leave ${c.startDate}→${c.endDate} approved.`
            : `Returned to ${c.person}.`,
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

    case 'addProjectMember': {
      const project = state.nodes[a.projectId]
      if (!project || project.kind !== 'project') {
        return { state, error: 'Membership is staffed to a project.' }
      }
      const problem = memberProblem(a)
      if (problem) return { state, error: problem.message }
      if (!state.model.projectRoles[a.projectRoleId] || state.model.projectRoles[a.projectRoleId].deletedAt) {
        return { state, error: 'That project role no longer exists.' }
      }
      /**
       * Required, unlike `Allocation.personId` — see the module comment in `./staffing`. A row
       * that cannot resolve to a directory id is an access fact nothing will ever match against
       * a signed-in session, so this refuses rather than storing one silently useless.
       */
      const personId = directoryIdByName(state.model, a.person)
      if (!personId) {
        return { state, error: `"${a.person}" does not match exactly one person in the directory.` }
      }
      const already = Object.values(state.projectMembers).some(
        (m) => m.projectId === a.projectId && m.personId === personId && !m.removedAt,
      )
      if (already) return { state, error: `${a.person} is already staffed on this project.` }

      const seq = state.seq + 1
      const id = `projmem-${seq}`
      const member: ProjectMember = {
        id,
        projectId: a.projectId,
        person: a.person.trim(),
        personId,
        projectRoleId: a.projectRoleId,
        addedBy: by,
        addedAt: a.now,
        removedAt: null,
      }
      return {
        state: {
          ...state,
          projectMembers: { ...state.projectMembers, [id]: member },
          seq,
          audit: log(actor, state, {
            rowId: a.projectId,
            field: 'project member',
            from: '—',
            to: `${a.person} (${state.model.projectRoles[a.projectRoleId].label})`,
            at: a.now,
            by,
          }),
        },
        message: `${a.person} added.`,
      }
    }

    case 'updateProjectMember': {
      const member = state.projectMembers[a.id]
      if (!member || member.removedAt) return { state, error: 'That membership no longer exists.' }
      if (!state.model.projectRoles[a.projectRoleId] || state.model.projectRoles[a.projectRoleId].deletedAt) {
        return { state, error: 'That project role no longer exists.' }
      }
      const was = state.model.projectRoles[member.projectRoleId]?.label ?? member.projectRoleId
      const next: ProjectMember = { ...member, projectRoleId: a.projectRoleId }
      return {
        state: {
          ...state,
          projectMembers: { ...state.projectMembers, [a.id]: next },
          audit: log(actor, state, {
            rowId: member.projectId,
            field: 'project member',
            from: `${member.person} (${was})`,
            to: `${member.person} (${state.model.projectRoles[a.projectRoleId].label})`,
            at: a.now,
            by,
          }),
        },
        message: 'Project role updated.',
      }
    }

    case 'removeProjectMember': {
      const member = state.projectMembers[a.id]
      if (!member) return { state, error: 'That membership no longer exists.' }
      if (member.removedAt) return { state }
      return {
        state: {
          ...state,
          projectMembers: { ...state.projectMembers, [a.id]: { ...member, removedAt: a.now } },
          audit: log(actor, state, {
            rowId: member.projectId,
            field: 'project member',
            from: `${member.person} (${state.model.projectRoles[member.projectRoleId]?.label ?? member.projectRoleId})`,
            to: '(removed)',
            at: a.now,
            by,
          }),
        },
        message: `${member.person} removed.`,
      }
    }

    /*
     * No audit entry in any of the three arms below, unlike every other mutation in this
     * reducer. `state.audit` is not filtered per-owner anywhere today — `redactForReader`
     * passes it through unchanged for any `internal.view` holder — so an entry naming a
     * personal event's title would leak its existence, and half its content, to exactly the
     * readers the design says must never see it. The accountability an audit trail exists for
     * has no audience here; there is nobody this record is answerable to but its owner.
     */
    case 'addPersonalEvent': {
      const problem = eventProblem(a)
      if (problem) return { state, error: problem.message }
      const personId = directoryPersonFor(state.model, actor)?.id
      if (!personId) {
        return { state, error: 'This sign-in matches no directory entry, so there is nowhere to add it.' }
      }
      const seq = state.seq + 1
      const id = `pevent-${seq}`
      const event: PersonalEvent = {
        id,
        personId,
        title: a.title.trim(),
        startAt: a.startAt,
        endAt: a.endAt,
        allDay: a.allDay,
        note: a.note.trim(),
        attendees: a.attendees.trim(),
        createdAt: a.now,
        deletedAt: null,
      }
      return {
        state: { ...state, personalEvents: { ...state.personalEvents, [id]: event }, seq },
        message: `${event.title} added.`,
      }
    }

    case 'updatePersonalEvent': {
      const event = state.personalEvents[a.id]
      if (!event || event.deletedAt) return { state, error: 'That event no longer exists.' }
      /**
       * Full stop, no admin fallback — see the design. Every other self-scoped arm in this
       * file (`setNotificationPref`) grants `config.manage` a way in; this one deliberately
       * does not, because there is no legitimate reason for anyone but the owner to touch it.
       */
      if (directoryPersonFor(state.model, actor)?.id !== event.personId) {
        return { state, error: 'This is not your event.' }
      }
      const next: PersonalEvent = { ...event, ...a.patch }
      const problem = eventProblem(next)
      if (problem) return { state, error: problem.message }
      return {
        state: { ...state, personalEvents: { ...state.personalEvents, [a.id]: next } },
        message: 'Updated.',
      }
    }

    case 'removePersonalEvent': {
      const event = state.personalEvents[a.id]
      if (!event) return { state, error: 'That event no longer exists.' }
      if (event.deletedAt) return { state }
      if (directoryPersonFor(state.model, actor)?.id !== event.personId) {
        return { state, error: 'This is not your event.' }
      }
      return {
        state: {
          ...state,
          personalEvents: { ...state.personalEvents, [a.id]: { ...event, deletedAt: a.now } },
        },
        message: `${event.title} removed.`,
      }
    }

    case 'recordInboundMail': {
      const seq = state.seq + 1
      const id = `inmail-${seq}`
      const entry: InboundMail = {
        id,
        mailbox: a.mailbox,
        from: a.from,
        subject: a.subject,
        body: a.body,
        messageId: a.messageId,
        receivedAt: a.receivedAt,
        issueId: a.issueId,
        refusalReason: a.refusalReason,
        conversationId: a.conversationId,
        createdAt: a.now,
      }
      // No audit entry, the same reasoning the personal-event arms give for themselves —
      // this is a system bookkeeping record, not a work-tracking mutation with an audience
      // the audit trail exists for.
      return {
        state: { ...state, inboundMail: { ...state.inboundMail, [id]: entry }, seq },
        message: 'Logged.',
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

/**
 * The career fields on a person, merged the way the address is: absent means unrecorded.
 *
 * Split out of `upsertPerson` because the merge has three cases per field and doing it inline
 * three times is how one of them ends up different from the others. A field the caller did not
 * mention keeps what was there; a field the caller sent keeps the new value; a field the caller
 * cleared to an empty string is removed rather than stored empty.
 *
 * `source: 'stated'` is set when any of them is present, because this arm is only reached when
 * somebody said something. It is never set to `'default'` here — a default is what the shipped
 * fallback is, and claiming it for a person nobody described would be exactly the fabrication
 * `ResourceProfile.source` was added to prevent, when the seeder stamped `'stated'` on profiles
 * nobody had stated.
 */
function career(
  op: { grade?: string; track?: string; developingToward?: string },
  existing?: Person,
): Partial<Person> {
  const pick = (sent: string | undefined, had: string | undefined) => {
    if (sent === undefined) return had
    const t = sent.trim()
    return t ? t : undefined
  }
  const grade = pick(op.grade, existing?.grade)
  const track = pick(op.track, existing?.track)
  const developingToward = pick(op.developingToward, existing?.developingToward)
  const any = grade || track || developingToward
  return {
    ...(grade ? { grade } : {}),
    ...(track ? { track } : {}),
    ...(developingToward ? { developingToward } : {}),
    ...(any ? { source: 'stated' as const } : {}),
  }
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

    case 'upsertProjectRole': {
      const label = op.label.trim()
      if (!label) return { state, error: 'A project role needs a name.' }
      const id = op.id ?? `PROJROLE_${m.seq}`
      const existing = m.projectRoles[id]
      const role: ProjectRole = {
        id,
        label,
        description: op.description.trim(),
        seeded: existing?.seeded ?? false,
        deletedAt: null,
      }
      return done(
        { ...m, projectRoles: { ...m.projectRoles, [id]: role }, seq: m.seq + (op.id ? 0 : 1) },
        {
          rowId: id,
          field: 'project role',
          from: existing?.label ?? null,
          to: label,
          at: now,
          by,
        },
        existing ? `Project role “${label}” updated.` : `Project role “${label}” added.`,
      )
    }

    case 'deleteProjectRole': {
      const role = m.projectRoles[op.id]
      if (!role) return { state, error: 'Project role not found.' }
      if (role.seeded) {
        return { state, error: `“${role.label}” is a built-in project role. Rename it rather than removing it.` }
      }
      const used = Object.values(state.projectMembers).filter(
        (pm) => pm.projectRoleId === op.id && !pm.removedAt,
      )
      if (used.length) {
        return {
          state,
          error: `${used.length} project ${used.length === 1 ? 'membership holds' : 'memberships hold'} “${role.label}”. Reassign them first.`,
        }
      }
      return done(
        { ...m, projectRoles: { ...m.projectRoles, [op.id]: { ...role, deletedAt: now } } },
        { rowId: op.id, field: 'project role', from: role.label, to: '(archived)', at: now, by },
        `Project role “${role.label}” archived.`,
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
        /**
         * Somebody edited it, so it is no longer the shipped default — even when they set it
         * to exactly the default numbers, because choosing 7.5 hours is a different fact from
         * never having been asked.
         *
         * Taken from the action rather than the patch: `source` is not a field anybody edits,
         * and letting a patch carry it would let a client declare its guesses confirmed.
         */
        source: op.confirmed === false ? 'default' : 'stated',
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

    case 'setHolidays': {
      /*
       * The whole list, replaced — a holiday calendar is edited as a document, not as rows,
       * and a replace op cannot leave a phantom date behind the way per-row deletes can.
       * Validated for what the date math would silently mistrust: a malformed date never
       * matches the working-day set, so it would be a holiday that never fires.
       */
      const seen = new Set<string>()
      for (const h of op.holidays) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date) || Number.isNaN(Date.parse(`${h.date}T00:00:00Z`))) {
          return { state, error: `"${h.date}" is not a real calendar date (YYYY-MM-DD).` }
        }
        if (!h.name.trim()) return { state, error: `The holiday on ${h.date} needs a name.` }
        if (seen.has(h.date)) return { state, error: `${h.date} is listed twice.` }
        seen.add(h.date)
      }
      const sorted = [...op.holidays].map((h) => ({ date: h.date, name: h.name.trim() })).sort((x, y) => x.date.localeCompare(y.date))
      const before = (m.holidays ?? []).length
      return done(
        { ...m, holidays: sorted },
        { rowId: 'HOLIDAYS', field: 'holidays', from: `${before} day(s)`, to: `${sorted.length} day(s)`, at: now, by },
        `${sorted.length} holiday(s) recorded. The working-day math skips them for everyone.`,
      )
    }

    case 'setTimePolicy': {
      /*
       * Validated in the module that owns the rule, refused in its words. Zero is
       * legitimate — any entry not made the same day must explain itself — and past two
       * months "grace" has stopped describing anything.
       */
      const problem = timePolicyProblem(op.patch)
      if (problem) return { state, error: problem }
      const next = { ...m.timePolicy, ...op.patch }
      if (next.backdatingAllowanceDays === m.timePolicy.backdatingAllowanceDays) {
        return { state, message: 'Nothing changed.' }
      }
      return done(
        { ...m, timePolicy: next },
        {
          rowId: 'TIME_POLICY',
          field: 'timePolicy',
          from: `${m.timePolicy.backdatingAllowanceDays} days`,
          to: `${next.backdatingAllowanceDays} days`,
          at: now,
          by,
        },
        `Backdating allowance set to ${next.backdatingAllowanceDays} days.`,
      )
    }

    case 'setAllocationPolicy': {
      // Validated in the module that owns the judgement, refused in its words.
      const problem = allocationPolicyProblem(op.patch)
      if (problem) return { state, error: problem }
      const next = { ...m.allocationPolicy, ...op.patch }
      if (next.cap === m.allocationPolicy.cap) return { state, message: 'Nothing changed.' }
      const word = (c: AllocationPolicy['cap']) =>
        c === 'hard' ? 'hard — nobody past capacity' : 'advisory — accepted overruns are recorded'
      return done(
        { ...m, allocationPolicy: next },
        {
          rowId: 'ALLOCATION_POLICY',
          field: 'allocationPolicy',
          from: word(m.allocationPolicy.cap),
          to: word(next.cap),
          at: now,
          by,
        },
        `Allocation cap set to ${next.cap}.`,
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

    case 'upsertDiscipline': {
      const label = op.label.trim()
      if (!label) return { state, error: 'A discipline needs a name.' }
      const id = op.id ?? `DISC_${m.seq}`
      const existing = m.disciplines?.[id]
      // The name is what must stay unique, not just the key — two disciplines sharing one makes
      // the filter ambiguous and a routing rule's target arbitrary.
      const clash = liveDisciplines(m).find(
        (d) => d.id !== id && d.label.toLowerCase() === label.toLowerCase(),
      )
      if (clash) return { state, error: `A discipline called "${clash.label}" already exists.` }
      /*
       * The suggested owner must be a role that exists and is live. A routing rule aimed at an
       * archived role proposes nothing and looks like it is working — the same silent-nothing
       * failure that the empty fallback role was introduced to stop.
       *
       * Empty is allowed: a discipline whose usual owner the firm has not settled is a real
       * state, and better recorded as blank than as a guess.
       */
      if (op.ownerRoleId && !(m.roles[op.ownerRoleId] && !m.roles[op.ownerRoleId].deletedAt)) {
        return { state, error: 'That role does not exist, so nothing would ever be routed to it.' }
      }
      const discipline: Discipline = {
        id,
        label,
        description: op.description.trim(),
        ownerRoleId: op.ownerRoleId,
        // Seeded-ness is a property of where a discipline came from, so it survives an edit.
        seeded: existing?.seeded ?? false,
        deletedAt: null,
      }
      return done(
        { ...m, disciplines: { ...m.disciplines, [id]: discipline }, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'discipline', from: existing?.label ?? null, to: label, at: now, by },
        existing ? `Discipline "${label}" updated.` : `Discipline "${label}" added.`,
      )
    }

    case 'deleteDiscipline': {
      const discipline = m.disciplines?.[op.id]
      if (!discipline) return { state, error: 'Discipline not found.' }
      if (discipline.seeded) {
        return { state, error: `"${discipline.label}" is one of the standard disciplines. It can be renamed, not removed.` }
      }
      // Same refusal as a work type, and for the same reason: archiving one that records still
      // carry leaves those records classified as something the workspace no longer offers.
      const used = Object.values(state.issues).filter((i) => !i.deletedAt && i.discipline === op.id)
      if (used.length) {
        return {
          state,
          error: `${used.length} ${used.length === 1 ? 'record is' : 'records are'} in "${discipline.label}". Reclassify them first.`,
        }
      }
      return done(
        { ...m, disciplines: { ...m.disciplines, [op.id]: { ...discipline, deletedAt: now } } },
        { rowId: op.id, field: 'discipline', from: discipline.label, to: '(archived)', at: now, by },
        `Discipline "${discipline.label}" archived.`,
      )
    }

    case 'upsertSkill': {
      const name = op.name.trim()
      if (!name) return { state, error: 'A skill needs a name.' }
      const id = op.id ?? `skill-${m.seq}`
      const existing = m.skills?.[id]
      // The name must stay unique, like every other vocabulary here. Two "Data migration"
      // entries make "who can do data migration" a question with two half-answers.
      const clash = liveSkills(m).find(
        (s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase(),
      )
      if (clash) return { state, error: `A skill called "${clash.name}" already exists.` }
      const skill: Skill = {
        id,
        name,
        category: op.category.trim(),
        description: op.description.trim(),
        deletedAt: null,
      }
      return done(
        { ...m, skills: { ...m.skills, [id]: skill }, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'skill', from: existing?.name ?? null, to: name, at: now, by },
        existing ? `Skill "${name}" updated.` : `Skill "${name}" added.`,
      )
    }

    case 'deleteSkill': {
      const skill = m.skills?.[op.id]
      if (!skill) return { state, error: 'Skill not found.' }
      /*
       * Refused while anybody is still recorded against it, like a work type in use.
       *
       * The consequence of not refusing is quieter here than elsewhere and worse for it:
       * `candidatesFor` filters person-skills against the live catalogue, so retiring a skill
       * people hold does not orphan their rows visibly — it makes them stop matching. Somebody
       * would search for the skill, find nobody, and conclude the firm cannot do it.
       */
      const held = Object.values(state.personSkills).filter(
        (p) => !p.deletedAt && p.skillId === op.id,
      )
      if (held.length) {
        return {
          state,
          error: `${held.length} ${held.length === 1 ? 'person is' : 'people are'} recorded against "${skill.name}". Withdraw those first, or leave it in place.`,
        }
      }
      return done(
        { ...m, skills: { ...m.skills, [op.id]: { ...skill, deletedAt: now } } },
        { rowId: op.id, field: 'skill', from: skill.name, to: '(archived)', at: now, by },
        `Skill "${skill.name}" archived.`,
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
      /*
       * `CONFIG_OPS` checks that `op.k` names a real operation and stops there — the fields
       * inside an op are not shape-checked at the boundary, by an explicit decision recorded in
       * actionShape.ts. That is survivable for fields the arm only ever compares, and not for
       * these three, which are trimmed: `grade: 123` would reach `.trim()` and throw a
       * TypeError out of a pure reducer, which surfaces as a 500 rather than as a refusal
       * naming the field.
       */
      for (const f of ['grade', 'track', 'developingToward'] as const) {
        const v = op[f]
        if (v !== undefined && typeof v !== 'string') {
          return { state, error: `${f} must be text.` }
        }
      }
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

      /* The scope must be a real node on an externalParty tier — a typo here would silently
         scope a guest to nothing, which the deny-default turns into an empty view nobody can
         explain. The flag, not the literal kind: whichever tier(s) this organisation marks as
         naming external parties are the ones a guest can be scoped to. */
      if (op.clientScopeId) {
        const node = state.nodes[op.clientScopeId]
        if (!node || !isExternalPartyKind(tiersOf(state.model), node.kind)) {
          return { state, error: 'The client scope must be one of the client nodes in the tree.' }
        }
      }

      /* Who this person reports to must be a real, live directory entry, must not be the
       * person themselves, and must not close a loop — checked against the resolved `id`,
       * not `op.id`, since a brand-new person's `op.id` is null. */
      if (op.managerId) {
        const manager = m.people[op.managerId]
        if (!manager) return { state, error: 'That manager is not in the directory.' }
        if (op.managerId === id) return { state, error: 'A person cannot be their own manager.' }
        if (wouldCreateManagerCycle(m.people, id, op.managerId)) {
          return { state, error: `${manager.name} already reports, directly or indirectly, to this person.` }
        }
      }

      const person: Person = {
        id,
        name,
        roleIds: op.roleIds.filter((r) => m.roles[r] && !m.roles[r].deletedAt),
        fromSource: existing?.fromSource ?? false,
        // Undefined when cleared rather than an empty string, so "no address recorded" is one
        // state rather than two that compare unequal.
        ...(email ? { email } : existing?.email && op.email === undefined ? { email: existing.email } : {}),
        // Absent-versus-cleared, like the address: undefined keeps what was there, null clears.
        ...(op.clientScopeId !== undefined
          ? op.clientScopeId
            ? { clientScopeId: op.clientScopeId }
            : {}
          : existing?.clientScopeId
            ? { clientScopeId: existing.clientScopeId }
            : {}),
        // Same absent-versus-cleared shape, its own field — not clientScopeId's, which would
        // silently make one optional reference track the other.
        ...(op.managerId !== undefined
          ? op.managerId
            ? { managerId: op.managerId }
            : {}
          : existing?.managerId
            ? { managerId: existing.managerId }
            : {}),
        /*
         * Grade, track and target follow the same absent-versus-empty rule as the address, and
         * for the same reason: `undefined` means nothing was recorded, `''` would mean somebody
         * recorded emptiness, and a directory that cannot tell those apart cannot answer "who
         * have we never described".
         *
         * `source` is only ever written alongside them, and only as `stated` — this arm is
         * reached because a person said something. Nothing here mints `default`; that is what
         * the shipped fallback means and it is not a claim this action is entitled to make.
         */
        ...career(op, existing),
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
      /*
       * The same "reassign them first" shape deleteRole and deleteProjectRole already use.
       * deletePerson deletes outright, not a soft-remove — leaving a dangling managerId behind
       * it would be exactly the "nothing failed, the wrong thing quietly worked" class of bug
       * this codebase's own history keeps finding and fixing.
       */
      const reports = directReportsOf(m.people, op.id)
      if (reports.length) {
        return {
          state,
          error: `${reports.length} ${reports.length === 1 ? 'person reports' : 'people report'} to ${person.name}. Reassign them first.`,
        }
      }
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

    /**
     * Where documents are filed.
     *
     * The root is trimmed of slashes rather than refused for containing them: somebody typing
     * "/Projects/" means `Projects`, and a refusal there would be pedantry. An empty root IS
     * refused — filing at the top of a shared library is a decision with consequences for
     * everybody else using it, and it should not be reachable by clearing a box.
     */
    /**
      * Set or correct a target.
      *
      * Everything checked here is a thing that would otherwise fail silently rather than loudly:
      * a measure that does not exist computes nothing, a scope that is not a node counts nothing,
      * and a window that runs backwards matches nothing. All three would render as a goal sitting
      * at zero, which reads as "we are failing" rather than "this is misconfigured".
      *
      * There is deliberately no `progress` field to write. See `lib/goals.ts`.
      */
     case 'upsertGoal': {
       const id = op.id ?? `GOAL_${m.seq}`
       const existing = m.goals[id]
       const name = (op.patch.name ?? existing?.name ?? '').trim()
       if (!name) return { state, error: 'A goal needs a name.' }

       const measure = op.patch.measure ?? existing?.measure ?? ''
       const spec = MEASURES.find((x) => x.key === measure)
       if (!spec) {
         return { state, error: `“${measure || 'nothing'}” is not a measure. A goal has to name one the register can compute.` }
       }

       const scopeId = op.patch.scopeId ?? existing?.scopeId ?? ''
       if (!state.nodes[scopeId]) {
         return { state, error: 'A goal is measured over a part of the tree, and that is not one.' }
       }

       const target = op.patch.target ?? existing?.target ?? 0
       if (!Number.isFinite(target) || target < 0) {
         return { state, error: 'A target has to be a number, and not a negative one.' }
       }

       const by = (op.patch.by ?? existing?.by ?? '').slice(0, 10)
       if (!/^\d{4}-\d{2}-\d{2}$/.test(by)) {
         return { state, error: 'A goal needs a date it is judged on.' }
       }
       const from = op.patch.from !== undefined ? op.patch.from : (existing?.from ?? null)
       if (from && from.slice(0, 10) > by) {
         return { state, error: 'The window starts after the date it is judged on, so nothing could ever count.' }
       }

       const goal: Goal = {
         id,
         name,
         scopeId,
         measure,
         target,
         by,
         // Kept on the record even for a measure that ignores it, so switching the measure back
         // does not lose the window somebody chose.
         from: from ? from.slice(0, 10) : null,
         note: op.patch.note ?? existing?.note ?? '',
         createdBy: existing?.createdBy ?? by,
         createdAt: existing?.createdAt ?? now,
         deletedAt: null,
       }

       return done(
         { ...m, goals: { ...m.goals, [id]: goal }, seq: m.seq + (op.id ? 0 : 1) },
         { rowId: id, field: 'goal', from: existing?.name ?? null, to: name, at: now, by },
         existing ? `“${name}” updated.` : `“${name}” set. Its figure is computed from the register, so there is nothing to keep up to date.`,
       )
     }

     case 'deleteGoal': {
       const goal = m.goals[op.id]
       if (!goal || goal.deletedAt) return { state, error: 'That goal no longer exists.' }
       return done(
         { ...m, goals: { ...m.goals, [op.id]: { ...goal, deletedAt: now } } },
         { rowId: op.id, field: 'goal', from: goal.name, to: '(removed)', at: now, by },
         `“${goal.name}” removed.`,
       )
     }

    case 'setDocumentFiling': {
      const next = { ...m.documentFiling, ...op.patch }
      const root = next.rootFolder.replace(/^[\s/]+|[\s/]+$/g, '')
      if (!root) return { state, error: 'Documents need a folder to go in. Name one.' }
      if (/[\\:*?"<>|]/.test(root)) {
        return { state, error: 'A SharePoint folder name cannot contain \\ : * ? " < > or |.' }
      }
      const filing: DocumentFiling = { ...next, rootFolder: root }
      if (
        filing.rootFolder === m.documentFiling.rootFolder &&
        filing.byEngagement === m.documentFiling.byEngagement
      ) {
        return { state, error: 'That is already how documents are filed.' }
      }
      return done(
        { ...m, documentFiling: filing },
        {
          rowId: 'documentFiling',
          field: 'documentFiling',
          from: `${m.documentFiling.rootFolder}${m.documentFiling.byEngagement ? '/<engagement>' : ''}`,
          to: `${filing.rootFolder}${filing.byEngagement ? '/<engagement>' : ''}`,
          at: now,
          by,
        },
        /*
         * Says plainly that nothing moves. Filing is applied when a document is stored, and the
         * locator on an existing record is a Graph item id rather than a path — so files already
         * in the library stay exactly where they are and stay readable. Somebody changing this
         * expecting a reorganisation would otherwise find out by not finding out.
         */
        `New documents will be filed under “${filing.rootFolder}”. Documents already stored do not move.`,
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
        classification: op.patch.classification ?? existing?.classification ?? null,
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

    case 'upsertRecurrence': {
      const id = op.id ?? `RECUR_${m.seq}`
      const existing = m.recurrences.find((r) => r.id === id)
      const name = (op.patch.name ?? existing?.name ?? '').trim()
      if (!name) return { state, error: 'A recurrence needs a name — it becomes the subject of everything it raises.' }

      /*
       * The scope must be able to hold an issue, checked at WRITE time. A rule that could never
       * file is refused when somebody is looking at the screen, not discovered by the pass at
       * seven in the morning. The same check runs again inside `create` on every raise — that
       * is the half that holds when the scope is deleted after this rule was written.
       */
      const scopeId = op.patch.scopeId ?? existing?.scopeId ?? ''
      const scopeKind = kindOf(state, scopeId)
      if (!scopeKind) return { state, error: 'The scope this rule files into does not exist.' }
      if (!canParent('issue', scopeKind, tiersOf(state.model))) {
        return { state, error: `An issue cannot live under a ${scopeKind}, so this rule could never file anything.` }
      }

      const cadence = op.patch.cadence ?? existing?.cadence ?? null
      if (!cadence) return { state, error: 'A recurrence needs a cadence — weekly on a weekday, or monthly on a day.' }
      if (cadence.kind === 'weekly' && (cadence.weekday < 0 || cadence.weekday > 6)) {
        return { state, error: 'A weekly cadence needs a weekday between Sunday and Saturday.' }
      }
      if (cadence.kind === 'monthly' && (cadence.day < 1 || cadence.day > 31)) {
        return { state, error: 'A monthly cadence needs a day between 1 and 31 — 31 means the last day of the month.' }
      }

      const rule: Recurrence = {
        id,
        name,
        scopeId,
        cadence,
        type: op.patch.type ?? existing?.type ?? '',
        severity: op.patch.severity ?? existing?.severity ?? 'Medium',
        owner: op.patch.owner ?? existing?.owner ?? '',
        enabled: op.patch.enabled ?? existing?.enabled ?? false,
        // Advanced only by the pass, in the same batch as a successful raise — never from a form.
        lastRaisedOn: op.patch.lastRaisedOn ?? existing?.lastRaisedOn ?? null,
      }
      const recurrences = existing ? m.recurrences.map((r) => (r.id === id ? rule : r)) : [...m.recurrences, rule]
      return done(
        { ...m, recurrences, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'recurrence', from: existing?.name ?? null, to: name, at: now, by },
        existing ? `“${name}” updated.` : `“${name}” configured.`,
      )
    }

    case 'upsertBlueprint': {
      const id = op.id ?? `BP_${m.seq}`
      const existing = m.blueprints[id]
      const name = (op.patch.name ?? existing?.name ?? '').trim()
      if (!name) return { state, error: 'A blueprint needs a name.' }
      const entries = op.patch.entries ?? existing?.entries ?? []
      if (!entries.length) return { state, error: 'A blueprint with no entries would build nothing. Extract before storing.' }

      /*
       * Version bumps on STRUCTURAL edits only - entries or links actually changing. A rename
       * is the same shape; the applications append is bookkeeping. Bumping on either would
       * leave provenance pointing at versions nobody authored.
       */
      const links = op.patch.links ?? existing?.links ?? []
      const structural =
        existing &&
        ((op.patch.entries && JSON.stringify(op.patch.entries) !== JSON.stringify(existing.entries)) ||
          (op.patch.links && JSON.stringify(op.patch.links) !== JSON.stringify(existing.links)))
      const bp: Blueprint = {
        id,
        name,
        sourceEngagementId: op.patch.sourceEngagementId ?? existing?.sourceEngagementId ?? '',
        version: existing ? existing.version + (structural ? 1 : 0) : 1,
        entries,
        links,
        applications: op.patch.applications ?? existing?.applications ?? [],
      }
      return done(
        { ...m, blueprints: { ...m.blueprints, [id]: bp }, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'blueprint', from: existing ? `v${existing.version}` : null, to: `v${bp.version}`, at: now, by },
        existing ? `“${name}” ${structural ? `updated to v${bp.version}` : 'updated'}.` : `“${name}” stored as v1.`,
      )
    }

    case 'deleteBlueprint': {
      const bp = m.blueprints[op.id]
      if (!bp) return { state, error: 'Blueprint not found.' }
      const rest = { ...m.blueprints }
      delete rest[op.id]
      return done(
        { ...m, blueprints: rest },
        { rowId: op.id, field: 'blueprint', from: bp.name, to: '(removed)', at: now, by },
        `“${bp.name}” removed.`,
      )
    }

    case 'upsertIntakeForm': {
      const id = op.id ?? `FORM_${m.seq}`
      const existing = m.intakeForms.find((f) => f.id === id)
      const name = (op.patch.name ?? existing?.name ?? '').trim()
      if (!name) return { state, error: 'A form needs a name — the submitter sees it, and the provenance note carries it.' }

      /*
       * The token travels in the action, minted by the caller. Never generated here: the
       * reducer must stay replayable, and a token invented during apply would differ on every
       * replay. Blank on creation is refused; on later edits the stored token stands unless a
       * new one is explicitly sent.
       */
      const token = (op.patch.token ?? existing?.token ?? '').trim()
      if (!token) return { state, error: 'A form needs its token minted by the caller — without one the URL cannot exist.' }

      const scopeId = op.patch.scopeId ?? existing?.scopeId ?? ''
      const scopeKind = kindOf(state, scopeId)
      if (!scopeKind) return { state, error: 'The scope this form files into does not exist.' }
      if (!canParent('issue', scopeKind, tiersOf(state.model))) {
        return { state, error: `An issue cannot live under a ${scopeKind}, so this form could never file anything.` }
      }

      const form: IntakeForm = {
        id,
        name,
        scopeId,
        enabled: op.patch.enabled ?? existing?.enabled ?? false,
        token,
      }
      const intakeForms = existing ? m.intakeForms.map((f) => (f.id === id ? form : f)) : [...m.intakeForms, form]
      return done(
        { ...m, intakeForms, seq: m.seq + (op.id ? 0 : 1) },
        { rowId: id, field: 'intakeForm', from: existing?.name ?? null, to: name, at: now, by },
        existing ? `${name} form updated.` : `${name} form configured.`,
      )
    }

    case 'deleteIntakeForm': {
      const form = m.intakeForms.find((f) => f.id === op.id)
      if (!form) return { state, error: 'Form not found.' }
      return done(
        { ...m, intakeForms: m.intakeForms.filter((f) => f.id !== op.id) },
        { rowId: op.id, field: 'intakeForm', from: form.name, to: '(removed)', at: now, by },
        `${form.name} form removed.`,
      )
    }

    case 'deleteRecurrence': {
      const rule = m.recurrences.find((r) => r.id === op.id)
      if (!rule) return { state, error: 'Recurrence not found.' }
      return done(
        { ...m, recurrences: m.recurrences.filter((r) => r.id !== op.id) },
        { rowId: op.id, field: 'recurrence', from: rule.name, to: '(removed)', at: now, by },
        `“${rule.name}” removed.`,
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

/* ================================================================== *
 * Recurring work (design 2026-08-19)
 * ================================================================== */

export interface RecurrenceRun {
  state: WorkspaceState
  steps: { action: Action; before: WorkspaceState; after: WorkspaceState }[]
  refusals: { action: Action; error: string }[]
  /** What was raised, for the run's summary. */
  raised: { ruleId: string; name: string; occurrence: string; issueId: string }[]
}

/**
 * Raise whatever the recurrence rules owe for today.
 *
 * Same shape and same discipline as `runWatch` above: every raise is an ordinary `create`
 * action through `apply`, so the permission check, the `canParent` guard and the audit trail
 * all hold, and a refusal is recorded rather than thrown. Two rules the arithmetic module
 * carries and this function must not undo:
 *
 *  - `dueOccurrence` returns at most ONE date per rule — a pass that was down for days raises
 *    the missed occurrence once, never once per missed day.
 *  - `lastRaisedOn` advances to the OCCURRENCE, not today, and only after the raise succeeded
 *    — in the same action sequence, so the surrounding transaction commits both or neither.
 *    On a refusal it does not advance, and the next pass retries the same occurrence.
 */
export function runRecurrences(
  state: WorkspaceState,
  today: string,
  now: string,
  actor: Actor,
): RecurrenceRun {
  let current = state
  const steps: RecurrenceRun['steps'] = []
  const refusals: RecurrenceRun['refusals'] = []
  const raised: RecurrenceRun['raised'] = []

  for (const rule of current.model.recurrences ?? []) {
    const occurrence = dueOccurrence(rule, today)
    if (!occurrence) continue

    const create: Action = {
      t: 'create',
      parentId: rule.scopeId,
      kind: 'issue',
      draft: {
        name: subjectFor(rule, occurrence),
        description: `Raised by the recurring rule “${rule.name}” for its ${occurrence} occurrence.`,
        type: rule.type,
        severity: rule.severity,
        // Empty falls to 'Unassigned' in the create arm - the stored value the unowned counts watch.
        owner: rule.owner,
        raisedBy: actor.name,
        // The entry state, whatever the rule says about severity: a machine may file work; it
        // may not decide it is being worked on. Same sentence as intake, same reason.
        status: 'Open',
      },
      now,
    } as Action

    const before = current
    const result = apply(current, create, actor)
    if (result.error) {
      refusals.push({ action: create, error: result.error })
      continue
    }
    const newId = Object.keys(result.state.issues).find((id) => !before.issues[id])
    steps.push({ action: create, before, after: result.state })
    current = result.state

    const advance: Action = {
      t: 'config',
      op: { k: 'upsertRecurrence', id: rule.id, patch: { lastRaisedOn: occurrence } },
      now,
    } as Action
    const adv = apply(current, advance, actor)
    if (adv.error) {
      // The raise stood but the guard did not move: record it loudly, because the next pass
      // would raise the same occurrence again. The surrounding transaction should not commit
      // a half like this, which is why both actions run inside it.
      refusals.push({ action: advance, error: adv.error })
      continue
    }
    steps.push({ action: advance, before: current, after: adv.state })
    current = adv.state

    raised.push({ ruleId: rule.id, name: rule.name, occurrence, issueId: newId ?? '' })
  }

  return { state: current, steps, refusals, raised }
}
