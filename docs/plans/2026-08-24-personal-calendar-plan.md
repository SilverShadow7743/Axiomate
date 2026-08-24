# A personal calendar — implementation plan

Follows `docs/plans/2026-08-24-personal-calendar-design.md`, approved. The design's own words
govern two decisions this plan does not reopen: `personId` is "resolved from the actor, never a
request field" (so the write actions carry no such field at all), and the read-side filter is
"applied unconditionally... before the `internal.view` branch, not inside it."

Ordered by provability: the data model and the pure aggregation logic come first — both testable
against hand-built fixtures, no reducer or database needed — then the reducer arms (self-only,
additive), then storage (a migration with nothing historical to backfill, unlike project
membership: there is no prior signal anywhere for "which events a person had"), then the read
gate (named as this plan's highest risk, the same way it was for project membership's `projectView`
step), then the screen.

## Step 1 — The data model and the pure aggregation

**Touches:** `lib/personalEvents.ts` (new — `PersonalEvent` interface, `eventProblem` shape
validator, modelled on `lib/staffing.ts`'s `memberProblem`), `lib/workspace.ts`
(`WorkspaceState.personalEvents` field — the same mechanical addition every new collection this
program has needed: `initWorkspace`, `clientView`'s emptied-collections list in
`lib/clientBoundary.ts`, `autosave.ts`'s mirror merge, `lib/db/repo.ts`'s `loadWorkspace`
placeholder), `lib/myCalendar.ts` (new — `MyCalendarEntry`, `myCalendarMonth`).

`myCalendarMonth(state, personId, monthIso)` combines four sources into one grid, reusing only
the *shape* of `calendarMonth`'s padding algorithm (Monday-first weeks, padded to whole weeks —
`lib/calendar.ts:70`–`89`), not its `ScheduleRow`-typed signature:

- Every `PersonalEvent` where `personId` matches, one entry per day for a multi-day span (the
  same per-day expansion `calendarMonth` already does for a planned span, `lib/calendar.ts:61`–`67`).
- Every live `Commitment` (`!deletedAt`) where `personId` matches, same per-day expansion.
- Every live `Allocation` where `personId` matches, same per-day expansion.
- The person's own due-date work — the id-aware join `lib/mywork.ts`'s `isMine` already uses
  (`whoId ? person?.id === whoId : isMe(who)`), applied to `ScheduleRow.owner`/`ownerId`. A row
  with no planned end is not dropped — it is a first-class "unscheduled" entry, the same honesty
  `calendarMonth`'s own `undated` list already established, returned alongside the grid rather
  than silently absent from it.

**Verified:** four scenarios in `scripts/scenario-validation.ts`, each constructing a
`WorkspaceState` by hand (a `PersonalEvent`, a `Commitment`, an `Allocation`, an issue with a
planned end, all naming the same `personId`) and calling `myCalendarMonth` directly:

- **PC1** — an event, a commitment, an allocation and a work item all land on the correct day
  cells for their owner.
- **PC2** — the same four kinds, built for a *different* person, do not appear in this person's
  month at all — the aggregation's own join is exercised before any reducer or redaction exists
  to also get it right, so a wrong join is found here first.
- **PC3** — a multi-day commitment/allocation appears on every day it spans, clipped to the
  month, the same clipping rule `calendarMonth` already proves for work items.
- **PC4** — an owned work item with no planned end appears in the unscheduled list, not silently
  dropped from the month.

`npm run validate:scenarios` — PC1–PC4 PASS, 0 P0, nothing that passed before regresses.
`npx tsc --noEmit` clean.

## Step 2 — The reducer arms

**Touches:** `lib/workspace.ts` (`Action` union + three arms), `lib/access.ts`
(`ACTION_PERMISSIONS` — all three `null`, the same shape `setNotificationPref` uses, *without*
its admin fallback: the design is explicit that there is no admin half here), `lib/actionShape.ts`
(SHAPES), `app/api/workspace/route.ts` (`KINDS`).

```
addPersonalEvent    { title, startAt, endAt, allDay, note, attendees, now }   — no personId field
updatePersonalEvent { id, patch: Partial<Pick<PersonalEvent, 'title' | 'startAt' | 'endAt' | 'allDay' | 'note' | 'attendees'>>, now }
removePersonalEvent { id, now }
```

`addPersonalEvent`'s arm resolves the owner via `directoryPersonFor(state.model, actor)?.id`
(`lib/access.ts` — the same join `myWork` and `setNotificationPref` both already use) and refuses
if it is null — an unrecognised sign-in cannot own a calendar entry, the same reasoning a
directory-less reader gets nothing from `myWork` either. `update`/`removePersonalEvent` refuse
unless the resolved actor id equals the existing row's `personId`, **full stop** — no
`config.manage` fallback, which is the one place this plan diverges from the `setNotificationPref`
precedent it otherwise mirrors, because the design says so explicitly.

**The detail most likely to be copied wrong:** it would be natural, modelling this on
`addProjectMember`, to add a `personId` or `person` field to the action "for consistency." Do not
— the design's whole argument for structural privacy is that the field does not exist to carry a
wrong value in the first place. If a future change adds one, that is the design being reopened,
not a refactor.

**Verified:** scenarios driving `apply()` directly (no database):

- **PC5** — an actor adds an event; it resolves to their own directory id with no field naming it.
- **PC6** — a different actor's `updatePersonalEvent`/`removePersonalEvent` against PC5's event
  is refused, and refused the same way for an actor holding `ROLE_ADMIN` — proving the "full
  stop" reading of "no admin override" at the reducer, not only at the redaction step below.

`npm run validate:scenarios` and `npx tsc --noEmit` clean. **Stands alone as a commit** — purely
additive, nothing existing calls these actions yet.

## Step 3 — Storage

**Touches:** `prisma/schema.prisma` (new `PersonalEvent` model — `tenantId`, `id`, `personId`,
`title`, `startAt`, `endAt`, `allDay`, `note` `@db.Text`, `attendees` `@db.Text`, `createdAt`,
`deletedAt`, indexed on `(tenantId, personId)` the same way `Allocation`/`ProjectMember` are), a
new migration, `lib/db/map.ts` (`personalEventFromRow`/`personalEventToRow`), `lib/db/repo.ts`
(`Reader` type + query, replacing step 1's placeholder), `lib/db/persist.ts` (write case).

**Stands alone — carries the schema change.** No backfill: unlike project membership, there is no
existing signal anywhere in the data for "what personal events did this person have" — the table
starts empty for everyone, correctly, and nothing needs reconciling against production data before
this lands. Applied to production immediately after the migration is written; the write actions
from step 2 already exist and are safe to have live before this (they simply have nowhere to
persist to yet, the same "additive, nothing calls it" safety step 2 already established) —
so the only new risk here is the schema change itself, checked the ordinary way.

**Verified:** `npx prisma migrate diff --from-config-datasource prisma/schema.prisma --to-schema
prisma/schema.prisma` reviewed by eye before applying (the technique this program's later builds
settled on after `--from-migrations` needed a shadow database this deployment doesn't have).
`npm run audit:persistence` — the existing count stays green, plus one new check: a
`PersonalEvent` written through `persistActions` comes back out of Postgres with its `title`,
`startAt`/`endAt` and `attendees` text intact, the same round-trip discipline every other
collection's persistence check already follows.

## Step 4 — The read gate

**Touches:** `lib/db/boot.ts`'s `redactForReader` (`lib/db/boot.ts:250`).

**This is the step carrying the most regression risk in this plan**, for the reason the design
names directly: this is the one redaction in the whole app with *no* exemption, and getting that
wrong is worse here than anywhere else it has been gotten wrong before — `clientView`'s launch
leaked internal note content once, `boot()`'s sign-in gate leaked a client-list summary once, and
each of those had an eventual audience who was SUPPOSED to see the data under different
conditions. A personal-event leak has no such story: if `isExempt`'s ADMIN bypass is reused here
by habit (the same function every other new redaction this program has written reaches for), a
platform operator reads private calendar entries nobody is entitled to be exempt from — a worse
failure than the leaks this codebase has found before, because there could be no valid case for
this one to fire.

The filter sits before the `internal.view` branch, applied to `mine` unconditionally regardless
of role, exemption, or verdict on any other permission:

```ts
const personalEvents = Object.fromEntries(
  Object.entries(state.personalEvents).filter(([, e]) => e.personId === mine),
)
const base = { ...state, rates, personSkills, documents, personalEvents }
```

**Verified:**

- **PC7** — an `ROLE_ADMIN` actor's redacted state contains none of another person's
  `PersonalEvent` rows — the specific case the design calls out, checked directly rather than
  inferred from "internal.view passes through unchanged."
- **PC8** — the owner's own redacted state contains all of their own rows, unfiltered.
- **PC9** — a sign-in matching no directory entry (`mine === null`) gets an empty
  `personalEvents` map, not an error and not every event in the tenant.

`npm run audit:persistence` and `npm run validate:scenarios` — full suite, 0 P0. Deployed, then a
before/after check in the same spirit as project membership's step 3, adapted to this design's
"nothing to backfill" shape: confirm in production that an operator account's boot payload
contains zero rows belonging to any other `personId`.

## Step 5 — The screen

**Touches:** `lib/viewChoice.ts` (`WORKSPACE_VIEWS` gains `'mycalendar'`),
`components/FilterBar.tsx` (`VIEW_ORDER`/`VIEW_LABEL`/`VIEW_TITLE` — label **"My calendar"**,
deliberately distinct from the existing **"Calendar"** entry, per the design's naming decision),
a new `components/MyCalendarPanel.tsx` (docked the same way `TimesheetPanel`/`Inbox` already are
— no scrim, no focus trap, the switcher is how you leave), `components/IssueWorkspace.tsx` (one
more branch in the main-pane view switch, and the `addPersonalEvent`/`update`/`remove` dispatch
wiring — a small add/edit form for one's own events, an unscheduled-work rail the same shape
`CalendarView`'s existing rail already uses).

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`. No new scenario — this is UI wiring over
already-correct, already-proven logic (steps 1–4), the same reasoning the docked-views slice's
plan gave for its own screen step.

## Commit boundaries

- Step 1 stands alone (pure, inert — nothing calls the reducer or touches storage).
- Step 2 stands alone (additive actions, no existing behaviour changed).
- Step 3 stands alone — the schema change, per this program's standing rule.
- Step 4 stands alone — it is the step that actually starts filtering what anyone receives, and
  it gets its own deploy and its own live before/after check, the same reasoning project
  membership's steps 4 and 5 were kept apart for.
- Step 5 stands alone (screens, no gating logic).

## What would send this back to the design

- If step 1's scenarios show the four entry kinds genuinely resisting a single day-grid — not
  "more code," a structural mismatch — the design's central premise (these are one "calendar")
  needs re-examining before step 2 begins.
- If step 2's PC6 shows any path by which an actor can move or claim another person's event —
  not just "should be refused" but a shape where the refusal can be bypassed — that is the
  structural-privacy argument failing on its own terms, and it stops this plan at step 2.
- If step 4's before/after check finds even one cross-person row in a production boot payload,
  this does not get patched forward — it is the one failure mode this whole design exists to
  prevent, and it sends the read-gate step back to be rewritten, not adjusted.
