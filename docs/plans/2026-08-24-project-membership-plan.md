# Project membership — implementation plan

Follows `docs/plans/2026-08-24-project-membership-design.md`, approved. Ordered so that pure logic
is provable before anything depends on it, storage lands and is verified before any code reads it,
and the two gates (write, then read) ship only once the data they depend on already exists in
production — the design's own rollout section states this constraint for the migration; this plan
extends it to the code that consumes the migration, which the design left as one combined step and
which this plan splits in two for exactly the reason step 4 below explains.

The codebase has one proof mechanism for behaviour, not a separate unit-test framework:
`scripts/scenario-validation.ts`, driven by `npm run validate:scenarios`, exercising pure functions
and the reducer directly with hand-built fixtures — no database required until storage exists. Every
step below that produces testable logic adds scenarios there before moving on, per this codebase's
own established pattern (RD1/MN1/GA1 and others were added the same way this session).

## Step 1 — Types and the pure gate functions

**Touches:** `lib/workspace.ts` (`ProjectMember` interface, `WorkspaceState.projectMembers` field),
`lib/config.ts` (`ProjectRole` interface, `OperatingModel.projectRoles` registry, seeded with the
thirteen labels the design names), `lib/access.ts` (`projectOf`, `canOnProject`, `isExempt`).

`projectOf` reuses `scopeChainOf` exactly as the design specifies. Confirmed before writing it:
`parentOf` (`lib/workspace.ts:1317`) already resolves parentage for `state.nodes`, `state.issues`
*and* `state.activities` — so `scopeChainOf` correctly walks up from an issue or an activity to a
`'project'` node, not only from a bare hierarchy node. Nothing new needed there.

`isExempt(model, actor)` checks `rolesFor(model, actor).includes(ADMIN_ROLE_ID)` or
`isMachineActor(actor)`, in that order — machine actors first, mirroring how `rolesFor` itself
orders the same check (`lib/access.ts:291`), so a machine actor is never run through
`directoryPersonFor`.

Nothing here is wired into anything live. `state.projectMembers` starts as an empty
`Record<string, ProjectMember>` everywhere it's constructed (`initWorkspace`, the browser mirror's
default, `clientView`'s base object) — the same mechanical addition every new collection this
program has added has needed, and it's inert until step 4.

**Verified:** four scenarios in `scripts/scenario-validation.ts`, each constructing a
`WorkspaceState` literal by hand (a `'project'` node, a `ProjectMember` row, an actor) and calling
`canOnProject` directly — no reducer, no database:

- **PM1** — a member may act on their project.
- **PM2** — a non-member is refused, with a reason naming them.
- **PM3** — an admin bypasses the gate with no membership row at all.
- **PM4** — a record with no `'project'` ancestor (an issue parented directly to a `'client'` node)
  is ungated for anyone holding `internal.view`, member or not.

`npm run validate:scenarios` — all four appear PASS in the summary, 0 P0, and every scenario that
passed before this step still passes (the harness prints the full list; nothing here touches an
existing one).

## Step 2 — Reducer arms for membership itself

**Touches:** `lib/workspace.ts` (`Action` union + three new arms in `apply()`), `lib/access.ts`
(`ACTION_PERMISSIONS`, and one new permission key — see below), `lib/actionShape.ts` (SHAPES for
the three actions), `app/api/workspace/route.ts` (`KINDS`).

Three new actions, modelled directly on `upsertAllocation`/`removeAllocation`
(`lib/workspace.ts:5517`–`5625`), which already do the same shape of thing — add/correct/soft-remove
a record naming a person and a project:

- `addProjectMember { projectId, person, projectRoleId, now }`
- `updateProjectMember { id, projectRoleId, now }` — role correction only; nobody re-dates a tenure
  by editing it, they end it and start a new one, the same reasoning `Version` corrections follow.
- `removeProjectMember { id, now }` — soft (`removedAt`), never destroyed, per the design.

**The permission key the design left unnamed.** None of the existing `PERMISSIONS` fit "decide who
may be staffed on a project" — `capacity.allocate` is about a claim on someone's *time*, not about
access. Adding one: `project.staff` — `"Add or remove who may see and act on a project."` — granted
by default to `ROLE_ENGAGEMENT_LEAD`, `ROLE_PROJECT_MANAGER` and `ADMIN` (the same roles that
already hold `capacity.allocate`, since staffing decisions already sit with them). This is a small,
mechanical gap-fill the design didn't pin down, not a reopening of anything it settled — flagged
here rather than silently invented, per the detail's own weight: get the default grants wrong and
either nobody but an admin can staff a new project, or everybody with delivery access can.

**A deliberate divergence from the `Allocation` pattern:** `addProjectMember` refuses when
`directoryIdByName(model, person)` does not resolve to exactly one directory id, rather than
storing `personId: null` the way `Allocation` tolerates. `Allocation` is advisory to a capacity
report; a `ProjectMember` row with no resolvable `personId` is an access-control fact that nothing
will ever match against a signed-in session's `directoryPersonFor` lookup — silently useless is
worse here than loudly refused, and it is exactly the failure class `TW2` already found this
session (a name that doesn't resolve gets no cap and no warning). This is the detail most likely to
be copied wrong by pattern-matching the shape it's modelled on.

**Verified:** scenarios exercising `apply()` directly (no database, same harness):

- **PM5** — an Engagement Lead may add a project member; a Consultant, lacking `project.staff`,
  may not.
- **PM6** — adding a member with a name that resolves to zero or more than one directory entry is
  refused, naming the ambiguity.
- **PM7** — removing a member is soft; the row survives with `removedAt` set, and a second query
  against `canOnProject` for that person now refuses.

`npm run validate:scenarios` and `npx tsc --noEmit` — both clean. `apply()` gaining new arms with
no matching `ACTION_PERMISSIONS` entry fails the build via the `satisfies Record<Action['t'],
PermissionKey | null>` assertion this codebase already relies on (`lib/access.ts:402`), so a missed
wiring point is a compile error, not a silent hole.

**Stands alone as a commit.** Nothing yet calls `addProjectMember` from a screen, and nothing yet
gates an existing action on membership — this step is purely additive and changes no existing
behaviour, safe to ship on its own.

## Step 3 — Storage: the migration and the backfill, together

**Touches:** `prisma/schema.prisma` (new `ProjectMember` model, following `Allocation`
(`prisma/schema.prisma:612`) field-for-field except `personId` is required, not optional — see step
2's divergence), a new migration, `lib/db/map.ts` (`projectMemberFromRow`/`projectMemberToRow`),
`lib/db/repo.ts` (`Reader` type + `db.projectMember.findMany` in `loadWorkspace`'s `Promise.all`),
`lib/db/persist.ts` (write case).

**Stands alone — this is the step carrying a schema change, and the design's own rollout section
governs it exactly:** the backfill query runs inside the same migration, before this step's code
half (`repo.ts`/`persist.ts`) is deployed, and it is applied to production *before* anything below
this line ships. The backfill derives one `ProjectMember` row per (project, person) pair found by
walking, for every `'project'` node: issue ownership/responsibility in its subtree, `TimeEntry`
rows against it, live `Allocation` rows on it, and `Commitment`/SOW-linked rows under it — exactly
the four sources the design names — mapping each person's current org role to the nearest
`projectRoleId` (PM → Project Manager, Engagement Lead → Engagement Manager, everyone else →
Consultant), `addedBy` recording the migration, `addedAt` backdated to the earliest evidence found.
`ROLE_ADMIN` holders are skipped — exempt by role, need no row.

**Nothing reads `state.projectMembers` in any live code path yet** — `canOnProject` and the reducer
arms from steps 1–2 exist but are not called from any *existing* action's refusal check, and
`boot()` does not yet redact by it. This is what makes the backfill safe to get wrong and cheap to
re-run: a bad backfill run has no observable effect on any current user before step 4 ships, and can
be corrected with a follow-up data migration with zero code changes.

**Verified, before applying to production:**

1. `npx prisma migrate diff --from-schema=prisma/schema.prisma` against a scratch database, reviewed
   by eye for the expected single new table and no unintended drops.
2. **The before/after comparison the design names as the actual bar**, run against a read replica
   or a transaction rolled back afterward on production data: for every person who currently holds
   `internal.view`, compute the set of projects they can see today (everything, since nothing gates
   yet) against the set the backfill would grant them. Report anyone whose backfilled set is empty
   while they have live evidence (an open issue, a submitted timesheet, an active allocation) under
   *some* project — that is the backfill heuristic missing a source, not an acceptable gap, and it
   sends this step back to correct the query before the migration runs for real.
3. Applied to production. `npm run audit:persistence` — the existing 51 checks stay 51/51 (nothing
   about this table changes what they assert), and a new check is added: a `ProjectMember` row
   written through `persistActions` comes back out of Postgres with its `projectId`, `personId` and
   `projectRoleId` intact.

## Step 4 — Wire the write gate into existing actions

**Touches:** `lib/workspace.ts` — every arm inside `apply()` that currently calls
`can(state.model, actor, key)` (or relies on the pre-check the endpoint already ran) against a
record with a resolvable id changes to `canOnProject(state, actor, key, recordId)`. Concretely:
every arm whose action carries an `id`, `issueId`, or `nodeId` naming something that already exists
— `updateIssue`, `move`, `link`/`unlink`, `addDependency`/`removeDependency`, `setDates`,
`setAssignment`, `addNote`/`updateNote`/`removeNote`, `addEvidence`/`updateEvidence`/`removeEvidence`,
`addTime`/`updateTime`/`removeTime`, `requestApproval`/`decideApproval`, `upsertMilestone`/
`decideMilestone`/`deliverMilestone`, `upsertScopeItem`/`decideScopeItem`, `requestDocumentReview`/
`decideDocumentReview`/`withdrawDocumentReview`, `softDelete`/`restore`, `buildLifecycle`/
`clearLifecycle`, `setEstimate`/`baselineEstimate`. Left on plain `can()`, unchanged: actions with
no single governing record — `config`, `recordRate`/`correctRate` (a person's pay, not a project's),
`recordPersonSkill` family (a directory fact about a person, not project-scoped), `recordVersion`
family, `upsertSow`/`archiveSow`/`attributeToSow`/`upsertChangeRequest`/`decideChangeRequest` (an
engagement-level commercial record, one level coarser than a project), `notify`,
`markNotificationRead`, `setNotificationPref`, and the three membership actions from step 2
themselves (gated on `project.staff` against the project directly, not `canOnProject`, since
managing membership is itself the thing being decided).

**This is the step most exposed to "missed one":** after making the change, grep `apply()` for every
remaining bare `can(state.model, actor,` call and check each one against the two lists above by
name — a call left on `can()` that should have moved to `canOnProject` is a silent hole (someone
not staffed on a project can still act on it); a call moved that shouldn't have been is a silent new
refusal on something that used to work.

**Verified:**

- **PM8** — a Consultant who is a member of Project A but not Project B may log time against A and
  is refused against B, with a reason naming them as not staffed there.
- **PM9** — the same refusal, exercised through `updateIssue` closing an issue under a project the
  actor isn't a member of — proving the gate applies uniformly across arms, not just the one it was
  first written against.
- Every existing scenario in the suite that exercises any of the arms above, re-run: `npm run
  validate:scenarios` — everything that passed before this step still passes. This is the sharpest
  edge of the risk named for this step — a passing suite here means the gate didn't break any
  scenario that constructs an actor *with* membership (every existing scenario's fixtures predate
  this feature and carry no membership rows), which only holds because the migration in step 3 has
  already run and backfilled real membership; the scenario harness's own fixtures need one line
  each — granting the scenario's actor membership on whatever project the scenario's records sit
  under — or every scenario touching a gated arm fails not because the gate is wrong but because the
  fixture never enrolled anyone. Do this fixture update as part of this step, not discovered by a
  wall of new failures.

Deployed to production only after this passes in full — this is the point at which write access
narrows for real, and it depends entirely on step 3's backfill already being correct in production.

## Step 5 — Wire the read gate into `boot()`

**Touches:** `lib/clientBoundary.ts` gets a sibling, `lib/projectBoundary.ts` (`projectView`,
`memberProjectIdsFor`), and `lib/db/boot.ts`'s `redactForReader` (`lib/db/boot.ts:250`) branches on
`isExempt` before falling into `internal.view`'s existing `true` branch, plus the fourth banner
sentence in `boot()`'s `scopeNote` chain (`lib/db/boot.ts:168`–`177`).

**This is the step carrying the most regression risk in this plan, and it fails in two directions
that are both severe:** too permissive is a confidentiality leak — an internal person sees a
project's issues, notes and time entries they were never staffed on, the exact class of bug this
program's own history keeps finding in redaction code (`clientView`'s launch found the audit
child-content leak, then the `docsVisible` subject-join hole, in the same function). Too restrictive
is the lockout the design spends its longest section warning about. Unlike `canOnProject`, which
had `can()` as forty-plus already-correct call sites to lean on, `projectView` is new redaction logic
with no existing precedent to inherit correctness from — it has to earn it the way `clientView` did,
by being wrong at least once before the proof catches it.

The three now-possible reasons a boot payload is narrower than "everything" — no directory entry,
a client seat with no `clientScopeId`, and now no project membership — sit in an if/else chain in
`boot()` today for the first two; adding the third means checking the chain resolves to exactly one
sentence per case, not a silent fallthrough that reports the wrong reason.

**Verified:**

- **PM10** — an internal person who is a member of Project A and not Project B: `redactForReader`'s
  output contains A's issues, notes and time entries in full, and none of B's — checked by asserting
  on the *absence* of B's specific issue ids and audit rows, the same style `clientView`'s own
  payload-leak proof checks (`lib/db/boot.ts`'s redaction comment names this exact discipline).
- **PM11** — the same person's audit trail: entries about B's issues are dropped whole, not merely
  the issue list — the leak this program already found once in `clientView` (child-content audit
  entries surviving under the parent's rowId), checked again here because the same shape of bug can
  recur in a new redaction function for a different reason.
- **PM12** — a record with no `'project'` ancestor survives for anyone with `internal.view`,
  regardless of membership — proving the "not every record" boundary from the design holds in the
  redaction code, not only in the write gate.
- **PM13** — a person on no project sees an empty tree and the new banner sentence, distinguishable
  from the existing "no directory entry" and "client seat unattached" sentences.

`npm run audit:persistence` (the payload-leak-shaped checks already there are the template for
PM10/PM11's assertions) and `npm run validate:scenarios` — full suite, 0 P0. Deployed and then
checked live: the same before/after comparison from step 3, re-run against the *actual served
payload* for a small number of real accounts (not just the backfill data), confirming what step 3
predicted matches what a real signed-in request now receives.

## Step 6 — Screens

**Touches:** a new `ProjectMembersPanel` (list, add via directory-name autocomplete + project-role
select, remove), wired into the project's detail view the same way `TimesheetPanel`/`ArchivePanel`
are wired into `IssueWorkspace.tsx` — dynamically imported per the pattern this session's most
recent optimisation pass established, since this is exactly the shape of panel that pattern targets
(gated behind opening a project's detail, never on first paint). `ConfigWorkspace` gains a
`Project roles` card for relabelling/adding entries in `projectRoles`, following the existing
`Roles & people` card's shape.

**Verified:** `npm run audit:a11y` clean, `npx tsc --noEmit` clean, then a browser drive: open a
project as a member and confirm the panel lists them; as an admin, add a new member and confirm the
person's next request reflects it (no redeploy needed — this is data, not code, same as every other
membership-shaped feature this program has shipped).

## Commit boundaries

- Step 1 stands alone (pure, inert).
- Step 2 stands alone (additive actions, no existing behaviour changed).
- Step 3 stands alone — carries the schema change, per this program's standing rule that a
  migration never shares a commit with anything else.
- Steps 4 and 5 each stand alone, specifically *because* they are the two steps that narrow live
  behaviour and each needs its own before/after verification and its own deploy — bundling them
  would make a single regression in either indistinguishable from the other when the health probe
  or a user report comes in.
- Step 6 stands alone (screens, no gating logic).

## What would send this back to the design

- Step 3's before/after comparison finding real people about to lose sight of work they're
  currently on — the backfill heuristic is wrong, per the design's own send-back list, and this
  plan does not proceed to step 4 until it's fixed and re-verified.
- Step 1's fixtures showing `scopeChainOf` terminating at `'client'` or `'engagement'` for most real
  records rather than `'project'` — the design's second send-back condition, and it would show up
  here first, before any migration exists, which is the cheap place to find it.
- Step 4's arm-by-arm sweep finding an action that operates on more than one record with different
  projects (a cross-project link or dependency) — the design names this as a real gap in
  `canOnProject`'s one-record assumption, not an edge case to special-case silently; if it surfaces,
  this plan stops at step 4 and the design gets the specific case put to it.
