---
name: axiomate-utilisation-analysis
description: This skill should be used when building or reasoning about utilisation, billable-hours, or profitability reporting in Axiomate TMS. The formula and underlying data already exist (lib/availability.ts, TimeEntry.billable) — this skill is for building the missing analysis SURFACE against real data, not inventing a new calculation. Load after axiomate-timesheet and axiomate-capacity-planning.
---

# Axiomate Utilisation Analysis

**The calculation exists. The reporting surface doesn't yet.** Don't rebuild
`utilisationPct` — extend what's there.

## What's real today

`lib/availability.ts:203` — `utilisationPct = (allocatedHours / availableHours) * 100`.
`TimeEntry.billable: Boolean` is a real field, already written on every time entry
(`lib/actionShape.ts:593`, `lib/db/map.ts:706`). A "Rates" Configuration section exists
(per `axiomate-domain-analysis`'s Configuration inventory).

Two agents are DECLARED but not built, in `lib/config.ts`:

- **`AGENT_UTILIZATION`** — scoped to report billable/non-billable/internal/training/leave/
  available time and its trend.
- **`AGENT_BILLING_READY`** — scoped to determine billing readiness from approved time,
  billable work, milestones, and change requests.

These are the named slots this skill's work fills — a utilisation feature that doesn't map onto
one of these two agent scopes is either genuinely new scope (name it explicitly, don't silently
expand an existing agent's job) or a sign the request should be re-scoped to fit one of them.

## Distinguishing the three related-but-different numbers

```
Allocation  — planned capacity commitment (axiomate-project-allocation), a percentage,
              not a rate
Timesheet actuals — recorded hours (axiomate-timesheet), what actually happened
Utilisation — allocatedHours / availableHours, a RATIO derived from the two above, not a
              third independent input
```

A dashboard that shows all three should make clear which is planned, which is actual, and which
is derived — conflating "allocated 80%" with "utilised 80%" is a real, easy-to-make reporting
mistake since they can diverge significantly (someone allocated but not yet doing recorded
work, or doing more recorded work than their allocation implied).

## Billable utilisation and profitability

`TimeEntry.billable` splits the utilisation number into billable vs. non-billable portions —
this is the input `AGENT_UTILIZATION`'s scope names. Profitability additionally needs the Rates
Configuration data (not yet connected to a reporting surface, per this extraction) — a
profitability feature is a genuinely larger scope than utilisation alone; don't build it as a
byproduct of a utilisation dashboard without naming it as its own, separately-considered piece
of work.

## What this skill determines

1. Which of the two declared agent scopes (or a genuinely new one) a request maps to.
2. Whether the request is asking for allocation, actuals, or utilisation — and states which,
   explicitly, in whatever it produces.
3. Whether billable/non-billable needs splitting out, or a blended number is sufficient for the
   request as scoped.
4. Hands off to `axiomate-capacity-planning` for the `availableHours` side of the ratio and
   `axiomate-timesheet` for the `allocatedHours`/actuals side — this skill composes those two,
   it doesn't re-derive either.
