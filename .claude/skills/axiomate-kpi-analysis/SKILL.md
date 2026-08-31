---
name: axiomate-kpi-analysis
description: This skill should be used when building or reasoning about KPI reporting in Axiomate TMS — utilisation, allocation, capacity, estimate accuracy, actual-vs-estimate, on-time delivery, cycle time, throughput, defects, rework. Some of these are directly computable from real fields today; others need new instrumentation. This skill states honestly which is which rather than presenting all ten as equally ready to report on.
---

# Axiomate KPI Analysis

**Every KPI should support a decision** — the product owner's own stated principle. A number
nobody acts on is not worth building a report for. This skill also states plainly which KPIs
are computable from real data TODAY versus which need new instrumentation first.

## Computable today, from real fields

- **Utilisation / allocation / capacity** — fully real (`axiomate-utilisation-analysis`,
  `axiomate-capacity-planning`). Not net-new work; extends existing formulas.
- **Estimate accuracy / actual vs. estimate** — `IssueEstimate.approvedEffortHours`
  (`axiomate-estimation`) against summed `TimeEntry.hours` for the same issue
  (`axiomate-timesheet`). Both fields are real; the comparison itself is a new report, not new
  data collection.
- **On-time delivery** — `Issue.plannedEndDate` vs. `actualEndDate`
  (`axiomate-scheduling`'s `ScheduleRow`). Both fields exist; "on time" is a derived boolean
  from the two, not a new field to add.

## Needs new instrumentation — say so, don't pretend otherwise

- **Cycle time / throughput** — needs a reliable "started" and "finished" timestamp trail per
  issue. `Issue` carries `raised` (per `axiomate-scheduling`'s `proposeTargetDate` signature)
  and the status-transition history (`axiomate-domain-analysis`'s attribution/audit trail
  records every status change with its actor and timestamp) — cycle time is DERIVABLE from the
  audit trail (time between the first "In Progress" transition and the terminal status), but no
  report computes this yet. This is real, available data with no dedicated surface — the same
  shape of gap as utilisation had before that skill's formula got built.
- **Defects / rework** — Axiomate has no dedicated "defect" work-item kind (per
  `axiomate-work-model`, only `issue`/`activity` exist) — a defect, if tracked at all, is an
  `Issue` with a particular work-type or severity, not a distinguishable kind. "Rework" (a
  status reversion — closed then reopened, or similar) is derivable from the same audit trail
  as cycle time, but again has no dedicated surface. Before building either metric, confirm
  with the domain owner whether "defect" should become a real work-type tag (the same pattern
  `axiomate-risk-management`'s `WT_RISK` already establishes) — don't silently redefine what
  counts as a defect inside a reporting query without that being a deliberate decision.

## Building a KPI report

1. State which category above the requested KPI falls into — computable now, or needs
   instrumentation first. A stakeholder asking for "defects this sprint" needs to hear that
   defects aren't a tracked concept yet, not receive a report that quietly redefines the term.
2. For computable KPIs, cite the exact fields feeding the number (per the list above) — a KPI
   report whose inputs can't be traced to real fields is not trustworthy, however plausible the
   output looks.
3. State what decision the KPI is meant to support, per the product owner's own principle — if
   nobody can name one, question whether the report is worth building before building it.
4. For anything needing new instrumentation, name the specific gap (a missing work-type tag, an
   uncomputed derived field) rather than treating the whole KPI as equally far off — cycle
   time's gap is "no report exists yet," not "no data exists."
