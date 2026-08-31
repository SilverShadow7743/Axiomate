# In-mail — your inbox in the workspace, tokens never at rest

**Status: approved 2026-08-31** (two AskUserQuestion decisions: inbox-in-app + file-to-issue,
over filing-only and over reply-from-issue; the RAM-only token posture below). The Hive Mail
row from the comparison, done the Axiomate way: the mail that today bypasses intake — a
client mailing people directly, as Nestor did at 04:00Z — becomes filable work in one click,
with the same audit trail OAPIL-153 got by hand.

## Auth — the crux, and the posture

- The sign-in flow (lib/auth/entra.ts:96/:126, currently `openid profile email`) adds
  delegated **`Mail.Read`** and **`offline_access`**. The app registration gains the scope
  and admin consent — an az change made in the open, because it widens what the app may ask
  Graph for. Delegated is the boundary: each token reads ONLY its own person's mail,
  structurally — there is nothing to redact because nothing crosses between people.
- **Tokens live in server RAM only** — an in-memory per-session cache (access + refresh),
  never in a cookie, never in Postgres. No new table, no encrypted secrets at rest, nothing
  to rotate or leak from a backup. The stated cost: an app restart empties the cache and the
  Mail panel shows "reconnect your inbox", refilled by one silent `prompt=none` redirect.
  Restart-losable beats refresh-tokens-at-rest for v1.

## The read path

`GET /api/mail/inbox`: unseal the session → cached token (refresh if stale) → Graph
`/me/messages` newest 25 (sender, subject, preview, receivedAt, hasAttachments, messageId).
**Personal mail never enters WorkspaceState, boot, or the database** — a per-request,
per-person passthrough. It also stays OUT of global search by design: the shared index is
shared; a personal inbox is not.

## File-to-issue

Each row offers "File as work item" and "Attach to an existing issue". The server fetches
the full message WITH THE PERSON'S OWN TOKEN, then dispatches through the reducer exactly
what OAPIL-153 received: `create` (subject → name, sender → raisedBy, module picked in the
dialog, body → description trimmed) or a note-attach on the chosen issue, plus
`recordInboundMail` with honest provenance — mailbox = the person's own address, "filed
from the inbox by <name>". Audited, attributed, idempotency-keyed. Attachments defer to the
documents consent (A6).

## UI

The existing Mail view gains a "Your inbox" panel beside the intake log — one mail world,
two honestly-labeled sources. A filed mail shows its issue id inline and files only once
(the mail log's messageId dedupe already refuses replays).

## Pinned

The pure mapping (Graph message JSON → the create draft + recordInboundMail fields,
including subject-prefix cleanup and body-to-text) lands in lib/ and gets scenario IM1. The
auth exchange and the Graph passthrough are integration — verified live, stated honestly as
unpinnable by the suite.

## Non-goals

Sending or replying (a later phase if wanted), other people's mailboxes, personal mail in
global search, Gmail/IMAP, attachment filing (A6 first).

## What would send this back

- The tenant blocks user consent AND admin consent cannot be granted → the capability
  reopens as application-permission + ApplicationAccessPolicy, a different security review.
  Surfaces at the consent step, first thing.
- Token refresh proves flaky across B1 restarts in practice → the encrypted stored-token
  table returns as a real decision with its own design, not a workaround. Surfaces in use.
