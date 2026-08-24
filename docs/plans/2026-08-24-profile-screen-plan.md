# A profile screen — implementation plan

Follows `docs/plans/2026-08-24-profile-screen-design.md`, approved. Its own words settle the
shape: a dismissible panel state (`openProfileId: string | null`), not a `WorkspaceView` member;
a new action, `updateCareerProfile`, following `setNotificationPref`'s self-or-admin precedent and
reusing the existing `career()` helper; no new redaction anywhere — the panel reads
`state.personSkills` exactly as it already arrives. Neither is open to reinterpretation here.

## Step 1 — Pure logic: a shared `directReportsOf`

**Touches:** `lib/config.ts` (new exported `directReportsOf(people, id): Person[]`, beside
`wouldCreateManagerCycle`), `lib/workspace.ts`'s `deletePerson` arm (`lib/workspace.ts:6929`),
which today computes the same thing inline — `Object.values(m.people).filter((p) => p.managerId
=== op.id)` — and must be changed to call the shared function instead of keeping its own copy, or
the reducer's refusal and the screen's list can silently drift apart the moment either is edited
alone.

`directReportsOf` is a flat filter with no walk and no cycle concern — that is `wouldCreateManagerCycle`'s
job, not this one's. It takes the same `Record<string, Person>` shape `wouldCreateManagerCycle`
already takes, for the same reason: drivable against a hand-built `people` record, no reducer, no
database.

**Verified:** two scenarios in `scripts/scenario-validation.ts`, both against a hand-built
`people` record:

- **PS1** — a person with two people naming them as `managerId` gets both back, and nobody else.
- **PS2** — a person nobody reports to gets an empty array, not `undefined` and not a thrown error
  — checked as its own case, since a function that returned `undefined` for "nobody" would still
  pass PS1 alone.

Then re-run **RL7** (`deletePerson refuses to delete someone with a direct report...`, from the
reporting-line plan) unchanged, to prove the swap didn't change `deletePerson`'s own behaviour —
it is the one existing scenario that already exercises this exact code path.

`npm run validate:scenarios` — PS1, PS2, RL7 all PASS, nothing else regresses. `npx tsc --noEmit`
clean.

## Step 2 — The reducer: `updateCareerProfile`

**Touches:** `Action` union in `lib/workspace.ts` (new member: `{ t: 'updateCareerProfile'; id:
string; patch: { grade?: string; track?: string; developingToward?: string }; now: string }` —
typed to exactly these three fields, not `Partial<Person>` and not the broader shape
`upsertPerson`'s `op` carries; see the note below on why that typing itself is part of the
enforcement, not just documentation), a new `case 'updateCareerProfile':` arm placed beside
`case 'setNotificationPref':` (`lib/workspace.ts:5295`), `lib/access.ts`'s `ACTION_PERMISSIONS`
(new entry, `updateCareerProfile: null`, beside `setNotificationPref: null` at line 603, with the
same "self-or-admin, decided in the arm" comment), `lib/actionShape.ts`'s `SHAPES` (new entry:
`updateCareerProfile: { id: req(id), patch: req(plainObject), now }`, following
`updatePersonalEvent`'s `patch: req(plainObject)` precedent — the arm validates the patch's own
shape, not the wire boundary), and `app/api/workspace/route.ts`'s `KINDS` set (this is
browser-dispatched, unlike `recordInboundMail` — it belongs in `KINDS`, not excluded from it).

The arm: resolve `existing = state.model.people[a.id]`, refuse if absent (same "resolves to
nobody" wording `setNotificationPref` already uses). Compute `self = directoryPersonFor(state.model,
actor)?.id === a.id`. If `!self && !can(state.model, actor, 'config.manage').allowed`, refuse,
naming whose record it is — copy `setNotificationPref`'s exact refusal wording pattern
(`lib/workspace.ts:5308-5312`). Otherwise build the patch with the existing `career(a.patch,
existing)` (`lib/workspace.ts:6269`) — the same function `upsertPerson` already calls, so there is
exactly one place that decides what counts as a valid grade/track/developingToward value — and
merge it into `m.people[a.id]`, auditing the same way `upsertPerson` does (`field: 'person'`,
`from`/`to` built from the same `${name} — ${roleNames}` shape, or a narrower `career`-only
from/to if that reads better once written — a detail to settle while writing the arm, not before).

**This is the step carrying the most regression risk in this plan.** Unlike step 1, this is not a
refactor of existing behaviour — it is a brand-new authorization decision, and the class of bug it
can produce is not a wrong screen, it is a wrong *permission*: if the `self` comparison is
reversed, defaults to true, or resolves incorrectly for an actor who has no directory match, a
person could edit a colleague's grade/track/developingToward without ever holding
`config.manage`. The blast radius is small (three low-stakes fields, not roleIds or managerId) but
the bug class — a self-check that is wrong in the permissive direction — is exactly the one
`setNotificationPref`'s own comment exists to warn about, and it is worth re-reading that arm
side-by-side with the new one rather than trusting the analogy from memory.

**The detail most likely to be got wrong:** typing `patch` as `{ grade?: string; track?: string;
developingToward?: string }` and not as `Partial<Person>` or `ConfigOp`'s broader per-field shape.
If the type is loosened later to "share more code" with `upsertPerson`, a self-dispatched
`updateCareerProfile` could carry `roleIds` or `managerId` in the same object even if the arm
ignores them today — the enforcement this step relies on is partly the type itself refusing to
carry those fields, not only the arm's runtime check.

**Verified:** four scenarios in `scripts/scenario-validation.ts`, driving `apply()` directly with
different actors (this needs `apply(s, a, actor)` directly rather than the fixed-actor `ok`/`act`
helpers, the same way the reporting-line plan's RL7 needed a second actor):

- **PS3** — the person themselves, holding no `config.manage`, successfully updates their own
  `grade`.
- **PS4** — a different person, holding no `config.manage`, is refused, and the refusal names
  whose record it is.
- **PS5** — an actor holding `config.manage`, editing somebody else's `track`, succeeds — the
  admin exception.
- **PS6** — a successful self-edit reuses `career()`'s own absent-versus-cleared handling
  (confirmed by asserting the same behaviour `upsertPerson`'s own career scenarios already prove —
  an empty string clears the field, `undefined` leaves it alone) so the two callers of `career()`
  cannot silently diverge.

`npm run validate:scenarios` — PS3–PS6 PASS, nothing regresses. `npx tsc --noEmit` clean.
**Stands alone as a commit** — new action, no existing caller, nothing changes behaviour until the
screen in step 3 dispatches it.

## Step 3 — The screen

**Touches:** a new `components/ProfilePanel.tsx`, dynamically imported in `IssueWorkspace.tsx`
beside `ArchivePanel`/`SlaPlanPanel` (`components/IssueWorkspace.tsx:94-96`); new state
`openProfileId: string | null` beside `archiveOpen`/`slaOpen` (`:182-185`); a conditional render
block beside the existing `{archiveOpen && <ArchivePanel .../>}` / `{configOpen && <ConfigWorkspace
.../>}` blocks (`:2436-2474`); `ConfigWorkspace`'s `Props` type and `RolesAndPeople` function
(`components/ConfigWorkspace.tsx:519`) both gain an `onOpenProfile: (personId: string) => void`
prop, threaded from `IssueWorkspace.tsx`'s `<ConfigWorkspace onOpenProfile={setOpenProfileId} .../>`
down to `RolesAndPeople`'s people-table name cell, which becomes a button/link instead of plain
text.

`ProfilePanel` renders, read-only unless `directoryPersonFor(state.model, actor)?.id ===
personId`: name, email, grade, track, developingToward, resolved role labels
(`model.roles[id]?.label`), reports-to (resolved via `state.model.people[managerId]`, clickable —
`onClick={() => onOpenProfile(managerId)}`, re-pointing the same panel rather than opening a
second one), direct reports (`directReportsOf(state.model.people, personId)` from step 1, each
clickable the same way), and skills (`Object.values(state.personSkills).filter(s => s.personId ===
personId && !s.deletedAt)`, skill name resolved via `liveSkills(state.model)`
(`components/ConfigWorkspace.tsx`'s existing import, reused here) — rendered exactly as the rows
arrive, `withheld`/null `level` included, no new check). When editable, the three career fields
become inputs dispatching `updateCareerProfile` from step 2 on blur/save, the same interaction
shape the People card's own email field already uses (`onBlur`, `components/ConfigWorkspace.tsx:834`).

**No new visibility check anywhere in this step** — the design's own reasoning: `Person` records
are already org-wide visible to any `internal.view` holder, and `state.personSkills` arrives
pre-redacted. This step renders what state already carries; it does not decide who may see it.

**The detail most likely to be got wrong:** the editability check must read
`directoryPersonFor(state.model, actor)?.id === personId` — the panel's own `personId` prop, not
`actor.id` or any other field on `actor` directly. `directoryPersonFor` exists specifically because
resolving a signed-in actor to a directory person is an id→email→name join, not a single field
comparison — reaching around it to compare something simpler is exactly the class of shortcut that
produced the identity mismatch this project has already fixed once this session (reporting-line's
own `self` check in step 2 has the identical shape, so getting this one right is largely a matter
of copying step 2's line rather than re-deriving it).

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`. No new scenario — this is a form over
already-correct, already-proven logic (steps 1–2), the same reasoning every screen-only step in
this program's prior builds gave for itself.

## Commit boundaries

- Step 1 stands alone (pure, and it changes `deletePerson`'s existing computation — worth its own
  commit so a bisect lands on exactly this if `deletePerson`'s behaviour is ever questioned).
- Step 2 stands alone — new action, no caller yet, and it is where this plan's actual risk lives.
- Step 3 stands alone (the screen; wires steps 1 and 2 together for the first time).

## What would send this back to the design

- If the self-or-admin check, once written, needs to handle an actor who resolves to no directory
  person at all trying to open "their own" profile — the design assumed `directoryPersonFor`
  always resolves for a signed-in actor with a profile to view, and if that assumption is wrong
  for some real actor shape, that's a gap in the design's access model, not a null-check to patch
  around in the arm.
- If `directReportsOf`, once shared between the reducer and the screen, turns out to need to be
  richer than a flat filter — a reporting line deep enough that "direct reports" alone doesn't
  answer what the screen needs — that is a real gap in the extraction the design already flagged,
  not something to special-case in `ProfilePanel` instead.
- If reusing `career()` from two call sites (`upsertPerson` and `updateCareerProfile`) produces a
  visible disagreement between what the two accept — the design's own send-back condition — that
  means the function is not as safely shared as assumed and the two callers need reconciling
  before step 3 ships.
