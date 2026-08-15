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
 * the 179 issues and the provenance metadata the Data Source tab reports.
 */
export async function loadSeed(): Promise<SeedFile> {
  const raw = await readFile(join(process.cwd(), 'data', 'issues.seed.json'), 'utf8')
  const seed = JSON.parse(raw) as SeedFile
  const internal = await loadInternal()
  if (!internal.length) return seed

  return {
    ...seed,
    meta: { ...seed.meta, issueCount: seed.meta.issueCount + internal.length },
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
