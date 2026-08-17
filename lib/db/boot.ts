import { can } from '../access'
import type { OperatingModel } from '../config'
import 'server-only'
import { initWorkspace, type WorkspaceState } from '../workspace'
import { loadSeed, type SeedFile } from '../data'
import { databaseConfigured, describeDbError } from './client'
import { importWorkspace, loadWorkspace } from './repo'
import { currentTenantId } from '../tenant'
import { getSessionFromCookies, identityEstablished } from '../principal'
import type { Actor } from '../actor'

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
  /**
   * Who the server will attribute this session's changes to.
   *
   * Passed to the client so its optimistic audit entries carry the same name the server
   * will write. It is a preview, not an authority: the value that reaches the database is
   * whatever `currentActor()` returns on the server for that request, and the client has no
   * field to override it with.
   */
  actor: Actor
  /** A provider is configured and nobody has signed in. */
  signInRequired: boolean
  /** The actor proved who they are. False on a deployment with no provider — which is a
   * different thing from being signed out, and the two must not be collapsed. */
  verified: boolean
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
  /**
   * Resolved through the boundary rather than the resolver, so a page render and a write
   * request agree about who is here. The page has no `Request` to hand — a server component
   * reads cookies through Next's own API — so this is the unverified answer on a deployment
   * with a provider, and the client uses `signInRequired` to say so rather than acting.
   */
  const session = await getSessionFromCookies()
  const actor = session.actor

  /**
   * Nobody has signed in, on a deployment that has a provider: return nothing to look at.
   *
   * This is the read half of the gate, and it was missing. Refusing unverified writes at the
   * endpoint felt like the answer and was half of one — a page render loads the whole workspace
   * and ships it to the browser, so an anonymous visitor to a fully configured deployment was
   * served every client, issue, note, time entry and contracted value in the initial payload.
   * The session decided one thing: whether to show a Sign in button.
   *
   * The seed is emptied alongside the state, and that is not belt-and-braces. The seed file
   * *is* the client log; returning it because the database was skipped would leak the same
   * data by the other route.
   */
  if (identityEstablished() && !session.verified) {
    return {
      /**
       * `meta` is emptied alongside the issues, and it was not.
       *
       * The gate withheld the records and shipped the summary of them: `clients` naming every
       * firm in the log, `issueCount`, the source description and the date range — to anyone
       * who loaded the page. That is a smaller disclosure than the issues themselves and it is
       * the same kind, and it is worse for being invisible: the screen correctly said "Sign in
       * to see this workspace" while the payload underneath it answered how many issues there
       * are, for whom, and since when.
       *
       * Found by reading what an anonymous request actually returns rather than by trusting
       * that emptying the two obvious collections was the whole job.
       */
      seed: {
        ...seed,
        issues: [],
        relationships: [],
        meta: {
          source: '',
          issueCount: 0,
          clients: [],
          dateRange: { earliestRaised: '', latestActivity: '' },
          provenance: { recordedDates: [], absentFromSource: [], derived: {}, notGenerated: [] },
        },
      },
      state: null,
      tenantId,
      actor,
      signInRequired: true,
      verified: false,
      persistence: {
        enabled: false,
        note: 'Sign in to see this workspace.',
      },
    }
  }

  if (!databaseConfigured()) {
    return {
      seed,
      state: null,
      tenantId,
      actor,
      signInRequired: identityEstablished() && !session.verified,
      verified: session.verified,
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
      /*
       * Rates are removed from the payload for anybody without `rate.view`.
       *
       * WITHHELD, not hidden. `state` is serialised into the page and reaches the browser, so a
       * screen that merely declines to render a rate still ships it — and this file already
       * learned that lesson once: the sign-in gate withheld the issues and shipped the summary
       * of them, and the comment above records that emptying the two obvious collections was not
       * the whole job.
       *
       * So this is the same job done deliberately rather than by omission. The reducer still
       * holds every rate, because it is the single mutation funnel and it needs the whole
       * timeline to refuse an overlapping period; what changes is what leaves the server.
       */
      state: state && canSeeRates(state.model, actor) ? state : state && { ...state, rates: {} },
      tenantId,
      actor,
      signInRequired: identityEstablished() && !session.verified,
      verified: session.verified,
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
      actor,
      signInRequired: identityEstablished() && !session.verified,
      verified: session.verified,
      persistence: {
        enabled: false,
        note: 'Running from the issue log. Changes are not being saved.',
        error: describeDbError(err),
      },
    }
  }
}

/**
 * Whether this actor may be sent rates at all.
 *
 * A function rather than an inline `can(...)` because the same question has to be asked wherever
 * a rate-derived figure is computed — cost, revenue, margin — and one of those getting it wrong
 * is how the grant is routed around by something that never mentions a rate.
 */
function canSeeRates(model: OperatingModel, actor: Actor): boolean {
  return can(model, actor, 'rate.view').allowed
}
