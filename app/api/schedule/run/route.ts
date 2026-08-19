import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { loadWorkspace } from '@/lib/db/repo'
import { runScheduledPass } from '@/lib/db/schedule'
import { pruneAppliedActions } from '@/lib/db/persist'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'
import { can } from '@/lib/access'
import { SCHEDULE_ACTOR } from '@/lib/actor'
import { secretValue } from '@/lib/secrets'

/**
 * The clock.
 *
 * ---------------------------------------------------------------------------
 * Why an endpoint rather than a timer inside the process
 *
 * A `setInterval` in a web server is a scheduler that stops when the process restarts, runs
 * twice when there are two instances, and cannot be triggered by hand when somebody wants to
 * know what it would say. An endpoint is none of those. Whatever the firm already uses to run
 * things on a schedule — Task Scheduler, cron, a GitHub Action, an Azure timer — calls this,
 * and the same URL is what an operator hits to see a run before trusting it to happen at seven
 * in the morning.
 *
 * ---------------------------------------------------------------------------
 * Two ways in, and both are checks
 *
 * A shared secret, for the scheduler, which has no session. Or a signed-in person holding
 * `config.manage`, for the operator. With neither, it refuses: a URL that changes a workspace
 * and sends people messages does not run open.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Read through the guard: an unresolved vault reference would otherwise be the accepted token.
const TOKEN = secretValue('AXIOMATE_SCHEDULE_TOKEN')

export async function POST(req: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'No database is configured. The pass reads stored state and remembers what it already raised, and it can do neither against a browser mirror.',
      },
      { status: 503 },
    )
  }

  const byToken = Boolean(TOKEN) && (req.headers.get('authorization') ?? '') === `Bearer ${TOKEN}`
  const session = getSession(req)

  /**
   * Who may run it, and the one case that would otherwise be locked out of its own product.
   *
   * A deployment with no identity provider has one operator and no way for them to prove it —
   * so requiring a verified session would mean the *only* person who could run the pass by hand
   * is one who cannot exist. That is the same reasoning that ships the fallback role as
   * Administrator, and it is the same posture the write endpoint already takes: without a
   * provider, this deployment trusts whoever reaches it, and every screen says so.
   *
   * The moment a provider is configured that stops being true here as everywhere else.
   */
  const openDeployment = !identityEstablished()
  if (!byToken && !openDeployment && !session.verified) {
    return NextResponse.json(
      {
        ok: false,
        error: TOKEN
          ? 'Send the schedule token, or sign in as somebody who may configure the platform.'
          : 'Sign in as somebody who may configure the platform, or send the schedule token.',
      },
      { status: 401 },
    )
  }

  try {
    const tenantId = currentTenantId()

    if (!byToken && !openDeployment) {
      /**
       * The grant is checked against the loaded model, not guessed at before it exists.
       *
       * It costs a read that the run then repeats inside its own transaction, and that is the
       * right trade: the alternative is a permission decision made against a stand-in model,
       * which is a check that looks like one and is not.
       */
      const { state } = await loadWorkspace(tenantId)
      const verdict = can(state.model, session.actor, 'config.manage')
      if (!verdict.allowed) {
        return NextResponse.json({ ok: false, error: verdict.reason }, { status: 403 })
      }
    }

    /**
     * The pass runs as a machine, never as the person who pressed the button.
     *
     * An operator asking what the clock would say has not made the observation the clock makes,
     * and attributing a week of overdue notices to them would put their name on something they
     * did not decide.
     */
    const run = await runScheduledPass(tenantId, SCHEDULE_ACTOR)

    /**
     * Housekeeping, once a day, by the one caller that already runs on a schedule.
     *
     * Idempotency keys are only useful for as long as a redelivery is possible, which is
     * seconds — but the rows outlive that by a month so an operator can still answer "did that
     * batch land?" by hand. Something has to forget them, and the write path is the wrong
     * place: deleting expired rows inside every batch would put concurrent writers in
     * contention over the same old rows for no reason anyone asked for.
     *
     * After the pass, and outside its transaction. Nothing depends on it having happened, so a
     * failure here must not lose a run that already did its work.
     */
    let forgotten = 0
    try {
      forgotten = await pruneAppliedActions(tenantId, new Date())
    } catch {
      /* Reported below as zero. A pass that could not tidy up still ran. */
    }

    return NextResponse.json({
      ok: true,
      forgottenActionKeys: forgotten,
      summary: run.summary,
      raised: run.raised,
      // What the recurrence rules raised, by rule, occurrence and issue id.
      recurrences: run.recurrences,
      onset: run.diff.onset,
      continuing: run.diff.continuing,
      cleared: run.diff.cleared.length,
      // Reported rather than swallowed: a rule that reached nobody is indistinguishable from
      // one that worked unless somebody says so.
      misses: run.misses,
      refusals: run.refusals,
    })
  } catch (err) {
    return NextResponse.json({ ok: false, error: describeDbError(err) }, { status: 500 })
  }
}
