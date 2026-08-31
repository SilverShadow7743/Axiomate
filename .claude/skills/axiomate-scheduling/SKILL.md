---
name: axiomate-scheduling
description: This skill should be used when a feature deals with WHEN work happens in Axiomate TMS — start/due dates, dependencies, critical path, or SLA-driven target dates. It supplies the real scheduling functions (lib/schedule.ts) and confirms that work-execution dates and allocation dates are genuinely separate fields with no derivation between them. Load alongside axiomate-project-allocation for anything that might conflate the two.
---

# Axiomate Scheduling

**Allocation dates and work-execution dates are two unrelated field sets — there is no
derivation between them today.** `Allocation.startDate`/`endDate` (a project capacity window,
`axiomate-project-allocation`) share no field with `Issue.plannedStartDate`/`plannedEndDate`/
`actualEndDate` (`ScheduleRow`, this skill). A feature that tries to compute one from the other
is inventing a relationship the schema doesn't have — if that relationship is genuinely needed,
it's a domain-model change, not a scheduling calculation.

## The real functions — `lib/schedule.ts`

- **`proposeTargetDate(raised, severity, policy)`** — `addWorkingDays(raised, policy[severity])`.
  Driven by `SlaPolicy` (`lib/types.ts:331`), default `{ High: 5, Medium: 10, Low: 20 }` working
  days. A suggestion, never auto-committed — the UI's own convention (Filters chip's "Show
  proposed SLA targets") renders it as a dashed, uncommitted line until explicitly accepted.
- **`criticalResolutionPath(activities, dependencies, plannedEnd)`** — returns `CrpResult`:
  `sufficient`, `chain`, `projectedResolutionDate`, `scheduleVarianceDays`,
  `criticalBlockingDependency`. This IS the real critical-path/dependency-sequencing
  calculation — a delivery-planning feature that needs "what's the earliest this can finish
  given dependencies" calls this, it doesn't re-derive critical-path logic.
- **`validateChange(row, next, all, dependencies)`** — returns `Violation[]` (e.g., end before
  start). The gate a proposed date change must pass before it's committed.

## What this skill determines

1. **Is a date change valid** — run it through `validateChange` before accepting it; don't
   write ad hoc date-ordering checks.
2. **What's the critical path given dependencies** — `criticalResolutionPath`, not a manual
   walk of the dependency graph.
3. **What SLA target should be proposed** — `proposeTargetDate` against the configured
   `SlaPolicy`, always presented as a suggestion pending explicit acceptance, never silently
   applied.
4. **Is this a scheduling question or a capacity question?** "When could this realistically
   finish given dependencies and severity" is scheduling (this skill). "Does anyone have time
   to do it" is `axiomate-capacity-planning`. A real delivery-planning answer needs both,
   answered separately, not conflated into one number.

## Handoff

Full scope → timeline → capacity → commitment sequencing (a feature that needs ALL of this
together) → `axiomate-delivery-planning`, which composes this skill's functions with
`axiomate-capacity-planning`'s formula rather than duplicating either.
