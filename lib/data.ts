import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IssueRelationship } from './types'
import type { SeedIssueInput } from './workspace'

export interface SeedFile {
  meta: {
    source: string
    issueCount: number
    clients: string[]
    dateRange: { earliestRaised: string; latestActivity: string }
    provenance: {
      recordedDates: string[]
      absentFromSource: string[]
      derived: Record<string, string>
      notGenerated: string[]
    }
  }
  issues: SeedIssueInput[]
  relationships: IssueRelationship[]
}

/**
 * Load the issue log from disk.
 *
 * This is the seed, not the store. With a database configured, `lib/db/boot.ts` imports this
 * once into Postgres and the workspace is served from there afterwards; without one, it is
 * read on every request and the session stays in memory. Either way the file is the origin of
 * the imported issues and the provenance metadata the Data Source tab reports.
 *
 * No count is written down here, and none is written into `meta.source` either. One was, in both
 * places — "179 issues" — and it was true of the raw export before deduplication and wrong from
 * the first load afterwards. A number in a label is a derived value stored as fact, which is the
 * rule this schema follows everywhere except, until now, inside a string.
 */
export async function loadSeed(): Promise<SeedFile> {
  const raw = await readFile(join(process.cwd(), 'data', 'issues.seed.json'), 'utf8')
  const seed = JSON.parse(raw) as SeedFile
  const internal = await loadInternal()
  if (!internal.length) return seed

  /*
   * Both halves move together. This used to add the internal issues to `issueCount` and leave
   * `source` naming the client log alone, so the Data Source tab reported a figure that counted
   * two logs beside a label that named one — and the extra issues looked like they had come from
   * the client.
   */
  return {
    ...seed,
    meta: {
      ...seed.meta,
      issueCount: seed.meta.issueCount + internal.length,
      source: `${seed.meta.source} and the Axiomate build log`,
    },
    issues: [...seed.issues, ...internal],
  }
}

/**
 * Axiocloud's own delivery of Axiomate, logged in Axiomate.
 *
 * A separate file rather than rows in the client log, because it is a different body of work
 * with a different origin — and because keeping it separate makes it obvious that the client
 * issue counts elsewhere in the app are the client's, not inflated by internal work.
 *
 * Missing or unreadable is not an error: the internal project is additive, and the client log
 * has to load whether or not it is there.
 */
async function loadInternal(): Promise<SeedIssueInput[]> {
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'axiomate.internal.json'), 'utf8')
    const parsed = JSON.parse(raw) as { issues?: SeedIssueInput[] }
    return Array.isArray(parsed.issues) ? parsed.issues : []
  } catch {
    return []
  }
}
