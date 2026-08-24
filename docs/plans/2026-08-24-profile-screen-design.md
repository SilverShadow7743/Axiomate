# A profile screen — design

## What this answers

The reporting-line design (`docs/plans/2026-08-24-reporting-line-design.md`) named this and set it
aside: *"this app has no 'My Profile' screen yet... where else [`managerId`] surfaces is a later
question."* Checked before designing anything: `Person` (`lib/config.ts:220`) now carries name,
email, roleIds, clientScopeId, grade, track, developingToward, source and managerId — nine facts
about somebody, all enterable through the People config card, none of them viewable anywhere
except that one admin-gated table row. `Skill`/`PersonSkill` (`lib/skills.ts`) are recorded per
person and already redacted per reader at the boundary, but the only screen that shows them is
the Skills config tab, one flat table across everyone.

This design gives a directory entry a page of its own: identity and org facts, plus recorded
skills, readable for any colleague and editable in one narrow place for yourself.

## What this is

**Not a new `WorkspaceView`.** `lib/viewChoice.ts`'s `WorkspaceView` is a closed, parameterless
enum — `mywork`/`timesheet`/`inbox`/`mycalendar` are all inherently "your own," persisted across
reload by design. A profile needs a *target person id*, which that shape doesn't carry, and
"remember which colleague's profile I last had open" isn't behaviour anyone asked for the way
"remember I was on my Timesheet" is. Instead this follows `IssueWorkspace.tsx`'s other existing
pattern — ad-hoc panel state, the same shape as `timesheetsOpen`/`archiveOpen`/`slaOpen`:
`openProfileId: string | null`, set by clicking a name and cleared by closing the panel.

**Reachable from two places in v1**, deliberately narrow rather than wiring every name in the app:
the People config card (each row's name becomes the trigger, alongside the existing edit
controls), and the profile panel itself (its own reports-to and direct-reports lists are
clickable, so the org chart can be walked from any starting point). Nowhere else — an issue's
owner, a note's author — becomes clickable in this pass; those are separate surfaces with their
own reasons to add or not add it later.

**Content, read-only for anyone who isn't looking at their own:**

- Name, email, grade, track, developingToward, roleIds (labels resolved via `model.roles`) — the
  same facts the People card already shows, laid out as a page instead of a row.
- Reports to: `managerId` resolved to a name and made clickable. Direct reports: every person
  whose `managerId` equals this one's id (the same computation `deletePerson`'s refusal already
  makes inline at `lib/workspace.ts:6929` — pulled out to a small shared, exported function,
  `directReportsOf(people, id)`, next to `wouldCreateManagerCycle` in `lib/config.ts`, so the
  reducer's refusal and the screen's list can't drift apart).
- Skills: every live `PersonSkill` row for this person, skill name resolved from the catalogue,
  level/source/assessedBy/lastUsedOn/note — read exactly as `state.personSkills` arrives on the
  client. Rows already carry `withheld: true` and a null `level` for a reader without
  `skill.view`, the same redaction the Skills config tab already relies on
  (`components/ConfigWorkspace.tsx:4687`) — the profile adds no new gating, it reads the same
  already-redacted collection.

**Not shown:** `clientScopeId` (a fact about client-role seats, not about staff identity — out of
place on a profile aimed at colleagues viewing colleagues) and anything from `ResourceProfile` /
`PersonRate` (working pattern and rates were both explicitly scoped out earlier this session and
this design doesn't reopen that; rates in particular are permissioned and would need their own
redaction story this screen has no reason to take on).

## Self-edit

**Own profile only, and only three fields**: grade, track, developingToward — the same subset
`lib/workspace.ts:6269`'s existing `career()` helper already isolates inside `upsertPerson`. Name,
email, roleIds, managerId, clientScopeId stay admin-only, edited only through the People config
card as today — those aren't self-declared facts, and email in particular is the field a signed-in
person is matched on (`directoryPersonFor`), not something to make casually self-editable.

**A new action, `updateCareerProfile`**, not a carve-out inside `upsertPerson`/`config`. `config`
is gated as one block — `config: 'config.manage'` (`lib/access.ts:590`) — with no per-field or
per-op-kind split anywhere in `ACTION_PERMISSIONS`, and `upsertPerson`'s shape deliberately mixes
self-editable and admin-only fields in one op. The codebase has already solved "this fact is the
person's own, admin is the only exception" twice, and both times chose a dedicated action with the
permission table entry set to `null` and the arm deciding: `setNotificationPref`
(`lib/workspace.ts:5295`, `self = directoryPersonFor(state.model, actor)?.id === a.personId`) and
personal events (no admin exemption at all). `updateCareerProfile` follows `setNotificationPref`'s
exact shape — self-or-`config.manage`, refused otherwise, naming whose record it is in the
refusal — and its body is `career(a.patch, existing)`, the same pure function `upsertPerson` already
calls, so there is exactly one place that decides what counts as a valid grade/track/developingToward
patch, not two.

Four-point wiring this needs: `Action` union entry, `ACTION_PERMISSIONS['updateCareerProfile'] =
null`, an `actionShape.ts` SHAPES entry, and `app/api/workspace/route.ts`'s `KINDS` set (this is
browser-dispatched, unlike `recordInboundMail` — it belongs in `KINDS`).

## What this deliberately is not

**Not a second way to edit anything admin-only.** Roles, reports-to, client scope and identity
fields have exactly one edit path — the People config card — before and after this design. A
profile that let you *see* `managerId` but not touch it (unless it's your own career fields) is
the point, not an oversight.

**Not wired to every name in the app.** Only the People card and the profile's own reports-to/
direct-reports lists are clickable in this pass. An issue's owner or a note's author becoming a
profile link is a reasonable future extension with its own screens to touch and its own reason to
justify — not something this design does by default because it's easy.

**No new visibility rule for the identity/org fields.** `Person` records are already org-wide
visible to any `internal.view` holder — the same class of fact as what the People card shows
today. A reporting-line design already stated this and it holds here too.

**No new redaction for skills.** The profile reads `state.personSkills` exactly as delivered —
already redacted per reader at the boundary. Building a second check here would risk it disagreeing
with the one the Skills tab already trusts.

## What would send this back

- If `directReportsOf`, once pulled out as a shared function, turns out to need to be something
  richer than a flat filter (an org chart deep enough that "direct reports" alone doesn't answer
  what the screen needs) — that's a real gap in the extraction, not something to special-case in
  the component instead.
- If self-editing career fields through a *second* action turns out to produce a visible
  disagreement with what `upsertPerson` would have done with the same input — that would mean
  `career()` isn't as safely shared as this design assumes, and the two callers need to be
  reconciled before either ships further.
