# Runtime notes: Axiomate on Azure App Service

What changes when this application stops being one process on one laptop talking to a local
Postgres, and becomes one or more App Service instances talking to a managed one.

These are findings, not fixes. Nothing outside this file has been changed. Every claim below
names the file and line it rests on, and where a number is quoted it was measured or read from
a primary source rather than recalled.

---

## The shape underneath most of it

Four of the findings are the same design decision seen from different angles, so it is worth
stating once.

`loadWorkspace` (`lib/db/repo.ts:109`) reconstructs the entire `WorkspaceState` — nineteen
`findMany` calls, none of them bounded except the audit trail — and that function is the load
path for a page render, for the permission check on the schedule endpoint, for intake, and,
critically, for **every write**, from inside the write's own Serializable transaction
(`lib/db/persist.ts:104-107`).

On a laptop that is free. The workspace is small, the round trip is a fraction of a
millisecond, and one process means no contention. On Azure each of those three assumptions
weakens: the round trip becomes milliseconds, the pool is finite, and there is more than one
writer. The design itself is defensible — reading inside the transaction is what stops
last-write-wins, and the comment at `persist.ts:96-103` is right about why — but its costs are
all denominated in things that were free locally.

---

## Findings, ranked

### 1. The autosave queue halts permanently, and there is no mirror behind it

**What it is.** `halted` (`components/useAutosave.ts:45`) is set in four places — a disabled
server (`:81`), a 401 (`:105`), a 409 or 400 (`:119`), and exhausted retries (`:136`) — and is
never cleared anywhere in the file. Once set, `enqueueAll` returns before touching the queue
(`:160`), so the user carries on editing, the reducer carries on accepting, and nothing further
is even queued for saving. The only signal is the status text, which reads "Not saved".

**Why the 401 path matters more than the 5xx one.** `SESSION_SECONDS` is eight hours
(`lib/auth/cookie.ts:16`), and the cookie is set with a matching `Max-Age`. A consultant who
signs in at nine and is still in the same tab at five gets a 401 on their next edit. That is
not an edge case; on a deployment with Entra configured it is a daily event, and it is the
single most likely way this application loses somebody's work.

**Why there is no safety net.** With a database configured the browser mirror is deliberately
switched off — `IssueWorkspace.tsx:350` returns early when `persistence.enabled` is true, and
`lib/autosave.ts` explains the reasoning (two stores that can disagree is worse than one). That
reasoning is sound for a *store*. It is wrong for an *outbox*: the pending queue lives in a
`useRef` and exists nowhere else, so it does not survive a reload, a crash, or a closed tab.

**What the user experiences.** The status text says "Not saved" and the detail, from
`describeSaveDetail`, says "Reload to resync with the server." Following that instruction is
what destroys the work: the reload discards the queue. The `beforeunload` prompt at
`useAutosave.ts:198-207` is the only thing standing between the user and the loss, and it is a
browser confirmation dialog with no explanation attached.

**Now trace a cold start, since that is the question that prompted this.** An App Service
instance recycles mid-drain. The in-flight `fetch` rejects, `attempt` becomes 1, and the queue
retries on the 0.5s / 1s / 2s / 4s schedule at `:26`. Four attempts spend roughly 7.5 seconds
in total. If the replacement instance is still cold — Next booting, `PrismaClient`
constructing, the pool opening its first connection — the queue halts and never resumes. A 5xx
therefore buys about seven and a half seconds of grace; a 401 buys none.

**Likelihood at this firm.** Near certain within the first fortnight, via the eight-hour
session expiry alone.

**What would fix it.** Three changes, in order of value. Keep the queue in `localStorage` as an
outbox regardless of whether the database is on, and re-drain it on load — a queue of pending
actions is not a competing store of record. Make 401 recoverable: keep the queue, show a sign-in
affordance, and clear `halted` when the user comes back. Give every halt a manual "Try again"
that resets `halted` and calls `drain()`, so a transient server problem does not require a
reload that loses work.

---

### 2. Two connection pools per instance, twenty connections, and a Burstable ceiling of thirty-five

**The number.** Up to **20 Postgres connections per App Service instance**, from two
independent pools of 10.

**Evidence, because this one is counter-intuitive.** `lib/db/client.ts` is careful: it caches
the client on `globalThis` in development and in a module-scope `cached` in production
(`:30-36`), which is the correct idiom and would give one client per process. The production
build defeats it. In `.next/server`, `lib/db/client.ts` appears in three chunks, and the module
identifiers are what matter:

| Chunk | Module id | Runtime it loads under | Loaded by |
| --- | --- | --- | --- |
| `chunks/_09x75xo._.js` | `90793` | `chunks/[turbopack]_runtime.js` | `api/workspace`, `api/intake` |
| `chunks/_0h56cpk._.js` | `90793` | `chunks/[turbopack]_runtime.js` | `api/schedule/run` |
| `chunks/ssr/_0d565kg._.js` | `84476` | `chunks/ssr/[turbopack]_runtime.js` | `app/page` |

The first two share both a module id and a runtime, so Turbopack's module cache instantiates
them once — the API routes genuinely do share a client. The page render does not: it loads a
different module id under a *different runtime file*, which Node's require cache treats as a
separate module entirely. So one process holds two `PrismaClient`s and therefore two
`pg.Pool`s.

`PrismaPg` passes its config straight to `new pg.Pool(...)`
(`node_modules/@prisma/adapter-pg/dist/index.mjs:749`), and only a connection string is supplied
(`lib/db/client.ts:24`), so every pool default applies: `max: 10`
(`node_modules/pg/lib/defaults.js:42`), `idleTimeoutMillis: 30000` (`:46`), and
`connectionTimeoutMillis` unset, which `pg-pool/index.js:206` treats as "wait forever".

Twenty is a ceiling rather than a steady state — pools open lazily and reap after thirty
seconds idle — but it is reached easily, because `loadWorkspace` fires its nineteen queries
through `Promise.all` (`repo.ts:116-138`). A single page render takes the SSR pool from zero to
ten in one go.

**What Azure allows.** From the Azure Database for PostgreSQL flexible server limits, fifteen
connections are reserved for replication and monitoring, so:

| Product | vCores | Memory | max_connections | Max **user** connections |
| --- | --- | --- | --- | --- |
| B1ms | 1 | 2 GiB | 50 | **35** |
| B2s | 2 | 4 GiB | 429 | 414 |

Source: <https://learn.microsoft.com/azure/postgresql/configure-maintain/concepts-limits#maximum-connections>

**The arithmetic.** One instance against B1ms is 20 of 35 — tight but workable. **Two instances
is up to 40 against a ceiling of 35, and does not fit.** Three does not come close. Note that a
deployment-slot swap or a scale-out briefly runs old and new instances together, so "two
instances" happens on a single-instance plan too. From B2s upward the ceiling is 414 and this
stops being a problem entirely, which makes B1ms specifically the dangerous choice.

**Two different symptoms, and they should not be confused.** Exceeding the *server's* limit
produces `FATAL: sorry, too many clients already` on the query. On the page-render path that
propagates into `boot`'s catch (`lib/db/boot.ts:106`), and the user is served a fully working
application that quietly says "Running from the issue log. Changes are not being saved." —
they keep working and nothing is stored. Exhausting a *pool* while the server still has room is
different: with `connectionTimeoutMillis` unset the request waits in the pool queue
indefinitely, so the symptom is a page that never finishes loading rather than an error.

**Likelihood at this firm.** High if the plan is scaled beyond one instance or the database is
B1ms; low otherwise. This is the finding most likely to bite on the day someone ticks
"scale out" without touching the code.

**What would fix it.** `PrismaPg` accepts a full `pg` pool config, so
`new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 })`
caps each pool and converts an indefinite hang into a reportable error. Five per pool gives ten
per instance and four instances inside a B1ms ceiling. Provision B2s or better if there is any
intention to scale out. Separately, it is worth deciding whether the page render should hold a
pool at all, or whether it should fetch its state from the same API layer the writes use.

---

### 3. Serializable transactions that read everything, retried without backoff

**What it is.** `runBatch` opens a Serializable transaction and then calls `loadWorkspace`
inside it (`persist.ts:104-107`), reading every row of nineteen tables before the first write.
Postgres tracks predicate locks over what a Serializable transaction reads; unbounded reads
mean relation-wide coverage. Two overlapping batches therefore each read what the other wrote,
which is the rw-antidependency cycle SSI exists to detect, and one of them is aborted.

I would not say *guaranteed* — Postgres aborts on cycles it detects, and favourable commit
ordering spares some pairs — but it is highly likely, and the likelihood rises with the length
of the transaction. Which brings in the second half: a Prisma interactive transaction pins one
connection, so the `Promise.all` in `loadWorkspace` **cannot** parallelise when `tx` is the
reader. Those nineteen queries are nineteen sequential round trips. On a laptop that is under a
millisecond of latency; against a managed Postgres in the same region it is several
milliseconds each, before the rows are counted. The contention window is that whole span plus
the writes.

**The retry is thinner than it looks.** `MAX_SERIALIZATION_RETRIES = 3` (`persist.ts:89`) gives
four attempts, and the loop at `:74-81` has **no backoff and no jitter** — the retry is
immediate. All four attempts therefore land inside the same contention window that caused the
first failure. The detection itself is sound: `isSerializationFailure` (`:84-87`) checks both
Prisma's `P2034` and the raw `40001` text, which is the right belt-and-braces for a driver
adapter.

**What a user sees today.** Usually nothing. Exhausting the retries throws, the route returns
500 (`app/api/workspace/route.ts:136`), and the browser retries with backoff — so a single
serialisation storm is normally absorbed. What it costs is the browser's retry budget, and when
that runs out the queue halts permanently, which is finding 1. The user-visible failure is
therefore "Not saved" with a Postgres serialisation message beside it, and silently unsaved
work afterwards.

**Likelihood at this firm.** Low on one instance with a few consultants: edits arrive seconds
apart and the queue is serial per browser, so genuine overlap needs two people editing in the
same second. It becomes routine at two instances, and it becomes routine at one instance the
moment the scheduled pass runs while somebody is working — the pass holds a Serializable
transaction over the same full read for its entire duration.

**What would fix it.** In order: shrink what the transaction reads. The audit trail in
particular is read inside every write transaction purely so that `newAudit` can be computed as
a suffix slice (`persist.ts:141`) — a `count` would serve, and dropping five thousand rows from
every write's read window removes both the largest cost and a large share of the predicate
coverage. Then add jittered exponential backoff to the retry and raise the attempt count;
retrying immediately against a conflict is close to not retrying.

---

### 4. The audit trail is capped at its **oldest** five thousand rows, and two features read it for behaviour

**What it is.** `repo.ts:135` reads `orderBy: { at: 'asc' }, take: 5000`. Ascending with a
limit takes the five thousand *earliest* entries, not the latest. The comment beside it —
"Newest last, so the History tab's own ordering is applied to a stable list" — describes the
ordering correctly and the truncation backwards.

**Why this is not merely a History-tab problem.** Two places derive behaviour from
`state.audit`:

- `lib/reports/dailyIms.ts:122-124` filters the trail to the last twenty-four hours to report
  what moved. Once a tenant passes five thousand audit rows, `state.audit` contains only
  entries from the workspace's earliest days, every one of them outside the window. The daily
  IMS report then reports zero status changes, zero notes, zero issues raised — every day,
  correctly formatted, silently wrong. This is a client-facing report.
- `lib/workspace.ts:1362-1371` restores a reparenting archive by matching `parent` audit
  entries carrying the archive's timestamp. The comment at `:1357` anticipates entries "aged
  out of the capped trail" and accepts the degradation — but it assumes the *oldest* age out.
  Under `asc` truncation the missing entries are the newest, which is to say the recent
  archives, which is to say precisely the ones somebody is likely to restore.

**Likelihood at this firm.** Certain, on a timescale of months. A few thousand records at a
handful of audited edits each reaches five thousand rows without anything unusual happening.
The seeded log alone imports its own trail on first boot.

**What would fix it.** `orderBy: { at: 'desc' }, take: 5000` and reverse the array — a two-line
change that makes both features correct again. The better answer is that the trail should not
be in `loadWorkspace` at all: it is the only unbounded collection in the state, it is shipped
into the RSC payload on every page render, and it is read into every write transaction. The
screens that need it could query it directly.

---

### 5. Tab switching mid-save can duplicate a note or a time entry, and can drop queued work

**What it is.** The `pagehide` / `visibilitychange` handler (`useAutosave.ts:177-195`) sends the
queue by `sendBeacon`, which is the right transport for an unload. Two problems with how it is
used.

First, it fires on `visibilitychange` to `hidden` (`:186-188`), which is not only unload — it is
every tab switch and every minimise. Second, it does not check whether a drain is in flight.
So: a consultant with a request in flight switches tab, the beacon sends the same batch a second
time, and the server replays it. For a patch-shaped action that is harmless. For `addNote`,
`addTime` or `create` it is not — the reducer mints a fresh id from `seq` each time, so both
copies persist and the user finds a duplicated note.

Third, and separately: `:179` sends `queue.current.slice(0, MAX_BATCH)` — fifty — and `:184`
then clears the **whole** queue on success. Anything beyond the fiftieth queued action is
discarded without being sent.

**Likelihood at this firm.** The duplication needs a tab switch inside the few hundred
milliseconds a request is in flight. Over months of daily use by several consultants, it will
happen; whether anybody attributes the duplicate note to the right cause is another matter. The
truncation needs more than fifty actions queued at once, which happens after an assistant
proposal or a multi-select edit.

**What would fix it.** Skip the beacon while `draining.current` is true, or make the drain
cancel-aware. Restrict the flush to `pagehide` rather than every visibility change. And drop
only what was actually sent: `queue.current = queue.current.slice(sentCount)`.

---

### 6. First boot with two instances can leave one of them permanently unseeded

**What it is.** `boot()` calls `importWorkspace` on every page render (`boot.ts:85`; the page is
`force-dynamic`). The guard against re-importing is a `findUnique` on `seededAt` at
`repo.ts:260-267`, which is read **outside** the `$transaction` that begins at `:272` — and
that transaction specifies no isolation level, so it runs at Read Committed.

The import writes with `create`, not `upsert` (`:282`, `:287`, and throughout), against
`@@id([tenantId, id])` (`prisma/schema.prisma:186`) using ids the seed constructs, such as
`company:root`. Two instances rendering their first page against an empty database both pass
the guard, and the loser takes a duplicate-key violation. `boot`'s catch (`boot.ts:106`) turns
that into "Running from the issue log. Changes are not being saved." with the raw Postgres
message shown beside it.

The window is not narrow. The import writes on the order of a thousand rows one `create` at a
time — the seed carries 258 issues plus nodes, notes, evidence and the rest — and it is given a
120-second timeout (`repo.ts:363`) for good reason. At a few milliseconds per round trip that is
several seconds wide.

**Likelihood at this firm.** Only ever on the first deploy against an empty database — which is
exactly the occasion on which two instances are most likely to start together, and the occasion
on which nobody yet knows what "working" looks like.

**What would fix it.** Take a transaction-scoped advisory lock on the tenant and re-check
`seededAt` inside the transaction, so the loser sees the winner's work and returns "already
seeded" rather than colliding. Separately, `importWorkspace` should not run on every page
render for the life of the deployment; it is a provisioning step, and it currently costs a
query per page load forever.

---

### 7. The first scheduled run raises everything it should be seeding

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
accumulated staleness is how a firm switches the mechanism off again.

**Verified rather than argued.** Running `diffObservations` against `EMPTY_OBSERVATION` with two
findings returns `onset: 2, seeded: 0`. The same two findings against a previous observation
that was watching a different condition return `onset: 0, seeded: 2`. The newly-ticked-condition
path behaves as documented; the first-run path does not.

**How big it would be, measured against the shipped log.** `initWorkspace` over
`data/issues.seed.json` plus `data/axiomate.internal.json` gives 258 issues. `observe` finds 86
breaching conditions today and 158 at steady state, all of them `stale`. The shipped operating
model has four enabled automation rules — on `issue.created`, `issue.overdue`,
`sow.overConsumed` and `issue.owner` — and **none on `issue.stale`**, so `runWatch` currently
plans zero actions and the first run writes nothing at all. I confirmed that end to end: 86
onsets, 0 steps, 0 notifications, 0 audit rows.

So this is not a scale problem at this firm. It is a correctness problem waiting for a
configuration change: add a rule on `issue.stale`, or simply start populating due dates so that
findings become `overdue` — for which `AUTO_OVERDUE` is enabled by default — and the first run
raises up to 158 notifications in a single transaction.

**What would fix it.** `} else if (isFirstEver || !wasWatching.has(finding.condition)) {`. One
operator.

---

### 8. The scheduled pass's thirty-second budget

**Where the ceiling actually is.** `runScheduledPass` (`lib/db/schedule.ts:42-111`) is
Serializable with a 30-second timeout. Inside it: one `loadWorkspace` — nineteen sequential
round trips, because `tx` pins a connection — then one `persistSteps` call per step, each its
own upsert, sequentially, then a `createMany` for the audit and one upsert for the observation.

At today's size that is comfortably under a second of round-trip time. The budget starts to
matter in the low thousands of steps: at five milliseconds per round trip, two thousand
sequential upserts is about ten seconds before any query cost, and the full read in front of it
grows at the same time. Call it a workspace an order of magnitude larger than today's, or a
first run of the kind finding 7 describes on a workspace that has accumulated a few years of
overdue issues.

**What it would look like when it happens.** Prisma aborts the transaction, so *nothing* is
committed — including `scheduleWatch`, which holds the memory of what has already been raised.
The next run therefore starts from the same observation, finds the same work, and fails
identically. A scheduled pass that has stopped working and a scheduled pass that has nothing to
do are indistinguishable from the outside, because the failure is a 500 body that only whatever
invokes the endpoint ever sees. The number to watch is `raised` in the response.

**Likelihood at this firm.** Low. A few consultants and a few thousand records will not
approach it. Worth writing down because the failure is silent and self-perpetuating rather than
noisy.

**What would fix it, if it ever needs fixing.** Batch the notification writes rather than
issuing one upsert per step, and consider committing the observation separately from the
messages — accepting a re-raise after a crash is a better failure than a pass that can never
complete. Neither is worth doing today.

---

## Things that are fine, and what was checked to establish that

A review that finds a problem everywhere it looks is not being careful. These were examined and
are correct as they stand.

**Nothing in the server assumes one process, with two exceptions that turn out to be safe.**
The search was `grep -rn "^let |^var |new Map|new Set|globalThis" lib/ app/` across every `.ts`
and `.tsx`, which returns eight hits, six of them frozen constants.

- `lib/workspace.ts:671` — `let auditSeq = 0`, a per-process counter that mints audit ids like
  `aud-3-OAPIL-010`. This looks exactly like a multi-instance collision: two instances both
  start at zero. It is not one, because `auditToRow` (`lib/db/map.ts:443-454`) deliberately does
  not copy `a.id`, and `ScheduleAudit.id` is `@default(cuid())`
  (`prisma/schema.prisma:865`) with a comment naming this precise hazard. The in-memory id never
  reaches the database. Checked and clean.
- `lib/auth/entra.ts:159` — `jwksCache`, a per-tenant JWKS holder. Per-instance caching of a
  public key set is correct; each instance fetches once and both agree, because the keys come
  from Microsoft.

**Sign-in works across instances, and needs no session affinity.** The three values that have to
survive the OAuth round trip — state, nonce and the PKCE verifier — go into short-lived HttpOnly
cookies (`app/api/auth/signin/route.ts:41-44`) rather than a server-side store, and the callback
reads them back from the request (`app/api/auth/callback/route.ts:45-50`). The session itself is
a signed cookie verified against `AXIOMATE_SESSION_SECRET`, an app setting every instance shares.
A sign-in that starts on instance A and returns to instance B completes normally. ARR affinity
can be left off.

**There is no in-process scheduler, and that was the right call.** The pass is an endpoint
(`app/api/schedule/run/route.ts`), and the comment at `:10-21` gives exactly the reasons that
matter here: a `setInterval` stops when the instance recycles and runs twice when there are two
of them. Two overlapping invocations are sorted out by the Serializable transaction rather than
by hoping.

**Id minting survives restarts and multiple instances.** `WorkspaceState.seq` is read inside the
write transaction and written back in the same one (`persist.ts:151-157`), so nothing depends on
process identity or on a counter that resets.

**Tenant scoping holds on every query.** All nineteen reads in `loadWorkspace` name `tenantId`
explicitly, written out rather than hoisted, and `TenantId` is branded so an arbitrary string
cannot reach a repository function. Nothing here changes on Azure.

---

## Smaller notes

- **Raw database errors reach the browser.** `describeDbError` (`lib/db/client.ts:58-70`) falls
  through to `msg.split('\n')[0]`, and both the write route (`route.ts:136`) and `boot`'s
  persistence note put that string on screen. Prisma's first lines sometimes carry the
  datasource host. Worth a generic message in production with the detail going to the log.
- **The seed file is read and parsed on every page render.** `loadSeed` (`lib/data.ts:32-41`) is
  called unconditionally from `boot` (`:54`), reading and `JSON.parse`-ing roughly 346 KB across
  two files even when the database supplied the state. On App Service's network-backed
  filesystem this is not free. It is trivially cacheable, since the file cannot change without a
  redeploy. I have not measured the cost on App Service and would not assert a figure.
- **Intake loads the workspace three times per message.** `app/api/intake/route.ts:104` loads it
  outside any transaction, then `persistActions` at `:143` loads it again inside one, and the
  follow-up at `:178` loads it a third time. Fine at this volume; worth knowing if intake is ever
  pointed at a busy mailbox.

---

## Open questions, and what would settle each

- **How many Node processes does one App Service instance run?** `next start` is one, and the
  connection arithmetic above assumes that. A Windows plan behind iisnode, or a custom startup
  command with a process manager, multiplies the pool count by the process count. The site's OS
  and startup command settle it in one look.
- **Which Burstable product is the database?** The difference between B1ms and B2s is 35 user
  connections versus 414, and it decides whether finding 2 is a blocker or a note. `SHOW
  max_connections;` settles it.
- **Is Entra actually configured on the target deployment?** It changes the ranking of finding 1
  substantially: with a provider, the eight-hour expiry makes the permanent halt a daily event;
  without one, the halt needs a genuine server failure to trigger.

---

## Verdict

Not as it stands — but the gap is small and each piece of it is a contained change.

The application's core is in better shape than most at this stage: one reducer, replayed
server-side, with the read inside the write transaction. That is the hard part and it is right.
What has not been done is the pass where laptop assumptions get priced at cloud rates, and two
of the findings above would cost a client real work rather than merely inconveniencing them —
the queue that halts with nothing behind it, and the connection ceiling on a Burstable server.

The short list before this goes in front of a client on Azure: cap the pools and give them a
connection timeout; give the autosave queue an outbox in `localStorage` and a way back from
`halted`, particularly on 401; flip the audit `orderBy` to `desc`; add jittered backoff to the
serialisation retry; guard the first-boot import with an advisory lock; and fix the `isFirstEver`
inversion in `diffObservations`. None of those is a redesign. Findings 5, 7 and 8 can follow
afterwards without holding anything up.
