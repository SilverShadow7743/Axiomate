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

**As at 2026-08-30: 65 / 90**

| Dimension | Score | Evidence | The gap |
|---|---|---|---|
| Quality | 8.5 | 188 scenarios / 0 FAIL; four audits; sentinel scans; golden values | 23 PARTIALs; P1s D (one Graph consent) and ST2b (test tenant) |
| Maintainability | 9 | design+plan per phase; doctrine comments; the suite as a corrected map; session memory | keep the map honest as it grows |
| Cost | 9 | B1 + flexible Postgres + 2 Logic Apps on sponsorship; heavy deps out of the client bundle | upsize only when measured |
| Reliability | 7 | Serializable tx; idempotency + pruning; honest run reports; proven daily pass | single instance; NO alerting on pass failures / delivery refusals |
| Security | 7 | forced RLS everywhere; Entra; boot redaction; boundary sentinel proofs | rotate the API key (it entered a transcript); npm audit untriaged; no external review |
| UX | 6.5 | honest empty states; offline palette; print-ready packs | expert-operator-shaped; consultant onboarding rough (the Tarun incident); no mobile timesheets |
| Performance | 6 | bundle discipline (exceljs/pdfkit async-only) | nothing measured: full-state boot, cold starts, no profiling — unknown more than bad |
| Delivery | 6 | staged foreground deploys with full gates, ~5 min | manual and session-driven; no CI; rollback is folklore |
| Business Value | 6 | register → timesheets → finance → packs → delivery all live | value realized ≪ value built: one active user, 25h unsubmitted, consultants not onboarded |

## Leverage order

1. **Adoption** — submit/approve the real weeks, onboard consultants, grant the D consent.
   Raises Business Value + UX and closes a P1 with almost no code.
2. **CI** — a GitHub Actions workflow running the existing gate (tsc → scenarios → audits →
   build). An afternoon; Delivery 6 → 8.
3. **Security hygiene** — rotate ANTHROPIC_API_KEY, triage `npm audit`.

## Related

- [[verification-gates]]
- Projects: [[report-delivery]], [[key-day]]
