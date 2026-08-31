---
name: axiomate-project-allocation
description: This skill should be used when implementing or reasoning about resource allocation, project access, work assignment, or timesheet features in Axiomate TMS. It supplies the real four-layer resource model (Allocation, ProjectMember, Assignment, Timesheet) from the shipped schema, so a new feature doesn't collapse two of these into one. Load before axiomate-capacity-planning, and before any change to Allocation/Commitment/TimeEntry/ProjectMember.
---

# Axiomate Project Allocation

**Allocation is project-level. Assignment is work-level. Timesheet is actual-level.** This is
the product owner's own stated model, confirmed against the real schema — with one layer the
original framing didn't name: `ProjectMember`, a genuinely separate concept from `Allocation`.
Collapsing any two of these four layers is the most likely mistake a new feature makes here.

## The four layers

1. **Allocation** — a capacity commitment to a **project-tier node**. `projectId`, `percentage`,
   `startDate`/`endDate`. Never references a work item.
2. **ProjectMember** — an **access** fact: who may see/act on a project, with a role. Explicitly
   documented in the schema as `Allocation`'s sibling, answering a different question (capacity
   vs. visibility). `personId` is REQUIRED here — unlike `Allocation`'s optional one, a
   `ProjectMember` row that can't resolve to a directory id is meaningless (nothing will ever
   match it).
3. **Assignment** — who executes a **specific issue** (`setAssignment`, backed by the
   configurable responsibility-types model: cardinality, requiredness, role-eligibility). A
   person can be 50% allocated to a project and hold any number of issue assignments under it,
   including zero. A change to allocation never implies a change to assignment, or the reverse.
4. **Timesheet** — **actual** effort. `TimeEntry` always references an `issueId` (optional
   `activityId` for task-level detail) — never a bare project. `Timesheet` is the weekly
   `Submitted/Approved/Rejected` approval wrapper, one row per person per week.

Full spec, real field names, and the reducer arms behind each: `references/resource-model.md`.

## Before implementing anything here

1. Identify which of the four layers the feature actually touches — most requests phrased as
   "allocation" turn out to mean assignment or access (`ProjectMember`), not capacity.
2. Check `references/resource-model.md`'s person/personId section — every one of these four
   models carries the dual-field seam (see `axiomate-domain-analysis`). Never write a feature
   that assumes `personId` is always populated on `Allocation`, `Commitment`, or `TimeEntry`.
3. If the feature computes availability or remaining capacity, hand off to
   `axiomate-capacity-planning` — the formula already exists (`lib/availability.ts`); don't
   re-derive it.
4. Timesheet features specifically: the freeze mechanism is LIVE (`lib/timeWindow.ts`, wired
   into `addTime`; `lib/timesheet.ts`'s `isFrozen`/`frozenMessage`) — a submitted week already
   refuses further entries. Don't assume this needs building; check first.
