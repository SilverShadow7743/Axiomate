# In-mail — implementation plan

Executes `docs/plans/2026-08-31-in-mail-design.md` (approved 2026-08-31). Ordering: the pure
mapper and its scenario land before anything touches auth; the auth seam ships alone and is
re-verified live before routes depend on it; UI and deploy last. This phase touches the
sign-in path — the one door the product has — so the plan's job is mostly to keep that door
from locking.

Ground truth verified while writing:

- Scopes live in TWO places (lib/auth/entra.ts:96 authorize, :126 token exchange) and today
  the exchange keeps only the id_token (`{ id_token?: string }` at :141) — no access or
  refresh token is requested or read. Sealed claims are `{oid, name, email, exp}`
  (lib/auth/seal.ts:17).
- **The token cache keys on `claims.oid`** — no claims-shape change at all. Two devices of
  one person share the latest token (harmless for reads); old cookies are fully compatible
  by construction, which deletes the lockout scenario the args feared most.
- Session-actor pattern: `getSession(req)` → `session.actor` → `persistActions(tenant,
  session.actor, …)` (app/api/workspace/route.ts:203–213) — the file route copies it, so
  filing is attributed to the person, never the operator.
- **`recordInboundMail` does NOT dedupe** — the arm appends (workspace.ts ~7015); the intake
  ENDPOINT dedupes via `alreadyReceived` (lib/intake.ts). The file route must therefore
  check `state.inboundMail` for the messageId itself and refuse the second filing politely.
- Mail UI: `components/MailLog.tsx` renders the 'mail' view — the inbox panel mounts there.
- App registration `9d46ddc0-52a6-4f91-8f90-235d2e3f137c`; Graph resource
  `00000003-0000-0000-c000-000000000000`; delegated scope ids Mail.Read
  `570282fd-fa5c-430d-a7fd-fc8dc98a9dca`, offline_access
  `7427e0e9-2fba-42fe-b0c0-848c9e6a8182`. The signed-in az operator can grant admin consent.

Gates per commit: `npx tsc --noEmit` → `npm run validate:scenarios` (191 → **192** with IM1,
0 FAIL) → `npm run audit:a11y` (0) → `npm run build`. No new tables or reducer arms — the
audits stay untouched by construction. Scenario splice via temp file + python, **preserving
the file's existing line endings** (persistence-proof.ts took a CRLF flip last time).

---

## Step 1 — `lib/mailFile.ts` + IM1 (pure, before any auth)

New pure module: `mapGraphMessage(msg, filer: {name, email}, opts: {module, parentId})` →
`{ createDraft, inboundMailFields }`.

- `createDraft.name`: subject with `Re:`/`Fw:`/`FW:`/`RE:` prefixes stripped repeatedly,
  trimmed, capped at 300 chars (validateCreate's own lesson) — empty after cleanup falls
  back to `'(no subject)'`.
- `raisedBy`: sender display name, fallback the address. `type: 'Request'`, `severity:
  'Medium'`, `module`/`discipline` from opts/defaults; `description`: the body as TEXT
  (strip HTML tags + collapse whitespace with a small local stripper — richText helpers
  parse RichDoc, not HTML), capped ~2000 with ellipsis.
- `inboundMailFields`: honest provenance — `mailbox` = the FILER's own address, from,
  cleaned subject, text body, messageId, receivedAt, conversationId.

Scenario **IM1** (splice after FR1, before the section-10 banner): prefix cleanup incl.
stacked `Re: Fw:`; the 300-cap; HTML stripped to text and the 2000-cap; empty subject
fallback; provenance fields carried verbatim; and the mapped draft ACCEPTED by the real
reducer (`create` with the draft succeeds on BASE) — the mapper is pinned against the arm it
feeds, not just its own output.

Verify: `npx tsc --noEmit && npm run validate:scenarios` → 192, 0 FAIL, IM1 PASS.
**Commit 1**: mailFile.ts + IM1 + validation.json.

## Step 2 — ⚠ the auth seam (most regression risk)

**This is the step that can lock every user out, and here is why: entra.ts serves the ONLY
sign-in the product has, in production. A scope typo fails the authorize redirect; a
mishandled token response throws in the callback; either lands on whoever signs in next —
likely the operator — with no second door. The guards: every change is ADDITIVE (scopes
widen, extra fields read from a response that already contains them, a cache write that
nothing yet reads); the token-response type keeps `id_token` optional-checked exactly as
now; NO claims-shape change (the oid keying made that unnecessary); and the deploy of this
commit is followed IMMEDIATELY by a live sign-in before anything else ships.**

- entra.ts: both scope strings become `openid profile email offline_access Mail.Read`
  (consent for them is granted tenant-wide in Step 3 — the consent screen therefore does not
  change for users); the exchange type gains `access_token?, refresh_token?, expires_in?`;
  `completeSignIn` returns them alongside identity.
- Callback: after identity verification, hand `{access, refresh, expiresAt}` to the cache
  under `identity.oid`. Failure to cache must never fail sign-in.
- `lib/db/mailTokens.ts` (server-only): a module-level `Map<oid, {access, refresh,
  expiresAt}>`; `getMailToken(oid)` returns a live access token, refreshing via the token
  endpoint (`grant_type: refresh_token`, same client creds) when within 5 min of expiry;
  null when absent or refresh fails (the caller says "reconnect"). RAM-only — the design's
  posture; single-instance B1 makes it viable and the multi-instance send-back is recorded.

Verify: `npx tsc --noEmit && npm run build`; then (after Step 3's consent) the staged deploy
of THIS commit alone, and a live sign-in round-trip observed healthy before Step 4 begins.
**Commit 2**: entra.ts + callback + mailTokens.ts.

## Step 3 — app-registration consent (Azure-side, no commit)

In the open, as the design requires:

```
az ad app permission add --id 9d46ddc0-52a6-4f91-8f90-235d2e3f137c \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions 570282fd-fa5c-430d-a7fd-fc8dc98a9dca=Scope 7427e0e9-2fba-42fe-b0c0-848c9e6a8182=Scope
az ad app permission admin-consent --id 9d46ddc0-52a6-4f91-8f90-235d2e3f137c
az ad app permission list-grants --id 9d46ddc0-52a6-4f91-8f90-235d2e3f137c   # verify
```

The design's first send-back surfaces exactly here: consent refused → stop, reopen as
application-permission + ApplicationAccessPolicy. Recorded in the vault, not a git commit.

## Step 4 — the two routes

- `GET /api/mail/inbox`: session-gated like the workspace route (`getSession`, verified or
  open-deployment); `getMailToken(session.oid)` → null ⇒ `{reconnect: true}`; else Graph
  `GET /me/messages?$top=25&$select=id,subject,from,bodyPreview,receivedAt,hasAttachments,
  internetMessageId,conversationId&$orderby=receivedDateTime desc`, mapped to a lean list.
  Personal mail is returned to its own person and stored nowhere.
- `POST /api/mail/file` `{messageId, mode: 'create'|'attach', module?, parentId?, issueId?}`:
  token → fetch the FULL message → **dedupe first** (load workspace, refuse politely if any
  `inboundMail` row carries the internetMessageId — the arm will not do it for us) → build
  via `mapGraphMessage` → dispatch through `persistActions(tenant, session.actor, …)`:
  `create` (or nothing for attach) + `recordInboundMail` anchored to the created/chosen
  issue + optional `link`. Returns the issue id.

Verify: `npx tsc --noEmit && npm run build`; route behavior is exercised in Step 6 (it
cannot be driven without a real token).
**Commit 3**: both routes.

## Step 5 — the inbox panel in MailLog

"Your inbox" panel above the intake log: fetch on mount; `reconnect: true` renders a
"Reconnect your inbox" button pointing at the sign-in route (the silent hop — verify whether
`/api/auth/signin` accepts a return path; if not, a plain re-sign-in is v1 and the button
says so); rows show sender/subject/preview/date with **File as work item** (module picker
from the model's facets + client/parent defaulting to the OAPIL project pattern) and
**Attach to issue** (picker reusing `searchWorkspace` over boot state — the search engine's
second consumer); a filed mail shows its issue id inline. a11y: the dialog copies the
listbox/combobox patterns already passing the gate.

Verify: full gate incl. `npm run audit:a11y` (0) and build.
**Commit 4**: MailLog panel + styles.

## Step 6 — staged deploy + live verification

Staged FOREGROUND recipe, then in order:

1. **Sign in fresh** (the Step-2 guard repeated post-full-deploy): the consent screen should
   NOT reappear (admin consent covers it); the session works as before.
2. The Mail view shows "Your inbox" with real messages (Nestor's thread included).
3. File a SELF-SENT test mail (send yourself "In-mail live check") into a test-safe module —
   verify: issue created and attributed to YOU (not the operator), mail-log row present with
   your mailbox as provenance, and the SECOND file attempt of the same mail refused politely
   (the route's own dedupe).
4. Soft-delete the test issue (archive — restore-proof covered); the mail-log row stays as
   honest history.
5. Restart the app (`az webapp restart`) → the panel shows "Reconnect", and one sign-in hop
   refills it — the RAM-cache cost, observed matching its design.

**Commit 5**: live-found fixes only.

---

## Details most likely to be got wrong

1. Old cookies: the cache keys on `oid`, which every existing session already carries — a
   missing cache entry must render as "reconnect", NEVER as an invalid session. No sealed-
   claims change means no cookie migration.
2. Attribution: the file route dispatches as `session.actor` (the workspace route's exact
   pattern), never `currentActor()` — a mail filed by Tarun must say Tarun.
3. `recordInboundMail` does NOT dedupe — the route checks `inboundMail` for the
   internetMessageId before dispatching; without this, every double-click files twice.
4. HTML-to-text is a local stripper — the richText helpers parse RichDoc, not HTML; do not
   feed them Graph HTML.
5. Both scope strings (authorize AND exchange) must change together; the token-response
   `id_token` check stays exactly as-is.
6. Failure to write the token cache must never fail the sign-in — mail is a bonus on top of
   identity, not a dependency of it.
7. The consent step precedes the user-facing deploy, so no user ever sees an incremental
   consent screen.
8. Splices preserve line endings this time.

## Commit boundaries

| Commit | Contents | Gate |
|---|---|---|
| 1 | mailFile.ts + IM1 + validation.json | tsc; scenarios 192/0 FAIL |
| 2 | entra.ts scopes + callback capture + mailTokens.ts | tsc; build; deploy + LIVE SIGN-IN before Step 4 |
| — | app-registration consent (Azure-side, verified, vault-recorded) | list-grants shows both scopes |
| 3 | /api/mail/inbox + /api/mail/file | tsc; build |
| 4 | MailLog inbox panel | full gate incl. a11y |
| 5 | live-found fixes only | full gate + the 5 live checks |

## What would send the design back (with where each surfaces)

- Admin consent cannot be granted (tenant policy) → application-permission +
  ApplicationAccessPolicy redesign. Surfaces at Step 3, deliberately early.
- Token refresh proves flaky across B1 restarts in practice → the encrypted stored-token
  table returns as its own design. Surfaces in use after Step 6.5.
- Scale-out past one instance → the RAM cache needs sticky sessions or the table — a real
  decision, not a workaround. Surfaces if the plan ever upsizes.
