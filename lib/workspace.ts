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
} from './types'
import { ACTIVITY_PHASES, isNodeKind } from './types'

/**
 * Re-exported so the many callers that reach for `NodeKind` from the workspace keep working.
 * It is *declared* in `./types` alongside `RowKind`, because a tier being a node and a tier
 * being a row are two views of one list — see `NODE_KINDS`.
 */
export type { NodeKind }
import type { EvidenceItem, EvidenceKind, SnapshotPurpose } from './evidence'
import { blankEngagement, type EngagementDetail } from './engagement'
import { addWorkingDays } from './dates'
import { STATUS_PROGRESS } from './schedule'
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
    relationships,
    evidence: {},
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
  | { t: 'updateIssue'; id: string; patch: Partial<IssueRecord>; now: string }
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
  | { t: 'removeEvidence'; id: string; now: string }
  | { t: 'buildLifecycle'; issueId: string; slaDays: number; now: string }
  | { t: 'clearLifecycle'; issueId: string; now: string }
  /* ---- CONFIGURATION ---- */
  | { t: 'config'; op: ConfigOp; now: string }
  | { t: 'updateEngagement'; nodeId: string; patch: Partial<EngagementDetail>; now: string }
  | { t: 'setAssignment'; issueId: string; responsibilityId: string; values: string[]; now: string }

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
  | { k: 'upsertPerson'; id: string | null; name: string; roleIds: string[] }
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
  state: WorkspaceState,
  entry: Omit<AuditEntry, 'id'>,
): AuditEntry[] {
  auditSeq += 1
  return [...state.audit, { ...entry, id: `aud-${auditSeq}-${entry.rowId}` }]
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

export function apply(state: WorkspaceState, a: Action, actor: Actor): OpResult {
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
            audit: log(state, {
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
          type: a.draft.type || 'Defect',
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
            audit: log(state, {
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
          audit: log(state, {
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
      const changed = Object.entries(a.patch).filter(
        ([k, v]) => (i as unknown as Record<string, unknown>)[k] !== v,
      )
      if (!changed.length) return { state }
      let audit = state.audit
      for (const [k, v] of changed) {
        audit = log(
          { ...state, audit },
          {
            rowId: a.id,
            field: k,
            from: String((i as unknown as Record<string, unknown>)[k] ?? ''),
            to: String(v ?? ''),
            at: a.now,
            by,
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
      return { state: { ...state, issues: { ...state.issues, [a.id]: next }, audit }, message: 'Saved.' }
    }

    case 'updateActivity': {
      const act = state.activities[a.id]
      if (!act) return { state, error: 'Activity not found.' }
      let audit = state.audit
      for (const [k, v] of Object.entries(a.patch)) {
        if ((act as unknown as Record<string, unknown>)[k] === v) continue
        audit = log(
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
        if (!newParent && kids.length) {
          return {
            state,
            error: 'This is a root record — its children have nowhere to move to. Archive the whole branch instead.',
          }
        }
        for (const k of kids) {
          if (nodes[k]) nodes[k] = { ...nodes[k], parentId: newParent }
          else if (issues[k]) issues[k] = { ...issues[k], parentId: newParent! }
          else if (activities[k]) {
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
          audit: log(state, {
            rowId: a.id,
            field: 'archived',
            from: 'active',
            to: detail,
            at: a.now,
            by,
            reason: 'Soft delete — the record is retained in history and can be restored.',
          }),
        },
        message: `"${nameOf(state, a.id)}" ${detail}.`,
      }
    }

    case 'restore': {
      const nodes = { ...state.nodes }
      const issues = { ...state.issues }
      const activities = { ...state.activities }
      if (nodes[a.id]) nodes[a.id] = { ...nodes[a.id], deletedAt: null }
      else if (issues[a.id]) issues[a.id] = { ...issues[a.id], deletedAt: null }
      else if (activities[a.id]) activities[a.id] = { ...activities[a.id], deletedAt: null }
      else return { state, error: 'Record not found.' }
      return {
        state: {
          ...state,
          nodes,
          issues,
          activities,
          audit: log(state, {
            rowId: a.id,
            field: 'restored',
            from: 'archived',
            to: 'active',
            at: a.now,
            by,
          }),
        },
        message: 'Record restored.',
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
          audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
            audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
          audit: log(state, {
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
      return {
        state: {
          ...state,
          issues: { ...state.issues, [a.issueId]: next },
          audit: log(state, {
            rowId: a.issueId,
            field: type.label,
            from: before.join(', ') || '—',
            to: after.join(', ') || '—',
            at: a.now,
            by,
          }),
        },
        message: `${type.label} updated.`,
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
    state: { ...state, model, audit: log(state, entry) },
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
      const person: Person = {
        id,
        name,
        roleIds: op.roleIds.filter((r) => m.roles[r] && !m.roles[r].deletedAt),
        fromSource: existing?.fromSource ?? false,
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
