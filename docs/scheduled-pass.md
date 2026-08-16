# The scheduled pass

This page is for whoever operates Axiomate. It assumes you were not in the room when any of it
was built.

## What the pass is for

Axiomate's automation reacts to what people do. It compares the workspace before an action with
the workspace after, which covers every change somebody makes and nothing that time does. An
issue going past its due date, a warning window closing, a statement of work running out of
hours — none of those are changes anybody made. They are yesterday's facts read against today's
date, and there is no action to hang them on.

The scheduled pass is the other half. Once a day it looks at the workspace, writes down the
temporal conditions that are true, compares that with what it wrote down last time, and turns
the differences into ordinary events. From there nothing is special: the same automation rules
react to `issue.overdue` as react to somebody clicking a button, and the resulting changes go
through the same reducer with the same permission check.

It looks for six conditions:

| Condition | Meaning |
| --- | --- |
| Past its due date | The issue is overdue. |
| At risk of missing its date | Due soon and not far enough along. |
| Due within the warning window | Inside the configured number of working days before the date. |
| Nothing has happened on it for too long | No recorded activity for the configured number of working days. |
| Planned work exceeds the people committed to it | A project's estimates do not fit its allocations. |
| More effort spent than was contracted | A statement of work is over-consumed. |

Which of them are watched, how many days count as stale, and how far ahead to warn, are all set
on **Configuration → Scheduled pass**. So is the switch that stops the pass altogether.

**It reports a condition once.** An issue that has been overdue for six weeks is counted, not
announced every morning. A condition that clears and comes back *is* announced again, because a
date somebody moved and then missed is a different fact from the first miss. This is the whole
reason the pass keeps a memory, and it is why the answers below come out the way they do.

## The first run against a workspace that already has history

This is the part that surprises firms, so it is worth being blunt about.

The pass raises a condition when it was not true at the previous run. On the very first run
there is no previous run, so **everything true is new**. A workspace that has been in use for six
months, switched on for the first time, will raise every overdue issue, every stale issue, every
over-consumed statement of work, all at seven in the morning, all at once.

Two clarifications, because both cut against the obvious guess about how bad this is.

**How much actually arrives is not the number of conditions.** The right-hand column on the
Scheduled pass configuration screen shows how many records each condition is true of right now —
that is the finding count. What people receive is one message per rule per person the rule's
audience resolves to. A single overdue issue can produce nothing at all if no rule subscribes to
`issue.overdue`, or several messages if two rules do and each is addressed to a role three
people hold. The configuration screen says as much next to the column.

**Nothing leaves the building.** A notification in Axiomate is a record with a delivery state.
In-app messages are delivered the moment they are written, because the inbox is the delivery.
Email and Teams messages are written as `pending` and stay pending, with a note saying that no
transport is configured — this deployment has none. So the first run fills inboxes inside the
application. It does not send anybody a hundred emails.

What it *does* do, beyond notifying, is worth knowing: rules can also set a next action, add a
note, or raise an approval request. Those change records. The run summary counts messages only,
so "4 messages raised" is a floor on what changed, not the whole of it. The audit trail has the
rest, attributed to **Scheduled pass**.

### What to do about it

Run the pass by hand once, against real data, before you point a scheduler at it. That first run
raises everything, you deal with it at a time of your choosing, and it writes the memory. Every
run after that raises only what is new.

The order matters, because a Consumption recurrence with no start time fires the moment it is
deployed, whatever the schedule says — which would hand you the flood as a side effect of a
deployment, at a moment nobody chose. `infra/schedule.bicep` therefore always sets an explicit
start time, so that the first automated run lands at the next scheduled hour rather than at
deployment.

If you have not yet seeded the memory, do not rely on that alone: set the `firstRunNotBefore`
parameter to a date after you intend to do the manual run. A start time in the future is the
documented way to say when the first run may happen, and it costs nothing to be certain.

### Ticking a condition on later behaves the opposite way

This trips people who have read the paragraphs above and generalised from them. Switching on a
condition that was not previously being watched does **not** raise everything at once. The pass
records what it was watching alongside what it found, so a newly watched condition's findings
are recorded on the next run and raised only from the run after. The run summary says so —
"…newly watched, recorded not raised".

The reasoning is the same one that makes the first-run flood worth avoiding: announcing six
months of accumulated staleness the moment somebody ticks a box is how a firm turns the whole
mechanism off again. The first run is the one case where that treatment is not possible, because
there is nothing to compare against.

## Is it safe if the scheduler fires twice in one day?

Yes, and for two separate reasons depending on how the two runs overlap.

**If they overlap**, they serialise. A run is a single Serializable transaction that reads the
workspace, writes the messages, and writes its own memory of having written them. Postgres makes
the second run wait and then see the first one's committed work — including the memory. There is
no window in which two runs each read the same memory and each decide the same issue has just
gone overdue.

**If they do not overlap**, the second run finds every condition already recorded in the first
run's observation. Each one is counted as continuing rather than raised, the onset list comes out
empty, and nobody is told anything. The second run's summary will read something like
"0 new · 14 continuing · 0 cleared · 0 messages raised", which is what a second run should look
like.

One caveat, since it will eventually happen and looks alarming. Two genuinely concurrent
Serializable transactions can be aborted by Postgres rather than made to wait. The endpoint
turns that into a 500 and the Logic App records a failed run. Nothing was double-raised and
nothing was half-applied — the run is one transaction — but you will see a red row and get an
alert. Re-run it by hand, or leave it; tomorrow's run picks up whatever the failed one would
have raised.

There is one real difference between running once and running twice, and it is intended.
Conditions that cleared between the two runs are forgotten by the second, so if they come back
next month they are news again.

## What happens if it does not fire for a week?

You get **one catch-up run, not seven**. The pass has no concept of the runs it missed; it
compares today's conditions against the last observation it stored, whenever that was. Everything
that became true during the gap and is still true is raised exactly once. Nothing is duplicated,
and no backlog accumulates.

What is lost is narrower and worth understanding, because it is structural rather than a bug: a
condition that appeared **and cleared** inside the gap is never raised at all. The comparison can
only see the two endpoints.

The concrete instance is the warning window. "Due within the warning window" fires when an issue
has between zero and `warnBeforeDays` working days left — three by default. Over a seven-day
outage an issue can enter that window, pass through it, and be found overdue on the catch-up run.
You get the breach and you never got the warning. If the pass has been down for longer than the
warning window, assume that is what happened and check the newly overdue issues by hand.

Staleness comes through a gap intact, because an issue that was idle a week ago is idler now. So
do over-consumed statements of work and impossible plans, unless somebody fixed them in the
meantime — in which case there was nothing to tell you.

## Running it by hand

Two ways in, which is deliberate: one for a person, one for a machine.

**From the application.** Configuration → Scheduled pass → **Run it now**. The summary of what it
did appears next to the button. This needs a signed-in person who may configure the platform; on
a deployment with no identity provider, it needs nobody, because there is nobody who could prove
it.

The run is attributed to **Scheduled pass** and not to you. Asking what the clock would say is
not the same as deciding it, and your name against a week of overdue notices would say that it
was.

**From a terminal**, using the same token the scheduler uses:

```sh
curl -X POST \
  -H "Authorization: Bearer $AXIOMATE_SCHEDULE_TOKEN" \
  https://<host>/api/schedule/run
```

The reply is JSON: `summary` in the form the configuration screen shows, `raised`, the `onset`
list with the detail of each new condition, counts of `continuing` and `cleared`, plus `misses`
and `refusals`. Those last two are covered below and are the ones worth reading.

The endpoint refuses in three ways, and each refusal says which:

- **503** — no database is configured. The pass reads stored state and remembers what it raised,
  and it can do neither against a browser mirror.
- **401** — no valid token and no verified session.
- **403** — signed in, but without the grant to configure the platform.

## Changing the time

The schedule lives in `infra/schedule.bicep`. Change `scheduleHour` and `scheduleMinute` and
redeploy. The default is **07:00**, every day, in `scheduleTimeZone`, which defaults to
`GMT Standard Time` — the United Kingdom, observing BST in summer.

Seven in the morning is defensible on three grounds. It is before the working day, so the notices
are waiting when people arrive rather than landing while they are already mid-task. It is before
anybody is editing, which matters because each run holds a Serializable transaction across the
whole workspace for up to thirty seconds — at seven there is nothing to contend with, whereas at
eleven a serialisation conflict would surface as a failed run for reasons that have nothing to do
with the schedule. And it is far enough from midnight for the date to be unambiguous, which is
the next section.

You can also edit the recurrence directly in the portal. It will be overwritten by the next
deployment, so treat that as a way to test a time rather than to set one.

### The timezone question, and the one rule that constrains it

Azure schedulers run on UTC unless told otherwise, and this firm does not. The template names a
Windows time zone rather than computing an offset once and hard-coding it, which is what makes the
trigger shift itself in March and October — Azure honours daylight saving only when a recurrence
carries a time zone.

That handles the scheduler. The seam is in the application. The pass takes its notion of "today"
from the UTC date, whatever the server's own clock is set to. At 07:00 the two agree: 07:00 GMT
is 07:00 UTC, and 07:00 BST is 06:00 UTC, both on the same calendar day.

**The rule: pick a time whose local date and UTC date are the same.** In the United Kingdom that
rules out midnight to one in the morning during BST, where the local date has rolled over and the
UTC date has not — 00:30 BST is 23:30 UTC on the day before. Scheduled there, the pass would read
the workspace as of yesterday, and would go on doing so every night: permanently a day behind the
firm it reports to. The template enforces the lower bound — `scheduleHour` will not accept 0 —
but note that the bound is only correct for this time zone and others east of UTC. If you change
`scheduleTimeZone` to somewhere west of UTC, the same hazard reappears in the late evening
instead, and no numeric bound expresses both cases.

Anything across the working morning is safe.

## How to tell whether last night's run happened

Say the honest thing first: **the configuration screen does not answer this.** The application
records when the pass last ran and what it did, but nothing reads those back into the interface
yet. Do not infer a run from a quiet inbox — a night on which nothing became true looks exactly
like a night on which nothing ran, and that is the whole problem.

Three things do answer it.

**The Logic App's run history.** In the portal, open the `axiomate-scheduled-pass` Logic App and
select **Runs history**. Each day is a row with a status. Open one and select the
**Run the scheduled pass** action: its outputs are the endpoint's reply, so you can read the same
summary and the same `misses` and `refusals` that the button in the application would have shown
you. This is the first place to look and usually the only one.

**The database.** The pass writes its own record in the same transaction as its work, so this
cannot disagree with what actually happened:

```sql
select "lastRunAt", "lastSummary" from "ScheduleWatch";
```

A `lastRunAt` older than this morning means last night's run did not happen, regardless of what
anything else says.

**The audit trail**, for detail. Everything the pass changed is attributed to **Scheduled pass**,
so filtering the trail by that name shows exactly what a given run did to which records.

## When it fails

The retry is safe, and it is safe for a reason in the application rather than a hope about the
network. The whole run commits in one transaction, so there is no partial state to retry into:
either the run happened and the memory moved, or neither did. A retry after a run that in fact
committed finds every condition already recorded, counts them as continuing, and raises nothing.

| What happens | What the scheduler does | Where you see it |
| --- | --- | --- |
| The endpoint returns 500 | Retries four times after the original — five attempts over roughly half an hour — then the run fails | Failed run in run history; alert email |
| The endpoint returns 503 (no database) | Same, and it will keep failing until the database is configured | As above; the error text names the cause |
| The token is wrong or stale (401) | **No retry.** Fails on the first attempt | Failed run within a minute of the scheduled time; alert email |
| The application is asleep or cold-starting | Waits up to two minutes per attempt, across the five | Usually nothing — it succeeds on a later attempt, marked "succeeded with retries" |
| The run succeeds but a rule reached nobody | Nothing. This is a successful run | `misses` in the run's output body |
| The run never starts at all | Nothing | **Not alerted.** See below |

A 401 is deliberately not retried. A broken secret should fail once, immediately and visibly,
rather than be buried under four quiet retries.

**Failures are pushed, not waited for.** `infra/schedule.bicep` creates an Azure Monitor alert on
the Logic App's failed-run count and an action group to send it somewhere. Set the `alertEmail`
parameter, or add recipients to the `axiomate-scheduled-pass-operators` action group in the
portal — the group is created empty rather than not at all, so adding somebody later does not
need a redeployment. With no recipients the alert still fires and is still visible under Azure
Monitor; it simply reaches nobody in particular.

**The gap in that coverage, stated rather than papered over.** The alert fires when a run *fails*.
It cannot fire when a run never *starts*, because a run that does not happen emits no metric to
threshold against. If the Logic App is disabled, deleted, or its subscription lapses, nothing
here will tell you. The detector for that case is `lastRunAt` in the query above, and it is worth
looking at once a week until you trust the arrangement.

**Rules that reached nobody are not treated as failures**, on purpose. A rule addressed to a role
nobody holds is a configuration mistake, and turning it into a nightly alert would train whoever
receives it to ignore the alert that means the pass is down. It comes back in `misses` on an
otherwise successful run, which is where somebody looking at the run will see it.

## What this does not do

- It does not send the notifications its rules raise by email or Teams. No transport is
  configured; those are recorded as pending and say so. The failure alert described above is a
  separate thing entirely — that is Azure Monitor emailing you, not Axiomate.
- It does not catch up on runs it missed. One run happens, covering the whole gap. See above for
  what that loses.
- It does not tell you it is alive. Absence of failure is not evidence of success, which is why
  `lastRunAt` exists.
