---
name: axiomate-scenario-testing
description: This skill should be used when writing or extending Axiomate TMS's scenario-driven test suite — the project's real testing convention (data/validation.json, five verdicts, scenarios that pin real reducer arms). Use when a new feature needs test coverage, or when checking whether existing coverage for a capability is real or superficial. Load alongside axiomate-regression-testing's concerns when a change touches shared code.
---

# Axiomate Scenario Testing

Axiomate's real test convention, formalized here — not a generic testing methodology.

## The real structure

`scripts/scenario-validation.ts` runs every scenario against five possible verdicts:

```
PASS              — drives the actual reducer/derivation and gets the right outcome
PARTIAL           — drives real code but the outcome is incomplete or the trace stops short
                     of the full claim
FAIL              — drives real code and gets the wrong outcome
NOT TESTABLE       — cannot currently be driven end to end (missing a real dependency, e.g. a
                     third-party integration with no test double)
NOT IMPLEMENTED    — the capability the scenario names doesn't exist yet (checked via `absent()`
                     grepping source, not assumed)
```

`data/validation.json` is the committed baseline. CI (`.github/workflows/deploy.yml`) runs the
suite with a **regression gate**: it fails only if a scenario that was PASS stops being PASS —
new scenarios, or a verdict that improves, are reported but never block.

## What makes a scenario real, not superficial

A scenario **pins a real arm** — it imports and calls the actual reducer (`apply`), derivation
functions (`runWatch`, `capacityFor`, `rolesFor`, etc.) directly from `lib/*`, never a mock or a
hand-rolled stand-in. A scenario that asserts an outcome without driving real code is not a
scenario in this project's sense — it's decoration, and should be named NOT TESTABLE or
rewritten, not left looking like coverage.

## Writing a new scenario

1. Identify the real function(s) the capability lives in (`axiomate-domain-analysis`/
   `axiomate-project-allocation` for where domain logic lives, `axiomate-solution-architecture`
   for where a route/API lives).
2. Drive it with a realistic actor and realistic state — not the minimum input that happens to
   pass, the input a real user's action would actually produce.
3. Assert the FULL claim the scenario's name makes. A scenario named for a capability that only
   partially checks it should be marked PARTIAL, with the `stops` field naming exactly where the
   trace stops — this is more valuable than a scenario that quietly checks less than its name
   implies.
4. Give it a short id following the project's convention (two-to-four letters plus a number —
   e.g. the kind of ids already in `data/validation.json`) and add it alongside the domain area
   it belongs to.

## Regression testing — the same suite, a different question

"What could this change break?" is answered by the SAME scenario suite, run against the SAME
regression gate — there is no separate regression-testing mechanism to build.
`axiomate-code-review`'s gate-check step already runs this; a change that touches shared code
(a reducer arm many scenarios drive, a shared lib function) should be reviewed against which
existing scenarios exercise that code path, not just the scenario written for the new feature.

## Handoff

Full-suite verdict + everything else → `axiomate-release-readiness`.
