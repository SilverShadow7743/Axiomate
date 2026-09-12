# Enterprise application audit — 12 September 2026

*A fresh, whole-application review at Nishant's request ("a fresh reiteration of audit from an
overall webapp or enterprise app perspective"), not a delta on the 10 Sep passes (I26/I28).
Six read-only reviews ran in parallel — identity & session, authorisation & tenancy, secrets /
configuration / transport, data & integrity, operations & deployment, testing & quality — and
every finding placed at Critical or High was re-verified at its cited line, or against the live
Azure resources, before it was written here. Where the reviewers disagreed with the repo's own
comments, the code and the live platform were taken as the truth and the comment is named as
stale.*

**Reference state:** commit `59f7993` on `master`; App Service `axiomate-tms` (P0v3 ×1, staging
slot), Postgres Flexible Server `axiomate-tms-db` (Burstable B1ms, PG 18, 32 GB, 7-day backups).

## The picture in one paragraph

The application is unusually well-reasoned in the places its authors have been burned: the
autosave queue, the serializable write path, the client boundary, row-level security on every
table, refusal-first sign-in, and a comment discipline that made this audit possible in hours.
Its risks are concentrated in **what surrounds the code**: a fallback that makes any unrecognised
sign-in an administrator, a database connection with the server's administrator role, an
infrastructure template that would kill the site on its next apply, a platform with no security
headers, no HTTPS enforcement, no alerting, no rehearsed restore, and a publicly reachable
database — and a test topology that proves the reducer thoroughly and the wiring between layers
not at all, which is why one live data-loss bug (saving a view silently stops persistence for
the session) sat undetected behind a green pipeline.

## Critical

**C1. Saving a view, deleting a view, or taking a snapshot silently stops persistence for the
rest of the session.** `takeSnapshot`, `upsertSavedView`, `deleteSavedView` are dispatched from
`components/IssueWorkspace.tsx` (:1620, :2399, :2391) but absent from the write endpoint's
`KINDS` allow-list (`app/api/workspace/route.ts:29-124`). The browser applies the action
optimistically, enqueues it with everything else (`:638 enqueueAll`), the route rejects the
**whole batch** with 400 (`route.ts:151`, `list.every`), and `lib/queue.ts:129-136` maps a 4xx to
`halt: 'stopped'`. Co-batched legitimate edits are lost with it. This is the same class as the
I1 nine-action incident, recurred. *Fix:* derive `KINDS` from `SHAPES` minus a named
`SERVER_ONLY` set (`notify`, `recordInboundMail`, `markNotificationDelivery`), and add a pure
gate asserting the allow-list covers every client-dispatchable kind.

**C2. Anyone in the Entra tenant who signs in and is not matched in the people directory is an
Administrator.** Sign-in verifies issuer and audience only (`lib/auth/entra.ts:183-186`) — no
app role, no group, no member/guest distinction. `lib/access.ts:307` falls back to
`model.access.defaultRoleIds`, which ships as `[ADMIN_ROLE_ID]` (`:282`), and Administrator is
every permission (`:232`). `.env.example:55` says so in words. The file itself says the fallback
"should become empty on the day a login exists" (`:34`); that day was 31 Aug. A guest invited
for Teams or SharePoint who reaches the sign-in URL receives `rate.view`, `invoice.manage` and
`config.manage`. Compounded by **C2b**: a stored operating model the loader cannot read is
silently replaced by the shipped seed (`lib/db/repo.ts:416`) — which carries that same fallback —
and the next model-writing action persists the seed whole (`lib/db/persist.ts:1049`), losing the
directory, grants, rates and SLAs permanently. *Fix:* require an Entra app role (or group) in the
id token before minting a session; set `defaultRoleIds: []` with a named break-glass admin in
the directory; validate the stored model and refuse to serve rather than substitute; never
write the model back after a fallback load.

**C3. The committed infrastructure template would take the site down on its next apply.**
`infra/app.bicep:345` sets `appCommandLine: 'npm run start'`, justified at `:17-25` by the claim
that `next.config.ts` does not set `output: 'standalone'`. It does (`next.config.ts:25`), the
pipeline ships `.next/standalone`, and that package carries no `next` CLI. Live, both slots run
`node server.js` — set by hand, outside IaC. An `az deployment group create -f infra/app.bicep`
is not a workflow run, so the warm-up gate never sees it; the site dies at the *following*
restart, hours later, with no deploy to blame. `infra/app.bicepparam:66` compounds it: `skuName
= 'B1'` against a live P0v3, so running its documented command downgrades the plan and deletes
the slot the pipeline depends on. *Fix:* `appCommandLine: 'node server.js'`, delete the note,
align or delete the bicepparam, and declare the staging slot and its sticky settings in IaC (they
are not today — the cause of the 12 Sep drive-id swap).

**C4. The application connects to Postgres as the server administrator, so every integrity
control is advisory against itself.** Live `DATABASE_URL` user is `tmsadmin`; the template
builds it from `administratorLogin` (`infra/postgres.bicep:319`). `FORCE ROW LEVEL SECURITY`
binds the owner to policies but does not stop the owner from `DROP POLICY`, `NO FORCE`, `DROP
TABLE`, or rewriting audit rows — and the audit table's policy has no `FOR` clause or `WITH
CHECK` (`20260824000004_row_level_security/migration.sql:19-21`), so `UPDATE`/`DELETE` on
`ScheduleAudit` are permitted to whatever connects. Local development already does this right
(`scripts/db-setup.sql:12`). *Fix:* migrate as an owner role; run the app as a least-privilege
`axiomate_app` (SELECT/INSERT/UPDATE); `REVOKE UPDATE, DELETE ON "ScheduleAudit"`; a `BEFORE
UPDATE OR DELETE` trigger that raises.

## High

**H1. No security headers, and HTTPS is not enforced.** The production origin answers with no
HSTS, no CSP, no X-Frame-Options / frame-ancestors, no Referrer-Policy, no X-Content-Type-Options
(except on the document route), and exposes `X-Powered-By: Next.js`; `next.config.ts` has no
`headers()` and there is no `middleware.ts`. Live, `httpsOnly` is **off** on the web app (TLS 1.2
minimum is set). The app is framable — a tool that approves and sends client mail — and
Google Fonts plus no Referrer-Policy leaks record-id URLs to a third party. *Fix:* `headers()` in
`next.config.ts` (HSTS with preload, CSP with `frame-ancestors 'none'` and a nonce for the theme
script, Referrer-Policy, nosniff, minimal Permissions-Policy); `az webapp update --https-only
true`; `poweredByHeader: false`.

**H2. The database is publicly reachable.** `publicNetworkAccess: Enabled` with an
`AllowAzureServices` rule (0.0.0.0 — any Azure-hosted IP in any tenant) plus four stale
`dev-laptop-*` rules from August and September. With the admin password, that is the whole
estate. *Fix:* VNet integration + private endpoint, or at least replace `AllowAzureServices` with
the App Service outbound IPs and prune the laptop rules; rotate the admin password after.

**H3. Nothing pages anyone.** `infra/observability.bicep:16-21` delegates alert rules to
`docs/observability.md`, where they exist as prose; the only deployed rule is
`schedule.bicep:306 RunsFailed`, whose `alertEmail` defaults to empty. The health route's own
comment (`app/api/health/route.ts:74-77`) relies on an alert that does not exist. No APM, no
structured logging, no correlation id (21 `console.error` calls). *Fix:* an `alerts.bicep`
implementing observability.md's list (health-check status, `"database":"not configured"`, 5xx
rate, pass absence) with a required `alertEmail`; a request-id middleware and one JSON log
helper; turn on the auto-instrumentation the template already supports.

**H4. No disaster-recovery story.** Restore is unrehearsed (`docs/deployment.md:466` is still an
open action), point-in-time restore lands on a *new* server, geo-redundant backup is off and
cannot be enabled after creation, and nothing asserts versioning or retention on the SharePoint
library — while Postgres holds the only `Document.locator` mapping, so the two stores cannot be
restored to one instant. `scripts/restore-proof.ts` is record archive/restore, not DR. *Fix:*
library versioning + retention label; scheduled `pg_dump` to immutable storage; a rehearsed
runbook restoring both to the same point.

**H5. Sign-out does not revoke anything.** The session is a sealed claim with an 8-hour expiry
and no server record (`lib/auth/seal.ts:65`, `lib/auth/cookie.ts:19`); sign-out only overwrites
the browser's cookie. A copied cookie stays valid through sign-out, a role change, an Entra
disablement or a leaver's offboarding. `dropPersonalGraphTokens` has **zero** call sites, so
sign-out also leaves the person's sealed Graph refresh token live in Postgres and RAM. *Fix:*
call `dropPersonalGraphTokens(oid)` from sign-out (one line); add a session id plus a small
revoked / `minIssuedAt` check; document secret rotation as the offboarding kill switch.

**H6. The application is one missing app setting away from open mode.** Every route gates on
`identityEstablished() && !session.verified`, and `identityEstablished()` is just "Entra is
configured" (`lib/principal.ts:89-91`). Lose one of the four Entra settings on a slot and every
route accepts anonymous requests as the named operator with the Administrator fallback, and
`POST /api/schedule/run` accepts unauthenticated triggers (`:66 openDeployment`). Not a current
breach — Entra is set — but a design that fails open. *Fix:* an explicit
`AXIOMATE_REQUIRE_SIGNIN=true` that fails closed when the provider config is incomplete; drop the
`openDeployment` bypass on the schedule endpoint.

**H7. The client boundary is not enforced on the only path to a file, and any consultant can
publish any document to clients.** `GET /api/documents/[id]` (`:70-95`) checks only that a
session is verified — no `clientVisible`, no `internal.view`, no membership — so a
`ROLE_CLIENT_USER` cookie fetches internal deliverables by id while `clientView` withholds them
from the payload. `setDocumentVisibility` (`lib/workspace.ts:5978-5998`) needs only
`document.upload`, which every internal role holds, and `projectScopeOf` (`:904-971`) gates
membership on writes only for the kinds it enumerates — checklist items, `recordDocument`,
milestones, scope items and review requests are not among them. *Fix:* gate the download on
`internal.view` or `clientVisible` + client scope; gate visibility changes on `internal.view` +
membership; extend `projectScopeOf` to issue-resolving kinds.

**H8. Six action kinds have no permission entry and the guard meant to catch that is
neutralised.** `submitTimesheet`, `decideTimesheet`, `decideLeave`, `upsertMeeting`,
`cancelMeeting`, `dismissProposal` are accepted by the route but absent from
`ACTION_PERMISSIONS`; `permissionForAction` returns `null` and the funnel skips `can()`. The
`satisfies Record<Action['t'], …>` assertion (`lib/workspace.ts:2186`) cannot fail because the
value is annotated `Record<string, …>` (`lib/access.ts:491`). Five arms check in-body;
`dismissProposal` checks nothing. *Fix:* remove the `Record<string>` annotation so the assertion
bites; add the six entries; throw on an unknown kind.

**H9. The gates prove the reducer and nothing between the layers.** No test framework, no route
tests, no browser tests; `audit:a11y` runs nowhere automated (`deploy.yml` has no lint step;
pre-commit runs tsc + tenancy only); `audit:rls` and `audit:integrity` never run although CI
already has a Postgres service with migrations applied (`deploy.yml:132`). There is no error
boundary anywhere (`app/error.tsx`, `global-error.tsx` absent): a render crash unmounts the
workspace and the in-memory queue with it. *Fix:* the C1 allow-list gate; `audit:a11y`,
`audit:rls`, `audit:integrity` in the verify job; a handful of route-handler tests posting the
harness's fixtures; `app/error.tsx` + `global-error.tsx` showing the unsaved count (~40 lines).

**H10. The scheduled pass can double-send email.** Report delivery runs after the serializable
transaction commits and stamps in a separate one (`lib/db/schedule.ts:214-221`, `:393-398`); the
Logic App's retry reasoning (`schedule.bicep:214-229`) holds for notifications, not mail. Two
triggers — a retry after a timeout that actually succeeded, or a manual run beside the 07:00 one
— both email. *Fix:* claim the send by advancing `DeliveryStamps` inside the transaction, then
send, with a compensating reset on failure.

**H11. The whole workspace is loaded on every request and shipped to every browser.** 39 uncapped
`findMany` per tenant (`lib/db/repo.ts:176-260`, only audit bounded at 5,000), repeated inside
every write transaction; `docs/runtime-notes.md:275` measures 375 KB → 1.1 MB per interaction,
two-thirds audit, paid twice. `buildTree` is O(n²) on every state change (`lib/tree.ts:42-55`,
while `predecessorsOf` beside it is indexed). Fine at 131 issues; the break is months of audit
rows, not years. *Fix:* drop audit from the boot payload; scope documents and notes to the
viewed subject; index the three child lookups; add the refetch path the code already mentions.

**H12. One Entra client secret is both the sign-in credential and a tenant-wide app-only Graph
credential** (`lib/mail.ts:26-28`, `lib/storage/graph.ts:106-108`), and `docs/entra.md:135`
says the registration has no application permissions — stale. *Fix:* a second registration with
a certificate or workload-identity federation for app-only Graph; correct the doc; alert on
secret expiry.

## Medium

- **M1. Sign-in transient cookies.** Ten-minute lifetime (`signin/route.ts:38`), short for a
  first consent screen with MFA; the callback tests `state` before presence, so expiry is
  reported as "did not start in this browser" and the friendly `expired` branch is unreachable
  (`callback/route.ts:62-67`); `Secure` is derived from `req.url` rather than `publicOrigin`
  (`:37`); a second `/api/auth/signin` overwrites the fixed-name state cookie — the exact 11 Sep
  mechanism. *Fix:* one cookie-attributes helper on `publicOrigin`; presence check first;
  15–30 minutes.
- **M2. Machine and AI doors.** `POST /api/schedule/run` compares its bearer with `===` (`:52`)
  where intake uses `timingSafeEqual`; no rate limiting on any endpoint; `assist` and `chat`
  take `modelId` from the request body, so a user picks the model the firm is billed for;
  `chat` shows no payload cap; the anonymous intake-form door has no size cap, no timing-safe
  match and no throttle. *Fix:* timing-safe compare; per-principal buckets; server-side model
  allow-list; spend alert.
- **M3. CSRF rests on `SameSite=Lax` alone** — correct today, one `SameSite=None` or
  custom-domain change from wrong. *Fix:* assert `Origin === publicOrigin` on mutating routes.
- **M4. Last-writer-wins everywhere except `updateIssue`.** The `expected` mechanism exists but
  has one call site; `setDates`, commitments, SOWs, estimates and every config op overwrite
  blind, and two comments call the check general. *Fix:* extend `expected` to shared-record arms.
- **M5. Personal data has no retention or erasure path.** `InboundMail.body` is kept forever;
  `PersonalGraphToken` has no expiry and no leaver sweep; personal events/actions and leave
  reasons are soft-delete only; queued actions are written verbatim (note bodies, leave reasons)
  to `localStorage` (`lib/pendingActions.ts:94`); `deletePerson` hard-deletes the directory row
  while time entries and owners reference people by name string. *Fix:* a retention pass on the
  daily job; a documented subject-erasure procedure; redact free text before queuing.
- **M6. Migration discipline is a comment, not a gate.** The additive-only rule
  (`deploy.yml:255-259`) has no CI check; `20260827000001_rich_content_json` records having
  broken a release this way and contains a `DROP COLUMN`; the firewall cleanup step swallows
  failure (`deploy.yml:363 || true`). *Fix:* a migration-shape check; fail the job on a non-404
  delete error; a scheduled orphan-rule sweep.
- **M7. Platform basics off.** Always On is off (the app idles and cold-starts; every in-memory
  cache empties on idle) and no health-check path is configured, on a plan that supports both.
  *Fix:* `alwaysOn true`, `healthCheckPath /api/health`.
- **M8. Slot parity is documented, not enforced**, and the post-swap gate is an anonymous health
  call — sign-in is never exercised by the pipeline. *Fix:* a pre-swap slot diff asserting the
  sticky list.
- **M9. Maintainability.** `ConfigWorkspace.tsx` 6,396 lines, `IssueWorkspace.tsx` 3,250 with 44
  `useState` and `state` passed to 21 children, `lib/workspace.ts` 9,890; the harness casts 873
  fixtures `as Action`, so it cannot typecheck its own inputs. Two extractions —
  `useIssueFilters` and `useWorkspaceDialogs` — halve the hook count without touching the
  reducer.

## Low

Refresh-token race (two concurrent misses; the loser's `invalid_grant` deletes the row);
tracking pixels load in the sandboxed email iframe; `npm ci --no-audit` in CI (four highs in the
Prisma CLI chain, dev-only); a literal dev password in `scripts/db-setup.sql:33`; two backfill
scripts bypass `withTenant` and would silently no-op under FORCE RLS; the 401-paused queue
offers no "open sign-in in a new tab" link; `tokenCrypto` binds no additional authenticated
data (a ciphertext copied between rows opens under another oid). Docs drift: G5's scenario
count, `docs/design/ux-checklist.md` referenced by the lint config but absent, `entra.md` on
application permissions, `postgres.bicep:24-47` claiming a pool fix still outstanding.

## What is done well

Row-level security on 45 of 46 tables, `ENABLE` + `FORCE`, each in its own creation migration.
Tenant and actor never taken from the request; `Action` has no actor field by construction.
Per-owner private data withheld for everyone, administrators included; anonymous boot returns
nothing, including counts. The write path reads inside a serializable transaction with bounded
retries covering both the 40001 and the idempotency-key race. `useAutosave` is the strongest
file in the repository — idempotency keys at enqueue, beacon semantics understood, a three-way
halt policy, every correction carrying its incident. Rich text is a closed node schema, not
sanitised HTML; the email iframe is fully sandboxed. Unresolved Key Vault references are refused
rather than used as secrets. Refresh tokens at rest are AES-256-GCM under a purpose-separated
HKDF key; access tokens stay in RAM; nothing anywhere logs a token, secret or cookie. The deploy
pipeline signs in with OIDC, asserts on the health *body* before swapping, refuses to cancel a
run mid-migration, and documents rollback. Audit ids survive restarts. Zero `TODO`s, zero
`@ts-ignore`, strict TypeScript, no unused exports found.

## Fix order

**Now, no decision needed (hours):** C1 allow-list derivation + gate; C3 the bicep line and the
bicepparam; H1 headers and `https-only`; H5 the one-line sign-out drop; H8 the annotation and six
entries; H9 a11y/rls/integrity in CI and the error boundary; M1 cookie helper; M2 timing-safe
compare; M7 Always On and health path.

**This week, one decision each:** C2 — who the administrators are, so the fallback can be
emptied (the directory must carry every real user's email first); H2 — VNet/private endpoint
versus outbound-IP rules; H6 — the explicit sign-in switch; H7 — the document gates; H10 — the
stamp-then-send order; H3 — an alert email address.

**Planned, with a maintenance window:** C4 database roles; H4 the DR runbook and a rehearsal;
H11 the boot payload; H12 a second registration with a certificate; M4, M5, M6.

## Progress

*Kept here as the fixes land, so the report stays the record of both the finding and the fix.*

- **12 Sep, C1 + H8** (`6371d56`): the route allow-list is derived from `SHAPES` minus a named
  server-only set; `ACTION_PERMISSIONS` is `as const satisfies`, the six entries are in, and
  removing one fails tsc naming it (proven). `npm run audit:kinds` checks the three registries
  and every client dispatch, in CI and pre-commit. **Verified live:** a saved view survives a
  reload and its deletion persists, with the persist tag reading "Saved".
- **12 Sep, C3 + H1 + H5 + M1 + M2 + M7** (`5569b55`): `infra/app.bicep` says `node server.js`
  and why; `app.bicepparam` names the live P0v3; security headers in `next.config.ts` (no
  `script-src` yet — needs a nonce middleware, owed); `httpsOnly`, Always On and the health-check
  path set on both slots (HTTP now 301s); sign-out drops the person's Graph token; sign-in
  cookies derive `Secure` from the public origin, live twenty minutes, and the callback checks
  presence before state; the schedule trigger compares its bearer timing-safely.
- **12 Sep, H9** (`b84dfe3`): `audit:a11y` and `audit:rls` run in CI; `app/error.tsx` and
  `app/global-error.tsx` catch a render crash and say how many changes were still unsaved.
  Route-handler tests remain owed. **The first CI run with the RLS gate failed** — the
  proof's bypass query saw the other tenant's row, because the service container's user is a
  Postgres superuser and row-level security never applies to one. The gate now runs as a
  least-privilege `axiomate_app` role created in the workflow (login, no superuser, no
  `BYPASSRLS`, ordinary grants) — C4's posture in miniature, and the reason C4 matters.
- **12 Sep, H6 + H7:** `identityEstablished()` is true when a provider is configured *or half
  configured*, so losing one Entra setting closes every route instead of opening them (the
  sign-in route's 503 names what is missing); only a deployment with no provider at all is the
  trusting single-operator one. Document download applies the boundary the payload applies: a
  client seat gets a file only if it is client-visible and under its own client node, a
  non-exempt internal reader only from a project they are staffed on. `setDocumentVisibility`
  requires `internal.view` in the arm. `projectScopeOf` resolves documents, review requests and
  checklist items to the issue's project, so the funnel's staffing gate covers them. Pinned by
  `AUD1`: an unstaffed consultant is refused and succeeds once staffed; a client seat holding
  `document.upload` is refused with the internal wording.
- **12 Sep, M2 (model choice):** the assistant and chat routes no longer bill the firm for
  whatever model id the request body names. `lib/modelChoice.ts` honours a requested id only if
  some agent in Configuration → Agent registry is configured to use it, or it is the code
  default; anything else lands on the default. The routes load the operating model alone
  (`loadModelOnly`) for the registry. Pinned by `MC1`. Rate limiting itself remains owed.
