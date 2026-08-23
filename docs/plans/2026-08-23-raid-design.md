# Risks and decisions first-class — design

**Date:** 2026-08-23 · **Register item:** #9 · **Status:** approved (batch go)

## The gap

The register holds work of ten discovered types in one table, and the type registry is
deliberately configuration — but a risk logged as a generic record carries no likelihood,
no impact, no exposure anybody can sort by; a decision closed as a generic record carries
its outcome only if somebody thought to write a note. The PRD's RAID expectation is that
these two kinds have their own minimal semantics without breaking the one-table design.

## The design

**The one-table rule holds.** A risk IS an issue, a decision IS an issue — same tree, same
notes, same audit, same client-boundary flag. What is added: two shipped work types, three
optional stored fields, one pure module, and the screens that show them only where they
mean something.

### 1. Two shipped types

`Risk` and `Decision` join the seed work-type registry (`fromSource: false` — the two
inventions every consultancy recognises, the same argument as the shipped roles). The
`mergeModel` seed-first spread delivers them to existing workspaces. Recognition is by
STABLE ID (`WT_RISK`, `WT_DECISION`) resolved from the issue's type label through the live
registry — `raidKindOf(model, typeLabel)` — so renaming the label does not orphan the
semantics.

### 2. The pure module — `lib/raid.ts`

Likelihood and impact each 1–5; **exposure is likelihood × impact and is NEVER stored** —
a derived value stored as fact is the thing this codebase refuses. Bands:
1–4 Low, 5–9 Medium, 10–14 High, 15–25 Critical. `raidProblem(patch)` refuses anything
outside 1–5-or-null in words. `raidKindOf(model, label)` → `'risk' | 'decision' | null`.

### 3. The fields

`riskLikelihood`, `riskImpact` (Int?, null = not yet judged — never defaulted, the same
honesty as the daily cap) and `decisionOutcome` (Text?, the recorded outcome) on
IssueRecord and the Issue table. Written through `updateIssue`'s ordinary patch — audited
like any field — with the reducer validating via `raidProblem` and the WIRE WIDENING IN
THE SAME COMMIT (the 828f975 lesson, third outing). No gate on closing a Decision without
an outcome: the status policy's reason/evidence machinery is where a firm adds that if it
wants it, per its own configuration.

### 4. The screens

OverviewTab only, keyed on `raidKindOf`:
- **Risk read view**: an exposure line — "Likelihood 4 × Impact 5 = 20 · Critical" — or
  "not yet judged" when either half is null.
- **Risk edit view**: two 1–5 selects with an "not judged" blank option.
- **Decision read view**: the outcome paragraph, or "no outcome recorded yet".
- **Decision edit view**: the outcome textarea.

### 5. Proof

Scenario **RD1**: the shipped types present with stable ids; a renamed Risk label still
recognised; exposure bands at their boundaries (4→Low, 5→Medium, 14→High, 15→Critical);
`updateIssue` accepting 1–5, refusing 0 and 6 in words, accepting null-back; the outcome
round-tripping through the patch; a generic-typed record's `raidKindOf` null. The
persistence proof round-trips all three fields.

## Out of scope, stated

- **Assumptions** (the A in RAID) — a work type the firm adds in configuration today;
  nothing about an assumption needs fields.
- **A risk matrix screen** — sorting the register by exposure is a view over stored
  likelihood × impact; worth its own pass with the portfolio work.
- **Mitigation as structure** — the mitigation lives in notes and nextAction, where the
  work already is.

## What would send this back

- A wish for exposure history over time (risk burndown) — that is versioning, a different
  mechanism.
- Non-5×5 matrices — the bands become configuration, not constants.
