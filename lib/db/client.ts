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

function create(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set, so there is no database to connect to.')
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
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
  return msg.split('\n')[0]
}
