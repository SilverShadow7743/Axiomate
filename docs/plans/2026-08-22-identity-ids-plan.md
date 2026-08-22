# Identity ids — implementation plan

Follows `docs/plans/2026-08-22-identity-ids-design.md` (approved 22 Aug 2026). Ordering
principle: the resolution and join helpers are pure and scenario-proven before any arm
stores an id; the migration stands alone; the backfill runs last because it is the one step
that touches production data and its report needs the operator's eyes.

Design constraints, quoted: *"ambiguity resolves to null, never a guess"*; *"id match wins;
a name match is accepted only when ref.id is null"*; *"audit-style fields … are NEVER
migrated"*; *"the backfill … guesses nothing"*.

## Steps

**1. Pure helpers — `lib/access.ts` (`directoryIdByName`), `lib/person.ts` (new,
`samePerson`).**
`directoryIdByName(model, name)`: trim, case-insensitive, unique match over
`model.people`; two live matches → null. `samePerson(model, ref, person)`: `ref.id` set →
id equality only; `ref.id` null/undefined → name fallback (trim, case-insensitive).
*Verify:* `npx tsc --noEmit`; driven by ID1 in step 4.

**2. Types + write-path resolution — `lib/workspace.ts`, `lib/notifications.ts`,
`lib/capacity.ts`, `lib/time.ts`, `lib/timesheet.ts` (types only where the interfaces
live).**
Optional fields (`ownerId?`, `personId?`, `toId?`: `string | null`) on IssueRecord,
TimeEntry, Timesheet, Allocation, Commitment, Notification — optional so every existing
constructor and mapper compiles before step 5. Arms resolve-and-store:
`create`/`duplicate`/`updateIssue` (owner — including the availability path and the
assignment notification's `toId`), `addTime`/`updateTime` (person; update re-resolves only
when the patch moves person), `submitTimesheet` (workspace.ts:4305), `upsertAllocation`
(5064), `upsertCommitment` (5160), `notify` (4350) and the two reducer-minted notifications
(assignment, intake-arrival). `upsertPerson` (5863): the rename sweep retires for
id-carrying records; keep a warning naming pre-backfill rows that would detach.
*Verify:* `npx tsc --noEmit`; ID1.

**3. Read-path joins — `lib/mywork.ts`, `lib/notifications.ts` (`inboxFor`,
`unreadCount`), `lib/capacity.ts`, `lib/time.ts` (daily cap), `lib/timesheet.ts`
(`weekStateFor`, self-approval check), `lib/goals.ts`.
THE STEP CARRYING THE MOST REGRESSION RISK** — it rewrites the joins every personal surface
stands on, and the failure mode is exactly the one being fixed: a wrong join empties
My Work, silences the cap warning, or lets a submitter approve their own week. Each
consumer swaps its name comparison for `samePerson`, resolving the viewing person via
`directoryPersonFor`. The self-approval check must compare BOTH ids and names — an id
mismatch with a name match is still the same person until backfill completes.
*Verify:* full suite — MW1/TW2/G verdicts improve, nothing regresses; the FAIL gate from
parsed JSON.

**4. Scenario ID1 — `scripts/scenario-validation.ts` (CRLF; python script file).**
Unique owner → `ownerId` stored; ambiguous name (two live entries) → null id, no guess;
directory rename → `myWork` and `inboxFor` still match by id; a null-id record still joins
by name; role-audience notification (`role:ROLE_X`) keeps `toId` null without error.
*Verify:* `npm run validate:scenarios` — ID1 PASS, 0 FAIL (parsed JSON).

**5. Storage — `prisma/schema.prisma` (+6 nullable columns), migration
`20260822000002_person_ids` via `prisma migrate diff` from the committed schema,
`lib/db/map.ts` (six mapper pairs extend), `scripts/persistence-proof.ts` (id round-trip;
rename-keeps-join case). No scrub changes — no new tables.
*Verify:* `npx prisma migrate deploy` (before code deploy), `npm run audit:persistence`
grows past 46/46, `npm run audit:tenancy` unchanged at 26.

**6. Backfill — `scripts/backfill-person-ids.ts` (new).**
Direct Prisma updates (not reducer replay — a data repair, per the design), per-table:
match by unique name, write only the id column, count written/ambiguous/unmatched, print
every non-match by name and table. Dry-run mode default; `--apply` to write.
*Verify:* dry-run against production shows the report; operator reviews; `--apply`; re-run
reports zero remaining unique matches.

**7. Sweep, deploy, and the incident-class check.**
Full sweep; clean-room release; deploy; then the one browser check that matters: rename a
test directory entry and watch My Work and the bell stay whole (the MW1 counter-case,
live). Checklist section 22 records it.

## Details most likely to be got wrong

- **Ambiguity means null.** Two live entries with one name must never resolve; deleted
  entries do not count as collisions.
- **`updateTime` re-resolves only when the patch moves `person`** — re-resolving on every
  edit would let a later directory change rewrite an attested row's join.
- **The assignment notification's `toId`** resolves from the NEW owner, in the same mint.
- **Role audiences** (`to: "role:…"`) never resolve to a person id — `toId` stays null and
  that is correct, not a failure.
- **Optional fields, `?? null` in mappers** — required fields would break every constructor
  and the load path before step 5 lands.
- **The backfill writes only the id column** — attested rows stay byte-identical otherwise.
- **`raisedBy` is untouchable** — it is a claim, and outbound mail resolves recipients from
  it as claimed.

## Commits

Steps 1–2 together (helpers are meaningless unstored). Step 3 alone (the risky one reviews
best in isolation). Step 4 alone. Step 5 alone (carries the migration). Step 6 alone. Step 7
with the checklist record.

## What would send the design back

- A consumer proves to need a REQUIRED id (surfaces in step 3) — the nullable-fallback
  design splits into required-vs-soft joins.
- The production dry-run reports collisions at scale (surfaces in step 6) — a manual
  mapping table joins the design.
- Role audiences need real resolution (surfaces in step 4) — an audience kind, not a bent
  `toId`.
