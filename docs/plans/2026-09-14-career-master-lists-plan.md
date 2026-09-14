# Career master lists — implementation plan

Follows `docs/plans/2026-09-14-career-master-lists-design.md`. Two commits: everything provable
without a browser (the vocabulary, the permission, the reducer, the two registries a new action
must update) first, the UI that needs one second. A required post-deploy step follows both —
named here, not left implicit.

## Commit 1 — the vocabulary, the permission, the reducer

### 1. `lib/config.ts` — the `CareerOption` entity

- New interface beside `Skill`'s (~line 539): `CareerOption { id: string; kind: 'grade' |
  'track' | 'developingToward'; label: string; deletedAt: string | null }`.
- `OperatingModel.careerOptions: Record<string, CareerOption>`, declared beside `skills` (~952).
- `initModel` (~1433, right after the `skills: {}` line and its "there is no SEED_SKILLS"
  comment): add `careerOptions: {}`, with a comment making the same point for the same reason —
  this firm's grades are not a universal fact to ship.
- `mergeModel` (~1814, beside `skills`): add `careerOptions: { ...seed.careerOptions,
  ...(stored.careerOptions ?? {}) }` — explicit, like every sibling line, because a model
  stored before this key existed has none and the top-level spread would leave it `undefined`.
- `liveCareerOptions(model, kind)`: mirrors `liveSkills` — `Object.values(model.careerOptions ??
  {}).filter((o) => !o.deletedAt && o.kind === kind).sort((a, b) =>
  a.label.localeCompare(b.label))`.
- `careerOptionLabel(model, id)`: not needed — options are stored and read by `label` directly
  (a person's `grade` field IS the label string, the same shape Owner uses names rather than
  ids for). No id-to-label lookup exists for Owner either; don't invent one here.
- Update the `Person.grade`/`track`/`developingToward` doc comment (~326-352): the "free text
  rather than an enum... two spellings will not match" paragraph is no longer true and must not
  ship stale. Replace with a short note: as of 14 Sep 2026 these are chosen from
  `CareerOption`s of the matching `kind`, the same free-text-to-managed-select reversal Owner
  went through 12 Sep; a value stored before the list existed, or naming a retired option, still
  shows and stays selectable (mirrors `ownerChoicesFor`'s `unlisted`).

**Verified by:** `npx tsc --noEmit`.

### 2. `lib/access.ts` — the permission

- Add to `PERMISSIONS` (near `skill.assess`, since both are "manage a delivery vocabulary"
  grants): `{ key: 'career.manage', label: 'Manage career levels', what: "Add or retire
  grades, tracks and developing-toward targets, and set them directly on anyone's profile." }`.
- Add `'career.manage'` to `DEFAULT_GRANTS[ROLE_ENGAGEMENT_LEAD]`'s array. No other role.
  (`ROLE_ADMIN` needs no line — it takes `ALL`, which includes every key in `PERMISSIONS`
  automatically, seed-side. What it does NOT do automatically is reach an already-provisioned
  tenant — see the post-deploy step below.)
- Add two lines to `ACTION_PERMISSIONS` (~654, beside `updateCareerProfile`, which stays
  `null` — unchanged, its self-or-admin check moves in step 3, not here):
  `upsertCareerOption: 'career.manage'`, `removeCareerOption: 'career.manage'`.

**Verified by:** `npx tsc --noEmit` — the `ACTION_PERMISSIONS satisfies Record<Action['t'],
...>` assertion in `workspace.ts` won't compile until step 3 adds both kinds to `Action`, so
this step and step 3 are typechecked together, not independently green.

### 3. `lib/workspace.ts` — the two actions and the one permission substitution

- Add to the `Action` union, beside `upsertApplication`/`removeApplication` (~1273) rather than
  inside `ConfigOp` — this is a dedicated action pair, not a `config` op; see the design's
  reasoning (a single `config.manage`-gated funnel check can't express a second, narrower
  authority over one op without a permission-OR carve-out the design deliberately avoids):
  ```ts
  | { t: 'upsertCareerOption'; id: string | null; kind: CareerOption['kind']; label: string; now: string }
  | { t: 'removeCareerOption'; id: string; now: string }
  ```
- Reducer arms, placed beside `upsertApplication`/`removeApplication` (~5532), following
  `upsertSkill`'s uniqueness check and `removeApplication`'s refuse-while-referenced shape:
  - `upsertCareerOption`: trim `label`, refuse empty ("A career option needs a label."); `id =
    a.id ?? nextCareerOptionId(state.model.careerOptions)` — a new helper beside
    `nextApplicationId` in shape (max-based over existing ids matching `career-(\d+)`, not a
    shared counter): `state.seq` is the workspace's node counter and `m.seq` (the model's own,
    bumped inside `applyConfig`) is not reachable from a top-level arm outside `applyConfig`, so
    neither is the right source here — a max-based id sidesteps needing either; refuse a clash —
    another live option of the *same kind*
    whose label matches case-insensitively (scoped by `kind`, unlike `upsertSkill`'s catalogue-
    wide check — "Analyst" is legitimately both a grade and a developing-toward target for
    different people); write, bump `seq` only on create, audit `rowId: id, field:
    'careerOption', from: existing?.label ?? null, to: label`.
  - `removeCareerOption`: refuse if it no longer exists; refuse while any active person's
    `grade`/`track`/`developingToward` (matched against `kind`) currently equals its `label` —
    "N people currently hold this. Change their career field first." mirrors
    `removeApplication`'s "Issues are still linked... Unlink them first."; otherwise soft-
    delete (`deletedAt: a.now`).
- `updateCareerProfile`'s arm (~6566): change `!self && !can(state.model, actor,
  'config.manage').allowed` to `!self && !can(state.model, actor, 'career.manage').allowed`, and
  update the denial message's `"Configure the platform"` to `"Manage career levels"`. This is
  the one permission substitution the whole feature turns on — see the design's own flagged
  risk below.
- `career()` (~8058) is unchanged. It stays permissive — validating against the master list
  here would mean rejecting the nine-people-strong "value predates the list" case the design
  keeps working via `unlisted` at the picker, exactly as Owner's write path stays permissive.

**Verified by:** `npx tsc --noEmit` clean (confirms the `satisfies` assertion from step 2 now
holds); `npx eslint lib/workspace.ts lib/access.ts lib/config.ts` clean.

**The step carrying the most regression risk:** the `updateCareerProfile` permission swap.
Today, in production, exactly two people (both holding `ROLE_ENGAGEMENT_LEAD`) and the
Administrator can override somebody else's career field, via `config.manage`. After this
commit ships — *before* the post-deploy step below is done — nobody can, including the
Administrator, because `career.manage` exists in code but is checked into nobody's stored
grants yet (`mergeModel` merges `access.grants` one role at a time; a role already present in
storage, which is every seeded role in this tenant, keeps its stored array wholesale and never
sees the new key added to `DEFAULT_GRANTS`). Nothing else regresses — self-editing is
untouched, and every other permission is untouched — but this one specific override is briefly
dead on arrival unless the post-deploy step happens promptly. Named here so it is expected, not
discovered as a bug report.

### 4. `lib/actionShape.ts` — the two registries a new action must satisfy

`npm run audit:kinds` (CI) checks `ACTION_PERMISSIONS`, `SHAPES`, and every client dispatch
against each other — this is the exact gap that shipped six unguarded kinds before (I33, C1/H8).
- Add to `SHAPES` (~981, beside `upsertApplication`/`removeApplication`, the nearest precedent
  for a dedicated non-`config` action):
  ```ts
  upsertCareerOption: { id: req(idOrNull), kind: req(oneOf(new Set(['grade', 'track', 'developingToward']))), label: req(text), now },
  removeCareerOption: { id: req(id), now },
  ```
- Nothing to add to `CONFIG_OPS` — these are not `config` ops, and adding them there would be
  the wrong registry entirely (that list validates `config`'s own `op.k`, not top-level kinds).
- Confirm `app/api/workspace/route.ts`'s `SERVER_ONLY` set does **not** need either kind added —
  both are person-initiated (an Engagement Leader or Administrator acting from Configuration),
  not machine-only, so they belong in the client-dispatchable set by default (no entry needed;
  `SERVER_ONLY` is an exclusion list, not an inclusion one).

**Verified by:** `npm run audit:kinds` — "three registries and every client dispatch agree."

### 5. `lib/db/persist.ts` — the write that must not silently vanish

Checked directly: model persistence is not "any action that touched `state.model`" — it is an
explicit `switch (action.t)` whitelist (~1044-1054) naming exactly `setNotificationPref`,
`setClientChoice`, `upsertSavedView`, `deleteSavedView` and `config`; everything else falls to
`default: return` and writes nothing. This is precisely the C1/I1 shape (`docs/pending-actions.
md`'s I33 row): a client-dispatched, permission-checked, scenario-passing action that applies
optimistically in the browser, replays correctly in memory on the server, and is never written
— vanishing silently on the next load, discovered only by someone noticing their edit didn't
survive a refresh.

Add `case 'upsertCareerOption':` and `case 'removeCareerOption':` to that same case list,
falling into the existing `operatingModel.upsert` beside `config` — `careerOptions` lives in
`state.model` exactly like every vocabulary `config` already persists this way, so the same
whole-document write covers it. This is not optional and not a follow-up: without it, commit 1
is a feature that works until the first page reload.

**Verified by:** `npx tsc --noEmit`; a scenario cannot reach the database layer, so this is
checked by reading the diff against the case list above, and re-confirmed live in the manual
verification pass after commit 2 (save, reload, confirm it persisted).

### 6. A new scenario: `CAR1`

Proves, in one pass: (a) `career.manage` and `config.manage` are independent — a role holding
only `career.manage` can `upsertCareerOption` and override somebody else's career field, and a
role holding only `config.manage` (without `career.manage`) is refused both; (b) self-editing
needs neither permission; (c) `upsertCareerOption` refuses a same-kind label clash but allows
the same label under a different `kind`; (d) `removeCareerOption` is refused while a live person
holds that value, and succeeds once nobody does; (e) a person's pre-existing grade that names no
live option is untouched by any of the above (the `unlisted`-at-the-picker case is a UI-layer
proof, not this scenario's — see step 9 — but the reducer must not silently rewrite or refuse
it, which this scenario's setup checks by asserting the value is still exactly what was stored).

**Verified by:** `npm run validate:scenarios`; expect an additive `data/validation.json` diff
(one new scenario row appended) — unlike the Owner change, nothing existing is being redefined
here, so the usual "diff must be empty or additive" gate applies as normal this time.

### Commit 1

One commit: the entity, the permission, the two actions, both registries, and the scenario that
proves them are one unit — a subset doesn't typecheck (the `satisfies` assertion) or doesn't
pass `audit:kinds`.

## Commit 2 — the UI

### 7. `components/ConfigWorkspace.tsx` — the new screen

- A `careerOptions` tab, inserted **inside** the existing contiguous `'Vocabulary &
  classification'` run in `TABS` (Terminology, Work types, Disciplines, Skills, Custom fields,
  Responsibilities) — not appended after `Operating model`'s last entry. Per the 13 Sep rail-
  grouping plan's own warning, subgroup membership is read off first-seen contiguous position;
  splitting the run would either misplace this tab or fork the subgroup into two headers.
- Screen body: three sections (Grade, Track, Developing toward), each `liveCareerOptions(model,
  kind)` rendered as a plain add/rename/retire list — the same list shape Work types already
  uses (a name field, an Add button, a retire action per row), not a new component pattern.
- Gated on `career.manage` alone — **not** `career.manage || config.manage`. `lib/permissions.
  ts`'s own module comment states the invariant this must hold: "a control cannot be grey for
  one reason while the action it triggers is refused for another." The action
  (`upsertCareerOption`/`removeCareerOption`) is gated on `career.manage` alone in step 2; an OR
  here would show the Administrator an enabled Add button on deploy day — before the post-
  deploy step — that the funnel then refuses, which is exactly the control-says-one-thing-
  action-says-another failure that comment exists to rule out. Frozen-but-honest is correct
  here: `can()`'s own denial reason names what to go tick.

### 8. `components/IssueWorkspace.tsx` — dispatch wiring

- Two new props threaded to `ConfigWorkspace`, `onUpsertCareerOption` / `onRemoveCareerOption`,
  dispatching `{ t: 'upsertCareerOption', ... }` / `{ t: 'removeCareerOption', ... }` — the same
  shape `onUpsertApplication` already uses at line 2677-2678, not routed through `onConfig`
  (which is typed to accept only `ConfigOp`, and these deliberately are not one).

### 9. `components/ProfilePanel.tsx` — the select, and the real override path

This is the step that closes the actual UI gap the design's research surfaced: today `CareerField`
renders a plain read-only `<span>` for anybody who isn't the person themselves, full stop —
`config.manage` already permits an override in the reducer, but nothing in this screen has ever
offered the control. That gap is what this step fixes, not a regression to guard against.

- `mayManageCareer = can(model, actor, 'career.manage').allowed` — `career.manage` alone, same
  reasoning as step 7: Administrator gets it once the post-deploy step is done, not before, and
  the control must read that consistently with the action it triggers.
- `CareerField`'s `self: boolean` prop becomes `editable: boolean`, passed as `isSelf ||
  mayManageCareer` from each of the three call sites (~299-301).
- `CareerField`'s editable branch becomes a `<select>` sourced from `liveCareerOptions(model,
  kind)` plus the stored value appended when it names nothing currently offered — the exact
  `ownerOptionValues`-shape carry-forward the design specifies, reusing that pattern rather than
  inventing a second one. `UNASSIGNED`-equivalent here is an empty "none recorded" option, since
  career fields are optional and have no "Unassigned" concept of their own.
- The static note above the fields ("Grade, track and development are {name}'s own to state —
  you can see them, not edit them.") only renders when `!isSelf && !mayManageCareer` — the
  genuinely read-only case. When `mayManageCareer && !isSelf`, no note is needed; the select
  being enabled says enough, the same way no explanatory note sits above an admin-editable
  Overview field today.

**Verified by:** `npx tsc --noEmit`; `npx eslint components/ConfigWorkspace.tsx
components/IssueWorkspace.tsx components/ProfilePanel.tsx`; then live, in the browser, once
deployed (no scenario reaches JSX) — see the manual check below.

### Commit 2

One commit: the screen, its dispatch wiring, and the ProfilePanel change are meaningless split
apart (a screen with nothing to manage the list from, or a select with nothing to populate it).

## Required post-deploy step — not optional, not implicit

Immediately after commit 2 deploys:

1. **Configuration → Permissions → tick "Manage career levels" for Administrator and Engagement
   Leader, and save.** Until this happens, `upsertCareerOption`/`removeCareerOption` and the
   "set somebody else's career field" override are refused to everyone, including the
   Administrator — see the design's own section on why a new permission key does not reach an
   already-provisioned tenant just by shipping code. This is a two-checkbox, thirty-second fix,
   the same shape I27's own resolution took, not a rollback trigger.
2. **Seed the four real values through the new screen**: Grade — "Senior Technical Consultant",
   "Senior Functional Consultant", "Intern", "Growth Consultant"; Track — "X++", "SCM /
   manufacturing", "Sales and marketing"; Developing toward — "Analyst". These are the exact
   values already stated on Amolak, Dharmendra Kumar Dwivedi, Jaya Jothi R and M Tarun Kumar
   (`scripts/staffing-facts.ts`), added once by hand — not baked into `initModel`, per the
   design's "ships empty like `skills`" decision.

## Manual verification (no scenario reaches JSX)

Live, after both steps above: open Configuration → Vocabulary & classification → the new
career-options screen (its exact label TBD at implementation, matching Work types' naming
convention) as the Administrator; confirm the four seeded values appear split correctly across
Grade/Track/Developing toward. Open Amolak's profile as a *different* person holding
`ROLE_ENGAGEMENT_LEAD` (not Amolak) — confirm Grade/Track now render as enabled selects
pre-set to "Senior Technical Consultant"/"X++", change one, save, reload, confirm it persisted
with the correct `by`/audit attribution. Open the same profile as a person holding neither
`career.manage` nor `config.manage` — confirm the fields render read-only with the existing
"own to state" note. Sign in as Amolak himself — confirm his own fields are editable regardless
of any permission (self always may). Attempt to retire a career option currently held by a live
person from the Configuration screen — confirm the refusal names how many people hold it.

## What would send the design back

- If `career.manage` and `config.manage` turn out to need to be checked in more than the three
  places this plan touches (the two reducer arms' funnel entries, and `updateCareerProfile`'s
  in-arm check) — a caller this grep pass missed would mean re-scoping before shipping, the same
  standing rule the Owner plan named.
- If the post-deploy step (ticking `career.manage` for Administrator and Engagement Leader)
  turns out to be forgotten in practice long enough to matter — worth a five-minute check next
  time this screen or `updateCareerProfile`'s override is touched, the same standing reminder
  I27 left for `watch.conditions`, rather than a reason to weaken the gate back to an OR.
