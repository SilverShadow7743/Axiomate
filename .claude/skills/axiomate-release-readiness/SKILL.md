---
name: axiomate-release-readiness
description: This skill should be used when assessing whether Axiomate TMS is ready to release — combining scenario coverage, regression, security, data integrity, and deployment validation into one evidence-based verdict. It formalizes the REAL format already used in wiki/resources/platform/release-readiness.md (a Verdict section plus a risk-ordered priority checklist) rather than inventing a new one — read that document's current state before writing a new assessment.
---

# Axiomate Release Readiness

**Evidence-based, not opinion-based** — the product owner's own stated bar, and already how
this project's real readiness doc works. Don't invent a new format; the existing one
(`wiki/resources/platform/release-readiness.md`) already does this correctly.

## The real format to follow

- A **Verdict** section: 🟢 READY / 🟡 READY WITH CONDITIONS / 🔴 NOT READY, with a dated
  callout explaining what changed since the last assessment (never silently overwrite a prior
  verdict's history).
- A **Priority order (risk × likelihood × cost)** checklist — items get struck through with
  `**DONE** date — [[link]]` as they're resolved, never deleted. A stale item genuinely still
  open stays visible, not buried.

## What feeds the verdict

```
Requirement coverage    — does shipped behavior match what was asked? (axiomate-requirement-analysis)
Scenario coverage       — real PASS rate, not just "tests exist" (axiomate-scenario-testing)
Regression              — nothing that passed stops passing (the CI regression gate, already real)
Security                — tenant isolation both layers, actor attribution (axiomate-code-review,
                           axiomate-solution-architecture)
Data integrity           — no orphaned records, no broken references (a future
                           axiomate-data-integrity skill's concern — until it exists, check
                           manually against known seams: person/personId, tier placement)
Performance              — measured, not assumed (this project has a real R4 performance
                           baseline precedent — cite the actual measurement, don't estimate)
UX                        — axiomate-ux-review's real checklist, not generic accessibility advice
Deployment validation     — the real staged-deploy recipe: build → package → migrate status →
                           deploy → health-check by response BODY (`"database":"connected"`,
                           not just HTTP status) — this project's health check is deliberately
                           stricter than a 200 OK
```

## Process

1. Read the CURRENT `wiki/resources/platform/release-readiness.md` before writing anything —
   don't re-derive from scratch what's already tracked; update it.
2. Score each area above against real evidence — a gate that actually ran, a scenario verdict
   that's actually PASS, a measurement that actually happened. "Should be fine" is not evidence.
3. The verdict does not need to be GREEN to be honest — AMBER with a clear, prioritized,
   risk-ordered list of what's blocking GREEN is more useful than an optimistic GREEN that
   glosses over a real gap.
4. Update the doc in place, with the dated re-score callout, rather than creating a parallel
   assessment.
