# A read-only mail log — implementation plan

Follows `docs/plans/2026-08-24-mail-log-design.md`, approved. Two of its constraints govern the
order directly: the record is "written through the reducer, like everything else in this app,"
and the duplicate-check switch is "a behaviour change to a live, working, already-shipped
endpoint... not assumed equivalent because it looks strictly more correct" — so that switch gets
its own step and its own scenario, not a line changed in passing while doing something else.

Ordered by provability: types and the one piece of pure logic this feature has (the duplicate
check, extracted so it can be driven directly — the same reasoning `personalEventsFor` was pulled
out of `redactForReader` in the last program) come first, then the reducer arm, then storage,
then the live endpoint rewiring (named as this plan's highest risk), then the screen.

## Step 1 — Types, `WorkspaceState` wiring, and the pure duplicate check

**Touches:** `lib/intake.ts` (`InboundMail` interface, `alreadyReceived(state, messageId): boolean`
— extracted rather than left as the inline substring search `POST /api/intake` uses today),
`lib/workspace.ts` (`WorkspaceState.inboundMail` field — the same five-point mechanical addition
every new collection in this program has needed: `initWorkspace`, `autosave.ts`'s mirror merge,
`lib/db/repo.ts`'s `loadWorkspace` placeholder), `lib/clientBoundary.ts` (`inboundMail: {}` added
to `clientView`'s emptied-collections list).

**No separate read-gate step this time**, unlike the last two builds in this program. The design
is explicit that this stays `internal.view`-only with no further narrowing: `redactForReader`'s
`base` object passes `inboundMail` through untouched for any internal reader (nothing needs to
single it out, the same as most collections), and `projectView` doesn't name it either, so it
survives ungated for internal readers exactly as the design specifies — with zero new code. The
one place a leak is actually possible is `clientView`, which empties named collections
explicitly rather than by default; that line is this step's whole read-side job.

**Verified:** two scenarios in `scripts/scenario-validation.ts`, driving `alreadyReceived`
directly against a hand-built `WorkspaceState` — no reducer, no database:

- **ML1** — a message id present in `state.inboundMail` is recognised.
- **ML2** — a message id not present is not — checked as its own case rather than assumed from
  ML1's negative space, since a check that always returns `true` would otherwise still look like
  it works.

`npm run validate:scenarios` — ML1/ML2 PASS, nothing that passed before regresses. `npx tsc
--noEmit` clean.

## Step 2 — The reducer arm

**Touches:** `lib/workspace.ts` (`Action` union + one arm, `recordInboundMail`), `lib/access.ts`
(`ACTION_PERMISSIONS['recordInboundMail'] = null`), `lib/actionShape.ts` (SHAPES entry, needed for
the file's own `satisfies Record<Exclude<Action['t'], 'notify'>, Shape>` completeness check to
compile, whether or not anything ever runs shape validation on this specific action at runtime).

**The detail most likely to be copied wrong:** every other action added across this program's
last two builds also joined `app/api/workspace/route.ts`'s `KINDS` set. This one must not. `POST
/api/intake` calls `persistActions` directly — it never goes through the generic
`/api/workspace` endpoint at all — and `KINDS` is deliberately what stands between a browser and
an action, the same reasoning `notify` is "deliberately absent" from it today ("a notify action
arriving over the wire could only be one the client invented"). Adding `recordInboundMail` to
`KINDS` out of habit would open a door this design never intended: a browser claiming to have
received mail nobody's mailbox actually saw.

**Verified:** a scenario driving `apply()` directly with a `recordInboundMail` action, confirming
it lands in `state.inboundMail` — and a grep check (not a scenario; there is nothing runtime to
exercise for an absence) confirming `'recordInboundMail'` does not appear in
`app/api/workspace/route.ts`'s `KINDS` set. `npx tsc --noEmit` clean. **Stands alone as a
commit** — purely additive, nothing existing calls this action yet.

## Step 3 — Storage

**Touches:** `prisma/schema.prisma` (new `InboundMail` model — `tenantId`, `id`, `mailbox`,
`from`, `subject`, `body` `@db.Text`, `messageId`, `receivedAt`, `issueId String?`,
`refusalReason String? @db.Text`, `createdAt`, indexed on `(tenantId, messageId)` for the
duplicate check's own lookup), a new migration, `lib/db/map.ts`
(`inboundMailFromRow`/`inboundMailToRow`), `lib/db/repo.ts` (`Reader` type + query, replacing step
1's placeholder), `lib/db/persist.ts` (write case).

**Stands alone — carries the schema change.** No backfill: this program's own intake history was
never kept (that is the entire premise of this design), so there is nothing to reconcile against
production data — the table starts empty and only grows from here. Applied to production
immediately after the migration is written, before step 4 wires anything to read from it.

**Verified:** `npx prisma migrate diff --from-config-datasource prisma/schema.prisma --to-schema
prisma/schema.prisma` reviewed before applying. `npm run audit:persistence` — the existing count
stays green, plus one new check: an `InboundMail` written through `persistActions` comes back out
of Postgres with its `subject`, `body` and `refusalReason` intact.

## Step 4 — Wire the live intake endpoint

**Touches:** `app/api/intake/route.ts`.

**This is the step carrying the most regression risk in this plan.** `POST /api/intake` is a
live, already-shipped endpoint that a real mail connector calls in production, and this step
changes two things about it at once:

1. The duplicate check — `Object.values(state.notes).some((n) => n.body.includes(full.messageId))`
   — is replaced with `alreadyReceived(state, full.messageId)`. If the new check is looser than
   the old one, a redelivered message creates a second issue for the same client request. If it
   is stricter, a genuinely new message with an id that happens to collide gets silently dropped.
   Either failure lands on a real client's request, not on a test fixture.
2. The refusal path (`if ('refused' in result) { return ... 422 }`) currently makes no database
   write at all. This step adds one — `recordInboundMail` with `refusalReason` set, no `issueId`
   — **before** returning the 422, not after, so a thrown error from the write cannot silently
   turn "refused and logged" into "refused and lost." The write's own failure does not change the
   response: the caller did nothing wrong, and a logging failure is swallowed and logged
   server-side, mirroring the existing `noteRecorded` pattern the success path already uses for
   exactly this reason — the primary outcome (mail was refused, or accepted) is reported
   accurately whether or not the secondary bookkeeping succeeds.

For the success path, `recordInboundMail` joins the existing `follow` batch alongside the
provenance note and the assignment actions — the same secondary, best-effort persistActions call
that batch already is, not a new atomicity boundary.

**The detail most likely to be got wrong:** the duplicate check must still run **before**
`classify()`, exactly where it runs today — moving it after would mean a redelivered message that
would now classify differently (routing rules changed since the first delivery) creates a second
issue instead of being recognised as the same arrival.

**Verified:** a scenario cannot drive a Next.js route handler directly, so this step is checked
two ways. First, `npx tsc --noEmit`. Second, `npm run audit:persistence` gains a check that
exercises the same `alreadyReceived` logic this route now calls, proving the function itself is
correct (already covered by ML1/ML2 in step 1) — what step 4 adds on top is a manual trace through
the route's new control flow (the refused-and-logged path, specifically, since it's the one branch
with no existing test coverage of any kind before this step) before it ships, and the live
before/after check named below.

Deployed, then checked against the real intake path the same way project membership's step 3 was
checked against real backfill data: post one message through `/api/intake` (the existing manual
verification method this program has used for intake before — "posted one message, not by
reading the table"), confirm it appears in `InboundMail`, then post the identical message again
and confirm it is recognised as a duplicate rather than creating a second issue. Remove the test
message afterward, the same discipline `docs/verification-checklist.md`'s browser drives have
followed throughout this program.

## Step 5 — The screen

**Touches:** `components/ConfigWorkspace.tsx`'s `Routing` component (`components/ConfigWorkspace.tsx:3724`)
gains a "Mail log" section — a read-only, sortable/searchable list of `state.inboundMail`, each
row showing the mailbox, sender, subject, arrival time, and outcome (linked to the issue it
became, or the refusal reason), beside the routing rules that decided it.

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`. No new scenario — this is a read-only
list over already-correct, already-proven data (steps 1–4), the same reasoning every screen-only
step in this program's last two builds gave for itself.

## Commit boundaries

- Step 1 stands alone (pure, inert — the read-side change is one line in an existing
  empty-collections list, not a new gate).
- Step 2 stands alone (additive, nothing existing changes).
- Step 3 stands alone — the schema change.
- Step 4 stands alone — it is the step that changes a live endpoint's already-shipped behaviour,
  and it gets its own deploy and its own live check, the same reasoning the gating steps in the
  last two builds were kept separate for.
- Step 5 stands alone (the screen, no logic).

## What would send this back to the design

- If step 4's live check shows the new duplicate check disagreeing with the old one on any real
  redelivered message — not a hypothetical, an actual one from the production connector — that
  is the regression the design's own send-back list names, and it stops there rather than
  shipping a fix alongside the rest of this plan.
- If logging a refused message's body turns out to retain something that should not be kept
  twice (the design's own open question about a client's confidential content) — that is a
  privacy question this plan was never scoped to answer, and it sends step 4 back to the design
  rather than being decided ad hoc while wiring the endpoint.
