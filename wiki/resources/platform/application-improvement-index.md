---
type: resource
title: "Application Improvement Index"
created: "2026-08-30"
tags:
  - resource
  - assessment
---

# Application Improvement Index

AII = Performance + Reliability + Quality + Security + UX + Maintainability + Delivery +
Cost + Business Value. Scored 0–10 per dimension from evidence in this workspace, not
impression. Re-score after each phase; the honest gaps ARE the backlog.

> [!note] Re-scored 2026-08-31
> 65 → 76.5. Every point of movement traces to a landed, evidenced phase, not sentiment:
> R1 alerting ([[alerting]]) and R2 restore drill ([[restore-drill]]) close Reliability's
> named gap; R4 ([[performance-baseline]]) replaces "nothing measured" with numbers, plus
> the boot-slimming fix it drove (2,991 → 1,409 KB); CI ([[verification-gates]],
> `.github/workflows/deploy.yml`) closes Delivery's named gap; npm audit was triaged;
> the full Hive steal-list (search, saved views, My Week, first-run) plus the clean-shell
> layout restructure — deployed and user-walkthrough-confirmed "Nothing looks wrong" — move
> UX from expert-operator-shaped to genuinely close to Hive's polish. What did NOT move:
> the API key is still unrotated (it sat in a chat transcript — the single sharpest
> remaining Security gap), and Business Value stays conservative because adoption is still
> thin — no real timesheet week has been submitted and approved yet.

**As at 2026-08-31: 76.5 / 90** (was 65 / 90 on 2026-08-30)

| Dimension | Score | Evidence | The gap |
|---|---|---|---|
| Quality | 9 | 192 scenarios / 0 FAIL; six audits; sentinel scans; golden values | remaining PARTIALs are the honest backlog; P1s D (one Graph consent) and ST2b (test tenant) |
| Maintainability | 9 | design+plan per phase; doctrine comments; the suite as a corrected map; session memory; the clean shell added three shell components without touching a single view's own logic | keep the map honest as it grows |
| Cost | 9 | B1 + flexible Postgres + 2 Logic Apps on sponsorship; heavy deps out of the client bundle; flat despite the steal-list phase | upsize only when measured |
| Reliability | 9 | R1 alerting closes the empty-action-group hole; R2 restore drill proven (~5–6 min, 39/39 tables); serializable tx; idempotency + pruning; proven daily pass | still a single instance; no redundancy |
| Security | 8 | forced RLS everywhere; Entra; boot redaction; boundary sentinel proofs; npm audit triaged this session | **API key still unrotated** (it sat in a chat transcript); no external review |
| UX | 8.5 | R4-driven boot slimming; the full Hive steal-list shipped (search, saved views, My Week, first-run); the clean-shell restructure — sidebar nav, overlay drawer, per-view filters, calm tokens — deployed and user-confirmed "Nothing looks wrong"; Configuration's own nav re-skinned to match | onboarding still rough at the very first sign-in for a consultant with nothing recorded yet (first-run helps, hasn't been tested on a real new hire) |
| Performance | 8 | R4 measured every headline number (boot payload, load times, bundle split, pass duration); boot payload cut 53% by truncating audit text in transit | authenticated full-page p95, cold-start distribution, and concurrent-user contention still not yet measured |
| Delivery | 9 | R4 evidence plus: CI now gates the deploy job behind the standing gate (`.github/workflows/deploy.yml`); staged foreground deploys with full gates stayed ~5 min throughout the steal-list and clean-shell phases | rollback is still folklore, not a rehearsed procedure |
| Business Value | 7 | everything from before, plus search, saved views, My Week, first-run, in-mail, and the client portal staged (guest invited, not yet walked through) all live | value realized still ≪ value built: still one active user, no real week submitted+approved yet, consultants not onboarded |

## Leverage order

1. **Rotate ANTHROPIC_API_KEY** — the one remaining item from the old security-hygiene line;
   cheap, and it closes the sharpest named gap left on the board.
2. **Adoption** — submit/approve the real weeks, onboard consultants, grant the D consent,
   walk the portal through. Raises Business Value + UX together; almost no code.
3. **External security review** and the two unmeasured performance numbers (authenticated
   p95, cold starts) — the next tier once the above are done.

## Related

- [[verification-gates]]
- [[alerting]], [[restore-drill]], [[performance-baseline]]
- Projects: [[report-delivery]], [[key-day]]
