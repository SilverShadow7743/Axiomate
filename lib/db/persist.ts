import 'server-only'
import type { Prisma } from '@prisma/client'
import { apply,
  applyWithRules, type Action, type WorkspaceState } from '../workspace'
import { prisma } from './client'
import { loadWorkspace } from './repo'
import type { TenantId } from '../tenant'
import type { Actor } from '../actor'
import {
  activityToRow,
  auditToRow,
  dependencyToRow,
  engagementToRow,
  evidenceToRow,
  issueToRow,
  nodeToRow,
  noteToRow,
  estimateToRow,
  timeToRow,
  approvalToRow,
  notificationToRow,
  revisionToRow,
  relationshipToRow,
} from './map'

/**
 * The write path.
 *
 * The server does not have a second set of rules. It loads the workspace, runs **the same
 * `apply()` the browser ran**, and writes down what changed. That is the whole design: the
 * reducer is pure, it is the single funnel every mutation has gone through since the first
 * commit, and duplicating its validation and audit logic in SQL would be the fastest way to
 * make the two disagree.
 *
 * What is written is targeted, not a full-state diff. Every action names the records it can
 * possibly touch, so the switch below mirrors the reducer's own arms — a 200-row rewrite per
 * committed cell edit is not a persistence strategy.
 */

export interface PersistResult {
  ok: boolean
  /** The reducer's own rejection, when it refused the action. */
  error?: string
  message?: string
  createdId?: string
  /** Audit rows written, so the caller can report what was recorded. */
  audited: number
}

/**
 * Apply a batch of actions against stored state and persist the result.
 *
 * A batch rather than a single action because the client queues writes: the workspace is
 * edited faster than a round trip completes, and each action must be replayed against the
 * state the one before it produced. Loading once and folding the whole batch is what makes
 * that true — a per-action endpoint hit concurrently would have every request reading the
 * same pre-batch snapshot and quietly losing all but the last.
 *
 * The fold stops at the first rejection and reports which action failed. Everything before it
 * is still written: those actions were valid, the client has already applied them, and
 * discarding them would put the two sides further apart, not closer.
 */
export async function persistActions(
  tenantId: TenantId,
  actor: Actor,
  actions: Action[],
): Promise<PersistResult> {
  // Retried because serializable isolation aborts a transaction that would have interleaved.
  // That abort is the mechanism working, not a failure: the loser replays against the state
  // the winner produced, which is precisely what "each action sees the one before it" means.
  for (let attempt = 0; ; attempt++) {
    try {
      return await runBatch(tenantId, actor, actions)
    } catch (err) {
      if (attempt >= MAX_SERIALIZATION_RETRIES || !isSerializationFailure(err)) throw err
    }
  }
}

/** Postgres reports a serialization conflict as 40001; Prisma surfaces it as P2034. */
function isSerializationFailure(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2034' || /40001|could not serialize|deadlock detected/i.test(e?.message ?? '')
}

const MAX_SERIALIZATION_RETRIES = 3

async function runBatch(
  tenantId: TenantId,
  actor: Actor,
  actions: Action[],
): Promise<PersistResult> {
  /**
   * The read happens INSIDE the transaction, and that placement is the whole point.
   *
   * Loading first and then opening a transaction to write is the shape this had, and it is
   * exactly the last-write-wins bug it was supposed to prevent: two concurrent batches both
   * read the pre-change state, both fold their actions against it, and the second writes over
   * the first with no error and no audit entry to show it happened.
   */
  return prisma.$transaction(
    async (tx) => {
      const { state } = await loadWorkspace(tenantId, tx)

      let current = state
      const applied: { action: Action; before: WorkspaceState; after: WorkspaceState }[] = []
      let failure: { error: string; index: number } | undefined
      let message: string | undefined
      let createdId: string | undefined

      for (const [index, action] of actions.entries()) {
        // The server's actor, never the client's: the action carries no attribution to
        // forge, so what is written down is whoever this request resolved to.
        const result = applyWithRules(current, action, actor)
        if (result.error) {
          failure = { error: result.error, index }
          break
        }
        /**
         * Every step the run produced — the action, then whatever the rules did about it —
         * each paired with the state either side of *itself*.
         *
         * Persisting a follow-up against the whole run's before-and-after would make
         * `writeAction` guess which rows moved for which reason, and re-applying them here to
         * recover the pairs would mint a second set of ids. The runner already knows, so it
         * says.
         *
         * They are not fed back to the client: the browser planned the same rules from the same
         * state and already holds them.
         */
        applied.push(...result.steps)
        current = result.state
        if (result.message) message = result.message
        if (result.createdId) createdId = result.createdId
      }

      // The reducer appends; anything past the original length is new.
      const newAudit = current.audit.slice(state.audit.length)

      for (const step of applied) {
        await writeAction(tx, tenantId, step.action, step.before, step.after)
      }
      if (newAudit.length) {
        await tx.scheduleAudit.createMany({ data: newAudit.map((a) => auditToRow(tenantId, a)) })
      }
      // `seq` mints every application-supplied id. Persisting it is what stops a restart from
      // handing out ids that already exist.
      if (current.seq !== state.seq) {
        await tx.workspaceMeta.upsert({
          where: { tenantId },
          create: { tenantId, seq: current.seq },
          update: { seq: current.seq },
        })
      }

      if (failure) {
        return {
          ok: false,
          error: `${failure.error} (action ${failure.index + 1} of ${actions.length}; ${applied.length} saved)`,
          audited: newAudit.length,
        }
      }
      return { ok: true, message, createdId, audited: newAudit.length }
    },
    {
      isolationLevel: 'Serializable',
      // The batch loads the workspace and writes what changed; generous enough for a cold
      // read, short enough that a wedged transaction does not hold the line indefinitely.
      timeout: 20_000,
      maxWait: 10_000,
    },
  )
}

/** Single-action convenience, in terms of the batch. */
export function persistAction(
  tenantId: TenantId,
  actor: Actor,
  action: Action,
): Promise<PersistResult> {
  return persistActions(tenantId, actor, [action])
}

type Tx = Prisma.TransactionClient

/** Write the records this action touched, and only those. */
async function writeAction(
  tx: Tx,
  tenantId: TenantId,
  action: Action,
  before: WorkspaceState,
  after: WorkspaceState,
): Promise<void> {
  switch (action.t) {
    case 'create': {
      const id = findCreatedId(before, after)
      if (!id) return
      if (after.nodes[id]) {
        await tx.hierarchyNode.create({ data: nodeToRow(tenantId, after.nodes[id]) })
      } else if (after.issues[id]) {
        const issue = after.issues[id]
        await tx.issue.create({
          data: issueToRow(tenantId, issue, Boolean(after.issues[issue.parentId])),
        })
      } else if (after.activities[id]) {
        await tx.issueActivity.create({ data: activityToRow(tenantId, after.activities[id]) })
      }
      return
    }

    case 'updateNode':
      return void (await upsertNode(tx, tenantId, after, action.id))

    case 'updateIssue':
      return void (await upsertIssue(tx, tenantId, after, action.id))

    case 'setAssignment':
      return void (await upsertIssue(tx, tenantId, after, action.issueId))

    case 'updateActivity':
      return void (await upsertActivity(tx, tenantId, after, action.id))

    case 'setDates':
      // One action, two possible targets — the reducer decides which by looking the id up.
      if (after.issues[action.id]) return void (await upsertIssue(tx, tenantId, after, action.id))
      return void (await upsertActivity(tx, tenantId, after, action.id))

    case 'move':
      if (after.nodes[action.id]) return void (await upsertNode(tx, tenantId, after, action.id))
      if (after.issues[action.id]) return void (await upsertIssue(tx, tenantId, after, action.id))
      return void (await upsertActivity(tx, tenantId, after, action.id))

    /**
     * Archive and restore touch a whole subtree, so every record whose `deletedAt` actually
     * changed is written — computed by comparison rather than by re-walking the tree, because
     * the reducer already decided which mode (cascade or reparent) applied.
     */
    case 'softDelete':
    case 'restore': {
      for (const id of changedIds(before, after)) {
        if (after.nodes[id]) await upsertNode(tx, tenantId, after, id)
        else if (after.issues[id]) await upsertIssue(tx, tenantId, after, id)
        else if (after.activities[id]) await upsertActivity(tx, tenantId, after, id)
      }
      return
    }

    case 'link': {
      const rel = after.relationships.find(
        (r) => !before.relationships.some((b) => b.id === r.id),
      )
      if (rel) await tx.issueRelationship.create({ data: relationshipToRow(tenantId, rel) })
      return
    }

    case 'unlink':
      await tx.issueRelationship.deleteMany({ where: { tenantId, id: action.id } })
      return

    case 'addDependency': {
      const dep = after.dependencies.find((d) => !before.dependencies.some((b) => b.id === d.id))
      if (dep) await tx.issueDependency.create({ data: dependencyToRow(tenantId, dep) })
      return
    }

    case 'removeDependency':
      await tx.issueDependency.deleteMany({ where: { tenantId, id: action.id } })
      return

    case 'addEvidence':
    case 'updateEvidence':
    case 'removeEvidence': {
      for (const [id, item] of Object.entries(after.evidence)) {
        if (before.evidence[id] === item) continue
        const row = evidenceToRow(tenantId, item)
        await tx.evidence.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    /**
     * Two records per action, not one: writing a note moves the parent issue's `lastActivity`,
     * because somebody recording what a client said *is* activity on the issue. Persisting the
     * note alone would leave a stored issue reporting itself as stale while its own notes say
     * otherwise — the exact drift the reducer arm exists to prevent.
     *
     * `removeNote` does not move the date and shares this arm anyway: both loops write only
     * what the reducer actually replaced, so the issue upsert simply finds nothing to do.
     */
    case 'addNote':
    case 'updateNote':
    case 'removeNote': {
      for (const [id, note] of Object.entries(after.notes)) {
        if (before.notes[id] === note) continue
        const row = noteToRow(tenantId, note)
        await tx.issueNote.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      // `changedIds` covers nodes, issues and activities; only the issue can have moved here,
      // and `upsertIssue` ignores an id that names anything else.
      for (const id of changedIds(before, after)) await upsertIssue(tx, tenantId, after, id)
      return
    }

    /**
     * A notification, and the read mark on one.
     *
     * `notify` never arrives over the wire — the endpoint refuses it — but it reaches this
     * function all the same, because the server plans the same rules the browser does and
     * applies what they ask for inside the same transaction.
     */
    case 'notify':
    case 'markNotificationRead': {
      for (const [id, n] of Object.entries(after.notifications)) {
        if (before.notifications[id] === n) continue
        const row = notificationToRow(tenantId, n)
        await tx.notification.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    /**
     * The approval, and nothing else.
     *
     * Unlike a note or a time entry, asking for a decision does not touch the issue: the
     * record has not moved, and saying it had activity because somebody is waiting on somebody
     * else would make "stale" mean two different things.
     */
    case 'requestApproval':
    case 'decideApproval': {
      for (const [id, approval] of Object.entries(after.approvals)) {
        if (before.approvals[id] === approval) continue
        const row = approvalToRow(tenantId, approval)
        await tx.approval.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    /**
     * The entry, and the issue whose activity date it moved.
     *
     * Two records for the same reason a note writes two: somebody spending four hours on an
     * issue today *is* activity on it, and persisting the hours alone would leave a stored
     * issue reporting itself as stale while its own time says otherwise.
     */
    case 'addTime':
    case 'updateTime':
    case 'removeTime': {
      for (const [id, entry] of Object.entries(after.timeEntries)) {
        if (before.timeEntries[id] === entry) continue
        const row = timeToRow(tenantId, entry)
        await tx.timeEntry.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      for (const id of changedIds(before, after)) await upsertIssue(tx, tenantId, after, id)
      return
    }

    /**
     * The estimate, and the revision the edit may have minted.
     *
     * Both are written from the state the reducer returned rather than from the action: the
     * action carries a patch, and whether that patch amounted to a revision is a judgement the
     * reducer already made against the size calibration. Re-deciding it here would be a second
     * implementation of the same rule, free to disagree with the first.
     */
    case 'setEstimate':
    case 'baselineEstimate': {
      for (const [issueId, est] of Object.entries(after.estimates)) {
        if (before.estimates[issueId] === est) continue
        const row = estimateToRow(tenantId, est)
        await tx.issueEstimate.upsert({
          where: { tenantId_issueId: { tenantId, issueId } },
          create: row,
          update: row,
        })
      }
      for (const [id, rev] of Object.entries(after.estimateRevisions)) {
        if (before.estimateRevisions[id]) continue
        // Created, never edited — a revision is a record of something that happened.
        await tx.estimateRevision.create({ data: revisionToRow(tenantId, rev) })
      }
      return
    }

    /**
     * Lifecycle generation creates a batch of activities and the dependencies between them;
     * clearing removes both. These are the only actions that legitimately write many rows.
     */
    case 'buildLifecycle': {
      const created = Object.values(after.activities).filter((a) => !before.activities[a.id])
      for (const a of created) await tx.issueActivity.create({ data: activityToRow(tenantId, a) })
      const deps = after.dependencies.filter((d) => !before.dependencies.some((b) => b.id === d.id))
      for (const d of deps) await tx.issueDependency.create({ data: dependencyToRow(tenantId, d) })
      return
    }

    case 'clearLifecycle':
      // Dependencies fall with their activities via `onDelete: Cascade`.
      await tx.issueActivity.deleteMany({ where: { tenantId, issueId: action.issueId } })
      return

    /**
     * Configuration is one JSON document, so any change writes the whole thing. That is the
     * tradeoff accepted when it was modelled as a document rather than as tables: it is small,
     * it is edited as a whole, and the alternative is eleven tables for something one person
     * changes a handful of times.
     */
    case 'updateEngagement': {
      const detail = after.engagements[action.nodeId]
      if (!detail) return
      const row = engagementToRow(tenantId, detail)
      await tx.engagement.upsert({
        where: { tenantId_nodeId: { tenantId, nodeId: action.nodeId } },
        create: row,
        update: row,
      })
      return
    }

    case 'config':
      await tx.operatingModel.upsert({
        where: { tenantId },
        create: { tenantId, model: after.model as unknown as object },
        update: { model: after.model as unknown as object },
      })
      return

    default:
      return
  }
}

/* ================================================================== *
 * Helpers
 * ================================================================== */

async function upsertNode(tx: Tx, tenantId: TenantId, s: WorkspaceState, id: string): Promise<void> {
  const n = s.nodes[id]
  if (!n) return
  const row = nodeToRow(tenantId, n)
  await tx.hierarchyNode.upsert({
    where: { tenantId_id: { tenantId, id } },
    create: row,
    update: row,
  })
}

async function upsertIssue(tx: Tx, tenantId: TenantId, s: WorkspaceState, id: string): Promise<void> {
  const i = s.issues[id]
  if (!i) return
  const row = issueToRow(tenantId, i, Boolean(s.issues[i.parentId]))
  await tx.issue.upsert({ where: { tenantId_id: { tenantId, id } }, create: row, update: row })
}

async function upsertActivity(tx: Tx, tenantId: TenantId, s: WorkspaceState, id: string): Promise<void> {
  const a = s.activities[id]
  if (!a) return
  const row = activityToRow(tenantId, a)
  await tx.issueActivity.upsert({
    where: { tenantId_id: { tenantId, id } },
    create: row,
    update: row,
  })
}

/** The one record present after the action and absent before it. */
function findCreatedId(before: WorkspaceState, after: WorkspaceState): string | null {
  for (const id of Object.keys(after.nodes)) if (!before.nodes[id]) return id
  for (const id of Object.keys(after.issues)) if (!before.issues[id]) return id
  for (const id of Object.keys(after.activities)) if (!before.activities[id]) return id
  return null
}

/**
 * Records whose object identity changed.
 *
 * Identity is a sound test here because the reducer is immutable throughout: an untouched
 * record is the same object in both states, and a touched one is always a fresh copy.
 */
function changedIds(before: WorkspaceState, after: WorkspaceState): string[] {
  const out: string[] = []
  for (const [id, v] of Object.entries(after.nodes)) if (before.nodes[id] !== v) out.push(id)
  for (const [id, v] of Object.entries(after.issues)) if (before.issues[id] !== v) out.push(id)
  for (const [id, v] of Object.entries(after.activities)) if (before.activities[id] !== v) out.push(id)
  return out
}
