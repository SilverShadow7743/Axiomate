---
type: project
title: "Report delivery"
status: completed
created: "2026-08-30"
completed: "2026-08-31"
outcome: "ACHIEVED — the first unattended Monday batch (IMS + OAPIL weekly pack) landed 2026-08-31 01:30 UTC; stamps imsSentOn=2026-08-31, weeklySentFor=2026-08-24; a second same-day trigger sent nothing (dedupe proven live)."
tags:
  - project
related_areas: ["client-reporting"]
---

# Report delivery

## Outcome

The scheduled pass posts the mail: daily IMS to internal recipients on weekdays, each
client's weekly (Mondays) and monthly (the 1st) packs to the operator as branded PDFs —
eyeball, then forward. The finance report never auto-sends.

## Status

- **Current state:** shipped and ENABLED live (2026-08-30, commits 77cd0af…2376953); suite 188.
- **Deadline:** 2026-08-31 — the first real Monday batch (IMS + OAPIL weekly pack) via the Logic App.
- **Next action:** confirm Monday's emails arrived and open the PDFs; if refused, read the run
  report at `/api/schedule/run` (delivery.refused names the Graph status).

## Notes

- Design/plan: `docs/plans/2026-08-30-report-delivery-{design,plan}.md` — four recorded decisions.
- Stamps ride the pass's observation memory and are spread into EVERY write (runWatch rebuilds
  the object fresh — a bare write would erase them and re-arm double sends).
- Graph fileAttachment proven live with a manual OAPIL pack send (Sunday; nothing was due).

## Related

- Areas: [[client-reporting]]
- Resources: [[verification-gates]]
