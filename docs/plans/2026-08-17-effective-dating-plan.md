# Effective-dated history — implementation plan

Follows `2026-08-17-effective-dating-design.md`, approved 17 August 2026.

**Ordering principle: each step is provable before anything depends on it.** The pure rules
first, because they need nothing and a wrong rule is cheapest to find there. Storage before the
consumers that must survive a reload. The change to `capacityFor`'s callers last of the code
steps, because it is the one that alters paths which currently always return an answer.

---

## 1. `lib/versioning.ts` — the rules, with nothing attached

Pure. No clock, no I/O. Everything is passed in.

    interface Version<T> { id, subjectKind, subjectId, validFrom, validTo, value,
                           recordedAt, by, byId?, byEmail?, reason }
    interface Stamped<T> { value: T; stampedFrom: string; stampedAt: string }

    valueAt<T>(versions, kind, id, on): Version<T> | null
    timelineOf<T>(versions, kind, id): Version<T>[]      // ordered, oldest first
    overlapProblem(versions, candidate): string | null   // the invariant, as a refusal
    correctionImpact(versions, stamps, versionId): string[]

`valueAt` returns **null** when nothing covers the date. Not a default — the design is explicit
that falling back to the current value is the change that silently destroys the property this
exists to provide.

`overlapProblem` is the invariant that earns the most test coverage: two versions of one subject
cannot both be true on a date. Gaps are permitted and must stay permitted — somebody who left
and rejoined has one.

**Verified by:** `npx tsc --noEmit` clean, then step 2.

## 2. Scenarios against the rules — before any wiring

Add a scenario to `scripts/scenario-validation.ts` driving step 1 directly, with the null case
first: a date inside a period, a date on each boundary, a date in a gap, a date before any
version exists, an overlap refused, and a correction reporting what it affects.

**Verified by:** `npm run validate:scenarios` — the new scenario computes its verdict, and the
summary stays at 26 PASS with no new FAIL. Expect the scenario count to rise from 53 to 54.

*Before the reducer, deliberately. If the boundary arithmetic is wrong — and inclusive-versus-
exclusive `validTo` is the classic place for it to be — this is where it costs nothing.*

## 3. Reducer arms and registration

Add to `lib/workspace.ts`:

    | { t: 'recordVersion'; subjectKind: string; subjectId: string; validFrom: string
        value: unknown; reason: string; now: string }
    | { t: 'correctVersion'; id: string; patch: { validFrom?: string; validTo?: string | null
        value?: unknown }; reason: string; now: string }

Both refuse on `overlapProblem`. Both audit through `log(actor, state, entry)`, which stamps
`byId` and `byEmail` — so `Version.by/byId/byEmail` are taken from the same actor and cannot
drift from the trail.

Register **both kinds in two places**: `KINDS` in `app/api/workspace/route.ts` and `SHAPES` in
`lib/actionShape.ts`. The endpoint refuses any kind absent from either, and `SHAPES` has exact
parity with the allowlist enforced by a scenario — a kind added to one and not the other fails
FL2 rather than failing quietly.

`correctVersion` requires a reason. `recordVersion` requires one too: a version with no stated
reason is a row that cannot explain itself later, which is the whole point of the record.

**Verified by:** `npx tsc --noEmit`, then `npm run validate:scenarios` still green with the new
scenario now running through `apply()`.

## 4. Storage

    model Version {
      tenantId    String
      id          String
      subjectKind String
      subjectId   String
      validFrom   String      // ISO date
      validTo     String?
      value       Json
      recordedAt  DateTime
      by          String
      byId        String?
      byEmail     String?
      reason      String   @db.Text
      @@id([tenantId, id])
      @@index([tenantId, subjectKind, subjectId, validFrom])
    }

Mapper pair in `lib/db/map.ts`; one arm in `lib/db/persist.ts`; one read added to the
`Promise.all` in `loadWorkspace` in `lib/db/repo.ts`; `versions` added to `WorkspaceState`; and
`prisma.version.deleteMany` added to `scrub()` in `scripts/persistence-proof.ts` — which will
otherwise fail its own completeness check, by design, because every foreign key to `Tenant` is
`Restrict`.

Migration generated with `prisma migrate diff --from-schema <committed> --to-schema <current>`.
`--to-schema-datamodel` was removed in Prisma 7 and errors.

**Verified by:** `npm run db:migrate`, then `npm run db:check` reporting four migrations applied.

## 5. The working pattern becomes date-aware — the step with the regression risk

**This is the riskiest step.** Every existing caller gets an answer today, because
`capacityFor` falls back to `defaultProfile('')` when handed `undefined`. After this step some
of them can get "not known then", and a caller that quietly re-defaults has removed the property
the whole design exists to provide — while still returning a plausible number. The breakage is
not a crash; it is a capacity figure that looks right.

Six call sites, and they are not equal:

| Where | What it needs |
|---|---|
| `lib/workspace.ts:898` `profileFor(state, person)` | The single funnel for both reducer call sites (`:2794`, `:2881`). Make it take a date. Fixing it here covers both arms. |
| `lib/availability.ts:155` | Reads `state.model.resourceProfiles[match.id]` directly, then calls `capacityFor` at `:171`. It already has a window — use `window.from`. |
| `lib/watch.ts:183` | Passes the **whole map** to `planCheck`. See below. |
| `components/CapacityPanel.tsx:119` | Has `today` in scope. |
| `scripts/scenario-validation.ts:503-504` | Fixture, updated with the rest. |

**`planCheck` takes a `Record<personId, ResourceProfile>`, not one profile.** Do not change its
signature. Add `profilesAt(versions, profiles, on): Record<string, ResourceProfile>` returning
the same shape resolved at a date, so `watch.ts` and `planCheck` are untouched apart from one
call. Changing the signature would push date-awareness into a function that is about plans, not
about time.

**Verified by:** a scenario asserting both directions — a date with a version returns it, a date
before any version returns null and the caller says so rather than substituting — plus
`npm run validate:scenarios` with no regression in the capacity scenarios (L, M, G).

## 6. The persistence proof

Two checks in `scripts/persistence-proof.ts`:

- A version round trip: record two periods, reload through `loadWorkspace`, and find both with
  their boundaries, reasons and `byId` intact.
- **A correction moves the timeline and does not move a stamp.**

**Verified by:** `npm run audit:persistence` at 29 of 29, up from 27.

## 7. Surfacing it

`CapacityPanel` gains the timeline for the selected person's working pattern, and a control to
record a change with a reason. A period showing "not known" reads as that rather than as a blank.

**Verified by:** opening it in a browser. Note that `CapacityPanel` only renders for
`row.kind === 'project'`, and the three projects created on 17 August are what make it reachable
at all — before them, this panel could not be opened by anybody.

---

## The details most likely to be got wrong

**`valueAt` returning null is the feature.** The tempting fix — falling back to the current
value, or to `defaultProfile()` — silently destroys the property. Every call site treats null as
"not known then". The scenario coverage asserts the null case **first**, before any happy path,
so a regression fails on the first assertion rather than the fifth.

**`validTo` is exclusive, and every boundary test says so.** A period ending 30 June and one
starting 1 July must not overlap, and a query for 30 June must find the first. Inclusive-versus-
exclusive is where this kind of arithmetic goes wrong, and it goes wrong quietly.

**Do not change `planCheck`'s signature.** It takes a map of profiles and is about plans, not
time. `profilesAt` resolves the map at a date and hands it the same shape.

**`Version.by/byId/byEmail` come from the same actor the audit entry does.** Both are stamped in
the arm from the actor parameter — not read back from the trail, and not passed in the action,
which would let a client attribute a version to somebody else.

**Nothing stamps anything yet.** `Stamped<T>` and `correctionImpact` are real and provable in
isolation, and they have **no production consumer** until timesheets exist — an approved
timesheet line is the first thing that will hold a rate and a `stampedFrom`. Step 6's check
therefore constructs a stamp in the proof rather than observing one the application made. That
is honest and it is not the same as end-to-end coverage, and the plan should not be read as
claiming otherwise.

## Commit boundaries

Steps 1–3 are **one commit**: the rules and the arms are meaningless apart.

Step 4 stands **alone**, because it carries a migration and a migration landing with unrelated
changes cannot be reverted independently.

Step 5 stands **alone** — it is the risky one and deserves to be revertible on its own.

Steps 6 and 7 are separate commits.

## What would send the design back

- **A working pattern genuinely needs sub-day granularity** — surfaces at step 1. If a change
  takes effect mid-day, `validFrom` as an ISO *date* is the wrong type and the whole record
  changes shape.
- **`valueAt` returning null proves unusable in practice** — surfaces at step 5, when the four
  production call sites have to say something to a user for a date before anybody joined. If
  every one of them ends up substituting a default anyway, the design's central rule is not
  survivable and the honest answer is a `basis` field on `CapacityPosition` rather than a null
  nobody can act on.
- **Corrections turn out to need a second time axis after all** — surfaces at step 6, if
  "a correction moves the timeline and does not move a stamp" cannot be expressed without also
  recording what was believed when. That would mean bitemporality, rejected during design, was
  right.

None is expected. Each is decidable at the step that surfaces it, and each is cheaper to admit
there than at step 7.
