# A people directory, join/exit dates, and onboarding

**Status: draft, 8 September 2026.** User's direct request — *"All user profile can be checked at
one place, when did which member joined the org and when he is exiting. Onboarding will help in
identifying the user major details."* Not built.

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
entries, and notes exactly as it does today. What changes: they drop out of *forward-looking*
pickers (Owner autocomplete once that's built per the audit's own I1/#1 finding, Allocate-to-project,
Next-action assignment) the same way an archived `WorkType` already drops out of `liveWorkTypes`
without deleting anything that referenced it historically. The directory and profile keep showing
departed people, clearly labeled, rather than making them vanish — matching this codebase's
consistent "archive, don't erase" posture everywhere else it already applies this exact pattern
(`WorkType`, `Discipline`, `OrgRole`).

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

## Open questions for Nishant

1. **Who can set `joinedOn`/`status`?** Both are naturally admin-only (`config.manage`), matching
   every other identity field on `Person` — confirm, since nothing about this design changes that
   posture by default.
2. **Does "exiting" need a *future-dated* departure** (recorded today, effective in three weeks),
   or is a same-day status flip sufficient for v1? A future-dated field is a small addition now or
   a larger one to retrofit later if skipped.
3. Directory screen placement: a new top-level nav item, or folded into an existing one (e.g.
   under "Applications" or beside "My work")?
