**Status: built, 7 September 2026**, same day as the design — schema (migration
`20260907000003_checklist`), `upsertChecklistItem`/`toggleChecklistItem`/`removeChecklistItem`
reducer arms, and a Checklist tab beside Notes (`components/ChecklistTab.tsx`). Four scenarios
(CHK1–CHK4) drive the real reducer; all PASS, alongside all 235 pre-existing scenarios. `tsc
--noEmit`, `npm run build` and `npm run audit:tenancy` all clean.

# Checklist items — a lightweight to-do list within a task

*7 September 2026. From the Hive gap survey's "Subtasks / checklists" line. Checked first: real
subtasks already exist — `Issue.parentIssueId`/`subIssues` (`prisma/schema.prisma:228-230`) is a
full parent-child issue tree, each child carrying its own status, owner and dates. What's missing
is the lighter thing: a small ordered list of check-off items inside a single issue, for the
"confirm with client, update FBS, close ticket" kind of list that does not warrant spawning a
full child issue with its own lifecycle.*

## Shape, closely following `lib/notes.ts`'s precedent

A checklist item is not a note (a note is prose somebody wrote; a checklist item is a small
state — done or not) and not a subtask (no status lifecycle, no owner, no dates, nothing anyone
would report against on its own). It is the smallest useful thing between the two.

```prisma
model ChecklistItem {
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  /// `chk-12`, minted from the durable workspace counter.
  id      String
  issueId String
  issue   Issue  @relation(fields: [tenantId, issueId], references: [tenantId, id], onDelete: Cascade)

  text String
  done Boolean @default(false)
  /// Presentation order. Not a dependency — same rule as Milestone.sequence.
  sequence Int

  doneAt DateTime?
  doneBy String?

  recordedBy String
  recordedAt DateTime
  deletedAt  DateTime?

  @@id([tenantId, id])
  @@index([tenantId, issueId])
}
```

Cascade on the issue relation, unlike every entity this codebase has added today — a checklist
item has no meaning independent of its issue and no downstream record ever points at one, so
there is nothing a cascade could orphan. This is the same reasoning `IssueActivity` already
applies to its own issue relation.

## Reducer

Three arms, matching `deliverMilestone`'s own precedent for why "mark it done" is not a general
patch field: `upsertChecklistItem` (text and sequence only — creating or editing what the item
says), `toggleChecklistItem` (done/not-done, its own arm so `doneBy` records who actually checked
it off rather than whoever last touched any field), `removeChecklistItem` (soft delete).

Gated on `work.edit` — the same permission `updateIssue` already uses. A checklist item is a
lightweight annotation on an issue somebody is already allowed to edit; inventing a separate
permission for it would be authority nobody asked for.

## Where it surfaces

`OverviewTab.tsx` (or a new small block beside it) — an ordered list under the issue's own
detail, checkboxes toggling `toggleChecklistItem`, an inline add row, a remove control per item.
No progress bar or percentage-complete figure: `lib/goals.ts`'s own rule applies unchanged here
too — a count of "3 of 5 done" is fine because it recomputes from the items on every read, but a
stored percentage is exactly the kind of drifting number this codebase has already refused twice.

## What this does not do

No due dates, no assignment, no dependencies between items — those are exactly what a real
subtask (`Issue.subIssues`) already exists to hold, and duplicating that lifecycle at a lighter
weight would give two ways to do the same thing with no rule for which to reach for. A checklist
item that needs any of those things is not a checklist item, it is a subtask.
