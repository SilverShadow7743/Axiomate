---
name: axiomate-timesheet
description: This skill should be used when implementing or reasoning about timesheet features in Axiomate TMS — the bridge between planned allocation and actual recorded effort. It supplies the real TimeEntry/Timesheet schema, the LIVE freeze mechanism, and the approval flow, so a new timesheet feature doesn't rebuild what already exists or miss the freeze rule. Load after axiomate-project-allocation.
---

# Axiomate Timesheet

The layer where planned meets actual — the fourth of the four resource layers in
`axiomate-project-allocation`, and the one with the most already built: schema, freeze
mechanism, and approval flow are all live, not aspirational.

## The real sequence

```
Allocation        — project-level capacity commitment (axiomate-project-allocation)
       ↓
Available capacity — lib/availability.ts's formula (axiomate-capacity-planning)
       ↓
Work assignment    — who's actually doing which issue (axiomate-work-assignment)
       ↓
Actual timesheet   — TimeEntry rows, recorded against real work
       ↓
Actual effort       — hours, summed, compared against the plan
```

## The real schema

`TimeEntry` (`prisma/schema.prisma:981-1006`) — `issueId` REQUIRED (an entry always attaches to
a work item, never a bare project), `activityId` optional (task-level detail), `person`/
`personId` (the seam — `axiomate-domain-analysis`), `date`, `hours`, `billable: Boolean` (real,
feeds `axiomate-utilisation-analysis`). `Timesheet` (`schema.prisma:1185-1210`) — the weekly
wrapper, `(person, weekStarting)` keyed, `status: Submitted | Approved | Rejected` (a `String`
by design — the vocabulary is the product's, not a fixed enum, so a tenant's own status wording
can differ without a schema change).

## The freeze rule — live, not planned

`lib/timeWindow.ts`'s `checkEntry` is called from `addTime` (`lib/workspace.ts:3851`);
`lib/timesheet.ts`'s `isFrozen`/`frozenMessage` refuse `addTime`/`updateTime`/`removeTime`
against an already-submitted week. **Check before building anything here:** does the feature
assume this needs implementing? It doesn't — verify the existing refusal path handles the new
case before writing a second one.

## Validation this skill enforces

1. **Timesheet period** — does the entry's `date` fall inside the `weekStarting` window it's
   being recorded against?
2. **Project** — reached only by walking the `issueId`'s tier ancestry; there's no direct
   `projectId` on `TimeEntry` — don't add one without a real reason, the indirection is
   deliberate (an issue can move between projects; the time entry follows it, not a snapshot).
3. **Work item** — does `issueId` (and `activityId`, if set) resolve to a live, non-deleted
   record? (See `axiomate-data-integrity`'s TimeEntry-without-a-valid-issue check.)
4. **Date** — within the recording window, not in the future relative to when it's entered
   (unless the product explicitly allows planned-but-not-yet-worked entries — check the actual
   UI convention, don't assume).
5. **Hours** — a sane range; `addTime` already reports a long day as a warning beside the
   confirmation (scenario `TW2` in this project's own suite pins this) — extend that
   convention rather than inventing a new threshold. Note `TW2`'s own documented limitation:
   the cap is keyed off a resolvable `personId`, so a person whose `person` name string doesn't
   resolve to a directory id gets no cap and no warning — the seam again
   (`axiomate-domain-analysis`).
6. **Lock status** — `isFrozen` before any write.
7. **Approval status** — `Submitted`/`Approved`/`Rejected`; a rejected week's entries should be
   editable again (the freeze lifts), an approved week's should not.
8. **Actual vs. planned** — compare `TimeEntry` sums against `Allocation.percentage` × the
   working-pattern-derived capacity for the same window — this is a reporting question, not a
   write-time validation; don't block a timesheet submission on this comparison, surface it.

## Handoff

Utilisation/billable reporting on top of this data → `axiomate-utilisation-analysis`. Whether a
person had capacity to do the work being recorded → `axiomate-capacity-planning` (a
retrospective question here, not a gate on submission — capacity checking happens at
allocation/assignment time, not at time-entry time).
