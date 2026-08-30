# E3 implementation plan — the Discussion domain

Follows `2026-08-30-e3-discussion-design.md` (approved). Ordering principle: pure logic first,
then storage, then the server module **with its proof in the same commit** — this domain
bypasses `persistSteps` by design, so the proof is its only persistence net (the E2 lesson,
applied in advance rather than found live). The route, the UI and the deploy come last.

Standing gates per step: `npx tsc --noEmit` → `npm run validate:scenarios` (177 now; 180 after
step 1) → `npm run build`. After the schema/mapper step: `npm run audit:tenancy` (currently
"29 row mappers — all stamp tenantId"; must say **32**), `npm run audit:persistence` (68/68),
`npm run audit:attribution` (3/3). The deploy is **staged foreground commands** (archive → ci →
generate → build → package → migrate status → az deploy) — background chains were killed three
times on 2026-08-30. `data/validation.json` rides scenario commits; timestamp-only diffs are
reverted.

Design constraints quoted, not paraphrased: "messages never enter `WorkspaceState`, the
reducer, boot, or the browser mirror"; "attribution is stamped from the server's actor, never
accepted from the wire"; "`internal.view` … for reading AND posting"; "prefs (mute / in-app /
in-app+email) and the email drain apply unchanged".

**No production grants step exists in this phase** — `'chat'` is a notification kind, not a
permission, and `internal.view` is already held by every delivery role. Stated here so nobody
hunts for the E2-style Configuration → Permissions fix.

---

## Step 1 — the pure module, scenario-proven before any I/O exists

**Files:** `lib/discussion.ts` (new), `scripts/scenario-validation.ts`, `data/validation.json`.

- Types `DiscussionThread`, `DiscussionMessage`, `DiscussionFollow` (plain interfaces — the
  Prisma models come later and the mappers translate). **No import from `lib/chat.ts`** — that
  is the assistant, and its `ChatMessage` type must not appear here.
- `recipientsFor(followers, authorId, authorName, mentions)` — the notification split for one
  post: mention recipients (via `mentionsIn` from `lib/mentions.ts` — verified export) get the
  `mention` kind; followers minus the author minus anyone already mentioned get the `chat`
  kind. **Mention wins: one record per person per message.**
- `autoFollowsAt(thread birth, author, issueOwner?)` — author always; the issue owner (resolved
  by directory id with the standard name fallback) on issue-scope birth only.
- `mailConversations(inbound rows, outbound notes, issueId)` — the record's exchange: inbound
  `InboundMail` grouped by `conversationId` (null conversationId rows listed flat, never
  dropped — intake-form rows have none), interleaved in time with **outbound replies, which
  live as notes** (`outboundNoteBody` — verified: `lib/outbound.ts` records sends as issue
  notes, there is no outbound mail table; the view marks them "sent to client").
- Scenarios: **E3A** (recipient split: mention beats follow, author never notified, follower
  set derives), **E3B** (auto-follow rules at birth and on post), **E3C** (mail grouping:
  order, null-conversation flat list, outbound notes interleaved). Splice via temp files +
  python (Bash heredocs ate escapes twice in E1).

**Verify:** `npm run validate:scenarios` → **180 scenarios, 0 FAIL**; `npx tsc --noEmit`.
**Commit 1** with `data/validation.json`.

## Step 2 — schema, RLS, mappers, cleanup entries (stands alone)

**Files:** `prisma/schema.prisma`, `prisma/migrations/<stamp>_discussion/migration.sql`,
`lib/db/map.ts`, `scripts/persistence-proof.ts` (scrub only), `scripts/rls-proof.ts` (its
cleanup enumerates tables — add the three).

- Models: `DiscussionThread` (`@@id([tenantId, id])`, **`@@unique([tenantId, scopeKind,
  scopeId])`** — the DB, not check-then-insert, enforces one thread per scope),
  `DiscussionMessage` (threadId, author, authorId?, body `@db.Text`, createdAt, deletedAt?),
  `DiscussionFollow` (**`@@unique([tenantId, threadId, personId])`**).
- Migration: CREATE TABLE ×3 plus the `20260824000004` per-table pattern verbatim: `ALTER TABLE
  … ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "DiscussionThread" USING
  (…app.tenant_id…)` for each. No DML.
- `lib/db/map.ts`: `discussionThreadToRow/FromRow`, `discussionMessageToRow/FromRow`,
  `discussionFollowToRow/FromRow`, each stamping `tenantId` — `npm run audit:tenancy`'s mapper
  half counts them.
- Cleanup order in both proofs' scrubs: **DiscussionFollow → DiscussionMessage →
  DiscussionThread**, placed before the `issue`/`hierarchyNode` deletes.

**Verify:** `npx tsc --noEmit`; `npx prisma migrate deploy` (production; retry once if the
classifier blocks — the established pattern) then `npx prisma migrate status` → "up to date";
`npm run audit:tenancy` → **32 row mappers — all stamp tenantId**; `npm run audit:persistence`
→ 68/68 (cleanup entries are inert until rows exist). **Commit 2, standing alone.**

## Step 3 — the server module, the notify-kind extension, and the proof — one commit

**Files:** `lib/db/discussion.ts` (new), `lib/workspace.ts` (notify arm + Action union),
`lib/notifications.ts`, `components/Inbox.tsx` (prefs row), `scripts/discussion-proof.ts`
(new), `package.json` (`"audit:discussion"`).

**3a — the notify arm learns a kind.** The `notify` action gains `kind?: NotificationKind`;
the arm's one prefs lookup (`modeFor(…, 'automation')`, found at the arm's head) becomes
`modeFor(…, a.kind ?? 'automation')`. **The absent-kind default MUST remain `'automation'`** —
every existing automation rule fires through this line (see the risk note below).
`NOTIFICATION_KINDS` gains `'chat'`; `Inbox.tsx`'s hand-maintained `PrefRows` gains
`{ kind: 'chat', label: 'When a discussion I follow gets a message', show: true }` (E2 detail
8: a kind absent from that list mints records nobody can configure). Two things need **no**
change, and the plan says so to stop anyone "fixing" them: `notify` stays absent from the
route's `KINDS` allowlist (server-side `persistActions` never passes that gate — it applies
the reducer directly) and from `actionShape`'s `SHAPES` (excluded **by type**:
`satisfies Record<Exclude<Action['t'], 'notify'>, Shape>` at `lib/actionShape.ts:883` — the
union change compiles against it untouched).

**3b — `lib/db/discussion.ts`.** Four functions, each taking `(tenantId, actor, …)` — the
actor as a parameter is what makes the proof and the live seeding possible:
- `listThread(tenantId, actor, scopeKind, scopeId, before?)` — thread, latest 50 messages
  (cursor on `createdAt+id`), caller's follow state.
- `postMessage(…)` — lazy thread creation (**on `P2002` from the unique scope index, re-read
  the thread and append** — two first-posts race and the loser must not error), auto-follows
  via `autoFollowsAt`, message insert with attribution stamped from the actor, then ONE
  `persistActions(tenantId, actor, notifyBatch)` where `notifyBatch` is built by
  `recipientsFor`: `{ t: 'notify', kind: 'chat', ruleId: 'discussion-message', aboutId:
  scopeId, channel: 'in-app', … }` per follower, kind `'mention'` + ruleId `'mention'` per
  mentioned person. Prefs, mute-audit, the email record and the drain all apply unchanged —
  that is the entire point of routing the mint through the existing arm.
- `setFollow(…, follow: boolean)` — the caller's own row only (upsert / delete).
- `removeOwn(…, messageId)` — soft-delete; refuses another's in words.
- **Permission**: `internal.view` via `can(model, actor, 'internal.view')`. The model comes
  from ONE `operatingModel.findUnique({ where: { tenantId } })` + the stored-model merge
  (`loadModel`) — NOT `loadWorkspace`, which folds every collection and is far too heavy for a
  15s poll. Verify `loadModel`'s exact export while implementing; if the merge helper is not
  exported, export it rather than duplicating the merge.
- **Every query runs under `withTenant(tenantId, tx ⇒ …)`** (`lib/db/client.ts:180`) AND
  writes `tenantId` explicitly in every `where`/`data` — the tenancy audit is a text scan of
  `lib/db/*.ts` and must see the tenant at each call site, per the audit's own header comment.

**3c — `scripts/discussion-proof.ts`** (`npm run audit:discussion`, tsx with
`--conditions=react-server`, proof tenant): post creates thread + message with the actor's
attribution; second post appends, no second thread; the P2002 race path (post twice
concurrently via `Promise.all`, both succeed, one thread); follow/unfollow round-trip; remove
own succeeds, remove another's refuses in words; a roleless proof actor is refused by
`internal.view`; a post mints `'chat'` to the follower-not-author and `'mention'` (not both)
to a mentioned follower; a muted follower gets nothing and the audit line writes;
**cross-tenant isolation** — the second proof tenant reads an empty thread; scrub leaves zero
rows.

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios` (180, 0 FAIL — the notify-arm
change must not move NP1); `npm run audit:discussion` → all checks pass; `npm run
audit:persistence` → 68/68; `npm run build`. **Commit 3.**

## Step 4 — the route

**Files:** `app/api/discussion/route.ts` (new).

GET and POST, resolving tenant and actor exactly as `/api/workspace` does — same three
imports, same order: `getSession(req)` + `identityEstablished()` refusal (401 with
`signInRequired`), `currentTenantId()`, `databaseConfigured()` short-circuit. POST body:
`{ kind: 'post' | 'follow' | 'unfollow' | 'remove', … }`, validated by hand (four kinds, a few
fields — no actionShape entry; this is not a workspace action). Refusals in the design's
words. `/api/discussion`, never `/api/chat` (the assistant's).

**Verify:** `npx tsc --noEmit`; `npm run build`; then against the local dev server or
production after step 6's deploy: an unauthenticated `curl -s -X POST` → 401 with
`signInRequired: true`. **Commit 4.**

## Step 5 — the UI

**Files:** `components/DiscussionTab.tsx` (new), `components/DetailPanel.tsx`,
`components/MailLog.tsx`, `components/IssueWorkspace.tsx`.

- `DiscussionTab` (one component, both scopes): fetch on mount, 15s poll **only while
  mounted/visible**, merge by message id — **the poll must never reset the compose box or
  scroll position**; optimistic append on send with the draft kept on failure; Follow toggle;
  "removed" stubs; @mention highlighting via `mentionSegments`. A failed poll leaves messages
  standing with a quiet "refresh failed" note.
- `DetailPanel.tsx`: `'Discussion'` joins BOTH tab lists — the issue set at line ~329 and the
  node/project set at ~331 (`['Capacity', 'Members', 'History']` — verified, both live in this
  one component) — rendered for issue scopes and for `kind === 'project'` nodes only.
- Mail conversation view: on the issue detail (inside Notes or as part of the Discussion tab's
  header area — implementer's choice, named in the commit), rendered from `mailConversations`;
  `MailLog.tsx` groups by conversation with the flat list preserved for null-conversation rows.
- Inbox routing, BOTH `onOpen` sites (the E2 branch): ruleId `'discussion-message'` → if
  `aboutId` is in `state.issues`, `revealIssue(aboutId)` + request the Discussion tab; else (a
  project node id) select that node — **never bare `revealIssue` for a node id, whose miss
  toast says "no longer in the workspace"**.

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios` (unchanged); `npm run build`.
**Commit 5.**

## Step 6 — staged deploy, live loop, cleanup

The staged foreground recipe (E2's): fresh scratch dir under `$CLAUDE_JOB_DIR/tmp` → archive →
`.env` → `npm ci` → `prisma generate` → `build` → `package-release.py` → `migrate status` ("up
to date" — step 2 already applied it) → `az webapp deploy` → "RuntimeSuccessful".

Live, in Chrome on production:
1. Open a real record → Discussion tab → post → message renders with attribution; Follow
   toggle reflects the auto-follow.
2. Seed a second poster via a tmp tsx script calling `lib/db/discussion.ts` directly with a
   test actor (the actor parameter — same pattern as E2's proof-priya): their post arrives on
   the next poll WITHOUT reopening the tab (watch the 15s tick); Nishant's bell gains the
   `'chat'` notification; clicking routes to the record's Discussion tab.
3. Mention flow: seeded post with `@Nishant Sekhar` → one `mention` record, no `chat`
   double.
4. Project scope: post on a project's Discussion tab; the notification's project routing
   lands on the node, not a toast.
5. Mail view: open an OAPIL record with a real threaded conversation → grouped exchange in
   order; Mail log grouped.
6. Prefs row visible; flip to mute → seeded post mints nothing (DB check); flip back.
7. **Cleanup (production)**: remove test messages via the module's own `removeOwn` under each
   author's actor; unfollow; the test thread row may stay (empty threads are inert) or be
   removed via a tmp script named in the report; delete any test directory person via
   `deletePerson`.

**Verify:** each numbered item observed (screenshots + DB spot-checks via tmp read scripts);
`az webapp log deployment show` on doubt. Full gate re-run before the deploy commit if
anything changed.

---

## The step carrying the most regression risk

**Step 3a, the notify-arm kind.** Every automation rule the platform has — watch rules, the
scheduled pass's escalations, intake notifications — fires through `case 'notify'`'s single
`modeFor(…, 'automation')` lookup. If the default for an absent kind becomes anything but
`'automation'`, every existing rule's mute/email preference silently re-routes to a kind
nobody has configured — which `modeFor`'s absent-anything→`'in-app'` default would mask as
"notifications still arrive", the worst kind of wrong. The breakage lands on every person who
has tuned an automation preference, and scenario NP1 is the tripwire: it must pass untouched.

## Details most likely to be got wrong

1. The DB enforces one-thread-per-scope; `postMessage` handles `P2002` by re-reading and
   appending — check-then-insert races.
2. `internal.view` needs the merged operating model server-side: one `operatingModel` read +
   the stored-seed merge, never `loadWorkspace` on a poll path.
3. The poll merges by id and never resets the compose box or scroll.
4. `aboutId` may be a project node id — the inbox routing branches on where the id resolves
   (`state.issues` vs `state.nodes`); `revealIssue` on a node id toasts wrongly.
5. Auto-follow of the issue owner resolves `ownerId` by directory id with the trimmed-name
   fallback, at thread birth only.
6. Mention wins over follow: one record per person per message — `recipientsFor` owns this and
   E3A pins it.
7. `lib/discussion.ts` and `lib/db/discussion.ts` import nothing from `lib/chat.ts`.
8. MailLog keeps the flat list for null `conversationId` rows (the intake form writes none).
9. Every `lib/db/discussion.ts` query runs under `withTenant` AND writes `tenantId` at the
   call site — the tenancy audit is a text scan and must see it.
10. Proof scrub order: Follow → Message → Thread, before issues/nodes, in BOTH proofs.
11. Outbound mail lives as issue notes (`outboundNoteBody`), not in a mail table — the
    conversation view reads notes, and must not wait for an outbound table that doesn't exist.
12. `notify` stays out of the route `KINDS` and out of `SHAPES` — both exclusions are
    deliberate and typed; the union change compiles without touching them.
13. The scenario splice uses temp files + python.

## Commit boundaries

1. Pure `lib/discussion.ts` + E3A–E3C + `data/validation.json`.
2. Schema + migration + RLS + mappers + scrub entries — stands alone (carries the migration).
3. Server module + notify-kind + `'chat'` kind/prefs row + discussion proof — one commit; the
   proof lands WITH the write path it nets.
4. The route.
5. The UI (tab, mail view, routing, MailLog).
6. Deploy is not a commit; the report names the deployed sha.

## What would send the design back

- Session/tenant resolution outside `/api/workspace` cannot reuse `getSession` /
  `currentTenantId` / `identityEstablished` as-is — the parallel-domain premise needs a shared
  auth layer first. Surfaces at step 4's first lines. (Reading them today suggests plain
  reuse works; the clause stays because the design named it.)
- The mint cannot reach prefs/drain through the notify arm without forking it — the `'chat'`
  kind belongs to a workspace action and the domain boundary was drawn wrong. Surfaces in
  step 3's proof, at the muted-follower check.
- The 15s poll measurably degrades the B1 App Service under normal use — the transport
  decision reopens toward fetch-on-open. Surfaces in step 6, live.
- A fourth from planning: if `loadModel`'s merge cannot be reached without `loadWorkspace`
  (not exported, tangled), and exporting it means restructuring `repo.ts`, stop — the "light
  model read" the permission check depends on is a design assumption, not an implementation
  detail. Surfaces at step 3b.
