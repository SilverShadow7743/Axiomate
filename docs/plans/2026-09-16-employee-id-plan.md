# Employee ID — implementation plan

Follows `docs/plans/2026-09-16-employee-id-design.md`. Pure logic first (the id generator, the
permission predicate), then the reducer arm that calls them, then the scenario that proves the
reducer arm, then the two UI display points, then the one-off backfill script last — it is the
only step that touches production data and the only one a scenario cannot cover.

## 1. `lib/config.ts` — `Person.employeeId` and `nextEmployeeId`

- `Person` (~287): add `employeeId?: string` after `id`, with a doc comment distinguishing it
  from `id` — `id` is the internal `PERSON_n` key nothing outside the database sees; `employeeId`
  is `AX-####`, visible, assigned once, never reassigned, and only to people whose roles grant
  `internal.view` (see `lib/access.ts`'s `rolesGrant`, added in step 2). Note the location-coded
  format considered and deferred (design doc) so a future reader doesn't assume this was
  overlooked.
- `nextEmployeeId(people: Record<string, Person>): string` beside `nextCareerOptionId` — scans
  existing `employeeId` values matching `/^AX-(\d+)$/`, returns `AX-` + one past the max,
  zero-padded to four digits below 10000.

**Verified by:** `npx tsc --noEmit`.

## 2. `lib/access.ts` — `rolesGrant`

- `export function rolesGrant(model: OperatingModel, roleIds: string[], key: PermissionKey):
  boolean { return roleIds.some((r) => (model.access.grants[r] ?? []).includes(key)) }`, placed
  beside `permissionsFor` with a comment naming what it's for: the same question `permissionsFor`
  asks of a signed-in actor's own roles, asked directly of a roster a reducer already has in
  hand, without round-tripping through `directoryPersonFor` (which needs the person to already
  exist in `model.people` — not true for a brand-new hire mid-`upsertPerson`).
- Reads `model.access.grants` (stored config), not `DEFAULT_GRANTS` — deliberate, so it answers
  correctly for a tenant's actual configuration including custom roles this code has never heard
  of. This is the detail most likely to be got wrong in reverse: reaching for `DEFAULT_GRANTS`
  here would be the I27 mistake (shipped default treated as if it were stored fact) in a new
  place.

**Verified by:** `npx tsc --noEmit`.

## 3. `lib/workspace.ts` — lazy assignment in `case 'upsertPerson':`

- Inside the existing `person: Person = { ... }` object literal (~8938-9007), add one line
  following the same absent-versus-carried convention every other optional field in that literal
  already uses:
  ```ts
  ...(existing?.employeeId
    ? { employeeId: existing.employeeId }
    : rolesGrant(m, person.roleIds, 'internal.view')
      ? { employeeId: nextEmployeeId(m.people) }
      : {}),
  ```
  Placed after `roleIds` is assigned in the same literal (line 8941) so `person.roleIds` — the
  post-filter, about-to-be-live value — is what eligibility is checked against, not `op.roleIds`
  (unfiltered) or `existing?.roleIds` (stale).
- No new `Action` variant, no new permission, no `persist.ts` case: `upsertPerson` is an existing
  `ConfigOp`, gated on `config.manage` same as always, persisted whole through `persist.ts`'s
  generic `case 'config':`. This step changes only what one `ConfigOp` arm computes, not how
  anything is dispatched, checked, or written.
- `employeeId` is never read from `op` anywhere in this arm — confirm no line does `op.employeeId`
  — so a client cannot supply or overwrite it.

**Verified by:** `npx tsc --noEmit`; `npx eslint lib/workspace.ts lib/access.ts lib/config.ts`.

**The step carrying the most regression risk:** this is the always-succeeding path every person
create and every person edit already goes through — the same file `career()`'s carry-forward
logic lives in, a few hundred lines up. A mistake here doesn't fail loudly; it either (a) mints an
`AX-####` for a client contact whose roles happen to carry `internal.view` through some future
misconfiguration, which is silent and wrong in the audit-trail sense but not destructive, or (b)
throws inside a reducer that currently never throws for a well-formed op, turning every ordinary
person edit into a 500. Guard against (b) specifically: `m.access.grants[r] ?? []` inside
`rolesGrant` (already written that way in step 2) is what prevents a role with no stored grants
entry from throwing on `.includes`.

## 4. A new scenario: `EMP1`

Proves, in one pass: (a) a brand-new person created with a role that grants `internal.view`
(e.g. `ROLE_TECHNICAL`) receives an `employeeId` matching `AX-\d{4}`; (b) a brand-new person
created with only `ROLE_CLIENT_USER` receives none; (c) editing an existing internal person's
`title` (an unrelated field) leaves their `employeeId` exactly as it was — proves the carry-
forward branch, not just the assignment branch; (d) removing every internal role from a person
who already has an `employeeId` (an edit that would make them ineligible if evaluated fresh)
does **not** strip the id already held — the carry-forward check runs before the eligibility
check, by construction, and this scenario is what proves that ordering rather than assuming it.

**Verified by:** `npm run validate:scenarios`; expect an additive `data/validation.json` diff
(one new scenario row appended, nothing else changed).

### Commit 1

Steps 1-4 as one commit: the field, the two helpers, the reducer line, and the scenario that
proves them are one unit — the helpers have no other caller yet, so a subset doesn't do anything
observable on its own.

## 5. `components/PeopleDirectory.tsx` — `ID` column

- New `<th>ID</th>` in the header row (~241, before `Title` — the id is the first thing a
  director-of-record view of a roster wants), and a matching `<td className="mono">{p.employeeId
  ?? <span className="prov">—</span>}</td>` in the body row, same em-dash convention `Joined`
  already uses for "not recorded."
- Not a `header(...)`-sortable column — `SortKey` doesn't need an `'employeeId'` case; the list
  already assigns roughly-chronological order via the backfill and via creation order, and
  sorting by a zero-padded string is trivial but not something the design asked for. Adding a
  sort key nobody requested is exactly the scope creep the design doc's "what this doesn't do"
  section is there to keep out.

**Verified by:** `npx tsc --noEmit`; `npx eslint components/PeopleDirectory.tsx`.

## 6. `components/ProfilePanel.tsx` — Overview row

- One new line inside the `Overview` section's `profile-facts` block (~203-206, alongside `Work
  address`/`Title`/`Phone`/`Joined`): `<Fact label="Employee ID" editable={false} value={person.
  employeeId ?? ''} display={person.employeeId ?? '—'} onSave={() => true} />`.
- `editable` is the literal `false`, not `mayConfigure` or any permission — there is no path by
  which this field is ever editable, by anyone, so there is nothing to gate. `onSave` is `Fact`'s
  required prop; it is never invoked because `editable` is always false, so `() => true` is a
  type-satisfying no-op, not dead logic worth naming a real handler for.

**Verified by:** `npx tsc --noEmit`; `npx eslint components/ProfilePanel.tsx`.

### Commit 2

Steps 5-6 as one commit: two independent display points for the same field, neither depending on
the other, but both trivial enough that splitting them into separate commits would be ceremony
without benefit.

## 7. `scripts/backfill-employee-ids.mjs` — the one-off backfill

Run manually, once, against production, after commit 2 deploys. Not wired into any npm script
that runs automatically, and not part of the app bundle — a standalone Node script using the
same write path the earlier career-data-seeding script used (referenced in `persist.ts`'s
`updateCareerProfile` comment).

- Reads the live model (however the existing one-off script pattern reads it — check that
  script's approach before writing a new one, rather than inventing a second convention for
  "how a one-off script talks to production").
- Filters to `status !== 'Departed'` people where `rolesGrant(model, p.roleIds, 'internal.view')`
  is true and `p.employeeId` is unset.
- **Prints the full candidate list — name, role labels, `employeeId: none` — and stops without
  writing anything until re-run with an explicit `--apply` flag (or equivalent confirmation
  gate).** This is not a UX nicety; it is the live check the design doc flags as impossible to
  do from source (I27 precedent: a custom role's *stored* grants can differ from what its name
  implies). Before ever passing `--apply`, the printed list is checked by hand against the two
  named exclusions — "Nishant (OAPIL Guest)" and "Client Process Lead" must not appear — and
  against the seven expected internal roles, which must.
- Sorts confirmed candidates by `joinedOn` ascending (people with no `joinedOn` last, then by
  name), so low numbers land on the longest-tenured people.
- For each, dispatches through the app's normal write path exactly as `{t:'config',
  op:{k:'upsertPerson', id: p.id, name: p.name, roleIds: p.roleIds}}` —
  **`roleIds` copied byte-for-byte from the live record.** This is the single detail this plan
  most wants a future reader not to get wrong: `case 'upsertPerson':`'s reducer arm has no
  carry-forward for `roleIds` (`roleIds: op.roleIds.filter(...)`, no `existing` fallback, unlike
  every other optional field in that object literal) — sending `[]` or omitting it strips the
  person's roles and, because the actor dispatching is not the person themselves, fires a "Your
  record changed" notification at them as a side effect (~9019-9037). `grade`/`track`/
  `developingToward` are left **out of the op entirely** — not sent as empty strings — because
  `career()` only overwrites a field when `op` explicitly sends it (`pick` returns the existing
  value when `sent === undefined`); sending empty strings would wipe the career data added this
  week for every backfilled person who has any.

**Verified by:** no scenario reaches a standalone script; verified by running it without
`--apply` first and reading its printed output against the two exclusions and seven expected
roles by hand, then running with `--apply` and re-reading the People list and a few profiles
live (see below) to confirm the assigned ids and confirm career fields on the four people with
career data are untouched.

### Commit 3 (or folded into commit 2 — author's call at implementation time)

The script is operational tooling, not application code with a test surface; whether it rides
with commit 2 or stands alone doesn't change what it does. Keep it out of commit 1, since commit
1 has no UI yet to verify a backfilled person's id against.

## Deploy and verify

Push, watch CI (`gh run watch` or a direct `gh run view --json status,conclusion` check if the
watch goes quiet — both runs this month have shown the watch itself timing out silently while the
run in fact completed). Once `verify` and `deploy` both report `success`:

1. In the browser, as the Administrator: open People, confirm the new `ID` column renders (empty
   for everyone, pre-backfill).
2. Create one throwaway test person with `ROLE_TECHNICAL` — confirm they appear with `AX-0001` (or
   the next number in sequence) in both the People list and their own Profile Overview. Create a
   second throwaway person with only `ROLE_CLIENT_USER` — confirm no id appears anywhere for them.
   Delete both test people's directory entries afterward (or mark departed, whichever the People
   screen supports) so production is left clean — same discipline as every other feature this
   engagement has live-verified.
3. Run `scripts/backfill-employee-ids.mjs` without `--apply`; read the printed list; confirm the
   two named exclusions are absent and the seven internal roles are represented; confirm the
   count looks like "current headcount minus two excluded roles."
4. Re-run with `--apply`. Reload the People list — confirm every internal person now shows an
   `AX-####` id and every client contact still shows none. Open Amolak's profile (one of the four
   people with career data) — confirm Grade/Track/Developing toward are unchanged by the backfill
   dispatch that also gave him an id.

## What would send the design back

- If the backfill script's dry-run print shows `internal.view` resolving true for "Nishant (OAPIL
  Guest)" or "Client Process Lead" against production's actual stored grants — this means the
  design's core predicate (permission, not role list) doesn't match this tenant's real
  configuration, and needs the user's call on whether to fix that role's grants or add an
  explicit exclusion, not a workaround invented at script-writing time. Surfaces at step 7,
  before any write happens — which is the point of the dry-run gate.
- Checked, not left as a risk: `rolesGrant` is called with `person.roleIds` directly (the
  literal array on the record being written), never through `rolesFor`'s actor-resolution
  fallback — so `defaultRoleIds` (what an actor with zero roles inherits, `rolesFor`'s own
  concern) never enters this check. A person created with `roleIds: []` trivially fails
  `.some(...)` on an empty array and gets no id, regardless of what the tenant's default role is
  configured to. Nothing here to re-verify at implementation time.
