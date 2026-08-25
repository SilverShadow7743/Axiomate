# Teams intake — design

## What this answers

OAPIL's project team has an active Teams group chat, and the customer raises concerns in it —
flagged directly by the user, not found in code, since nothing in this codebase watches Teams at
all. Two intake paths exist today: email (`app/api/intake/route.ts`, fed by `infra/intake.bicep`'s
Logic App watching a shared mailbox) and the web form (`app/api/intake/form/route.ts`). Anything
raised in that chat goes nowhere unless a consultant happens to notice it and types it up by hand.

## What this is

**1. The trigger.** Explicit, not ambient. Most chat traffic is banter and status pings, not
client requests — unlike a mailbox, where every arriving message is already a deliberate email to
that address. A message only becomes intake when someone **@mentions the bot** in it. Confirmed
over two lighter alternatives (an emoji reaction, a slash command): a mention is what people
already reach for in Teams to flag something to someone, and unlike a reaction it carries no risk
of misreading which message the flag was actually about.

**2. The connector.** A true @mention requires something registered as a mentionable identity in
the chat — a Graph change-notification subscription alone cannot receive one, because there is no
"us" to mention. This needs a new Entra app registration for the bot's own identity (separate from
the app's existing sign-in registration, `docs/entra.md`) backing a new **Azure Bot** resource
(`Microsoft.BotService/botServices`), deployed standalone the way `infra/intake.bicep` already is.
Its messaging endpoint points directly at a new route on the existing App Service —
`/api/intake/teams` — rather than a separate Azure Function: Bot Framework already pushes each
chat activity as an HTTPS POST the moment it happens, so there is no polling gap the way there was
for mail, and no reason to split the `botbuilder` dependency into a second deployable unit.

Once the bot is added to a chat, Teams delivers it *every* message posted there, not only ones
that mention it — the trigger in §1 is enforced by this route's own code, checking each activity's
`entities` for a mention naming the bot, not by anything Teams withholds. Anything without that
entity is discarded on arrival: never logged, never stored, inspected only long enough to check
for the mention.

**3. Config.** A new `IntakeChat` record in `lib/config.ts`, deliberately the same shape as the
existing `IntakeMailbox` — `{id, chatId, scopeId, workflowId, enabled}` — rather than hardcoded to
OAPIL's one chat. The bot is installed per-chat by a person regardless of how the config is
modeled, so generalizing now costs nothing extra and avoids the shape of rework this session
already hit once this week, when a mailbox's process-area categorization turned out to be baked
into code instead of data.

**4. Classification.** A new `classifyChat()`, built the same way `classifyForm()` already is
alongside `classify()` — one shared `draftFor()` engine underneath both, so severity-guessing and
routing rules behave identically across every intake path; `classify()`'s own doc comment already
states why this is one copy and not two: *"two would drift, and the drift would be invisible until
a [second path]-raised record routed differently from the identical email."* The incoming
`InboundMessage` is built with `subject: ''` — Teams messages have no subject line, and
`firstLine()` already falls back to `'Message with no subject'` for exactly this shape of input,
a fallback built for the form path that Teams inherits for free — and `body` holding the message
text with the bot's own mention entity stripped out (`TurnContext.removeRecipientMention`, part of
the `botbuilder` SDK, not hand-rolled). `messageId` is the Bot Framework activity's own id, so the
existing `alreadyReceived()` redelivery check keeps working unchanged. `conversationId` is kept on
the record for reference but never used for matching — see §5.

Reuses the existing `InboundMail` table as-is rather than a new one: `mailbox` already means
"wherever this arrived from," and a Teams row simply holds the chat id there instead of an email
address.

**5. No reply-threading.** In email, `conversationId` identifies one thread among many in a
mailbox — the signal `matchingIssue()` (`lib/intake.ts`) already matches replies on. In a Teams
group chat there is usually only one conversation, start to finish; reusing `conversationId` as-is
would attach every single @mention in the chat to whichever issue the first one ever created. So
this path never calls `matchingIssue()` at all — every accepted @mention goes straight from
`classifyChat()`'s draft to `{t: 'create', kind: 'issue', ...}`, skipping the branch
`app/api/intake/route.ts` uses for email entirely. A genuine follow-up on an earlier flagged item
gets a note added by hand, or a second issue linked by hand — the same as any duplicate today,
confirmed as the deliberately simpler choice over teaching this path to read Teams' reply-to
relationship between messages.

## What this deliberately is not

**Not an archive of the chat.** Untriggered messages are inspected only long enough to check for
the mention entity, then dropped — this is not a general Teams monitoring or logging tool, and
nothing about it stores chat content nobody flagged.

**Not reply-threading**, per §5 above — confirmed as out of scope for the same reason a real
thread signal doesn't exist here the way it does for email.

**Not a channel bot.** This targets a Teams group chat specifically — the URL the user shared
(`.../l/chat/19:...@thread.v2/...`) is a chat, not a channel. A Teams channel has a different
message API shape (posts, replies, a distinct Graph resource) and would be its own follow-up if a
firm's intake moves there instead.

**Not a fix for anything about the mailbox path.** `classify()`, `matchingIssue()`,
`duplicateGroups()` and the reply-threading design they belong to are untouched; this adds a
parallel path into the same `persistActions` pipeline, not a change to the existing one.

## Verification

**Pure**: `classifyChat()` scenario-tested with hand-built `InboundMessage` fixtures, no live
Teams involved — mention-stripping, the empty-message refusal when an @mention carries no other
text, an unrecognized `chatId` refused the same way an unrecognized mailbox address is today, and
redelivery caught by the existing `alreadyReceived()` check. Same pattern as `IT1`–`IT9` in
`scripts/scenario-validation.ts`.

**Live**: register the bot, install it into the actual OAPIL chat, post one real @mention, confirm
an issue is created end to end — the same "prove it by doing it" discipline this project has
already applied to the mail connector and the reply-threading rollout, rather than trusting a
deployment's "Succeeded" status on its own.

## What would send this back

- If Teams' actual delivery model does not match §2's assumption — if receiving @mentions at all
  turns out to require some other capability (a messaging extension, a command manifest) beyond a
  plain bot registration with a messaging endpoint — that is a finding about Teams' real API
  shape, surfaced before the filtering code in §2 is built on an assumption that was never true.
- If the org's Entra tenant requires admin approval to register a new bot app that this session
  cannot grant on its own — that blocks the connector before any code is worth writing against it.
- If installing the bot into an *already-existing* group chat turns out to require a current chat
  member to add it by hand through the Teams client, with no scriptable equivalent — an
  operational fact about getting this live, not about the design's logic, but one the
  implementation plan should not promise past.
