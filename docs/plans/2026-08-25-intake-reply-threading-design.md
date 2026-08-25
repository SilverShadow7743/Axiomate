# Intake reply threading — design

## What this answers

A reply on an existing client email thread files as a brand-new issue, every time. Verified in
code, not assumed: `InboundMessage` (`lib/intake.ts`) carries no thread identifier at all,
`classify()` only routes on subject/body keywords, and `alreadyReceived()` only catches the exact
same message id arriving twice — a genuine reply, with its own new message id, is indistinguishable
from an unrelated new message. This is already diagnosed in `docs/intake.md`, under *"A reply to an
existing issue creates a second issue"* — *"this is the first thing a firm hits in production,
usually within a day of going live."* It has already happened here: `OAPIL-149`/`150`/`151`
("Fw: item master" / "RE: item master" / "RE: item master") are almost certainly one thread, filed
three times.

The same document names the fix and the trap: use Exchange's `conversationId`, stable across a
thread and already present on the Logic App trigger's payload — and resist matching on the `Re:`
subject line instead, because *"subjects get edited, translated and reused, and a wrong match
files a client's message against another client's issue."*

## What this is

**1. The connector.** `infra/intake.bicep`'s existing field-mapping action — the one that already
maps `subject`, `body`, and `messageId` (from the trigger's `internetMessageId`) into the intake
payload — gains one more line, `conversationId: '@triggerBody()?[\'conversationId\']'`. Graph's
trigger already returns it; nothing else about the Logic App's shape changes.

**2. Live matching, forward-looking only.** `InboundMail` gains a nullable `conversationId`
column. In `app/api/intake/route.ts`, before the endpoint decides to create a new issue, it looks
up `InboundMail` rows sharing the incoming `conversationId`, joined to their `issueId`:

- No `conversationId` on the incoming message (the intake-form path isn't email and never has
  one; a connector that hasn't been redeployed yet), or no matching row — today's behavior,
  unchanged: create a new issue.
- Exactly one matching issue — attach the reply as a pinned `Client Communication` note on it,
  the same note shape the create path already writes, instead of creating a new issue. The
  issue's status is left exactly as it was; a reply on a closed issue does not reopen it —
  machine-filed work should file, not judge whether something is actually still open. A person
  reads the note and decides.
- More than one matching issue (legacy data from before this shipped, or a thread a person
  split by hand) — attach to whichever matching issue has the most recent activity. Never
  refuses and never guesses at content placement beyond that: the tie-break is deliberately the
  simplest rule that cannot misfile a reply onto an unrelated client's work, since every
  candidate already shares the real thread id.

**3. Cleanup, one time, for what the bug already created.** A script — not a live rule, since
messages received before this ships never captured a real `conversationId` to match on. It groups
*existing* issues by mailbox + client + subject with a leading `Re:`/`Fw:`/`Fwd:` (any case,
any repetition — `Re: Re: Fwd:` included) stripped, within the same parent node, and links every
issue in a group other than the most-recently-active one to it using the relationship type this
codebase already has for exactly this — `IssueRelationship`'s `DUPLICATE_OF`, the same relationship
the `duplicate` action itself already mints (`lib/workspace.ts`, the `duplicate` reducer arm).
Nothing is deleted, merged, or moved: no note history, no time entries, no status change on any
issue in a group — only a cross-reference a person can act on, and can undo by removing the link
if it's wrong. The script reports every group it links before/while acting, in the same shape
`persistence-proof.ts` and its siblings already report their own runs, and supports a dry run
that changes nothing.

## What this deliberately is not

**Not real-time subject matching.** The live pipeline (§2) only ever matches on `conversationId` —
a real, Exchange-assigned thread id. It is never applied to the cleanup pass's job either; the
two use different signals for a reason, matching the doc's own explicit warning.

**Not reopening a closed issue on reply**, per the earlier confirmed answer — a note is added,
status is untouched, a person decides.

**Not a content merge.** The cleanup pass links; it does not consolidate notes, time entries, or
any other record between duplicate issues. A firm that wants one canonical thread's full history
in one place still does that by hand — this makes the duplicates findable, not identical.

**Not a fix for the mail-loop risk** `docs/intake.md` separately documents. That risk is blocked
on outbound transport existing at all, which it does not yet — unrelated to threading and out of
scope here.

## Verification

**Live matching**: scenario coverage in `scripts/scenario-validation.ts` proving — a reply whose
`conversationId` matches one open issue adds a note, creates nothing; a reply matching one closed
issue adds a note, issue stays closed; a reply matching two issues attaches to the more recently
active one; a reply with no `conversationId`, or one matching nothing, creates a new issue exactly
as today. Each driven directly against the reducer/intake logic, no database.

**Cleanup script**: a dry-run report against the real, live data — named candidate groups,
including the "item master" thread — reviewed before the script is ever run for real, matching
this project's own established discipline of proving a script's actual output against production
data before trusting it, not just against its own logic.

## What would send this back

- If `conversationId` turns out not to survive the trigger→connector→payload path intact once
  actually deployed (a Graph API quirk, a Logic App expression that silently resolves to null) —
  that is a finding about the connector, surfaced before §2's matching logic is built on top of
  a value that was never really there.
- If the cleanup pass's subject-stripping regex produces a false-positive group on the real data
  — two genuinely unrelated issues that happen to share a mailbox, client, and a common subject
  line like "Weekly status" — that is the dry-run's job to catch before anything is linked, not
  a case to guard against with a cleverer regex.
