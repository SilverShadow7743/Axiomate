import { can, directoryPersonFor, isExempt } from '../access'
import { clientView } from '../clientBoundary'
import { redactLeaveReasons } from '../availability'
import { memberProjectIdsFor, projectView } from '../projectBoundary'
import { personalEventsFor } from '../personalEvents'
import { redactPersonSkill } from '../skills'
import 'server-only'
import { initWorkspace, type WorkspaceState } from '../workspace'
import { loadSeed, type SeedFile } from '../data'
import { databaseConfigured, describeDbError, withTenant } from './client'
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
  /**
   * Which engine the Assistant panel will answer with, decided once here by whether
   * `ANTHROPIC_API_KEY` is set — the same fact the chat route re-derives per turn to pick an
   * engine, surfaced ahead of time so the panel can say which one is live before anybody has
   * typed a question, rather than only after a reply names it.
   */
  assistant: { engine: 'claude' | 'offline' }
  /**
   * When the scheduled pass last ran, and what it said — a stored fact from `scheduleWatch`,
   * written on every run. Null when it has never run (or nothing is stored), which is exactly
   * what the configuration screens must be able to say out loud: a recurrence rule marked
   * "firing" with no run behind it is a promise, not a report.
   */
  pass: { lastRunAt: string | null; lastSummary: string | null }
}

export async function boot(): Promise<Boot> {
  const seed = await loadSeed()
  // Resolved once, here, and passed down. Nothing further in the request re-derives it.
  const tenantId = currentTenantId()
  const assistant: Boot['assistant'] = {
    engine: process.env.ANTHROPIC_API_KEY ? 'claude' : 'offline',
  }
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
      assistant,
      pass: { lastRunAt: null, lastSummary: null },
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
      assistant,
      pass: { lastRunAt: null, lastSummary: null },
    }
  }

  try {
    // First boot against an empty database lays the log down for this tenant, so the app is
    // never staring at an empty tree the seed file could have filled. Seeding is per tenant:
    // a second firm arriving later gets its own import, not a refusal.
    const imported = await importWorkspace(tenantId, initWorkspace(seed.issues, seed.relationships))
    const { state, orphans } = await loadWorkspace(tenantId)
    // What the scheduled pass last did, so the screens report a run rather than promise one.
    //
    // Through `withTenant`, not a bare read — a bare call sees nothing once RLS is live, and
    // this exact banner (`pass.lastRunAt`/`lastSummary`) would silently read as "never run" on
    // every page load of a tenant whose pass runs daily. See
    // `docs/plans/2026-08-24-row-level-security-plan.md`.
    const watch = await withTenant(tenantId, (tx) => tx.scheduleWatch.findUnique({ where: { tenantId } }))
    const pass = {
      lastRunAt: watch?.lastRunAt ? watch.lastRunAt.toISOString() : null,
      lastSummary: watch?.lastSummary ?? null,
    }

    const noteBase = imported.imported
      ? `Saved to Postgres. Imported ${imported.counts.issues} issues from the log.`
      : 'Saved to Postgres.'
    /*
     * The one distinction the payload deliberately cannot carry: an emptied client view is
     * either a seat nobody attached to a client, or a sign-in matching no directory entry.
     * Both get nothing; the banner says which, because a blank workspace with no sentence
     * is a support ticket.
     */
    const reader = state ? directoryPersonFor(state.model, actor) : null
    const clientRoles = ['ROLE_CLIENT_SPONSOR', 'ROLE_CLIENT_LEAD', 'ROLE_CLIENT_USER']
    /*
     * A fourth reason the view can be narrower than "everything", alongside the three above.
     * Deliberately worded as "work inside a project", not "nothing" — someone staffed on zero
     * projects still sees whatever is organised OUTSIDE one, per `projectView`'s ungated
     * default, and a banner claiming they see nothing would be wrong the moment they open the
     * tree.
     */
    const unstaffed =
      state &&
      can(state.model, actor, 'internal.view').allowed &&
      !isExempt(state.model, actor) &&
      reader &&
      memberProjectIdsFor(state, reader.id).size === 0
        ? ' You aren’t staffed on any project yet, so project work is not shown — ask your project manager to add you.'
        : ''
    const scopeNote =
      state && !can(state.model, actor, 'internal.view').allowed
        ? reader
          ? reader.roleIds.some((r) => clientRoles.includes(r)) && !reader.clientScopeId
            ? ' Your seat holds a client role but is not attached to a client yet — ask the firm to set it on your directory entry.'
            : ''
          : ' This sign-in matches no directory entry, so there is nothing to show — ask the firm to add you.'
        : unstaffed
    const note = noteBase + scopeNote

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
      state: state && slimAuditForTransfer(redactForReader(state, actor)),
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
      assistant,
      pass,
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
      assistant,
      pass: { lastRunAt: null, lastSummary: null },
    }
  }
}

/**
 * Everything removed from the workspace before it is serialised into the page.
 *
 * One function, called once, so that "what does this reader actually receive" has a single
 * answer somebody can read in full. The two redactions here are deliberately different shapes,
 * and the difference is the interesting part:
 *
 *   - **Rates go out whole or not at all.** There is no half of a pay rate that is safe to
 *     publish, so an actor without `rate.view` gets an empty map.
 *   - **Skills go out with their judgement fields stripped.** A skill row holds a directory fact
 *     — this person has done this, and last did it in March — and a judgement about a named
 *     colleague. Emptying the collection would throw away the first to protect the second, and
 *     the first is the reason anybody wants a skills directory.
 *
 * Withheld, not hidden, in both cases. `state` is serialised into the page and reaches the
 * browser, so a screen that merely declines to render a figure still ships it — and this file
 * already learned that once: the sign-in gate withheld the issues and shipped the summary of
 * them, and the comment above records that emptying the two obvious collections was not the
 * whole job.
 *
 * The reducer still holds everything, on the server, because it is the single mutation funnel
 * and it needs the full set to refuse an overlapping rate period or a duplicate skill row.
 */
/**
 * The trail's text, truncated IN TRANSIT and never at rest — see
 * `docs/plans/2026-08-31-boot-slimming-design.md`.
 *
 * An audit row's `from` is often the only surviving copy of what a field said before an
 * edit, so Postgres keeps full fidelity forever and only this payload trims: measured live,
 * `description` rows carrying imported email bodies were 1.6 MB of a 3 MB boot (one row was
 * 143 KB). Every server-side reader uses `loadWorkspace` and never sees this; the packs and
 * the IMS read fields and short values, not bodies; the one reader affected is the human
 * History tab, which shows the marker on exactly the rows nobody scrolls a 143 KB diff of.
 */
const AUDIT_TEXT_CAP = 400
const AUDIT_TRUNCATION_MARK = '… [shortened for transfer — the full text is kept in the record’s history]'

function slimAuditForTransfer(state: WorkspaceState): WorkspaceState {
  const trim = (s: string | null): string | null =>
    s && s.length > AUDIT_TEXT_CAP ? s.slice(0, AUDIT_TEXT_CAP) + AUDIT_TRUNCATION_MARK : s
  let touched = false
  const audit = state.audit.map((a) => {
    const from = trim(a.from)
    const to = trim(a.to)
    if (from === a.from && to === a.to) return a
    touched = true
    return { ...a, from, to }
  })
  return touched ? { ...state, audit } : state
}

function redactForReader(state: WorkspaceState, actor: Actor): WorkspaceState {
  const rates = can(state.model, actor, 'rate.view').allowed ? state.rates : {}

  /*
   * Your own rows are never withheld from you, whatever you hold. Being told that your recorded
   * level is a thing you may not see would be a worse product than not recording it — and the
   * person best placed to notice that an assessment is wrong is its subject.
   */
  const mine = directoryPersonFor(state.model, actor)?.id ?? null
  const personSkills = can(state.model, actor, 'skill.view').allowed
    ? state.personSkills
    : Object.fromEntries(
        Object.entries(state.personSkills).map(([id, p]) => [id, redactPersonSkill(p, mine)]),
      )

  /*
   * The locator, unconditionally. There is no reader who needs it — downloads go through
   * `GET /api/documents/[id]`, which authorises the request when it is made — so this is an
   * absolute rule rather than a grant-dependent one.
   *
   * Absolute on purpose. The two redactions above each depend on a permission, which means each
   * has a path where the data legitimately travels, and each of those paths is somewhere a
   * future change can go wrong. A rule with no exceptions is one nobody has to re-derive when
   * they add the fourth collection to this function — and this codebase has now been caught by
   * the payload-leak class three times.
   */
  const documents = Object.fromEntries(
    Object.entries(state.documents).map(([id, d]) => [id, { ...d, locator: null }]),
  )

  /*
   * Absolute, like the locator above — but stronger still: the locator rule has no exception
   * ANYONE can reach through a permission; this one has no exception even ADMIN can reach.
   * Applied here, before the `internal.view` branch below, on purpose — `isExempt` (used by
   * the project boundary two lines down) is exactly the function that would make this
   * conditional if it were reached for out of habit, and doing so here would be a worse
   * failure than any payload leak this codebase has found before: every other redaction this
   * app has ever gotten wrong had SOME audience who was supposed to see the data under
   * different conditions. A personal-event leak has no such story.
   */
  const personalEvents = personalEventsFor(state.personalEvents, mine)

  /*
   * Leave reasons — the rates posture, applied to the other thing people are sensitive about.
   * Every internal reader keeps the DATES, hours and status, because availability is the
   * point of the record; the private `reason` survives only for `leave.approve` holders (the
   * people who decide on it) and for the row's own subject. Withheld where the payload is
   * built, never merely hidden on screen. Non-Leave kinds carry no reason to withhold.
   */
  const commitments = redactLeaveReasons(
    state.commitments,
    can(state.model, actor, 'leave.approve').allowed,
    mine,
  )

  /*
   * The rates posture again — every internal reader keeps the planned DATES (`entries`), the
   * point of a snapshot even to someone who may not see money; `cost` survives only for
   * `rate.view` holders. Redacting here rather than trusting the frozen-at-capture null alone:
   * a snapshot taken by someone who held `rate.view` at the time still carries a real `cost`
   * in storage, and a later reader without that grant must not see it just because an earlier
   * one did.
   */
  const mayViewCost = can(state.model, actor, 'rate.view').allowed
  const snapshots = mayViewCost
    ? state.snapshots
    : Object.fromEntries(
        Object.entries(state.snapshots).map(([id, s]) => [id, { ...s, cost: null }]),
      )

  const base = { ...state, rates, personSkills, documents, personalEvents, commitments, snapshots }

  /*
   * The client boundary — the same posture as the rate redaction above, applied to content.
   *
   * Keys on the VERDICT, never on role identity: a reader whose roles do not resolve
   * `internal.view` to allowed gets the withheld view, whoever they are. That is the
   * fail-safe — a workspace that has not yet granted the new key shows internal users a
   * boundary-limited view until the grant lands (loud, never leaky), while ADMIN's ALL
   * covers the operator from the first deploy.
   *
   * What survives: records, notes and documents a person marked client-visible, the
   * ANCESTOR CHAIN of surviving records (a record without its place is unreadable) and
   * nothing else of the tree, activities/links between surviving records, and audit entries
   * about them — dropped whole otherwise, never redacted within. Everything commercial and
   * everything about people is withheld wholesale regardless of flags: record visibility is
   * about content, not about the machinery. Counts recompute downstream from this subset,
   * which is the sign-in gate's lesson — withholding the records and shipping the summary
   * of them is the same disclosure.
   */
  if (can(state.model, actor, 'internal.view').allowed) {
    /*
     * The project boundary — a second narrowing INSIDE `internal.view`, on a different axis
     * from the client boundary below. `isExempt` covers ADMIN and the machine actor, who see
     * everything, the same reasoning `defaultRoleIds` ships as Administrator: an operator is
     * never locked out of their own deployment by a staffing gap.
     *
     * What survives for a non-exempt internal reader: every record with no `'project'`
     * ancestor at all (unchanged — see `projectView`'s own comment on why this is the
     * deliberate default), plus every record under a project they are a live member of.
     * Someone staffed on zero projects still sees everything organised OUTSIDE a project —
     * that is `projectView`'s ungated default holding, not a special case for this reader.
     */
    return isExempt(state.model, actor) ? base : projectView(base, memberProjectIdsFor(state, mine))
  }
  /*
   * The reader's own client, from their directory entry — null (no entry, or a client
   * seat nobody has attached yet) EMPTIES the view rather than widening it to every
   * client's marked content. The banner in boot() says which case it was.
   */
  return clientView(base, mine ? state.model.people[mine]?.clientScopeId ?? null : null)
}
