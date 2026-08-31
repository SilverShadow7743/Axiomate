---
name: axiomate-acceptance-criteria
description: This skill should be used when converting an Axiomate TMS requirement into testable Given/When/Then scenarios. Like axiomate-requirement-analysis, this is NEW process — no engineering acceptance-criteria system exists in the codebase. Critically, do not confuse this with ScopeItem.kind='acceptance', which is a different, pre-existing, unrelated concept (commercial SOW scope tracking). Load after axiomate-requirement-analysis, before axiomate-scenario-testing.
---

# Axiomate Acceptance Criteria

**New process, and a real naming trap to avoid.** `ScopeItem.kind` already includes an
`'acceptance'` value (`prisma/schema.prisma`) — but that's for tracking what's in/out of scope
under a commercial Statement of Work, a completely different concern from engineering
acceptance criteria. Never write code that reuses `ScopeItem`'s `'acceptance'` kind for this
skill's output; the collision is in the word only, not the concept.

## The framework

For each functional requirement from `axiomate-requirement-analysis`, write:

```
Given <a state of the system — cite a real domain state: an issue's status, a person's
       allocation, a timesheet's frozen/unfrozen state>
When  <an action — a real reducer arm or user action, not an abstract verb>
Then  <the outcome — a real, checkable state change or refusal>
```

Cover, for every requirement, not just the happy path:

- **Positive** — the intended outcome under normal conditions.
- **Negative** — what should be refused, and how the refusal is communicated (this codebase's
  own convention: a refusal comes back as a teaching message, not a bare error — see
  `axiomate-domain-analysis`'s access-gate pattern, `can()`).
- **Boundary** — the edges of a range (an allocation at exactly 100%, a timesheet on the last
  day before freeze, an estimate score at 0 or 5).
- **Permission** — does this outcome differ by role/responsibility? Cite the real gate
  (`can(model, actor, key)`), don't invent a permission model.
- **State-transition** — for anything touching the status graph
  (`lib/statusPolicy.ts`'s `allowedNext`) or the timesheet freeze
  (`lib/timesheet.ts`'s `isFrozen`), write the criterion against the REAL transition law, not
  an assumed one.

## Handoff

Each Given/When/Then criterion becomes exactly one scenario in `axiomate-scenario-testing` —
write them 1:1 so coverage is traceable back to the requirement that demanded it. A criterion
that can't be turned into a scenario pinning real code (per that skill's "real, not
superficial" rule) usually means the requirement itself was underspecified — send it back to
`axiomate-requirement-analysis` rather than writing a scenario that doesn't actually check
anything.
