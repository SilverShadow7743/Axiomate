---
name: axiomate-requirement-analysis
description: This skill should be used when a business request, client email, or idea needs to be turned into a structured requirement before implementation work starts on Axiomate TMS. It is a NEW process this skill introduces — no structured requirement or Given/When/Then system exists in the codebase today — so it is honest about being methodology, not extraction, and hands off to axiomate-domain-analysis before anything gets built.
---

# Axiomate Requirement Analysis

**This is new process, not extracted convention.** Unlike the design-system and domain-model
skills in this project, there is no existing structured-requirement system in Axiomate's code
to formalize. `Sow.acceptanceCriteria` is free text under a commercial Statement of Work, and
`ScopeItem.kind` includes an `'acceptance'` value — but that taxonomy is for **commercial scope
tracking**, not engineering requirements. Don't reuse that vocabulary for this skill's output;
it already means something else in this codebase.

## The framework

```
Business Request
       ↓
Problem       — what's actually wrong or missing, in the requester's own terms
       ↓
User          — who experiences the problem (a role, not a person — check axiomate-domain-analysis
                 for whether this maps to an existing role/responsibility concept)
       ↓
Goal           — what changes if this is solved
       ↓
Business Rules — constraints that are true regardless of implementation
       ↓
Functional Requirements     — what the system must do
       ↓
Non-functional Requirements — performance, tenancy, accessibility, security bars this must clear
       ↓
Acceptance Criteria — hand off to a structured Given/When/Then per requirement (this skill's
                       own output, not axiomate-acceptance-criteria — that skill doesn't exist
                       yet in the 12-skill foundational set; write GWT scenarios inline here
                       until it does)
```

## Before finishing a requirement

1. **Check `axiomate-domain-analysis` first.** Most "new" requirements turn out to need an
   existing tier, work-item kind, status, or resource-model layer, not a new concept — the
   requirement should say which existing thing it extends, or explicitly justify why nothing
   existing fits.
2. **State assumptions as assumptions, not requirements.** A requirement that silently assumes
   something (e.g., that allocation implies assignment — see `axiomate-project-allocation`)
   propagates a domain-model mistake into implementation.
3. **Non-functional requirements are not optional filler.** Every feature in this codebase
   inherits tenant isolation, actor attribution, and (where UI-facing) the accessibility bar
   documented in `axiomate-ux-review` — state these explicitly rather than assuming they're
   understood.
4. **Hand off** — domain fit → `axiomate-domain-analysis`; UI placement →
   `axiomate-screen-builder`; effort → `axiomate-estimation`; full build orchestration →
   `axiomate-feature-builder`.
