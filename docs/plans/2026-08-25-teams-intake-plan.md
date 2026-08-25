# Teams intake — implementation plan

Follows `docs/plans/2026-08-25-teams-intake-design.md`, approved by the user. Five steps, ordered
so nothing depends on a part that hasn't been proven yet: config type and classification are pure
and provable by scenario before either has a caller; the endpoint that talks to Bot Framework
comes next, since it depends on both; infrastructure comes after the code it points at exists;
the live proof comes last, because it is the one step no harness in this repository can perform.

## Step 1 — `IntakeChat` config type and its CRUD

**Touches:** `lib/config.ts` (new `IntakeChat` interface, sibling to `IntakeMailbox` at line 601),
`lib/workspace.ts` (new `ConfigOp` union members `upsertIntakeChat`/`deleteIntakeChat` in the
`ConfigOp` type around line 1347, and two new `case` arms in the `configure` reducer modeled
directly on `upsertIntake`/`deleteIntake`, lines 7411–7442).

`IntakeChat` is `{id, chatId, scopeId, workflowId, enabled}` — the same shape as `IntakeMailbox`,
per the design. The reducer arm differs from `upsertIntake` in exactly one place: `upsertIntake`
validates `address` against an email regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, `lib/workspace.ts:7415`);
`upsertIntakeChat` validates `chatId` instead, which is not an email and must not be checked
against that regex — Teams chat ids look like `19:540bb748bc014d8f9e6c83d69fc2d0a8@thread.v2`, and
running the email regex against one would reject every valid id (`@` present, but nothing after
the `@` matches a domain shape ending in a TLD-like segment — worth confirming by hand against the
real id before trusting a new regex; the plan's own send-back list below covers this). A
non-empty, trimmed string is enough validation here — Teams issues the id, nothing in this
application can second-guess its shape. The clash check (`m.intake.find(...)`, line 7418) carries
over unchanged in spirit: two `IntakeChat` rows must not share a `chatId`. The id-generation
pattern (`` `INBOX_${m.seq}` ``) carries over as `` `CHAT_${m.seq}` ``, sharing the model's single
`seq` counter the way `IntakeMailbox` and `IntakeForm` already do (`lib/config.ts:766,768,776`).

Also add `intakeChats: IntakeChat[]` to `OperatingModel` (`lib/config.ts:766` area) and seed it as
`[]` alongside `intakeForms: []` (`lib/config.ts:1135`), and thread it through wherever
`intakeForms` is read back from stored state (`lib/config.ts:1512`, `stored.intakeForms ??
seed.intakeForms`) so a workspace saved before this ships still loads.

**Verified by:** `npx tsc --noEmit` (clean compile with the new type and reducer cases wired
through every place `OperatingModel` is constructed or narrowed); a new pair of scenario cases in
`scripts/scenario-validation.ts` — call `configure` directly with `{k: 'upsertIntakeChat', ...}`
and confirm the row lands in `state.model.intakeChats`, confirm a clashing `chatId` is refused,
confirm `deleteIntakeChat` removes it — run with
`npx tsx --conditions=react-server scripts/scenario-validation.ts` and check the new cases PASS
alongside the existing 121.

## Step 2 — `classifyChat()`

**Touches:** `lib/intake.ts`, adding `classifyChat()` alongside `classify()` (line 373) and
`classifyForm()` (line 485) — same file, same shared `draftFor()` call underneath.

Signature mirrors `classifyForm()`: resolves an `IntakeChat` by `chatId` (the equivalent of
`classify()`'s lookup of an `IntakeMailbox` by `message.to`), refuses with the same three shapes
`classify()` already uses — no matching chat configured, chat disabled, chat has no scope — then
calls `draftFor(chat.scopeId, message, model)` exactly as the other two do. No new refusal
vocabulary invented; a fourth intake path reusing the same three reasons is the point of sharing
`draftFor()` at all.

Two things to check by hand while writing this step, both about the design's own text, not new
design decisions:

- `firstLine()` (`lib/intake.ts:518`) already returns `'Message with no subject'` when `body` has
  no usable first line. Before trusting this for Teams, run it against a real, short chat message
  with the mention already stripped (e.g. `"the invoice totals are off again"`) and confirm the
  resulting issue title is something a consultant would recognize, not just that the fallback
  string doesn't crash. It was built for the form path's edge case, not exercised against
  Teams-shaped input yet.
- `classify()`'s empty-message refusal (`!message.subject.trim() && !message.body.trim()`, line
  377) already covers a bare "@Axiomate" with nothing else, once `subject` is always `''` for this
  path and the mention itself has been stripped from `body` before this check runs — confirm the
  stripping happens before classification, not after, or an empty mention would misread as
  non-empty text.

**Verified by:** scenario coverage in `scripts/scenario-validation.ts`, hand-built
`InboundMessage` fixtures, no database and no live Teams involved — an unrecognized `chatId`
refuses; a disabled chat refuses; a scopeless chat refuses; a message with real text after the
(already-stripped) mention produces a draft with a sensible title; a message with nothing left
after stripping refuses as empty. Run with
`npx tsx --conditions=react-server scripts/scenario-validation.ts`, same command as step 1,
checking the new cases alongside the full suite.

## Step 3 — `/api/intake/teams` route

**Touches:** `app/api/intake/teams/route.ts` (new), `package.json` (adds `botbuilder`).

Follows the shape `app/api/intake/route.ts` already establishes — auth check before anything else
touches the request body, build an `InboundMessage`, classify, `persistActions` — but the auth
mechanism is different in kind, not degree: `/api/intake` compares a bearer token to a stored
secret (`secretValue('AXIOMATE_INTAKE_TOKEN')`); this route must validate a Bot Framework JWT
(signature, audience against the bot's own app id, issuer) using `botbuilder`'s request
authentication, not a string comparison — hand-rolling JWT validation here would be the same
mistake `/api/intake` was built to avoid by using a shared secret instead of trying to verify mail
server identity itself. **This check must reject an unauthenticated request before `classifyChat()`
or anything else touches the activity body** — mirrors `/api/intake/route.ts`'s own ordering
(token check at the very top of `POST`, before `req.json()` is even parsed for the intake-form
and mail paths).

After authentication, the route must:

1. Read the activity's `entities` for a mention whose `mentioned.id` equals **this bot's own id**
   — not "any mention is present." A message that mentions a colleague, with other text alongside
   it, must not be treated as intake just because *a* mention entity exists somewhere in the
   activity. This is the single detail most likely to be got wrong in this step, because it is
   easy to write "does this activity have a mention" instead of "does this activity mention *us*"
   and have every scenario in step 2 still pass, since step 2's fixtures never exercise the
   difference.
2. If no self-mention — discard immediately. Per the design, this is not logged, not stored, not
   passed to `classifyChat()` at all.
3. If self-mentioned — strip the mention (`TurnContext.removeRecipientMention`), build the
   `InboundMessage` (`subject: ''`, `body`: stripped text, `messageId`: activity id,
   `conversationId`: kept for the record, `to`/chat-matching field: the activity's chat id),
   check `alreadyReceived()` exactly as `/api/intake/route.ts` does before classifying, then call
   `classifyChat()`.
4. On a draft: `persistActions` with `{t: 'create', kind: 'issue', ...}` directly — **no
   `matchingIssue()` call**, per the design's §5. This is the one place in this step where copying
   `/api/intake/route.ts`'s shape too literally would reintroduce reply-threading logic the design
   explicitly ruled out; the route should read as a shorter version of the mail endpoint, missing
   the whole conversationId-matching branch, not as that branch with its condition disabled.

**Verified by:** `npx tsc --noEmit`; scenario coverage for the self-mention-vs-any-mention logic
and the empty-after-stripping case, driven directly against a small pure helper this step should
extract (e.g. `extractSelfMention(activity, botId)`) rather than only testing it through the route
handler, so it is provable the same way steps 1–2 are — no Bot Framework request needed for this
part. The JWT validation itself, and the exact shape of a real Bot Framework activity payload,
cannot be fully proven without a real request from Azure — that gap is closed in step 5, not
here; note in the code that this is deliberately unverified until then, the same way this
project's other connectors have flagged the boundary between what a harness can check and what
only a live message can.

## Step 4 — `infra/teams-intake.bicep`

**Touches:** `infra/teams-intake.bicep` (new), plus a documented manual step (not automated — see
below) for the Entra app registration.

Stands alone from steps 1–3, same convention `infra/intake.bicep` already sets and the
reply-threading plan's own step 5 followed: infrastructure changes are a separate operational
action from code changes, deployed and verified independently.

The Entra app registration for the bot's own identity is **not** created by this Bicep file —
`az ad app create` (or the portal) is a manual, one-time step, documented in the file's own header
comment the way `infra/intake.bicep`'s header already documents why its Office 365 connection
deploys unauthenticated and needs a person to authorize it. The Bicep file itself declares the
`Microsoft.BotService/botServices` resource, taking the app's client id as a parameter and setting
`endpoint` to `https://${appHostName}/api/intake/teams` — mirroring `intake.bicep`'s own
`intakeUrl` construction (`var intakeUrl = 'https://${appHostName}/api/intake'`,
`infra/intake.bicep:67`).

**Verified by:**
`az deployment group create -g Axiomate-TMS-RG -f infra/teams-intake.bicep -p botAppId=... botAppPassword=... appHostName=...`
reporting `Succeeded`, then — matching this project's own established distrust of that status
alone (the reply-threading rollout's own step 5 verified the workflow definition, connection
status and enabled state directly rather than trusting `az deployment group create`'s own report)
— a direct `az resource show` against the new bot resource confirming its messaging endpoint
matches the deployed app's real host name.

## Step 5 — Install the bot into the real OAPIL chat, prove one message end to end

**Touches:** nothing in the repository. Operational only.

A person adds the registered bot to the actual OAPIL Teams chat
(`19:540bb748bc014d8f9e6c83d69fc2d0a8@thread.v2`). The design's own "what would send this back"
list names a real risk here: if Teams requires a chat member to add the bot by hand through the
Teams client with no scriptable equivalent, that is an operational fact to record, not a bug to
route around — do not let this step quietly become "documented as a manual step" without first
checking whether `az bot` or Graph offers any programmatic path, since the answer changes what
`docs/intake.md`'s eventual Teams section should tell a firm to expect.

Once installed: add an `IntakeChat` row for the real chat (via `{k: 'upsertIntakeChat', ...}`,
same mechanism as any other config change, no new UI needed to prove this — a direct action is
consistent with how the D365 process-area module and the OAPIL mailbox repoint were both applied
earlier this session), then post one real @mention in the chat with genuine text, and confirm an
issue is created with the right scope, the right title, and a provenance note — the same
end-to-end proof the mail connector and the reply-threading design each required before being
trusted, not a deployment status taken on faith.

**Verified by:** the created issue itself, read back directly from the real workspace (the same
kind of direct-state check `scripts/merge-duplicate-threads.ts`'s dry run and this session's other
production verifications have used throughout) — confirming `scopeId`, `subject` (from
`firstLine()`), and a note recording the Teams message's provenance.

---

## Regression risk

This plan carries **no regression risk** in the usual sense — nothing existing is modified.
Confirmed by reading the actual reducer (`lib/workspace.ts`): `upsertIntake`/`deleteIntake` is its
own dedicated `case` in the `configure` switch, entirely separate from `upsertRoutingRule`,
`upsertBlueprint`, `upsertIntakeForm`, and every other config action — there is no shared
config-dispatch function whose behavior for existing types could be disturbed by adding
`upsertIntakeChat`/`deleteIntakeChat` alongside them. `classify()`, `classifyForm()`,
`matchingIssue()`, and `app/api/intake/route.ts` are none of them touched by any step here.

The highest-uncertainty step instead is **step 3** — not because it can break something that
works today, but because it is the one step whose actual contract (Bot Framework's real JWT
shape, its real activity payload, whether `entities` really carries mention information the way
the SDK's documentation describes) cannot be fully confirmed without a live Azure Bot resource and
a real Teams client, which do not exist until steps 4 and 5. Everything step 3's own logic can be
proven ahead of that boundary is proven by scenario in step 2 and step 3 itself; the boundary is
named explicitly in code rather than assumed away.

## What merges into one commit, what stands alone

Steps 1 and 2 are independent in the way the reply-threading plan's own steps 1 and 2 were kept
separate (the matching rule and the cleanup grouping rule were both pure, but were distinct
enough concerns to commit on their own) — but here, unlike that plan, step 2 has a direct,
narrow dependency on step 1 existing (`classifyChat()` needs `IntakeChat` and `intakeChats` to
resolve against) and the two together are still small. **Merge steps 1 and 2 into one commit** —
a config type nobody can look up yet, and a lookup function with no type to look up, are each
individually incomplete in a way the reply-threading plan's two pure steps were not (those two
functions had no dependency on each other at all). Step 3 stands alone — it is the first step
touching a new file with a real external dependency (`botbuilder`) and a new HTTP contract, worth
its own commit and its own review. **Step 4 stands alone**, per the established convention that
any infrastructure/deployment change is separate from code changes. Step 5 produces no commit —
it is a config-data change against production plus a live proof, the same shape as this session's
own D365-module and OAPIL-mailbox-repoint side-task, which also touched no files.

## What would send this back

From the design document directly:

- If Teams' actual delivery model does not match the design's assumption in §2 — if receiving
  @mentions at all turns out to require some other capability (a messaging extension, a command
  manifest) beyond a plain bot registration with a messaging endpoint — surfaces at step 3 or
  step 5, whichever first requires reading Bot Framework's real behavior rather than its
  documentation.
- If the org's Entra tenant requires admin approval this session cannot grant to register a new
  bot app — surfaces at step 4, before any Bicep deployment is worth attempting.
- If installing the bot into an already-existing group chat requires a chat member to add it by
  hand with no scriptable equivalent — surfaces at step 5, and per that step's own note, must be
  checked rather than assumed before it is written up as an accepted limitation.

One addition from reading the actual reducer code for this plan, about the plan's sequencing
rather than the design's substance:

- If `IntakeChat`'s validation turns out to need something beyond "non-empty string" — for
  instance, if a malformed or truncated `chatId` can be pasted into config and silently never
  match anything real, with no refusal at config-save time to catch it — that is a finding for
  step 1, surfaced by trying to save a deliberately malformed id during that step's own scenario
  coverage, not left for step 5 to discover against production.
