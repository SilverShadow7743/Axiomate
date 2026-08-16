# Mail intake

This page is for whoever takes the call when a client says they emailed and nothing appeared.

Axiomate does not fetch mail. The application receives a message on `POST /api/intake`, matches
it to a configured mailbox, applies the routing rules and files a work item — all of which is in
`lib/intake.ts` and `app/api/intake/route.ts`, and none of which involves a mailbox. The thing
that watches the mailbox and does the POST is a Logic App, deployed by `infra/intake.bicep`, and
it is the subject of this page.

The whole path is: a client sends mail to the shared mailbox, the Logic App notices it within
one polling interval, it posts a JSON message to `/api/intake` with a bearer token, and the
endpoint creates an issue under the scope configured for that mailbox with a pinned note saying
how it got there. There are exactly three places it can break, and they are the three sections
of the troubleshooting list at the end.

## What is deployed, and against which mailbox

`infra/intake.bicep` creates two resources per watched mailbox:

- a **Logic App** (Consumption) that polls the mailbox and posts to `https://<appHost>/api/intake`;
- an **Office 365 API connection** it uses to read the mailbox.

The parameters that matter operationally:

| Parameter | What it is |
| --- | --- |
| `mailboxAddress` | The shared mailbox being watched, e.g. `support@axiocloudsolutions.com`. This exact string is also sent as the message's `to`, which is what selects the mailbox inside Axiomate. |
| `appHostName` | Host of the deployed application, without scheme or path. |
| `intakeToken` | The value of `AXIOMATE_INTAKE_TOKEN` on the application. Passed in from Key Vault by `infra/main.bicep`, where it is held as `axiomate-intake-token`; it is never written in a template or a parameter file. |
| `pollMinutes` | How often the mailbox is checked. Three minutes by default. This is both the worst-case delay before an issue exists and effectively the entire running cost. |

`mailboxAddress` must appear, character for character, under **Configuration → Routing & intake**
in Axiomate, with a scope set and the mailbox enabled. Those two settings live in different
systems and nothing reconciles them; keeping them in step is a deployment step, not a feature.

One Logic App watches one mailbox. A second intake address means a second deployment of this
module with a different `name` and `mailboxAddress`.

## Authorise the connection, or nothing will ever arrive

**This is the step that gets forgotten, and it fails silently.**

An Office 365 connection is authorised by a person granting OAuth consent. A deployment cannot
do it. The template therefore creates the connection with no credentials, the deployment reports
success, the Logic App shows as Enabled — and it never polls, never runs, and never logs an
error, because a trigger with no consent has nothing to fail at. The run history stays empty,
which looks identical to a mailbox nobody has written to.

After every deployment that creates or replaces the connection:

1. Open the connection resource in the portal. `infra/intake.bicep` outputs a direct link as
   `authoriseConnectionUrl`; otherwise it is the resource named `<logicAppName>-office365` in
   the resource group.
2. If the status reads **Unauthenticated** or shows an error, select **Edit API connection**,
   then **Authorise**.
3. Sign in, consent, and **Save**. The status becomes **Connected**.
4. Open the Logic App and confirm a trigger evaluation appears in the run history within one
   polling interval.

Sign in as a **service account that has been granted read access to the shared mailbox**, not as
the person doing the deployment. The consent is bound to the identity that granted it, so
authorising as an individual means intake stops on the day that individual leaves the firm and
their account is disabled — usually a fortnight before anyone notices the issue count fell.

Redeploying the template does not revoke the consent. Deleting and recreating the connection
does, and so does a tenant policy that revokes refresh tokens; both require this section again.

## Proving it works

### Fastest: post a message directly

This bypasses the mailbox, the connection and the Logic App entirely, and proves that the
endpoint, the token, the database, the mailbox configuration and the routing rules are all
correct. Do this first, because if it fails the Logic App was never the problem.

The token is the one the application holds as `AXIOMATE_INTAKE_TOKEN`, kept in Key Vault as
`axiomate-intake-token`:

```bash
export AXIOMATE_INTAKE_TOKEN=$(az keyvault secret show \
  --vault-name <vaultName> --name axiomate-intake-token --query value -o tsv)
```

```bash
curl -i -X POST "https://<appHostName>/api/intake" \
  -H "Authorization: Bearer $AXIOMATE_INTAKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"to\": \"support@axiocloudsolutions.com\",
    \"from\": \"someone@client.example\",
    \"subject\": \"Cannot post invoices — urgent\",
    \"body\": \"Posting fails with a period-closed error since this morning.\",
    \"messageId\": \"<test-$(date +%s)@axiocloudsolutions.com>\",
    \"receivedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
  }"
```

On Windows, run this from Git Bash, or use `curl.exe` from PowerShell — the `curl` alias in
PowerShell is `Invoke-WebRequest` and takes different arguments.

`messageId` is generated fresh here for a reason. The endpoint refuses a message id it has
already recorded and answers `{"ok":true,"duplicate":true}` — a success that created nothing.
Reusing the same test id is the most common way to convince yourself intake is broken when it is
working perfectly. Change it every time.

A success returns the created issue id, which rules fired, and how much of the classification
was guessed:

```json
{"ok":true,"issueId":"...","matchedOn":["..."],"confidence":{"severity":"guessed","type":"default"},"noteRecorded":true}
```

### Then: send a real email

Send one to the shared mailbox from outside, and wait a full polling interval plus a few seconds
for the run — three minutes by default. Then open the Logic App's run history: there should be
one run, succeeded, and the issue should be in Axiomate with a pinned Client Communication note
recording the sender, the time and the message id.

If the direct POST works and the emailed one does not, the fault is in the Logic App or the
connection, and nowhere else.

## What arrives, field by field

| Payload field | Source | Note |
| --- | --- | --- |
| `to` | The `mailboxAddress` parameter | Deliberately not the message's `To:` header. Mail reaches a shared mailbox via distribution lists, aliases and blind copies, so the header often does not name this mailbox at all, and the header is a semicolon-joined list besides. Axiomate selects the mailbox by exact match on this field. |
| `from` | The sender's address | Becomes `raisedBy` on the issue. |
| `subject` | The subject | Becomes the issue name. An empty subject falls back to the first line of the body. |
| `body` | The message body, as sent | HTML mail arrives as HTML. Flattening it was rejected: the available converter is in preview, discards hyperlinks and wraps at eighty characters, and losing a link a client sent is worse than showing tags. |
| `messageId` | `internetMessageId` — the RFC 2822 id from the sender's own mail server | The duplicate check. See below. |
| `receivedAt` | When the client's mail server received it | If absent, the endpoint stamps its own arrival time, which is out by up to one polling interval. |

`messageId` carries more weight than the rest put together. The endpoint records it on the pinned
note of every issue it creates, and refuses any message whose id it already holds. That is what
makes resubmitting a failed run safe, and what stops a connector restarting mid-batch from
raising everything twice. The value used is the internet message id, which the sender stamped and
which never changes. The obvious alternative — the mailbox's own item id — changes when the
message is moved to another folder, so resubmitting a run for a message somebody has since filed
would raise the issue a second time with nothing to show anything had gone wrong.

Severity and type are guesses, and the application says so: the pinned note on each issue states
which fields a rule decided and which were inferred from wording, and everything is created as
`Open` regardless. Nobody has triaged it.

## A message that matches no configured mailbox

Nothing is created, and nothing is half-created. The endpoint refuses the message with 422 and a
reason that names the address it could not find, the Logic App run fails and shows red in the run
history, and the mail itself is untouched — this connector never marks mail as read, moves it or
replies to it, so the message is still sitting in the shared mailbox exactly as the client left
it. Nothing is lost; it simply has not become an issue yet.

Because the connector sends the mailbox it watches rather than the message's `To:` header, there
are only three ways to see this, and all three are configuration rather than mail:

- the `mailboxAddress` parameter and the address under **Configuration → Routing & intake** have
  drifted apart, usually because one was changed and the other was not;
- the mailbox exists in Axiomate but is switched off;
- the mailbox has no scope, so there is nowhere to file what arrives.

Fix the configuration, then **Resubmit** the failed run from the run history — Consumption run
history is kept for ninety days, so a fortnight of refused mail can be replayed once somebody
notices. Resubmitting is safe: anything that did get through carries its message id and will be
refused as a duplicate rather than raised twice.

## Three things to know before a firm relies on this

### Attachments are not captured

Axiomate does not store files. Evidence items hold a URL, and for anything not already on the web
that URL lives only as long as the browser session that created it. There is nowhere to put an
attachment, so the connector does not fetch one — `includeAttachments` is off, which also keeps
the message small and the bill down.

What happens instead: when a message has attachments, a line is appended to the issue description
saying so and naming the mailbox where they remain. The client's spreadsheet is not lost, it is
in the mailbox, and the consultant is told where to look. This is the one thing on the page most
likely to be misread as a defect, so say it plainly to the firm before they discover it: mail
attachments stay in the mailbox, and anything that needs to live on the issue must be attached to
the issue by a person.

### A reply to an existing issue creates a second issue

Nothing threads. Every message the trigger sees is a new message, and the only thing that stops a
second work item is a message id already on file — which a reply, by definition, does not have.
So a client answering "any update on this?" gets a fresh issue in the queue, filed at the mailbox
default, with none of the history of the one they were replying to. This is the first thing a
firm hits in production, usually within a day of going live.

The client's out-of-office and auto-replies do the same thing, for the same reason.

The fix, when it is worth building, belongs in the application and not here: the trigger already
returns `conversationId`, which Exchange keeps stable across a thread, so the connector can pass
it and the endpoint can look for an existing issue carrying that conversation and add a note
instead of creating a record. Matching on a `Re:` subject line is the cheap version and should be
resisted — subjects get edited, translated and reused, and a wrong match files a client's message
against another client's issue. Until then, tell the firm to expect it and to merge by hand.

### Nothing protects against a mail loop, because nothing can loop yet

Axiomate sends no mail at all. `lib/notifications.ts` records every notification and delivers
only the in-app ones; email and Teams are written as `pending` and stay pending, because there is
no transport. A loop needs the application to send, and it cannot.

If a transport is ever added, and it sends from this same mailbox, then a forwarding or
auto-reply rule can feed the mailbox back into itself, and **the duplicate check will not save
you** — a looped or auto-replied message is a genuinely new message with a new internet message
id, so every lap creates a new work item and every new work item can trigger another
notification. The Logic App has no guard against this; one was deliberately not built, because a
guard against a self-address only catches a single hop and would have implied protection that
does not exist for the two-hop case.

Before outbound mail is switched on, the protection has to be designed: send from a different
address than the one intake watches, and drop messages carrying an auto-submitted header at the
connector. Neither exists today.

## When a client says they emailed and nothing appeared

Work down this list. It is ordered by how often each cause is the answer.

**1. Is the connection authorised?** Open the Office 365 connection. If it is not **Connected**,
that is the answer, and the Logic App's run history will be empty rather than red. Empty history
means the trigger is not running at all — an unauthorised connection, a disabled workflow, or a
mailbox address that does not exist. Red history means it ran and something refused it, which is
section three.

**2. Did the message reach the mailbox?** Look in the shared mailbox itself, and in its Junk
Email and Deleted Items folders. The trigger watches the Inbox only, so a client-specific
transport rule that files mail into a subfolder, or a junk classification, makes the message
invisible to intake while being perfectly visible to anybody who opens the mailbox. Also check
whether someone read and moved it before the poll — the trigger only sees mail that is still
where it landed when it looks.

**3. Did the POST fail?** Open the Logic App run history and the failed run's HTTP action. The
response body says what happened in words, and the status code says which system is at fault:

| Status | Body says | What it means |
| --- | --- | --- |
| 401 | Not authorised | The token in the Logic App and `AXIOMATE_INTAKE_TOKEN` on the application are different. Usually a redeploy of one but not the other, or a token declared in the workflow without a value being assigned. |
| 503 | Intake is closed | `AXIOMATE_INTAKE_TOKEN` is not set on the application at all. The endpoint refuses everything by design rather than run open to the internet. |
| 503 | No database is configured | The application has no `DATABASE_URL`. Nothing that arrives can be stored, and the endpoint says so instead of accepting and losing it. |
| 422 | No mailbox is configured for … | The `mailboxAddress` parameter and Configuration → Routing & intake have drifted apart. Because the connector sends the watched address rather than the mail header, this is the only cause. |
| 422 | … is switched off | The mailbox exists in Axiomate but is disabled. |
| 422 | … has no scope | The mailbox has no scope set, so there is nowhere to file what arrives. |
| 400 | A message needs to, from and messageId | The trigger returned a message with no internet message id. Rare, and worth reporting rather than working around. |
| 200 | `"duplicate": true` | Already received. The issue exists already — search for the message id. Not a failure. |

A failed run is **not** re-delivered. The trigger has already moved past that message and will
never offer it again. Fix the cause, then **Resubmit** the run from the run history; the message
id makes that safe even if it half-worked the first time.

Nothing tells anybody when an intake run fails. There is no alert on this Logic App, so a token
that stopped matching is discovered by a client asking, which can be days. If the firm wants to
know sooner, the pattern is already in the repository: `infra/schedule.bicep` hangs a `RunsFailed`
metric alert and an action group off its own workflow, and the same applies here. Until somebody
decides to, checking the run history after any deployment that touches the token or the host is
the whole of the monitoring.

**4. Is it there and you are looking in the wrong place?** Search Axiomate for the message id from
the run's HTTP request body. It is recorded verbatim on the pinned note of whatever was created.
If it is found, the issue was filed under the mailbox's configured scope, which may not be where
the person asking expected it.

## What it costs

A Consumption Logic App has no fixed cost — there is no plan and nothing to pay for while it
sits idle. What it does have is a polling trigger, and Azure meters every poll as an execution
whether or not it finds mail. Skipped polls are billed exactly like ones that fire. That means
the bill is set by `pollMinutes` and is very nearly independent of how much mail the firm gets.

The arithmetic, per mailbox:

- at three minutes: 20 polls an hour, about **14,600 executions a month**;
- at one minute: about **43,800 executions a month**;
- at fifteen minutes: about **2,900 executions a month**.

The Office 365 connector is a Standard-class managed connector, so each poll is billed at the
Consumption plan's standard connector rate. At the list price current when this was written —
roughly USD 0.000125 per execution — three-minute polling costs on the order of **USD 2 a
month**, and one-minute polling around USD 5.50. Confirm the rate for the deployment's region on
the [Logic Apps pricing page](https://azure.microsoft.com/pricing/details/logic-apps/) rather
than trusting that figure; what does not change is the shape.

Per message, on top of that, there is one built-in HTTP action at the much cheaper actions rate,
plus run-history storage. At any volume a professional services firm will produce, this is noise
next to the polling. If the bill ever needs reducing, lengthen `pollMinutes` — going from three
minutes to fifteen cuts it by four fifths and costs a client at most twelve extra minutes before
their email becomes an issue.
