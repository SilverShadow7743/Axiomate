/**
 * Axiomate TMS — the configuration plane.
 *
 * The operating model is data, not code. Nothing in this file names an Axiocloud-specific
 * role, responsibility, tier or agent as a literal the rest of the app depends on: the app
 * depends on *stable system keys*, and every human-readable label attached to a key is
 * editable.
 *
 *   System key: ISSUE_OWNER        (immutable, referenced by code, safe to rename around)
 *   Display label: "Owner"         (editable, referenced by nobody)
 *
 * That split is the whole point. Renaming "Owner" to "Resolution Lead" must change every
 * screen and never change a line of code, a stored record, or an audit entry.
 *
 * ---------------------------------------------------------------------------
 * What is configurable, and what deliberately is not
 *
 * Configurable: terminology, organisation roles, the person directory, issue responsibility
 * types (with cardinality, requiredness and role eligibility), the accountable-party
 * vocabulary, the agent registry, workflow composition, project templates, routing rules and
 * mail intake — each overridable per scope.
 *
 * NOT configurable: the issue status and severity vocabularies. Those are not labels; they
 * drive derived computation — `STATUS_PROGRESS` maps status to percent complete, and
 * `computeHealth` reads both. Letting a user add "Parked" would silently produce issues with
 * no progress and no health. Making those configurable means making the derivation
 * configurable too, which is a different piece of work; pretending otherwise would be a
 * settings screen that quietly corrupts the schedule.
 */

import { DEFAULT_SLA, type NodeKind, type RowKind, type ScheduleHealth, type SlaPolicy } from './types'
import type { Recurrence } from './recurrence'
import { DEFAULT_SIZE_BANDS, type SizeBand } from './estimation'
import { defaultStatusPolicy, type StatusPolicy } from './statusPolicy'
import type { Goal } from './goals'
import { ADMIN_ROLE_ID, MACHINE_ROLE_ID, defaultAccessPolicy, type AccessPolicy } from './access'
import { defaultWatchPolicy, type WatchPolicy } from './watch'
import { defaultApprovalRules, type ApprovalRule } from './approval'
import { defaultAutomationRules, type AutomationRule } from './automation'
import type { ResourceProfile } from './capacity'
import type { Skill } from './skills'

/* ================================================================== *
 * Scope
 * ================================================================== */

/**
 * The override chain. The spec names Organization → Engagement → Project → Issue; the tree
 * also carries a Process Area tier between Project and Issue, and it is a real place people
 * scope terminology ("Owner" means something different in Payroll), so it participates.
 *
 * `ROOT` is the organisation-wide default and is always the last link in every chain.
 *
 * There is deliberately **no separate list of scope tiers here.** One used to exist, ordered
 * `organization → engagement → project → module → issue`; it named the client tier
 * `organization`, omitted `company`, had no consumer anywhere, and was the third of three
 * disagreeing tier vocabularies. The tiers an override can be set at are the tiers of the
 * tree — `NODE_KINDS` in `./types` — and resolution does not consult a list at all: it walks
 * the real chain from the selected node upward, so the tree is the authority.
 *
 * One asymmetry is intentional and worth stating, because it looks like a bug: the
 * configuration screen offers structural tiers only, while `scopeChainOf` walks issue ids
 * too. An issue-keyed override would therefore resolve correctly if one were ever written —
 * the UI withholds it because scoping terminology to a single issue is a distinction nobody
 * can act on, not because the mechanism cannot carry it.
 */
export const ROOT_SCOPE = 'ROOT'

/* ================================================================== *
 * Terminology
 * ================================================================== */

/**
 * Every system key the UI is allowed to render a label for, with its shipped default.
 *
 * Adding a key here is a code change because something must render it. Changing its *label*
 * is a configuration change and needs no code at all.
 */
export const LABEL_KEYS = {
  /* Tiers */
  TIER_COMPANY: 'Company',
  TIER_ORGANIZATION: 'Client',
  TIER_ENGAGEMENT: 'Engagement',
  TIER_PROJECT: 'Project',
  TIER_MODULE: 'Process Area',

  /* Record kinds */
  RECORD_ISSUE: 'Issue',
  RECORD_SUB_ISSUE: 'Sub-Issue',
  RECORD_MILESTONE: 'Milestone',

  /* Responsibilities */
  ISSUE_OWNER: 'Owner',
  ISSUE_ACCOUNTABLE: 'Accountable Party',
  ISSUE_RAISED_BY: 'Raised By',

  /* Fields */
  FIELD_NEXT_ACTION: 'Next Action',
  FIELD_SEVERITY: 'Severity',
  FIELD_STATUS: 'Status',
  FIELD_SCHEDULE_HEALTH: 'Schedule Health',
  FIELD_DUE_DATE: 'Due Date',
  FIELD_START_DATE: 'Start Date',
} as const

export type LabelKey = keyof typeof LABEL_KEYS

/** Grouped for the settings screen, so related terms are edited together. */
export const LABEL_GROUPS: { title: string; note: string; keys: LabelKey[] }[] = [
  {
    title: 'Hierarchy tiers',
    note: 'What each level of the tree is called. These appear in the tree, the Add menu and every dialog.',
    keys: ['TIER_COMPANY', 'TIER_ORGANIZATION', 'TIER_ENGAGEMENT', 'TIER_PROJECT', 'TIER_MODULE'],
  },
  {
    title: 'Record kinds',
    note: 'What the things people create are called.',
    keys: ['RECORD_ISSUE', 'RECORD_SUB_ISSUE', 'RECORD_MILESTONE'],
  },
  {
    title: 'Responsibilities',
    note: 'The labels for who is answerable for a piece of work. Editing these renames the column, the filter and the form field together.',
    keys: ['ISSUE_OWNER', 'ISSUE_ACCOUNTABLE', 'ISSUE_RAISED_BY'],
  },
  {
    title: 'Fields',
    note: 'Column and field headings.',
    keys: [
      'FIELD_STATUS',
      'FIELD_SEVERITY',
      'FIELD_SCHEDULE_HEALTH',
      'FIELD_NEXT_ACTION',
      'FIELD_START_DATE',
      'FIELD_DUE_DATE',
    ],
  },
]

/* ================================================================== *
 * Whose workspace this is
 * ================================================================== */

/**
 * The delivery organisation operating this workspace.
 *
 * Axiomate is the product; Axiocloud Solutions is the firm running it. That distinction is
 * worth a record rather than a string in a header, because the two appear in different places
 * and mean different things — and because the tiers of the tree are Axiocloud's *clients*, not
 * Axiocloud itself. Without this, "Client" at the top of the tree has nothing to be a client of.
 *
 * `partyCode` is the value written to `Issue.accountable` for work this firm is answerable for.
 * It is deliberately separate from `name`: 179 imported rows already carry "Axiocloud", and
 * renaming the display name must never orphan them.
 */
export interface OrganizationIdentity {
  name: string
  shortName: string
  partyCode: string
  /** One line describing what this workspace is for. Shown on the configuration screen. */
  description: string
}

/**
 * Where documents are filed in SharePoint.
 *
 * Configuration rather than a constant, because the answer is a firm's own filing convention and
 * every firm already has one. The two parts are separated for a reason:
 *
 *   `rootFolder`  one folder the whole workspace lives under, so Axiomate's documents can be
 *                 found, moved, permissioned or backed up as one thing rather than being mixed
 *                 into a library somebody else also uses.
 *
 *   `byEngagement` whether the engagement or project a document belongs to becomes a folder of
 *                 its own beneath it. On, a person opening the library sees the same shape they
 *                 see in the tree. Off, everything sits directly under the root, which is what a
 *                 firm filing by year or by client instead would want.
 *
 * What is NOT configurable, and will not be: the tenant segment and the uuid on the stored name.
 * The first is the same isolation rule every composite key in this schema enforces, and the
 * second is what stops a re-upload of the same filename silently replacing evidence. Neither is
 * a filing preference.
 */
export interface DocumentFiling {
  rootFolder: string
  byEngagement: boolean
}

export const DEFAULT_DOCUMENT_FILING: DocumentFiling = {
  rootFolder: 'Projects',
  byEngagement: true,
}

export const DEFAULT_ORGANIZATION: OrganizationIdentity = {
  name: 'Axiocloud Solutions',
  shortName: 'Axiocloud',
  partyCode: 'Axiocloud',
  description:
    'Delivery workspace for Axiocloud Solutions and the client engagements it runs. The top tier of the tree is a client organisation; everything beneath it is work Axiocloud is delivering.',
}

/* ================================================================== *
 * Roles, people, responsibilities
 * ================================================================== */

export interface OrgRole {
  /** Stable system key. Seeded roles keep theirs forever; custom roles get `ROLE_<n>`. */
  id: string
  label: string
  description: string
  /** Seeded roles cannot be deleted, only relabelled — code and defaults reference them. */
  seeded: boolean
  deletedAt: string | null
}

export interface Person {
  id: string
  name: string
  roleIds: string[]
  /**
   * The work address, when it is known.
   *
   * Added for one reason: it is what an identity provider returns, and matching a signed-in
   * person to this directory by display name is a join on a field two people can share and one
   * person can change. Optional, because the imported log carries names and no addresses.
   */
  email?: string
  /** People discovered in the imported log rather than entered here. */
  fromSource: boolean

  /**
   * Seniority, and the specialism the person is deployed on — "Senior Technical Consultant" on
   * the "X++" track, "Senior Functional Consultant" on "SCM / manufacturing".
   *
   * **Kept apart from `roleIds`, and that separation is the whole point of these fields.**
   * A role here grants permissions; a grade describes a career. Folding one into the other means
   * either that promoting somebody silently widens what they can do, or that granting an
   * administrator permission implies a seniority nobody awarded. Both are wrong, and both are
   * the kind of wrong that is discovered long after the fact.
   *
   * Free text rather than an enum. Grades and tracks are a firm's own vocabulary and they change
   * — a firm that opens a data-engineering track should not need a release to say so. The cost
   * is that two spellings of the same grade will not match; that is a reporting problem, and it
   * is smaller than a list nobody can extend.
   */
  grade?: string
  track?: string

  /**
   * What the person is working toward, when that is not what they are.
   *
   * An intern preparing for an analyst role has a grade of "Intern" and a target of "Analyst".
   * Recording "Analyst" in `grade` would be the plainest kind of false statement this directory
   * could make — it would put somebody at a seniority they have not reached, and every capacity
   * and staffing view downstream would read it as fact.
   */
  developingToward?: string

  /**
   * Where the three fields above came from.
   *
   * `stated` means somebody said so. `default` means the shipped fallback was used. Absent means
   * nothing has been recorded either way, which is different again — and is the honest answer
   * for the twenty people in this directory nobody has described.
   *
   * The same vocabulary as `lib/intake.ts` and `ResourceProfile.source`, on purpose: a reader
   * who has learned it once should not have to learn it again per field.
   */
  source?: 'stated' | 'default'
}

/**
 * What kind of work an item is.
 *
 * This is the discriminator that makes one table the right answer to "one work-item table, or
 * ten?" — and the log had already answered it before anyone asked. The imported records carry
 * ten distinct types, Change Request and Defect and Query among them, coexisting in one table
 * with one schema and no strain. The blueprint's Work Item taxonomy (task, action, request,
 * defect, change request, risk, decision, deliverable) is the same shape at a different
 * altitude: adding one has to be configuration, not a migration.
 *
 * It was free text until now. That is why the types were unfilterable, unvalidated, and
 * invisible to the assistant, which could invent an eleventh by typo.
 *
 * Seeded from the types actually present in the imported log, never from the blueprint's list.
 * A registry pre-loaded with `Risk` and `Decision` would be asserting that this firm tracks
 * them, which the records do not show — the same rule that keeps the engagement fields blank.
 */
export interface WorkType {
  /** Stable system key. Discovered types get `WT_<SLUG>`; ones added here get `WT_<n>`. */
  id: string
  label: string
  description: string
  /** Discovered in the imported log rather than entered here, as with `Person`. */
  fromSource: boolean
  deletedAt: string | null
}

/** The work types on offer, in a stable order. */
export function liveWorkTypes(model: OperatingModel): WorkType[] {
  // `?? {}` because this can be reached with a model parsed from storage that predates the
  // key. `mergeModel` is what should prevent that; this is what stops it being a blank page.
  return Object.values(model.workTypes ?? {})
    .filter((t) => !t.deletedAt)
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** A readable, stable key for a type discovered in the log. */
export function workTypeId(label: string): string {
  return `WT_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`
}

/**
 * Which discipline resolves a piece of work — a **third** classification axis, and the reason it
 * is a third rather than a replacement is the whole design.
 *
 *     type        Defect | Change Request | Limitation | Request | Task | Action
 *     module      Finance | Production | Procurement | Inventory | Reporting | …
 *     discipline  Technical | Functional | Integration | Data | Compliance | …
 *
 * These vary independently. A **Technical** issue can be a Defect or a Change Request; an
 * **Integration** issue can sit in the Procurement module. Folding discipline into `type` — the
 * obvious shortcut, since both are dropdowns of similar length — makes "the technical defects"
 * an unaskable question, which is the one question the axis exists to answer.
 *
 * `ownerRoleId` is a **suggestion**, not an assignment. It records which role usually resolves
 * this kind of work so that routing has something to propose; nothing here sets an owner, and a
 * discipline whose usual owner is on leave must not stop the work being assigned to somebody
 * else. See `model.routingRules` for the mechanism that acts on it.
 */
export interface Discipline {
  /** Stable system key. Seeded ones keep theirs forever; ones added here get `DISC_<n>`. */
  id: string
  label: string
  description: string
  /** The role that usually resolves this. A proposal for routing, never an assignment. */
  ownerRoleId: string
  /** Seeded disciplines cannot be deleted, only relabelled — routing rules reference them. */
  seeded: boolean
  deletedAt: string | null
}

/**
 * The fourteen this firm works in, stated by the operating partner on 17 August 2026.
 *
 * `ownerRoleId` is mapped onto the eleven roles that actually exist, and where the stated owner
 * has no matching role the nearest one that does is used rather than a role being invented:
 * QA, DevOps, Security Administrator, Integration Consultant, Technical Architect and Account
 * Manager are all named in the source and none of them is a role in this workspace. Those rows
 * point at the closest real role and say so in the description, because a routing rule aimed at
 * a role nobody holds proposes nothing and looks like it is working.
 */
export const SEED_DISCIPLINES: readonly Omit<Discipline, 'seeded' | 'deletedAt'>[] = [
  { id: 'DISC_BUSINESS', label: 'Business', ownerRoleId: 'ROLE_FUNCTIONAL', description: 'Process unclear, business rule missing. Usually a business analyst or functional consultant.' },
  { id: 'DISC_FUNCTIONAL', label: 'Functional', ownerRoleId: 'ROLE_FUNCTIONAL', description: 'ERP setup or module behaviour incorrect.' },
  { id: 'DISC_TECHNICAL', label: 'Technical', ownerRoleId: 'ROLE_TECHNICAL', description: 'Code, extension or customisation error.' },
  { id: 'DISC_INTEGRATION', label: 'Integration', ownerRoleId: 'ROLE_TECHNICAL', description: 'API, interface or middleware failure. Stated owner is an integration consultant; this workspace has no such role, so it points at Technical Consultant.' },
  { id: 'DISC_DATA', label: 'Data', ownerRoleId: 'ROLE_FUNCTIONAL', description: 'Migration, master data, reconciliation. Stated owner is a data consultant; nearest real role is Functional Consultant.' },
  { id: 'DISC_CONFIGURATION', label: 'Configuration', ownerRoleId: 'ROLE_FUNCTIONAL', description: 'Parameters, workflows, posting setup.' },
  { id: 'DISC_TESTING', label: 'Testing', ownerRoleId: 'ROLE_SUPPORT', description: 'Test failure, test environment, test coverage. Stated owner is QA or a test analyst; nearest real role is Support Analyst.' },
  { id: 'DISC_ENVIRONMENT', label: 'Environment', ownerRoleId: 'ROLE_ADMIN', description: 'DEV, UAT, PROD or deployment issue. Stated owner is DevOps or a system administrator; nearest real role is Platform Administrator.' },
  { id: 'DISC_SECURITY', label: 'Security & access', ownerRoleId: 'ROLE_ADMIN', description: 'Roles, permissions, authentication. Stated owner is a security administrator; nearest real role is Platform Administrator.' },
  { id: 'DISC_PERFORMANCE', label: 'Performance', ownerRoleId: 'ROLE_PRINCIPAL', description: 'Slow transactions, batch performance. Stated owner is a technical architect; nearest real role is Principal Consultant.' },
  { id: 'DISC_DELIVERY', label: 'Project / delivery', ownerRoleId: 'ROLE_PROJECT_MANAGER', description: 'Timeline, resource, dependency, coordination.' },
  { id: 'DISC_GOVERNANCE', label: 'Decision / governance', ownerRoleId: 'ROLE_ENGAGEMENT_LEAD', description: 'Pending decision, approval, escalation.' },
  { id: 'DISC_COMMERCIAL', label: 'Commercial / scope', ownerRoleId: 'ROLE_ENGAGEMENT_LEAD', description: 'Out-of-scope work, SOW ambiguity, change request. Stated owner is an engagement or account manager.' },
  { id: 'DISC_COMPLIANCE', label: 'Compliance', ownerRoleId: 'ROLE_FUNCTIONAL', description: 'Tax, statutory, audit or policy requirement. Stated owner is a compliance or functional lead.' },
]

/** The disciplines on offer, in the order they were seeded rather than alphabetically. */
export function liveDisciplines(model: OperatingModel): Discipline[] {
  // `?? {}` because this can be reached with a model parsed from storage that predates the key.
  const all = Object.values(model.disciplines ?? {}).filter((d) => !d.deletedAt)
  const order = new Map(SEED_DISCIPLINES.map((d, i) => [d.id, i]))
  // Seeded first, in their stated order, because that order is the firm's own escalation shape —
  // business through technical through delivery through governance. Custom ones sort after, by
  // name, since nothing establishes where they belong in that sequence.
  return all.sort((a, b) => {
    const ai = order.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bi = order.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return ai === bi ? a.label.localeCompare(b.label) : ai - bi
  })
}

/** The label to show for a stored discipline id, or the id itself if it no longer resolves. */
export function disciplineLabel(model: OperatingModel, id: string): string {
  if (!id) return ''
  return model.disciplines?.[id]?.label ?? id
}

/**
 * The skill catalogue, grouped the way a firm reads it: by category, then by name.
 *
 * `?? {}` for the same reason `liveDisciplines` has it — this is reachable with a model parsed
 * from browser storage that predates the key, where `mergeModel` has not run.
 */
export function liveSkills(model: OperatingModel): Skill[] {
  return Object.values(model.skills ?? {})
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

/** The name to show for a stored skill id, or the id itself if it no longer resolves. */
export function skillName(model: OperatingModel, id: string): string {
  return model.skills?.[id]?.name ?? id
}

/**
 * What a responsibility can be filled with.
 *  - `person` resolves against the directory (Owner, Raised By)
 *  - `party`  resolves against the accountable-party vocabulary (an organisation, not a human)
 *  - `text`   is free text, for responsibilities nobody has modelled yet
 */
export type ValueKind = 'person' | 'party' | 'text'

export interface ResponsibilityType {
  id: string
  label: string
  description: string
  valueKind: ValueKind
  /** How many values may be assigned. `max: null` means unbounded. */
  minCount: number
  maxCount: number | null
  required: boolean
  /**
   * Roles permitted to fill this responsibility. Empty means anyone.
   *
   * Enforced only for people who actually carry a role — see `checkEligibility`. The imported
   * log has 60-odd owner names and no directory, so strict enforcement would reject every
   * existing assignment and make the app read-only until someone typed in the whole company.
   */
  eligibleRoleIds: string[]
  /**
   * Seeded responsibilities are backed by an existing column on the issue record, so they
   * keep working with the grid, the filters, sorting and the assistant. Custom ones live in
   * `IssueRecord.assignments`.
   */
  systemField: 'owner' | 'accountable' | 'raisedBy' | null
  seeded: boolean
  order: number
  deletedAt: string | null
}

/* ================================================================== *
 * Agents
 * ================================================================== */

/**
 * Agent families, from the delivery architecture. These group the registry; they carry no
 * behaviour.
 */
export const AGENT_FAMILIES = [
  'Intake & Communication',
  'Issue & Delivery',
  'Project Management',
  'Resource & Capacity',
  'Time & Productivity',
  'SOW & Commercial',
  'Knowledge & Documents',
  'Governance & Management',
] as const
export type AgentFamily = (typeof AGENT_FAMILIES)[number]

/**
 * How much an agent may do on its own.
 *
 * `act` is defined so the model can express it, but no agent in this build offers it: acting
 * without a human needs an execution runtime that does not exist, and offering the setting
 * would be a switch that silently does nothing.
 */
export type Autonomy = 'off' | 'suggest' | 'propose' | 'act'

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  off: 'Off',
  suggest: 'Suggest only — read, answer, never propose a change',
  propose: 'Propose — draft changes for a person to approve',
  act: 'Act — apply changes directly',
}

/**
 * Whether anything actually executes this agent.
 *
 * `live` means it runs today. `declared` means it is configured here and nothing executes it
 * yet — the registry is the design, not an implementation. Every screen shows this, because a
 * settings page that looks identical for both is a page that lies.
 */
export type AgentRuntime = 'live' | 'declared'

export interface AgentRecord {
  id: string
  name: string
  family: AgentFamily
  description: string
  /** Delivery priority from the architecture: the ten core agents, then the rest. */
  priority: 'P0' | 'P1' | 'backlog'
  runtime: AgentRuntime
  enabled: boolean
  autonomy: Autonomy
  /** Ceiling the record cannot be configured past, because nothing implements beyond it. */
  maxAutonomy: Autonomy
  /** Human approval required before an applied change takes effect. */
  requireApproval: boolean
}

export interface WorkflowStep {
  agentId: string
  /** Steps that must complete first. Empty means it runs at the start. */
  afterIds: string[]
}

export interface WorkflowRecord {
  id: string
  name: string
  description: string
  trigger: string
  steps: WorkflowStep[]
  runtime: AgentRuntime
  enabled: boolean
}

/**
 * A bundle a project can adopt: which agents it turns on, and whether a human signs off.
 * This is the object that makes agents composable per project instead of global.
 */
export interface ProjectTemplate {
  id: string
  name: string
  description: string
  agentIds: string[]
  workflowIds: string[]
  /** Applied to every agent the template enables, overriding the agent's own default. */
  requireApproval: boolean
}

/* ================================================================== *
 * Routing and intake
 * ================================================================== */

export interface RoutingRule {
  id: string
  name: string
  /** All conditions must hold. Empty values are ignored. */
  when: { module: string; severity: string; keyword: string }
  /** What to propose when they do. */
  then: { responsibilityTypeId: string; value: string }
  enabled: boolean
  order: number
}

export interface IntakeMailbox {
  id: string
  address: string
  /** Scope id new issues are filed under. */
  scopeId: string
  /** Agents that would process a message arriving here, in order. */
  workflowId: string | null
  enabled: boolean
}

/**
 * A public form that captures structured work into the same pipeline as mail.
 *
 * The token is the whole gate, as the mailbox address is: anyone holding the URL may submit,
 * nobody holding it may read. It is minted by the caller when the form is created — never in
 * the reducer, which must stay replayable — and it never changes on later edits unless one is
 * explicitly sent.
 */
export interface IntakeForm {
  id: string
  /** Shown to the submitter ("the OAPIL request form") and on the provenance note. */
  name: string
  /** Scope id new issues are filed under. Must be able to hold an issue. */
  scopeId: string
  enabled: boolean
  /** The capability in the URL. Blank is refused at creation. */
  token: string
}

/* ================================================================== *
 * Scope overrides
 * ================================================================== */

export interface ScopeOverride {
  /** Terminology overrides. Only keys present here override the parent scope. */
  labels: Partial<Record<LabelKey, string>>
  /** Responsibility requiredness, per responsibility type id. */
  responsibilityRequired: Record<string, boolean>
  /** Agent enablement, per agent id. */
  agentEnabled: Record<string, boolean>
  /** Template adopted at this scope. */
  templateId: string | null
}

export function emptyOverride(): ScopeOverride {
  return { labels: {}, responsibilityRequired: {}, agentEnabled: {}, templateId: null }
}

/* ================================================================== *
 * The model
 * ================================================================== */

export interface OperatingModel {
  /** The delivery firm operating this workspace. */
  organization: OrganizationIdentity
  /** Where uploaded documents are filed in the library. See `DocumentFiling`. */
  documentFiling: DocumentFiling
  /**
   * Targets the firm has set for itself. Progress is never stored — see `lib/goals.ts`.
   *
   * Here rather than in its own table for the same reason `approvalRules` and `sla` are: a goal
   * is a policy statement about intent, not a transaction. It is written rarely, read on every
   * load, and needs no migration to add.
   */
  goals: Record<string, Goal>
  roles: Record<string, OrgRole>
  people: Record<string, Person>
  responsibilities: Record<string, ResponsibilityType>
  /** What kind of work an item is — the discriminator that keeps this one table. */
  workTypes: Record<string, WorkType>
  /** Which discipline resolves it. Independent of `workTypes` — see `Discipline`. */
  disciplines: Record<string, Discipline>
  /**
   * The firm's skill catalogue. See `lib/skills.ts`.
   *
   * Ships **empty**, and is the only vocabulary here that does. Roles, work types and
   * disciplines have defensible defaults because every consultancy has roughly those; a skill
   * list is the firm's own competitive shape and a shipped one would be a guess presented as a
   * starting point. The levels people are recorded at are NOT here — they are per person,
   * attributed and dated, and they live in their own table.
   */
  skills: Record<string, Skill>
  /**
   * How long each severity is allowed, in working days from the raised date.
   *
   * Configuration rather than a constant because it is a commercial term, not a property of
   * the software: it is negotiated per engagement and differs between firms. It was a frozen
   * constant while it only drew a dashed suggestion; once it started setting real due dates —
   * and therefore deciding what the daily report calls overdue — leaving it uneditable meant
   * shipping one firm's numbers as everyone's.
   */
  sla: SlaPolicy
  /**
   * What each T-shirt size costs this firm, in story points and hours.
   *
   * Configuration for the same reason the service levels are: two firms using an identical
   * complexity model will disagree about what an L is worth, and the estimation screen is
   * explicitly forbidden from hardcoding it.
   */
  sizeBands: SizeBand[]
  /**
   * How work is allowed to move through the status vocabulary.
   *
   * Configuration rather than code for the same reason the service levels are: the vocabulary
   * is fixed because progress is derived from it, but the route through it is a delivery
   * process, and delivery processes differ between firms.
   */
  statusPolicy: StatusPolicy
  /**
   * Who may do what. See `./access` — authorisation is enforced, authentication is not yet,
   * and the difference is stated there rather than implied here.
   */
  access: AccessPolicy
  /** Which moves need somebody's approval, and who may give it. See `./approval`. */
  approvalRules: ApprovalRule[]
  /** Event → condition → action. See `./automation`. */
  automationRules: AutomationRule[]
  /**
   * What each person's week looks like, keyed by directory id.
   *
   * Master data rather than a delivery record: it is a fact about employment, and it changes
   * when somebody goes part-time rather than when a project starts. Absent for most people,
   * which is a real state — `capacityFor` falls back to a stated default and says so.
   */
  resourceProfiles: Record<string, ResourceProfile>
  /** What the scheduled pass looks for, and how sensitive it is. See `./watch`. */
  watch: WatchPolicy
  /** Organisations that can be answerable for an issue. Editable — these are facts about who
   *  you work with, not values anything computes from. */
  parties: string[]
  agents: Record<string, AgentRecord>
  workflows: Record<string, WorkflowRecord>
  templates: Record<string, ProjectTemplate>
  routingRules: RoutingRule[]
  intake: IntakeMailbox[]
  /** Public structured-capture forms feeding the same pipeline. */
  intakeForms: IntakeForm[]
  /** Rules that raise an issue on a cadence, fired by the daily pass. See lib/recurrence.ts. */
  recurrences: Recurrence[]
  /** Keyed by scope node id, plus `ROOT` for the organisation-wide defaults. */
  overrides: Record<string, ScopeOverride>
  /** Mints ids for records added here. */
  seq: number
}

/* ================================================================== *
 * Seeds
 * ================================================================== */

/**
 * Roles as Axiocloud Solutions runs delivery.
 *
 * Two sides, kept distinct because responsibility eligibility turns on which one somebody is
 * on: `side: 'delivery'` is Axiocloud's own people, `side: 'client'` is the customer's. The
 * imported log has owners from both, which is exactly why eligibility ships switched off —
 * see `checkAssignment`.
 *
 * These are role *definitions*, not claims about who holds them. The directory starts with
 * every name from the log and no roles assigned, because the log records who worked an issue
 * and never records what they are.
 */
const SEED_ROLES: Omit<OrgRole, 'deletedAt'>[] = [
  // Administering the platform is not a delivery role, which is why it sits outside the nine
  // and why nobody holds it by virtue of leading an engagement.
  { id: MACHINE_ROLE_ID, label: 'Automation', description: 'Not a person. Held by the intake endpoint and the scheduled pass, so what they may do is stated rather than inherited.', seeded: true },
  { id: ADMIN_ROLE_ID, label: 'Platform Administrator', description: 'Axiocloud. Maintains the operating model itself — terminology, roles, service levels, transitions and permissions.', seeded: true },
  { id: 'ROLE_ENGAGEMENT_LEAD', label: 'Engagement Leader', description: 'Axiocloud. Answerable for the engagement as a whole and for the client relationship.', seeded: true },
  { id: 'ROLE_PRINCIPAL', label: 'Principal Consultant', description: 'Axiocloud. Owns solution design and the hardest delivery calls.', seeded: true },
  { id: 'ROLE_PROJECT_MANAGER', label: 'Project Manager', description: 'Axiocloud. Owns plan, schedule and delivery governance.', seeded: true },
  { id: 'ROLE_FUNCTIONAL', label: 'Functional Consultant', description: 'Axiocloud. Process configuration and functional resolution — the bulk of issue ownership.', seeded: true },
  { id: 'ROLE_TECHNICAL', label: 'Technical Consultant', description: 'Axiocloud. Extensions, integrations, data and anything requiring development.', seeded: true },
  { id: 'ROLE_SUPPORT', label: 'Support Analyst', description: 'Axiocloud. First response, triage and reproduction.', seeded: true },
  { id: 'ROLE_CLIENT_SPONSOR', label: 'Client Sponsor', description: 'Client side. Decision maker for scope, priority and acceptance.', seeded: true },
  { id: 'ROLE_CLIENT_LEAD', label: 'Client Process Lead', description: 'Client side. Owns a process area and confirms that a resolution works in practice.', seeded: true },
  { id: 'ROLE_CLIENT_USER', label: 'Client User', description: 'Client side. Raises issues and confirms resolutions.', seeded: true },
]

const SEED_RESPONSIBILITIES: Omit<ResponsibilityType, 'deletedAt'>[] = [
  {
    id: 'ISSUE_OWNER',
    label: LABEL_KEYS.ISSUE_OWNER,
    description: 'The single person driving this issue to resolution.',
    valueKind: 'person',
    minCount: 0,
    maxCount: 1,
    required: true,
    eligibleRoleIds: [],
    systemField: 'owner',
    seeded: true,
    order: 0,
  },
  {
    id: 'ISSUE_ACCOUNTABLE',
    label: LABEL_KEYS.ISSUE_ACCOUNTABLE,
    description: 'The organisation answerable for the outcome.',
    valueKind: 'party',
    minCount: 0,
    maxCount: 1,
    required: true,
    eligibleRoleIds: [],
    systemField: 'accountable',
    seeded: true,
    order: 1,
  },
  {
    id: 'ISSUE_RAISED_BY',
    label: LABEL_KEYS.ISSUE_RAISED_BY,
    description: 'Who reported it. Recorded once and not reassigned.',
    valueKind: 'person',
    minCount: 0,
    maxCount: 1,
    required: false,
    eligibleRoleIds: [],
    systemField: 'raisedBy',
    seeded: true,
    order: 2,
  },
]

/**
 * Who can be answerable for an issue.
 *
 * These are the values already written on the 179 imported rows, so the list is the log's, not
 * an invention — `Axiocloud` is the delivery firm, `OAPIL` and `SLG` are its two clients,
 * `Shared` covers work neither side owns alone. The codes stay exactly as stored even though
 * the firm's display name is "Axiocloud Solutions": changing a stored value to match a label
 * would orphan every row that carries it.
 */
export const SEED_PARTIES = ['Axiocloud', 'OAPIL', 'SLG', 'Shared', 'Unassigned']

type SeedAgent = Omit<AgentRecord, 'enabled' | 'autonomy' | 'requireApproval'>

/**
 * The agent registry.
 *
 * These are records, not implementations. The architecture calls for agents to be
 * *capabilities* that workflows compose, so the catalogue is data — 38 entries across eight
 * families, each with a delivery priority, exactly one of which has a runtime today.
 *
 * Nothing here is a stub waiting to be filled in. An entry marked `declared` is a decision
 * that has been recorded: what the agent is for, how autonomous it may be, and whether a
 * human signs off. Writing the agent is a separate act.
 */
const SEED_AGENTS: SeedAgent[] = [
  /* -- the one that runs -- */
  {
    id: 'AGENT_WORKSPACE_ASSISTANT',
    name: 'Workspace Assistant',
    family: 'Issue & Delivery',
    description:
      'Finds issues, and drafts new ones and changes to existing ones, from a plain description. Every change is a proposal a person applies.',
    priority: 'P0',
    runtime: 'live',
    maxAutonomy: 'propose',
  },

  /* -- Intake & Communication -- */
  { id: 'AGENT_EMAIL_INTAKE', name: 'Project Email Intake', family: 'Intake & Communication', description: 'Reads the project mailbox and turns messages and attachments into new or updated work items.', priority: 'P0', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_CLASSIFICATION', name: 'Issue Classification', family: 'Intake & Communication', description: 'Determines work type, module, process, severity, priority, complexity and business impact.', priority: 'P0', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_DUPLICATE', name: 'Duplicate Detection', family: 'Intake & Communication', description: 'Asks whether an inbound item is genuinely new before anything is created.', priority: 'P0', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_COMMUNICATION', name: 'Communication', family: 'Intake & Communication', description: 'Decides who needs to know, whether a reply is required and whether an action should be raised.', priority: 'P0', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_MEETING_ACTIONS', name: 'Meeting-to-Action', family: 'Intake & Communication', description: 'Turns a transcript into decisions, actions, issues, risks, dependencies, owners and dates.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'propose' },

  /* -- Issue & Delivery -- */
  { id: 'AGENT_TRIAGE', name: 'Issue Triage', family: 'Issue & Delivery', description: 'Recommends severity, priority, owner, accountable party, next action and SLA for a new issue.', priority: 'P0', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_ROUTING', name: 'Issue Routing', family: 'Issue & Delivery', description: 'Chooses which of the actual project resources should own an issue, from skills, allocation, workload and module responsibility.', priority: 'P0', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_RESOLUTION_ASSIST', name: 'Resolution Assistant', family: 'Issue & Delivery', description: 'Proposes likely root cause, investigation steps and candidate actions from history and similar past issues.', priority: 'P0', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_ISSUE_SUMMARY', name: 'Issue Summary', family: 'Issue & Delivery', description: 'States what happened, what has been done, what is blocked and what happens next.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_ESCALATION', name: 'Escalation', family: 'Issue & Delivery', description: 'Watches severity, age, SLA, client impact and dependencies, and recommends escalation.', priority: 'P0', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_RESOLUTION_VERIFY', name: 'Resolution Verification', family: 'Issue & Delivery', description: 'Checks that a resolution is described, evidenced, tested and confirmed before closure is allowed.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'propose' },
  /*
   * `runtime: 'live'` — it is one of two agents in this build that actually runs. The rest are
   * declared: the registry describes the intended estate so the configuration screen is honest
   * about what exists, and a declared agent does nothing however it is configured.
   *
   * `maxAutonomy: 'propose'` is a ceiling, not a preference. It scores complexity by reading
   * words, and words are a proxy for the work; the estimate it writes is never baselined, so
   * nothing downstream can mistake it for one a person agreed. See lib/estimator.ts.
   */
  { id: 'AGENT_ESTIMATION', name: 'Estimation', family: 'Issue & Delivery', description: 'Proposes complexity scores for an issue by reading it against known delivery patterns for the product. Sizes and hours are derived from those scores by the firm\'s own calibration, exactly as they are for a person\'s estimate. Never agreed, never baselined — a starting point for a conversation.', priority: 'P1', runtime: 'live', maxAutonomy: 'propose' },

  /* -- Project Management -- */
  { id: 'AGENT_PROJECT_HEALTH', name: 'Project Health', family: 'Project Management', description: 'Derives project health from milestones, issues, risks, dependencies, capacity, budget and client communication.', priority: 'P1', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_MILESTONE_RISK', name: 'Milestone Risk', family: 'Project Management', description: 'Predicts whether a milestone will actually land on time.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_DEPENDENCY', name: 'Dependency', family: 'Project Management', description: 'Detects cross-project, cross-issue and client-decision dependencies and their cascading impact.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_RAID', name: 'RAID', family: 'Project Management', description: 'Maintains risks, assumptions, issues and dependencies, and proposes new entries from project activity.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'propose' },

  /* -- Resource & Capacity -- */
  { id: 'AGENT_ALLOCATION', name: 'Resource Allocation', family: 'Resource & Capacity', description: 'Answers who should receive a piece of work.', priority: 'P1', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_CAPACITY_PLANNING', name: 'Capacity Planning', family: 'Resource & Capacity', description: 'Forecasts available capacity against planned allocation and expected demand.', priority: 'P1', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_WORKLOAD_BALANCE', name: 'Workload Balancing', family: 'Resource & Capacity', description: 'Spots over- and under-loaded people and proposes moving work between them.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_SKILL_MATCH', name: 'Skill Matching', family: 'Resource & Capacity', description: 'Matches a required capability to the best available person by skill, experience and availability.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_RESOURCE_FORECAST', name: 'Resource Forecast', family: 'Resource & Capacity', description: 'Predicts future resource requirements ahead of them becoming urgent.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },

  /* -- Time & Productivity -- */
  { id: 'AGENT_TIMESHEET', name: 'Timesheet Intelligence', family: 'Time & Productivity', description: 'Checks for missing time, wrong project coding and unsubmitted timesheets. For accuracy and governance, not for pressing people to book more hours.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_EFFORT_VARIANCE', name: 'Effort Variance', family: 'Time & Productivity', description: 'Compares estimated, allocated and actual effort and asks what accounts for the gap.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_UTILIZATION', name: 'Utilization', family: 'Time & Productivity', description: 'Reports billable, non-billable, internal, training, leave and available time, and the trend.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_CAPACITY_ACTUAL', name: 'Capacity vs Actual', family: 'Time & Productivity', description: 'Asks whether planned capacity matched reality, to improve the next estimate.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },

  /* -- SOW & Commercial -- */
  { id: 'AGENT_SOW_INTELLIGENCE', name: 'SOW Intelligence', family: 'SOW & Commercial', description: 'Extracts scope, deliverables, milestones, assumptions, exclusions, roles, effort and acceptance criteria from the statement of work.', priority: 'P1', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_SCOPE_GUARD', name: 'Scope Guard', family: 'SOW & Commercial', description: 'Asks whether work being requested is actually inside the SOW, and recommends a change request when it is not.', priority: 'P1', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_CHANGE_REQUEST', name: 'Change Request', family: 'SOW & Commercial', description: 'Drafts a change request with scope, effort, timeline and commercial impact.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_MARGIN', name: 'Margin Protection', family: 'SOW & Commercial', description: 'Watches revenue, cost, hours and scope leakage against a configured margin threshold.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_BILLING_READY', name: 'Billing Readiness', family: 'SOW & Commercial', description: 'Determines whether approved time, billable work, milestones and change requests make a project ready to bill.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },

  /* -- Knowledge & Documents -- */
  { id: 'AGENT_DOCUMENT_INTEL', name: 'Document Intelligence', family: 'Knowledge & Documents', description: 'Reads SOWs, requirements, designs, spreadsheets, PDFs, notes and email, and extracts structure.', priority: 'P1', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_EVIDENCE', name: 'Evidence', family: 'Knowledge & Documents', description: 'Associates screenshots, spreadsheets, PDFs, logs and email with the work item they belong to.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'propose' },
  { id: 'AGENT_KNOWLEDGE_RETRIEVAL', name: 'Knowledge Retrieval', family: 'Knowledge & Documents', description: 'Answers whether something like this has been solved before, across projects, resolved issues and SOPs.', priority: 'P1', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_PROJECT_KNOWLEDGE', name: 'Project Knowledge', family: 'Knowledge & Documents', description: 'Builds the project context — architecture, modules, configuration, decisions, known issues, people — that other agents read.', priority: 'P1', runtime: 'declared', maxAutonomy: 'suggest' },

  /* -- Governance & Management -- */
  { id: 'AGENT_DELIVERY_GOVERNANCE', name: 'Delivery Governance', family: 'Governance & Management', description: 'Checks whether projects are following the configured operating standards.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_COMPLIANCE', name: 'Compliance', family: 'Governance & Management', description: 'Checks configured policies: approvals, evidence, timesheets, documents, SLA and closure requirements.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_PROJECT_MANAGER', name: 'Project Manager', family: 'Governance & Management', description: 'Orchestrator. Consumes the other agents’ output and recommends the few actions that matter today.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
  { id: 'AGENT_EXECUTIVE', name: 'Executive Brief', family: 'Governance & Management', description: 'Answers what the business needs to know across projects, margin, capacity, delivery, risk and billing.', priority: 'backlog', runtime: 'declared', maxAutonomy: 'suggest' },
]

/** Sensible starting autonomy: never above what the record allows. */
function seedAgent(a: SeedAgent): AgentRecord {
  const autonomy: Autonomy = a.runtime === 'live' ? a.maxAutonomy : 'off'
  return { ...a, enabled: a.runtime === 'live', autonomy, requireApproval: true }
}

const SEED_WORKFLOWS: WorkflowRecord[] = [
  {
    id: 'WF_INBOUND_ISSUE',
    name: 'Inbound issue from email',
    description:
      'The composition the architecture describes: read the mailbox, classify, check it is not a duplicate and not out of scope, route it to an owner, then assist and verify.',
    trigger: 'A message arrives at a configured mailbox',
    steps: [
      { agentId: 'AGENT_EMAIL_INTAKE', afterIds: [] },
      { agentId: 'AGENT_CLASSIFICATION', afterIds: ['AGENT_EMAIL_INTAKE'] },
      { agentId: 'AGENT_DUPLICATE', afterIds: ['AGENT_CLASSIFICATION'] },
      { agentId: 'AGENT_SCOPE_GUARD', afterIds: ['AGENT_CLASSIFICATION'] },
      { agentId: 'AGENT_ROUTING', afterIds: ['AGENT_DUPLICATE', 'AGENT_SCOPE_GUARD'] },
      { agentId: 'AGENT_RESOLUTION_ASSIST', afterIds: ['AGENT_ROUTING'] },
      { agentId: 'AGENT_RESOLUTION_VERIFY', afterIds: ['AGENT_RESOLUTION_ASSIST'] },
      { agentId: 'AGENT_COMMUNICATION', afterIds: ['AGENT_RESOLUTION_VERIFY'] },
    ],
    runtime: 'declared',
    enabled: false,
  },
  {
    id: 'WF_SLA_WATCH',
    name: 'SLA and escalation watch',
    description: 'Periodic pass over open issues that recommends escalation before a target date is missed.',
    trigger: 'Daily',
    steps: [
      { agentId: 'AGENT_ESCALATION', afterIds: [] },
      { agentId: 'AGENT_COMMUNICATION', afterIds: ['AGENT_ESCALATION'] },
    ],
    runtime: 'declared',
    enabled: false,
  },
]

const SEED_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'TPL_STANDARD_DELIVERY',
    name: 'Axiocloud standard delivery',
    description:
      'The firm-wide operating standard for a client engagement: mailbox intake, classification, duplicate checking, routing to an owner, and SLA escalation — with a person approving every assignment.',
    agentIds: [
      'AGENT_WORKSPACE_ASSISTANT',
      'AGENT_EMAIL_INTAKE',
      'AGENT_CLASSIFICATION',
      'AGENT_DUPLICATE',
      'AGENT_ROUTING',
      'AGENT_ESCALATION',
    ],
    workflowIds: ['WF_INBOUND_ISSUE', 'WF_SLA_WATCH'],
    requireApproval: true,
  },
  {
    id: 'TPL_HYPERCARE',
    name: 'Hypercare',
    description:
      'For the weeks after go-live, when volume is high and nothing should sit unseen: everything in the standard, plus triage, resolution assistance and closure verification.',
    agentIds: [
      'AGENT_WORKSPACE_ASSISTANT',
      'AGENT_EMAIL_INTAKE',
      'AGENT_CLASSIFICATION',
      'AGENT_DUPLICATE',
      'AGENT_TRIAGE',
      'AGENT_ROUTING',
      'AGENT_ESCALATION',
      'AGENT_RESOLUTION_ASSIST',
      'AGENT_RESOLUTION_VERIFY',
    ],
    workflowIds: ['WF_INBOUND_ISSUE', 'WF_SLA_WATCH'],
    requireApproval: true,
  },
  {
    id: 'TPL_LIGHT_TOUCH',
    name: 'Light touch',
    description:
      'For small or closely-held engagements: the assistant only, nothing automated, nothing reading a mailbox.',
    agentIds: ['AGENT_WORKSPACE_ASSISTANT'],
    workflowIds: [],
    requireApproval: true,
  },
]

/**
 * Build the shipped operating model.
 *
 * `sourceOwners` seeds the person directory from names already in the log. They arrive with
 * no roles, which is the honest state: the log records who was working an issue, never what
 * they are.
 */
export function initModel(sourceOwners: string[], sourceTypes: string[] = []): OperatingModel {
  const roles: Record<string, OrgRole> = {}
  for (const r of SEED_ROLES) roles[r.id] = { ...r, deletedAt: null }

  const responsibilities: Record<string, ResponsibilityType> = {}
  for (const r of SEED_RESPONSIBILITIES) responsibilities[r.id] = { ...r, deletedAt: null }

  const people: Record<string, Person> = {}
  let n = 0
  for (const name of sourceOwners) {
    const clean = name.trim()
    if (!clean || clean === 'Unassigned') continue
    n += 1
    people[`PERSON_${n}`] = { id: `PERSON_${n}`, name: clean, roleIds: [], fromSource: true }
  }

  // Discovered, not invented: whatever the imported records actually say they are.
  const workTypes: Record<string, WorkType> = {}
  for (const label of sourceTypes) {
    const clean = label.trim()
    if (!clean) continue
    const id = workTypeId(clean)
    if (workTypes[id]) continue
    workTypes[id] = { id, label: clean, description: '', fromSource: true, deletedAt: null }
  }

  const disciplines: Record<string, Discipline> = {}
  for (const s of SEED_DISCIPLINES) disciplines[s.id] = { ...s, seeded: true, deletedAt: null }

  // Empty on purpose — see `OperatingModel.skills`. There is no `SEED_SKILLS`.
  const skills: Record<string, Skill> = {}

  const agents: Record<string, AgentRecord> = {}
  for (const a of SEED_AGENTS) agents[a.id] = seedAgent(a)

  const workflows: Record<string, WorkflowRecord> = {}
  for (const w of SEED_WORKFLOWS) workflows[w.id] = w

  const templates: Record<string, ProjectTemplate> = {}
  for (const t of SEED_TEMPLATES) templates[t.id] = t

  return {
    organization: { ...DEFAULT_ORGANIZATION },
    documentFiling: { ...DEFAULT_DOCUMENT_FILING },
    // Empty, not seeded. A shipped goal would be this product asserting what a firm should aim
    // at, which is not something it knows.
    goals: {},
    roles,
    people,
    responsibilities,
    workTypes,
    disciplines,
    skills,
    sla: { ...DEFAULT_SLA },
    sizeBands: DEFAULT_SIZE_BANDS.map((b) => ({ ...b })),
    statusPolicy: defaultStatusPolicy(),
    access: defaultAccessPolicy(),
    approvalRules: defaultApprovalRules(),
    automationRules: defaultAutomationRules(),
    resourceProfiles: {},
    watch: defaultWatchPolicy(),
    parties: [...SEED_PARTIES],
    agents,
    workflows,
    templates,
    routingRules: [],
    intake: [],
    intakeForms: [],
    recurrences: [],
    overrides: { [ROOT_SCOPE]: emptyOverride() },
    seq: n + 1,
  }
}

/* ================================================================== *
 * Resolution
 * ================================================================== */

/**
 * Resolve a label for a scope chain, nearest override first.
 *
 * `chain` runs fine → coarse and need not include ROOT; ROOT is always consulted last, and
 * the shipped default backs everything.
 */
export function resolveLabel(model: OperatingModel, key: LabelKey, chain: string[] = []): string {
  for (const scopeId of chain) {
    const v = model.overrides[scopeId]?.labels?.[key]
    if (v) return v
  }
  const root = model.overrides[ROOT_SCOPE]?.labels?.[key]
  if (root) return root
  return LABEL_KEYS[key]
}

/** Every label at once, for a scope. Handy for the grid and for prompting. */
export function resolveLabels(model: OperatingModel, chain: string[] = []): Record<LabelKey, string> {
  const out = {} as Record<LabelKey, string>
  for (const key of Object.keys(LABEL_KEYS) as LabelKey[]) out[key] = resolveLabel(model, key, chain)
  return out
}

/** Whether an agent is on for a scope: nearest explicit override, else the agent's own flag. */
export function resolveAgentEnabled(
  model: OperatingModel,
  agentId: string,
  chain: string[] = [],
): boolean {
  for (const scopeId of [...chain, ROOT_SCOPE]) {
    const v = model.overrides[scopeId]?.agentEnabled?.[agentId]
    if (typeof v === 'boolean') return v
  }
  return model.agents[agentId]?.enabled ?? false
}

/** Effective autonomy, clamped to what the agent can actually do and to being enabled. */
export function resolveAutonomy(
  model: OperatingModel,
  agentId: string,
  chain: string[] = [],
): Autonomy {
  const agent = model.agents[agentId]
  if (!agent) return 'off'
  if (!resolveAgentEnabled(model, agentId, chain)) return 'off'
  return clampAutonomy(agent.autonomy, agent.maxAutonomy)
}

const AUTONOMY_ORDER: Autonomy[] = ['off', 'suggest', 'propose', 'act']

export function clampAutonomy(want: Autonomy, max: Autonomy): Autonomy {
  return AUTONOMY_ORDER.indexOf(want) > AUTONOMY_ORDER.indexOf(max) ? max : want
}

/** Whether a responsibility must be filled at this scope. */
export function resolveRequired(
  model: OperatingModel,
  responsibilityId: string,
  chain: string[] = [],
): boolean {
  for (const scopeId of [...chain, ROOT_SCOPE]) {
    const v = model.overrides[scopeId]?.responsibilityRequired?.[responsibilityId]
    if (typeof v === 'boolean') return v
  }
  return model.responsibilities[responsibilityId]?.required ?? false
}

/** The template adopted at or above a scope, if any. */
export function resolveTemplate(
  model: OperatingModel,
  chain: string[] = [],
): ProjectTemplate | null {
  for (const scopeId of [...chain, ROOT_SCOPE]) {
    const id = model.overrides[scopeId]?.templateId
    if (id) return model.templates[id] ?? null
  }
  return null
}

export function liveResponsibilities(model: OperatingModel): ResponsibilityType[] {
  return Object.values(model.responsibilities)
    .filter((r) => !r.deletedAt)
    .sort((a, b) => a.order - b.order)
}

export function liveRoles(model: OperatingModel): OrgRole[] {
  return Object.values(model.roles).filter((r) => !r.deletedAt)
}

/* ================================================================== *
 * Assignment rules
 * ================================================================== */

export interface AssignmentCheck {
  ok: boolean
  errors: string[]
}

/**
 * Validate a set of values against a responsibility type.
 *
 * Eligibility is checked only for people who carry a role. Every owner in the imported log is
 * a bare name with no role, and rejecting those would make the whole log uneditable — so an
 * unroled person is allowed, and the rule tightens by itself as the directory is filled in.
 */
export function checkAssignment(
  model: OperatingModel,
  type: ResponsibilityType,
  values: string[],
  scopeChain: string[] = [],
): AssignmentCheck {
  const errors: string[] = []
  const clean = values.map((v) => v.trim()).filter(Boolean)

  if (type.maxCount != null && clean.length > type.maxCount) {
    errors.push(
      `${type.label} takes at most ${type.maxCount} ${type.maxCount === 1 ? 'value' : 'values'}; ${clean.length} were given.`,
    )
  }
  if (clean.length < type.minCount) {
    errors.push(`${type.label} needs at least ${type.minCount}.`)
  }
  if (!clean.length && resolveRequired(model, type.id, scopeChain)) {
    errors.push(`${type.label} is required here.`)
  }

  if (type.valueKind === 'party') {
    for (const v of clean) {
      if (!model.parties.includes(v)) {
        errors.push(`“${v}” is not a party in this workspace. Add it under Roles & People first.`)
      }
    }
  }

  if (type.valueKind === 'person' && type.eligibleRoleIds.length) {
    for (const v of clean) {
      const person = Object.values(model.people).find((p) => p.name === v)
      // Unknown or unroled people pass: see the note above.
      if (!person || !person.roleIds.length) continue
      if (!person.roleIds.some((r) => type.eligibleRoleIds.includes(r))) {
        const allowed = type.eligibleRoleIds
          .map((r) => model.roles[r]?.label ?? r)
          .join(', ')
        errors.push(`${v} cannot be ${type.label}: that responsibility is limited to ${allowed}.`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/** Health labels are not configurable, but the settings screen still lists them for reference. */
export const FIXED_VOCABULARIES: { key: string; label: string; values: readonly string[]; why: string }[] = [
  {
    key: 'STATUS',
    label: 'Issue status',
    values: [],
    why: 'Status drives % complete and schedule health. Changing the vocabulary without changing the derivation would silently produce issues with no progress.',
  },
  {
    key: 'SEVERITY',
    label: 'Severity',
    values: [],
    why: 'Severity drives the SLA proposal and the sort order of the grid.',
  },
  {
    key: 'HEALTH',
    label: 'Schedule health',
    values: [] as ScheduleHealth[],
    why: 'Computed from dates and status. Not stored, so there is nothing to configure.',
  },
]

/* ================================================================== *
 * Persistence
 * ================================================================== */

/**
 * Per tenant, for the same reason the workspace mirror is: the operating model *is* the
 * firm — its terminology, its roles, its people, its agents. Two firms sharing one browser
 * key would have each other's configuration applied to their own tree.
 */
function storeKey(tenantId: string): string {
  return `axiomate.operating-model.v1:${tenantId}`
}

/** What the key was before it was namespaced. Adopted once by `loadModel`, then left alone. */
const LEGACY_MODEL_KEY = 'axiomate.operating-model.v1'

/**
 * Fold a stored operating model over the shipped one.
 *
 * Every record map is merged *explicitly*, and that is the whole point rather than a style
 * choice: a stored model predates every key added since it was written, so a bare
 * `{ ...seed, ...stored }` sets each of those keys to `undefined` — which is not "the old
 * value", it is a crash the next time anything reads one. `workTypes` was the key that
 * proved it.
 *
 * Exported because there are two places a stored model arrives from, and until now only one
 * of them merged. The browser mirror carries the whole workspace including its model, and
 * `loadWorkspaceLocally` was taking that model wholesale — so on any browser that had ever
 * run the app, a newly added part of the operating model was invisible no matter how
 * carefully this function handled it.
 */
export function mergeModel(seed: OperatingModel, stored: Partial<OperatingModel>): OperatingModel {
  if (!stored || typeof stored !== 'object') return seed
  return {
    ...seed,
    ...stored,
    roles: { ...seed.roles, ...(stored.roles ?? {}) },
    people: { ...seed.people, ...(stored.people ?? {}) },
    responsibilities: { ...seed.responsibilities, ...(stored.responsibilities ?? {}) },
    workTypes: { ...seed.workTypes, ...(stored.workTypes ?? {}) },
    // Seed first so a build that adds a discipline gives it to every existing workspace, and
    // stored second so a relabelled one keeps the firm's wording rather than reverting on load.
    disciplines: { ...seed.disciplines, ...(stored.disciplines ?? {}) },
    // Explicit like the rest, and load-bearing here: every model stored before this key existed
    // has no `skills`, and the spread above would leave it undefined — which the first
    // `Object.values(model.skills)` in the UI turns into a crash, in production, on the
    // workspace that has data and never on the seed that does not.
    skills: { ...seed.skills, ...(stored.skills ?? {}) },
    // Explicit, like every other key: a model stored before this existed has no `sla`, and the
    // spread above would set it to undefined — which is not a missing policy, it is a crash
    // the next time anything reads a severity from it.
    sla: { ...seed.sla, ...(stored.sla ?? {}) },
    // A list, so it is replaced wholesale when present rather than merged key by key — a
    // firm that removed a band means it, and merging would resurrect it.
    sizeBands: Array.isArray(stored.sizeBands) && stored.sizeBands.length ? stored.sizeBands : seed.sizeBands,
    // Merged one key at a time rather than replaced: a model stored before the graph existed
    // has no `statusPolicy` at all, and a stored one written before a requirement was added
    // would otherwise drop it to undefined the first time anything read it.
    statusPolicy: {
      ...seed.statusPolicy,
      ...(stored.statusPolicy ?? {}),
      transitions: { ...seed.statusPolicy.transitions, ...(stored.statusPolicy?.transitions ?? {}) },
      requireEvidence: stored.statusPolicy?.requireEvidence ?? seed.statusPolicy.requireEvidence,
      requireReason: stored.statusPolicy?.requireReason ?? seed.statusPolicy.requireReason,
    },
    // A list, replaced wholesale when present: a firm that deleted a rule means it.
    approvalRules: Array.isArray(stored.approvalRules) ? stored.approvalRules : seed.approvalRules,
    automationRules: Array.isArray(stored.automationRules) ? stored.automationRules : seed.automationRules,
    resourceProfiles: { ...seed.resourceProfiles, ...(stored.resourceProfiles ?? {}) },
    watch: {
      ...seed.watch,
      ...(stored.watch ?? {}),
      conditions: stored.watch?.conditions ?? seed.watch.conditions,
    },
    access: {
      ...seed.access,
      ...(stored.access ?? {}),
      // Grants are merged per role rather than replaced, so a role added to the product since
      // the model was stored keeps its shipped grant instead of silently having none.
      grants: { ...seed.access.grants, ...(stored.access?.grants ?? {}) },
      defaultRoleIds: stored.access?.defaultRoleIds ?? seed.access.defaultRoleIds,
    },
    agents: mergeAgents(seed.agents, stored.agents),
    workflows: { ...seed.workflows, ...(stored.workflows ?? {}) },
    templates: { ...seed.templates, ...(stored.templates ?? {}) },
    organization: { ...seed.organization, ...(stored.organization ?? {}) },
    // Explicit like every other key, and load-bearing for the same reason: every model stored
    // before this key existed has no `documentFiling`, and the spread above would leave it
    // undefined — which is not "file at the root", it is a crash on the next upload.
    documentFiling: { ...seed.documentFiling, ...(stored.documentFiling ?? {}) },
    // Explicit, like every other key. A model stored before goals existed has none, and the
    // spread above would leave `undefined` — which the first `Object.values(model.goals)` turns
    // into a crash, in production, on the workspace that has data.
    goals: { ...seed.goals, ...(stored.goals ?? {}) },
    // Explicit for the same reason as the two above: a model stored before this key existed
    // arrives without it, and undefined here crashes the first read in production only.
    recurrences: stored.recurrences ?? seed.recurrences,
    intakeForms: stored.intakeForms ?? seed.intakeForms,
    parties: Array.isArray(stored.parties) && stored.parties.length ? stored.parties : seed.parties,
    overrides: { ...seed.overrides, ...(stored.overrides ?? {}) },
    seq: typeof stored.seq === 'number' ? Math.max(stored.seq, seed.seq) : seed.seq,
  }
}

/**
 * Mirror the model to local storage.
 *
 * The workspace itself is in-memory per session, but configuration is not workspace data —
 * it is the shape of the workspace, and a renamed label that vanishes on refresh reads as
 * broken rather than as unsaved.
 */
export function saveModel(tenantId: string, model: OperatingModel): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storeKey(tenantId), JSON.stringify(model))
  } catch {
    // A blocked or full quota must not break configuration.
  }
}

/**
 * Read the mirrored model back, merged over the current seed.
 *
 * Merged, not replaced: a stored model predates any record added to the seed since, and
 * dropping those would silently remove agents and labels the app now expects to exist.
 */
export function loadModel(tenantId: string, seed: OperatingModel): OperatingModel {
  if (typeof window === 'undefined') return seed
  try {
    // A model stored before the key carried a tenant belongs to whichever tenant this
    // deployment serves — there was only one. Adopted once, and never over a newer model.
    const legacy = window.localStorage.getItem(LEGACY_MODEL_KEY)
    if (legacy && window.localStorage.getItem(storeKey(tenantId)) === null) {
      window.localStorage.setItem(storeKey(tenantId), legacy)
    }
    const raw = window.localStorage.getItem(storeKey(tenantId))
    if (!raw) return seed
    return mergeModel(seed, JSON.parse(raw) as Partial<OperatingModel>)
  } catch {
    return seed
  }
}

/**
 * Stored agent settings win, but `runtime` and `maxAutonomy` always come from the seed —
 * they describe what the code can do, and a stale record must never claim a capability the
 * build does not have.
 */
function mergeAgents(
  seed: Record<string, AgentRecord>,
  stored: Record<string, AgentRecord> | undefined,
): Record<string, AgentRecord> {
  const out: Record<string, AgentRecord> = { ...seed }
  for (const [id, rec] of Object.entries(stored ?? {})) {
    const base = seed[id]
    if (!base) continue
    out[id] = {
      ...base,
      enabled: rec.enabled ?? base.enabled,
      requireApproval: rec.requireApproval ?? base.requireApproval,
      autonomy: clampAutonomy(rec.autonomy ?? base.autonomy, base.maxAutonomy),
    }
  }
  return out
}

export function clearStoredModel(tenantId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storeKey(tenantId))
  } catch {
    /* nothing to do */
  }
}

/* ================================================================== *
 * Record kinds ↔ terminology
 * ================================================================== */

/**
 * Which configured term names each creatable kind.
 *
 * The reducer, the Add menu and every dialog title used to read a hardcoded `KIND_LABEL`
 * table; that table was the first place this app did system-key/display-label separation by
 * hand, and it belongs here now that the separation is a real mechanism.
 */
/**
 * Exhaustive over the tier list, so adding a tier is a compile error until it is given a
 * name people can edit. Previously this was `Record<string, LabelKey>` and carried an
 * `organization` alias for the client tier — the last thing keeping that name alive.
 *
 * The key stays `TIER_ORGANIZATION` while the tier is called `client`, and that mismatch is
 * deliberate: label keys are *stored* — `ScopeOverride.labels` is keyed by them, in the
 * database and in every browser mirror — so renaming one orphans every override that carries
 * it. Same rule that keeps `partyCode` separate from the display name.
 */
const TIER_LABEL_KEY: Record<NodeKind, LabelKey> = {
  company: 'TIER_COMPANY',
  client: 'TIER_ORGANIZATION',
  engagement: 'TIER_ENGAGEMENT',
  project: 'TIER_PROJECT',
  module: 'TIER_MODULE',
}

/**
 * Partial on purpose: `activity` has no configured name, because a lifecycle phase is called
 * what the phase is called. Everything a user can create does have one.
 */
export const KIND_LABEL_KEY: Partial<Record<RowKind | 'sub-issue' | 'Milestone', LabelKey>> = {
  ...TIER_LABEL_KEY,
  issue: 'RECORD_ISSUE',
  'sub-issue': 'RECORD_SUB_ISSUE',
  Milestone: 'RECORD_MILESTONE',
  milestone: 'RECORD_MILESTONE',
}

/** Configured name for a kind, falling back to the kind itself for activity phases. */
export function kindLabel(
  labels: Record<LabelKey, string>,
  kind: string,
): string {
  const key = KIND_LABEL_KEY[kind as keyof typeof KIND_LABEL_KEY]
  return key ? labels[key] : kind
}
