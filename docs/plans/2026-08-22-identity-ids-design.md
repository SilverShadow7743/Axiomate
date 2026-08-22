# Identity ids — design

Remediation #1 of the register (22 Aug 2026). Awaiting approval. The prerequisite the guest
phase names, and the fix for the incident class the Tarun episode proved: records that key
people by display name silently empty when a name drifts.

## The problem, in the suite's own words

Three scenarios record it. MW1: a renamed person's My Work goes empty — "the join failed,
not because there is nothing to do". TW2: the daily-cap warning is silently absent when a
name does not resolve. G: "work can still be handed to a typo". The August identity fix had
to consolidate two directory entries by hand, sweep allocations by name, and could not touch
attested hours — that operation is what this design makes unnecessary.

## The one distinction everything follows

**Join fields identify who someone IS; audit fields record what was WRITTEN.** Join fields
must follow a person through renames, so they gain a directory id. Audit-style fields —
`createdBy`, `uploadedBy`, `raisedBy`, audit `by` — are facts about the moment of writing
and are NEVER migrated or rewritten. `raisedBy` especially: it is a claim from outside, not
a directory reference, and the outbound mail door depends on it staying exactly as claimed.

## Scope: which fields gain an id

| Record | Name field (kept) | New id field | Why it joins |
|---|---|---|---|
| Issue | `owner` | `ownerId` | My Work, assignment notifications, filters |
| TimeEntry | `person` | `personId` | daily caps, utilization, timesheets |
| Timesheet | `person` | `personId` | the freeze and approval join |
| Allocation | `person` | `personId` | capacity, availability |
| Commitment | `person` | `personId` | capacity, availability |
| Notification | `to` | `toId` | the inbox join |

All ids are the DIRECTORY id (`PERSON_63`) — stable and internal — never the provider's
object id, which belongs to the sign-in join that `directoryPersonFor` already owns
(id → email → name, strongest first). Ids are soft references like every other id here:
no foreign keys, because a removed directory entry must not cascade into records.

## Write path: resolve-and-store

A new pure helper in `lib/access.ts` (beside the join it mirrors):

```ts
directoryIdByName(model, name): string | null   // unique case-insensitive match, else null
```

Every reducer arm that writes a scoped name field resolves it at write time and stores both:
owner changes in `updateIssue`/`create`, time arms, allocation/commitment arms, and `notify`
(plus the two reducer-minted notifications). An ambiguous name — two live directory entries
sharing it — resolves to **null**, never to a guess: a wrong join is worse than a stated
absence. No arm starts REFUSING a name that fails to resolve — imported records and
not-yet-in-directory people are legitimate — but My Work's existing "join failed" honesty
extends everywhere a null id is load-bearing.

## Read path: id first, name fallback

One helper in a new `lib/person.ts`:

```ts
samePerson(model, ref: { name: string; id?: string | null }, person: Person): boolean
// id match wins; a name match is accepted only when ref.id is null (pre-backfill rows)
```

Consumers updated to use it: `lib/mywork.ts` (mine), `lib/notifications.ts`
(`inboxFor`/`unreadCount`), `lib/capacity.ts` (allocations/commitments for a person),
`lib/time.ts` (daily cap), `lib/timesheet.ts` (`weekStateFor`, approval self-check),
`lib/goals.ts` person measures. The id-wins rule is what makes a rename safe: after it, the
name on the record is stale display data, and the directory's current name renders instead
wherever the id resolves.

## Backfill

`scripts/backfill-person-ids.ts`, run once against production after deploy: for each scoped
record with a null id, resolve by unique name match and write the id via a targeted update
(NOT through the reducer — this is a data repair attributed to the script, logged per row).
Ambiguous and unmatched names are REPORTED, not guessed, in a summary the operator reviews.
Attested rows are safe by construction: the backfill writes only the new id column.

## Renames become one-field edits

With ids stored, `upsertPerson` rename no longer needs to sweep dependent tables. The rename
sweep in the config arm is retired for id-carrying records; a warning remains listing any
pre-backfill rows (null id, old name) that would detach.

## Storage

Six nullable columns, one additive migration (`prisma migrate diff`, applied before code
deploy). Mapper pairs extend; the persistence proof adds: an entry written with a resolved
id round-trips; a rename leaves the join intact (the MW1 counter-case, driven).

## Testing

Scenario ID1, pure: assign an owner who exists uniquely → `ownerId` stored; assign an
ambiguous name → id null; rename the directory entry → `myWork` still finds the work and the
notification inbox still matches (id-wins); a pre-backfill shaped record (id null) still
joins by name. TW2's stops-text updates: the cap warning now fires for id-joined entries.

## What would send this back

- A consumer needs the id to be REQUIRED (not nullable) to be correct — the null-fallback
  design is wrong for it, and the scope must split required-vs-soft joins.
- The backfill finds name collisions at a scale where "report, don't guess" leaves the
  register mostly unjoined — then a manual mapping table becomes part of the design.
- `Notification.to` role-audiences ("role:ROLE_X") turn out to need their own resolution
  rather than a null id — surfaces in ID1; the design would add an audience kind, not bend
  `toId`.
