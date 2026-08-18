# Mail, calendar and Teams inside Axiomate — personal and per engagement

*18 August 2026. A design, not an increment — it settles an architectural fork and asks for three*

Two tiers, and the distinction between them decides almost everything else.

**Personal.** Each person connects their own Microsoft 365 account and sees their own mail,
calendar and Teams. Nobody sees anybody else's.

**Engagement.** An engagement has a mailbox of its own — `oapil@`, `slg@` — shared by the people
delivering it, and it survives any of them leaving.

They look alike and they are not. Personal correspondence belongs to a person; an engagement's
mailbox is the firm's record of a client relationship. That single difference points the token
model, the storage decision and the visibility rule in opposite directions, which is why they are
designed together rather than one being a special case of the other.

---

## 1. Where this came from

Intake pointed at an individual's mailbox produced, in one day, twenty-seven issues. About
seventeen were LinkedIn notifications, newsletters, Pinterest digests, meeting-bot summaries,
out-of-office replies and two bank one-time passcodes.

**It is a company mailbox, not a private one** — `sekharn@axiocloudsolutions.com`, on the firm's
own domain. An earlier draft of this called it personal and that was wrong. What matters is not
who owns the mailbox but that it is **individually addressed**: office mail routinely carries
one-to-one management conversations, commercial negotiation and HR matters, and twenty-five
colleagues reading one person's inbox is a problem whether or not the firm owns the domain.

The two bank passcodes are the useful evidence here. They arrived at the office address, which is
what an office address does in practice — it receives things that are not work, and no policy
about what it is *for* changes what actually lands in it.

The obvious fix is a filter. It is the wrong one: a filter is a permanent guess about which mail
matters, wrong at the edges, and silent when it is wrong. The second fix is a triage queue on a
shared mailbox — better, and it was half built before this design replaced it, because a shared
queue is the wrong shape for individually addressed mail. **A person decides about their own
mail**, whoever owns the domain it arrives on.

---

## 2. The fork this settles, and why it points the other way from documents

Documents use an **app-only** token, deliberately. `lib/storage/graph.ts` argues it: a document
uploaded by a consultant who later leaves must not become unreachable when their account is
disabled, because that document is the acceptance evidence for a delivered milestone. The firm
owns the artefact.

Mail, calendar and Teams are the opposite, and the same reasoning produces the opposite answer.

|  | Documents | **Personal** mail / calendar / Teams | **Engagement** mailbox |
|---|---|---|---|
| Who owns it | The firm | The person | The firm |
| Token | App-only | **Delegated, per user** | App-only |
| On departure | Must survive | Must become unreachable | Must survive |
| Visible to | Anyone signed in | That person alone | The engagement's people |
| Blast radius if wrong | One library | Every mailbox in the tenant | One client's correspondence |

An app-only `Mail.Read` would let this application read everybody's mail — including people who
never opened it. That is not a risk to be managed with a permission key; it is a thing not to
build. Personal is **delegated, per user, consented individually**.

An engagement mailbox is the opposite case and lands where documents landed: it is the firm's
record of a client relationship, it must outlive whoever happened to be on the engagement, and
app-only is therefore right — with the same caution `lib/storage/graph.ts` already states, that
SharePoint's own permissions are then not a second line of defence and visibility is decided
here.

---

## 3. The decision that shapes everything else: store, or fetch

This is the first of two questions this design cannot answer for the firm.

### Option A — fetch live, store nothing

Axiomate calls Graph on each request with that person's token. No mail, calendar or chat content
enters the database at all.

- The leak surface is zero, because there is nothing to leak.
- A departing person's correspondence becomes unreachable the moment their account is disabled,
  which is the correct behaviour and requires no cleanup job to be remembered.
- A subject access request is answered with "we hold none of it".
- **Costs:** every page view is a Graph call, subject to throttling; nothing works when Graph is
  down; no search across history; and a message that ages out of the mailbox is gone from
  Axiomate too.

### Option B — store per user

A copy in the workspace, keyed to the owner, withheld from everybody else at the boundary.

- Enables a queue that survives, search, and offline reading.
- **Costs:** the firm's database now holds every employee's individually addressed mail. The firm
  owning the mailboxes does not make that free — it is a materially different retention posture, it
  is what a DPA asks about, and the withholding becomes a permission check that has to be right on
  every path forever. This codebase has been caught by the payload-leak class three times; this is
  the collection where the fourth would matter.

### Recommendation: it resolves differently per tier, and that is the point

**Personal → A, fetch live, keeping a reference on the way out.** When somebody turns one of their
own messages into work, store the **reference and what they chose to quote** — `messageId`,
subject, sender, received date, and an excerpt the person selected — on the issue. Not the
message. That gives traceability ("this action came from that email, here is the paragraph")
without the firm holding anybody's correspondence, and it is the same instinct as `Document` and
`Evidence`: keep the fact, not the copy.

**Engagement → B, store it.** Every argument against storing individually addressed mail is an
argument *for* storing this. A team sharing a queue needs the queue to exist between them; a message that arrives
while one person is on leave has to still be there when they return; and a departing consultant
must not take the client's correspondence with them. The privacy posture is different in kind,
because this is a client relationship the firm is a party to rather than an individual's inbox.

So the triage queue — a message arrives, waits, and a person turns it into work or dismisses it
with a reason — belongs to the **engagement** tier and not the personal one. That is the shape
that was half built and reverted on 18 August: right idea, wrong tier.

---

## 4. The second decision: which of the three, and in what order

They are not equally valuable to a delivery firm, and they are not equally sensitive.

| | Consent | Value here | Sensitivity |
|---|---|---|---|
| **Calendar** | `Calendars.Read` | **Highest.** Meetings are time that is not available for delivery, and `Commitment` — the record that takes time off capacity — has **zero rows** because nothing populates it | Moderate: subjects and attendees |
| **Mail** | `Mail.Read` | High. Replaces the intake path for personal addresses and fixes the problem that started this | High: entire correspondence |
| **Teams** | `Chat.Read` | Moderate. Where delivery conversation actually happens, but least structured | **Highest.** Chat is the most personal of the three and the consent is broad |

**Calendar first** is the recommendation, and not only because it is easiest. Capacity, allocation
and availability are all built and all currently assume nobody has any meetings — `Commitment` has
no rows, so every availability figure in the product is optimistic by exactly the amount of time
people actually spend in meetings. Connecting one calendar fixes a number that is wrong today.

Teams last, and possibly opted into separately from the other two, because `Chat.Read` is a
consent a person should be able to decline while still connecting their calendar.

---

## 4a. Engagement visibility depends on a question that is still open

"The engagement's people" has to be computable, and it is the same definition that pending action
**D1** has been waiting on since 17 August: *what does "project stakeholder" resolve from?*

The candidates already in the data give different answers:

| Definition | Includes | Misses |
|---|---|---|
| Has a live `Allocation` on a project under the engagement | The delivery team | A client sponsor, who has no allocation |
| Named on the `Engagement` — leader, PM, sponsor | The accountable few | Consultants doing the work |
| Holds a role scoped to it | Whatever the firm configured | Depends entirely on configuration being kept up |

An engagement mailbox makes this urgent in a way a client filter did not: get it wrong on a filter
and somebody sees the wrong rows in a grid; get it wrong here and somebody reads a client's
correspondence they were not party to. **D1 should be answered before an engagement mailbox is
built**, and answered for visibility rather than for filtering.

---

## 5. What already exists

More than might be expected. This is not a greenfield integration.

| Piece | State |
|---|---|
| Auth-code + PKCE against Entra | **Built** — `lib/auth/entra.ts`. Today it requests `openid profile email` only, with a comment that "a scope asked for is a permission somebody has to justify" |
| Sealing values into a cookie | **Built** — `lib/auth/seal.ts`, key as a parameter |
| Secret reading with a length floor | **Built** — `lib/secrets.ts` |
| HTML mail → readable text | **Built** — `htmlToText` in `lib/intake.ts` |
| Where a meeting belongs | **Built** — `Commitment`, kinds Leave / Public holiday / Internal / Training |
| Graph calls, token caching, error mapping | **Built for app-only** — `lib/storage/graph.ts`. Directly reusable for the engagement tier; the token half is not reusable for the personal one |
| A mailbox that already knows its scope | **Built** — `IntakeMailbox.scopeId` already files into a scope in the tree, so "this mailbox belongs to this engagement" is a configuration that half exists |
| A shared mailbox poll | **Built and deployed** — the intake Logic App already uses the `SharedMailbox` trigger with the address as a parameter, which is exactly the shape an engagement mailbox needs |

**What does not exist and is the real work: per-user token storage.** A refresh token is a
long-lived credential for somebody's mailbox. It needs encryption at rest with a key that is not
the session-signing key, a revocation path, an answer for what happens when somebody leaves, and
a decision about whether an administrator can see that a connection exists (yes) or use it (no).

That is a security-sensitive component and it should have its own design before it has code.

---

## 6. What this replaces

The shared intake mailbox is not replaced — it is **renamed to what it always was**. An address
that files automatically into a scope is exactly an engagement mailbox with
`disposition: file`; add `disposition: triage` and the same record describes the queue in §3.
`IntakeMailbox.scopeId` already points at a scope in the tree, so most of the configuration exists.

What stops is pointing one at anybody's individual mailbox — company-owned or not. That is the
change that fixes the problem this design came from, and it waits for nothing here.

---

## 7. Immediate, independent of all of it

**Intake is still filing from `sekharn@axiocloudsolutions.com` right now.** Roughly one to two
messages an hour become issues. It is the firm's own mailbox, which softens the framing and does
not change the substance: it is one person's individually addressed mail, being copied into a
workspace twenty-five people can read, and about two thirds of it is not work.

One config change stops it — `enabled: false` on the mailbox, in Configuration → Routing & intake,
or a one-line script. Nothing in this document should be waited for first.

The two bank passcodes already stored (`AXM-094`, archived; `AXM-095`, live) are a separate
five-minute job and should not wait either.

---

## 8. What this design asks for

1. **Store or fetch** — §3. The recommendation splits by tier: fetch for personal, keeping only a
   reference when work is created; store for engagement, because a shared queue has to exist
   between people and outlive them.
2. **Which of the three, in what order** — §4. The recommendation is calendar first, mail second,
   Teams last and separately consented.
3. **D1, at last** — §4a. What "on this engagement" resolves from. It was a filtering question and
   is now a visibility one, which is a different standard of wrong.

All three change the schema, so none should be answered by starting to build.

The order that follows from the recommendations, if they are accepted: **engagement mailbox
first** — it reuses the deployed shared-mailbox poll, the app-only Graph client and the existing
scoped-mailbox configuration, and it is the tier where a stored queue is the right answer. Personal
connection is the larger piece, because per-user token storage is a security component that has no
equivalent in the codebase today.
