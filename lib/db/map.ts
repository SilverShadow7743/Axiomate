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
  EstimateRevision as RevisionRow,
  IssueRelationship as RelationshipRow,
  ScheduleAudit as AuditRow,
  Prisma,
} from '@prisma/client'
import type { AccountableParty, DependencyType, IssueStatus, Severity } from '../types'
import type { ActivityRec, HierarchyNode, IssueRecord, NodeKind } from '../workspace'
import type { EvidenceItem, EvidenceKind, SnapshotPurpose } from '../evidence'
import type { IssueNote, NoteType } from '../notes'
import type { EngagementDetail } from '../engagement'
import type { EstimateRevision, IssueEstimate } from '../estimation'
import type { TimeActivity, TimeEntry } from '../time'
import type { Approval, ApprovalDecision } from '../approval'
import type { Channel, Delivery, Notification } from '../notifications'
import type { Sow, SowStatus } from '../sow'
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
    severity: SEVERITY_TO_DB[i.severity],
    status: i.status,
    owner: i.owner,
    raisedBy: i.raisedBy,
    accountable: i.accountable,
    scheduleMode: i.scheduleMode,
    plannedStartDate: toDate(i.plannedStart),
    plannedEndDate: toDate(i.plannedEnd),
    percentOverride: i.percentOverride,
    raisedDate: toDate(i.raised) ?? new Date(0),
    lastActivityDate: toDate(i.lastActivity) ?? new Date(0),
    actualEndDate: toDate(i.actualEnd),
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
    severity: SEVERITY_FROM_DB[r.severity],
    status: r.status as IssueStatus,
    owner: r.owner,
    raisedBy: r.raisedBy,
    accountable: r.accountable as AccountableParty,
    raised: fromDateOrEmpty(r.raisedDate),
    lastActivity: fromDateOrEmpty(r.lastActivityDate),
    actualEnd: fromDate(r.actualEndDate),
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
    // A plain day, so it uses the date helper — unlike the timestamps below, which carry a
    // moment and would be silently destroyed by `toDate`'s midnight suffix.
    date: toDate(e.date) ?? new Date(0),
    hours: e.hours,
    activity: e.activity,
    billable: e.billable,
    note: e.note,
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
    date: fromDate(r.date) ?? '',
    // Decimal on the way out, number in the domain. `Number()` is exact here because the
    // column is (5,2) — five digits total — and every such value is representable.
    hours: Number(r.hours),
    activity: r.activity as TimeActivity,
    billable: r.billable,
    note: r.note,
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
