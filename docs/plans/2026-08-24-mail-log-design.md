# A read-only mail log — design

## What this answers

The email slice of the BOS reference document, scoped down twice by what was actually found
while exploring it. First: replying to a client already exists, fully — `OverviewTab.tsx`'s
compose button, `POST /api/mail/send`, real Graph sending, a client-visible note recording what
was sent. Second: the real gap is not "one-way" or "no folders" — it is that **nothing arriving
is ever kept**. `classify()` turns a message into an issue or a refusal and the message itself is
discarded either way; there is no object a person could review, search, or point at afterward.

This design is the narrower thing chosen over the larger one: persist every inbound message as
its own record, and add a read-only screen to browse them. No triage, no redirect, no
reprocessing — `classify()`'s decision stands exactly as it is made today.

## A prior decision this reopens, named rather than silently overridden

`lib/intake.ts`'s own header comment states, about keeping a message's original form: "Storing a
second copy of every client email as markup nobody reads is a cost with no reader." That was
correct when it was written — there was no reader. This design's whole premise is that there now
is one, so the objection is answered rather than ignored, and it is worth saying so plainly
rather than quietly doing the opposite of a decision that was reasoned, not careless.

## What this is

A new record, `InboundMail` — the mailbox address, sender, subject, body (already converted to
plain text by `htmlToText`, the same form every other consumer of a message already sees — not a
second HTML copy), the sender's message id, when it arrived, and the outcome: the issue it
became, or the reason it was refused. **Refused messages are logged too** — a reference log that
silently drops what got bounced is not a complete reference, and today a refusal leaves no trace
at all, findable nowhere.

Written through the reducer, like everything else in this app — `POST /api/intake` gains one more
action in its batch, `recordInboundMail`, alongside the `create`/`addNote`/`setAssignment` actions
it already dispatches. "The record is created through the same reducer" is the intake endpoint's
own stated reason every other side effect of a message already works this way; this one follows
it rather than writing around it.

A new screen: a "Mail log" section on the existing **Configuration → Routing & intake** tab
(`components/ConfigWorkspace.tsx`'s `Routing` component), not a new view-switcher entry. Two
reasons: the view switcher already has eight entries and a ninth would crowd it, and — the
sharper reason — "Inbox" is already taken, by the personal notifications view this program's
previous slice shipped. A second thing called "Inbox" showing entirely different content would
be exactly the naming confusion the Calendar/My-calendar split was built to avoid. Pairing the log
with the routing *rules* that decided each message's fate is also a better home than a standalone
view: seeing what arrived next to the configuration that decided what happens to it is a more
useful screen than either alone.

## A real, deliberate improvement to already-shipped logic, named as such

`POST /api/intake`'s duplicate check today is `Object.values(state.notes).some((n) =>
n.body.includes(full.messageId))` — a substring search over note bodies, because the message id
was never stored anywhere more direct. Once `InboundMail.messageId` exists, the honest fix is to
check that field directly instead. This is a behaviour change to a live, working, already-shipped
endpoint, not a new feature riding along for free, and it needs its own scenario proving the new
check refuses a re-delivered message at least as reliably as the old one did — not assumed
equivalent because it looks strictly more correct.

## What this deliberately is not

**Not project-scoped.** Visibility is `internal.view` only, matching every other part of intake
and communication today — deliberately not narrowed by the project-membership boundary the
previous program shipped, even though it would be a consistent extension. Chosen for the same
reason most of this program's slices stay narrow: this is what intake actually is today (ungated
by project), and widening the scope of what gets gated is a separate decision from building a
reference log.

**Not a triage tool.** No "attach this to a different issue," no "reclassify," no reply from this
screen (that already exists, on the issue itself). This screen answers "what did we receive,"
nothing more — the scope the smaller of two real options this design chose over.

**Not a second inbox in name or content.** See above — "Mail log," on Configuration, not a
view-switcher entry.

## What would send this back

- If logging every message — including ones later found to carry something sensitive that
  shouldn't persist twice — turns out to need redaction rules this design doesn't have (a
  client's own confidential content, say), that's a real privacy question the "cost with no
  reader" comment never had to answer and this design doesn't either; it would need its own pass
  before shipping, not a patch.
- If the duplicate-check switch, once scenario-tested, doesn't refuse a re-delivered message as
  reliably as the substring check did — that's the live endpoint regressing, and it stops there
  rather than shipping a "close enough" replacement.
