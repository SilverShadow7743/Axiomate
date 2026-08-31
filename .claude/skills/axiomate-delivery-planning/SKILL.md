---
name: axiomate-delivery-planning
description: This skill should be used when converting approved work into a delivery plan, or determining whether a proposed delivery date is actually achievable in Axiomate TMS. It composes axiomate-scheduling's real critical-path functions with axiomate-capacity-planning's real capacity formula — it does not introduce a third calculation. Note the naming collision: "commitment" in this skill's own sequence means committing to a date, NOT the Commitment Prisma model (which is leave/time-off).
---

# Axiomate Delivery Planning

**A composition skill, not a new calculation.** Every step below already has a real
implementation elsewhere; this skill's job is sequencing them correctly, the same way
`axiomate-feature-builder` orchestrates the build-time skills rather than reimplementing them.

## A naming collision to flag immediately

The word "commitment" appears twice in this codebase meaning two different things:

1. **The `Commitment` Prisma model** (`axiomate-project-allocation`'s resource-model reference)
   — a person-level leave/time-off record, no `projectId`, feeds the capacity formula as a
   deduction.
2. **"Commitment" as the last step of delivery planning** (below) — committing to a delivery
   date. This is a decision, not a database write to the `Commitment` model.

Never let a delivery-planning feature write to the `Commitment` table when what's meant is
"the team committed to this date" — that's a different, currently-uncodified concept (likely a
field on the relevant `Issue`/`Sow`/milestone, or simply the accepted `proposeTargetDate`
result), not leave tracking.

## The real sequence

```
Scope         — the work items in question (axiomate-work-model for what they are)
       ↓
Dependencies  — the real dependency graph (IssueDependency, feeding criticalResolutionPath)
       ↓
Sequence      — axiomate-scheduling's criticalResolutionPath(activities, dependencies,
                plannedEnd) → sufficient / chain / projectedResolutionDate /
                scheduleVarianceDays / criticalBlockingDependency
       ↓
Capacity      — axiomate-capacity-planning's real formula (lib/availability.ts) for every
                person the sequence's chain depends on — a sequence that's fine on paper but
                has no capacity behind it is not an achievable plan
       ↓
Timeline      — the sequence's projectedResolutionDate, checked against capacity's
                availability window, checked against any SLA proposal
                (axiomate-scheduling's proposeTargetDate) if one exists
       ↓
Commitment    — the decision to commit to a date (not a Commitment-model write — see above)
```

## Is a proposed delivery date achievable — the real check

1. Run `criticalResolutionPath` for the real dependency chain — is `sufficient` true, and what's
   `projectedResolutionDate`?
2. For every person on the critical chain, run `axiomate-capacity-planning`'s formula — is
   `remaining` capacity actually available across the window the chain implies?
3. If either check fails, the honest answer is "not achievable as scoped" — state what's
   blocking (the `criticalBlockingDependency`, or which person's capacity is the constraint),
   not just "no."

## Handoff

Effort sizing feeding the scope → `axiomate-estimation`. Whether specific people should be
allocated to cover the capacity gap → `axiomate-project-allocation`. Whether the plan is ready
to build → `axiomate-feature-builder`.
