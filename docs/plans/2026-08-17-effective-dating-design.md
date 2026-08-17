# Effective-dated history

**Status:** approved, 17 August 2026
**Applies to first:** the working pattern in `ResourceProfile`, and nothing else

## Why

Resource data is overwritten today. A person's working pattern, and later their role, manager,
location and cost rate, hold one value — the current one — and a change destroys the previous
one. That is fine until something has to be explained: a utilisation figure computed last
quarter, a margin on work delivered in March, a report that said something different when it was
run.

This cannot be retrofitted. History overwritten today cannot be recovered by a mechanism built
next year, which is the same argument that made `byId` on the audit trail urgent rather than
tidy.

## What was decided, and what was rejected

Two questions settled the shape.

**The history must be queryable, not merely readable.** `EstimateRevision` — the closest thing
this codebase already has — is *displayed* and never *replayed*: `EstimationTab` sorts revisions
newest-first and shows them, and nothing anywhere reconstructs a past state. So the existing
precedent proves the recording half and has never exercised the reading half. This design has to
do both, because a margin calculation on March work must find March's values in code rather than
by somebody looking them up.

**Corrections rewrite, except where something has already been acted on.** Full bitemporality —
keeping *when it was true* and *when we were told* as two independent, queryable axes — was
considered and rejected as roughly double the mechanism for a benefit largely available another
way: the audit trail already records when we were told, because a correction is itself an
audited change carrying from, to, when and by whom. That makes "what did we believe on 18 July"
answerable by **reading** the trail even though it is not **queryable** as an axis. The same
read-versus-query distinction, applied to the second dimension.

This also matches what the timesheet design already settled independently: *the rate must be
stamped at approval, not looked up later, or editing a rate silently rewrites every historical
invoice.*

## The record

```ts
interface Version<T> {
  id: string
  subjectKind: string        // 'person.workingPattern', 'person.role', …
  subjectId: string
  validFrom: string          // when it became true in the world
  validTo: string | null     // null means still true
  value: T                   // the whole value, not a delta
  recordedAt: string         // when we were told
  by: string
  byId?: string
  byEmail?: string | null
  reason: string
}
```

A snapshot rather than a delta, for the reason `EstimateRevision` already found: a snapshot
renders as history without assembly, and cannot be half-reconstructed.

`subjectKind` is present from the first version rather than added when the second entity needs
it. One shape, one query, one set of tests — the alternative is a table per kind, and a table per
kind is four chances to implement the overlap rule differently.

Note what is absent. There is no `supersededBy` and no second time axis; that was
bitemporality's machinery. A correction edits `validFrom`, `validTo` or `value` in place, and
that edit is audited like every other change.

## Two reads

```ts
valueAt<T>(versions, kind, id, on: string): Version<T> | null
timelineOf<T>(versions, kind, id): Version<T>[]
```

`valueAt` returns **null when no version covers the date** — never a default. A date before
somebody joined has no working pattern, and answering 7.5 hours would invent one. This is the
rule the codebase already keeps: `availabilityOf` answers `unknown` rather than `clear` for a
person nobody has described, and every one of the twenty-four working patterns currently reads
`source: 'default'` precisely so that an assumed week is never mistaken for a stated one.

## `stampedFrom`, which is the point

When anything *acts* on a value, it copies it:

```ts
interface Stamped<T> {
  value: T
  stampedFrom: string   // the Version id it came from
  stampedAt: string
}
```

An approved timesheet line holds the rate **and** the version it came from. A later correction
moves the timeline; the stamp does not move.

Without this there are only two systems available, and both are bad: one where corrections are
forbidden, so the data stays wrong forever, and one where a correction silently rewrites money
already invoiced. `stampedFrom` is what allows both to be true at once — the timeline is
corrected, the committed figure holds, and because the stamp names its source the two can be
shown side by side and the difference explained, rather than quietly disagreeing.

## Invariants

1. **Overlaps are refused.** Two versions of one subject cannot both be true on a date. This is
   the check the reducer must get right, and the one worth the most test coverage.
2. **Gaps are allowed.** Somebody who left and rejoined has a gap. Forcing contiguity would
   invent employment.
3. `validTo`, when present, is after `validFrom`.
4. **A correction affecting stamped values is allowed, and reported.** *"Three approved
   timesheets were computed from the version you are changing."* Not blocked — the person
   correcting a date usually knows something the system does not — but never silent.

## Where it lives

| Piece | File |
|---|---|
| `valueAt`, `timelineOf`, the overlap rule, correction impact | `lib/versioning.ts` — pure, no clock, no I/O |
| `recordVersion`, `correctVersion` | `lib/workspace.ts`, ordinary actions so attribution and audit come free |
| `Version` model, `(tenantId, id)`, indexed `(tenantId, subjectKind, subjectId, validFrom)` | `prisma/schema.prisma` |
| Mapper pair, persist arm | `lib/db/map.ts`, `lib/db/persist.ts` |

`value` is stored as JSON and typed at the boundary by `subjectKind`.

## Scope

**The working pattern, and nothing else.** It exists, it has twenty-four instances, it already
distinguishes stated from default, and `capacityFor` already asks a date-ranged question — so it
is the only consumer that can exercise this honestly today.

Role, manager and location come later because **those fields do not exist on `Person` yet**;
adding both the field and its history at once would test neither. Cost rates come later because
they are deferred until hours are attested, which is the timesheet design's decision and not
this one's to reverse.

## How it gets proven

Scenarios drive `valueAt` at a date inside a period, at a boundary, in a gap, and before any
version exists; the overlap refusal; and the correction-impact report.

The persistence proof gets a version round trip and the check that matters: **a correction moves
the timeline and does not move a stamp.** A mechanism whose whole purpose is that committed
figures hold still is worth exactly nothing until something has watched one hold still.

## The risk

`valueAt` returning null is correct and will be inconvenient, and the tempting fix — falling back
to the current value when no version covers a date — silently destroys the property this exists
to provide. Every call site must handle null as "not known then", and the scenario coverage
asserts the null case first, before any of the happy paths.
