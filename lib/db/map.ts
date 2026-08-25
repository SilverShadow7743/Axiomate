import 'server-only'
import type {
  Engagement as EngagementRow,
  Evidence as EvidenceRow,
  HierarchyNode as NodeRow,
  Issue as IssueRow,
  IssueActivity as ActivityRow,
  IssueDependency as DependencyRow,
  IssueNote as IssueNoteRow,
  IssueEstimate as EstimateRow,
  TimeEntry as TimeRow,
  Approval as ApprovalRow,
  Notification as NotificationRow,
  Sow as SowRow,
  Allocation as AllocationRow,
  ProjectMember as ProjectMemberRow,
  PersonalEvent as PersonalEventRow,
  InboundMail as InboundMailRow,
  Commitment as CommitmentRow,
  EstimateRevision as RevisionRow,
  IssueRelationship as RelationshipRow,
  ScheduleAudit as AuditRow,
  // Aliased because `Version` is also the domain type one import below, and the two are not
  // the same shape — the row holds `null` where the domain holds `undefined`.
  Version as VersionRow,
  Timesheet as TimesheetRow,
  PersonRate as PersonRateRow,
  ChangeRequest as ChangeRequestRow,
  PersonSkill as PersonSkillRow,
  Document as DocumentRow,
  DocumentReview as DocumentReviewRow,
  Milestone as MilestoneRow,
  ScopeItem as ScopeItemRow,
  Prisma,
} from '@prisma/client'
import type { AccountableParty, DependencyType, IssueStatus, Severity } from '../types'
import type { ActivityRec, HierarchyNode, IssueRecord, NodeKind } from '../workspace'
import type { DocumentReview, DocumentReviewAnswer } from '../proofing'
import type { EvidenceItem, EvidenceKind, SnapshotPurpose } from '../evidence'
import type { IssueNote, NoteType } from '../notes'
import type { EngagementDetail } from '../engagement'
import type { EstimateRevision, IssueEstimate } from '../estimation'
import type { TimeActivity, TimeEntry } from '../time'
import type { Approval, ApprovalDecision } from '../approval'
import type { Channel, Delivery, Notification } from '../notifications'
import type { Sow, SowStatus } from '../sow'
import type { Allocation, Commitment, CommitmentKind } from '../capacity'
import type { ProjectMember } from '../staffing'
import type { PersonalEvent } from '../personalEvents'
import type { InboundMail } from '../intake'
import type { Version } from '../versioning'
import type { Timesheet, TimesheetStatus } from '../timesheet'
import type { PersonRate, RateKind } from '../rates'
import type { ChangeRequest, ChangeStatus } from '../changeRequest'
import type { PersonSkill, SkillLevel, SkillSource } from '../skills'
import type { DocumentRecord, DocumentSubject } from '../documents'
import type { StoreKind } from '../documents'
import type { ScopeItem, ScopeKind, ScopeSource } from '../scope'
import type {
  AcceptanceState,
  BillingTrigger,
  DeliveryState,
  Milestone,
  MilestoneBasis,
} from '../milestone'
import type { AuditEntry, IssueDependency, IssueRelationship } from '../types'
import type { TenantId } from '../tenant'

/**
 * Translation between stored rows and the shapes the reducer works in.
 *
 * Kept in one file and written in both directions side by side, because the failure mode of a
 * mapper is asymmetry: a field written one way and read back another produces data that looks
 * correct until something compares it. Every pair below is adjacent for exactly that reason.
 *
 * Two conversions carry judgement rather than mechanism:
 *
 *  - **Dates.** The app works in `YYYY-MM-DD` strings, deliberately, so rendering never
 *    depends on the viewer's timezone. Postgres stores `DateTime`. Every conversion pins
 *    midnight UTC; anything else drifts a day depending on where the server happens to run.
 *
 *  - **Absent vs empty.** The app writes `''` for "no evidence date recorded"; the column is
 *    nullable. Round-tripping `''` → `NULL` → `''` is only lossless if both directions agree,
 *    so the rule is written once here and used everywhere.
 */

/* ================================================================== *
 * Dates
 * ================================================================== */

/** `YYYY-MM-DD` → midnight UTC. Empty string means absent, not epoch. */
export function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Midnight UTC → `YYYY-MM-DD`. Absent becomes `null`. */
export function fromDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/** The same, for the fields the app models as a string that is sometimes empty. */
export function fromDateOrEmpty(d: Date | null | undefined): string {
  return fromDate(d) ?? ''
}

/* ================================================================== *
 * Enums
 * ================================================================== */

const NODE_KIND_TO_DB = {
  company: 'COMPANY',
  client: 'CLIENT',
  engagement: 'ENGAGEMENT',
  project: 'PROJECT',
  module: 'MODULE',
} as const satisfies Record<NodeKind, NodeRow['kind']>

const NODE_KIND_FROM_DB: Record<NodeRow['kind'], NodeKind> = {
  COMPANY: 'company',
  CLIENT: 'client',
  ENGAGEMENT: 'engagement',
  PROJECT: 'project',
  MODULE: 'module',
}

const SEVERITY_TO_DB = { High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW' } as const
const SEVERITY_FROM_DB: Record<IssueRow['severity'], Severity> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

const EVIDENCE_KIND_TO_DB = {
  snapshot: 'SNAPSHOT',
  data: 'DATA',
  document: 'DOCUMENT',
  link: 'LINK',
} as const satisfies Record<EvidenceKind, EvidenceRow['kind']>

const EVIDENCE_KIND_FROM_DB: Record<EvidenceRow['kind'], EvidenceKind> = {
  SNAPSHOT: 'snapshot',
  DATA: 'data',
  DOCUMENT: 'document',
  LINK: 'link',
}

/* ================================================================== *
 * Hierarchy nodes
 * ================================================================== */

export function nodeToRow(tenantId: TenantId, n: HierarchyNode): Prisma.HierarchyNodeUncheckedCreateInput {
  return {
    sowId: n.sowId ?? null,
    tenantId,
    id: n.id,
    kind: NODE_KIND_TO_DB[n.kind],
    name: n.name,
    owner: n.owner,
    parentId: n.parentId,
    deletedAt: n.deletedAt ? new Date(n.deletedAt) : null,
  }
}

export function nodeFromRow(r: NodeRow): HierarchyNode {
  return {
    sowId: r.sowId,
    id: r.id,
    kind: NODE_KIND_FROM_DB[r.kind],
    name: r.name,
    parentId: r.parentId,
    owner: r.owner,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Issues
 * ================================================================== */

/**
 * An issue's parent is one of two columns, never both: `nodeId` when it sits under a
 * structural tier, `parentIssueId` when it is a sub-issue. The reducer models this as a single
 * `parentId`, so the split happens here and is reversed on the way back.
 */
export function issueToRow(
  tenantId: TenantId,
  i: IssueRecord,
  parentIsIssue: boolean,
): Prisma.IssueUncheckedCreateInput {
  return {
    tenantId,
    id: i.id,
    subject: i.subject,
    description: i.description,
    nodeId: parentIsIssue ? null : i.parentId,
    parentIssueId: parentIsIssue ? i.parentId : null,
    client: i.client,
    module: i.module,
    type: i.type,
    sourceType: i.sourceType,
    discipline: i.discipline,
    severity: SEVERITY_TO_DB[i.severity],
    status: i.status,
    owner: i.owner,
    ownerId: i.ownerId ?? null,
    clientVisible: i.clientVisible ?? false,
    riskLikelihood: i.riskLikelihood ?? null,
    riskImpact: i.riskImpact ?? null,
    decisionOutcome: i.decisionOutcome ?? null,
    raisedBy: i.raisedBy,
    accountable: i.accountable,
    scheduleMode: i.scheduleMode,
    plannedStartDate: toDate(i.plannedStart),
    plannedEndDate: toDate(i.plannedEnd),
    percentOverride: i.percentOverride,
    raisedDate: toDate(i.raised) ?? new Date(0),
    lastActivityDate: toDate(i.lastActivity) ?? new Date(0),
    actualEndDate: toDate(i.actualEnd),
    statusSince: toDate(i.statusSince),
    pausedDays: i.pausedDays ?? 0,
    age: i.age,
    daysSinceActivity: i.daysSinceActivity,
    nextAction: i.nextAction,
    evidence: i.evidence,
    evidenceDate: toDate(i.evidenceDate),
    verification: i.verification,
    source: i.source,
    reference: i.reference,
    clientImpact: i.clientImpact,
    assignments: i.assignments as Prisma.InputJsonValue,
    deletedAt: i.deletedAt ? new Date(i.deletedAt) : null,
  }
}

export function issueFromRow(r: IssueRow): IssueRecord {
  return {
    id: r.id,
    // Reversed from the two-column split above. A row with neither is orphaned; the loader
    // reports those rather than silently rehoming them.
    parentId: r.parentIssueId ?? r.nodeId ?? '',
    client: r.client,
    module: r.module,
    subject: r.subject,
    description: r.description,
    type: r.type,
    sourceType: r.sourceType,
    discipline: r.discipline,
    severity: SEVERITY_FROM_DB[r.severity],
    status: r.status as IssueStatus,
    owner: r.owner,
    ownerId: r.ownerId ?? null,
    clientVisible: r.clientVisible ?? false,
    riskLikelihood: r.riskLikelihood ?? null,
    riskImpact: r.riskImpact ?? null,
    decisionOutcome: r.decisionOutcome ?? null,
    raisedBy: r.raisedBy,
    accountable: r.accountable as AccountableParty,
    raised: fromDateOrEmpty(r.raisedDate),
    lastActivity: fromDateOrEmpty(r.lastActivityDate),
    actualEnd: fromDate(r.actualEndDate),
    statusSince: fromDate(r.statusSince),
    pausedDays: r.pausedDays ?? 0,
    age: r.age,
    daysSinceActivity: r.daysSinceActivity,
    nextAction: r.nextAction,
    evidence: r.evidence,
    evidenceDate: fromDateOrEmpty(r.evidenceDate),
    verification: r.verification,
    source: r.source,
    reference: r.reference,
    clientImpact: r.clientImpact,
    plannedStart: fromDate(r.plannedStartDate),
    plannedEnd: fromDate(r.plannedEndDate),
    percentOverride: r.percentOverride,
    scheduleMode: r.scheduleMode,
    assignments: normaliseAssignments(r.assignments),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/**
 * `assignments` is the one column the database cannot type-check for us.
 *
 * It is written by this app, but it is still JSON coming back over a wire, and a malformed
 * value would land straight in `IssueRecord` and be handed to `checkAssignment`. Coerced to
 * the declared shape on the way in — anything that is not an array of strings is dropped
 * rather than trusted.
 */
function normaliseAssignments(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue
    const values = v.filter((x): x is string => typeof x === 'string')
    if (values.length) out[k] = values
  }
  return out
}

/* ================================================================== *
 * Activities
 * ================================================================== */

export function activityToRow(tenantId: TenantId, a: ActivityRec): Prisma.IssueActivityUncheckedCreateInput {
  return {
    tenantId,
    id: a.id,
    issueId: a.issueId,
    phase: String(a.phase),
    order: a.order,
    scheduleMode: a.scheduleMode,
    plannedStartDate: toDate(a.plannedStartDate) ?? new Date(0),
    plannedEndDate: toDate(a.plannedEndDate) ?? new Date(0),
    percentComplete: a.percentComplete,
    isMilestone: a.isMilestone,
    origin: a.origin === 'generated' ? 'GENERATED' : 'USER',
    owner: a.owner,
    deletedAt: a.deletedAt ? new Date(a.deletedAt) : null,
  }
}

export function activityFromRow(r: ActivityRow): ActivityRec {
  return {
    id: r.id,
    issueId: r.issueId,
    phase: r.phase,
    order: r.order,
    plannedStartDate: fromDateOrEmpty(r.plannedStartDate),
    plannedEndDate: fromDateOrEmpty(r.plannedEndDate),
    percentComplete: r.percentComplete,
    owner: r.owner,
    scheduleMode: r.scheduleMode,
    isMilestone: r.isMilestone,
    origin: r.origin === 'GENERATED' ? 'generated' : 'user',
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Dependencies and relationships
 * ================================================================== */

export function dependencyToRow(tenantId: TenantId, d: IssueDependency): Prisma.IssueDependencyUncheckedCreateInput {
  return {
    tenantId,
    id: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    dependencyType: d.dependencyType,
    lagDays: d.lagDays,
    createdAt: new Date(d.createdAt),
    createdBy: d.createdBy,
  }
}

export function dependencyFromRow(r: DependencyRow): IssueDependency {
  return {
    id: r.id,
    predecessorId: r.predecessorId,
    successorId: r.successorId,
    dependencyType: r.dependencyType as DependencyType,
    lagDays: r.lagDays,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
  }
}

export function relationshipToRow(
  tenantId: TenantId,
  r: IssueRelationship,
): Prisma.IssueRelationshipUncheckedCreateInput {
  return {
    tenantId,
    id: r.id,
    sourceIssueId: r.sourceIssueId,
    targetIssueId: r.targetIssueId,
    relationshipType: r.relationshipType,
    note: r.note,
  }
}

export function relationshipFromRow(r: RelationshipRow): IssueRelationship {
  return {
    id: r.id,
    sourceIssueId: r.sourceIssueId,
    targetIssueId: r.targetIssueId,
    relationshipType: r.relationshipType,
    note: r.note,
  }
}

/* ================================================================== *
 * Evidence
 * ================================================================== */

export function evidenceToRow(tenantId: TenantId, e: EvidenceItem): Prisma.EvidenceUncheckedCreateInput {
  return {
    tenantId,
    id: e.id,
    issueId: e.issueId,
    kind: EVIDENCE_KIND_TO_DB[e.kind],
    name: e.name,
    purpose: e.purpose,
    // A `blob:` URL is a handle into one browser session's memory. Storing it would persist a
    // link that is already dead by the time anyone reads the row.
    url: e.url && /^blob:/i.test(e.url) ? null : e.url,
    mimeType: e.mimeType,
    sizeBytes: e.sizeBytes,
    note: e.note,
    documentId: e.documentId,
    origin: e.origin === 'imported' ? 'IMPORTED' : 'USER',
    addedAt: new Date(e.addedAt),
    addedBy: e.addedBy,
    deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
  }
}

export function evidenceFromRow(r: EvidenceRow): EvidenceItem {
  return {
    id: r.id,
    issueId: r.issueId,
    kind: EVIDENCE_KIND_FROM_DB[r.kind],
    name: r.name,
    purpose: (r.purpose as SnapshotPurpose | null) ?? null,
    url: r.url,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    note: r.note,
    documentId: r.documentId,
    addedAt: r.addedAt.toISOString(),
    addedBy: r.addedBy,
    origin: r.origin === 'IMPORTED' ? 'imported' : 'user',
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Notes
 * ================================================================== */

/**
 * The one pair that must not use `toDate`/`fromDate`.
 *
 * A note carries a full ISO datetime — the hour someone wrote it is the point of it, unlike the
 * calendar dates everywhere else in this file. `toDate` appends `T00:00:00.000Z` to whatever it
 * is given, so handing it `2026-08-15T14:22:31.000Z` produces an unparseable string and the
 * helper returns `null`. That failure is silent and typed: a timestamp would simply vanish on
 * the way in, and nothing would report it. Constructed directly instead, both ways.
 */
export function noteToRow(tenantId: TenantId, n: IssueNote): Prisma.IssueNoteUncheckedCreateInput {
  return {
    tenantId,
    id: n.id,
    issueId: n.issueId,
    body: n.body,
    noteType: n.noteType,
    pinned: n.pinned,
    clientVisible: n.clientVisible ?? false,
    createdBy: n.createdBy,
    createdAt: new Date(n.createdAt),
    updatedBy: n.updatedBy,
    updatedAt: n.updatedAt ? new Date(n.updatedAt) : null,
    deletedAt: n.deletedAt ? new Date(n.deletedAt) : null,
  }
}

export function noteFromRow(r: IssueNoteRow): IssueNote {
  return {
    id: r.id,
    issueId: r.issueId,
    body: r.body,
    // Widened rather than asserted against the current list, same as `EngagementDetail.type`:
    // the column is free text so a note filed under a type this build no longer names still
    // reads back as what it was written as.
    noteType: r.noteType as NoteType,
    pinned: r.pinned,
    clientVisible: r.clientVisible ?? false,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Audit
 * ================================================================== */

/**
 * Note the missing `id`: the reducer's in-memory `aud-3-OAPIL-010` counter restarts every
 * session and would collide on a primary key across restarts, so the database mints these.
 */
export function auditToRow(tenantId: TenantId, a: AuditEntry): Prisma.ScheduleAuditUncheckedCreateInput {
  return {
    tenantId,
    rowId: a.rowId,
    field: a.field,
    from: a.from,
    to: a.to,
    reason: a.reason ?? null,
    at: new Date(a.at),
    by: a.by,
    // The identity behind the name. Nullable rather than defaulted: a row written before
    // these columns existed genuinely has neither, and inventing one would put a stable id
    // on an entry nobody can vouch for.
    byId: a.byId ?? null,
    byEmail: a.byEmail ?? null,
  }
}

export function auditFromRow(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    rowId: r.rowId,
    field: r.field,
    from: r.from,
    to: r.to,
    at: r.at.toISOString(),
    by: r.by,
    byId: r.byId ?? undefined,
    byEmail: r.byEmail,
    reason: r.reason ?? undefined,
  }
}

/* ================================================================== *
 * Engagements
 * ================================================================== */

export function engagementToRow(tenantId: TenantId, e: EngagementDetail): Prisma.EngagementUncheckedCreateInput {
  return {
    tenantId,
    nodeId: e.nodeId,
    client: e.client,
    code: e.code,
    type: e.type,
    status: e.status,
    startDate: toDate(e.startDate),
    endDate: toDate(e.endDate),
    engagementLeader: e.engagementLeader,
    projectManager: e.projectManager,
    clientSponsor: e.clientSponsor,
    sowReference: e.sowReference,
    notes: e.notes,
    updatedBy: e.updatedBy,
  }
}

export function engagementFromRow(r: EngagementRow): EngagementDetail {
  return {
    nodeId: r.nodeId,
    client: r.client,
    code: r.code,
    // Widened on the way out rather than asserted: the column is free text so a value entered
    // before this build's vocabulary existed still reads back as itself.
    type: r.type as EngagementDetail['type'],
    status: r.status as EngagementDetail['status'],
    startDate: fromDate(r.startDate),
    endDate: fromDate(r.endDate),
    engagementLeader: r.engagementLeader,
    projectManager: r.projectManager,
    clientSponsor: r.clientSponsor,
    sowReference: r.sowReference,
    notes: r.notes,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  }
}

/* ================================================================== *
 * Estimates
 * ================================================================== */

/**
 * `plannedStart` is a plain day and uses the date helpers; `baselinedAt`, `updatedAt` and a
 * revision's `at` are full timestamps and deliberately do not. `toDate` appends
 * `T00:00:00.000Z` to whatever it is given, so handing it an ISO datetime produces an
 * unparseable string and a silent null — a moment would vanish on the way in with nothing to
 * typecheck against.
 */
export function estimateToRow(
  tenantId: TenantId,
  e: IssueEstimate,
): Prisma.IssueEstimateUncheckedCreateInput {
  return {
    tenantId,
    issueId: e.issueId,
    business: e.scores.business,
    technical: e.scores.technical,
    integration: e.scores.integration,
    testing: e.scores.testing,
    data: e.scores.data,
    sizeOverride: e.sizeOverride,
    approvedEffortHours: e.approvedEffortHours,
    hoursPerDay: e.capacity.hoursPerDay,
    resources: e.capacity.resources,
    allocationPct: e.capacity.allocationPct,
    plannedStart: toDate(e.plannedStart) ?? new Date(0),
    waitDays: e.waitDays,
    steps: e.steps as unknown as object,
    confidence: e.confidence,
    assumptions: e.assumptions,
    notes: e.notes,
    baselinedAt: e.baselinedAt ? new Date(e.baselinedAt) : null,
    baselinedBy: e.baselinedBy,
    updatedAt: new Date(e.updatedAt),
    updatedBy: e.updatedBy,
  }
}

export function estimateFromRow(r: EstimateRow): IssueEstimate {
  return {
    issueId: r.issueId,
    scores: {
      business: r.business,
      technical: r.technical,
      integration: r.integration,
      testing: r.testing,
      data: r.data,
    },
    // Widened on the way out rather than asserted, following `EngagementDetail.type`: the
    // column is free text so a size retired from the calibration still reads back.
    sizeOverride: (r.sizeOverride as IssueEstimate['sizeOverride']) ?? null,
    approvedEffortHours: r.approvedEffortHours,
    capacity: {
      hoursPerDay: r.hoursPerDay,
      resources: r.resources,
      allocationPct: r.allocationPct,
    },
    plannedStart: fromDate(r.plannedStart) ?? '',
    waitDays: r.waitDays,
    steps: (r.steps as unknown as IssueEstimate['steps']) ?? [],
    confidence: r.confidence as IssueEstimate['confidence'],
    assumptions: r.assumptions,
    notes: r.notes,
    baselinedAt: r.baselinedAt ? r.baselinedAt.toISOString() : null,
    baselinedBy: r.baselinedBy,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  }
}

export function revisionToRow(
  tenantId: TenantId,
  r: EstimateRevision,
): Prisma.EstimateRevisionUncheckedCreateInput {
  return {
    tenantId,
    id: r.id,
    issueId: r.issueId,
    reason: r.reason,
    by: r.by,
    at: new Date(r.at),
    from: r.from as unknown as object,
    to: r.to as unknown as object,
  }
}

export function revisionFromRow(r: RevisionRow): EstimateRevision {
  return {
    id: r.id,
    issueId: r.issueId,
    reason: r.reason,
    by: r.by,
    at: r.at.toISOString(),
    from: r.from as unknown as EstimateRevision['from'],
    to: r.to as unknown as EstimateRevision['to'],
  }
}

/* ================================================================== *
 * Time
 * ================================================================== */

export function timeToRow(tenantId: TenantId, e: TimeEntry): Prisma.TimeEntryUncheckedCreateInput {
  return {
    tenantId,
    id: e.id,
    issueId: e.issueId,
    person: e.person,
    personId: e.personId ?? null,
    // A plain day, so it uses the date helper — unlike the timestamps below, which carry a
    // moment and would be silently destroyed by `toDate`'s midnight suffix.
    date: toDate(e.date) ?? new Date(0),
    hours: e.hours,
    activity: e.activity,
    billable: e.billable,
    note: e.note,
    justification: e.justification ?? null,
    createdBy: e.createdBy,
    createdAt: new Date(e.createdAt),
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt ? new Date(e.updatedAt) : null,
    deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
  }
}

export function timeFromRow(r: TimeRow): TimeEntry {
  return {
    id: r.id,
    issueId: r.issueId,
    person: r.person,
    personId: r.personId ?? null,
    date: fromDate(r.date) ?? '',
    // Decimal on the way out, number in the domain. `Number()` is exact here because the
    // column is (5,2) — five digits total — and every such value is representable.
    hours: Number(r.hours),
    activity: r.activity as TimeActivity,
    billable: r.billable,
    note: r.note,
    justification: r.justification ?? null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Approvals
 * ================================================================== */

export function approvalToRow(tenantId: TenantId, a: Approval): Prisma.ApprovalUncheckedCreateInput {
  return {
    tenantId,
    id: a.id,
    subjectId: a.subjectId,
    ruleId: a.ruleId,
    question: a.question,
    note: a.note,
    requestedBy: a.requestedBy,
    requestedAt: new Date(a.requestedAt),
    decision: a.decision,
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
    decisionNote: a.decisionNote,
    deletedAt: a.deletedAt ? new Date(a.deletedAt) : null,
  }
}

export function approvalFromRow(r: ApprovalRow): Approval {
  return {
    id: r.id,
    subjectId: r.subjectId,
    ruleId: r.ruleId,
    question: r.question,
    note: r.note,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    // Widened rather than asserted, like every other free-text column read back into a union:
    // a decision written by an older version still reads.
    decision: (r.decision as ApprovalDecision | null) ?? null,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Notifications
 * ================================================================== */

export function notificationToRow(
  tenantId: TenantId,
  n: Notification,
): Prisma.NotificationUncheckedCreateInput {
  return {
    tenantId,
    id: n.id,
    to: n.to,
    toId: n.toId ?? null,
    channel: n.channel,
    subject: n.subject,
    body: n.body,
    aboutId: n.aboutId,
    ruleId: n.ruleId,
    createdAt: new Date(n.createdAt),
    delivery: n.delivery,
    deliveryNote: n.deliveryNote,
    readAt: n.readAt ? new Date(n.readAt) : null,
  }
}

export function notificationFromRow(r: NotificationRow): Notification {
  return {
    id: r.id,
    to: r.to,
    toId: r.toId ?? null,
    channel: r.channel as Channel,
    subject: r.subject,
    body: r.body,
    aboutId: r.aboutId,
    ruleId: r.ruleId,
    createdAt: r.createdAt.toISOString(),
    delivery: r.delivery as Delivery,
    deliveryNote: r.deliveryNote,
    readAt: r.readAt ? r.readAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Statements of work
 * ================================================================== */

export function sowToRow(tenantId: TenantId, s: Sow): Prisma.SowUncheckedCreateInput {
  return {
    tenantId,
    id: s.id,
    engagementId: s.engagementId,
    reference: s.reference,
    title: s.title,
    status: s.status,
    signedOn: toDate(s.signedOn),
    startDate: toDate(s.startDate),
    endDate: toDate(s.endDate),
    effortHours: s.effortHours,
    value: s.value,
    currency: s.currency,
    scope: s.scope,
    exclusions: s.exclusions,
    acceptanceCriteria: s.acceptanceCriteria,
    createdBy: s.createdBy,
    createdAt: new Date(s.createdAt),
    updatedBy: s.updatedBy,
    updatedAt: s.updatedAt ? new Date(s.updatedAt) : null,
    deletedAt: s.deletedAt ? new Date(s.deletedAt) : null,
  }
}

export function sowFromRow(r: SowRow): Sow {
  return {
    id: r.id,
    engagementId: r.engagementId,
    reference: r.reference,
    title: r.title,
    status: r.status as SowStatus,
    signedOn: fromDate(r.signedOn),
    startDate: fromDate(r.startDate),
    endDate: fromDate(r.endDate),
    effortHours: r.effortHours,
    value: Number(r.value),
    currency: r.currency,
    scope: r.scope,
    exclusions: r.exclusions,
    acceptanceCriteria: r.acceptanceCriteria,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Capacity
 * ================================================================== */

export function allocationToRow(tenantId: TenantId, a: Allocation): Prisma.AllocationUncheckedCreateInput {
  return {
    tenantId,
    id: a.id,
    person: a.person,
    personId: a.personId ?? null,
    projectId: a.projectId,
    startDate: toDate(a.startDate) ?? new Date(0),
    endDate: toDate(a.endDate) ?? new Date(0),
    percentage: a.percentage,
    note: a.note,
    createdBy: a.createdBy,
    createdAt: new Date(a.createdAt),
    deletedAt: a.deletedAt ? new Date(a.deletedAt) : null,
  }
}

export function allocationFromRow(r: AllocationRow): Allocation {
  return {
    id: r.id,
    person: r.person,
    personId: r.personId ?? null,
    projectId: r.projectId,
    startDate: fromDate(r.startDate) ?? '',
    endDate: fromDate(r.endDate) ?? '',
    percentage: r.percentage,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

export function projectMemberToRow(tenantId: TenantId, m: ProjectMember): Prisma.ProjectMemberUncheckedCreateInput {
  return {
    tenantId,
    id: m.id,
    person: m.person,
    personId: m.personId,
    projectId: m.projectId,
    projectRoleId: m.projectRoleId,
    addedBy: m.addedBy,
    addedAt: new Date(m.addedAt),
    removedAt: m.removedAt ? new Date(m.removedAt) : null,
  }
}

export function projectMemberFromRow(r: ProjectMemberRow): ProjectMember {
  return {
    id: r.id,
    person: r.person,
    personId: r.personId,
    projectId: r.projectId,
    projectRoleId: r.projectRoleId,
    addedBy: r.addedBy,
    addedAt: r.addedAt.toISOString(),
    removedAt: r.removedAt ? r.removedAt.toISOString() : null,
  }
}

export function personalEventToRow(tenantId: TenantId, e: PersonalEvent): Prisma.PersonalEventUncheckedCreateInput {
  return {
    tenantId,
    id: e.id,
    personId: e.personId,
    title: e.title,
    startAt: new Date(e.startAt),
    endAt: new Date(e.endAt),
    allDay: e.allDay,
    note: e.note,
    attendees: e.attendees,
    createdAt: new Date(e.createdAt),
    deletedAt: e.deletedAt ? new Date(e.deletedAt) : null,
  }
}

export function personalEventFromRow(r: PersonalEventRow): PersonalEvent {
  return {
    id: r.id,
    personId: r.personId,
    title: r.title,
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    allDay: r.allDay,
    note: r.note,
    attendees: r.attendees,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

export function inboundMailToRow(tenantId: TenantId, m: InboundMail): Prisma.InboundMailUncheckedCreateInput {
  return {
    tenantId,
    id: m.id,
    mailbox: m.mailbox,
    from: m.from,
    subject: m.subject,
    body: m.body,
    messageId: m.messageId,
    receivedAt: new Date(m.receivedAt),
    issueId: m.issueId,
    refusalReason: m.refusalReason,
    conversationId: m.conversationId,
    createdAt: new Date(m.createdAt),
  }
}

export function inboundMailFromRow(r: InboundMailRow): InboundMail {
  return {
    id: r.id,
    mailbox: r.mailbox,
    from: r.from,
    subject: r.subject,
    body: r.body,
    messageId: r.messageId,
    receivedAt: r.receivedAt.toISOString(),
    issueId: r.issueId,
    refusalReason: r.refusalReason,
    conversationId: r.conversationId,
    createdAt: r.createdAt.toISOString(),
  }
}

export function commitmentToRow(tenantId: TenantId, c: Commitment): Prisma.CommitmentUncheckedCreateInput {
  return {
    tenantId,
    id: c.id,
    person: c.person,
    personId: c.personId ?? null,
    kind: c.kind,
    startDate: toDate(c.startDate) ?? new Date(0),
    endDate: toDate(c.endDate) ?? new Date(0),
    hoursPerDay: c.hoursPerDay,
    note: c.note,
    createdBy: c.createdBy,
    createdAt: new Date(c.createdAt),
    deletedAt: c.deletedAt ? new Date(c.deletedAt) : null,
  }
}

export function commitmentFromRow(r: CommitmentRow): Commitment {
  return {
    id: r.id,
    person: r.person,
    personId: r.personId ?? null,
    kind: r.kind as CommitmentKind,
    startDate: fromDate(r.startDate) ?? '',
    endDate: fromDate(r.endDate) ?? '',
    hoursPerDay: Number(r.hoursPerDay),
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Change requests
 * ================================================================== */

export function changeToRow(tenantId: TenantId, c: ChangeRequest): Prisma.ChangeRequestUncheckedCreateInput {
  return {
    tenantId,
    id: c.id,
    sowId: c.sowId,
    issueId: c.issueId,
    reference: c.reference,
    title: c.title,
    status: c.status,
    // Signed, both of them. A descoping is negative and the column allows it.
    effortHours: c.effortHours,
    value: c.value,
    currency: c.currency,
    scope: c.scope,
    reason: c.reason,
    // A String date, like every other effective date here — see `Version.validFrom`.
    effectiveFrom: c.effectiveFrom,
    requestedBy: c.requestedBy,
    requestedAt: new Date(c.requestedAt),
    decidedAt: c.decidedAt ? new Date(c.decidedAt) : null,
    decidedBy: c.decidedBy,
    decisionNote: c.decisionNote,
    deletedAt: c.deletedAt ? new Date(c.deletedAt) : null,
  }
}

export function changeFromRow(r: ChangeRequestRow): ChangeRequest {
  return {
    id: r.id,
    sowId: r.sowId,
    issueId: r.issueId,
    reference: r.reference,
    title: r.title,
    status: r.status as ChangeStatus,
    effortHours: r.effortHours,
    value: Number(r.value),
    currency: r.currency,
    scope: r.scope,
    reason: r.reason,
    effectiveFrom: r.effectiveFrom,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Rates
 * ================================================================== */

/**
 * `amount` is `Decimal` in the database and `number` in the domain, and the conversion is the
 * one thing to be careful about here.
 *
 * `Number()` on a Prisma `Decimal` is exact for every rate a firm will ever set — the column is
 * 12,2, so the values are hundredths well inside a double's integer range. It is NOT exact for
 * arbitrary decimals, and if this column ever widens, this line is the one that breaks quietly.
 * Stated rather than assumed, because a rounding error in a rate is a rounding error in a margin.
 */
export function rateToRow(tenantId: TenantId, r: PersonRate): Prisma.PersonRateUncheckedCreateInput {
  return {
    tenantId,
    id: r.id,
    personId: r.personId,
    kind: r.kind,
    // Strings, like `Version.validFrom`, so the round trip is the identity function and the
    // exclusive boundary stays exact.
    validFrom: r.validFrom,
    validTo: r.validTo,
    amount: r.amount,
    currency: r.currency,
    recordedAt: new Date(r.recordedAt),
    by: r.by,
    byId: r.byId ?? null,
    byEmail: r.byEmail ?? null,
    reason: r.reason,
  }
}

export function rateFromRow(r: PersonRateRow): PersonRate {
  return {
    id: r.id,
    personId: r.personId,
    kind: r.kind as RateKind,
    validFrom: r.validFrom,
    validTo: r.validTo,
    amount: Number(r.amount),
    currency: r.currency,
    recordedAt: r.recordedAt.toISOString(),
    by: r.by,
    // The same asymmetry as `auditFromRow` and `versionFromRow`, for the same reason: `byId?`
    // has no null in it and `byEmail?` does.
    byId: r.byId ?? undefined,
    byEmail: r.byEmail,
    reason: r.reason,
  }
}

/* ================================================================== *
 * Scope items
 * ================================================================== */

/**
 * `effortHours` is `Decimal?` and stays null rather than becoming zero.
 *
 * Null means the kind carries no effort — an assumption is not work — and zero would mean
 * somebody estimated it at nothing. Those are different claims, and a total built from the second
 * is a total that quietly includes lines nobody thought about.
 */
export function scopeItemToRow(tenantId: TenantId, i: ScopeItem): Prisma.ScopeItemUncheckedCreateInput {
  return {
    tenantId,
    id: i.id,
    sowId: i.sowId,
    kind: i.kind,
    text: i.text,
    parentId: i.parentId,
    effortHours: i.effortHours,
    source: i.source,
    sequence: i.sequence,
    approvedBy: i.approvedBy,
    approvedAt: i.approvedAt ? new Date(i.approvedAt) : null,
    recordedBy: i.recordedBy,
    recordedAt: new Date(i.recordedAt),
    deletedAt: i.deletedAt ? new Date(i.deletedAt) : null,
  }
}

export function scopeItemFromRow(r: ScopeItemRow): ScopeItem {
  return {
    id: r.id,
    sowId: r.sowId,
    kind: r.kind as ScopeKind,
    text: r.text,
    parentId: r.parentId,
    effortHours: r.effortHours === null ? null : Number(r.effortHours),
    source: r.source as ScopeSource,
    sequence: r.sequence,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    recordedBy: r.recordedBy,
    recordedAt: r.recordedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Milestones
 * ================================================================== */

/**
 * Three `Decimal` columns, and the same caution as `PersonRate.amount`.
 *
 * `Number()` on a Prisma `Decimal` is exact for every figure a contract will carry — 14,2 for
 * money and 6,3 for a percentage are hundredths and thousandths well inside a double's integer
 * range. `percentage` is 6,3 rather than an integer because a three-way split is 33.333% and
 * rounding that to 33 loses money on every invoice.
 */
export function milestoneToRow(tenantId: TenantId, m: Milestone): Prisma.MilestoneUncheckedCreateInput {
  return {
    tenantId,
    id: m.id,
    sowId: m.sowId,
    name: m.name,
    description: m.description,
    sequence: m.sequence,
    basis: m.basis,
    percentage: m.percentage,
    amount: m.amount,
    currency: m.currency,
    billOn: m.billOn,
    // A String date, like `Version.validFrom`, so the round trip is the identity function.
    plannedDate: m.plannedDate,
    delivery: m.delivery,
    deliveredAt: m.deliveredAt ? new Date(m.deliveredAt) : null,
    deliveredBy: m.deliveredBy,
    acceptance: m.acceptance,
    acceptedAt: m.acceptedAt ? new Date(m.acceptedAt) : null,
    acceptedBy: m.acceptedBy,
    rejectionNote: m.rejectionNote,
    acceptedValue: m.acceptedValue,
    evidenceDocumentId: m.evidenceDocumentId,
    recordedBy: m.recordedBy,
    recordedAt: new Date(m.recordedAt),
    deletedAt: m.deletedAt ? new Date(m.deletedAt) : null,
  }
}

export function milestoneFromRow(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    sowId: r.sowId,
    name: r.name,
    description: r.description,
    sequence: r.sequence,
    basis: r.basis as MilestoneBasis,
    // Null stays null. Zero would be a percentage somebody chose, and these two fields are
    // mutually exclusive by design — the unused one must not come back as 0.
    percentage: r.percentage === null ? null : Number(r.percentage),
    amount: r.amount === null ? null : Number(r.amount),
    currency: r.currency,
    billOn: r.billOn as BillingTrigger,
    plannedDate: r.plannedDate,
    delivery: r.delivery as DeliveryState,
    deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
    deliveredBy: r.deliveredBy,
    acceptance: r.acceptance as AcceptanceState,
    acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
    acceptedBy: r.acceptedBy,
    rejectionNote: r.rejectionNote,
    acceptedValue: r.acceptedValue === null ? null : Number(r.acceptedValue),
    evidenceDocumentId: r.evidenceDocumentId,
    recordedBy: r.recordedBy,
    recordedAt: r.recordedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Documents
 * ================================================================== */

/**
 * `locator` is required going IN and always present coming OUT.
 *
 * The null it can carry in the domain type belongs to the copy that crosses the boundary, never
 * to a stored row — the same split `PersonSkill.level` has, and refused here for the same reason:
 * writing a redacted row back would erase the only thing that can find the bytes again, and the
 * record would survive looking perfectly healthy.
 */
export function documentToRow(tenantId: TenantId, d: DocumentRecord): Prisma.DocumentUncheckedCreateInput {
  if (!d.locator) {
    throw new Error(`Refusing to persist document ${d.id} with no locator. The locator is stripped for reading only.`)
  }
  return {
    tenantId,
    id: d.id,
    subjectKind: d.subjectKind,
    subjectId: d.subjectId,
    name: d.name,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    checksum: d.checksum,
    locator: d.locator,
    store: d.store,
    note: d.note,
    uploadedBy: d.uploadedBy,
    uploadedById: d.uploadedById ?? null,
    uploadedAt: new Date(d.uploadedAt),
    supersedesId: d.supersedesId ?? null,
    clientVisible: d.clientVisible ?? false,
    deletedAt: d.deletedAt ? new Date(d.deletedAt) : null,
  }
}

export function documentFromRow(r: DocumentRow): DocumentRecord {
  return {
    id: r.id,
    subjectKind: r.subjectKind as DocumentSubject,
    subjectId: r.subjectId,
    name: r.name,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    checksum: r.checksum,
    locator: r.locator,
    store: r.store as StoreKind,
    note: r.note,
    uploadedBy: r.uploadedBy,
    // The same asymmetry as `byId` elsewhere: the optional field has no null in it.
    uploadedById: r.uploadedById ?? undefined,
    uploadedAt: r.uploadedAt.toISOString(),
    supersedesId: r.supersedesId ?? null,
    clientVisible: r.clientVisible ?? false,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

export function reviewToRow(tenantId: TenantId, r: DocumentReview): Prisma.DocumentReviewUncheckedCreateInput {
  return {
    tenantId,
    id: r.id,
    documentId: r.documentId,
    checksum: r.checksum,
    issueId: r.issueId,
    question: r.question,
    askedBy: r.askedBy,
    askedAt: new Date(r.askedAt),
    reviewers: r.reviewers,
    verdicts: r.verdicts as unknown as Prisma.InputJsonValue,
    withdrawnAt: r.withdrawnAt ? new Date(r.withdrawnAt) : null,
    deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,
  }
}

export function reviewFromRow(r: DocumentReviewRow): DocumentReview {
  return {
    id: r.id,
    documentId: r.documentId,
    checksum: r.checksum,
    issueId: r.issueId,
    question: r.question,
    askedBy: r.askedBy,
    askedAt: r.askedAt.toISOString(),
    reviewers: (r.reviewers as unknown as string[]) ?? [],
    verdicts: (r.verdicts as unknown as DocumentReviewAnswer[]) ?? [],
    withdrawnAt: r.withdrawnAt ? r.withdrawnAt.toISOString() : null,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Person skills
 * ================================================================== */

/**
 * `withheld` has no column, deliberately.
 *
 * It is not a fact about the record — it is a fact about the copy a particular reader was sent,
 * and it is decided at the boundary in `boot()` from that reader's grants. A column would make
 * it storable, and a storable "you may not see this" is one migration away from being written
 * to, at which point the reducer would start refusing to read its own rows.
 */
export function personSkillToRow(tenantId: TenantId, p: PersonSkill): Prisma.PersonSkillUncheckedCreateInput {
  if (p.level === null || p.source === null) {
    /*
     * A redacted row must never reach the database. This cannot happen through the reducer —
     * the arms require both — but it CAN happen if a future path ever persists state that came
     * back from a browser, and the failure would be silent data loss: a level overwritten with
     * nothing by somebody who was never allowed to see it.
     */
    throw new Error(`Refusing to persist a redacted person-skill (${p.id}). Levels are stripped for reading only.`)
  }
  return {
    tenantId,
    id: p.id,
    personId: p.personId,
    skillId: p.skillId,
    level: p.level,
    source: p.source,
    assessedBy: p.assessedBy,
    // A String date, like `Version.validFrom` — see the note there.
    lastUsedOn: p.lastUsedOn,
    note: p.note,
    recordedBy: p.recordedBy,
    recordedAt: new Date(p.recordedAt),
    deletedAt: p.deletedAt ? new Date(p.deletedAt) : null,
  }
}

export function personSkillFromRow(r: PersonSkillRow): PersonSkill {
  return {
    id: r.id,
    personId: r.personId,
    skillId: r.skillId,
    level: r.level as SkillLevel,
    source: r.source as SkillSource,
    assessedBy: r.assessedBy,
    lastUsedOn: r.lastUsedOn,
    note: r.note,
    // Always false coming out of storage. Only the boundary sets it.
    withheld: false,
    recordedBy: r.recordedBy,
    recordedAt: r.recordedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  }
}

/* ================================================================== *
 * Timesheets
 * ================================================================== */

/**
 * `weekStarting` is a `String` column and stays one here, for the same reason `Version.validFrom`
 * does: it is compared and grouped as a string, and a `DateTime` round trip through
 * `fromDate` — which returns `string | null` — into a non-null field has no honest conversion.
 */
export function timesheetToRow(tenantId: TenantId, t: Timesheet): Prisma.TimesheetUncheckedCreateInput {
  return {
    tenantId,
    id: t.id,
    person: t.person,
    personId: t.personId ?? null,
    weekStarting: t.weekStarting,
    status: t.status,
    submittedAt: new Date(t.submittedAt),
    submittedBy: t.submittedBy,
    // Null rather than absent, in both directions. A week awaiting a decision has genuinely not
    // been decided, and `undefined` would round-trip to a different value than it started as.
    decidedAt: t.decidedAt ? new Date(t.decidedAt) : null,
    decidedBy: t.decidedBy,
    reason: t.reason,
  }
}

export function timesheetFromRow(r: TimesheetRow): Timesheet {
  return {
    id: r.id,
    person: r.person,
    personId: r.personId ?? null,
    weekStarting: r.weekStarting,
    status: r.status as TimesheetStatus,
    submittedAt: r.submittedAt.toISOString(),
    submittedBy: r.submittedBy,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decidedBy: r.decidedBy,
    reason: r.reason,
  }
}

/* ================================================================== *
 * Versions
 * ================================================================== */

/**
 * The one pair in this file that does **not** send its dates through `toDate`/`fromDate`, and
 * the exception is deliberate rather than an oversight — see the note on `model Version`.
 *
 * `validFrom` and `validTo` are compared as strings by `covers()` in `lib/versioning.ts`, and
 * the column is `String` so this round trip is the identity function. Converting them to
 * `DateTime` would force `validFrom` through `fromDateOrEmpty` — `fromDate` returns
 * `string | null` and the field is non-null — and `''` compares less than every date, so every
 * version would cover all of time. The exclusive `validTo` boundary would go with it.
 *
 * Do not "tidy" these two lines into `toDate()`.
 */
export function versionToRow(tenantId: TenantId, v: Version): Prisma.VersionUncheckedCreateInput {
  return {
    tenantId,
    id: v.id,
    subjectKind: v.subjectKind,
    subjectId: v.subjectId,
    validFrom: v.validFrom,
    validTo: v.validTo,
    /*
     * JSON typed by `subjectKind`, which the route boundary checks against a closed list, so
     * the payload can only belong to something this build understands.
     *
     * The cast is safe because the column is non-nullable and the reducer refuses a version
     * whose value is null or undefined — at the funnel, not only at the route, so a script
     * calling `apply` directly cannot produce a row this mapper would have to invent a value
     * for. A `?? JsonNull` fallback here would have written "the value was JSON null" and
     * called it a record.
     */
    value: v.value as Prisma.InputJsonValue,
    recordedAt: new Date(v.recordedAt),
    by: v.by,
    // Nullable rather than defaulted, exactly as the audit trail is: a machine actor has an id
    // and no mailbox, and inventing either would attribute a record to somebody who did not
    // make it.
    byId: v.byId ?? null,
    byEmail: v.byEmail ?? null,
    reason: v.reason,
  }
}

export function versionFromRow(r: VersionRow): Version {
  return {
    id: r.id,
    subjectKind: r.subjectKind,
    subjectId: r.subjectId,
    validFrom: r.validFrom,
    // `null`, never `undefined`: null means "still true", and `covers()` tests for it by identity.
    validTo: r.validTo,
    value: r.value,
    recordedAt: r.recordedAt.toISOString(),
    by: r.by,
    // Asymmetric on purpose, matching `auditFromRow` and the two field types: `byId?: string`
    // has no null in it, `byEmail?: string | null` does.
    byId: r.byId ?? undefined,
    byEmail: r.byEmail,
    reason: r.reason,
  }
}
