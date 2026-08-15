import 'server-only'
import { initWorkspace, type WorkspaceState } from '../workspace'
import { loadSeed, type SeedFile } from '../data'
import { databaseConfigured, describeDbError } from './client'
import { importWorkspace, loadWorkspace } from './repo'
import { currentTenantId } from '../tenant'

/**
 * What the page gets on boot.
 *
 * Three outcomes, and the difference between them is visible to the user rather than
 * inferred. A tool that silently drops from "your edits are saved" to "your edits are not
 * saved" is worse than one that never offered saving.
 */
export interface Boot {
  seed: SeedFile
  /** Present when the database supplied the workspace. Null means the seed file did. */
  state: WorkspaceState | null
  /**
   * Which tenant this page is showing.
   *
   * Passed to the client because the browser mirror is per tenant too: one machine that has
   * opened two tenants must not merge their workspaces into one storage key. The client uses
   * it as an opaque namespace and never as an authority — resolution happens on the server,
   * in `currentTenantId`, and nowhere else.
   */
  tenantId: string
  persistence: {
    enabled: boolean
    /** One sentence, shown in the app, explaining exactly where changes go. */
    note: string
    /** Set when a database was configured but could not be used. */
    error?: string
  }
}

export async function boot(): Promise<Boot> {
  const seed = await loadSeed()
  // Resolved once, here, and passed down. Nothing further in the request re-derives it.
  const tenantId = currentTenantId()

  if (!databaseConfigured()) {
    return {
      seed,
      state: null,
      tenantId,
      persistence: {
        enabled: false,
        note: 'In-memory session. Set DATABASE_URL and run `npm run db:push` to save changes.',
      },
    }
  }

  try {
    // First boot against an empty database lays the log down for this tenant, so the app is
    // never staring at an empty tree the seed file could have filled. Seeding is per tenant:
    // a second firm arriving later gets its own import, not a refusal.
    const imported = await importWorkspace(tenantId, initWorkspace(seed.issues, seed.relationships))
    const { state, orphans } = await loadWorkspace(tenantId)

    const note = imported.imported
      ? `Saved to Postgres. Imported ${imported.counts.issues} issues from the log.`
      : 'Saved to Postgres.'

    return {
      seed,
      state,
      tenantId,
      persistence: {
        enabled: true,
        note: orphans.length
          ? `${note} ${orphans.length} issues have no parent and are not shown in the tree.`
          : note,
      },
    }
  } catch (err) {
    // A configured-but-unreachable database falls back to the seed file rather than failing
    // the page — but it says so, because the fallback silently loses every edit.
    return {
      seed,
      state: null,
      tenantId,
      persistence: {
        enabled: false,
        note: 'Running from the issue log. Changes are not being saved.',
        error: describeDbError(err),
      },
    }
  }
}
