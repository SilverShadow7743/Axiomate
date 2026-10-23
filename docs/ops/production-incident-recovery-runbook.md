# Production incident & recovery runbook

**Owner: Operations / Managed Service Owner.** This document is theirs to keep current — see
`docs/strategy/2026-09-20-standing-sop-decision.md` for why this is the first of eight runbooks
named, and why it is first rather than secret rotation.

First of eight. The other seven — rollback/release recovery (largely already covered by
`docs/deployment.md` §6–§7, referenced throughout below), on-call & escalation, backup/restore,
secret & API-key rotation, scheduled automation failure, access/RBAC changes, and
deployment/release procedure (also largely `docs/deployment.md` §3) — are named, not yet written
as their own documents. Do not treat their absence as "nothing to worry about" — it means the
next runbook to write is next, not that the gap is closed.

---

## What this document is for

Something is wrong with production Axiomate TMS. This document is what a person on call reads,
in order, starting from not yet knowing what's wrong. It does not replace judgment; it removes
the need to invent a process while also under pressure.

Eight phases: **Detect → Assess → Contain → Communicate → Recover/Rollback → Validate → Close →
RCA.** Each phase below states what happens, with what this deployment actually has today — not
an idealized platform. Where the honest answer is "nothing exists for this yet," it says so,
because a runbook that invents tooling it doesn't have is worse than a short one that doesn't.

---

## 1. Detect

**What actually pages someone today:** four Azure Monitor alerts, all routed to the
`axiomate-scheduled-pass-operators` action group by email (`infra/alerts.bicep`):

| Alert | Fires when |
| --- | --- |
| `axiomate-tms-unhealthy` | `HealthCheckStatus` below 100 for 5 minutes — see `app/api/health/route.ts` for what it actually probes (a 2-second, cached `SELECT 1`, not a full dependency check) |
| `axiomate-tms-5xx` | More than five 5xx responses in 15 minutes |
| `RunsFailed` (scheduled pass) | The daily scheduled pass Logic App fails |
| `RunsFailed` (intake) | The intake mail-processing Logic App fails |

**What does not exist yet, stated plainly so it isn't assumed:** `infra/observability.bicep`
(Log Analytics workspace, Application Insights) has never been deployed. The richer queries in
`docs/observability.md` — `AppRequests`, request-level tracing, the log-query rules for pass
absence and intake silence — need that workspace and return nothing until it exists. Today,
detection is these four alerts, a person noticing the app is slow or wrong, or a client saying
so.

**First move on any page:** open `https://axiomate-tms.azurewebsites.net/api/health` directly.
It returns fast (the probe is capped at 2 seconds and cached for 10) and tells you the one thing
that distinguishes "the instance is up but can't reach its database" from everything else.

## 2. Assess

Answer these, in order, before touching anything:

1. **Is this a code problem or a data problem?** A bad release behaves differently from a bad
   migration or a database issue. Check the most recent deploy: `gh run list --workflow=deploy.yml
   --limit=5` (or the Actions tab) — did one finish shortly before the reports started?
2. **Is this everyone, or one client/one feature?** The health check and the 5xx alert are both
   fleet-wide signals. A single client reporting something wrong, with the health check green,
   is a different, calmer problem than production returning 5xx broadly.
3. **Did a migration run with this release?** `prisma/migrations/` — check whether the deploy
   that preceded the incident included a new migration folder. This determines whether Recovery
   (§5) is "swap the slot back" (seconds, safe) or something harder (see §5's schema caveat).
4. **Is the scheduled pass or intake mail affected, or just the live site?** These run on their
   own Logic Apps and can fail independently of the App Service being healthy.

Write down what you find as you go — this becomes the RCA input in §8, and reconstructing it
afterward from memory is worse than a rough timestamped note taken now.

## 3. Contain

Contain and recover are separate phases on purpose: containing stops the bleeding, recovering
fixes it, and conflating them is how a rushed fix becomes a second incident.

- **If a bad release is confirmed and no migration ran with it:** go straight to §5 — the swap-back
  *is* the containment here, and there's no reason to wait.
- **If a migration ran:** do not swap back yet. Read the schema caveat in §5 first — swapping the
  code back in front of a migrated database is only safe if the migration was additive, and
  confirming that takes two minutes, not swapping-then-discovering.
- **If this is a data-integrity concern** (something looks wrong in a specific client's records,
  not a fleet-wide failure): this is not a code rollback situation. Stop, do not run `audit:integrity`
  against production impulsively — it exists specifically for this (`docs/deployment.md`, and the
  32-area review's own finding that it's deliberately excluded from CI because "it reads the real
  tenant's stored state") — but running it is itself an action worth a second person's awareness
  first, not a solo 2am decision.
- **If the scheduled pass or intake is failing but the live site is fine:** this rarely needs
  immediate containment — it needs someone to look at why before the next scheduled run, per §5's
  own reasoning for scheduled failures (see the separate runbook named for this, not yet written;
  until it exists, treat a `RunsFailed` alert as P2, not P1, unless it's blocking a client-visible
  commitment).

## 4. Communicate

**Internally, immediately:** whoever is on call says, in whatever channel the firm actually
watches, what's affected and what phase this is in (assessing / containing / recovering). A
one-line update beats silence even when there's nothing new to say — "still assessing, no client
action needed yet" is a real update.

**To clients, only once Assess (§2) has an answer.** Nothing here automates client
communication — there is no status page, no automated notice. A premature "we're aware of an
issue" before knowing what the issue is has cost firms more credibility than a slightly later,
accurate one. Who actually sends a client-facing note, and through what channel, is an open
question this runbook does not resolve — flag it to the Operations owner as unresolved rather
than improvising a channel mid-incident.

**Whoever else needs the update:** the Engagement Lead for the affected client(s), and the
Operations owner if they're not already the one on call.

## 5. Recover / Rollback

**The fast path — swap the slot back — is real and takes seconds.** Full mechanics, including
exactly why the pipeline won't do this automatically, are in `docs/deployment.md` §7. In brief:

```
az webapp deployment slot swap \
  --resource-group axiomate-tms-rg \
  --name axiomate-tms \
  --slot staging --target-slot production
```

**The one thing to check before running it: did a migration ship with the bad release?**
(§2, question 3.) `docs/deployment.md` §7 is explicit and worth restating here because it's the
detail most likely to be skipped under pressure: **Prisma generates no down migrations, and
nothing in this repository describes how to reverse one.** If the migration was additive
(nullable new columns, no drops, no renames — the rule `docs/deployment.md` §3 holds every
migration to), swapping the code back is a complete recovery regardless — the old code simply
ignores the new columns. If it was **not** additive, a code swap alone does not recover the
schema, and the two real options are hand-written reverse SQL under time pressure (how data gets
lost) or a point-in-time restore to a new server (which discards every write since the restore
point, from every user, not just the bad release's). **That decision is the firm's, made by a
person with the authority to accept the trade-off — never a solo call mid-incident, and never
a default.**

**If this is a scheduled-pass or intake failure, not a live-site problem:** recovery is usually
re-running the failed pass once its cause is understood, not a slot swap. The separate runbook
for this is named, not yet written.

## 6. Validate

After a swap-back (or any other recovery action):

1. Re-check `/api/health` directly — it should return clean within the cache window (10s).
2. Confirm the `axiomate-tms-unhealthy` and `axiomate-tms-5xx` alerts have cleared, not just that
   they've stopped re-firing — a cleared alert and a not-yet-re-evaluated one look the same for a
   few minutes.
3. Open the app as a real user would and do the thing that was reportedly broken. A health check
   passing is not the same claim as "the feature works," and this runbook's own philosophy (stated
   throughout this session's Coverage Audit) is that the two are checked separately, not conflated.
4. If a client reported the original problem, confirm with them directly once you're confident,
   rather than assuming silence means resolved.

## 7. Close

State plainly, in the same channel §4 used: what broke, what was done, and that it's resolved.
Note the time containment started and the time it was confirmed resolved — this is the input
§8 needs and is far easier to capture now than to reconstruct later.

An incident is not closed just because the symptom stopped. If §5 used the fast path (a swap)
without yet resolving *why* the bad release was bad, the underlying code problem is still live in
the `staging` slot and will ship again on the next deploy unless someone fixes it first — closing
the incident and forgetting the cause are two different actions.

## 8. RCA (root cause analysis)

Not optional for anything that reached Contain (§3) or further. Answer, in writing, wherever this
firm records this kind of thing (not yet decided — flag to the Operations owner if nowhere
exists yet):

- What actually broke, in one sentence a non-engineer could read.
- When it started, when it was detected, and the gap between those two — this is the number
  worth tracking over time, more than incident count.
- What was done to recover, and how long that took.
- Why it happened — the real cause, not the proximate trigger. "The migration wasn't additive"
  is proximate; "the migration checklist in `docs/deployment.md` §3 wasn't followed, and nothing
  enforces it automatically" is closer to root cause.
- One concrete follow-up action, with an owner and, if possible, a date — per this repository's
  own canonical vocabulary (`knowledge/operating-model/canonical-model.md` in the sibling
  `office-axiomate` repo, which this deployment's operating model borrows its Action/Owner/
  Deadline conventions from): a follow-up with no owner is `Not Assigned`, not implicitly
  everyone's problem.

---

## What this runbook does not cover, named rather than silently missing

- **On-call & escalation** — who's on call, how they're reached, what happens if they don't
  respond. Not written. This runbook assumes someone already knows they're the one responding.
- **Backup / restore** — point-in-time restore is mentioned in §5 as an option; whether it's
  actually enabled on the flexible server, its retention window, and who's permitted to trigger
  one are open questions `docs/deployment.md` §7 already flagged and this runbook doesn't resolve.
- **Secret & API-key rotation**, **scheduled automation failure** (beyond the brief note in §3),
  **access/RBAC changes**, and **deployment/release procedure** (mostly covered already by
  `docs/deployment.md` §3, but not restated as a standalone operational runbook) — all named in
  the standing-SOP decision, none written yet.
