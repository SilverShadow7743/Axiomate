---
type: area
title: "Timesheets & finance"
created: "2026-08-30"
review_cadence: weekly
tags:
  - area
related_projects: []
---

# Timesheets & finance

## Scope

The weekly attestation loop (record → submit → approve, decider ≠ submitter) and the finance
timesheet report that rides on it — approved person-weeks only, named exceptions, branded
.xlsx + print-to-PDF, never any money columns. OUT of scope: rates and margin (a future
financial-dimensions phase owns money).

## Standards

- Every week with recorded hours gets submitted by month end; the finance report's exceptions
  list stays empty at period close.
- The report is generated and eyeballed by a person before it leaves — nothing auto-sends.

## Active state

- The operator's own weeks of 10/17/24 Aug 2026 (25h) are recorded and UNSUBMITTED — they show
  as exceptions, correctly. First approved week also unblocks the xlsx read-back verification.

## Reference material

- Export menu → "Finance timesheet…"; builder at `lib/reports/finance.ts`, pinned by scenario RF1.

## Review cadence

Weekly, at timesheet submission; monthly at the finance handover.
