---
name: axiomate-feature-builder
description: This skill should be used when implementing a non-trivial feature in Axiomate TMS end to end — it orchestrates the other 10 foundational skills in the real build sequence this project already follows (requirement → domain → UX → architecture → implementation → testing → review), rather than each skill being invoked ad hoc and out of order. Use this as the entry point for "build X"; it hands off to the specific skill for each stage.
---

# Axiomate Feature Builder

The main implementation skill — an orchestrator, not a new methodology. Each stage below hands
off to an existing, more specific skill; this skill's job is sequencing and making sure a stage
isn't skipped, not duplicating what those skills already do.

## The real sequence

```
1. Requirement    → axiomate-requirement-analysis
                     (Problem/User/Goal/Rules/Functional+Non-functional/Acceptance)
2. Domain fit      → axiomate-domain-analysis, axiomate-work-model
                     (does this extend an existing tier/kind/status, or is it genuinely new)
3. Resourcing      → axiomate-project-allocation, axiomate-capacity-planning
                     (only if the feature touches allocation/assignment/timesheet/capacity)
4. UX              → axiomate-ui-design, axiomate-screen-builder
                     (placement decision, component reuse — per docs/design/)
5. Architecture    → axiomate-solution-architecture
                     (which layers this touches, tenancy checklist for anything new in the db)
6. Estimation      → axiomate-estimation
                     (if sizing is needed before committing to build)
7. Implementation  — the actual code, following what stages 1-6 determined. No stage here of
                     its own; this is where the other skills' findings get executed.
8. Testing         → axiomate-scenario-testing
                     (real scenario pinning the real code path, not a superficial assertion)
9. Review          → axiomate-code-review (or enterprise-ux-reviewer for UI-heavy changes)
10. Release        → axiomate-release-readiness
                     (only for changes significant enough to need a readiness assessment —
                     most single-feature changes don't, they just need the standing gate)
```

## Discipline this orchestration exists to protect

1. **Never skip stage 2.** The single most common failure mode this project has already hit
   twice today is building something that assumes a domain concept exists (Story, Bug, a
   fifth resource layer) when it doesn't. Domain fit is cheap to check and expensive to
   discover wrong after implementation.
2. **Stage order matters for stage 5 specifically.** Architecture decisions (does this need a
   new table, does it need RLS) depend on stage 2's answer — architecting before domain fit is
   settled produces a schema shaped around a misunderstanding.
3. **The standing gate runs regardless of scope.** `npx tsc --noEmit` → the relevant `audit:*`
   scripts → `npm run audit:a11y` (UI) → `npm run validate:scenarios` → `npm run build` — every
   feature, no exceptions, per `axiomate-code-review`'s own checklist.
4. **A feature that only touches UI still starts at stage 1-2**, even briefly — "just a UI
   change" has been the source of real domain confusion in this project's own history (the
   Configuration nav drift, several corrections made to the design-system docs themselves
   after the first extraction pass got things wrong). Skipping straight to stage 4 is how that
   happens again.

## When NOT to use this skill

A change scoped to exactly one file with no domain, resourcing, or UX surface (a bug fix, a
one-line config correction) doesn't need the full sequence — go straight to implementation and
the standing gate. This skill is for work substantial enough that skipping a stage would cost
more than running it.
