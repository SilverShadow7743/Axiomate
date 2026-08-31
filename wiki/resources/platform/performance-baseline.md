---
type: resource
title: "Performance baseline"
created: "2026-08-30"
tags:
  - resource
  - assessment
---

# Performance baseline

First measurements ever taken (2026-08-30, production data, B1 Linux 1.75GB single instance).
Re-measure after adoption grows; the numbers, not impressions, decide when to act.

## Measured

| Metric | Value | Reading |
|---|---|---|
| Boot state payload (JSON) | **2,991 KB** | 259 issues · 21 entries · 1,050 audit rows — ~11.5 KB/issue |
| loadWorkspace (remote client → DB) | 2,146 ms | server-side same-region will be well under this |
| buildTree | 34 ms / 277 rows | client compute is not the constraint |
| /api/health (warm) | 166–389 ms | fine |
| / redirect (warm) | ~205 ms | fine; first hit 1.03 s |
| First-load shared JS | 430 KB (4 files) | exceljs (912 KB) and pdfkit stay in async/server chunks — verified |
| Scheduled pass run | ~4–10 s end to end | from Logic App run history |

## The one finding that matters — and its first fix (2026-08-31)

**The boot payload was the scaling ceiling.** Measured to the row: 28 audit entries carrying
imported email bodies as full before/after texts were 1.6 MB of the 3 MB payload (one row
143 KB); age-windowing was measured and rejected (94% of rows under a fortnight old). The
fix: `boot()` truncates audit `from`/`to` past 400 chars with a visible marker — **in
transit only, never at rest** (an audit `from` is often the only surviving copy of the
before). **Payload: 2,991 → 1,409 KB (−53%)**; commit 92e38db, deployed. Next target when
growth demands it: issues at 854 KB (the record itself — a lazy-archive split, not a trim).

## Not yet measured

Authenticated full-page p95 in a real browser; cold-start distribution; concurrent-user
contention. Worth a follow-up once more than one person uses it daily.

## Related

- [[release-readiness]] (R4)
