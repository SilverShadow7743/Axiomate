import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

/**
 * The Prisma client, created on first use.
 *
 * Lazy on purpose. Prisma 7 requires a driver adapter with a connection string, so
 * constructing at module scope throws when `DATABASE_URL` is unset — which happens during
 * `next build`, when page data is collected without any database in the picture. Running
 * without a database is a supported mode of this app, and it must not break the build.
 *
 * Cached on `globalThis` because Next's dev server re-evaluates modules on every edit, and a
 * fresh client per reload exhausts the connection pool within a few saves.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * How many connections one instantiation of this module may hold.
 *
 * ---------------------------------------------------------------------------
 * Why this is set here, and not in the connection string
 *
 * Because the connection string cannot do it. `?connection_limit=` configures Prisma's own
 * Rust engine pool, which a driver adapter replaces, and `?max=` is not a parameter
 * node-postgres reads at all — both are silently ignored and the pool stays at its default of
 * ten. That was measured rather than assumed: a `Pool` built from a URL carrying both
 * parameters reports `max: 10`, and one built from a config object reports what the object
 * says. Infrastructure documentation that claims the cap lives in the connection string is
 * describing a setting that does nothing.
 *
 * ---------------------------------------------------------------------------
 * The number, and the arithmetic behind it
 *
 * Count twice. Next compiles this module into two separately instantiated copies — one for
 * route handlers, one for the server-rendered page — so a single Node process holds two pools,
 * and the connections it can occupy are double whatever this says. A Burstable B1ms allows
 * fifty connections and reserves fifteen, leaving thirty-five for the application. At the
 * default of eight that is sixteen per instance: two instances fit inside thirty-five with
 * room for a migration and somebody's psql session, and three do not.
 *
 * Raise it with the database, not on its own. The setting that matters is the smaller of what
 * the server allows and what the app asks for, and asking for more than the server has turns a
 * slow page into a failed one.
 */
const POOL_MAX = Number(process.env.AXIOMATE_DB_POOL_MAX) || 8

/**
 * How long a request waits for a free connection before giving up.
 *
 * Without this, node-postgres waits indefinitely: an exhausted pool produces requests that
 * hang until something upstream times out, which reads as "the app is down" rather than as
 * "the pool is full". Ten seconds is longer than any query this application makes and short
 * enough that the browser's own retry is still running when the error arrives.
 */
const CONNECT_TIMEOUT_MS = 10_000

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set, so there is no database to connect to.')
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: POOL_MAX,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      // Closes connections a quiet instance is holding open, so a small server is not kept at
      // its ceiling by an app nobody is using.
      idleTimeoutMillis: 30_000,
    }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

/** Module-scope cache for production, where modules are evaluated once per process. */
let cached: PrismaClient | undefined

function get(): PrismaClient {
  // In dev the module is re-evaluated on every edit, so the cache has to outlive it.
  if (process.env.NODE_ENV !== 'production') return (globalForPrisma.prisma ??= create())
  return (cached ??= create())
}

/**
 * A proxy rather than a function call, so callers read as `prisma.issue.findMany()` — the
 * ordinary Prisma idiom — while construction still waits until something actually asks.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get: (_target, prop, receiver) => Reflect.get(get(), prop, receiver),
})

/**
 * Whether a database is configured at all.
 *
 * The app has always run from the seed file, and it still does when no `DATABASE_URL` is set.
 * That is a supported mode, not a broken one — so this is a question the load path asks and
 * answers plainly, rather than a crash on boot.
 */
export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/** A short, honest description of why the database could not be used. */
export function describeDbError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ECONNREFUSED|Can't reach database server|connect ETIMEDOUT/i.test(msg)) {
    return 'The database is not reachable. Check that Postgres is running and DATABASE_URL is correct.'
  }
  if (/authentication failed|password/i.test(msg)) {
    return 'The database rejected the credentials in DATABASE_URL.'
  }
  if (/does not exist|P1003|relation .* does not exist/i.test(msg)) {
    return 'The database or its tables do not exist yet. Run `npm run db:push`.'
  }
  /**
   * The first line that actually says something, plus the code if there is one.
   *
   * This was `msg.split('\n')[0]`, which returns an EMPTY STRING for essentially every Prisma
   * error, because Prisma formats its messages with a leading newline before
   * "Invalid `prisma.x.y()` invocation". So the one branch that exists to explain an
   * unreachable database explained nothing: the first Azure deployment reported
   * `"error": ""` beside "Changes are not being saved", and the actual cause — a unique
   * constraint on a duplicate seed link — had to be found by running the built server locally
   * and reading its stdout.
   *
   * A diagnostic that can return empty is worse than none, because it looks like it ran.
   */
  const line = msg.split('\n').map((l) => l.trim()).find(Boolean)
  const code = (err as { code?: string })?.code
  if (!line) return code ? `The database refused the operation (${code}).` : 'The database failed without saying why.'
  return code ? `${line} (${code})` : line
}

/**
 * Whether this failure will happen again on every replay of the same batch.
 *
 * The write endpoint answers 500 for everything that throws, and the client cannot tell the
 * two kinds apart from the outside — so it treats them all as an outage and retries them for
 * the life of the tab. That produces an asymmetry sharp enough to be a bug in its own right:
 * a change the *reducer* refuses stops the queue at once, while the very same change refused
 * by the *database* is re-sent every time the tab regains focus, each attempt opening a
 * twenty-second serializable transaction, while the screen promises it will keep trying.
 *
 * The distinction is whether the outcome is a pure function of stored state and this batch.
 * A constraint violation is: the rows are what they are and the batch is what it is, so
 * waiting changes nothing. A dropped connection, an exhausted pool, a serialization abort, a
 * wrong password, a schema that has not been migrated yet — all of those can succeed later,
 * some of them only after an operator acts, which still makes waiting the right behaviour.
 *
 * Listed by code rather than by message text, because these are the ones Prisma names.
 */
const PERMANENT_CODES = new Set([
  'P2000', // value too long for the column
  'P2002', // unique constraint — the retryable one is caught upstream in persist.ts
  'P2003', // foreign key constraint
  'P2011', // null constraint
  'P2025', // a record the write depended on is not there
])

export function isPermanentDbError(err: unknown): boolean {
  const e = err as { code?: string; name?: string; message?: string }
  if (e?.code && PERMANENT_CODES.has(e.code)) return true
  // A malformed query or argument. The batch would have to change to succeed, and it will not.
  if (e?.name === 'PrismaClientValidationError') return true
  return /value too long|invalid input syntax|22001|22P02/i.test(e?.message ?? '')
}
