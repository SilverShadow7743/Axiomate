import 'server-only'
import { prisma, withTenant } from './client'
import { loadWorkspace } from './repo'
import { persistSteps } from './persist'
import { auditToRow } from './map'
import type { TenantId } from '../tenant'
import type { Actor } from '../actor'
import { runRecurrences, runWatch, type WorkspaceState } from '../workspace'
import { EMPTY_OBSERVATION, describeRun, type Observation, type WatchDiff } from '../watch'
import { buildTree } from '../tree'
import { buildDailyIms } from '../reports/dailyIms'
import { buildWeeklyClientPack, buildMonthlyGovernancePack } from '../reports/clientPack'
import { renderImsPdf, renderWeeklyPackPdf, renderMonthlyPackPdf } from '../reports/pdf'
import { deliveryDue, parseReportDelivery, type DeliveryStamps } from '../reports/delivery'
import { resolveOperatorAddress } from '../reports/notifyBundle'
import { externalPartyKinds, tiersOf } from '../config'
import { sendAsMailbox } from '../mail'
import { addDays } from '../dates'
import { weekLabel } from '../timesheet'

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
  /** What report delivery did this run — the pass's honesty pattern extended to the mail. */
  delivery: { sent: string[]; refused: { what: string; status: number; detail: string }[] }
}

export async function runScheduledPass(tenantId: TenantId, actor: Actor): Promise<ScheduledRun> {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  const inner = await prisma.$transaction(
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
      const raw = stored?.observation as (Partial<Observation> & { delivery?: DeliveryStamps }) | null
      const previous: Observation =
        raw && Array.isArray(raw.watching) && raw.subjects
          ? { watching: raw.watching, subjects: raw.subjects }
          : EMPTY_OBSERVATION
      /** Report-delivery stamps ride the same memory. Read defensively like the rest of it. */
      const stamps: DeliveryStamps =
        raw?.delivery && typeof raw.delivery === 'object' ? { ...raw.delivery } : {}

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
      /*
       * Delivery stamps must be CARRIED through this write, not re-added later: `runWatch`
       * builds its observation fresh, so writing it bare would erase the stamps on every run
       * where nothing was due — and the next manual trigger that day would send again. A
       * workspace that has never sent carries no `delivery` key at all, keeping this write
       * byte-identical to what it always was.
       */
      const observation = Object.keys(stamps).length
        ? ({ ...run.observation, delivery: stamps } as unknown as object)
        : (run.observation as unknown as object)
      await tx.scheduleWatch.upsert({
        where: { tenantId },
        create: { tenantId, lastRunAt: new Date(now), observation, lastSummary: summary },
        update: { lastRunAt: new Date(now), observation, lastSummary: summary },
      })

      return {
        summary,
        raised,
        recurrences: recur.raised,
        diff: run.diff,
        misses: run.misses,
        refusals: [...run.refusals, ...recur.refusals].map((r) => ({ action: r.action.t, error: r.error })),
        state: recur.state,
        observation: run.observation,
        stamps,
      }
    },
    { isolationLevel: 'Serializable', timeout: 30_000, maxWait: 10_000 },
  )

  /*
   * Report delivery runs AFTER the transaction commits — Graph HTTP inside a Serializable
   * transaction would hold locks through network I/O and race its 30s timeout. The cost,
   * stated: two concurrent MANUAL triggers can both pass the due-check and double-send (the
   * daily Logic App alone cannot); a duplicate email to the operator is accepted over ever
   * blocking the watch on the network. Stamps advance only after every send of a kind
   * succeeded, so a refused send retries on the next pass.
   */
  const delivery = await runDelivery(tenantId, inner.state, inner.observation, inner.stamps, today)

  const summary = delivery.sent.length
    ? `${inner.summary} Emailed ${delivery.sent.join(', ')}.`
    : inner.summary

  return {
    ok: true,
    summary,
    raised: inner.raised,
    recurrences: inner.recurrences,
    diff: inner.diff,
    misses: inner.misses,
    refusals: inner.refusals,
    delivery,
  }
}

/** One report kind's sends, all-or-the-stamp-stays: returns the label list and refusals. */
async function runDelivery(
  tenantId: TenantId,
  state: WorkspaceState,
  observation: Observation,
  stamps: DeliveryStamps,
  today: string,
): Promise<ScheduledRun['delivery']> {
  const sent: string[] = []
  const refused: { what: string; status: number; detail: string }[] = []
  const config = parseReportDelivery(state.model.reportDelivery)
  const due = deliveryDue(config, stamps, today)
  if (!due.ims && !due.weeklyFor && !due.monthlyFor) return { sent, refused }

  const mailbox = state.model.intake.find((m) => m.enabled)?.address
  if (!mailbox) {
    refused.push({ what: 'delivery', status: 0, detail: 'No enabled intake mailbox to send as — Configuration → Routing & intake.' })
    return { sent, refused }
  }
  const org = state.model.organization
  const next: DeliveryStamps = { ...stamps }

  if (due.ims) {
    try {
      const rows = buildTree(state, today).filter((r) => r.kind === 'issue')
      const ims = buildDailyIms(state, rows, today, 'All clients')
      const pdf = (await renderImsPdf(ims, org)).toString('base64')
      let allOk = true
      for (const to of config.imsRecipients) {
        const res = await sendAsMailbox(mailbox, to, `Daily IMS — ${today}`, 'The daily issue management status is attached.', [
          { name: `daily-ims-${today}.pdf`, contentType: 'application/pdf', contentBytes: pdf },
        ])
        if (res.ok) sent.push(`IMS to ${to}`)
        else {
          allOk = false
          refused.push({ what: `IMS to ${to}`, status: res.status, detail: res.detail })
        }
      }
      if (allOk) next.imsSentOn = today
    } catch (err) {
      refused.push({ what: 'IMS', status: 0, detail: err instanceof Error ? err.message : String(err) })
    }
  }

  if (due.weeklyFor || due.monthlyFor) {
    const dest = resolveOperatorAddress(state, config)
    if (!dest) {
      refused.push({ what: 'packs', status: 0, detail: 'No pack destination configured and the operator has no directory email.' })
    } else {
      /* Every external-party node whose pack actually SHOWS something — the boundary itself
       * (`clientView`, via the builder) decides, and a client with nothing visible gets no
       * email: an empty pack to eyeball is noise. */
      const external = externalPartyKinds(tiersOf(state.model))
      const clients = Object.values(state.nodes).filter((n) => external.has(n.kind))

      const sendPacks = async (
        kind: 'weekly' | 'monthly',
        asOf: string,
        label: string,
        stamp: () => void,
      ) => {
        let allOk = true
        let any = false
        for (const client of clients) {
          try {
            const pack =
              kind === 'weekly'
                ? buildWeeklyClientPack(state, client.id, asOf)
                : buildMonthlyGovernancePack(state, client.id, asOf)
            if (pack.disclosure.shown === 0) continue
            any = true
            const pdf = (
              kind === 'weekly'
                ? await renderWeeklyPackPdf(pack as never, org)
                : await renderMonthlyPackPdf(pack as never, org)
            ).toString('base64')
            const title = kind === 'weekly' ? 'Weekly client pack' : 'Monthly governance pack'
            const res = await sendAsMailbox(
              mailbox,
              dest,
              `${title} — ${client.name} (${label})`,
              `The ${title.toLowerCase()} for ${client.name} is attached. Review it, then forward it to the client.`,
              [
                {
                  name: `${kind}-pack-${client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${asOf}.pdf`,
                  contentType: 'application/pdf',
                  contentBytes: pdf,
                },
              ],
            )
            if (res.ok) sent.push(`${title} — ${client.name} to ${dest}`)
            else {
              allOk = false
              refused.push({ what: `${title} — ${client.name}`, status: res.status, detail: res.detail })
            }
          } catch (err) {
            allOk = false
            refused.push({ what: `${kind} pack — ${client.name}`, status: 0, detail: err instanceof Error ? err.message : String(err) })
          }
        }
        /* Nothing visible for ANY client is a complete outcome, and it must stamp — otherwise
         * a workspace with no client-visible records would re-attempt every pass forever. */
        if (allOk || !any) stamp()
      }

      if (due.weeklyFor) {
        const weeklyFor = due.weeklyFor
        await sendPacks('weekly', addDays(weeklyFor, 6), weekLabel(weeklyFor), () => {
          next.weeklySentFor = weeklyFor
        })
      }
      if (due.monthlyFor) {
        const monthlyFor = due.monthlyFor
        const [y, m] = monthlyFor.split('-').map(Number)
        const lastDay = `${monthlyFor}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
        await sendPacks('monthly', lastDay, monthlyFor, () => {
          next.monthlySentFor = monthlyFor
        })
      }
    }
  }

  if (JSON.stringify(next) !== JSON.stringify(stamps)) {
    /* The observation written moments ago in this same request, held in memory, plus the
     * advanced stamps. `withTenant` because scheduleWatch carries the RLS policy like every
     * tenant table — a bare update would be filtered to nothing. */
    await withTenant(tenantId, (tx) =>
      tx.scheduleWatch.update({
        where: { tenantId },
        data: { observation: { ...observation, delivery: next } as unknown as object },
      }),
    )
  }
  return { sent, refused }
}
