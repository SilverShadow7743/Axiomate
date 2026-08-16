# Secrets and configuration

Axiomate reads eleven values from its environment. Six of them are secrets and live in Key Vault.
Five are configuration and live in the web app's own settings, in plain sight. This page says
which is which and why, what each one does, what the application does when it is missing, how to
produce one, and what happens to the people using the product while it changes.

Read the section on unresolved references before you deploy anything. It describes a failure that
looks like success, and one of the six fails open when it happens.

---

## The line

| Value | | Where it lives |
| --- | --- | --- |
| `DATABASE_URL` | Secret | Key Vault, as `axiomate-database-url` |
| `AXIOMATE_ENTRA_CLIENT_SECRET` | Secret | Key Vault, as `axiomate-entra-client-secret` |
| `AXIOMATE_SESSION_SECRET` | Secret | Key Vault, as `axiomate-session-secret` |
| `AXIOMATE_INTAKE_TOKEN` | Secret | Key Vault, as `axiomate-intake-token` |
| `AXIOMATE_SCHEDULE_TOKEN` | Secret | Key Vault, as `axiomate-schedule-token` |
| `ANTHROPIC_API_KEY` | Secret | Key Vault, as `axiomate-anthropic-api-key` |
| `AXIOMATE_TENANT` | Configuration | App settings |
| `AXIOMATE_OPERATOR` | Configuration | App settings |
| `AXIOMATE_ENTRA_TENANT_ID` | Configuration | App settings |
| `AXIOMATE_ENTRA_CLIENT_ID` | Configuration | App settings |
| `AXIOMATE_ENTRA_REDIRECT_URI` | Configuration | App settings |

The test is not "would we mind if this leaked". It is narrower and more useful: **does knowing
this value let somebody do something they could not otherwise do?** Each of the six passes it.
Knowing `DATABASE_URL` is being able to read and rewrite the firm's issue history. Knowing
`AXIOMATE_SESSION_SECRET` is being able to mint a cookie for anybody. Knowing
`AXIOMATE_INTAKE_TOKEN` is being able to file work in the firm's workspace from the internet.

The five fail it, and not by a narrow margin.

- **`AXIOMATE_ENTRA_CLIENT_ID`** and **`AXIOMATE_ENTRA_TENANT_ID`** are sent to the browser as
  query parameters on the very first redirect of every sign-in. They are in the address bar. They
  are published values that happen to look like credentials because they are long and hexadecimal.
- **`AXIOMATE_ENTRA_REDIRECT_URI`** is a URL that has to be registered in Entra by anyone who
  cares to look at the app registration, and is where the browser is sent.
- **`AXIOMATE_TENANT`** is a slug that already appears in browser storage keys. `lib/tenant.ts`
  chose a readable slug over a generated key precisely so that it could appear in places a person
  reads.
- **`AXIOMATE_OPERATOR`** is a display name that is rendered on screen and written into the audit
  trail. Concealing it from the deployment while printing it in the product is not a security
  posture.

Putting any of those in the vault would cost a lookup on every cold start, an RBAC grant and a
rotation story, and would buy nothing. It would also cost something less obvious: a vault whose
contents are mostly harmless teaches the people who read it that its contents are harmless. The
vault holds six things and every one of them is dangerous. That is the point.

Being configuration is not the same as being unimportant. `AXIOMATE_OPERATOR` decides whose name
is on every audited change, and the four Entra values decide whether this deployment
authenticates anybody at all. They are described at the end of this page for that reason.

---

## Where the six live, and how they get there

`infra/keyvault.bicep` creates the vault, turns on soft delete and purge protection, and grants
the web app's managed identity **Key Vault Secrets User** — read only. It creates no secrets and
carries no values. Nothing in the deployment pipeline ever holds one of these six strings.

The reasoning is set out in full at the top of that file; the short version is that a template
which owns secret values fights the operator. Rotate a leaked token in the portal at nine in the
morning and the next `main.bicep` deployment would silently put the old one back. Here, a redeploy
has no opinion about the contents of the vault, so `what-if` reporting a change to a secret is a
real signal rather than noise.

The cost is that a freshly deployed environment comes up with an empty vault and stays that way
until a person fills it in. Axiomate degrades rather than failing, so it will serve pages in that
state — which is exactly why the next section exists.

The module publishes `vaultName`, `secretNames` and ready-made `secretReferences` as outputs, and
`infra/app.bicep` takes each secret as a plain string parameter that it does not interpret. The
top-level template should therefore wire one to the other rather than restating any secret name in
two places: the vault owns the names, because Key Vault will not accept the underscores that the
environment variables use, and a name written out twice is a name that will differ once.

### Granting yourself the ability to write

The app can read. Nobody can write until a human is given the officer role. That role is
deliberately not in the template: who may write the firm's credentials is a decision for the firm.

```sh
az role assignment create \
  --role "Key Vault Secrets Officer" \
  --assignee-object-id "$(az ad signed-in-user show --query id -o tsv)" \
  --assignee-principal-type User \
  --scope "$(az keyvault show --name <vault-name> --query id -o tsv)"
```

Role assignments take a minute or two to propagate. A `403` immediately after this command is
usually impatience rather than a mistake.

### Writing a value

```sh
az keyvault secret set --vault-name <vault-name> --name axiomate-session-secret --file ./secret.txt
```

Prefer `--file` over `--value`. A value passed on the command line is in shell history, in the
process table while it runs, and in the terminal scrollback of whoever was pairing. Delete the
file afterwards.

### Making the app pick it up

App Service caches resolved Key Vault references and refetches them roughly every 24 hours. A new
secret version is therefore **not** live when you write it. Two things force it sooner: any
configuration change to the app, which restarts it and refetches everything, or an explicit
refresh.

```sh
az rest --method post \
  --url "https://management.azure.com/<app-resource-id>/config/configreferences/appsettings/refresh?api-version=2022-03-01"
```

Always force it. Waiting for the cache means the rotation lands at an hour nobody chose, which for
`AXIOMATE_SESSION_SECRET` means everybody is signed out at a moment nobody predicted.

---

## Unresolved references: the failure that looks like success

**When App Service cannot resolve a Key Vault reference, it does not set the variable to empty. It
passes the reference string through literally,** so the application receives
`@Microsoft.KeyVault(VaultName=kv-axiomate;SecretName=axiomate-session-secret)` as the value.

Common causes are a missing role assignment, a secret that was never written, a secret that was
deleted, a typo in the reference, or a vault the app cannot reach over the network.

**Every first deployment passes through this state, and it is not an edge case.** The vault module
needs the web app's managed identity before it can grant it anything, so the app is created first,
with its settings already carrying the reference strings — at which point the vault does not exist,
the role assignment does not exist, and no secret has been written. All six references are
unresolved from the moment the app starts until a person writes the values and forces a refresh.

That window is the open one. Do not hand the intake URL to the mail connector, do not point the
scheduler at the run endpoint, and do not switch Entra on, until the six values are written and
every reference is confirmed resolved. A deployment that is given its integrations first is a
deployment whose session key and bearer tokens were guessable for however long that took.

Axiomate treats several of these values as "configured if non-empty", so a literal reference
string is not treated as absent. It is treated as a real value that happens to be wrong, and the
consequences differ sharply per secret:

| Secret | What an unresolved reference actually does |
| --- | --- |
| `AXIOMATE_SESSION_SECRET` | **Fails open.** The string is longer than the 32-character minimum, so sessions work — signed with a key that is nothing but the vault name and the secret name in a fixed template. The secret names are in this repository and the vault name is visible to anybody with reader access to the subscription. Cookies can then be forged for any identity. |
| `AXIOMATE_INTAKE_TOKEN` | **Fails open.** The literal string becomes the accepted bearer token, and it is guessable. |
| `AXIOMATE_SCHEDULE_TOKEN` | **Fails open**, the same way. |
| `AXIOMATE_ENTRA_CLIENT_SECRET` | Fails closed. Entra still counts as configured, so the deployment does not drop to single-operator mode; the token exchange is rejected and sign-in breaks. |
| `DATABASE_URL` | Fails closed. The connection string is malformed, and every request touching the database returns an error. |
| `ANTHROPIC_API_KEY` | Fails closed and harmlessly. The API rejects the key and the assistant reports it. |

So: **verify that all six resolved before you trust a deployment.** In the portal, the app's
Environment variables blade shows a status against each Key Vault reference, and
`Diagnose and solve problems` has a `Key Vault Application Settings Diagnostics` detector. Then
smoke-test it: sign in, post one message to intake with the token you wrote, and ask the assistant
a question. Three checks, and between them they exercise four of the six.

---

## The six secrets

### `DATABASE_URL`

**What it is.** The Postgres connection string, credential included. Read in `lib/db/client.ts`.
Everything the firm has recorded lives behind it.

**What the application does when it is absent.** It does not fail, and this is the value whose
absence is most easily missed. `databaseConfigured()` returns false and the workspace runs from
the seed file, with every change held in the *browser's* own storage. On a laptop that is a
reasonable development mode. On Azure it means two things nobody wants: each person has a private
copy of the workspace that nobody else can see, and that copy dies when the browser's storage is
cleared. Meanwhile `POST /api/intake` refuses with 503 — "No database is configured, so an
arriving message has nowhere to go" — and `POST /api/schedule/run` refuses with 503 before it even
looks at who is calling. A deployment in this state serves pages, accepts edits, and retains
nothing.

**What happens when it is wrong.** The application distinguishes the two cases and says which:
"The database is not reachable" for a host or firewall problem, "The database rejected the
credentials in `DATABASE_URL`" for a password problem.

**How to generate it.** You do not invent this one. Locally, `npm run db:setup` generates a
24-byte random password, writes it into `.env` and into a gitignored `scripts/db-setup.sql` for a
superuser to apply — the generator is in version control, the generated password is not, because a
credential in a repository is a credential forever. In Azure the password belongs to the Postgres
module; take the connection string from its output rather than composing one by hand.

**Rotating it.** Change the password on the server, write the new connection string as a new
version, force the refresh. Connections already open continue on the old credential until the pool
recycles them, so there is a window where some requests succeed and some do not; restart the app
to end that window deliberately rather than waiting for it to close on its own. Nobody is signed
out — the session cookie has nothing to do with the database.

---

### `AXIOMATE_ENTRA_CLIENT_SECRET`

**What it is.** The client secret from the Entra app registration, used once per sign-in in
`completeSignIn` to exchange the authorisation code at the token endpoint. It travels server to
server over TLS and never reaches a browser.

**What the application does when it is absent.** This is a behaviour switch, not a feature toggle,
and it switches in the direction people do not expect. `entraConfig()` requires all four Entra
values; with any one missing it returns `null`, `configured()` is false, and the entire
application drops into single-operator mode. Nobody signs in. `getSession` returns the configured
operator, unverified. `POST /api/workspace` stops refusing unverified writes, because
`identityEstablished()` is false and the gate never closes. `POST /api/schedule/run` treats the
deployment as open and will run the pass for any caller, with or without a schedule token.

An empty client secret does not break sign-in. It removes it, and opens the deployment. The one
mercy is that an *unresolved vault reference* does not produce an empty value — see above — so the
common infrastructure failure locks people out rather than letting them in. Both outcomes are
possible, and they are opposites. That is why the reference check is not optional.

**How to generate it.** Not generated: Entra issues it. App registrations, your application,
Certificates & secrets, New client secret. Copy the **Value**, not the Secret ID; the value is
shown once and never again. Record the expiry — Entra caps it, and it will expire whether or not
anybody diarised it. An expired client secret produces exactly the locked-out case above.

**Rotating it.** The only one of the six with a real overlap window, so use it. Add a *second*
client secret in Entra before removing the first; Entra accepts both. Write the new value, force
the refresh, confirm a sign-in works, then delete the old one from the registration. Nobody
already signed in is affected: existing cookies are signed with `AXIOMATE_SESSION_SECRET` and do
not involve this value at all. Only people signing in during the swap could see a failure, and
with the overlap there should be none.

---

### `AXIOMATE_SESSION_SECRET`

**What it is.** The HMAC-SHA256 key over the session cookie (`lib/auth/seal.ts`). The cookie
carries an object id, a name, an email address and an expiry, signed rather than encrypted —
deliberately, because those are facts the person already knows about themselves and the only real
risk is somebody *writing* one. Minimum 32 characters; anything shorter is treated as absent,
because shorter keys are the ones typed in as "changeme" and left. Sessions last eight hours.

**What the application does when it is absent, or under 32 characters.** It depends on whether
Entra is configured, and the two answers could not be further apart.

- **Without Entra**, nothing changes. No session is ever created, so no key is ever needed.
- **With Entra**, the deployment locks itself out. `GET /api/auth/signin` returns 503 and refuses
  to start a sign-in. `verify()` reports "no signing secret configured", so every request resolves
  as "Not signed in". `POST /api/workspace` returns 401 for everybody. `POST /api/schedule/run`
  accepts only the schedule token. The product becomes read-only for the whole firm, including
  administrators, with no route back in through the interface.

This is the one absent value that takes the firm out of its own workspace, and — via an
unresolved reference rather than an empty one — also the one that fails most dangerously open.
Both. It is worth checking twice.

**How to generate it.** `openssl rand -base64 48`, or

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

which is what `scripts/db-setup.mjs` does for local use. Different in **every** environment. A key
shared between staging and production means a cookie minted by anybody with staging access is
valid in production, which converts a low-trust environment into a high-trust one.

**Rotating it.** This is the destructive one, and there is no way to make it gentle without a code
change. Every cookie in existence was signed with the old key and fails signature verification the
moment the new one is live. Everybody signed in is signed out, mid-action, with no warning. The
browser applies edits optimistically, so somebody can be looking at a change on screen while the
POST behind it comes back 401 — the work is on their display and not in the database.

Therefore: rotate at a quiet hour, force the refresh rather than letting the 24-hour cache pick
the moment, and tell people first. There is no overlap window; the code holds one key and checks
one signature. Whether it should accept a previous key for one session lifetime is a real question
and a code change to `lib/auth/cookie.ts` — decide it now rather than during the incident that
makes it urgent.

---

### `AXIOMATE_INTAKE_TOKEN`

**What it is.** The shared secret for `POST /api/intake`, sent by whatever forwards the firm's
mail as `Authorization: Bearer <token>`. This is the only endpoint in the product that accepts
content from outside the firm.

**What the application does when it is absent.** Intake refuses everything, with 503 and a message
saying why. Closed, not open — an endpoint that creates records in the firm's workspace from the
internet does not run without a secret, and "we will add auth later" is how the other kind ships.

The operational consequence is on the other side of the wire. Every message the connector forwards
is refused, and whether those messages come back depends entirely on the connector's retry
behaviour. Most mail forwarding rules do not retry a 503. Assume that anything sent while intake
is closed is gone.

**How to generate it.** 24 random bytes, base64url — the same generator `scripts/db-setup.mjs`
uses for its tokens:

```sh
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Not a memorable phrase. The endpoint does a single string comparison and nothing rate-limits it.

**Rotating it.** There is no overlap window: the route compares the header against one string.
The vault and the connector must change together, and there will be a gap.

Order matters. Write the new secret, force the refresh, confirm the app has it, *then* change the
connector. The reverse order leaves a window in which the connector is sending a token the app
does not accept, which is the same gap facing the wrong way. Do it outside business hours, or
pause the forwarding rule for the minute it takes.

Two mitigations worth knowing. Intake deduplicates on the sender's own message id, so a connector
that re-forwards a message after a failed attempt creates nothing twice. And nobody is signed out;
this value has nothing to do with sessions.

---

### `AXIOMATE_SCHEDULE_TOKEN`

**What it is.** The bearer token for `POST /api/schedule/run`, the endpoint whatever already runs
things on a schedule — Task Scheduler, cron, a GitHub Action, an Azure timer — calls to run the
daily pass. Nothing inside Axiomate wakes itself up; a timer in a web server stops when the
process restarts and runs twice when there are two instances.

**What the application does when it is absent.** Not what the other tokens do. The route has two
ways in, and removing the token removes only one of them.

- **On a deployment with Entra configured**, the scheduler gets 401 and the pass does not run. A
  signed-in person holding `config.manage` can still run it by hand. This is inconvenient, not
  damaging: the pass writes its own memory of what it has already raised, so the next successful
  run picks up what the missed one would have. A skipped day means late notices, not absent ones.
- **On a deployment without Entra**, the endpoint is *unauthenticated*. The route deliberately
  treats a provider-less deployment as open, because a deployment with one operator and no way for
  them to prove it would otherwise be locked out of its own product. That is the right call for
  the product and it means that, with no token set, anybody who can reach the URL can trigger a
  pass that changes the workspace and sends people messages.

If this deployment runs without Entra, set the token, and keep the route off the public internet
as well. If somebody decides not to, that decision should be written down rather than inherited.

**How to generate it.** Exactly as for the intake token: 24 random bytes, base64url.

**Rotating it.** Same shape as intake, same absence of an overlap window, same order — vault
first, refresh, confirm, then the scheduler. The gap costs at most one missed pass, and the next
run absorbs it. Nobody is signed out.

---

### `ANTHROPIC_API_KEY`

**What it is.** The key `POST /api/chat` uses to reach Claude.

**What the application does when it is absent.** The assistant does not break; it changes engine.
The endpoint answers from a deterministic parser over the issue index the browser posted, handles
structured phrasings, and says in the reply which engine answered so nobody has to guess. What it
cannot do without a key is draft changes. The chat box still works and is visibly less capable.

**What happens when it is wrong or revoked.** 502, with "The configured API key was rejected.
Check `ANTHROPIC_API_KEY`." It does not quietly fall back to the offline engine — a rejected key
is a fault to fix, not a mode to run in, and silently degrading would hide it.

**How to generate it.** Not generated: issued in the Anthropic Console. This is the only one of the
six whose leak costs money directly rather than through what it unlocks, so it is worth a spend
limit on the key as well as a place in the vault.

**Rotating it.** The easiest of the six. Create the new key, write it, force the refresh, confirm
one assistant reply, revoke the old one. Nothing is stateful — the key travels with each request —
so rotation is invisible to anybody using the product. A request in flight at the moment of the
swap fails once and the person asks again.

---

## The five configuration values

These live in the web app's settings, not the vault. They are no less load-bearing for it.

### `AXIOMATE_TENANT`

The delivery firm this deployment serves — `axiocloud` here. A lowercase slug: letters, digits and
hyphens. Absent, it defaults to `axiocloud`. Malformed, `currentTenantId()` throws and every
request that touches the database fails loudly, on purpose, because quietly serving the default
tenant to a request that asked for another one is the precise failure the whole tenancy boundary
exists to prevent.

Changing it migrates nothing. It points the deployment at a *different* tenant, and every existing
row becomes invisible. It is a switch, not a setting: choose it at provisioning and never edit it.

### `AXIOMATE_OPERATOR`

The name written into the audit trail while there is no identity provider. Absent, it falls back
to a hardcoded default — currently a named individual, `Nishant Sekhar` — which means a second
deployment that forgets this attributes its entire trail to somebody who has never touched it. A
misattributed trail is worse than an unattributed one. **Set it.**

It has no effect once Entra is configured and somebody is signed in: the trail then carries the
directory's own object id, which is the identifier that survives a person changing their name or
their email address.

### `AXIOMATE_ENTRA_TENANT_ID`, `AXIOMATE_ENTRA_CLIENT_ID`, `AXIOMATE_ENTRA_REDIRECT_URI`

Published values, all three, and none of them a secret. They matter because of how they combine.

The four Entra values — these three plus the client secret — act as a **set**. All four present
means sign-in is enforced, unverified writes are refused, and each person's roles come from the
directory. Any one of them empty means the whole application runs as the single configured
operator instead. A deployment without credentials should keep working rather than present a
sign-in screen it cannot satisfy; the consequence is that a typo in any one of these four quietly
opens the deployment.

The redirect URI must match what is registered in Entra exactly, including scheme and trailing
path. A mismatch produces `AADSTS50011`, and the application passes Entra's own message through
verbatim rather than replacing it with "sign-in failed", because the provider's message is the one
that tells you what to change.

Note that `AXIOMATE_ENTRA_TENANT_ID` is not the same thing as `AXIOMATE_TENANT`, and neither is
the same as the directory that authenticates callers to the Key Vault. Three different things in
this system are called a tenant: the delivery firm the workspace belongs to, the directory the
firm's people sign in from, and the Azure AD tenant that owns the subscription. They are usually
related and they are not required to be.

---

## Decisions for the firm

None of these can be settled by a template. Each needs somebody to choose.

1. **Whether `DATABASE_URL` should exist at all.** Entra authentication to Azure Database for
   PostgreSQL would let the app connect as its managed identity and remove the highest-value
   secret in the vault entirely. It costs a change to `lib/db/client.ts` for token acquisition and
   refresh, which is application work rather than infrastructure work. Until that is done, the
   database credential is the one secret in this system whose leak is unrecoverable by rotation
   alone, because whoever had it has already read everything.
2. **Whether the schedule endpoint may run unauthenticated.** On a deployment without Entra it
   currently does. Set the token and restrict the route, or accept the behaviour explicitly.
3. **Whether the session key should have an overlap window.** Rotating it signs everybody out.
   Accepting the previous key for one session lifetime — eight hours — would remove that, at the
   cost of a compromised key remaining valid for eight hours after it is replaced. A code change
   either way.
4. **Whether the intake token should have one.** Same question, same shape, and the cost of not
   having one is measured in refused client mail.
5. **Network posture.** `allowPublicNetworkAccess` in `infra/keyvault.bicep` defaults to open,
   because the vault is guarded by RBAC rather than by network position and because closing it
   requires the web app to reach the vault over a virtual network. Closing it is a decision to be
   taken together with private endpoints and VNet integration, not by flipping one flag.
6. **Who holds Key Vault Secrets Officer.** The template grants only the app's read role. Whether
   the write role is a standing assignment or a PIM-eligible one on a group is the firm's call,
   and it is the difference between a compromised admin account being able to read the secrets and
   being able to replace them.
7. **Soft-delete retention, and the vault name, per environment.** Purge protection cannot be
   turned off once on, retention can be raised on an existing vault but never lowered, and vault
   names are globally unique. A vault created in error holds its name for the full retention
   period — ninety days by default. All three of those are settled at creation and none of them
   can be tuned afterwards, so decide the naming and pick seven days for genuinely disposable
   environments *before* the first deployment, not after somebody wants the name back.
8. **Where vault audit events go, and who reads them.** Wire
   `logAnalyticsWorkspaceId` and there is an answer to "who read this secret, and when". Leave it
   empty and there is not. The vault is the only component in this system that records reads.
