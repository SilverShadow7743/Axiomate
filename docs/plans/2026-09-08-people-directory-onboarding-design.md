# A people directory, join/exit dates, and onboarding

**Status: built, 8 September 2026.** User's direct request — *"All user profile can be checked at
one place, when did which member joined the org and when he is exiting. Onboarding will help in
identifying the user major details."*

## Build summary

- `lib/config.ts` — `Person` gained `joinedOn?: string`, `status?: 'Active' | 'Departed'`,
  `departedOn?: string`, documented against `deletePerson`'s non-retiring posture.
- `lib/workspace.ts` — `upsertPerson`'s `ConfigOp` shape and reducer arm extended with the same
  absent-versus-cleared merge convention every other optional `Person` field already follows,
  including the one new edge case: an explicit `status: 'Active'` clears both `status` and
  `departedOn` together, while an untouched later edit (`status` omitted) carries forward whatever
  Departed state already existed.
- `components/ConfigWorkspace.tsx` — the People card gained Joined/Status columns (with a
  Departed-date input defaulting to today on first switch) and the onboarding "Add a person" form
  gained join date, manager, and initial role — one `upsertPerson` dispatch, per §3. Both manager
  `<select>`s exclude Departed people from new picks; the per-row select keeps an already-selected
  Departed manager visible, labeled "(departed)", never silently dropped.
- `components/ProfilePanel.tsx` — a Departed banner and a Joined fact row. The banner names
  exactly what changed (dropped from the manager picker) rather than the three pickers an earlier
  draft claimed — Owner, Allocate-to-project and Next-action assignment are not wired to `status`
  in this build; see §2.
- `components/PeopleDirectory.tsx` (new) — the missing front door: a filterable, broadly-readable
  table over `state.model.people` (Active first, then alphabetical), each name opening the
  existing `ProfilePanel`. Reads no new data and applies no new redaction.
- `lib/viewChoice.ts`, `components/AppSidebar.tsx`, `components/IssueWorkspace.tsx` — wired in as
  a new `people` view under the Records nav group, gated on `internal.view` exactly like `Person`
  data itself. `loadStoredView()` restores any `WorkspaceView` from `localStorage` with no
  permission check of its own (true for `analytics`/`mail` too, not fixed here — flagged in
  `docs/pending-actions.md` as a separate, pre-existing gap); `IssueWorkspace` now redirects away
  from `people` on mount and on render when the actor isn't internal, so a stale or forced stored
  choice can't surface personnel data to a client seat.
- `scripts/scenario-validation.ts` — new scenario `JD1` proves all four `joinedOn`/`status`/
  `departedOn` transitions (set, depart, untouched-carries-forward, reactivate-clears-both).
  258 scenarios total (+1), zero regressions.
- Verified: `tsc --noEmit`, `npm run build`, full scenario suite, `audit:tenancy`,
  `audit:attribution`, `audit:restore` — all clean.

**Open questions resolved with low-stakes defaults**, per the user's "continue with backlog"
instruction rather than blocking on them:

1. `joinedOn`/`status` stay `config.manage`-gated (admin-only edit), matching every other identity
   field on `Person` — the directory and profile are read-only for everyone else.
2. No future-dated departure in v1 — `status: 'Departed'` takes effect the moment it's set.
3. People placed in the existing "Records" nav group, beside Timesheets and Mail.

## What already exists, checked before proposing anything

Most of the *content* half of this request is already built. `ProfilePanel.tsx`
(`docs/plans/2026-08-24-profile-screen-design.md`) is exactly "one place" for a person's identity,
career (grade, track, developing-toward), reporting line, and skills — and its own design doc
states plainly: *"`Person` records are already org-wide visible to any `internal.view` holder."*
The data access is fine.

**What's actually missing is discovery, not data.** That same design doc names the gap directly:
ProfilePanel is *"reachable from two places in v1"* — the People config card (gated on
`config.manage`, admin-only) and a profile's own reports-to/direct-reports links. There is no
screen an ordinary colleague, with no admin rights, can open to browse everyone. The only full
listing of people that exists today is `ConfigWorkspace.tsx`'s People card — an *editing* table
behind an admin permission, not a directory anyone can read.

**Join/exit dates don't exist at all.** `Person` (`lib/config.ts:235`) has no `startDate`,
`joinedOn`, or anything like it. There is also no leaver concept, and this is deliberate, not an
oversight: `lib/workspace.ts:4683`'s own comment states it outright — *"`Person` has no
`deletedAt`. The directory does not retire people."* The only removal path, `deletePerson`, is a
hard, non-cascading delete built for a different problem entirely — its own tooltip says so:
*"Remove \[name\] from the directory. Anything already recorded against the name stays where it
is."* It exists for mistaken or duplicate entries, and using it for a real departure would be
wrong in the same way `lib/config.ts`'s comment on `deletePerson`'s refusal logic already argues
against — allocations, time entries, and notes key on the name/id, and a real leaver's history
needs to keep resolving, not go dangling.

**Onboarding is a two-field quick-add.** Adding a person today is a name and an optional email
address (`ConfigWorkspace.tsx`'s "Add a person" row), dispatched through `upsertPerson` with
`id: null`. Everything else — role, manager, grade, track — is set afterward, field by field, in
the same admin table. There is no single flow that walks through a new joiner's major details at
the point they're added.

## Shape

### 1. A People directory screen

A new, broadly-readable screen — gated on `internal.view` like `Person` itself already is, not on
`config.manage` — listing every person: name, roles, grade/track if stated, manager. Clicking a
row opens the existing `ProfilePanel` exactly as it already renders, unchanged. This is
deliberately *not* a new data model or a new profile screen — it is the missing front door to the
one that already exists. `directoryPersonFor`/`liveWorkTypes`-style existing helpers, not new
redaction logic — the directory reads the same already-redacted `state.model.people` the People
config card reads today.

### 2. Join date and a non-destructive leaver status

Two new optional `Person` fields:

- `joinedOn?: string` — an ISO date, set once, admin-entered (or captured at onboarding — see
  below), shown on the profile and the directory.
- `status?: 'Active' | 'Departed'` (absent = Active, the same "absence is the common case, not a
  gap" convention `Commitment.status` and `WorkType.deletedAt` already use elsewhere) plus
  `departedOn?: string` when status is `Departed`.

**Departing is a status change, never `deletePerson`.** A departed person's row stays exactly
where it is — their history keeps resolving, their name keeps appearing on old allocations, time
entries, and notes exactly as it does today. What changes at build time: they drop out of the
*manager* picker for new assignments — both the People config card's per-row select and the
onboarding form's — the same way an archived `WorkType` already drops out of `liveWorkTypes`
without deleting anything that referenced it historically; an already-selected departed manager
stays visible on the row that names them (labeled "(departed)"), never silently reclassified.
The Owner field (still raw free text — no autocomplete exists yet, per the audit's I1/#1 finding),
Allocate-to-project, and Next-action assignment are **not** wired to `status` in this build — they
stay exactly as they were, so picking up a departed name in any of those remains possible until
that follow-up work happens. The directory and profile keep showing departed people, clearly
labeled, rather than making them vanish — matching this codebase's consistent "archive, don't
erase" posture everywhere else it already applies this exact pattern (`WorkType`, `Discipline`,
`OrgRole`).

### 3. Onboarding: one flow, not scattered edits

A structured "Add a joiner" flow replacing the bare name+email quick-add: name, work address,
join date, manager, initial role(s), and — optionally, since the existing fields are already
self-declared and optional — grade/track. This is still just `upsertPerson` with a fuller draft
object in one dispatch; no new action, no new reducer arm. The "major details" the request names
are exactly the fields `Person` and `ProfilePanel` already model — onboarding's job is presenting
them together at the moment they're needed, not inventing new ones.

## What this does not propose

Rates, working pattern, or anything from `ResourceProfile`/`PersonRate` — the 2026-08-24 profile
design explicitly scoped those out already and this doesn't reopen it. Automated departure
workflows (revoking access, reassigning open work) — a real HR/IT process, out of scope for a
directory screen; `status: 'Departed'` records the fact, it does not act on it. Wiring profile
links onto every name in the app (an issue's owner, a note's author) — the 2026-08-24 design
named this as a deliberate future extension, not something to bundle in here.

## Open questions — resolved

Answered with low-stakes defaults at build time rather than blocking; see the Build summary above.
Revisit if any default turns out wrong in practice: admin-only edit for `joinedOn`/`status`, no
future-dated departure in v1, People under the "Records" nav group.
