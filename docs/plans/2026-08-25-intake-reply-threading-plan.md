# Intake reply threading — implementation plan

Follows `docs/plans/2026-08-25-intake-reply-threading-design.md`, approved ("yes"). Quotes below
are from that document as written.

**Ordering principle.** The matching rule (which issue, if any, a reply belongs to) and the
cleanup pass's grouping rule (which existing issues are the same thread) are both pure —
no clock, no I/O — and both provable against hand-built records before either touches a database.
Both come before the schema migration; the migration comes before anything that depends on the
column existing; the two things needing a real deployment (Azure for the connector, production
Postgres for the cleanup dry run) come last, because they are what no scenario harness can check
and what is slowest to diagnose if wrong.

## Step 1 — The matching rule, pure

**New function** in `lib/intake.ts`, beside `alreadyReceived`:

```ts
export function matchingIssue(
  mail: Record<string, InboundMailRecord>,
  issues: Record<string, IssueRecord>,
  conversationId: string | null,
): string | null
```

Returns the issue id a reply belongs to, or `null` (meaning: create a new issue, today's
behaviour). Logic, in the order the design states it:

1. `conversationId` is `null`/empty → `null`. The intake-form path and a connector that hasn't
   been redeployed yet both hit this branch, and it must behave exactly as today.
2. Collect every `InboundMail` row whose `conversationId` matches, that also has a non-null
   `issueId` (a refused message has none). No rows → `null`.
3. Map to the distinct set of issue ids those rows point at. One id → return it, whatever its
   status — *"a reply on a closed issue does not reopen it... a person reads the note and
   decides."* More than one id → return the one whose `issues[id].lastActivity` sorts latest,
   per the design's tie-break — *"never refuses and never guesses at content placement beyond
   that: the tie-break is deliberately the simplest rule that cannot misfile a reply onto an
   unrelated client's work, since every candidate already shares the real thread id."*

**Verify:** a handful of scenario cases in `scripts/scenario-validation.ts` (hand-built
`InboundMail/Issue` records, no reducer, no database — same shape as `TV1`–`TV6`): no
`conversationId` → `null`; one matching row with an issue → that issue's id, closed or open;
two matching rows on different issues → the one with the later `lastActivity`; a matching row
with `issueId: null` (a refused message) → excluded, doesn't count as a match. `npx tsc --noEmit`
and `npm run validate:scenarios` after writing these.

## Step 2 — The cleanup grouping rule, pure

**New function**, likely in `lib/intake.ts` alongside step 1 (same file already owns subject
handling — `firstLine`, the subject-trim in `classify()`):

```ts
export function normalizeSubject(subject: string): string
```

Strips a leading run of `Re:`/`Fw:`/`Fwd:` (case-insensitive, repeated — `"Re: Re: Fwd: X"` →
`"X"`), trims whitespace. Used by both the grouping function below and, worth checking against
step 1's own test cases, nowhere near the live matching path — normalization is cleanup-only,
per the design's *"the two use different signals for a reason."*

**New function**:

```ts
export function duplicateGroups(
  mail: InboundMailRecord[],
  issues: Record<string, IssueRecord>,
): { canonical: string; duplicates: string[] }[]
```

Groups issues by `(InboundMail.mailbox, Issue.client, Issue.parentId, normalizeSubject(subject))`
— joined via `InboundMail.issueId` — keeping only groups with more than one issue. Within each
group, the issue with the latest `lastActivity` is `canonical`; the rest are `duplicates`, in the
order they should each receive a `DUPLICATE_OF` link to the canonical one.

**Verify:** scenario cases with hand-built `InboundMail`/`Issue` records: three issues sharing
mailbox+client+parent+normalized-subject group together, most-recently-active as canonical; an
issue with a different `client` or `parentId` does not join an otherwise-matching group; subjects
differing only by a `Re:`/`Fwd:` prefix (any depth) still group; a genuinely different subject
does not. `npx tsc --noEmit` and `npm run validate:scenarios` again.

**Commit steps 1 and 2 together.** Both are additions to the same pure module, neither reachable
from anything live until steps 3–5 wire them in.

## Step 3 — Schema migration

**File:** `prisma/migrations/20260825000001_inbound_mail_conversation_id/migration.sql` (today's
next slot after `20260824000004_row_level_security`).

```sql
ALTER TABLE "InboundMail" ADD COLUMN "conversationId" TEXT;
CREATE INDEX "InboundMail_tenantId_conversationId_idx" ON "InboundMail"("tenantId", "conversationId");
```

Nullable — every row written before this ships has none, and the intake-form path never will.
Update `prisma/schema.prisma`'s `InboundMail` model with the matching optional field, and
`lib/db/map.ts`'s `inboundMailToRow`/`inboundMailFromRow` pair to carry it through, the same
round trip every other field on this model already makes.

**Also**: the `recordInboundMail` action (`lib/workspace.ts`) and its dispatch sites
(`app/api/intake/route.ts`, both the refusal branch and the success branch) gain a
`conversationId: string | null` field, read from the inbound payload the same way `messageId`
already is.

**Stands alone** — a schema change, per the skill's own rule that anything carrying a migration
gets its own commit regardless of how small.

**Verify:** `npx prisma migrate diff` against the schema to confirm no other drift, apply via
`npm run db:migrate:dev` against a disposable database if one exists this time, or — if not,
following the precedent the row-level-security work set — apply directly to production
immediately followed by `npm run audit:persistence` (which already exercises `InboundMail`'s
round trip) and a manual read-back of one row. `npx tsc --noEmit`.

## Step 4 — Wire the live endpoint

**File:** `app/api/intake/route.ts`. After `classify()` succeeds and before the `create` action is
built, call `matchingIssue(state.inboundMail, state.issues, full.conversationId)`.

- Returns an issue id → skip the `create` action entirely. Build only `addNote` (the same pinned
  `Client Communication` note shape the create path already writes, via `provenanceNote`) and
  `recordInboundMail` (with `issueId` set to the match and the incoming `conversationId`) — no
  `setAssignment` actions, since nothing new was created to assign.
- Returns `null` → today's path, unchanged, with `conversationId` now also recorded on the
  `recordInboundMail` action so this reply's own thread is matchable by whatever replies to it
  next.

**This is the step carrying the most regression risk in this plan.** It changes the one code path
every real client email already flows through successfully in production today. Get the `null`
branch's condition wrong — a `matchingIssue` call that returns a false match — and a new client's
first message on a genuinely new topic silently attaches as a note on an unrelated existing issue
instead of becoming its own tracked item, which is worse than today's over-filing, because the
new problem is invisible until someone goes looking for an issue that was never created. Get the
non-null branch wrong and a real reply silently fails to update anything a client is waiting on.

**Verify:** `npx tsc --noEmit`, `npm run validate:scenarios`, then — since `matchingIssue` is
already proven pure in step 1 — an integration check against real Postgres in the shape
`scripts/persistence-proof.ts` already uses: post two messages with the same `conversationId`
through `persistActions`/the endpoint's own logic, confirm the second becomes a note on the first
issue and not a new issue, confirm a `conversationId`-less message still creates one. `npm run
build`.

## Step 5 — The connector

**File:** `infra/intake.bicep`. One line added to the field-mapping action already there:

```
conversationId: '@triggerBody()?[\'conversationId\']'
```

immediately beside the existing `messageId: '@triggerBody()?[\'internetMessageId\']'` line.

**Stands alone, and needs an actual Azure redeployment, not just a commit** — this is
infrastructure-as-code; `git push` alone changes nothing about the running Logic App. Redeploy via
whatever this project's established Bicep deployment command is (check `docs/intake.md` or
`scripts/` for it before assuming `az deployment group create` is the whole story — the design
doc's own convention throughout this project is to name the real command, not a plausible one).

**Verify:** send one real test message through the connector (the pattern `docs/intake.md`'s own
"Verify" section already uses for the existing fields) and confirm the intake endpoint receives a
non-empty `conversationId` this time — read it back from the `InboundMail` row step 3's migration
added, not just from the Logic App's own run history, since a field can appear to map correctly in
the designer and still arrive empty at the endpoint.

## Step 6 — The cleanup script

**New file:** `scripts/merge-duplicate-threads.ts`, following the `--apply`/dry-run-by-default
convention `scripts/fix-person-identity.ts` and `scripts/repair-markup.ts` already establish —
default run reports every group `duplicateGroups` (step 2) finds, canonical and duplicates named;
`--apply` dispatches one `link` action per duplicate (`relationshipType: 'DUPLICATE_OF'`,
`sourceIssueId` = the duplicate, `targetIssueId` = the canonical — matching the direction the
`duplicate` action's own reducer arm already uses) through `persistActions`, same as every other
one-off script in this project.

**Verify:** run without `--apply` against production first — the design's own verification
requirement — and confirm the report names the `OAPIL-149`/`150`/`151` "item master" group
specifically, by displayId, before trusting the grouping logic against anything else. Read the
full report for any group that looks wrong before ever passing `--apply`. Re-run
`npm run audit:tenancy`, since this script is new code under a tenant-scoped write path.

**Stands alone** — an operational action against production data, not bundled with any code
commit; the script itself is committed with step 1/2's pure logic since it depends on nothing
else, but *running* it with `--apply` is a separate, later decision, not part of shipping the
code.

## Details most likely to be gotten wrong

- **`matchingIssue`'s "no `issueId`" filter (step 1).** A refused message's `InboundMail` row has
  `issueId: null` and a real `conversationId` — if the filter is dropped, a client's message that
  was refused (wrong recipient, empty body, whatever `classify()` refused it for) would make a
  *later*, valid reply on the same thread match against nothing and silently create a duplicate
  issue instead of erroring loudly — a quiet regression, not a loud one.
- **The tie-break must read `lastActivity` from `issues`, not from the `InboundMail` rows'
  `receivedAt`.** The design says "most recently active issue," not "most recently emailed
  issue" — an issue can have real activity (a note, a status change) from a channel other than
  mail after the last message on it arrived.
- **`normalizeSubject`'s prefix strip must be anchored to the start of the string and repeat**,
  not a single global replace — `"Re: item master (Fwd: from Priya)"` should normalize to `"item
  master (Fwd: from Priya)"`, not have the parenthetical's `Fwd:` stripped too.
- **Step 4's `recordInboundMail` in the matched branch must still write `issueId` to the matched
  issue**, not leave it null the way the refusal branch does — the two look similar in shape and
  it is easy to copy the wrong one.
- **The `duplicate` action's own `DUPLICATE_OF` direction, confirmed while writing this plan**
  (`lib/workspace.ts`'s `duplicate` reducer arm): `sourceIssueId` is the newer/duplicate record,
  `targetIssueId` is the original. Step 6 must mint links the same way — `sourceIssueId` = each
  duplicate, `targetIssueId` = the canonical — or it mints the reverse of what every other
  `DUPLICATE_OF` link in this codebase already means.

## What would send this back to the design

- If `conversationId` does not survive the trigger→connector→payload path intact once step 5 is
  actually deployed and tested — the design's own listed risk, surfacing exactly there, before
  step 4's logic is ever exercised by a real message.
- If step 6's dry run produces a false-positive group against the real production data — two
  unrelated issues sharing enough fields to group — the design's own listed risk, and the reason
  step 6 is dry-run-first rather than `--apply`-first.

## Commit shape

- **Steps 1 + 2** — one commit: the two pure functions and their scenario coverage.
- **Step 3** — stands alone: the migration and its schema/mapper wiring.
- **Step 4** — stands alone: the live endpoint change, the highest-risk step in this plan.
- **Step 5** — stands alone: the Bicep connector change, committed with code but requiring a
  separate Azure redeploy as its own operational action.
- **Step 6** — the script is committed with steps 1/2 (it depends only on the pure functions);
  running it with `--apply` against production is a separate, later, explicitly-approved action.
