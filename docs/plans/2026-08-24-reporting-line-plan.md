# A reporting line — implementation plan

Follows `docs/plans/2026-08-24-reporting-line-design.md`, approved. Its own words settle the
shape: "the same absent-versus-cleared field shape `clientScopeId` already has" for the data, and
"the same 'reassign them first' shape `deleteRole` and `deleteProjectRole` already use" for the
one behaviour change to existing code. Neither is open to reinterpretation here.

Smaller than the last four builds in this program in one concrete way, confirmed while reading
`lib/actionShape.ts`: `upsertPerson`'s individual fields are not shape-validated at the wire
boundary at all — `CONFIG_OPS` only checks that `op.k` names a real operation, and `grade`/
`track`/`developingToward` are type-checked inside the reducer arm itself instead, by an explicit
decision the arm's own comment records. `managerId` follows that same existing pattern, so this
plan touches no `actionShape.ts` line, and needs no storage step at all — `Person` lives inside
`OperatingModel`, already reached through `upsertPerson`.

## Step 1 — The one piece of pure logic: cycle detection

**Touches:** `lib/config.ts` (`Person.managerId?: string | null`, and
`wouldCreateManagerCycle(people, personId, newManagerId): boolean`, exported so it is drivable on
its own rather than only inferable from `upsertPerson`'s refusal), the `ConfigOp` union's
`upsertPerson` variant in `lib/workspace.ts` (`managerId?: string | null`, same optional shape as
`clientScopeId` beside it).

`wouldCreateManagerCycle` walks upward from `newManagerId` through each person's own `managerId`,
the same "walk until you either run out or come back to where you started" shape a cycle check
always is — guarded against an already-corrupt chain looping forever the same way `depthOf`
(`lib/db/repo.ts:548`) guards its own upward walk, with a visited set rather than trusting the
data has no cycle already.

**Verified:** three scenarios in `scripts/scenario-validation.ts`, driving the function directly
against a hand-built `people` record — no reducer, no database:

- **RL1** — A managing B managing C: proposing C as A's manager is refused (the three-hop cycle).
- **RL2** — A managing B: proposing A as B's manager directly is refused (the immediate cycle).
- **RL3** — A managing B, and a wholly unrelated C: proposing C as A's manager is allowed — a
  cycle check that always refused would also pass RL1/RL2, so this is what proves it discriminates.

`npm run validate:scenarios` — RL1–RL3 PASS, nothing regresses. `npx tsc --noEmit` clean.

## Step 2 — The reducer: `upsertPerson`'s new checks, and `deletePerson`'s new refusal

**Touches:** `lib/workspace.ts`'s `upsertPerson` and `deletePerson` arms (`lib/workspace.ts:6815`
and `:6896`).

`upsertPerson` gains, in the same place `clientScopeId`'s own check already sits: `op.managerId`,
if set, must resolve to a real, non-deleted person in `m.people`; must not equal the id being
edited (`id` computed a few lines above, from `op.id ?? PERSON_${m.seq}` — the check has to read
this resolved id, not `op.id`, since a brand-new person's `op.id` is `null`); and
`wouldCreateManagerCycle(m.people, id, op.managerId)` must be false. The field itself follows
`clientScopeId`'s exact absent-versus-cleared construction (`op.managerId !== undefined ? ... :
existing?.managerId ? ... : {}`) — the detail most likely to be copied wrong is reusing
`clientScopeId`'s literal lines instead of `managerId`'s own, which would silently make one
optional-reference field track the other.

`deletePerson` gains one check before its existing unconditional delete: `Object.values(m.people).filter(p
=> p.managerId === op.id)` — if any, refuse, naming how many and the person's name, the same
message shape `deleteRole`'s "N people hold X. Reassign them first" already uses.

**This is the step carrying the most regression risk in this plan.** `deletePerson` deletes
outright today, unconditionally, and every existing caller of it expects that. Adding a refusal
path changes its contract for the first time — a deletion that used to always succeed now
sometimes doesn't, and anything that called it assuming success (a config screen's optimistic UI,
say) needs to handle the refusal the same way every other config op's refusal already is.

**Verified:**

- **RL4** — `upsertPerson` refuses a `managerId` that resolves to nobody.
- **RL5** — `upsertPerson` refuses a person naming themselves as their own manager.
- **RL6** — `upsertPerson` refuses a `managerId` that `wouldCreateManagerCycle` would refuse —
  proving the reducer arm actually calls the function step 1 proved correct, not a second,
  possibly-different check.
- **RL7** — `deletePerson` refuses to delete someone with a direct report, naming them; succeeds
  once nobody reports to them.

`npm run validate:scenarios` and `npx tsc --noEmit` clean. **Stands alone as a commit** — the
cycle-check function from step 1 is pure and inert until this step calls it; nothing existing
changes behaviour until this step ships, except the one deliberate exception named above
(`deletePerson`'s new refusal), which is why this step — not step 1 — is the one carrying risk.

## Step 3 — The screen

**Touches:** `components/ConfigWorkspace.tsx`'s existing person-editing card (the same card
`grade`/`track`/`roleIds` are already edited on) gains a "Reports to" select — directory people
only, excluding the person being edited themselves (client-side, before the reducer's own check
ever runs — the same UX shape a firm expects: a control that would only ever be refused should not
be offered as though it might work).

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`. No new scenario — this is a form control
over already-correct, already-proven validation (steps 1–2), the same reasoning every screen-only
step in this program's last four builds gave for itself.

## Commit boundaries

- Step 1 stands alone (pure, inert).
- Step 2 stands alone — it is the step that changes `deletePerson`'s existing contract, and it
  is where this plan's actual risk lives.
- Step 3 stands alone (the screen, no logic).

## After this ships

Not part of the build, and not a plan step: once verified, `Nishant Sekhar` should actually be
recorded as the reporting manager for the people he leads as Engagement Leader — a data-entry
action through the shipped screen (or one `upsertPerson` config op per person, the same way this
program has entered real facts before), not something this plan backfills automatically. There is
no existing signal to derive it from the way project membership's backfill had one; it is a fact
somebody states, the same as every other field on `Person`.

## What would send this back to the design

- If step 1's cycle check, once real directory data is tried against it, needs more than a single
  upward walk — a diamond-shaped reporting structure this design didn't anticipate, say — that is
  a real gap in "walk up and check," not a detail to patch around in the reducer arm.
- If step 2's `deletePerson` refusal turns out to break an existing flow this design didn't
  anticipate (an automated cleanup that deletes people in bulk and expects it to always succeed,
  for instance) — that is a finding about existing behaviour this design's own send-back list
  already named, and it stops there rather than being special-cased away.
