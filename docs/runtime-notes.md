# Runtime notes: Axiomate on Azure App Service

What changes when this application stops being one process on one laptop talking to a local
Postgres, and becomes App Service talking to a managed one.

These are findings, not fixes. Nothing outside this file has been changed. Every claim below
names the file and line it rests on, and where a number is quoted it was measured, executed, or
read from a primary source rather than recalled.

**The configuration reviewed against.** This is not a generic Azure review. `infra/` specifies
the deployment, and the numbers below are that deployment's:

| | Value | Source |
| --- | --- | --- |
| App Service plan | Basic **B1**, Linux, `NODE\|22-lts` | `infra/app.bicep:147,192`, `infra/app.bicepparam:66,77` |
| Instances | **1** | `infra/app.bicepparam:71` |
| Startup command | `npm run start` — one Node process | `infra/app.bicep:340` |
| Session affinity | off | `infra/app.bicep:333` |
| Health check | `/api/health` | `infra/app.bicepparam:83` |
| Database | **Standard_B1ms**, Burstable, PG 18 | `infra/postgres.bicepparam:63-64` |
| User connections available | **35** | Azure limits, below |

A parallel workstream is actively building `infra/` and the rest of `docs/`, and it has already
identified two of the findings below from the infrastructure side. Where that is the case I say
so and confine myself to the half that lives in the application, which is the half those files
say they cannot fix.

---

## The shape underneath most of it

Four findings are the same design decision seen from different angles, so it is worth stating
once.

`loadWorkspace` (`lib/db/repo.ts:109`) reconstructs the entire `WorkspaceState` — nineteen
`findMany` calls, none bounded except the audit trail — and that function is the load path for a
page render, for the permission check on the schedule endpoint, for intake, and, critically, for
**every write**, from inside the write's own Serializable transaction (`lib/db/persist.ts:104-107`).

On a laptop that is free. The workspace is small, the round trip is a fraction of a
millisecond, and one process means no contention. On Azure each assumption weakens: the round
trip becomes milliseconds, the pool is finite and small, and there is eventually more than one
writer. The design itself is defensible — reading inside the transaction is what prevents
last-write-wins, and the comment at `persist.ts:96-103` is right about why — but its costs are
all denominated in things that were free locally.

---

## Findings, ranked

### 1. The autosave queue halts permanently, and there is nothing behind it

**What it is.** `halted` (`components/useAutosave.ts:44`) is set in four places — a disabled
server (`:81`), a 401 (`:105`), a 409 or 400 (`:119`), and exhausted retries (`:136`) — and is
never cleared anywhere in the file. Once set, `enqueueAll` returns before touching the queue
(`:160`), so the user carries on editing, the reducer carries on accepting, and nothing further
is even queued. The only signal is a status line reading "Not saved".

**Why there is no safety net.** With a database configured the browser mirror is deliberately
off — `components/IssueWorkspace.tsx:350` returns early when `persistence.enabled` is true, and
`lib/autosave.ts` explains why (two stores that can disagree is worse than one). That reasoning
is right for a *store*. It is wrong for an *outbox*: the pending queue lives in a `useRef` and
exists nowhere else, so it does not survive a reload, a crash, or a closed tab.

**On this plan it fires on every deployment.** Basic B1 has no deployment slots, so a deploy is
a hard restart of the only instance — `infra/app.bicep:80-82` says exactly this and calls it the
honest cost of the default. Trace what a browser with a queued batch experiences. The in-flight
`fetch` rejects, `attempt` becomes 1, and the queue retries on the 0.5s / 1s / 2s / 4s schedule
at `:26`. Four attempts spend roughly **7.5 seconds in total**. A Next 16 cold start on a B1
instance, including `PrismaClient` construction and the first pool connection, is not reliably
inside that. When it is not, the queue halts and never resumes.

**And the 401 path fires daily.** `SESSION_SECONDS` is eight hours (`lib/auth/cookie.ts:16`),
with a matching cookie `Max-Age`. A consultant who signs in at nine and is still in the same tab
at five gets a 401 on their next edit. On an Entra-configured deployment that is not an edge
case, it is the working day.

**What the user experiences.** The status reads "Not saved" and the detail, from
`describeSaveDetail` in `lib/autosave.ts`, says "Reload to resync with the server." Following
that instruction is what destroys the work: the reload discards the queue. The `beforeunload`
prompt (`useAutosave.ts:198-207`) is the only thing between the user and the loss, and it is an
unexplained browser dialog.

**Likelihood at this firm.** Near certain, twice over: once per deployment, and once per
eight-hour session on an Entra deployment.

**What would fix it.** Three changes, in order of value. Keep the queue in `localStorage` as an
outbox regardless of whether the database is on, and re-drain on load — a queue of pending
actions is not a competing store of record, and the objection in `lib/autosave.ts` does not
apply to it. Make 401 recoverable: keep the queue, offer sign-in, clear `halted` on return.
Give every halt a manual "Try again" that resets `halted` and calls `drain()`, so a transient
failure does not require the one action that loses work.

---

### 2. Twenty connections per instance against a ceiling of thirty-five, and the documented fix does not work

**The number.** Up to **20 Postgres connections per App Service instance**, from two independent
pools of 10.

**Evidence, because this is counter-intuitive.** `lib/db/client.ts` is careful: it caches the
client on `globalThis` in development and in a module-scope `cached` in production (`:30-36`),
which is the correct idiom and would give one client per process. The production build defeats
it. In `.next/server`, `lib/db/client.ts` appears in three chunks, and the module identifiers
are what matter:

| Chunk | Module id | Runtime it loads under | Loaded by |
| --- | --- | --- | --- |
| `chunks/_09x75xo._.js` | `90793` | `chunks/[turbopack]_runtime.js` | `api/workspace`, `api/intake` |
| `chunks/_0h56cpk._.js` | `90793` | `chunks/[turbopack]_runtime.js` | `api/schedule/run` |
| `chunks/ssr/_0d565kg._.js` | `84476` | `chunks/ssr/[turbopack]_runtime.js` | `app/page` |

The first two share both a module id and a runtime, so Turbopack's module cache instantiates
them once — the API routes genuinely do share a client, and `/api/health` should join them on
the next build, since every API route compiles under that same runtime. (The table is read from
the build in the tree, which predates `/api/health`; rebuilding would confirm it.) The page
render does not share: a different module id under a *different runtime file*,
which Node's require cache treats as an unrelated module. One process, two `PrismaClient`s, two
`pg.Pool`s.

`PrismaPg` passes its config straight to `new pg.Pool(...)`
(`node_modules/@prisma/adapter-pg/dist/index.mjs:749`), and only a connection string is supplied
(`lib/db/client.ts:24`), so every default applies: `max: 10`
(`node_modules/pg/lib/defaults.js:42`), `idleTimeoutMillis: 30000` (`:46`), and
`connectionTimeoutMillis` unset, which `pg-pool/index.js:206` treats as "wait indefinitely".

Twenty is a ceiling rather than a steady state — pools open lazily and reap after thirty seconds
idle — but it is reached in one step, because `loadWorkspace` fires its nineteen queries through
`Promise.all` (`repo.ts:116-138`). A single page render takes the SSR pool from zero to ten.

**What Azure allows.** Fifteen connections are reserved for replication and monitoring:

| Product | vCores | Memory | max_connections | Max **user** connections |
| --- | --- | --- | --- | --- |
| **B1ms** (provisioned) | 1 | 2 GiB | 50 | **35** |
| B2s | 2 | 4 GiB | 429 | 414 |

Source: <https://learn.microsoft.com/azure/postgresql/configure-maintain/concepts-limits#maximum-connections>

**Where that leaves the deployment as specified.** One instance is up to 20 of 35. It fits, with
fifteen spare — enough for `psql`, a migration, and the scheduler. So this is not on fire today.
It becomes one the moment `instanceCount` moves to 2, which is 40 against 35 and does not fit.
`infra/app.bicep:149` already warns about exactly this, and `infra/postgres.bicep:24-47` states
plainly that connections are the binding constraint at this tier and that the Bicep cannot fix
it. This finding is the other half of that sentence: the fix is in `client.ts`, and it has not
been made.

**The documented fix does not work, which is the part worth acting on.**
`infra/app.bicep:230` states: "Pool size is set here, in the query string, and is what a
scale-out has to respect." That was true of Prisma's own Rust pool and `?connection_limit=`. It
is not true of Prisma 7 with a driver adapter, where the pool is `pg.Pool`. Executed against the
installed packages:

```
parse('postgresql://…?connection_limit=5&max=7&pool_timeout=10')
  → { connection_limit: '5', max: '7', pool_timeout: '10', … }   // passed through as strings
new Pool({ connectionString: 'postgresql://…?connection_limit=5&max=7' })
  → pool.options.max = 10 ,  connectionTimeoutMillis = undefined
```

The parameters survive parsing and are then ignored. Anyone following the Bicep's guidance will
believe the pool is capped at five while it is in fact ten, twice over. A wrong belief about a
limit is worse than no belief, because it is what makes raising `instanceCount` look safe.

**Two symptoms, which should not be confused.** Exceeding the *server's* limit produces
`FATAL: sorry, too many clients already`. On the page path that propagates into `boot`'s catch
(`lib/db/boot.ts:134`), and the user is served a fully working application quietly saying
"Running from the issue log. Changes are not being saved." — they keep working and nothing is
stored. Exhausting a *pool* while the server still has room is different: with
`connectionTimeoutMillis` unset the request waits in the pool queue indefinitely, so the symptom
is a page that never finishes loading rather than an error.

**Likelihood at this firm.** Low today at one instance; certain on the day somebody scales out,
and they will do so believing the connection string protects them.

**What would fix it.** `PrismaPg` accepts a full `pg` pool config, so the cap belongs in code:

```ts
new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 })
```

Five per pool gives ten per instance and three instances inside the B1ms ceiling with room
spare, and the connection timeout converts an indefinite hang into a reportable error.
`infra/app.bicep:230` should then be corrected, because it currently documents a mechanism that
does nothing. Longer term it is worth asking whether the page render should hold a pool at all,
or should fetch its state through the same API layer the writes use.

---

### 3. Serializable transactions that read everything, retried without backoff

**What it is.** `runBatch` opens a Serializable transaction and then calls `loadWorkspace` inside
it (`persist.ts:104-107`), reading every row of nineteen tables before the first write. Postgres
tracks predicate locks over what a Serializable transaction reads; unbounded reads mean
relation-wide coverage. Two overlapping batches each read what the other wrote, which is the
rw-antidependency cycle SSI exists to detect, and one is aborted.

Not *guaranteed* — Postgres aborts on cycles it detects, and favourable commit ordering spares
some pairs — but highly likely, and rising with the length of the transaction. Which brings in
the second half: a Prisma interactive transaction pins one connection, so the `Promise.all` in
`loadWorkspace` **cannot** parallelise when `tx` is the reader. Those nineteen queries are
nineteen sequential round trips. On a laptop that is under a millisecond; against a managed
Postgres in the same region it is several milliseconds each before a single row is counted. The
contention window is that whole span plus the writes.

**The retry is thinner than it looks.** `MAX_SERIALIZATION_RETRIES = 3` (`persist.ts:89`) gives
four attempts, and the loop at `:74-81` has **no backoff and no jitter** — the retry is
immediate. All four land inside the same contention window that caused the first failure. The
detection is sound: `isSerializationFailure` (`:84-87`) checks both Prisma's `P2034` and the raw
`40001` text, which is the right belt-and-braces for a driver adapter.

**What a user sees today.** Usually nothing. Exhausting the retries throws, the route returns 500
(`app/api/workspace/route.ts:136`), and the browser retries with backoff, so one storm is
normally absorbed. What it costs is the browser's retry budget — and when that runs out the
queue halts permanently, which is finding 1. The visible failure is "Not saved" with a Postgres
serialisation message beside it, and silently unsaved work afterwards.

**Likelihood at this firm.** Low at one instance with a few consultants: edits are seconds apart
and each browser's queue is serial, so genuine overlap needs two people editing in the same
second. It becomes routine at two instances, and it becomes routine at one instance whenever the
scheduled pass runs while somebody is working — the pass holds a Serializable transaction over
the same full read for its whole duration.

**What would fix it.** In order: shrink what the transaction reads. The audit trail in particular
is read inside every write transaction purely so `newAudit` can be a suffix slice
(`persist.ts:141`); a `count` would serve, and dropping five thousand rows from every write's
read window removes both the largest cost and a large share of the predicate coverage. Then add
jittered exponential backoff and raise the attempt count — retrying immediately into a conflict
is close to not retrying.

---

### 4. The audit trail is capped at its **oldest** five thousand rows, and two features read it for behaviour

**What it is.** `repo.ts:135` reads `orderBy: { at: 'asc' }, take: 5000`. Ascending with a limit
takes the five thousand *earliest* entries, not the latest. The comment beside it — "Newest last,
so the History tab's own ordering is applied to a stable list" — describes the ordering correctly
and the truncation backwards.

**Why this is not merely a History-tab problem.** Two places derive behaviour from `state.audit`:

- `lib/reports/dailyIms.ts:122-124` filters the trail to the last twenty-four hours to report
  what moved. Once a tenant passes five thousand rows, `state.audit` holds only entries from the
  workspace's earliest days, every one outside the window. The daily IMS report then shows zero
  status changes, zero notes and zero issues raised — every day, correctly formatted, silently
  wrong. This is a client-facing report.
- `lib/workspace.ts:1362-1371` restores a reparenting archive by matching `parent` audit entries
  carrying the archive's timestamp. The comment at `:1357` anticipates entries "aged out of the
  capped trail" and accepts the degradation — but it assumes the *oldest* age out. Under `asc`
  truncation the missing entries are the newest, which is to say the recent archives, which is to
  say precisely the ones somebody is likely to restore.

**Likelihood at this firm.** Certain, on a timescale of months. A few thousand records at a
handful of audited edits each reaches five thousand rows without anything unusual happening, and
the seeded log imports its own trail on first boot.

**What would fix it.** `orderBy: { at: 'desc' }, take: 5000` and reverse the array — two lines,
and both features become correct. The better answer is that the trail should not be in
`loadWorkspace` at all: it is the only unbounded collection in the state, it is shipped into the
RSC payload on every page render, and it is read into every write transaction.

---

### 5. Tab switching mid-save can duplicate a note, and can drop queued work

**What it is.** The unload handler (`useAutosave.ts:177-195`) sends the queue by `sendBeacon`,
which is the right transport for an unload. Three problems with how it is used.

It fires on `visibilitychange` to `hidden` (`:186-188`), which is not only unload — it is every
tab switch and every minimise. It does not check whether a drain is in flight. So a consultant
with a request in flight switches tab, the beacon sends the same batch again, and the server
replays it. For a patch-shaped action that is harmless; for `addNote`, `addTime` or `create` it
is not, because the reducer mints a fresh id from `seq` each time and both copies persist. The
user finds a duplicated note and no explanation.

Separately, `:179` sends `queue.current.slice(0, MAX_BATCH)` — fifty — and `:184` then clears the
**whole** queue on success. Anything past the fiftieth queued action is discarded unsent.

**Likelihood at this firm.** The duplication needs a tab switch inside the few hundred
milliseconds a request is in flight; over months of daily use by several consultants it will
happen, though nobody is likely to attribute it correctly. The truncation needs more than fifty
actions queued at once, which happens after an assistant proposal or a multi-select edit.

**What would fix it.** Skip the beacon while `draining.current` is true. Restrict the flush to
`pagehide` rather than every visibility change. Drop only what was sent:
`queue.current = queue.current.slice(sentCount)`.

---

### 6. First boot with two instances can leave one of them permanently unseeded

**What it is.** `boot()` calls `importWorkspace` on every page render (`lib/db/boot.ts:113`; the
page is `force-dynamic`). The guard against re-importing is a `findUnique` on `seededAt` at
`repo.ts:260-267`, read **outside** the `$transaction` beginning at `:272` — and that transaction
names no isolation level, so it runs at Read Committed.

The import writes with `create`, not `upsert` (`:282`, `:287`, and throughout), against
`@@id([tenantId, id])` (`prisma/schema.prisma:186`) using ids the seed constructs, such as
`company:root`. Two instances rendering their first page against an empty database both pass the
guard, and the loser takes a duplicate-key violation. `boot`'s catch (`boot.ts:134`) turns that
into "Running from the issue log. Changes are not being saved." with the raw Postgres message
beside it.

The window is not narrow. The import writes on the order of a thousand rows one `create` at a
time — 258 issues plus nodes, notes, evidence and the rest — and is given a 120-second timeout
(`repo.ts:363`) for good reason. At a few milliseconds per round trip it is several seconds wide.

**Already known from the other side, and I would still fix it.** `infra/app.bicep:54-60`
identifies this race, describes it as first-boot-only and self-healing on reload, and cites it as
one reason `instanceCount` defaults to 1. That is a fair mitigation and it is why this ranks
sixth rather than second. Two reasons to fix it in code anyway. "Self-heals on reload" is true of
the tree but not of the people: anyone who worked in the unseeded window was told changes were
not being saved and had no database to save to. And the mitigation is a default, so it holds only
until somebody edits one line of a parameter file.

**What would fix it.** Take a transaction-scoped advisory lock on the tenant and re-check
`seededAt` inside the transaction, so the loser sees the winner's work and returns "already
seeded" rather than colliding. Separately, `importWorkspace` should not run on every page render
for the life of the deployment; it is a provisioning step, and it costs a query per page load
forever.

---

### 7. The first scheduled run raises everything it is supposed to be seeding

**What it is.** `lib/watch.ts:279-289` computes `isFirstEver` and then uses it to *exclude* the
seeding branch:

```ts
} else if (!isFirstEver && !wasWatching.has(finding.condition)) {
  seeded += 1
} else {
  onset.push(finding)
}
```

On the first-ever run every finding falls through to `onset`. The comment immediately above
(`:271-277`) states the opposite intent — "Its findings are recorded and not raised — the same
treatment the first run gets" — and gives the reason, which is that announcing six months of
accumulated staleness is how a firm switches the whole mechanism off again.

**Verified rather than argued.** `diffObservations` against `EMPTY_OBSERVATION` with two findings
returns `onset: 2, seeded: 0`. The same two findings against a previous observation watching a
different condition return `onset: 0, seeded: 2`. The newly-ticked-condition path behaves as
documented; the first-run path does not.

**How big it would be, measured against the shipped log.** `initWorkspace` over
`data/issues.seed.json` plus `data/axiomate.internal.json` gives 258 issues. `observe` finds 86
breaching conditions today and 158 at steady state, all of them `stale`. The shipped operating
model has four enabled automation rules — on `issue.created`, `issue.overdue`, `sow.overConsumed`
and `issue.owner` — and **none on `issue.stale`**, so `runWatch` currently plans nothing. I
confirmed that end to end: 86 onsets, 0 steps, 0 notifications, 0 audit rows.

So this is not a scale problem at this firm. It is a correctness problem waiting for a
configuration change: add a rule on `issue.stale`, or simply start populating due dates so
findings become `overdue` — for which `AUTO_OVERDUE` is enabled by default — and the first run
raises up to 158 notifications in a single transaction, to real people, about work they already
know about.

**What would fix it.** `} else if (isFirstEver || !wasWatching.has(finding.condition)) {`. One
operator.

---

### 8. The scheduled pass's thirty-second budget

**Where the ceiling is.** `runScheduledPass` (`lib/db/schedule.ts:42-111`) is Serializable with a
30-second timeout. Inside it: one `loadWorkspace` — nineteen sequential round trips, because `tx`
pins a connection — then one `persistSteps` call per step, each its own upsert, sequentially,
then a `createMany` for the audit and one upsert for the observation.

At today's size that is comfortably under a second of round-trip time. The budget starts to
matter in the low thousands of steps: at five milliseconds per round trip, two thousand
sequential upserts is about ten seconds before any query cost, and the full read in front of it
grows at the same time. That means a workspace an order of magnitude larger than today's, or a
first run of the kind finding 7 describes against several years of accumulated overdue issues.

**What it looks like when it happens.** Prisma aborts the transaction, so *nothing* commits —
including `scheduleWatch`, which holds the memory of what has already been raised. The next run
starts from the same observation, finds the same work, and fails identically. A pass that has
stopped working and a pass with nothing to do are indistinguishable from outside, because the
failure is a 500 body that only the caller sees. The number to watch is `raised` in the response.

**Likelihood at this firm.** Low. A few consultants and a few thousand records will not approach
it. Worth recording because the failure is silent and self-perpetuating rather than noisy.

**What would fix it, if it ever needs fixing.** Batch the notification writes rather than one
upsert per step, and consider committing the observation separately from the messages — accepting
a re-raise after a crash is a better failure than a pass that can never complete. Neither is
worth doing today.

---

## Things that are fine, and what was checked to establish that

A review that finds a problem everywhere it looks is not being careful. These were examined and
are correct as they stand.

**Nothing in the server assumes one process, with two exceptions that turn out to be safe.** The
search was `grep -rn "^let |^var |new Map|new Set|globalThis" lib/ app/` across every `.ts` and
`.tsx`, which returns eight hits, six of them frozen constants.

- `lib/workspace.ts:671` — `let auditSeq = 0`, a per-process counter minting audit ids like
  `aud-3-OAPIL-010`. This looks exactly like a multi-instance collision: two instances both start
  at zero. It is not one, because `auditToRow` (`lib/db/map.ts:443-454`) deliberately does not
  copy `a.id`, and `ScheduleAudit.id` is `@default(cuid())` (`prisma/schema.prisma:865`) with a
  comment naming this precise hazard. The in-memory id never reaches the database. Checked and
  clean.
- `lib/auth/entra.ts:159` — `jwksCache`, a per-tenant JWKS holder. Per-instance caching of a
  public key set is correct: each instance fetches once, and both agree because the keys come
  from Microsoft.

**Sign-in works across instances and needs no session affinity.** The three values that must
survive the OAuth round trip — state, nonce and the PKCE verifier — go into short-lived HttpOnly
cookies (`app/api/auth/signin/route.ts:41-44`) rather than a server-side store, and the callback
reads them back from the request. The session itself is a signed cookie verified against
`AXIOMATE_SESSION_SECRET`, an app setting every instance shares. A sign-in that starts on
instance A and returns to B completes normally, which is what makes `clientAffinityEnabled: false`
(`infra/app.bicep:333`) safe rather than merely tidy.

**There is no in-process scheduler, and that was the right call.** The pass is an endpoint
(`app/api/schedule/run/route.ts`), and the comment at `:10-21` gives the reasons that matter
here: a `setInterval` stops when the instance recycles and runs twice when there are two of them.
Two overlapping invocations are resolved by the Serializable transaction rather than by hoping.

**Id minting survives restarts and multiple instances.** `WorkspaceState.seq` is read inside the
write transaction and written back in the same one (`persist.ts:151-157`), so nothing depends on
process identity or on a counter that resets.

**Tenant scoping holds on every query.** All nineteen reads in `loadWorkspace` name `tenantId`
explicitly, written out rather than hoisted, and `TenantId` is branded so an arbitrary string
cannot reach a repository function. Nothing here changes on Azure.

**The health endpoint does not add load worth counting.** `app/api/health/route.ts` runs a cached
`SELECT 1` at most once every ten seconds per instance with a two-second timeout. It imports
`prisma` from `lib/db/client`, so on the evidence in finding 2 it shares the API routes' client
and adds no third pool. Against App Service's one-minute ping it costs one query a minute and
keeps one connection warm, which is a benefit rather than a cost.

**Anonymous page renders no longer touch the database.** `lib/db/boot.ts:66-92` now returns an
emptied seed before reaching `importWorkspace` when a provider is configured and the visitor has
not signed in. That was added for disclosure reasons rather than load, but it also means
unauthenticated traffic cannot consume the SSR pool at all.

---

## Smaller notes

- **Raw database errors reach the browser.** `describeDbError` (`lib/db/client.ts:58-70`) falls
  through to `msg.split('\n')[0]`, and both the write route (`route.ts:136`) and `boot`'s
  persistence note put that string on screen. Prisma's first lines sometimes carry the datasource
  host. `/api/health` gets this right and says why it does; the other routes should follow, with
  the detail going to the log stream instead.
- **The seed file is read and parsed on every page render.** `loadSeed` (`lib/data.ts:32-41`) is
  called unconditionally from `boot` (`:54`), reading and `JSON.parse`-ing roughly 346 KB across
  two files even when the database supplied the state. On App Service's network-backed filesystem
  this is not free, and it is trivially cacheable since the file cannot change without a
  redeploy. I have not measured the cost on App Service and would not assert a figure.
- **Intake loads the workspace three times per message.** `app/api/intake/route.ts:114` loads it
  outside any transaction, `persistActions` at `:153` loads it again inside one, and the follow-up
  at `:188` loads it a third time. Fine at this volume; worth knowing if intake is ever pointed at
  a busy mailbox.

---

## What is still unsettled

Most of what would have been open questions is answered by `infra/`, which is the benefit of
reviewing against a specified deployment rather than an imagined one. One process per instance
(`appCommandLine: 'npm run start'` on Linux), one instance, B1ms, thirty-five user connections.
What remains:

- **Whether Entra is configured on the deployment that goes live.** It decides how badly finding 1
  bites: with a provider, the eight-hour expiry makes the permanent halt a daily event; without
  one, it needs a genuine server failure or a deployment to trigger. The parameter file reads
  those values from the environment, so the answer is not in the repository.
- **Cold-start duration on B1.** Finding 1's retry budget is 7.5 seconds and the question is
  whether a restart fits inside it. Deploy and measure; that is the only way to know, and it is a
  single stopwatch reading against `/api/health`.

---

## Verdict

Not as it stands — but the gap is small and every piece of it is a contained change.

The core is in better shape than most applications at this stage: one reducer, replayed
server-side, with the read inside the write transaction. That is the hard part and it is right,
and the surrounding infrastructure work is unusually clear-eyed about its own limits. What has
not been done is the pass where laptop assumptions are repriced at cloud rates, and one finding
would cost a client real work rather than merely inconveniencing them: an autosave queue that
halts permanently, with nothing behind it, on every deployment and on every eight-hour session
expiry. On a Basic plan with no slots, that is not a tail risk — it is the deployment procedure.

The short list before this goes in front of a client on Azure: give the autosave queue a
`localStorage` outbox and a way back from `halted`, particularly on 401; cap the pools in
`client.ts` and give them a connection timeout, and correct `infra/app.bicep:230`, which
documents a mechanism that does nothing; flip the audit `orderBy` to `desc`; add jittered backoff
to the serialisation retry; guard the first-boot import with an advisory lock; and fix the
`isFirstEver` inversion in `diffObservations`. None of those is a redesign, and the first two are
the ones I would not ship without. Findings 5, 7 and 8 can follow without holding anything up.
