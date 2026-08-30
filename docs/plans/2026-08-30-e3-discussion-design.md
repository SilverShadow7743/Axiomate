# E3 — Discussion: work-linked communication, server-queried from day one

**Status: approved 2026-08-30** (six explicit decisions, recorded below).
Phase E3 of the platform evolution (`2026-08-29-work-platform-evolution-design.md`):
"Communication — Chat MVP; mail threading deepened. Communication attaches to a Work Context;
it does not bypass governance." E0–E2 are complete and live.

## Decisions (settled with the user, 2026-08-30)

1. **Scope: work-linked + project threads only.** One discussion thread per work record, one
   per project. 1:1 and group chat are deferred — the firm lives in Teams for commodity chat,
   and Axiomate's differentiator is communication attached to work. Deferring 1:1 also defers
   the private-chat privacy model entirely.
2. **Transport: fetch + light polling.** Messages are fetched when a thread opens, polled
   (~15s) while it stays visible, and a send round-trips through the API. The API shape must
   survive a later push transport (SSE) without changing.
3. **Visibility: internal-only, gated on `internal.view`** — the same gate as internal notes,
   for reading AND posting. Never in `clientView`, no per-message client toggle. A
   client-facing statement belongs in notes or mail, not in a discussion.
4. **Mail deepened = the conversation view.** A record's detail shows its inbound and recorded
   outbound mail as one threaded exchange (grouped by `conversationId`, in order, read-only),
   and the Mail log groups by conversation. Display only — no new mail machinery.
5. **Notifications: per-thread subscribe** (the user's explicit choice over mentions-only).
   Every message on a followed thread notifies each follower except the author. A new `'chat'`
   preference kind rides the existing machinery (record, prefs row, email drain). `@mention`
   still mints the existing `mention` kind regardless of following — being summoned beats
   subscription.
6. **Architecture: a parallel server-owned domain** — the parent design's server-queried rule,
   built. Messages never enter `WorkspaceState`, the reducer, boot, or the browser mirror.
   The rejected alternatives: boot-shipping like commitments (violates the rule written for
   exactly this domain), and Teams-backed storage via Graph (couples the product to one
   tenant's Teams; breaks multi-tenancy).

## The domain, named

**Discussion**, not "chat": `lib/chat.ts` is the ASSISTANT (find/propose, never writes) and
stays untouched; its `ChatMessage` wire type must not be imported by anything here.

- `DiscussionThread` — tenantId, id, scopeKind (`'issue' | 'project'`), scopeId, createdAt,
  createdBy. Created lazily on first message; at most one live thread per scope
  (unique on tenantId + scopeKind + scopeId).
- `DiscussionMessage` — tenantId, id, threadId, author (name), authorId (directory id when
  resolved), body (plain text; mentions parsed with the existing note-mention parser),
  createdAt, deletedAt (soft — a removed message leaves a "removed" stub, like notes).
- `DiscussionFollow` — tenantId, threadId, personId, createdAt. Unique per (thread, person).

All three: tenant RLS policies (the `20260824000004` per-table pattern), row mappers that
stamp tenantId (tenancy audit coverage), proof-cleanup `deleteMany` entries ordered before
their parents.

## API and writes

One route, `/api/discussion` (name avoids `/api/chat`, which is the assistant):

- **GET** `?scopeKind=&scopeId=` → the thread (or null), the latest N messages (paginated by
  `before` cursor), and whether the caller follows it. Gated on `internal.view`; tenant and
  actor resolve from the server session exactly as `/api/workspace` does.
- **POST** with a `kind`:
  - `post` — body text; creates the thread lazily; **auto-follows the author**; on a thread's
    birth for an issue scope, **auto-follows the record's owner** (both can unfollow); mints
    notifications (below). Requires `internal.view`.
  - `follow` / `unfollow` — the caller's own follow only.
  - `remove` — soft-deletes the caller's OWN message only.

Writes go through a small server module (`lib/db/discussion.ts`) with direct Prisma access —
NOT through `persistActions`, which replays the reducer over `WorkspaceState` and cannot carry
rows the state does not hold. Attribution is stamped from the server's actor, never accepted
from the wire — the same posture as the reducer's `by`. **This domain therefore bypasses
`persistSteps` entirely, so the discussion proof (below) is its only net — the E2 lesson
applied in advance.**

Notification minting is the one crossing back into the workspace domain: a `post` mints, for
each follower except the author, a notification under the `'chat'` preference kind (ruleId
`discussion-message`, aboutId = the scope's record id so the inbox click can route), plus the
existing `mention` kind for parsed @mentions. The exact mechanism — a small workspace action
dispatched by the discussion module via `persistActions`, or an extension of the existing
`notify` arm to carry a kind — is the plan's decision; the constraint is that prefs
(mute / in-app / in-app+email) and the email drain apply unchanged, and `NOTIFICATION_KINDS`
gains `'chat'` with its prefs row in the Inbox (the hand-maintained list — E2's detail 8).

## Client

- **DetailPanel gains a Discussion tab**: fetch on open, ~15s poll while the tab is visible,
  optimistic append on send, Follow/Unfollow toggle, "removed" stubs for soft-deleted
  messages. Plain text with @mention highlighting.
- **The project panel gains a Discussion section** (same component, project scope).
- **No unread badges, no read cursors** — following is the awareness mechanism; the inbox
  carries it.
- **Mail conversation view**: the record's detail shows its mail exchange threaded by
  `conversationId` (inbound rows, and outbound replies where recorded), read-only;
  `components/MailLog.tsx` groups by conversation with the flat list as the fallback for rows
  with no conversationId.
- Inbox routing: ruleId `discussion-message` routes to the record (issue scope) or project;
  rides the E2 routing branch.

## Error handling

Refusals in words at the route: no `internal.view` ("Discussions are internal — this sign-in
cannot read them."), removing another's message, following as an unknown person. A poll that
fails leaves the rendered messages standing with a quiet "refresh failed" note — never a blank
thread. A send that fails keeps the draft in the box.

## Testing

- **Pure, scenario-covered**: mention parsing reuse, the follower-set derivation (followers
  minus author; auto-follow rules), mail conversation grouping.
- **The discussion proof** (`scripts/discussion-proof.ts`, joins the audit family): against
  the proof tenant — post creates thread + message with attribution; second post appends;
  follow/unfollow round-trips; remove soft-deletes own and refuses another's; the
  `internal.view` refusal fires; notifications mint to followers-not-author under `'chat'`
  and respect a mute; **cross-tenant RLS isolation** (the other tenant reads nothing); cleanup
  through the proof's own deletes.
- Standing gates unchanged: tsc, 177+ scenarios, build, tenancy/attribution audits (extended
  to the new mappers), clean-room deploy, live Chrome verification on production.

## Non-goals

1:1 and group chat (deferred, with their privacy model), message editing (post + soft-delete
only), rich text, read receipts/unread counts, SSE/websocket push, AI in threads (the
proposal-card contract stands for any future automation).

## What would send this design back

- If the server-queried slice cannot resolve the session actor and tenant outside
  `/api/workspace`'s path without duplicating auth machinery — the "parallel domain" premise
  needs a shared session layer first. Surfaces at the route's first implementation step.
- If notification minting from outside the reducer cannot reach the prefs/drain machinery
  without forking it — the 'chat' kind belongs to a workspace action after all, and the
  boundary between the domains was drawn in the wrong place. Surfaces when the mint is wired.
- If the 15s poll on B1 Basic measurably degrades the app under normal use — the transport
  decision reopens toward fetch-on-open only. Surfaces in live verification.
