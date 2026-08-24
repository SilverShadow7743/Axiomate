import 'server-only'
import { prisma } from './client'
import { loadWorkspace } from './repo'
import { persistSteps } from './persist'
import { auditToRow } from './map'
import type { TenantId } from '../tenant'
import type { Actor } from '../actor'
import { runRecurrences, runWatch } from '../workspace'
import { EMPTY_OBSERVATION, describeRun, type Observation, type WatchDiff } from '../watch'

/**
 * One run of the scheduled pass, from reading the clock to writing what it decided.
 *
 * ---------------------------------------------------------------------------
 * Why the whole run is inside one transaction
 *
 * For the same reason a batch of edits is: the pass reads the workspace, decides what has
 * become true, and writes both the resulting messages *and* its own memory of what it raised.
 * Split those and two overlapping runs — a cron firing while an operator presses "run now" —
 * would each read the same memory, each decide the same issue had just gone overdue, and each
 * raise it. Serializable isolation makes the second one wait and then see the first one's work.
 *
 * The memory being written in the same transaction as the messages is the part that matters.
 * A crash between them would either re-raise everything on the next run or, worse, record that
 * it had raised things it had not.
 */

export interface ScheduledRun {
  ok: boolean
  error?: string
  summary: string
  raised: number
  /** What the recurrence rules raised this run, by rule and occurrence. */
  recurrences: { ruleId: string; name: string; occurrence: string; issueId: string }[]
  diff: WatchDiff
  misses: { ruleId: string; label: string; why: string }[]
  refusals: { action: string; error: string }[]
}

export async function runScheduledPass(tenantId: TenantId, actor: Actor): Promise<ScheduledRun> {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  return prisma.$transaction(
    async (tx) => {
      /**
       * Set before the first read, same as `persist.ts`'s `runBatch` — every table this pass
       * touches carries an RLS policy checking this against `tenantId`. See
       * `docs/plans/2026-08-24-row-level-security-design.md`.
       */
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      const { state } = await loadWorkspace(tenantId, tx)
      const stored = await tx.scheduleWatch.findUnique({ where: { tenantId } })
      /**
       * Read defensively: this is JSON from a column, and a row written before the shape
       * gained `watching` would otherwise arrive as an object with neither field and fail on
       * first use. A missing observation and an unreadable one are the same thing — no memory —
       * and both mean the next run is a first run.
       */
      const raw = stored?.observation as Partial<Observation> | null
      const previous: Observation =
        raw && Array.isArray(raw.watching) && raw.subjects
          ? { watching: raw.watching, subjects: raw.subjects }
          : EMPTY_OBSERVATION

      const run = runWatch(state, previous, today, now, actor)

      /*
       * Recurring work rides the same pass and the same transaction. It runs AFTER the watch
       * against the watch's resulting state, so a raise and the morning's notifications agree
       * about what exists. Both-or-neither: the raised issue and the advanced lastRaisedOn are
       * steps in this one Serializable transaction.
       */
      const recur = runRecurrences(run.state, today, now, actor)
      const raised = run.steps.filter((s) => s.action.t === 'notify').length
      const summaryRecur = recur.raised.length
        ? ` Raised ${recur.raised.map((r) => `“${r.name}” for ${r.occurrence}`).join(', ')}.`
        : ''
      const summary = describeRun(run.diff, raised) + summaryRecur

      for (const step of run.steps) {
        await persistSteps(tx, tenantId, step.action, step.before, step.after)
      }
      for (const step of recur.steps) {
        await persistSteps(tx, tenantId, step.action, step.before, step.after)
      }

      const newAudit = recur.state.audit.slice(state.audit.length)
      if (newAudit.length) {
        await tx.scheduleAudit.createMany({ data: newAudit.map((a) => auditToRow(tenantId, a)) })
      }
      if (recur.state.seq !== state.seq) {
        await tx.workspaceMeta.upsert({
          where: { tenantId },
          create: { tenantId, seq: recur.state.seq },
          update: { seq: recur.state.seq },
        })
      }

      /**
       * Written even when the run raised nothing.
       *
       * A quiet pass still has to move the memory forward: conditions that cleared must be
       * forgotten, or they will never be raised again when they return — which is the failure
       * that would make the whole mechanism untrustworthy in its second month rather than its
       * first.
       */
      await tx.scheduleWatch.upsert({
        where: { tenantId },
        create: {
          tenantId,
          lastRunAt: new Date(now),
          observation: run.observation as unknown as object,
          lastSummary: summary,
        },
        update: {
          lastRunAt: new Date(now),
          observation: run.observation as unknown as object,
          lastSummary: summary,
        },
      })

      return {
        ok: true,
        summary,
        raised,
        recurrences: recur.raised,
        diff: run.diff,
        misses: run.misses,
        refusals: [...run.refusals, ...recur.refusals].map((r) => ({ action: r.action.t, error: r.error })),
      }
    },
    { isolationLevel: 'Serializable', timeout: 30_000, maxWait: 10_000 },
  )
}
