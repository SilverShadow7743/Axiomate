# Personal connect, write side — compose, reply, schedule, Teams chat

*7 September 2026. A design, not an increment — extends `2026-08-18-connected-workspace-design.md`
("Personal" tier) from read-only to read-and-act. Not yet built; not yet gated.*

> **Token posture revised 11 September 2026** — the RAM-only cache this design leans on now
> also seals the refresh token at rest; see `2026-09-11-durable-personal-graph-tokens-design.md`.

**Requested:** every user connects their own Microsoft 365 account and can, from inside Axiomate,
compose a new email, reply or reply-all, schedule a meeting, and send a Teams chat message.

**What exists today.** `in-mail` (approved 2026-08-31, shipped) reads a person's own inbox
(`Mail.Read`) and files a message as work — read and file, nothing sent. The `08-18` design that
this one extends recommended, in order, **Calendar first** (`Calendars.Read`), then **Mail**
(`Mail.Read` — the slice that shipped), then **Teams last** (`Chat.Read`) — all three read-only,
none of them built for Calendar or Teams yet. Nothing in the codebase today sends mail, writes a
calendar event, or posts to Teams on a user's behalf.

## This is a different risk tier from what's shipped, not a bigger version of it

`08-18`'s own table (§2) already states the reasoning this design inherits: personal mail,
calendar and Teams are **delegated, per user, consented individually**, because an app-only grant
"would let this application read everybody's mail — including people who never opened it... a
thing not to build." Write access does not change which side of that table personal data sits on,
but it does change what a bug costs: a read bug shows the wrong person something; a write bug
**sends** something, **schedules** something, or **posts** something, in that person's name, to a
client. There is no undo-by-permission-check on a message already in someone's Teams client.

## The four capabilities, least-privileged scope, and what each is actually for

| Capability | Graph delegated scope | Consent | Why a delivery firm wants it |
|---|---|---|---|
| **Reply / reply-all** | `Mail.Send` | Per Microsoft's own table this scope does not *require* admin consent for a work account — file it under the org's existing practice anyway (A6 precedent: `Sites.ReadWrite.All` was granted 19 Aug via an explicit `appRoleAssignment`, not left to per-user consent) | Closes the loop `in-mail` opened: file a client message as work, then answer it, without leaving the tree |
| **Compose new** | `Mail.Send` (same scope as reply) | as above | Lower value than reply — a new message has no issue context to attach to yet. Worth sequencing after reply, not before |
| **Schedule a meeting** | `Calendars.ReadWrite` (Teams meeting link via `isOnlineMeeting: true` on the event, not a separate `OnlineMeetings.ReadWrite` grant — confirmed against Microsoft's own event-creation reference) | Admin consent, same posture as above | `08-18` already established Calendar as highest-value-read because `Commitment` has zero rows and every capacity figure is optimistic by exactly the time nobody logs. Being able to *place* a meeting from an issue, not just read one, is what makes that number self-correcting instead of self-reported |
| **Teams chat message** | `Chat.Create` (least-privileged for starting a 1:1 chat) or `Chat.ReadWrite` if replying into an existing thread the app didn't start | Admin consent | `08-18` ranked this **highest sensitivity** of the three and recommended it last, opt-in separately from Calendar. Nothing here changes that ranking |

**Sequencing follows `08-18`'s own order** — Calendar, then Mail, then Teams — because that
order was reasoned from value and risk once already, not because this design re-derives it.
Reply-before-compose is the one addition specific to write: reply has an issue to attach
provenance to; a cold compose does not.

## What "connect" means on the write side, concretely

- Nothing here changes storage posture. `08-18`'s **fetch live, store nothing** decision for
  Personal holds: a sent message, a created event, a posted chat is *dispatched* through Graph
  with the person's own token and never persisted in Axiomate's database. What Axiomate keeps is
  the same `recordInboundMail`-shaped provenance `in-mail`'s file-to-issue already writes for
  reads — who sent what, when, against which issue — never the content, because the content
  already lives in the person's own mailbox/calendar/Teams, which is the system of record.
- Every send/create is **attributed to the signed-in person's own account**, never to a service
  identity — the same delegated posture `in-mail`'s auth section states outright: "each token
  reads ONLY its own person's mail, structurally." A write extends that to "each token acts only
  as its own person," which is the property that makes this safe to build at all.
- RAM-only tokens carry over unchanged from `in-mail` — no new storage decision needed here.

## Non-goals, held over from `in-mail`

Other people's mailboxes; anything on the **Engagement** tier (`oapil@`, `slg@` mailboxes are
app-only and out of scope for this design); Gmail/IMAP; a full mail/calendar client UI — this is
compose/reply/reply-all/schedule/chat as actions launched from an issue, not a mailbox app inside
Axiomate.

## What this needs before it can be built

1. **Admin consent for four new delegated scopes** (`Mail.Send`, `Calendars.ReadWrite`,
   `Chat.Create`, `Chat.ReadWrite`) on the existing app registration — an Entra action, same
   category as A6's `Sites.ReadWrite.All` grant. Nobody but a Global Admin can do this.
2. **A security review pass**, the same weight `docs/security.md`'s 16 Aug review gave the
   unauthenticated-read finding — write-as-the-user is a new blast-radius class this codebase
   has not carried before, and the existing checklist has no section for it.
3. **A plan doc**, per this repo's own build discipline, once the scopes above are actually
   granted — building against ungranted scopes produces exactly the "not diagnosable" class of
   failure the Entra guest-invite issue already is.

## What would send this back

- Admin consent is granted for read but withheld for one or more of the four write scopes → that
  capability ships alone or not at all; the four are independently gateable, not a bundle.
- The security review finds that RAM-only token storage does not hold up under write (a crashed
  request mid-send, a token that outlives its intended single use) → the storage question reopens
  as a real decision, the same trigger `in-mail`'s own "what would send this back" names for reads.
