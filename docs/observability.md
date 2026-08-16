# Observability

What to look at when Axiomate is behaving oddly, and what "normal" looks like so that odd is
recognisable.

This document covers the operational question only: was the platform working. It is not the
place to find out what happened to a piece of work — see the first section for why those are
different questions with different answers in different stores.

The resources are declared in `infra/observability.bicep`: one Log Analytics workspace, one
workspace-based Application Insights component writing into it. The instance-level probe is
`app/api/health/route.ts`.

Two things have to be true before any query below returns anything, and both live on the App
Service resource rather than in this module. The first is a diagnostic setting sending
`AppServiceHTTPLogs` and `AppServiceConsoleLogs` to the workspace. The second is the Application
Insights agent extension, which is what populates `AppRequests` with request telemetry without
any SDK in the application. The queries here are written against `AppServiceHTTPLogs` because it
is the source that needs no agent; where `AppRequests` is available it carries the same
information with better fields, and every query translates directly — `CsUriStem` becomes `Url`,
`ScStatus` becomes `ResultCode`, `TimeTaken` becomes `DurationMs`.

If a query returns nothing at all, check those two settings before concluding the application is
quiet. Silence is a real signal in three of the four sections below, so it is worth being certain
which kind of silence is being read.

---

## The audit trail is not operational logging

Axiomate already keeps a detailed record of change: every mutation writes rows to
`ScheduleAudit` inside the same transaction as the change itself. It is tempting to treat that
as "the logs". It is not, and this codebase has already made the argument once, at the top of
`lib/events.ts`, about the third thing people call an audit trail:

> Conflating them produces a table with two retention policies and two audiences, which is the
> third of the three things this codebase found being called "audit".

The same line falls here, in the same place.

| | Audit trail | Operational logging |
| --- | --- | --- |
| Answers | Who changed this record, from what, to what, when | Was the platform working, and how well |
| Lives in | Postgres, `ScheduleAudit` | Log Analytics |
| Scope | One tenant | One deployment |
| Written | Inside the transaction it describes, so it cannot disagree with it | Outside any transaction; may be lost without affecting correctness |
| Kept for | As long as the record lives | `retentionInDays`, currently 90 |
| Audience | The delivery firm and its clients | Whoever operates the platform |
| If it is missing | Evidence is gone and cannot be reconstructed | An investigation is harder |

Retention is the tell. Anything whose correct answer to "how long do we keep this" is "as long
as the record exists" is evidence. Anything whose correct answer is "ninety days" is telemetry.
One store cannot honour both, and the attempt produces a table that is over-retained for one
audience and under-retained for the other.

Two rules follow, and both are about what not to do.

**Do not send audit content to Application Insights.** `ScheduleAudit` rows carry `from` and
`to` — the actual values of fields. That means client names, issue titles, note text and
people's names. Telemetry carries ids, counts, durations, status codes and error classes, and
nothing that identifies a client or a person. If a question cannot be answered without a
client's name in the telemetry, it is an audit question and Postgres is where to ask it.

One property that makes this easy is worth naming so it is not lost by accident: every API route
in this application is a static path — `/api/workspace`, `/api/intake`, `/api/schedule/run`,
`/api/health` — with no record identifier in the URL. Request telemetry therefore cannot leak a
record id through the URL, however it is collected. A future route that puts an issue id in its
path puts that id into the telemetry as well, and would need to be considered on that basis.

**Do not put operational facts in the audit trail.** "The database was slow" is not something
anybody did. Recording it as an audit row gives an operational observation the audit table's
retention, its tenant scope and its evidential weight, all of which are wrong for it. The
reducer derives audit rows from state changes for the same reason `deriveEvents` compares two
states rather than trusting arms to emit: a row that is true by construction cannot be
fabricated by an unrelated concern, and hand-written operational rows would be exactly that.

In practice: "who closed AX-114, and when" is a query against Postgres. "Why were saves failing
at 14:30" is a query against Log Analytics. Neither has a useful answer in the other store, and
the moment one of them does, both stores are wrong.

---

## What a normal day looks like

Axiomate is a working-hours application used by a small number of people, with two machine
callers on fixed rhythms. The shape below is what to expect; the numbers are what each
deployment must measure for itself in its first fortnight and write down, because "unusual"
without a baseline is just a hunch.

**Health probes.** App Service pings `/api/health` on every instance once a minute, every
minute, for ever. All of them return 200 with `database: "connected"`. These do not appear in
the web server logs — App Service sends them internally — so they will not show up in
`AppServiceHTTPLogs` and their absence there means nothing.

**Human editing.** `POST /api/workspace` arrives in bursts that follow people, not clocks:
clustered inside the working day, quiet at lunch, nothing overnight or at weekends. Batches
carry between one and fifty actions. Almost all return 200. A round trip is tens of
milliseconds plus database time, and the endpoint is not something the interface waits on — the
browser has already applied the change optimistically.

**The scheduled pass.** Exactly one `POST /api/schedule/run` per day, at whatever time the
firm's scheduler is set to, usually first thing. One request, one response, seconds rather than
minutes. It returns 200 with a summary.

**Intake.** `POST /api/intake` is as frequent as the firm forwards mail, so it is bursty and
irregular but never zero across a working day. Duplicates should be rare.

**Errors.** Near zero 5xx. A handful of 409s a week is unremarkable — that is a stale browser
tab disagreeing with stored state, which is the mechanism working.

Establish the baseline with this, and record the answers here:

```kusto
AppServiceHTTPLogs
| where TimeGenerated > ago(14d)
| where CsUriStem startswith "/api/"
| summarize
    calls = count(),
    errors = countif(ScStatus >= 500),
    p50 = percentile(TimeTaken, 50),
    p95 = percentile(TimeTaken, 95)
  by CsUriStem, bin(TimeGenerated, 1d)
| order by TimeGenerated desc
```

| Signal | Normal for this deployment |
| --- | --- |
| `POST /api/workspace` per working day | |
| p95 duration of `POST /api/workspace` | |
| `POST /api/intake` per working day | |
| Time of day the scheduled pass runs | |
| Duration of the scheduled pass | |

---

## Which signal tells you which thing is broken

Four moving parts fail in four distinguishable ways. Three of the four fail *silently*, which
is why this section is organised by component rather than by error.

### The browser write queue

`components/useAutosave.ts` keeps one request in flight at a time, drains actions in order in
batches of up to fifty, retries transient failures four times at 0.5, 1, 2 and 4 seconds, and
then **halts permanently for that page**. It also halts immediately and permanently on 400, 401
and 409, because replaying a rejected action would fail identically for ever.

That halt is the thing to understand, because it inverts the usual reading of an error graph.

- **A burst of two to four requests from one client, spaced 0.5, 1, 2 and 4 seconds apart, is
  the backoff ladder.** It exists only when the server was unreachable or returned 5xx. Seeing
  the pattern at all means somebody's work came close to not being saved, even if the last
  attempt succeeded.
- **After the fourth failure the browser goes quiet.** So a halted queue is not an error rate —
  it is a *drop* in `POST /api/workspace` during working hours, arriving a few minutes after a
  5xx spike. The error you can see happens before the silence you have to notice. If write
  volume falls off a cliff mid-afternoon and nobody has gone home, assume queues are halted and
  that every open tab is holding unsaved work behind a "Not saved" indicator.
- **401** means sessions are expiring or the Entra configuration changed. Every one halts a
  queue. It is recoverable by the user — signing in and reloading sends the work — but only if
  they read the message.
- **409** is the reducer disagreeing with stored state. A trickle is normal. A cluster against
  one tenant means stored state and browser state have genuinely diverged, and somebody is about
  to lose an afternoon.
- **413** means a client sent more than two hundred actions in one request. The client chunks at
  fifty, so this is a client bug rather than a busy user.
- **Rising p95 with no rise in errors is contention, not breakage.** `persistActions` runs under
  serializable isolation and retries conflicts up to three times, so a busy tenant shows up as
  slower saves rather than failed ones. It stops being benign when the p95 approaches the
  browser's own patience.

```kusto
AppServiceHTTPLogs
| where TimeGenerated > ago(1d)
| where CsUriStem == "/api/workspace" and CsMethod == "POST"
| summarize calls = count(), by_status = countif(ScStatus >= 400), p95 = percentile(TimeTaken, 95)
  by bin(TimeGenerated, 5m)
| render timechart
```

### The scheduled pass

Once a day, driven from outside the process — deliberately, because a timer inside a web server
stops when the process restarts and runs twice when there are two instances.

- **Its failure mode is silence.** A scheduler that stops firing raises nothing. There is no
  error to catch and no request to count. The only observable is absence, which is why the alert
  below is on absence rather than on failure.
- **A 200 does not mean the pass did everything.** The response carries `misses` (rules that
  reached nobody) and `refusals` (actions the reducer declined). Both are reported rather than
  swallowed precisely so somebody can look at them, and both come back inside a successful
  response. Never judge this endpoint by its status code alone.
- **Duration is a load signal for everyone else.** The entire pass is one serializable
  transaction across the tenant's whole workspace. A pass that starts taking minutes is holding
  a transaction that every user write must serialise against, so a slow pass presents to users
  as slow saves.
- **401** means the schedule token was rotated on one side only. **503** means the deployment
  has no database, which for a hosted instance is a configuration fault, not a mode.

### Intake

Called by something outside the application — a forwarding rule, a Graph subscription, a
webhook. Nothing here polls a mailbox, so the connector's health is not visible from inside.

- **Its failure mode is also silence, for a different reason.** The connector is somebody else's
  component. If it stops, or its mailbox rule is disabled, or its credential expires, this
  application sees nothing whatsoever. Work stops arriving and the first symptom is a person
  asking where an email went, days later.
- **401** means the connector's bearer token no longer matches `AXIOMATE_INTAKE_TOKEN`. This is
  the common one after a secret rotation, and it is total: every message is refused.
- **503** means intake is closed because no token is configured, or that there is no database. On
  a deployment that was working yesterday, either reads as a lost app setting.
- **422** is `classify` refusing: the routing rules did not match the mailbox the message was
  sent to. That is business configuration, not an outage. Review it weekly; do not page for it.
- **400** means the connector is sending malformed messages, usually after a change at its end.
- **A rising duplicate rate is invisible in status codes.** A repeated `messageId` is answered
  with 200 and `duplicate: true`, because the caller did nothing wrong. A connector stuck in a
  retry loop therefore looks like healthy traffic. The tell is intake 200s climbing while the
  number of issues created does not.

### The audit trail

Every mutation writes audit rows in the same transaction as the change. That makes the audit
trail a poor source of operational signal and a good source of exactly one:

- **`persistActions` returns `audited`, the number of rows written.** A 200 response reporting
  `audited: 0` for a batch of real changes means the reducer accepted actions that recorded
  nothing. The change is saved, the evidence is not, and nothing else in the system will
  complain. This is the only case where an operational alarm should be raised from the audit
  trail, and it is raised on the count, never on the content.

Everything else the audit trail contains is business evidence and is not an operational signal.
Reaching for it to answer an operational question is the mistake the first section describes.

### The instance itself

`/api/health` returns one of three values for `database`, and each maps to exactly one action.

| Response | Status | What it means | What to do |
| --- | --- | --- | --- |
| `connected` | 200 | This instance can reach its database | Nothing |
| `not configured` | 200 | `DATABASE_URL` is unset; the app is running from the seed file and saving into people's browsers | On a hosted deployment, restore the app setting immediately; work is being lost right now |
| `unreachable` | 503 | Configured but not answering within two seconds | Look at the database, not at the app |

`not configured` returning 200 is deliberate: running without a database is a supported mode of
this application and evicting instances for behaving as designed would be wrong. On this
deployment it should never occur, which is what the alert below is for. The reasoning is in the
route file.

What the probe does not notice is also in that file, and matters here: it does not detect schema
drift, it does not detect a reducer that rejects everything, and it says nothing about the three
components above. An all-green health check is not a working application.

---

## What to alert on

Four rules. Each is here because it detects something that nothing else detects, and because
there is an action attached to it at the moment it fires.

**1. Any instance reporting `database: unreachable`.**
Alert on the App Service `HealthCheckStatus` metric falling below 100. This is the signal that
names the cause — "this instance cannot reach its database" — and it is the one to act on.

It is not, however, the early one, and it is worth being exact about that rather than assuming
the health check is a tripwire. `HealthCheckStatus` only registers a failure once the instance
crosses the health check load balancing threshold, which defaults to ten minutes, so it takes
roughly ten consecutive failed pings to move. The browser's write queue gives up in about seven
and a half seconds — 0.5, 1, 2 and 4 — and then halts permanently. By the time this alert fires,
every open queue has been dead for several minutes. Rule 3 is the fast signal; this one arrives
later and tells you why.

The lag is configurable and should be configured. `WEBSITE_HEALTHCHECK_MAXPINGFAILURES` goes down
to 2, which brings the metric to roughly two minutes at the cost of a twitchier eviction policy.
For anything faster than that the health path has to be polled from outside — health check pings
are sent internally by App Service and appear in neither the web server logs nor request
telemetry, so there is no way to alert on them from inside the workspace. An availability test
against `/api/health` is the tool for that, and it is a separate thing from the platform's own
check.

Note also that App Service will not remove instances when they are all unhealthy, so a
fleet-wide database outage produces this alert and no automatic mitigation whatsoever. The alert
is the mitigation.

**2. `/api/schedule/run` has not returned 200 in the last 26 hours.**
The pass is the only part of the system that produces work nobody asked for: overdue notices,
at-risk flags, stale-work detection. When the scheduler stops, none of that happens and nothing
anywhere reports an error, so this alert is the only thing standing between a broken cron and a
month of silently unraised issues. Twenty-six hours rather than twenty-four so that a clock
change or a slow morning does not page anyone. Alert on absence, not on failure.

```kusto
AppServiceHTTPLogs
| where TimeGenerated > ago(26h)
| where CsUriStem == "/api/schedule/run" and ScStatus == 200
| count
```

**3. 5xx on `POST /api/workspace` above one per cent over fifteen minutes.**
Every one of these is a change somebody made that did not save. The threshold is low because the
consequence is not a slow page but silent data loss: four of them in a row against the same
browser halts that queue permanently, and the user's only warning is a small indicator. Fifteen
minutes rather than five because the client's own retry ladder already absorbs a restart, and a
sustained rate is what distinguishes a deployment from a fault.

This is the earliest warning of a database problem, several minutes ahead of rule 1, because it
is driven by real user requests that are logged the moment they fail rather than by a platform
metric with a ten-minute threshold behind it. When rules 1 and 3 both fire, 3 fired first and 1
explains it.

**4. No successful `POST /api/intake` during a working day, or any 401 on it.**
Two conditions in one rule because they are the same failure seen from two angles: work that
should be arriving from outside has stopped. The 401 arm fires within minutes of a token
rotation and is unambiguous. The silence arm is slower and noisier — it needs the baseline from
the table above to set a sensible window — but it is the only thing that catches a connector
that has simply been switched off, which produces no traffic and therefore no errors. Alert
during business hours only; overnight silence is normal.

**And one that is not a rate.** `database: "not configured"` on this deployment should fire the
first time it is ever seen. It is a single boolean, it means every person's work is going into
their own browser and nowhere else, and every screen in the application is politely reporting
that things are fine because, in that mode, they are.

Deliberately not alerted on: 409s and 422s. Both are the system correctly refusing something,
both are business-shaped rather than operational, and both would train whoever carries the pager
to ignore the channel. Review them on a weekly cadence instead.

---

## Triage order

1. `/api/health` on the site. It is three values and it takes five seconds, and it separates
   "the platform is broken" from "one thing on the platform is broken".
2. Write volume on `POST /api/workspace` over the last few hours, against the baseline. A cliff
   means halted queues and unsaved work in open tabs, which is the only failure here that
   destroys something.
3. The status mix on the two machine endpoints. Both fail silently, so check that they ran at
   all before checking whether they ran well.
4. `AppServiceConsoleLogs` for the window. The health probe writes one line per failed probe
   there, carrying a sanitised description and the error code — that is where the detail
   deliberately kept out of the health response ends up. Expect roughly one line per minute per
   instance for as long as the fault lasts, since the probe is cached for ten seconds and the
   platform pings once a minute. That is a trickle rather than a flood, but it is worth knowing
   that the health endpoint is itself a source of ingestion, and that a long outage across a
   scaled-out plan writes to the workspace it is being diagnosed in.
5. Postgres, if steps one to four point at it. Everything above this line describes symptoms of
   a database that is slow, full, failing over, or out of connections; none of it can tell them
   apart.
