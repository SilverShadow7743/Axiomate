---
name: axiomate-capacity-planning
description: This skill should be used when a feature needs to know how much time a person or team actually has available — before proposing an allocation, checking whether a delivery date is achievable, or building any capacity-vs-demand view. It supplies the real, already-implemented capacity formula so a new feature doesn't re-derive one that already exists and is correct. Load after axiomate-project-allocation.
---

# Axiomate Capacity Planning

The capacity formula already exists and is correct — `lib/availability.ts`, described in its
own header comment as "the ONE place 'who has time, when' is computed." Do not write a second
one; extend or call this.

## The real formula

```
available = pattern-derived gross − approved leave/commitments − holidays − meetings
remaining = available − allocations
```

- **Pattern-derived gross** — from the person's versioned working pattern (`lib/capacity.ts`'s
  `WORKING_PATTERN` defaults: `hoursPerDay: 7.5, daysPerWeek: 5, billableTargetPct: 80`),
  resolved for a given date via `valueAt` against the generic `Version` model — a pattern change
  takes effect from its `validFrom` date, and past dates still resolve against what was true
  then. Never assume a flat, un-dated working pattern.
- **Approved leave/commitments** — from `Commitment` (person-level, no `projectId` — see
  `axiomate-project-allocation`'s resource-model reference), the Leave kind specifically, only
  once approved (its `status`/`reason` pair governs this).
- **Holidays** — organization-configured, via the Configuration section that holds them.
- **Meetings** — real calendar commitments, deducted the same as leave.
- **Allocations** — subtracted last, against `remaining`, from `Allocation.percentage` × the
  window it covers (`axiomate-project-allocation`).

## What this skill determines

1. **Is a proposed allocation actually feasible** — compare the requested `percentage`/window
   against `remaining` for the affected people, not against `available` (which hasn't yet
   subtracted existing allocations).
2. **Is a delivery date achievable** — hand off to `axiomate-delivery-planning`'s sequence/
   dependency reasoning once capacity is confirmed; this skill only answers "is there time,"
   not "in what order."
3. **Utilisation** — the formula and raw data (`lib/availability.ts:203`'s `utilisationPct =
   allocatedHours / availableHours * 100`, `TimeEntry.billable`) already exist. Two agents are
   DECLARED but not yet built (`AGENT_UTILIZATION`, `AGENT_BILLING_READY` in `lib/config.ts`) —
   a utilisation-analysis feature extends these, it doesn't invent a new calculation.

## Before building anything here

Check whether the view/calculation you're about to build already exists as a call site of
`lib/availability.ts` — capacity checking in this app is centralized on purpose, specifically so
two screens never quietly disagree about how much time someone has.
