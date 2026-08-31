---
name: axiomate-governance
description: This skill should be used when evaluating or building features around commercial delivery governance in Axiomate TMS — scope, schedule, resource, quality, risk, commercial, and delivery control. A real governance model already exists (Sow, ChangeRequest, Milestone) — this skill extends it rather than inventing an abstract PM-governance framework disconnected from what the schema already tracks.
---

# Axiomate Governance

**Governance here means commercial delivery governance under a Statement of Work — a real,
already-implemented model, not an abstract framework.** `Sow`, `ChangeRequest`, and `Milestone`
together ARE this app's governance surface.

## The real model

- **`Sow`** (`prisma/schema.prisma:772`) — `reference`, `title`, `status`, `signedOn`,
  `startDate`/`endDate`, `effortHours`. The commercial container everything else governs
  against. Scoped to an `engagementId` (a tier node, per `axiomate-domain-analysis`).
- **`ChangeRequest`** (`schema.prisma:1230`) — scope governance: `sowId` (cascade — "a change
  request without its statement of work is not a record of anything"), an optional `issueId`
  (when it originated from one, no enforced FK — see the model's own comment), `reference`/
  `title`. Reducer: `upsertChangeRequest`/`decideChangeRequest`/`withdrawChangeRequest`
  (`onRaiseChange`/`onDecideChange`/`onWithdrawChange` in `IssueWorkspace.tsx`). This is the
  real mechanism for "is this in scope" governance — a change to scope goes through this, not a
  freeform note.
- **`Milestone`** (`schema.prisma:1526`) — schedule AND commercial governance together:
  `sequence` (presentation/payment order, explicitly "not a dependency" — don't read it as a
  scheduling dependency, that's `axiomate-scheduling`'s concern), `basis` (`percentage |
  amount` — a payment schedule). Reducer: `upsertMilestone`/`removeMilestone`/
  `deliverMilestone`/`decideMilestone` (`onUpsertMilestone`/`onDeliverMilestone`/
  `onDecideMilestone` in `IssueWorkspace.tsx`).
- **`ScopeItem`** (`axiomate-domain-analysis`) — `deliverable | acceptance | assumption |
  exclusion | process | scenario | configuration` — what's in/out of scope under the SOW.

## Mapping the user's seven governance dimensions to what's real

```
Scope       → ScopeItem + ChangeRequest (a change to scope goes through the CR flow)
Schedule    → Milestone.sequence (payment order) + axiomate-scheduling's real dates/critical
              path (these are TWO different schedules — don't conflate a milestone's payment
              sequence with the issue-level critical path)
Resource    → axiomate-project-allocation / axiomate-capacity-planning
Quality     → axiomate-scenario-testing's real verdicts, axiomate-code-review
Risk        → axiomate-risk-management's real RAID model
Commercial  → Sow.effortHours, Milestone.basis, the Rates Configuration section
              (axiomate-utilisation-analysis)
Delivery    → Milestone.deliverMilestone + axiomate-release-readiness
```

Every dimension the user's proposal named already has a real home. A governance feature or
dashboard composes these — it does not introduce a parallel "governance record" that duplicates
what `Sow`/`ChangeRequest`/`Milestone` already track.

## What this skill determines

1. Is the governance question about scope, schedule, commercial terms, or delivery status of a
   SOW? Route to the matching real model above.
2. Is a "governance dashboard" request actually asking for a cross-cutting VIEW over several of
   these (a legitimate new UI surface, per `axiomate-screen-builder`) or a new DATA model
   (almost never — check the list above first)?
3. Change control specifically always goes through `ChangeRequest`, never a direct edit to
   `Sow`'s committed terms.
