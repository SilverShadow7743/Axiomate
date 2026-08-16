import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError, prisma } from '@/lib/db/client'

/**
 * What App Service asks this instance before sending it traffic.
 *
 * ---------------------------------------------------------------------------
 * What a health check is actually deciding
 *
 * App Service pings this path on every instance once a minute and reads one thing: the status
 * code. Ten consecutive replies outside 200–299 and the instance leaves the load balancer; an
 * hour of them and the instance is replaced. So the question this file answers is not "is the
 * application well" — it is "should this instance be given the next user's request". Those are
 * different questions and only the second one has an action attached.
 *
 * ---------------------------------------------------------------------------
 * The choice, and the two alternatives rejected
 *
 * **Liveness only** — return 200 and nothing else. Rejected. This application's entire value is
 * that a change made in the browser is still there tomorrow, and the process stays perfectly
 * alive while that stops being true: `DATABASE_URL` pointing at a database that has moved,
 * failed over, or run out of connections leaves Next serving pages, the reducer running, and
 * every write returning 500. A liveness check keeps that instance in rotation and reports
 * green while the queue in each browser retries four times and halts. A check that cannot fail
 * is not a check.
 *
 * **A full dependency check on every ping** — open the workspace, count rows, confirm the
 * tenant. Rejected, and not only for the load. Turning a probe into real work means the probe
 * itself is a way to take the application down: the path is anonymous, App Service cannot hold
 * a credential, so anyone who finds it can make every instance query the database as fast as
 * they can send requests. Beyond that, a probe that reads the workspace is slower than the
 * timeout it needs, so an ordinarily slow minute on the database reads as a fleet of broken
 * instances.
 *
 * **Chosen: a cheap, cached, timeout-bounded reachability probe.** `SELECT 1`, at most once
 * every ten seconds per instance, abandoned after two seconds. That is enough to separate the
 * two states an operator can act on — this instance can reach its database, or it cannot —
 * while making the endpoint's cost to serve independent of how often it is called.
 *
 * The cache is what makes the anonymity safe. A thousand requests a second produce at most six
 * queries a minute, which is the same load as the platform's own ping, so there is no rate at
 * which polling this endpoint is a way to attack the database.
 *
 * ---------------------------------------------------------------------------
 * No grace window here, deliberately
 *
 * The obvious next step is to forgive the first failure or two before reporting unhealthy. It
 * is not taken, because App Service already implements exactly that: ten consecutive failed
 * pings by default, tunable down to two with `WEBSITE_HEALTHCHECK_MAXPINGFAILURES`. Two
 * independent tolerance windows multiply into an eviction delay nobody can predict from either
 * one, and the platform's is the knob an operator can change without a deployment. This file
 * reports what it observed; how many observations constitute a verdict is configuration.
 *
 * The same reasoning covers the case that would otherwise argue for a grace window — the whole
 * fleet failing together because the database, not the instances, is what broke. App Service
 * will not remove more than half the instances from rotation
 * (`WEBSITE_HEALTHCHECK_MAXUNHEALTHYWORKERPERCENT`, default 50), and removes none when they are
 * all unhealthy. A shared outage therefore cannot empty the load balancer. What it can still do
 * is trigger instance replacement after an hour of unhealthy pings, which will not repair a
 * database. That is a known and accepted cost of reporting honestly: at most one instance an
 * hour and three a day, and this application boots without a database, so a replaced instance
 * still starts and still serves.
 *
 * ---------------------------------------------------------------------------
 * Why a missing database is healthy
 *
 * Running with no `DATABASE_URL` is a supported mode, not a fault — `databaseConfigured()`
 * exists precisely so the load path can ask rather than crash, and the application runs from
 * the seed file and says so on screen. Reporting that as unhealthy would ask App Service to
 * evict instances that are behaving exactly as designed.
 *
 * It is nonetheless the most dangerous state this deployment can be in, because a hosted
 * instance that has lost its `DATABASE_URL` app setting looks completely well while every
 * person's afternoon goes into their own browser and nowhere else. So it is reported as its own
 * value rather than folded into "connected", and `docs/observability.md` alerts on it. The
 * distinction the code refuses to make — supported mode versus misconfiguration — is one only
 * the deployment knows, and the alert is where that knowledge lives.
 *
 * ---------------------------------------------------------------------------
 * What it will not notice
 *
 * Stated rather than implied, because an unstated gap gets mistaken for coverage:
 *
 *   Schema drift. `SELECT 1` succeeds against a database whose tables were never created. That
 *   is left uncaught on purpose: catching it means naming a table here, and a probe that names
 *   a table goes stale silently the next time the schema moves. It is also a deploy-time fault
 *   that is identical on every instance, so evicting instances could not help — the answer is
 *   `npm run db:migrate`, and the signal is the boot path already saying "changes are not being
 *   saved".
 *
 *   Correctness of any kind. A build whose reducer rejects every action, whose permission check
 *   refuses everyone, or which resolves the wrong tenant passes this check with room to spare.
 *   Reachability is not agreement.
 *
 *   Everything downstream of the request. A halted browser write queue, a scheduled pass that
 *   stopped firing, an intake connector whose token was rotated — none of them are instance
 *   health, and none of them are fixed by taking an instance out of rotation. They are the
 *   subject of the operational signals in `docs/observability.md`, which is a different job
 *   done with different tools.
 *
 * ---------------------------------------------------------------------------
 * What it will not say
 *
 * Every other route in this application answers failures with `describeDbError`, which is right
 * when the caller is a signed-in operator and wrong here: the health path has to allow
 * anonymous access, because App Service's ping carries no credential of ours. So the body is a
 * closed vocabulary of three values with nothing interpolated into it — no host, no connection
 * string, no configuration, no error text, no stack.
 *
 * The detail is not discarded, it is redirected: the sanitised description goes to the log
 * stream, where it reaches Application Insights and an operator with access to the workspace,
 * rather than to whoever sent the request. Three values are enough to act on because each maps
 * to exactly one action — nothing, restore the app setting, or go and look at the database —
 * and choosing between those does not require knowing why.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Shorter than the platform's one-minute ping, so the answer the platform reads is effectively
 * live, while an unauthenticated caller polling in a loop still costs at most six queries a
 * minute.
 */
const PROBE_TTL_MS = 10_000

/**
 * A probe that outlives this has already answered the question. Kept well inside the ping
 * interval so a slow database cannot leave probes overlapping and accumulating.
 */
const PROBE_TIMEOUT_MS = 2_000

/** The closed vocabulary. Nothing else is ever put in the response. */
type DatabaseState = 'connected' | 'not configured' | 'unreachable'

/**
 * Per instance, and per process. Module scope rather than `globalThis` because losing it on a
 * dev reload costs one extra `SELECT 1` — unlike the Prisma client, whose loss costs a
 * connection from the pool, which is why that one is cached differently.
 */
let cached: { at: number; state: DatabaseState } | undefined

/**
 * The race does not cancel the query — the connection stays busy until Postgres answers. That
 * is survivable only because the query is trivial and the pool reclaims it, and it is the
 * reason the probe must stay `SELECT 1` rather than growing into something that reads rows.
 */
async function probeDatabase(): Promise<DatabaseState> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The database did not answer in time.')), PROBE_TIMEOUT_MS)
      }),
    ])
    return 'connected'
  } catch (err) {
    /**
     * The one place the reason is allowed to exist. It goes to the log stream, which is
     * access-controlled, and never into the response, which is not.
     *
     * The code is logged beside the description rather than the description alone, because the
     * description can be empty. `describeDbError` recognises three faults worth a sentence and
     * otherwise returns the error's first line — and a Prisma error message *begins* with a
     * newline, so for anything it does not recognise that fallback is the empty string. A log
     * line with nothing after the colon is the one outcome this log line exists to prevent, and
     * an unrecognised fault is precisely when somebody most needs it to say something.
     *
     * Compensated for here rather than by changing the sanitiser, which is shared with routes
     * that return it to a caller. A blank string is a poor log line and a reasonable thing to
     * hand an API client, so the two callers want different repairs and only one of them is
     * this file's to make.
     */
    const detail = err as { code?: string; name?: string }
    const reason = describeDbError(err) || detail.name || 'Unrecognised failure.'
    console.error(`[health] The database probe failed: ${reason} [${detail.code ?? 'no code'}]`)
    return 'unreachable'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function currentState(now: number): Promise<{ state: DatabaseState; checkedAt: number }> {
  // Asked before anything else and answered without I/O: a deployment with no database has no
  // database to probe, and probing would construct a client only to have it throw.
  if (!databaseConfigured()) return { state: 'not configured', checkedAt: now }

  if (cached && now - cached.at < PROBE_TTL_MS) {
    return { state: cached.state, checkedAt: cached.at }
  }

  const state = await probeDatabase()
  cached = { at: now, state }
  return { state, checkedAt: now }
}

export async function GET() {
  const now = Date.now()
  const { state, checkedAt } = await currentState(now)
  const healthy = state !== 'unreachable'

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'unhealthy',
      database: state,
      /**
       * The moment the verdict was reached, which is up to `PROBE_TTL_MS` before now. Reported
       * so a person reading this by hand can tell a fresh answer from a cached one instead of
       * assuming every response is a fresh probe.
       */
      checkedAt: new Date(checkedAt).toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      // Nothing between the instance and the prober may answer on its behalf. A cached 200 from
      // a proxy is a health check that reports on the proxy.
      headers: { 'cache-control': 'no-store' },
    },
  )
}
