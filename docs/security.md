# Security review — Axiomate moving to the Axiocloud Solutions Azure tenant

Reviewed 16 August 2026, against the tree at `5cb6ddd`. Read in full: `lib/auth/entra.ts`,
`lib/auth/cookie.ts`, `lib/auth/seal.ts`, `lib/principal.ts`, `lib/identity.ts`, `lib/actor.ts`,
`lib/access.ts`, `lib/tenant.ts`, `lib/db/boot.ts`, `lib/db/client.ts`, `lib/db/persist.ts`, the
three auth routes, and the four API routes named in the brief. The permission funnel in
`lib/workspace.ts` and the tenancy audit in `scripts/tenant-audit.mjs` were checked because
findings depend on them. `next start`'s construction of the request URL was traced through
`node_modules/next/dist/server/next-server.js` and `route-modules/route-module.js`, because one
question turns on it.

This codebase documents its own limits unusually carefully, and most of what it says about itself
is true. Where a comment is quoted below it is because the comment is either the best statement of
the risk or the clearest evidence that the code has moved and the comment has not.

Nothing was changed. Every finding names a file and a line and proposes a fix without applying it.

---

## Ranked findings

Ranked by what somebody who reaches the URL could actually take from this firm, not by category.

### 1. The workspace renders in full to anybody who loads the page, in every configuration

**This is the finding the rest of the review is subordinate to.**

`app/page.tsx:7` calls `boot()` and passes the result straight into the workspace component.
`lib/db/boot.ts:63` resolves the session, `:86` loads the entire workspace from Postgres, and
`:92–105` returns it. There is no branch anywhere in that function that withholds `state` from an
unverified caller. What the session actually decides is one boolean, `signInRequired`
(`lib/db/boot.ts:97`), and the only thing that boolean does is render a **Sign in** button in the
header at `components/IssueWorkspace.tsx:1364`. `verified` is used once more, at
`components/IssueWorkspace.tsx:1749`, to pass `signedIn` into the configuration panel. There is no
gate, no overlay and no redirect. `app/layout.tsx` adds nothing.

So an unauthenticated GET of `/` returns, in the serialised RSC payload: every client
organisation, every engagement, every issue with its full description and status history, every
note including those typed as Client Communication, every time entry with the person and the
hours, every estimate, every approval and every statement of work with its agreed effort and
value. That is the whole product. It is the commercially sensitive half of the firm's delivery
record and its clients' operational problems, served to an anonymous browser.

This holds **with Entra fully configured**. The Entra work gated the write path
(`app/api/workspace/route.ts:126`) and left the read path exactly where it was. The
`signInRequired` flag makes the deployment look gated: the header says *Sign in*, which reads as
an invitation to authenticate rather than as a notice that authentication has already been
bypassed.

An attacker needs no token, no credential, no session and no knowledge of the application. They
need the hostname. On an App Service with a public default hostname, that is discoverable.

**Fix.** In `lib/db/boot.ts`, return `state: null` and a seedless `seed` when
`identityEstablished() && !session.verified`, and have `app/page.tsx` render a sign-in page rather
than the workspace in that case. Gating in the component is not sufficient — the data is in the
payload before the component runs. The equivalent check already exists one layer over at
`app/api/workspace/route.ts:126–131`; this is that check, applied to the read.

### 2. Intake runs with Administrator, and the documented day-one remediation breaks it outright

`app/api/intake/route.ts:44` declares its own actor:

```ts
const INTAKE_ACTOR = { id: 'intake', name: 'Intake' }
```

`lib/actor.ts:45` exports a different constant of the same name:

```ts
export const INTAKE_ACTOR: Actor = { id: 'machine:intake', name: 'Intake' }
```

The route does not import it. `isMachineActor` (`lib/actor.ts:49`) prefix-matches on `machine:`,
so the route's shadowing constant is not recognised as a machine. `rolesFor`
(`lib/access.ts:183`) therefore skips the machine branch, finds no directory person with id
`intake` or display name `Intake`, and falls through to `model.access.defaultRoleIds` at
`lib/access.ts:194` — which ships as `[ADMIN_ROLE_ID]` (`lib/access.ts:162`), granting `ALL`
(`lib/access.ts:142`).

The mechanism this defeats is described three times in the codebase's own words, most directly at
`lib/access.ts:117–118`: "a machine that inherits Administrator because nobody assigned it
anything is how an automated path ends up able to change the operating model." That is precisely
what the shadowed constant causes. The narrowing to `MACHINE_ROLE_ID` — six permissions, no close,
no schedule, no configuration — is not in force for intake. `SCHEDULE_ACTOR` is imported correctly
at `app/api/schedule/run/route.ts:8`, so the scheduled pass is fine; intake alone is wrong.

Today the route only ever emits `create`, `addNote` and `setAssignment`, so the surplus grant is
not exercised by the route's own code. That is the reason this is second and not first. It still
matters, for two reasons.

First, it is a control that reads as enforced in review and is not, which is the failure mode this
codebase says elsewhere it is trying to avoid. Any future action added to the intake path inherits
Administrator silently.

Second, and worse: **the two documented remediations conflict.** `lib/access.ts:33` instructs that
on the day a login exists `defaultRoleIds` "should become empty". Empty it, and intake resolves to
zero roles, `can()` refuses `work.create`, and every inbound message is rejected with "Raise work
needs a role, and none has been assigned to Intake." The firm's first correct security action
silently breaks its mail intake, and the error text points at a role assignment rather than at a
shadowed constant. An operator following the documentation will spend a long time on that.

**Fix.** Delete `app/api/intake/route.ts:44` and import `INTAKE_ACTOR` from `@/lib/actor`, exactly
as the schedule route imports `SCHEDULE_ACTOR`. Do this **before** emptying `defaultRoleIds`, not
after. Consider making the shadowing impossible: `persistActions` could reject an actor whose id is
neither a directory key nor `machine:`-prefixed.

### 3. A signed-in Entra user almost always lands on the Administrator fallback

The brief asks what happens to somebody who signs in and is not in the directory. The trace is
worse than that question implies, because in practice almost nobody is in the directory in a way
`rolesFor` can see.

`lib/principal.ts:65` builds the actor from a verified token as `{ id: oid, name: name || email || oid }`.
The `Actor` type (`lib/actor.ts:16`) carries an id and a name and nothing else; the session's
`email` is held on `Session` (`lib/principal.ts:37`) and never reaches the permission check.

`rolesFor` (`lib/access.ts:189–192`) then tries three joins in order:

```ts
people.find((p) => p.id === actor.id) ??
people.find((p) => p.email && p.email.toLowerCase() === actor.id.toLowerCase()) ??
people.find((p) => p.name.toLowerCase() === actor.name.toLowerCase())
```

The second join compares a directory person's **email address** against `actor.id`, which for an
Entra principal is an **object id GUID**. It can never match. The comment above it describes the
order as "an object id is stable, an address is unique but changeable" — the intent is right and
the wiring is not: the middle rung is dead in the only mode it was written for.

The first join needs `Person.id` to be the Entra object id. The directory is built from names
discovered in the imported issue log (`Person.fromSource`, `lib/config.ts:195`), so those ids are
not GUIDs. That leaves the third join: **exact, case-insensitive display-name match** between the
Entra `name` claim and a directory person's name.

So the day-one behaviour is: everyone whose Entra display name does not match a directory row
character for character gets `defaultRoleIds`, which is `[ROLE_ADMIN]`, which is every permission
in the system — including `config.manage`, which is the grant that lets them rewrite the
permission model itself. If the firm's Entra tenant contains guests, contractors, or anyone
outside delivery, each of them becomes an Axiomate administrator on first sign-in. And anyone
whose display name *does* match a directory row inherits that row's roles, which makes role
assignment turn on a string a directory administrator can edit.

**What a firm must do on day one**, in this order: (a) fix finding 2; (b) populate
`Person.email` for real people and repair the email join; (c) assign real roles; (d) set
`access.defaultRoleIds` to `[]`.

**How they would know they had not**: they would not, and that is the sharpest part of this
finding. There is no warning, no banner, no log line, and no validation error — `accessProblems`
(`lib/access.ts:306`) checks that the fallback role *exists* and that somebody can configure the
platform, and never asks whether the fallback is Administrator. Worse, `.env.example:28–29` tells
the operator the opposite in plain words: "Set all four and sign-in is enforced: unverified
requests to the write endpoint are refused, **and each person's roles come from the directory
rather than from the fallback role**." The second clause is false. It is the assurance that would
stop an operator from ever looking at `defaultRoleIds`.

**Fix.** Pass the session email into role resolution — either widen `Actor` with an optional
`email`, or give `rolesFor` a third parameter — so `lib/access.ts:191` compares like with like. Add
a check to `accessProblems` that flags a fallback role holding `config.manage` when a provider is
configured. And correct `.env.example:28–29`.

### 4. `/api/chat` has no authentication of any kind

`app/api/chat/route.ts:139` is the only route in the application with no identity check, no token,
no `identityEstablished()` branch and no rate limit. It parses a body and, if `ANTHROPIC_API_KEY`
is set, calls the Anthropic API with attacker-supplied message content in a loop of up to six
turns at 4000 output tokens each (`:48`, `:46`).

An attacker who reaches the URL gets a free, uncapped LLM proxy billed to the firm's account.
That is a direct financial loss with no ceiling and no alerting. They can also drive the model with
arbitrary conversation content, which makes the firm's API key the origin of whatever is generated.

Two things limit it, and both should be stated. The route reads no stored data — the issue
catalogue is posted by the caller (`:79`) — so this is not an additional path to client data
beyond finding 1. And the route writes nothing (`:15–17`), so it cannot mutate the workspace.
Autonomy is enforced by tool absence rather than by instruction (`:207`), which is the right
construction and is worth saying so.

**Fix.** Apply the same guard the write endpoint uses — `getSession(req)` plus
`identityEstablished() && !session.verified` → 401 — at the top of `POST`. Add a per-session
request cap.

### 5. Provider and database error text is returned to the browser, and one path puts it in a URL

Two related leaks, both of internal detail rather than of client data.

`lib/auth/entra.ts:138` builds a message from Entra's own `error_description`, and
`app/api/auth/callback/route.ts:26–30` places that string into a query parameter:
`?auth_error=<message>`. The comment at `entra.ts:136–137` argues the operator needs
"AADSTS50011: redirect URI mismatch" rather than "sign-in failed", and that reasoning is correct.
The defect is the transport, not the content. AADSTS strings routinely carry the tenant id, the
client id and sometimes a UPN, and **App Service logs the full request URI including the query
string** into a store with different retention and different access control from the application.
Query parameters also reach browser history and any `Referer` sent to the Google Fonts origins
that `app/layout.tsx:14–19` loads.

`lib/db/client.ts:69` falls through to `msg.split('\n')[0]` for any unrecognised database error.
That value is returned to an anonymous caller by `app/api/workspace/route.ts:136` and rendered on
the page by `lib/db/boot.ts:119`. Prisma's unmatched messages include invocation detail and, for
some adapter failures, the host and port from `DATABASE_URL`. The three recognised branches above
it (`:60–68`) are well judged and deliberately generic; only the fallthrough is the problem.

**Fix.** In the callback, redirect with a short opaque code and log the provider's message
server-side; or keep the text but move it into a short-lived `HttpOnly` cookie the page reads once.
In `describeDbError`, return a fixed sentence for the unmatched case and log the detail.

### 6. A session cannot be revoked, for up to a working day

`lib/auth/seal.ts:65` checks `exp` and nothing else. `lib/auth/cookie.ts:16` sets it to eight
hours. There is no session store, no `jti`, no revocation list and no re-check against the
directory after the callback.

The reason this is worth naming is the code's own argument for choosing Entra, at
`lib/auth/entra.ts:12–14`: the directory "already knows who has left, which is the fact a delivery
tool most needs and is worst at being told." Today Axiomate asks the directory that question
exactly once, at sign-in, and then stops listening for eight hours. Somebody disabled, offboarded
or compromised at 09:05 keeps full access until 17:00. The only revocation available is rotating
`AXIOMATE_SESSION_SECRET`, which signs out every user at once.

For a firm of this size, on a day-long window, this is a follow-up rather than a blocker — but it
is the gap between what the sign-in integration claims to buy and what it currently buys.

**Fix.** Either shorten the cookie and refresh it against the provider, or hold a server-side
session row keyed by a `jti` so a single session can be revoked. The second is the honest one and
it costs a table.

---

## The questions, answered

### 1. The authorisation-code flow

**This is the strongest part of the codebase and it is close to correct.**

*PKCE* — done properly. `lib/auth/entra.ts:86` mints a 64-byte verifier, base64url-encoded to 86
characters, comfortably inside RFC 7636's 43–128. `pkceChallenge` (`:194`) is a genuine SHA-256
over the verifier, and `code_challenge_method` is set to `S256` (`:100`), not `plain`. The verifier
is sent on the exchange at `:125`. No shortcut has been taken.

*State* — generated at `:84`, sent at `:97`, stored in an `HttpOnly` cookie at
`app/api/auth/signin/route.ts:43`, and compared at `app/api/auth/callback/route.ts:45` before
anything else happens. A missing cookie fails closed at `:50`. The comparison is a plain `!==`,
which is fine: `state` is a CSRF binder, not a MAC.

*Nonce* — generated at `:85`, sent at `:98`, and — importantly — checked **after** signature
verification, at `lib/auth/entra.ts:150`, against the value from the browser's cookie. The
ordering is right: verify, then compare a claim.

*Issuer and audience* — `jwtVerify` at `:145–148` passes both. Issuer is
`https://login.microsoftonline.com/{tenantId}/v2.0` (`:56`), audience is the client id. Keys come
from the tenant's own JWKS endpoint (`:165`), cached per tenant. This has a useful property worth
stating: if somebody misconfigures `AXIOMATE_ENTRA_TENANT_ID` as `common` or `organizations`,
Entra issues tokens whose `iss` is the real tenant GUID, the issuer check fails, and sign-in
breaks. It fails closed rather than admitting every Microsoft account on earth. That is the right
direction to fail in.

*Also right*: only `openid profile email` is requested (`:96`); the access token is discarded and
only the id token is used; the one-shot cookies are cleared on success
(`app/api/auth/callback/route.ts:67–69`); the exchange happens server to server with the client
secret; and the endpoint refuses to start rather than issue an unsignable session when
`AXIOMATE_SESSION_SECRET` is absent (`app/api/auth/signin/route.ts:29`).

*What is missing, and it is minor at this scale*: `tid` is not checked as a claim (the issuer check
covers it for a single-tenant registration); there is no `max_age` or `auth_time`; and the
one-shot cookies live 600 seconds (`app/api/auth/signin/route.ts:38`) where 300 would do. None of
these change the verdict.

The flow's real weakness is not in the flow. It is that a correctly verified session gates only the
write path (finding 1) and resolves to Administrator once it gets there (finding 3).

### 2. The session cookie

*Signed rather than encrypted* — correct, and the reasoning at `lib/auth/seal.ts:12–15` is right:
the payload is an object id, a name, an address and an expiry, all facts the bearer already knows.
Encrypting them would hide them from the only party entitled to read them and do nothing about
forgery, which is the actual risk. The HMAC is SHA-256, and `open()` compares with
`timingSafeEqual` after an explicit length check (`:54–57`) — the length check is there because
`timingSafeEqual` throws rather than returning false on a length mismatch, which is a detail
people get wrong. Expiry is checked server-side (`:65`) rather than trusted to the browser.
`MIN_SECRET_LENGTH` is enforced on both sign and open, and there is no default key.

*`HttpOnly`* — set everywhere it matters (`lib/auth/cookie.ts:44`, and on all three one-shot
cookies). Correct: nothing in the client needs to read the session.

*`SameSite=Lax`* — the right choice, and affirmatively so. Every mutation in this application is a
POST, and `Lax` withholds the cookie on a cross-site POST, so it is doing CSRF duty without a
token. What `Lax` permits that `Strict` would not is the cookie on a **top-level GET navigation**
from another site — which is exactly what you want when a consultant follows an Axiomate issue link
out of Teams, Outlook or a client email and expects to arrive signed in. `Strict` would land them
on a signed-out page and send them round the sign-in loop for every inbound link, which is the kind
of friction that gets a tool abandoned. Note the interaction with finding 1: that convenience is
moot today, because the page renders regardless. It becomes load-bearing the moment the read is
gated.

*`Secure`, and whether it survives App Service* — **the derivation is correct, and I traced it
rather than assuming.** `app/api/auth/callback/route.ts:54` and `app/api/auth/signin/route.ts:37`
both compute `secure` from `new URL(req.url).protocol === 'https:'`. In Next 16 the absolute URL
handed to a route handler is built from `x-forwarded-proto`:
`node_modules/next/dist/server/next-server.js:1278` derives the protocol from that header, and
`route-modules/route-module.js:381` does the same on the path that constructs `initURL` when it is
absent. Azure App Service sets `X-Forwarded-Proto: https` on TLS-terminated requests. So behind App
Service, `secure` resolves to true. This is not the silent production failure the shape of the code
suggests.

The residual is narrower but real, and it has two parts. First, App Service serves plain HTTP as
well as HTTPS unless **HTTPS Only** is switched on. A request that arrives over HTTP yields
`x-forwarded-proto: http`, `secure` is false, and the session cookie is issued over cleartext
without the `Secure` attribute — after which the browser will send it on every subsequent HTTP
request to that host. Second, the derivation is correct **for this hosting shape**: it holds
because App Service terminates TLS and sets the header. Put the same build behind an ingress that
does not set it, in front of a custom server, or in any topology where the header is absent, and
`secure` silently becomes false in production with nothing logged. The correctness of `Secure`
therefore rests on an Azure toggle and a hosting assumption, neither of which the code sets,
asserts or mentions. Two hardening items follow: make it
`const secure = url.protocol === 'https:' || process.env.NODE_ENV === 'production'`, and turn on
**HTTPS Only** with HSTS on the App Service. Consider the `__Host-` prefix on the session cookie
once `Secure` is unconditional in production.

*One inconsistency, cosmetic*: `app/api/auth/signout/route.ts:18` clears the cookie without
`Secure`. Deletion still works — browsers key cookies on name, domain and path — so this is worth
a line in a tidy-up, not a finding.

### 3. The fallback role

Traced in full as finding 3 above. In summary: `access.defaultRoleIds` ships as
`[ADMIN_ROLE_ID]` (`lib/access.ts:162`); `rolesFor` reaches it for any actor the directory cannot
match (`lib/access.ts:194`); the email join that was meant to do the matching compares an address
against a GUID and can never fire (`lib/access.ts:191` against `lib/principal.ts:65`); so once
Entra is configured, anybody who signs in and whose display name does not exactly match a directory
row receives every permission in the system, including `config.manage`.

Day one, in order: fix the intake actor, populate `Person.email` and repair the join, assign real
roles, then empty `defaultRoleIds`.

They would know they had not done it only by reading `lib/access.ts:162` themselves. Nothing warns
them, `accessProblems` does not check for it, and `.env.example:28–29` actively tells them the
problem does not exist.

### 4. The three endpoints that are authenticated by something other than a session

**Intake** (`app/api/intake/route.ts`). Closed by default: no `AXIOMATE_INTAKE_TOKEN`, 503, no
processing (`:47–56`). The posture is stated well, both in the module comment at `:29–34` and in
the 503 body itself, which tells the operator exactly what to set. With a token configured, an
attacker who reaches the URL without it gets 401 and nothing else. With the token — a shared
secret that will live in whatever forwards the firm's mail — they can create issues under any
routed scope, attach a pinned Client Communication note with arbitrary text, and set assignments.
They cannot close, schedule, estimate or configure, because the route emits only those three
action kinds. The status is pinned to `Open` at `:138` regardless of what the rules inferred, with
a good reason given. What they *should* also be unable to do — but structurally can, if a fourth
action is ever added — is anything at all, per finding 2. Two smaller notes: the token is compared
with `!==` at `:59` rather than in constant time, and it is read at module load (`:41`) so rotation
needs a restart. Neither is exploitable at this scale over a network; both are one-line fixes. The
duplicate check at `:112` scans every note body in the workspace on every message, which is a
performance cliff rather than a security one, but a caller with the token can drive it.

**Schedule** (`app/api/schedule/run/route.ts`). Three ways in, and the third is the one to look at.
Token (`:48`), or a verified session holding `config.manage` checked against the loaded model
(`:86–90`) — that second check is done properly, against real state rather than a stand-in, and the
comment at `:80–84` explains why the extra read is worth it. The third is `openDeployment` at
`:62`: when no identity provider is configured, the check is skipped entirely. So on a
provider-less deployment with a database, **anybody who can POST to `/api/schedule/run` can run
the pass**: it mutates the workspace, raises notifications and sends people messages. The comment
at `:52–60` states this plainly and argues it correctly — a deployment with no provider has one
operator and no way for them to prove it, so requiring a verified session would lock the only
person who exists out of their own product. The stated version matches the code. It is a
deliberate limitation, and it stops being one the moment Entra is configured, which is the
configuration this firm is moving to. The residual exposure is a denial-of-service and a
notification-flood vector rather than a data one, and it disappears on the Azure deployment.

**Workspace** (`app/api/workspace/route.ts`). Refuses unverified requests only when a provider is
configured (`:126–131`), for the same reason and with the same honesty. The route is otherwise the
best-defended thing here: the action kind is checked against a closed allow-list (`:25–67`) with
`notify` deliberately excluded and the exclusion explained; the batch is bounded (`:22`); the
tenant and the actor come from server configuration and never from the body (`:107–116`); and
`Action` has no actor field to forge, which `scripts/attribution-proof.ts` exists to keep true. On
a provider-less deployment anybody who reaches it can perform any mutation as the configured
operator, which is stated. On the Azure deployment that is closed.

**Is the posture stated where somebody would see it?** Partly. `.env.example` is genuinely good on
intake and schedule — it says what leaving each unset costs. But the one posture a reader most
needs is the one nothing states: that the read path is open. `README.md`'s *Known limitations* says
"There is no authentication", which was true and is now both stale and misleading, because a reader
who knows the Entra work shipped will read that line as out of date and conclude the opposite of
the truth.

### 5. Tenant isolation

**The claim is still true.** `lib/tenant.ts:26–28` states that "isolation is a discipline the code
follows, not a guarantee the database enforces; the guarantee is row-level security, and it arrives
with identity, not before it." Verified: there is no `CREATE POLICY`, no `ENABLE ROW LEVEL
SECURITY` and no `SET LOCAL` anywhere in `prisma/` or `lib/db/`; the single baseline migration
`20260815000000_init` contains none. One `DATABASE_URL`, one database role, no per-request role.

The discipline itself holds up better than most such claims. `npm run audit:tenancy` passes on the
current tree — 71 Prisma calls in `lib/db`, every tenant-scoped one naming a tenant; 17 row mappers,
all stamping `tenantId`. The branded `TenantId` (`lib/tenant.ts:39`) means an arbitrary string
cannot reach a repository function, and `currentTenantId()` throws on a malformed value rather than
silently serving the default (`:69–73`), which is the right failure.

**What is stale is the reason given, not the claim.** `lib/tenant.ts:23–24` and `README.md`'s
multi-tenancy section both say there is "no identity in this application — no user, no session, no
role binding". All three now exist: `lib/auth/*`, `lib/principal.ts` and `lib/access.ts`. The
stated precondition for RLS has been met, and the comment has not noticed. That matters because it
is the sentence a reader uses to decide whether RLS is due yet.

**What RLS would add.** Today a single forgotten `where` clause in a future repository function
leaks one firm's data into another's workspace, and nothing catches it at runtime — the compiler
and a grep script catch it, which is real but is not a guarantee. RLS makes the database refuse the
row regardless of what the query asked for. It also converts finding 1's blast radius from "this
firm's data" to "this firm's data" rather than "every firm's" once a second tenant exists.

**What it would cost.** A per-request database role or a `SET LOCAL app.tenant_id` inside every
transaction, which means abandoning Prisma's connection pooling as currently used or wrapping every
`$transaction` to set the variable first; a policy per table — around twenty; a migration that must
be applied before any second tenant exists; and a permanent tax on every new table, because a table
without a policy is a silent hole. For a single-tenant deployment serving one firm, that is real
work buying a guarantee against a risk that is currently zero. **My recommendation is that RLS is
not the next thing to do.** It is the right thing to do before the second tenant is onboarded, and
it should be gated on that event rather than on the calendar. Findings 1 to 3 are worth more, sooner.

### 6. Anything that logs or returns something it should not

The good news first, because it is the majority of the answer. In `app/` and `lib/` at `5cb6ddd`
there is no console output at all — every hit is in `scripts/`, and none of those prints a secret.
No token, no
cookie value, no session claim and no `DATABASE_URL` is written to a log or returned in a body
anywhere in the request path. The Prisma client logs `error` only in production
(`lib/db/client.ts:25`). The chat route translates SDK errors into user-facing sentences
(`app/api/chat/route.ts:164–178`) rather than passing exceptions through, and never echoes the API
key. `describeDbError`'s three recognised branches (`lib/db/client.ts:60–68`) are deliberately
generic and well chosen. Client data does not travel anywhere it should not: the chat route sends
only the facet lists and the caller's own posted catalogue to Anthropic, never stored state.

The two exceptions are finding 5: Entra's `error_description` reaching a URL query parameter via
`app/api/auth/callback/route.ts:26–30`, and `describeDbError`'s raw fallthrough at
`lib/db/client.ts:69` reaching an anonymous caller through `app/api/workspace/route.ts:136` and
`lib/db/boot.ts:119`.

One thing that is not a leak but is worth knowing: `lib/identity.ts:59` hardcodes a real person's
name as `DEFAULT_OPERATOR`, and the comment at `:46–57` already says this is the wrong default the
moment the app runs anywhere but the machine it was written on. `.env.example:23` tells the
operator to set `AXIOMATE_OPERATOR`. Under Entra this path is unreachable
(`lib/principal.ts:52`), so it is a documentation point rather than a finding.

---

## Where the code's stated limits no longer match the code

This codebase states its limits carefully, which makes the ones that have gone stale more dangerous
than they would be elsewhere: a reader trusts them.

- **`.env.example:28–29`** — "each person's roles come from the directory rather than from the
  fallback role". False, per finding 3, and it is the false assurance that stops an operator from
  ever checking `defaultRoleIds`. **Correct this first.**
- **`README.md`, *Known limitations*** — "There is no authentication." Stale, and misleading in the
  more dangerous direction: it tells a reader the deployment has no identity at all, so the reader
  never asks the narrower question that matters, which is what identity does and does not gate.
- **`lib/tenant.ts:23–24` and `README.md`, *Multi-tenancy*** — "no user, no session, no role
  binding". Stale. The isolation claim they support is still true; the reason given is not.
- **`lib/access.ts:12–17`** — "there is still no login, no session and no identity provider, and
  `currentActor()` reads one configured operator". Stale for a configured deployment. The paragraph
  at `:28–33` about `defaultRoleIds` is the part that is still exactly right and should be promoted,
  not deleted.
- **`README.md`, *Known limitations*** — "Routing rules and mail intake are configuration records
  only. Nothing reads a mailbox and nothing applies a rule." Stale: `app/api/intake/route.ts`
  applies them.

None of these are defects in themselves. Together they mean a reviewer reading the documentation
would conclude this deployment is less capable and less exposed than it is.

---

## What I would require before client data goes in

Four things, all small, all in code that already exists.

1. **Gate the page render on the session.** `lib/db/boot.ts` must not return workspace state when
   `identityEstablished() && !session.verified`. This is the whole of finding 1 and it is the only
   one of the four that is not optional.
2. **Import `INTAKE_ACTOR` from `lib/actor.ts`** in `app/api/intake/route.ts` and delete the local
   constant at `:44`. Do this before touching `defaultRoleIds`, or intake stops working and the
   error will point somewhere else.
3. **Give `rolesFor` the email it currently throws away**, populate `Person.email` for real staff,
   assign roles, and then set `access.defaultRoleIds` to `[]`. Add the `accessProblems` check that
   refuses a fallback role holding `config.manage` while a provider is configured, so this cannot
   silently regress.
4. **Authenticate `/api/chat`** with the same two lines the write endpoint uses.

Plus two configuration items on the Azure side that cost nothing and are not in the code:
**HTTPS Only** with HSTS on the App Service, and every secret — `AXIOMATE_SESSION_SECRET`,
`AXIOMATE_ENTRA_CLIENT_SECRET`, `AXIOMATE_INTAKE_TOKEN`, `AXIOMATE_SCHEDULE_TOKEN`,
`ANTHROPIC_API_KEY`, `DATABASE_URL` — in Key Vault with references rather than in App Settings as
literals.

And correct `.env.example:28–29`, because the wrong sentence there is what makes item 3 invisible.

## What I would accept as a follow-up

- **Session revocation** (finding 6). A `jti` and a server-side session row, or a shorter cookie
  refreshed against the provider. Eight hours of access after offboarding is a real gap and a
  bounded one.
- **The two error-text leaks** (finding 5). An opaque code in the callback redirect; a fixed
  sentence for `describeDbError`'s unmatched case.
- **Row-level security** (question 5). Gate this on onboarding a second tenant, not on a date. The
  scoped data model is done and it is the expensive half.
- **Rate limiting** on `/api/chat`, `/api/intake` and `/api/auth/signin`, and a Content-Security
  Policy. Neither exists today. At one firm's traffic, neither is urgent.
- **The small hardening set**, worth one commit between them: constant-time comparison for the two
  bearer tokens (`app/api/intake/route.ts:59`, `app/api/schedule/run/route.ts:48`); reading those
  tokens per request rather than at module load so rotation does not need a restart; the `__Host-`
  cookie prefix; `Secure` on the sign-out clear; and the one-shot auth cookies at 300 seconds
  rather than 600.

---

## Would I put client data in this deployment as configured?

**No.**

Not because the security work here is poor — the authorisation-code flow is done properly, the
cookie is constructed carefully, the permission model is enforced at the reducer funnel where it
cannot be bypassed by a request that never touched a screen, attribution cannot be forged by the
client, and the tenancy scoping is genuinely complete. Those are not common findings and they were
not arrived at by accident.

The answer is no because the front page serves the entire workspace — every client's issues, every
note, every time entry, every commercial figure — to anybody who knows the hostname, in every
configuration including a fully wired Entra one, while displaying a **Sign in** button that implies
otherwise. Everything else in this review is secondary to that.

Fix the four required items and the answer becomes yes, with the follow-up list scheduled. They are
a day's work between them, and three of the four are corrections to code that already knows what it
was supposed to do.
