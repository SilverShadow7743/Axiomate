import 'server-only'
import type { WorkspaceState } from '../workspace'
import { initModel } from '../config'
import type { OperatingModel } from '../config'
import type { PrismaClient } from '@prisma/client'
import { prisma } from './client'
import { provisioningName, type TenantId } from '../tenant'
import {
  activityFromRow,
  activityToRow,
  auditToRow,
  dependencyFromRow,
  dependencyToRow,
  engagementFromRow,
  engagementToRow,
  evidenceFromRow,
  evidenceToRow,
  issueFromRow,
  issueToRow,
  nodeFromRow,
  nodeToRow,
  noteFromRow,
  noteToRow,
  timeFromRow,
  timeToRow,
  estimateFromRow,
  estimateToRow,
  revisionFromRow,
  revisionToRow,
  relationshipFromRow,
  relationshipToRow,
} from './map'

/**
 * Reading and writing the whole workspace.
 *
 * The application's unit of truth is `WorkspaceState` — the reducer takes one and returns
 * one — so the load path's job is to reconstruct exactly that shape, and the import path's
 * job is to lay one down. Everything narrower (a single edit) goes through `persist.ts`.
 */

/* ================================================================== *
 * Load
 * ================================================================== */

export interface LoadedWorkspace {
  state: WorkspaceState
  /** Issues whose parent column pointed nowhere. Reported rather than silently rehomed. */
  orphans: string[]
}

/**
 * Either the client or a transaction handle.
 *
 * The write path has to read *inside* its own transaction — otherwise two concurrent batches
 * both load the same pre-change snapshot and the second silently overwrites the first. Making
 * the reader a parameter is what allows that, and the plain client remains the default for
 * page loads, which have no transaction to join.
 */
type Reader = Pick<
  PrismaClient,
  | 'hierarchyNode'
  | 'issue'
  | 'issueActivity'
  | 'issueDependency'
  | 'issueRelationship'
  | 'evidence'
  | 'issueNote'
  | 'timeEntry'
  | 'issueEstimate'
  | 'estimateRevision'
  | 'engagement'
  | 'scheduleAudit'
  | 'workspaceMeta'
  | 'operatingModel'
>

/**
 * Rebuild one tenant's `WorkspaceState` from the database.
 *
 * The tenant is the first parameter and there is no overload without it — see `TenantId`.
 * Every query below names it, including the two that used to be `findUnique` on a row called
 * `singleton`: those were the schema asserting that one installation serves one firm.
 *
 * `WorkspaceState` itself carries no tenant, deliberately. The reducer is a pure function over
 * one workspace and has no business knowing there are others; tenancy is a property of the
 * boundary, enforced on the way in and on the way out. Threading a tenant id through every
 * record would put an access-control concern inside a domain model and give a thousand places
 * the chance to disagree about it.
 *
 * Soft-deleted rows are loaded, not filtered: `deletedAt` is part of the record, the tree
 * builder is what hides them, and Restore needs them present to bring one back.
 */
export async function loadWorkspace(
  tenantId: TenantId,
  db: Reader = prisma,
): Promise<LoadedWorkspace> {
  // Written out at every call rather than hoisted into a shared `scope` object. The nine
  // characters saved cost the thing that matters here: a reader — and the audit script that
  // checks this file — can see that each query names the tenant without following a variable.
  const [nodes, issues, activities, dependencies, relationships, evidence, notes, timeEntries, estimates, revisions, engagements, audit, meta, config] =
    await Promise.all([
      db.hierarchyNode.findMany({ where: { tenantId } }),
      db.issue.findMany({ where: { tenantId } }),
      db.issueActivity.findMany({ where: { tenantId }, orderBy: { order: 'asc' } }),
      db.issueDependency.findMany({ where: { tenantId } }),
      db.issueRelationship.findMany({ where: { tenantId } }),
      db.evidence.findMany({ where: { tenantId } }),
      db.issueNote.findMany({ where: { tenantId } }),
      db.timeEntry.findMany({ where: { tenantId } }),
      db.issueEstimate.findMany({ where: { tenantId } }),
      db.estimateRevision.findMany({ where: { tenantId }, orderBy: { at: 'asc' } }),
      db.engagement.findMany({ where: { tenantId } }),
      // Newest last, so the History tab's own ordering is applied to a stable list.
      db.scheduleAudit.findMany({ where: { tenantId }, orderBy: { at: 'asc' }, take: 5000 }),
      db.workspaceMeta.findUnique({ where: { tenantId } }),
      db.operatingModel.findUnique({ where: { tenantId } }),
    ])

  const state: WorkspaceState = {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, nodeFromRow(n)])),
    issues: Object.fromEntries(issues.map((i) => [i.id, issueFromRow(i)])),
    activities: Object.fromEntries(activities.map((a) => [a.id, activityFromRow(a)])),
    dependencies: dependencies.map(dependencyFromRow),
    relationships: relationships.map(relationshipFromRow),
    evidence: Object.fromEntries(evidence.map((e) => [e.id, evidenceFromRow(e)])),
    // Unordered on purpose: `sortNotes` puts pinned first and then orders by last activity on
    // the note, which no single column can express.
    notes: Object.fromEntries(notes.map((n) => [n.id, noteFromRow(n)])),
    // Keyed by issue id rather than a row id of their own: an issue has one estimate, and the
    // screen always arrives holding the issue.
    timeEntries: Object.fromEntries(timeEntries.map((e) => [e.id, timeFromRow(e)])),
    estimates: Object.fromEntries(estimates.map((e) => [e.issueId, estimateFromRow(e)])),
    estimateRevisions: Object.fromEntries(revisions.map((v) => [v.id, revisionFromRow(v)])),
    engagements: Object.fromEntries(engagements.map((e) => [e.nodeId, engagementFromRow(e)])),
    model: readModel(
      config?.model,
      issues.map((i) => [i.owner, i.raisedBy]).flat(),
      issues.map((i) => i.type),
    ),
    audit: audit.map((r) => ({
      id: r.id,
      rowId: r.rowId,
      field: r.field,
      from: r.from,
      to: r.to,
      at: r.at.toISOString(),
      by: r.by,
      reason: r.reason ?? undefined,
    })),
    seq: meta?.seq ?? 1,
  }

  const orphans = Object.values(state.issues)
    .filter((i) => !i.parentId || (!state.nodes[i.parentId] && !state.issues[i.parentId]))
    .map((i) => i.id)

  return { state, orphans }
}

/**
 * The stored operating model is JSON, so it gets the same treatment as any other untyped
 * input: if it is unreadable, fall back to the shipped seed rather than handing a malformed
 * object to the resolvers. A configuration that has been corrupted should look like defaults,
 * not like a broken app.
 */
function readModel(raw: unknown, owners: string[], types: string[]): OperatingModel {
  const seed = initModel([...new Set(owners)], [...new Set(types)])
  if (!raw || typeof raw !== 'object') return seed
  const stored = raw as Partial<OperatingModel>
  if (!stored.agents || !stored.responsibilities) return seed
  return {
    ...seed,
    ...stored,
    // Same reason as the browser mirror: a stored model predating this key would spread
    // `undefined` over the seeded registry.
    workTypes: { ...seed.workTypes, ...(stored.workTypes ?? {}) },
    sla: { ...seed.sla, ...(stored.sla ?? {}) },
    sizeBands: Array.isArray(stored.sizeBands) && stored.sizeBands.length ? stored.sizeBands : seed.sizeBands,
    access: {
      ...seed.access,
      ...(stored.access ?? {}),
      grants: { ...seed.access.grants, ...(stored.access?.grants ?? {}) },
      defaultRoleIds: stored.access?.defaultRoleIds ?? seed.access.defaultRoleIds,
    },
    statusPolicy: {
      ...seed.statusPolicy,
      ...(stored.statusPolicy ?? {}),
      transitions: { ...seed.statusPolicy.transitions, ...(stored.statusPolicy?.transitions ?? {}) },
      requireEvidence: stored.statusPolicy?.requireEvidence ?? seed.statusPolicy.requireEvidence,
      requireReason: stored.statusPolicy?.requireReason ?? seed.statusPolicy.requireReason,
    },
    // `runtime` and `maxAutonomy` always come from the seed: they describe what this build
    // implements, and a stored record must never claim a capability the code does not have.
    agents: Object.fromEntries(
      Object.entries(seed.agents).map(([id, base]) => {
        const s = stored.agents?.[id]
        return [id, s ? { ...base, enabled: s.enabled, autonomy: s.autonomy, requireApproval: s.requireApproval } : base]
      }),
    ),
  } as OperatingModel
}

/* ================================================================== *
 * Import
 * ================================================================== */

export interface ImportResult {
  imported: boolean
  reason: string
  counts: { nodes: number; issues: number; relationships: number }
}

/**
 * Lay the seed log down as the initial contents of an empty database.
 *
 * Guarded by `WorkspaceMeta.seededAt` rather than by a row count, so a workspace someone has
 * deliberately emptied is not silently refilled on the next boot. Import is a one-time event
 * with a recorded timestamp, not a reconciliation.
 */
export async function importWorkspace(
  tenantId: TenantId,
  seed: WorkspaceState,
): Promise<ImportResult> {
  // Per tenant, not global. A single `seededAt` would refuse to seed the second firm because
  // the first had been seeded — and would report "already seeded" while their tree sat empty.
  const existing = await prisma.workspaceMeta.findUnique({ where: { tenantId } })
  if (existing?.seededAt) {
    return {
      imported: false,
      reason: `Already seeded at ${existing.seededAt.toISOString()}.`,
      counts: { nodes: 0, issues: 0, relationships: 0 },
    }
  }

  const nodes = Object.values(seed.nodes)
  const issues = Object.values(seed.issues)

  await prisma.$transaction(async (tx) => {
    // The tenant row before anything that references it. Created rather than assumed: this is
    // also the path that provisions a tenant, and every other table restricts deletion of it.
    await tx.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId, name: provisioningName(tenantId) },
      update: {},
    })
    // Parents before children, or the self-referencing foreign key rejects the insert.
    const byDepth = [...nodes].sort((a, b) => depthOf(seed, a.id) - depthOf(seed, b.id))
    for (const n of byDepth) await tx.hierarchyNode.create({ data: nodeToRow(tenantId, n) })

    // Same for sub-issues: an issue whose parent is another issue must follow it.
    const issuesByDepth = [...issues].sort((a, b) => depthOf(seed, a.id) - depthOf(seed, b.id))
    for (const i of issuesByDepth) {
      await tx.issue.create({ data: issueToRow(tenantId, i, Boolean(seed.issues[i.parentId])) })
    }

    for (const a of Object.values(seed.activities)) {
      await tx.issueActivity.create({ data: activityToRow(tenantId, a) })
    }
    for (const d of seed.dependencies) {
      await tx.issueDependency.create({ data: dependencyToRow(tenantId, d) })
    }
    // Relationships from the log can reference issues that were never logged; skip those
    // rather than failing the whole import on a dangling reference.
    for (const r of seed.relationships) {
      if (!seed.issues[r.sourceIssueId] || !seed.issues[r.targetIssueId]) continue
      await tx.issueRelationship.create({ data: relationshipToRow(tenantId, r) })
    }
    for (const e of Object.values(seed.evidence)) {
      await tx.evidence.create({ data: evidenceToRow(tenantId, e) })
    }
    // After the issues, like evidence: a note's foreign key is its issue.
    for (const n of Object.values(seed.notes)) {
      await tx.issueNote.create({ data: noteToRow(tenantId, n) })
    }
    for (const e of Object.values(seed.timeEntries)) {
      if (!seed.issues[e.issueId]) continue
      await tx.timeEntry.create({ data: timeToRow(tenantId, e) })
    }
    // Estimates before revisions: a revision's foreign key is the estimate, not the issue.
    for (const e of Object.values(seed.estimates)) {
      if (!seed.issues[e.issueId]) continue
      await tx.issueEstimate.create({ data: estimateToRow(tenantId, e) })
    }
    for (const v of Object.values(seed.estimateRevisions)) {
      if (!seed.estimates[v.issueId]) continue
      await tx.estimateRevision.create({ data: revisionToRow(tenantId, v) })
    }
    // After the nodes: each row is keyed by the engagement node it describes.
    for (const e of Object.values(seed.engagements)) {
      if (!seed.nodes[e.nodeId]) continue
      await tx.engagement.create({ data: engagementToRow(tenantId, e) })
    }
    if (seed.audit.length) {
      await tx.scheduleAudit.createMany({ data: seed.audit.map((a) => auditToRow(tenantId, a)) })
    }

    await tx.operatingModel.upsert({
      where: { tenantId },
      create: { tenantId, model: seed.model as unknown as object },
      update: { model: seed.model as unknown as object },
    })
    await tx.workspaceMeta.upsert({
      where: { tenantId },
      create: { tenantId, seq: seed.seq, seededAt: new Date() },
      update: { seq: seed.seq, seededAt: new Date() },
    })
  }, { timeout: 120_000 })

  return {
    imported: true,
    reason: 'Seeded from the issue log.',
    counts: { nodes: nodes.length, issues: issues.length, relationships: seed.relationships.length },
  }
}

/** Distance to the root, so parents are always inserted before their children. */
function depthOf(state: WorkspaceState, id: string): number {
  let depth = 0
  let cursor: string | null | undefined = id
  const guard = new Set<string>()
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor)
    cursor = state.nodes[cursor]?.parentId ?? state.issues[cursor]?.parentId ?? null
    if (cursor) depth++
  }
  return depth
}
