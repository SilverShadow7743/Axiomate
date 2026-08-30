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

## The one finding that matters

**The boot payload is the scaling ceiling.** ~3 MB of state ships to every browser at
one-user, 259-issue scale — linear growth puts 2,500 issues at ~30 MB. Nothing else measured
is close to a constraint. When adoption raises issue count or audit depth materially, the
answer is boot-payload slimming (cap the audit slice shipped, lazy-load archived issues)
BEFORE any plan upsize — the instance is not the bottleneck, the wire is.

## Not yet measured

Authenticated full-page p95 in a real browser; cold-start distribution; concurrent-user
contention. Worth a follow-up once more than one person uses it daily.

## Related

- [[release-readiness]] (R4)
