import 'server-only'
import type { Prisma } from '@prisma/client'
import { apply,
  applyWithRules, type Action, type WorkspaceState } from '../workspace'
import { prisma, withTenant } from './client'
import { loadWorkspace } from './repo'
import type { TenantId } from '../tenant'
import type { Actor } from '../actor'
import { KEY_RETENTION_DAYS, keysIn, split, type SubmittedAction } from '../idempotency'
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
  sowToRow,
  allocationToRow,
  projectMemberToRow,
  personalEventToRow,
  inboundMailToRow,
  commitmentToRow,
  versionToRow,
  timesheetToRow,
  rateToRow,
  personSkillToRow,
  documentToRow,
  reviewToRow,
  milestoneToRow,
  scopeItemToRow,
  changeToRow,
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
  /** Keys of actions that committed. Present on a rejection, where the prefix still stands. */
  committedKeys?: string[]
  /**
   * Actions recognised as already applied and therefore not applied again.
   *
   * Reported rather than kept quiet. A redelivery is a normal event — a tab closing mid-save
   * produces one every time — but a batch where *everything* was skipped means the client is
   * re-sending work it has already had acknowledged, and that is worth being able to see.
   */
  skipped: number
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
  actions: SubmittedAction[],
): Promise<PersistResult> {
  // Retried because serializable isolation aborts a transaction that would have interleaved.
  // That abort is the mechanism working, not a failure: the loser replays against the state
  // the winner produced, which is precisely what "each action sees the one before it" means.
  for (let attempt = 0; ; attempt++) {
    try {
      return await runBatch(tenantId, actor, actions)
    } catch (err) {
      if (attempt >= MAX_SERIALIZATION_RETRIES) throw err
      if (!isSerializationFailure(err) && !isDuplicateKey(err)) throw err
    }
  }
}

/** Postgres reports a serialization conflict as 40001; Prisma surfaces it as P2034. */
function isSerializationFailure(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2034' || /40001|could not serialize|deadlock detected/i.test(e?.message ?? '')
}

/**
 * Two concurrent batches carrying the same key both looked, both found nothing, and both
 * inserted. One of them loses on the primary key.
 *
 * That is the constraint doing its job, and it has to be retried rather than reported: on the
 * second pass the loser reads the key the winner committed, skips the action, and returns the
 * correct answer — which is that the work was already done. Left unhandled it surfaces as a
 * 500, the queue backs off four times and halts, and the fix for duplicate writes becomes a
 * new way to stop saving.
 *
 * Scoped to this one constraint on purpose. A unique violation anywhere else in the schema is
 * a real defect, and retrying it three times before reporting it would only make it harder to
 * find.
 */
function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } }
  if (e?.code !== 'P2002') return false
  const target = e.meta?.target
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')]
  // Prisma reports the target either as the constraint name or as the field list, depending on
  // the driver — so both forms are recognised. Matching a bare `key` would be wider than
  // intended: no other model has such a column today, and one added later would start being
  // retried instead of reported. The composite is the whole primary key or it is not this one.
  if (fields.some((f) => /applied_?action/i.test(f))) return true
  return fields.length === 2 && fields.includes('tenantId') && fields.includes('key')
}

const MAX_SERIALIZATION_RETRIES = 3

async function runBatch(
  tenantId: TenantId,
  actor: Actor,
  actions: SubmittedAction[],
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
      /**
       * Set before the very first read this transaction makes. Every table `loadWorkspace` and
       * every write below it touches carries an RLS policy checking this against `tenantId` —
       * see `docs/plans/2026-08-24-row-level-security-design.md`. Placed here rather than
       * relying on `loadWorkspace(tenantId, tx)` to set it itself: `tx` is not the bare `prisma`
       * client, so `loadWorkspace` deliberately does nothing with the tenant on this path and
       * trusts the caller — this line is that trust being honored.
       */
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      const { state } = await loadWorkspace(tenantId, tx)

      /**
       * Which of these actions have already been applied.
       *
       * Read inside the transaction, like the workspace itself and for the same reason: a set
       * read before the transaction opened is a snapshot that another writer can invalidate
       * before this one commits. Under serializable isolation, reading it here is what makes
       * the check and the write a single decision.
       */
      const submittedKeys = keysIn(actions)
      const seen = new Set<string>()
      if (submittedKeys.length) {
        const rows = await tx.appliedAction.findMany({
          where: { tenantId, key: { in: submittedKeys } },
          select: { key: true },
        })
        for (const r of rows) seen.add(r.key)
      }
      const { planned, skipped, record } = split(actions, seen)

      let current = state
      const applied: { action: Action; before: WorkspaceState; after: WorkspaceState }[] = []
      let failure: { error: string; index: number } | undefined
      let message: string | undefined
      let createdId: string | undefined

      for (const [index, { action }] of planned.entries()) {
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
        await persistSteps(tx, tenantId, step.action, step.before, step.after)
      }

      /**
       * Keys are recorded for the actions that actually went through, and no further.
       *
       * The fold stops at the first rejection and everything before it is still written, so
       * the same boundary has to govern this: recording a key for an action the reducer
       * refused would make the client's retry skip it forever, turning a rejection the user
       * could have fixed into a change that silently never happens.
       *
       * `record` is already free of duplicates — `split` collapses a key repeated within one
       * batch — so `createMany` cannot trip over its own input.
       */
      const appliedCount = failure ? failure.index : planned.length
      const committedKeys = new Set(
        planned.slice(0, appliedCount).map((p) => p.key).filter((k): k is string => Boolean(k)),
      )
      const toRecord = record.filter((k) => committedKeys.has(k))
      if (toRecord.length) {
        await tx.appliedAction.createMany({ data: toRecord.map((key) => ({ tenantId, key })) })
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
          error: `${failure.error} (action ${failure.index + 1} of ${planned.length}; ${applied.length} saved)`,
          audited: newAudit.length,
          skipped: skipped.length,
          /**
           * The keys that committed before the refusal, so the client can stop counting them
           * as unsaved.
           *
           * Everything before a rejection is written and stays written. Without this the
           * browser keeps the whole batch and tells the user that fifty changes are held in
           * the tab and a reload will lose them — when twelve of them are already durable in
           * Postgres. Overstating the cost of a reload is a poor way to help somebody decide
           * whether to reload.
           */
          committedKeys: toRecord,
        }
      }
      return { ok: true, message, createdId, audited: newAudit.length, skipped: skipped.length }
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
/**
 * Persist one applied action, given the state either side of it.
 *
 * Exported for the scheduled pass, which produces its steps outside `persistActions` — it
 * starts from the clock rather than from a list of actions — and must still write them through
 * the same arms. A second writer for the same rows is how two paths end up disagreeing about
 * which table an action touches.
 */
export async function persistSteps(
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
      // A machine-created issue also minted arrival notifications; they land with it.
      await persistNotificationDiff(tx, tenantId, before, after)
      return
    }

    /**
     * Two rows, and both or neither.
     *
     * The copy and the record that it *is* a copy are one fact split across two tables. Writing
     * the issue alone would leave a duplicate in Postgres with nothing saying what it duplicates
     * — which is the state the 48 deleted rows were in, reproduced by the feature meant to
     * prevent it. Both writes sit inside the batch transaction, so a failure on the second takes
     * the first with it.
     *
     * Each half is written the way its own arm writes it: the issue as `create` does, down to
     * the sub-issue flag; the relationship as `link` does, found by id-diff because the reducer
     * is the only thing that knows which one it just minted.
     */
    case 'duplicate': {
      const id = findCreatedId(before, after)
      if (id && after.issues[id]) {
        const issue = after.issues[id]
        await tx.issue.create({
          data: issueToRow(tenantId, issue, Boolean(after.issues[issue.parentId])),
        })
      }
      const rel = after.relationships.find(
        (r) => !before.relationships.some((b) => b.id === r.id),
      )
      if (rel) await tx.issueRelationship.create({ data: relationshipToRow(tenantId, rel) })
      return
    }

    case 'updateNode':
      return void (await upsertNode(tx, tenantId, after, action.id))

    case 'updateIssue':
      await upsertIssue(tx, tenantId, after, action.id)
      // An owner change may have minted an assignment notification; it lands with the row.
      return void (await persistNotificationDiff(tx, tenantId, before, after))

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

    case 'upsertAllocation':
    case 'removeAllocation': {
      for (const [id, alloc] of Object.entries(after.allocations)) {
        if (before.allocations[id] === alloc) continue
        const row = allocationToRow(tenantId, alloc)
        await tx.allocation.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'addProjectMember':
    case 'updateProjectMember':
    case 'removeProjectMember': {
      for (const [id, m] of Object.entries(after.projectMembers)) {
        if (before.projectMembers[id] === m) continue
        const row = projectMemberToRow(tenantId, m)
        await tx.projectMember.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'addPersonalEvent':
    case 'updatePersonalEvent':
    case 'removePersonalEvent': {
      for (const [id, e] of Object.entries(after.personalEvents)) {
        if (before.personalEvents[id] === e) continue
        const row = personalEventToRow(tenantId, e)
        await tx.personalEvent.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'recordInboundMail': {
      for (const [id, m] of Object.entries(after.inboundMail)) {
        if (before.inboundMail[id] === m) continue
        const row = inboundMailToRow(tenantId, m)
        await tx.inboundMail.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'upsertCommitment':
    case 'removeCommitment':
    case 'decideLeave': {
      // decideLeave was MISSING from this switch until E2's live check found its decision
      // evaporating on reload — the arm changed state, the default arm wrote nothing, and no
      // screen could reach it to notice (E1 shipped the arm with no surface). The commitment
      // loop covers all three; the notification diff carries the approval traffic the arms
      // now mint (leave-requested to the holders, leave-decided to the subject).
      for (const [id, c] of Object.entries(after.commitments)) {
        if (before.commitments[id] === c) continue
        const row = commitmentToRow(tenantId, c)
        await tx.commitment.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      await persistNotificationDiff(tx, tenantId, before, after)
      return
    }

    /**
     * The statement of work, and — for an attribution — the node that now points at it.
     *
     * `attributeToSow` writes no SOW row at all: it changes which project is delivered under
     * one, which is a column on the node. Sharing the arm keeps the two halves of the same
     * commercial thought together, and each loop writes only what its own action moved.
     */
    /**
     * Recording a period and correcting one write the same row, so they share an arm. The loop
     * compares by identity — both reducer arms build a fresh object for whatever they touched
     * and leave everything else alone — so a correction writes one row and a record writes one
     * row, never the whole timeline.
     *
     * Nothing is ever deleted here. A version that was wrong is corrected in place and the
     * correction is audited with both sides; removing the row instead would take the only
     * record of what the workspace used to believe.
     */
    /*
     * Submit and decide both write the one row. Compared by identity, so a decision writes the
     * sheet it decided and nothing else — and a resubmission updates the same row rather than
     * inserting a second, which the unique constraint would refuse anyway.
     */
    case 'submitTimesheet':
    case 'decideTimesheet': {
      for (const [id, t] of Object.entries(after.timesheets)) {
        if (before.timesheets[id] === t) continue
        const row = timesheetToRow(tenantId, t)
        await tx.timesheet.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      // The E2 mints: submitted to the deciders, decided to the submitter.
      await persistNotificationDiff(tx, tenantId, before, after)
      return
    }

    case 'upsertChangeRequest':
    case 'withdrawChangeRequest':
    case 'decideChangeRequest': {
      for (const [id, c] of Object.entries(after.changes)) {
        if (before.changes[id] === c) continue
        const row = changeToRow(tenantId, c)
        await tx.changeRequest.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'recordRate':
    case 'correctRate': {
      for (const [id, r] of Object.entries(after.rates)) {
        if (before.rates[id] === r) continue
        const row = rateToRow(tenantId, r)
        await tx.personRate.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'recordPersonSkill':
    case 'correctPersonSkill':
    case 'removePersonSkill': {
      for (const [id, p] of Object.entries(after.personSkills)) {
        if (before.personSkills[id] === p) continue
        const row = personSkillToRow(tenantId, p)
        await tx.personSkill.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    /*
     * The evidence sweep is not incidental. `recordDocument` can stamp `documentId` onto an
     * evidence row in the same act, and `removeDocument` clears it from every row that pointed
     * at the withdrawn file — persisting only the document would leave the database holding a
     * pointer the reducer had already cleared.
     */
    case 'upsertScopeItem':
    case 'removeScopeItem':
    case 'decideScopeItem': {
      for (const [id, i] of Object.entries(after.scopeItems)) {
        if (before.scopeItems[id] === i) continue
        const row = scopeItemToRow(tenantId, i)
        await tx.scopeItem.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'upsertMilestone':
    case 'removeMilestone':
    case 'deliverMilestone':
    case 'decideMilestone': {
      for (const [id, m] of Object.entries(after.milestones)) {
        if (before.milestones[id] === m) continue
        const row = milestoneToRow(tenantId, m)
        await tx.milestone.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    /**
     * A review, and the verdicts on one. The completing verdict also mints a pinned note
     * inside the arm, so the note diff persists here with it.
     */
    case 'requestDocumentReview':
    case 'decideDocumentReview':
    case 'withdrawDocumentReview': {
      for (const [id, r] of Object.entries(after.documentReviews)) {
        if (before.documentReviews[id] === r) continue
        const row = reviewToRow(tenantId, r)
        await tx.documentReview.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      for (const [id, n] of Object.entries(after.notes)) {
        if (before.notes[id] === n) continue
        const row = noteToRow(tenantId, n)
        await tx.issueNote.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'recordDocument':
    case 'removeDocument': {
      for (const [id, d] of Object.entries(after.documents)) {
        if (before.documents[id] === d) continue
        const row = documentToRow(tenantId, d)
        await tx.document.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      for (const [id, e] of Object.entries(after.evidence)) {
        if (before.evidence[id] === e) continue
        const row = evidenceToRow(tenantId, e)
        await tx.evidence.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    /*
     * A hard delete, matching the reducer. Everything else in this file upserts what changed;
     * this is the one arm that removes a row, so it compares the two sets rather than iterating
     * `after` — a row that is gone cannot be found by walking what remains.
     */
    case 'removeVersion': {
      for (const id of Object.keys(before.versions)) {
        if (after.versions[id]) continue
        await tx.version.deleteMany({ where: { tenantId, id } })
      }
      return
    }

    case 'recordVersion':
    case 'correctVersion': {
      for (const [id, v] of Object.entries(after.versions)) {
        if (before.versions[id] === v) continue
        const row = versionToRow(tenantId, v)
        await tx.version.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      return
    }

    case 'upsertSow':
    case 'archiveSow':
    case 'attributeToSow': {
      for (const [id, sow] of Object.entries(after.sows)) {
        if (before.sows[id] === sow) continue
        const row = sowToRow(tenantId, sow)
        await tx.sow.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
      for (const [id, node] of Object.entries(after.nodes)) {
        if (before.nodes[id] === node) continue
        const row = nodeToRow(tenantId, node)
        await tx.hierarchyNode.upsert({
          where: { tenantId_id: { tenantId, id } },
          create: row,
          update: row,
        })
      }
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
    case 'markNotificationDelivery':
    case 'markNotificationRead':
      return void (await persistNotificationDiff(tx, tenantId, before, after))

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

    // The one non-config action that writes the model: a person's own preference lives
    // in the operating-model document, and a pref that vanished on reload would be worse
    // than none.
    case 'setNotificationPref':
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

/** Every notification the batch touched — created, stamped, or read — written as one shape. */
async function persistNotificationDiff(
  tx: Tx,
  tenantId: TenantId,
  before: WorkspaceState,
  after: WorkspaceState,
): Promise<void> {
  for (const [id, n] of Object.entries(after.notifications)) {
    if (before.notifications[id] === n) continue
    const row = notificationToRow(tenantId, n)
    await tx.notification.upsert({
      where: { tenantId_id: { tenantId, id } },
      create: row,
      update: row,
    })
  }
}

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

/**
 * Forget action keys older than the retention window.
 *
 * Called by the daily pass rather than by the write path, and the placement is the point: a
 * `deleteMany` inside every batch would put two concurrent writers in contention over the same
 * expired rows under serializable isolation — a conflict created entirely by housekeeping,
 * which is the false-conflict problem the field-level concurrency check exists to avoid.
 *
 * Outside `runBatch`'s own transaction for that reason, but still through `withTenant`'s own
 * (ordinary, not serializable) transaction — the row-level-security policy `AppliedAction`
 * carries hides every row from a bare, tenant-unset connection, so an unwrapped `deleteMany`
 * would silently delete nothing, forever, rather than pruning what it names. `withTenant` does
 * not raise the isolation level, so it does not reintroduce the contention this function is
 * deliberately outside of. Nothing depends on this having happened; a run that is skipped
 * leaves rows that are ignored anyway, since every lookup names the keys it cares about.
 */
export async function pruneAppliedActions(tenantId: TenantId, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - KEY_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await withTenant(tenantId, (tx) =>
    tx.appliedAction.deleteMany({ where: { tenantId, at: { lt: cutoff } } }),
  )
  return count
}
