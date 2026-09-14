# Career master lists: Grade, Track, Developing toward — design

Nishant, 14 Sep: "grade, track and developing toward need to be choosen from a prefilled drop
down which will be filled by engagement leader" — clarified to "master needed" (a managed
vocabulary, not per-record free text). Confirmed via AskUserQuestion: all three fields become
dropdowns; an Engagement Leader can set them directly on anyone's profile, not only their own;
a new permission, scoped to Engagement Leader, gates that — not `config.manage`.

## What's actually true today (checked before designing, not assumed)

Two facts change the shape of this feature from how the request first read:

**Engagement Leader already holds full platform-config access.** Checked live, 14 Sep,
Configuration → Permissions: `ROLE_ENGAGEMENT_LEAD` has "Configure the platform"
(`config.manage`) checked, held by both people in that role today. `updateCareerProfile`'s
existing gate (`lib/workspace.ts:6566`) is "self, or `config.manage`" — so an Engagement Leader
can *already* set anyone's career fields, and can already manage every other configurable
vocabulary. This feature is not granting a new capability to that role; it's giving career
management its own narrow authority so it stops riding on the broadest one, which is what makes
it possible to narrow `config.manage` away from Engagement Leader later without breaking this.

**Only 4 of 25 active people carry any career data today, and all four are genuinely stated,
not seeded.** Checked live: Amolak (Senior Technical Consultant · X++), Dharmendra Kumar Dwivedi
(Senior Functional Consultant · SCM / manufacturing), Jaya Jothi R (Intern, developing toward
Analyst), M Tarun Kumar (Growth Consultant · Sales and marketing). These match
`scripts/staffing-facts.ts`'s `CAREERS` array exactly — recorded 17 Aug 2026 by the operating
partner, `source: 'stated'`. Nobody else has touched their own Career tab since it shipped
24 Aug. The master lists start from these four real values, not a guessed or shipped default
list — the same "seeded from what's actually said, never invented" rule `WorkType` and `Skill`
already follow (`lib/config.ts`'s own comments on both).

## The vocabulary: one shared entity, not three

`Grade`, `Track` and `Developing toward` are the same shape — a short label a firm names and
retires over time — so this is one new entity with a `kind` discriminator, not three
near-identical types:

```ts
export interface CareerOption {
  id: string
  kind: 'grade' | 'track' | 'developingToward'
  label: string
  deletedAt: string | null
}
```

`model.careerOptions: Record<string, CareerOption>`. Ships empty on a brand-new tenant — the
same choice already made for `model.skills` ("There is no SEED_SKILLS"): a firm's grades and
tracks are not universal the way a Risk or a Decision work type is, and pre-loading a list
would be exactly the fabrication `config.ts`'s own comment on `Person.grade` warns against.
Production's four real values are added once, by hand, through the new Configuration screen
after this ships — not baked into `initModel`, for the same reason.

One Configuration screen (`Vocabulary & classification`, beside Work types / Disciplines /
Skills), three sections — Grade, Track, Developing toward — each a plain add/rename/retire list
like Work types today. Uniqueness is checked within a `kind`, not across all three: "Analyst"
could sensibly be both a grade and a developing-toward target for someone else.

## The permission: `career.manage`, held by Engagement Leader and Administrator only

A new key in `PERMISSIONS` (`lib/access.ts`):

```
{ key: 'career.manage', label: 'Manage career levels', what: 'Add or retire grades, tracks and developing-toward targets, and set them directly on anyone's profile.' }
```

`DEFAULT_GRANTS[ROLE_ENGAGEMENT_LEAD]` gains `'career.manage'` alongside its existing
`config.manage`. No other role gets it by default. Administrator holds it automatically (`ALL`
already includes every key), so nothing about admin's reach changes.

Two places use it, and neither needs the funnel touched:

- **`updateCareerProfile`'s arm** (`workspace.ts:6555`): the admin-override half of "self, or
  ___" changes from `config.manage` to `career.manage`. Since both roles that hold
  `config.manage` today (Administrator, Engagement Leader) will hold `career.manage` too, this
  is not a narrowing of who can do it today — it's redirecting the check to the permission that
  actually names the capability, so a firm can later remove `config.manage` from Engagement
  Leader without silently taking career-editing with it.
- **The new `upsertCareerOption` / `removeCareerOption` actions** get a straight
  `'career.manage'` entry in `ACTION_PERMISSIONS` — a dedicated action pair, not another
  `ConfigOp` under the shared `config` action. The `config` action is gated by one blanket
  `config.manage` check at the funnel (`workspace.ts:2175`, `apply()`'s single capability
  check, deliberately one check for every config op); folding career vocabulary in there would
  mean either granting `config.manage` after all or carving a permission-OR exception into that
  funnel, which is a new kind of exception — the two existing ones there (`guardOnly`,
  `notifyGuardOnly`) reclassify machine bookkeeping to a *different single* permission, not a
  second, weaker authority over a genuine config op. A dedicated action needs no funnel change
  at all: `permissionForAction('upsertCareerOption')` just returns `'career.manage'`, and the
  `ACTION_PERMISSIONS satisfies Record<Action['t'], …>` assertion (`access.ts:483`) covers it
  the same way it covers every other action.

`accessProblems`'s lockout check (`access.ts:696`) is specific to `config.manage` — "somebody
reachable must be able to configure the platform." Career vocabulary going unmanaged is not
that kind of lockout (nothing about the platform becomes unusable), so no equivalent check is
added for `career.manage`.

**A new permission key does not reach an already-provisioned tenant just by adding it to
`DEFAULT_GRANTS`** — this is the same shape I27 already found and fixed once
(`docs/pending-actions.md:210`, `watch.conditions`). Checked directly, `mergeModel`'s handling
of `access` (`lib/config.ts:1867-1873`) merges `grants` one *role* at a time — `{ ...seed.
access.grants, ...(stored.access?.grants ?? {}) }` — so a role already present in the stored
policy (every seeded role, in a tenant this old) keeps its stored array wholesale; the seed's
array for that same role, `career.manage` included, is never consulted. `ROLE_ADMIN` is not
special-cased either — `can()` reads `model.access.grants[roleId]` with no admin bypass, so even
Administrator's stored grants are a frozen snapshot from whenever they were last saved, not
`ALL` recomputed live. Concretely: on the day this ships, `career.manage` is checked into the
new Permissions column for every role, unchecked for every one of them, including
Administrator — until somebody ticks it and saves.

This is not a design flaw to route around in code (an `OR config.manage` fallback would work
but permanently defeats the point of decoupling career authority from platform authority, which
is the whole reason for a new key). It is a **named, required, one-time post-deploy step**,
the same shape I27's own fix took: immediately after this deploys, open Configuration →
Permissions and tick "Manage career levels" for Administrator and Engagement Leader, and save.
Nothing is unreachable in the meantime — `config.manage` is untouched, so Configuration →
Permissions itself stays open to the Administrator throughout — but until that box is ticked,
`upsertCareerOption`/`removeCareerOption` and the "set somebody else's career field" override
are refused to everyone, including Administrator. The implementation plan calls this out as its
own verification step, not an afterthought.

## The reducer stays permissive, same as Owner

`career()` (`workspace.ts:8058`), the helper `upsertPerson` and `updateCareerProfile` both call
to build the patch, does not start validating grade/track/developingToward against the master
list. This mirrors the Owner field's own choice (`lib/access.ts`'s `isUnresolvedOwnerName`
comment, scenario G): the picker constrains what a person can normally choose; the write path
stays permissive rather than hard-refusing, which is what let the nine pre-existing dual-owner
values keep working after Owner became a strict select. The same shape here means a value
already on a person's profile that predates the master list, or that later drops out of it,
keeps showing and stays selectable via the same `unlisted`-carries-forward mechanism
`ownerChoicesFor` already established — not reinvented, reused.

`removeCareerOption` follows `deleteSkill`'s shape instead (refused while anybody currently
holds that value), not Owner's carry-forward shape — because a career option is a catalogue
entry referenced by a live fact on a person's profile, the same relationship a skill or a work
type has, not a picker resolving against a directory that people leave and rejoin.

## ProfilePanel: three free-text inputs become three selects

`CareerField` (`components/ProfilePanel.tsx:497`) currently renders a plain text input. It
becomes a `<select>` sourced from `liveCareerOptions(model, kind)`, options built the same way
`ownerOptionValues` builds them: the live list for that kind, plus the stored value appended
when it names nothing currently offered (covers the pre-master-list era and a retired option).
`onUpdateCareer` and the `updateCareerProfile` action are unchanged in shape — only what feeds
the control's options changes.

**Who can edit which profile, unchanged in structure, one substitution:** the panel's own
`isSelf` check (already there, since career is "the person's own to state") stays; the
"somebody else may still edit" branch, which today reads as `config.manage` in the reducer's
denial message, now reads `career.manage`. Self-editing is untouched — everyone keeps the
ability to state their own career from the same dropdown; `career.manage` is only what lets a
second person set it on somebody else's profile, exactly as `config.manage` alone does today.

## The two registries a dedicated action pair must also update

A top-level action needs more than `ACTION_PERMISSIONS`. `scripts/action-kinds-audit.mjs`
(`npm run audit:kinds`, run in CI) checks three registries against each other and against every
client dispatch; missing one is exactly how six kinds shipped unguarded before (`I33`, C1/H8).
`upsertCareerOption` and `removeCareerOption` need: a `ConfigOp`-sibling entry in `Action`
itself (`lib/workspace.ts`), a shape entry in `lib/actionShape.ts`'s `SHAPES` map (the
per-top-level-kind validator — separate from `CONFIG_OPS`, which only validates `config`'s own
`op.k`, and not the list to extend since these are not `config` ops), and the
`ACTION_PERMISSIONS` line already described. The plan enumerates the exact three edits.

## Where the new screen sits

The Configuration rail's `Vocabulary & classification` subgroup (Terminology, Work types,
Disciplines, Skills, Custom fields, Responsibilities — grouped 13 Sep) is where this belongs.
Per that grouping's own plan, subgroup membership is read off first-seen contiguous position in
the `TABS` array — the new `careerOptions` tab's entry has to sit inside that existing
contiguous run, not appended after `Operating model`'s last entry, or it either renders under
the wrong header or splits the subgroup into two.

## What would send this back

- If a firm turns out to want per-grade or per-track ownership (e.g. only certain Engagement
  Leaders may manage the Technical track's grades) — this design has one flat permission for
  the whole vocabulary, the same granularity Work types and Disciplines already have. A firm
  that needs finer scoping than that needs a bigger design than this one.
- If retiring a career option turns out to need to happen while people still hold it (a firm
  renaming rather than retiring) — `deleteSkill`'s refuse-while-in-use precedent assumes
  rename-in-place (`upsertCareerOption` with an existing id) covers that case instead, which is
  true for Skill and Work type today and should hold here too, but is worth confirming against
  the actual UI flow at implementation time.
