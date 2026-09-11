# Reply and schedule — why this is a bigger decision than it looks

**Status: decided 11 September 2026 — Option C.** Nishant chose "draft into Outlook": the reply
is composed in Axiomate and saved as a draft in the person's own Outlook Drafts, and Outlook's
own *Schedule send* owns the timing. No new storage, the RAM-only token posture untouched.
Plan: `2026-09-11-reply-to-outlook-drafts-plan.md`. Originally: draft, 8 September 2026, the
user's direct request — *"reply and schedule."* The fork below is kept as written because it is
the record of why C was the shape chosen.

## What exists today

`POST /api/mail/reply` (`app/api/mail/reply/route.ts`) sends immediately: it takes a live Graph
access token from `lib/db/personalGraphTokens.ts` and calls Graph's reply action synchronously,
in the same request. Nothing is stored — Graph's own `saveToSentItems` puts the sent reply in the
person's own Sent Items, and Axiomate keeps no record of it at all.

## Why "schedule" doesn't fit that shape

Scheduling a reply for later means the reply has to still exist, and still be sendable, at a
point in time after the browser tab that composed it is long closed. Two things stand in the way
of that today, both **deliberate** design decisions from `docs/plans/2026-08-31-in-mail-design.md`,
not oversights:

1. **The reply text itself is never stored.** Today it lives only in React state in the compose
   dialog and is discarded the instant `sendReply` succeeds or the dialog closes. A scheduled
   reply has to survive past that point — somewhere durable.
2. **The Graph access token is RAM-only, by explicit design** (`lib/db/personalGraphTokens.ts`'s
   own header): *"Access and refresh tokens live in this process's memory and NOWHERE else...
   nothing at rest to leak from a backup or rotate."* An app restart — which Azure App Service
   does routinely, not as a failure — empties that cache. A reply scheduled for tomorrow morning
   has no guarantee a live, refreshable token still exists when tomorrow morning arrives.

Neither of these is a bug to route around quietly. They are the exact tradeoff the mail feature's
security posture was built on, stated plainly in its own design doc. Reopening either is a
security-posture decision, not an implementation detail — operating principle 6, escalate
decisions requiring executive judgement, applies directly here.

## The fork

**Option A — a durable, encrypted token store.** Persist delegated Graph refresh tokens (Prisma,
encrypted at rest) so a scheduled send can still get a live access token after a restart. This is
the only way to make "schedule this for next Monday" actually reliable. It is also a direct
reversal of the stated RAM-only posture, for every personal-Graph feature at once (inbox, reply,
compose, chat, file), not just this one — the cache is shared across all of them
(`personalGraphTokens.ts`'s own note: "one person's sign-in now carries five delegated scopes in
the same token"). This needs to be decided as a posture change, with eyes open to what it means
for every feature built on that cache so far, not smuggled in as one feature's implementation
choice.

**Option B — session-scoped scheduling only.** Store just the drafted reply (message id, text,
reply-all flag, target send time) in the database — new state, but small and inert, nothing
Graph-credential-shaped — and fire it from the existing scheduled-pass mechanism
(`lib/automation.ts`'s daily job already proves this pattern) **only if** a live token still
happens to be cached for that person when the moment arrives; otherwise the scheduled reply fails
visibly (an item in the person's own "failed to send — reconnect and retry" list — never a silent
drop) rather than trying to force a send with no token. This keeps the RAM-only posture entirely
intact, at the cost of "schedule for tomorrow" being unreliable across a restart in exactly the
way the existing posture already accepts inbox reads being unreliable across a restart. Whether
that reliability bar is good enough for a reply — arguably more consequential than a read — is
Nishant's call, not a default to assume.

**Option C — not scheduling as timing, but scheduling as drafting.** A near-reading of "reply and
schedule" that never needs a live token at rest: save the composed reply as a **draft**
(`POST /me/messages/{id}/createReply` then `PATCH` the draft body, both already inside `Mail.Send`)
sitting in the person's own Outlook Drafts folder, for them to send at will — Outlook's own
"schedule send" feature, if the mailbox has it enabled, then does the actual timing entirely
inside Microsoft's infrastructure, never touching Axiomate's token cache at all. This narrows the
ask from "Axiomate sends this for me later" to "Axiomate hands this to Outlook, already written,
for me to send or schedule there" — smaller, safer, and reuses infrastructure this codebase does
not have to build or trust itself.

## Recommendation, not a decision

Option C is named first because it is the only one of the three that adds zero new storage and
zero new posture risk, while still answering the literal request — draft the reply once, from
inside the inbox you're already reading, instead of retyping it in Outlook. It composes cleanly
with the full-body-view design (`2026-09-08-email-body-view-design.md`) — read it here, draft the
reply here, let Outlook own the actual send timing. But this is a recommendation to weigh, not a
conclusion reached here; Options A and B answer a more literal reading of "schedule," and the
right one depends on how much timing precision actually matters versus how much the RAM-only
posture is worth protecting. Named as the open question below, deliberately not resolved in this
draft.

## Non-goals, regardless of which option

Recurring/rule-based scheduled replies (out-of-office style automation) — a different, larger
feature. Scheduling a **cold compose** (not a reply to anything) — out of scope for this pass,
which is specifically about the reply flow already built.

## Open question for Nishant

Which of A / B / C — or does "schedule" actually mean something narrower, like "let me finish
this reply later today without losing my draft," which is smaller than any of the three above and
worth naming explicitly if that's the real ask.
