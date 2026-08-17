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
  auditFromRow,
  versionFromRow,
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
  approvalFromRow,
  approvalToRow,
  notificationFromRow,
  notificationToRow,
  sowFromRow,
  sowToRow,
  allocationFromRow,
  allocationToRow,
  commitmentFromRow,
  commitmentToRow,
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

/**
 * How much of the trail the application carries.
 *
 * It is loaded whole, into memory, on every page render and inside every write transaction, so
 * this is not a display limit — it is the size of the thing the reducer folds over. Five
 * thousand entries is roughly two thirds of a megabyte of the workspace's payload, which is
 * tolerable and would not be at fifty thousand.
 *
 * What the number costs is history: the History tab and the daily report can only see what is
 * loaded, so a tenant busier than this keeps a complete trail in the database and a recent one
 * in the application. That is the right way round — the record is complete where it is
 * evidence, and bounded where it is working memory — but it is a limit rather than an absence,
 * and worth stating where somebody choosing the number can see it.
 *
 * Settable, for two reasons. A firm with a much busier or much quieter workspace has a
 * different right answer, and — less obviously but more usefully — a defect in *which* rows are
 * selected only appears once there are more of them than the window. Making it small is how the
 * persistence proof reproduces that in five rows instead of five thousand.
 */
/**
 * Read per query rather than captured at import.
 *
 * As a module constant this was fixed by whatever the environment happened to hold the first
 * time anything imported this file — which in a framework that loads modules before it has
 * finished assembling the environment is a value nobody chose. It also could not be exercised:
 * the persistence proof sets the variable and reloads, and got the default every time, so the
 * cap went unverified against a real database while appearing to be covered.
 *
 * The cost is one environment read per workspace load, against a query that crosses a network.
 */
function auditWindow(): number {
  return Number(process.env.AXIOMATE_AUDIT_WINDOW) || 5000
}

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
  | 'approval'
  | 'notification'
  | 'sow'
  | 'allocation'
  | 'commitment'
  | 'issueEstimate'
  | 'estimateRevision'
  | 'engagement'
  | 'scheduleAudit'
  | 'workspaceMeta'
  | 'operatingModel'
  | 'version'
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
  const [nodes, issues, activities, dependencies, relationships, evidence, notes, timeEntries, approvals, notifications, sows, allocations, commitments, estimates, revisions, engagements, audit, meta, config, versions] =
    await Promise.all([
      db.hierarchyNode.findMany({ where: { tenantId } }),
      db.issue.findMany({ where: { tenantId } }),
      db.issueActivity.findMany({ where: { tenantId }, orderBy: { order: 'asc' } }),
      db.issueDependency.findMany({ where: { tenantId } }),
      db.issueRelationship.findMany({ where: { tenantId } }),
      db.evidence.findMany({ where: { tenantId } }),
      db.issueNote.findMany({ where: { tenantId } }),
      db.timeEntry.findMany({ where: { tenantId } }),
      db.approval.findMany({ where: { tenantId } }),
      db.notification.findMany({ where: { tenantId } }),
      db.sow.findMany({ where: { tenantId } }),
      db.allocation.findMany({ where: { tenantId } }),
      db.commitment.findMany({ where: { tenantId } }),
      db.issueEstimate.findMany({ where: { tenantId } }),
      db.estimateRevision.findMany({ where: { tenantId }, orderBy: { at: 'asc' } }),
      db.engagement.findMany({ where: { tenantId } }),
      /**
       * The newest entries, returned oldest-first.
       *
       * Those are two separate requirements and the query used to satisfy only the second.
       * `orderBy: 'asc'` with a `take` keeps the *oldest* five thousand rows, so once a tenant
       * passed that many, the trail the application loaded stopped moving: every new entry was
       * written to the database and none of them were ever read back.
       *
       * Nothing failed. Two things quietly stopped working. The daily client report derives
       * movement by filtering the trail to the last twenty-four hours, so it began reporting a
       * quiet day, every day, in a workspace that was busy. And restoring an archived branch
       * reads recent move entries to put children back where they came from — precisely the
       * entries this dropped — so a restore would silently leave them where the archive had
       * moved them.
       *
       * Ordering descending selects the right rows; reversing restores the ascending order the
       * rest of the application depends on, since `persistActions` appends new entries at the
       * end and the browser mirror keeps the tail. `id` breaks ties so a batch written in one
       * transaction, sharing a timestamp to the millisecond, cannot be split arbitrarily
       * between one load and the next.
       */
      db.scheduleAudit.findMany({
        where: { tenantId },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: auditWindow(),
      }),
      db.workspaceMeta.findUnique({ where: { tenantId } }),
      db.operatingModel.findUnique({ where: { tenantId } }),
      /*
       * Appended at the end of both lists rather than slotted in beside the other capacity
       * reads. This is a nineteen-element positional destructure, and two similarly shaped
       * `findMany` results swapped mid-array typecheck perfectly well while returning each
       * other's rows.
       */
      db.version.findMany({ where: { tenantId }, orderBy: { validFrom: 'asc' } }),
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
    approvals: Object.fromEntries(approvals.map((a) => [a.id, approvalFromRow(a)])),
    notifications: Object.fromEntries(notifications.map((n) => [n.id, notificationFromRow(n)])),
    sows: Object.fromEntries(sows.map((s) => [s.id, sowFromRow(s)])),
    allocations: Object.fromEntries(allocations.map((a) => [a.id, allocationFromRow(a)])),
    commitments: Object.fromEntries(commitments.map((c) => [c.id, commitmentFromRow(c)])),
    versions: Object.fromEntries(versions.map((v) => [v.id, versionFromRow(v)])),
    // Loaded from its own table in the storage step. Empty here so the in-memory shape is
    // complete from the first commit rather than half-existing across two.
    timesheets: {},
    estimates: Object.fromEntries(estimates.map((e) => [e.issueId, estimateFromRow(e)])),
    estimateRevisions: Object.fromEntries(revisions.map((v) => [v.id, revisionFromRow(v)])),
    engagements: Object.fromEntries(engagements.map((e) => [e.nodeId, engagementFromRow(e)])),
    model: readModel(
      config?.model,
      issues.map((i) => [i.owner, i.raisedBy]).flat(),
      issues.map((i) => i.type),
    ),
    /**
     * Reversed here rather than in the query, because the query had to sort the other way to
     * choose the right rows. Ascending is what everything downstream assumes.
     *
     * Through `auditFromRow` rather than a literal written out here. It was a literal, and it
     * was a second implementation of a mapping that already existed one import away — so when
     * the trail gained `byId` and `byEmail`, the writer learned about them and the reader did
     * not. Every entry went into Postgres carrying the identity behind the name and came back
     * out without it, which is invisible from either side on its own: the column was populated
     * and the application never saw it.
     *
     * Caught by the persistence proof, which is the only check that reads back what it wrote.
     */
    audit: [...audit].reverse().map(auditFromRow),
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

  try {
  await prisma.$transaction(async (tx) => {
    /**
     * The tenant row before anything that references it. Created rather than assumed: this is
     * also the path that provisions a tenant, and every other table restricts deletion of it.
     *
     * Raw, because `upsert` is not atomic here. Prisma compiles it to a read followed by a
     * create, so two boots racing on a new deployment both read nothing and both insert, and
     * the loser fails on the primary key before reaching anything this function could catch.
     * `ON CONFLICT DO NOTHING` is one statement and settles it in the database, where the
     * contention actually is.
     */
    await tx.$executeRaw`
      INSERT INTO "Tenant" (id, name, "createdAt", "updatedAt")
      VALUES (${tenantId}, ${provisioningName(tenantId)}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `

    /**
     * Claim the seed before writing any of it.
     *
     * The check above this transaction is a read, and a read cannot stop a second caller
     * doing the same thing. On a fresh deployment that is not a rare interleaving — it is the
     * normal case: the first page load fires several requests at once, each one boots, each
     * one finds no `seededAt`, and each one starts importing the same two hundred and
     * sixty-four issues. The first to reach a unique key wins and the rest fail partway
     * through, which is how the very first request to a new deployment ends in
     * `Unique constraint failed on the fields: ("tenantId", id)`.
     *
     * Creating the row here makes the claim itself the contended write. `workspaceMeta` is
     * keyed by tenant alone, so the second transaction blocks on that index until the first
     * commits and then loses — before it has written a single node — and the caller reports
     * "already seeded" rather than a constraint error from the middle of a half-built tree.
     */
    await tx.workspaceMeta.create({ data: { tenantId, seq: seed.seq, seededAt: new Date() } })
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
    // SOWs before the nodes that point at them would be ideal, but the nodes are written
    // first and carry the reference — so these are laid down here and the projects' `sowId`
    // is set by the node write that follows on a later import.
    for (const c of Object.values(seed.commitments)) {
      await tx.commitment.create({ data: commitmentToRow(tenantId, c) })
    }
    for (const a of Object.values(seed.allocations)) {
      if (!seed.nodes[a.projectId]) continue
      await tx.allocation.create({ data: allocationToRow(tenantId, a) })
    }
    for (const s of Object.values(seed.sows)) {
      if (!seed.nodes[s.engagementId]) continue
      await tx.sow.create({ data: sowToRow(tenantId, s) })
    }
    for (const n of Object.values(seed.notifications)) {
      if (!seed.issues[n.aboutId]) continue
      await tx.notification.create({ data: notificationToRow(tenantId, n) })
    }
    for (const a of Object.values(seed.approvals)) {
      if (!seed.issues[a.subjectId]) continue
      await tx.approval.create({ data: approvalToRow(tenantId, a) })
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
  } catch (err) {
    /**
     * Losing the claim is a normal outcome, not a failure.
     *
     * Another request got there first and is seeding, or has finished. Either way this caller
     * has written nothing — the claim is the first write in the transaction, so a loss rolls
     * back an empty transaction — and the right answer is the same one the fast path above
     * gives: somebody else did it.
     *
     * Narrow on purpose. Only a duplicate on `workspaceMeta` means "lost the race"; a unique
     * violation anywhere else means the seed itself is inconsistent, and swallowing that would
     * turn a broken seed file into a workspace that silently half-exists.
     */
    const e = err as { code?: string; meta?: { modelName?: string } }
    if (e?.code === 'P2002' && e.meta?.modelName === 'WorkspaceMeta') {
      return {
        imported: false,
        reason: 'Another request seeded this workspace first.',
        counts: { nodes: 0, issues: 0, relationships: 0 },
      }
    }
    throw err
  }

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
