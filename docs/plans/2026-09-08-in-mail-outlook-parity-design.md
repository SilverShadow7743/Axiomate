# In-mail, extended — folders, priority, search

**Status: draft, 8 September 2026.** Scoped from the 8 Sep granular Hive Mail walkthrough
and Nishant's explicit direction to go further than filing (`docs/plans/2026-08-31-in-mail-design.md`)
toward fuller Outlook-style breadth. Not built. No new Entra consent needed — see below.

## This is an extension, not a reversal

`docs/plans/2026-08-31-in-mail-design.md`'s own "Non-goals" list, re-read carefully, never
excluded folders, priority, or in-panel search — it named *other people's mailboxes,
Gmail/IMAP, personal mail in global search, and attachment filing* as out of scope, and listed
sending/replying as "a later phase if wanted," which then shipped (`/api/mail/compose`,
`/api/mail/reply` both exist today). Folders/priority/search were simply not in v1's
25-newest-messages cut — never declared off-limits. This proposal is v2 of an already-approved
feature on its already-approved architecture, not a reopening of a settled decision.

## What Graph already gives this, inside the existing scope grant

`lib/auth/entra.ts` already requests `Mail.Read` and `Mail.Send` (delegated, RAM-only token,
per `in-mail`'s posture). Everything below reads under `Mail.Read` — **no new Entra scope, no
new admin consent step**, which is the one thing that would have made this a heavier change:

| Hive feature | Graph mechanism | New scope needed |
|---|---|---|
| Folders (Inbox/Sent/Drafts/etc.) | `GET /me/mailFolders`, then `GET /me/mailFolders/{id}/messages` | No — `Mail.Read` |
| Priority inbox | `inferenceClassification` field on each message (`focused` / `other`) — Outlook's own Focused Inbox, already computed by Microsoft | No — already in `$select` reach |
| Search | `$search` query parameter on `/me/messages` | No — `Mail.Read` |
| Labels | Graph's nearest equivalent is `categories` (an array already on each message, managed in Outlook itself) | No — read-only display |

## Scope for this pass

1. **Folders.** `GET /api/mail/inbox` gains an optional `folderId` query param. A new small
   endpoint (or the same one, `?listFolders=1`) returns `GET /me/mailFolders$select=id,
   displayName,unreadItemCount`. `InboxPanel.tsx` gets a folder picker above the message list,
   defaulting to Inbox exactly as today. Sent and Drafts fall out of this for free — they are
   just folders, not separate code paths.
2. **Priority.** Add `inferenceClassification` to the existing `$select` in `/api/mail/inbox`.
   Two sections in the panel — "Focused" and "Other" — the same split Outlook's own web client
   shows, not a new classifier Axiomate invents. Nobody trains or tunes this; it is Microsoft's
   own field, read and rendered.
3. **Search.** A search box above the message list; the existing route gains `?q=` and passes
   it straight through as Graph's `$search` parameter. No local indexing, no new store — this
   stays true to the never-stored posture, since a search hits Graph live, same as loading the
   inbox does.
4. **Labels → categories, read-only.** Show a message's existing Outlook categories as chips,
   the same colours Outlook itself assigned. **Not** proposing to let someone create or manage
   categories from inside Axiomate — that is mailbox configuration that belongs in Outlook,
   and duplicating it here would be a second place to keep two lists in sync for no reason.

## What stays out, still

The original non-goals are unaffected and still hold: other people's mailboxes, Gmail/IMAP,
personal mail in global search, attachment filing ahead of the documents consent. This pass
adds breadth to reading and finding your own mail; it does not touch any of those boundaries.

## Size

Small-to-medium. One existing route (`/api/mail/inbox`) gains three optional query params and
a `listFolders` mode; one existing component (`InboxPanel.tsx`) gains a folder picker, a
Focused/Other split, and a search box. No schema change, no new auth flow, no new consent —
the RAM-only token posture and the "never enters WorkspaceState" boundary are both unchanged,
since every one of these is still a live, per-request Graph passthrough.

## What would send this back

Graph's `$search` proving slow or rate-limited under real use — the fallback is client-side
filtering of the already-loaded 25, which is a worse search but not a blocker. Focused Inbox
classification disagreeing with what a person actually wants prioritized — Microsoft's
classifier, not Axiomate's to fix; the honest answer is showing both sections rather than
hiding "Other" and trusting a model neither product controls.
