# Deployment

How Axiomate reaches Azure App Service, what to do when it does not, and how to tell the
difference between a release that worked and one that only started.

The pipeline is `.github/workflows/deploy.yml`. It is the only supported route to production:
deploying by hand from a workstation skips every gate below and, worse, skips the migration
ordering, which is the part that cannot be repaired afterwards.

---

## 1. What runs where

| Thing | Where |
| --- | --- |
| Application | Azure App Service, Linux, runtime stack `NODE\|24-lts` |
| Deployment target | The `staging` slot, swapped into production |
| Database | Azure Database for PostgreSQL flexible server |
| Identity for the pipeline | Entra workload identity federation, no stored secret |
| Identity for people | Entra ID, configured through `AXIOMATE_ENTRA_*` app settings |

The Node major is 24 in both places and the two must agree. The repository states no version —
there is no `.nvmrc` and `package.json` has no `engines` field — so 24 is derived: Prisma 7.9
requires `^20.19 || ^22.12 || >=24`, Next 16 requires `>=20.9`, and App Service Linux offers
`NODE|24-lts`. If the App Service stack is moved, `NODE_VERSION` in the workflow moves with it,
and the fact that the repository does not pin this itself is listed in section 9 as something
worth fixing.

---

## 2. What must exist before the first run

### 2.1 In Entra, for the pipeline's own identity

The workflow authenticates with `azure/login` using a federated credential, and there is no
client secret and no publish profile anywhere in this repository. A publish profile is a
long-lived credential that grants deployment rights to whoever holds it, and it survives every
person who ever pastes it into a shell. A federated credential grants a token that lasts minutes,
only to a run of this workflow, in this repository, in this environment.

This is a **different registration** from the one people sign in through. That one is
`docs/entra.md`'s subject, it holds a client secret, and it is configured on the app rather than in
the pipeline. Reusing it here would give a deployment credential to an application that thousands
of sign-ins touch, and would tie the pipeline's blast radius to the sign-in app's.

Create, in the Axiocloud Solutions tenant:

1. **An app registration** (or a user-assigned managed identity — either works; the app
   registration is easier to read in the portal). Note its **Application (client) ID**.
2. **A federated credential** on it, of scenario "GitHub Actions deploying Azure resources":
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:<owner>/<repo>:environment:production`
   - Audience: `api://AzureADTokenExchange`

   The subject is scoped to the **environment**, not to a branch. A ref-scoped subject
   (`repo:<owner>/<repo>:ref:refs/heads/main`) was rejected because it is wrong for at least one
   of the paths this workflow supports: the repository's branch is currently `master`, the
   workflow also triggers on manual dispatch, and each of those produces a different subject. An
   environment-scoped credential is stable across all of them, and it is also what gives the
   `production` environment its meaning — a required reviewer configured there becomes an
   approval gate on the deploy, which a ref-scoped credential cannot express.
3. **Role assignments** for that identity:
   - `Website Contributor` on the App Service app — deploy the package and swap the slot.
   - Rights to manage firewall rules on the PostgreSQL server. `Contributor` on that server is
     the blunt version; a custom role with
     `Microsoft.DBforPostgreSQL/flexibleServers/firewallRules/write` and `.../delete` is the
     version to prefer, because the pipeline never needs to read a row.

Basic publishing credentials on the App Service app should be **disabled**. With them off, the
deployment action uses the token from `azure/login`, which is the whole point of the exercise.

### 2.2 In GitHub

A repository environment named `production`, carrying:

| Secret | What it is |
| --- | --- |
| `AZURE_CLIENT_ID` | The application ID from 2.1 |
| `AZURE_TENANT_ID` | The Axiocloud Solutions tenant ID |
| `AZURE_SUBSCRIPTION_ID` | The subscription holding the app and the database |
| `DATABASE_URL` | The production connection string, `sslmode=require` |

Only `DATABASE_URL` is a real secret in the sense of being a credential; the three IDs are
identifiers, kept as secrets only because there is no benefit to publishing them. The workflow
asserts that `DATABASE_URL` is set and does not point at localhost before it runs a migration,
because `prisma.config.ts` falls back to a localhost connection string when the variable is
empty — a missing secret would otherwise produce a confusing error about a database on the runner
rather than a clear one about the secret.

Whether the environment carries a required reviewer is a decision for the firm. It makes every
deploy wait for a person, which is right for a system holding client delivery records and wrong
for a team that deploys several times a day.

### 2.3 On the App Service app

App settings, on the production slot, all of them **not** marked as slot settings unless noted:

- `DATABASE_URL` — the same value as the GitHub secret. Deliberately not slot-sticky: the
  pipeline's pre-swap check requires the staging slot to prove it can reach the *production*
  database, and a slot pointing at something else would prove nothing.
- `AXIOMATE_TENANT`, `AXIOMATE_OPERATOR` — see `.env.example`. Set `AXIOMATE_OPERATOR`; leaving it
  unset attributes the entire audit trail to whatever the fallback is.
- `AXIOMATE_ENTRA_TENANT_ID`, `AXIOMATE_ENTRA_CLIENT_ID`, `AXIOMATE_ENTRA_CLIENT_SECRET`,
  `AXIOMATE_SESSION_SECRET`.
- `AXIOMATE_ENTRA_REDIRECT_URI` — **mark this one as a slot setting**, and register both
  hostnames as redirect URIs on the sign-in app registration. Use `scripts/entra-register.mjs`
  rather than `az ad app update`, which replaces the list rather than adding to it; `docs/entra.md`
  explains why. The slot has a different hostname, so a single shared value means sign-in on the
  slot bounces to production. If that is left undone, the slot simply cannot be signed into, which
  the pipeline's anonymous checks do not notice and a person testing the slot by hand will.
- `AXIOMATE_INTAKE_TOKEN`, `AXIOMATE_SCHEDULE_TOKEN`, `ANTHROPIC_API_KEY` — as required.
- `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. The package is built in CI, gated in CI, and shipped
  whole. Letting Oryx rebuild on the host would produce a different artefact from the one the
  gates passed, which makes the gates advisory.

Startup command: `npm run start`. Next reads `PORT` from the environment, which App Service sets.

Health check path: `/api/health`, on both slots. The pipeline reads that endpoint itself, but the
platform reading it is what takes a broken instance out of rotation between deploys, which is the
larger half of its value. It is App Service configuration rather than an app setting, so it lives
with the infrastructure definition.

---

## 3. How a release happens

Push to `main` or `master`, or run the workflow by hand from the Actions tab. Both branches are
listed because the repository is on `master` and a workflow watching only `main` would fail by
never running, which is the hardest failure to notice.

> **The workflow has never run.** There is no git remote on this repository, so every release so
> far has been made by hand from a workstation. Everything below describes what the pipeline
> *would* do; the parts of it that have actually been exercised are the ones a manual release
> also performs. Read section 3a before releasing by hand — two of the three obvious ways to
> build the zip on Windows produce an archive Kudu rejects, and both fail silently.

### 3a. Releasing by hand, and the two broken ways to build the zip

Use `scripts/package-release.py`. Not `Compress-Archive`, and **not `tar`**:

| Method | Result |
|---|---|
| `Compress-Archive` | Entry names carry **backslash** separators. Kudu unpacks them as files with backslashes in the name rather than as directories, so there is no `server.js` where the startup command looks. The site reports "failed to start" with no cause. Cost three deploys before it was understood. |
| `tar -a -c -f x.zip` | Produces an archive whose central directory Python's own `zipfile` cannot open, and which Kudu rejects with **400**. It also barely compresses — the same tree was 110 MB through `tar` and 37 MB through the script. **This was previously recorded here as the fix for the row above. It is not.** |
| `scripts/package-release.py` | Forward slashes by construction, a valid central directory that the script reads back before handing it on, and it refuses to include `.env`. This is the method that has deployed. |

`zip -qry` in the workflow is Info-ZIP on Linux and is fine; none of this applies there.

The full sequence from a clean checkout:

    git archive HEAD | tar -x -C <build-dir>      # so uncommitted work cannot ship
    cd <build-dir> && npm ci && npx prisma generate
    npx tsc --noEmit && npm run build
    python scripts/package-release.py .next/standalone <out>/release.zip         --extra .next/static=.next/static --extra public=public

(`public=public` since the PWA landed: standalone output does not carry `public/`, and a
package without it deploys a 404 manifest icon set, service worker and offline page — found
by probing the four URLs after the phase-8 deploy, which is now checklist §33 step 1.)
    az webapp deploy --name axiomate-tms --resource-group Axiomate-TMS-RG         --src-path <out>/release.zip --type zip

Building from `git archive HEAD` rather than the working tree is not fussiness. It is the only
thing that stops half-finished work reaching production, and it has already earned its place
once: a UI change that did not typecheck was in the tree at the moment a release was cut.

**There is no staging slot, because the plan is B1 Basic and slots need Standard or better.**
Everything section 3 says about swapping is therefore aspiration. A manual release restarts the
site, which takes roughly a minute, and the browser write queue's retry budget is about seven
and a half seconds — so a user mid-edit during a deploy can have their queue halt. Deploy when
nobody is working, or move the plan to Standard and use the slot.

The run has two jobs.

### Verify

Everything here can fail the run, and nothing here is skipped conditionally. The gates divide by
whether they need a database, not by how long they take:

| Gate | Needs a database | What it catches |
| --- | --- | --- |
| `tsc --noEmit` | No | Type errors anywhere, including in `scripts/`, which `next build` does not see |
| `npm run audit:tenancy` | No | A Prisma call in `lib/db` that forgot its tenant `where`. Nine such calls existed when the check was written |
| `npm run audit:attribution` | No | The audit trail taking a name from anywhere other than the actor parameter |
| `npm run audit:restore` | No | Archive and restore failing to invert each other |
| `npm run audit:estimation` | No | Capacity compressing a sequential chain; a baselined estimate being edited rather than re-agreed |
| `prisma migrate deploy` | Yes | The migration history failing to apply to an empty database |
| `npm run audit:persistence` | Yes | A mapper that drops a field, coerces a type or rounds a number between the reducer and Postgres. See the note below: as written in `package.json` this script cannot start |
| `npm run validate:scenarios` | No | See section 4 |
| `npm run build` | No | The application failing to compile |

The two database-dependent steps are why the job runs a `postgres:16` service container rather
than skipping them. Guarding `audit:persistence` with "run this only if a database is configured"
was rejected outright: it covers twenty-one tables and fourteen mapper pairs that typecheck and
would otherwise never execute, and a skipped gate reports a green tick that reads as coverage.
The container also means the baseline migration is proved against an empty database on every
push, before that claim is ever tested against production.

`npm run validate:report` is not in the pipeline. It renders a page from the last run for people
to read; it asserts nothing and gates nothing.

**`audit:persistence` needed a workaround to run at all, and this is worth knowing.** Every module
under `lib/db` begins with `import 'server-only'`. That package resolves, by export condition, to a
file that throws unless the importer supplies `react-server` — Next supplies it, plain `tsx` does
not. So `npx tsx scripts/persistence-proof.ts`, which is exactly what `npm run audit:persistence`
runs, fails on its first import before it has looked at a database. The proof has therefore never
run, on anyone's machine, since it was written; the validation report's claim that persistence is
the largest untested surface in the product was more literally true than it appears. The workflow
sets `NODE_OPTIONS=--conditions=react-server` on that step, which makes the gate real. The proper
fix is that flag living in the `package.json` script, so the proof can be run by hand as easily as
by the pipeline; see section 9.

Expect the first run of this gate to find something. The proof has been observed to *start* with
that flag and nothing more: there was no database available to run it against while the pipeline
was written, so the first CI run will be the first time twenty-one tables and fourteen mapper pairs
have ever executed. If it fails, read it as the gate working rather than as the pipeline being
broken, and fix what it names.

The job finishes by assembling the deployment package: the tree is reinstalled without dev
dependencies, the generated Prisma client is carried across by hand (the generator is itself a dev
dependency, so it cannot be re-run after the prune), and `.next`, `node_modules`, `data`,
`package.json`, `package-lock.json` and `next.config.ts` are zipped. `data/` is runtime input, not
documentation: `lib/data.ts` reads `data/issues.seed.json` and `data/axiomate.internal.json` from
the working directory on every boot.

### Deploy

In order, and the order is the argument:

1. Sign in to Azure with the federated credential.
2. Open a firewall rule on the PostgreSQL server for this runner's address.
3. `prisma migrate deploy` against the production database.
4. Close the firewall rule, whatever happened in step 3.
5. Push the package to the `staging` slot.
6. Warm the slot, require `/api/health` to report `"database":"connected"`, and render the
   workspace page once.
7. Swap the slot into production.
8. Require `/api/health` on the production hostname to report `"database":"connected"`.

**Migrations run before anything is swapped.** The alternative — swap first, migrate second —
puts new code in front of an old schema for the length of the migration, and every request in
that window asks the database for columns it does not have. With this ordering, a failed
migration leaves a production site still serving the previous release from a database it can
still read, and the recovery is to do nothing further.

**What that ordering costs.** Between the migration and the swap, and for the whole of the slot
warm-up, the schema is ahead of the code that is serving users. Every migration must therefore be
readable by the *previous* release: add tables, add nullable columns, and never drop or rename in
the same release that stops using something. A destructive change is two releases — one that stops
writing the column and is safely revertible, and a later one that removes it. This is not a style
preference; it is the price of never having new code in front of an old schema, and it becomes
non-negotiable the moment a firm's data is in the database.

**Why a slot rather than a direct deploy.** The application holds a browser-side write queue.
`components/useAutosave.ts` drains one request at a time and retries a failed one four times with
0.5, 1, 2 and 4 seconds of backoff: a total budget of about seven and a half seconds. A direct
deploy restarts the site, and the first request to a cold Next.js process on App Service routinely
takes longer than that on its own. When the budget runs out the queue halts, tells the user the
server is unreachable, and stops — and in database mode there is no local mirror, so the pending
actions exist only in that tab's memory and are gone if it is closed. A swap moves traffic to an
instance that is already warm, so the gap is a connection drain rather than a cold start.

The slot is not free. It runs a second instance on the same plan for the length of the deploy. It
shares the production database, so warming it exercises production data — read section 5 before
the first deploy. And a swap still cuts requests in flight: a batch of up to fifty actions that
the server committed but did not manage to answer will be replayed by the client, which is a
disagreement the reducer resolves by rejecting, and a rejection halts the queue for that user
until they reload. Making that window small is the best available answer; making it zero is not
on offer without changing how the client acknowledges writes.

---

## 4. The scenario harness, and why a regression in it blocks

`npm run validate:scenarios` drives the real reducer through the outcomes a delivery firm needs
and writes `data/validation.json`. It reports five verdicts, and most of what it reports is honest
absence: `NOT IMPLEMENTED` and `NOT TESTABLE` are normal, expected and numerous. It always exits
zero.

The pipeline runs it and compares the result against the copy committed in the repository.

- **A scenario that used to pass and no longer passes fails the run.** That is a regression on any
  reading, and the harness pins its clock to a fixed `TODAY` constant, so the comparison is
  deterministic rather than a function of the day the deploy happened to run.
- **Everything else is reported and allowed through**: a verdict that improved, a scenario that is
  new, a scenario that moved between two non-passing verdicts. These are also the signal that the
  committed `data/validation.json` is stale and should be regenerated and committed.

The argument the other way is real and was considered: this harness is a judgement about product
completeness, not a test suite, and wiring a deploy to it means a deliberate, well-understood
change to a scenario's expectations can block an unrelated release at an inconvenient moment. The
counter-argument won on the grounds that it is the only check in the repository that asks whether
the business outcome still happens end to end — everything else asks whether the code compiles or
whether one unit behaves. Gating on the totals would have been the wrong design: it would block
every honest release and be switched off within a week. Gating on losing ground costs nothing
until something breaks.

If a release deliberately gives up a scenario, regenerate `data/validation.json`, commit it with
the change that caused it, and say why in the commit message. The gate then passes, and the
repository carries a record of a decision instead of a surprise.

---

## 5. The seed import: read this before the first production deploy

On boot, `lib/db/boot.ts` calls `importWorkspace`. If the tenant has no `seededAt` in
`WorkspaceMeta`, that function imports `data/issues.seed.json` — 131 issues from the OAPIL
engagement, together with their relationships, activities, evidence and notes — into the database,
inside one transaction, and stamps `seededAt` so it never happens again for that tenant.

For a fresh production deployment this means: **the first page view writes 131 real issues into
the firm's production database.**

And on a production deployment it will not be the pipeline's page view. `boot.ts` now returns an
empty workspace to an unverified caller when an identity provider is configured, and it returns it
*before* it touches the database — so the deploy job's anonymous warm-up request cannot run the
import, and cannot absorb its cost either. On any deployment with Entra configured, the import
runs on **the first page view by the first person who signs in**, interactively, while they wait.

Is that what a firm wants? It depends who the firm is, and the honest answer is that the
application currently decides for them.

- For Axiocloud, whose seed *is* their own OAPIL delivery record, it is defensible. It is how the
  tool arrives with the firm's history already in it rather than as an empty tree.
- For any other tenant it is alarming. It plants another firm's engagement in their workspace and
  their audit trail, and the guard that stops it happening twice also stops it being undone by
  the same mechanism: the only way back is to delete that tenant's rows and start again.

There is a second, quieter consequence. The import is several hundred statements in one
transaction, so that first request is slow, and two people signing in at the same moment on the
first morning both see no `seededAt` and race — the composite primary keys mean one of them fails
with a constraint violation and sees an error on a workspace that is, from their point of view,
brand new. On the first deploy against an empty database, therefore, do not leave the import to
chance: either run it deliberately by signing in once yourself before anyone else is told the
system is live, or suppress it as below.

**If seeding is not wanted, suppress it before the first request.** After the migration has been
applied and before anything reaches the app, mark the tenant as already seeded:

```sql
INSERT INTO "Tenant" ("id", "name", "createdAt", "updatedAt")
VALUES ('axiocloud', 'Axiocloud Solutions', now(), now());

INSERT INTO "WorkspaceMeta" ("tenantId", "seq", "seededAt", "updatedAt")
VALUES ('axiocloud', 1, now(), now());
```

Substitute the value of `AXIOMATE_TENANT` for `axiocloud`. The application then starts empty and
stays empty. This is a lever, not a fix: the fix is for seeding to be an explicit choice — an
environment variable read in `boot.ts` — rather than a consequence of the database happening to be
empty. That change belongs in `lib/`, which this pipeline does not own, and it is listed in
section 9.

---

## 6. When a migration fails

A migration failure happens at step 3 of the deploy job, before anything has been swapped.
Production is still serving the previous release, and it can still read its database. Nothing
needs to be undone. Fix forward, and do not reach for a rollback.

The failures worth knowing by name:

**`P3005` — the database schema is not empty.** The database was created with `prisma db push`
(what `npm run db:push` does) rather than by applying migrations, so it has the tables but no
`_prisma_migrations` history, and `migrate deploy` will not write over a schema it did not create.
Check that the schema really does match the baseline, then record it as applied, once:

```
npx prisma migrate resolve --applied 20260815000000_init
```

**"Migration was modified after it was applied."** The repository has a single baseline migration,
`20260815000000_init`, which was regenerated in place as the schema grew. That is harmless while
no database has recorded it, and it stops being harmless the moment production applies it: Prisma
stores the checksum, and any later edit to that file makes every subsequent `migrate deploy` fail.
**From the first production deploy onwards, applied migrations are immutable.** Schema changes are
new migration files, and the baseline is never regenerated again. If it has already happened, the
recovery is to restore the file to the version production applied and put the change in a new
migration instead.

**A migration that failed part way through.** Prisma marks it failed in `_prisma_migrations` and
refuses every subsequent deploy until it is resolved, which is correct — the database is in a state
nobody described. Inspect it, undo the partial change by hand, then
`npx prisma migrate resolve --rolled-back <migration_name>`, then fix the migration and deploy
again.

**A migration that fails after the swap.** This should not be reachable through the pipeline, and
would mean someone applied a migration out of band. Swap back first (section 7), then treat it as
above: getting the code and the schema back into agreement comes before diagnosis.

---

## 7. Rolling back

**The code rolls back in one command.** After a swap, the previous release is sitting in the
`staging` slot. Swapping again puts it back:

```
az webapp deployment slot swap \
  --resource-group axiomate-tms-rg \
  --name axiomate-tms \
  --slot staging --target-slot production
```

This is why the slot is left alone after a deploy rather than stopped or wiped, and it is the
fastest recovery available: seconds, against an instance that is already warm.

The pipeline will not do this for you, deliberately. Making the post-swap check trigger an
automatic swap-back was rejected: one flaky HTTP request would then perform an unattended
production change at the moment when the state of production is least well understood, and a
system that swaps itself back and forth is a worse incident than a bad release somebody is already
looking at.

**The schema does not roll back, and pretending otherwise would be the dangerous answer.** Prisma
generates no down migrations, this repository has none, and nothing in `prisma/migrations/`
describes how to reverse anything. Undoing a schema change means one of two things:

1. Writing the reverse SQL by hand, against production, under time pressure. This is how data is
   lost.
2. Restoring the server from a point-in-time backup, which restores to a *new* server and
   discards every change made by every user since the restore point.

Neither is a rollback in the sense people mean when they ask for one. This is precisely why the
migration rule in section 3 exists: **an additive migration needs no rollback.** If the new columns
are nullable and the previous release ignores them, swapping the code back is a complete recovery,
and the unused columns sit there harmlessly until a later release either uses them or removes
them. Every destructive change deferred to a second release is one more release that can be undone
by a swap.

If a restore is genuinely required, it is a decision made by a person with the firm's authority,
not a pipeline step, and it should be rehearsed before it is needed rather than during. Confirm
now that point-in-time restore is enabled on the flexible server, what its retention window is,
and who is permitted to trigger one.

---

## 8. What to check after a deploy

The pipeline checks one thing itself, twice — on the slot before the swap and on production after
it — and it is the thing a status code cannot answer. `/api/health` returns 200 both when the
database is connected and when there is no `DATABASE_URL` at all, because running without one is a
supported mode of this application rather than a fault. On a production host it is not a supported
mode; it is the most dangerous state this deployment can be in, because the instance looks
completely well while every person's afternoon goes into their own browser and nowhere else. So
the workflow requires the body to contain `"database":"connected"` and fails on anything else,
including the healthy-looking `"not configured"`.

Reading the rendered page instead was rejected: `boot.ts` returns an empty workspace to an
unverified caller whenever an identity provider is configured, so an anonymous request from a
runner learns nothing about persistence on precisely the deployments this pipeline targets.

By hand, after a release:

1. **Open the app and make one trivial edit** — a note, a status change on something that does not
   matter. The save indicator should reach "saved". Reload; the change should still be there. This
   is the only check that exercises the write queue, the endpoint, the reducer and the database in
   one go, and it takes fifteen seconds.
2. **Check the issue count against the previous release.** A count that suddenly matches the seed
   file is the seed import having run against a database that was not as empty as somebody thought.
3. **Sign in**, if Entra is configured. A redirect-URI mistake shows up here and nowhere in the
   automated checks, which are anonymous — and on a first deploy this is also the request that
   runs the seed import, so it is worth doing before anyone is told the system is live.
4. **Confirm the scheduled pass still fires.** Nothing in this application wakes itself up:
   `POST /api/schedule/run` is called by something outside it, with `AXIOMATE_SCHEDULE_TOKEN` as a
   bearer token. Deploys do not break it, but hostname and token changes do, and the symptom is
   silence — notifications and ageing simply stop, and nobody is told.
5. **Read the log stream** for the first few minutes. Boot errors that the fallback swallows are
   visible there and nowhere on the page.

---

## 9. Open questions for the firm

These came out of building the pipeline. None can be settled inside `.github/workflows/deploy.yml`
or this document.

1. **Seeding should be a choice, not a consequence.** Section 5. The suppression lever works;
   an explicit environment variable read in `boot.ts` would be honest. Whoever owns `lib/`.
2. **The branch.** The repository is on `master` and the workflow watches both `master` and
   `main`. Pick one and drop the other, so the trigger states an intent rather than covering a
   doubt.
3. **`audit:persistence` cannot be run by hand.** Section 3. The script needs
   `--conditions=react-server` and does not ask for it, so the pipeline supplies it from outside.
   Moving it into the `package.json` script — `npx tsx --conditions=react-server
   scripts/persistence-proof.ts` — makes the proof runnable by a developer against their own
   database, which is where it is most useful and where the pipeline cannot help.
4. **`tsx` is not a dependency.** Five scripts in `package.json` run `npx tsx`, and it appears in
   neither `dependencies` nor `devDependencies`. Every CI run therefore fetches an unpinned
   version from the network to execute code that gates deployments. That is a reproducibility gap
   and a supply-chain one, and it is a one-line fix in `package.json`.
5. **Node is not pinned in the repository.** The version is derived in section 1 rather than
   read. An `engines` field or an `.nvmrc` would make CI, App Service and a developer's machine
   agree by construction. Note that `@types/node` is on major 26 while everything else points at
   24, which is worth reconciling at the same time.
6. **`output: 'standalone'` is now set** in `next.config.ts`, and the workflow's packaging step
   has not caught up: it still prunes `node_modules` and copies the Prisma client back by hand,
   shipping `.next node_modules data …` when `.next/standalone` already contains what is needed.
   The manual path uses standalone and produces 37 MB. The workflow should too.
8. **The workflow pins `NODE_VERSION: '24'` with a comment saying it must match the App Service
   runtime. It does not** — the app runs `NODE|22-lts`. It is healthy there, because Prisma 7.9
   wants `^20.19 || ^22.12 || >=24` and Next 16 wants `>=20.9`, both of which 22-lts satisfies.
   So this is a correction to make deliberately, in one direction or the other, rather than an
   incident: either move App Service to 24, or change the workflow to 22 and rewrite the comment.
9. **Prisma 7 ships a base64 WASM query compiler for every engine it supports** — sqlserver,
   cockroachdb, mysql, sqlite and postgresql — which is 75 MB of the build output for an
   application that only ever speaks to PostgreSQL. Dropping the four unused ones would cut the
   package by roughly 60 MB. Not done, because nothing here has established that Prisma does not
   enumerate that directory at load time, and a release that boots is worth more than a smaller
   one that might not.
7. **`/api/health` reports reachability, not readiness.** It answers `SELECT 1`, which succeeds
   against a database whose tables were never created — deliberately, since naming a table in a
   probe makes it go stale silently. That leaves one thing this pipeline would like to assert and
   cannot: that the schema the running code expects is the schema that is there. The migration
   step covers it going forward; nothing covers a database changed out of band.
8. **The database firewall.** The pipeline opens a rule for the runner's address and closes it
   afterwards. A self-hosted runner inside the VNet, or a private endpoint, would remove the
   pinhole altogether. It is more infrastructure, and it is the correct end state.
9. **Approval on the production environment.** Whether a person must approve each deploy is a
   policy decision, and the GitHub environment is where it would be expressed.
