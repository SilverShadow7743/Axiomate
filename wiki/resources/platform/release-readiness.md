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

## Verdict, as at 2026-08-31

> [!note] Re-scored 2026-08-31
> Three of the original seven priority items are done (R1, R2, R4 — each left its executable
> pin: [[alerting]], [[restore-drill]], [[performance-baseline]]), plus CI beyond the
> original list and the full Hive steal-list + clean-shell UX phase. The verdict stays
> AMBER, not GREEN — score it on what's still actually open, not on momentum: the API key
> is still sitting unrotated, no real timesheet week has been submitted and approved, the
> portal is staged but not walked through, and A6 (drive-id/consent) is untouched.

**AMBER — Conditional.** The business core is release-grade (192 scenarios, 0 FAIL, six
proofs, DB-enforced isolation, driven audit trail) and already operating, now with alerting
that reaches a real inbox, a proven restore path, measured performance, and a CI gate in
front of every deploy. What still holds it at AMBER is narrower than before but real: the
API key that entered a chat transcript is still live and unrotated, adoption is still at one
active user with no approved week yet, the client portal is staged but unwalked, and
accessibility remains at static-lint level only (no manual screen-reader pass).

## Priority order (risk × likelihood × cost)

1. ~~Alerting on pass/drain/delivery failure — R1~~ **DONE** 2026-08-30 — [[alerting]]
2. ~~Backup restore rehearsal — R2~~ **DONE** 2026-08-30 — [[restore-drill]]
3. **Rotate the API key, then key-day — R3 + unblocks AI1.** Still open — the single sharpest
   remaining item on this list.
4. ~~Measure performance (boot payload, p95, pass duration) — R4~~ **DONE** 2026-08-31 —
   [[performance-baseline]] (and its own follow-on fix: boot payload cut 53%)
5. **Adoption week: submit → approve → finance xlsx read-back; onboard two consultants.**
   Still open.
6. **Documents consent + drive-id.** Still open — flips P1 scenario D with no code.
7. **Keyboard walkthrough of record→submit→approve before onboarding.** Still open.
8. *(beyond the original list)* ~~CI gate in front of every deploy~~ **DONE** —
   `.github/workflows/deploy.yml`, [[verification-gates]].
9. *(beyond the original list)* **Walk the staged client portal through end to end** — the
   guest was invited (PendingAcceptance); confirming access and the disclosure boundary live
   is the last step the Hive-comparison steal-list left open.

Every item, once done, must leave an executable pin — a scenario, proof, or alert.

## Related

- [[application-improvement-index]]
- [[verification-gates]]
- [[hive-comparison]]
