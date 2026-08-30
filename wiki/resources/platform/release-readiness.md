---
type: resource
title: "Release readiness"
created: "2026-08-30"
tags:
  - resource
  - assessment
---

# Release readiness

The full 26-section evidence-based assessment (product map → feature/config catalogues →
scenario/UI/UX/role/workflow/rule/data/integration/orchestration matrices → security,
accessibility, performance, concurrency, recovery, audit, migration, regression → coverage
dashboard → risk register → gap analysis → verdict) lives as a shareable page:

**https://claude.ai/code/artifact/244df211-80cd-4a42-ad32-10bbc0b4a057**

## Verdict, as at 2026-08-30

**AMBER — Conditional.** The business core is release-grade (164/188 scenarios PASS, 0 FAIL,
six proofs, DB-enforced isolation, driven audit trail) and already operating. What holds it at
AMBER is operational: no alerting on unattended automation, backup restore never rehearsed,
performance unmeasured, key rotation pending, accessibility at static-lint level only,
adoption at one active user.

## Priority order (risk × likelihood × cost)

1. Alerting on pass/drain/delivery failure — R1, an afternoon
2. Backup restore rehearsal — R2, half a day, zero code
3. Rotate the API key, then key-day — R3 + unblocks AI1
4. Measure performance (boot payload, p95, pass duration) — R4
5. Adoption week: submit → approve → finance xlsx read-back; onboard two consultants
6. Documents consent + drive-id — flips P1 scenario D with no code
7. Keyboard walkthrough of record→submit→approve before onboarding

Every item, once done, must leave an executable pin — a scenario, proof, or alert.

## Related

- [[application-improvement-index]]
- [[verification-gates]]
