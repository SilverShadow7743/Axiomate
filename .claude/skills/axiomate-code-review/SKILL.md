---
name: axiomate-code-review
description: This skill should be used when reviewing Axiomate TMS code before commit — correctness, architecture, security, maintainability, performance, tests, and domain-rule adherence. It borrows the BLOCKER/HIGH/MEDIUM/LOW severity labels from the claude-obsidian:verifier convention already used in this workspace, but builds its actual review criteria from this repo's real gates — no six-cut kernel or equivalent exists in Axiomate itself. Use enterprise-ux-reviewer for UI-specific review; use this for everything else.
---

# Axiomate Code Review

No formal review kernel exists in this repo — the BLOCKER/HIGH/MEDIUM/LOW severity scheme is
borrowed from `claude-obsidian:verifier` (an external plugin convention, generic enough to
reuse), but every actual check below is this project's own, drawn from its real gates.

## Severity

```
BLOCKER — breaks the standing gate, breaks tenant isolation, or ships without actor attribution
CRITICAL — a real data-integrity or security defect, not yet gate-visible
HIGH     — a domain-model violation (collapsing Allocation/Assignment/Timesheet, inventing a
           work-item kind, bypassing canParent/allowedNext)
MEDIUM   — maintainability, missed reuse of an existing pattern, incomplete test coverage
LOW      — style, naming, a comment that would help but isn't load-bearing
```

## What to check, in order

1. **Does it pass the real standing gate?** `npx tsc --noEmit` → `npm run audit:tenancy` → `npm
   run audit:attribution` → the relevant `audit:*` scripts for what changed (`audit:restore`,
   `audit:estimation`, `audit:discussion`, `audit:persistence`, `audit:rls`) → `npm run
   audit:a11y` (UI changes) → `npm run validate:scenarios` (192+ scenarios, regression-gated —
   nothing that was PASS may stop being PASS) → `npm run build`. A change that hasn't been run
   through this is not reviewable, only readable.
2. **Tenant isolation** — every new `lib/db/*.ts` call site runs inside `withTenant()` AND names
   the tenant explicitly (`axiomate-solution-architecture`'s two-layer model). A new
   tenant-scoped table has `FORCE ROW LEVEL SECURITY` and a policy, not just an app-layer check.
3. **Actor attribution** — every write names its actor; `audit:attribution` proves audit trails
   differ between two actors performing the same action. A write with no actor parameter is a
   BLOCKER, not a style note.
4. **Domain-model fidelity** — check against `axiomate-domain-analysis`/`axiomate-work-model`/
   `axiomate-project-allocation`: does this invent a work-item kind, collapse Allocation into
   Assignment, or bypass `canParent`/`allowedNext`? These are HIGH by default, not MEDIUM —
   they're cheap to fix now and expensive once other code depends on the wrong model.
5. **The person/personId seam** — any new or touched code on `Allocation`, `Commitment`,
   `TimeEntry`, or `Timesheet` that assumes `personId` is always populated is a real bug
   waiting to surface, not a hypothetical.
6. **Reuse over invention** — does this duplicate a pattern `axiomate-ui-design`,
   `axiomate-project-allocation`, or `axiomate-domain-analysis` already names? Cite the existing
   pattern in the finding rather than just flagging duplication abstractly.
7. **Tests** — did the change add or update a scenario (`axiomate-scenario-testing`) pinning the
   real code path, not just assert an outcome against a mock?

## Output

Findings ranked worst-first, each with file:line, the severity, and — critically — which real
check or reference it violates (cite the gate script, the schema field, or the skill/doc). A
finding with no real citation behind it is a guess, not a review result; say so if you're
genuinely uncertain rather than manufacturing confidence.
