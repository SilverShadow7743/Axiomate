# Reporting — the finance timesheet, progress in the client packs, and an honest RP2

**Status: approved 2026-08-30** (four explicit decisions, recorded below).
The phase after the platform evolution (E0–E5 complete): the suite's last P1 NOT IMPLEMENTED
(RP2) plus two direct user requirements, verbatim — *"i need selected or weekly and month
timesheet to submit it to finance"* and *"I also need daily IMS, Weekly and monthly reporting
client facing giving a understanding of progress."*

## What exploration corrected

RP2's verdict is STALE — a hardcoded entry written before the client-visible boundary
existed. In reality `lib/reports/clientPack.ts` (weekly + monthly, built strictly on
`clientView()`, with the shown/total disclosure line) and `lib/reports/dailyIms.ts` both
exist and ship from the Export menu, print-ready. What is genuinely missing: progress
content, branding, the finance report, and a scenario that drives what exists instead of
denying it. The map gets fixed as part of the phase — a map that overstates the gaps stops
being read.

## Decisions (settled with the user, 2026-08-30)

1. **Finance rows: approved hours only, person×project, billable split.** One summary row
   per client · engagement · project · person (billable h, non-billable h, total) plus a
   per-day detail; NO money columns — finance applies their own rates, and rate rows never
   leave the system. A person-week in the range whose timesheet is not Approved is LISTED as
   an exception, never silently included.
2. **Format and route: branded .xlsx or PDF, downloaded and sent by the user** (their own
   words: "Xlsx or pdf with branding and logo"). Both, from one dialog: an exceljs-generated
   workbook and a print-ready view for save-as-PDF. The user's eyes stay on everything that
   leaves.
3. **Client reports stay on-demand, branded, print-to-PDF** — person-in-the-loop; scheduled
   email is a named non-goal to revisit once content settles.
4. **"Understanding of progress" = period deltas + completion/schedule position** (the
   user's "Both"). The AI narrative stays a later opt-in — it needs the API key; these two
   need nothing.

**Approach:** one reporting foundation, three deliverables, no new storage — pure builders
computed live from loaded state (the packs' own rule: a report that can disagree with the
tree behind it stops being trusted). Rejected: a report-run store with scheduling (stored
reports drift; on-demand was chosen), and CSV-only (fails the branding requirement).

## The finance timesheet report

- `lib/reports/finance.ts`, pure: `buildFinanceReport(state, from, to)` →
  `{ summary, dailyDetail, exceptions, period }`. Approved-only is resolved per person-week
  via the timesheet rows (`sheetFor`); entries join by date range; billable split from the
  entry flag. Exceptions carry person, week and status ("Submitted — awaiting decision",
  "not submitted") so finance sees what is missing rather than assuming completeness.
- **Period pickers:** a chosen week, a calendar month, or a custom from/to — the user's
  "selected or weekly and month" — in a "Finance timesheet…" dialog off the Export menu,
  with the summary previewed on screen before anything is generated.
- **Outputs:** Download .xlsx — exceljs (new dependency), generated CLIENT-SIDE from the
  same rows the preview showed, three sheets (Summary, Daily detail, Exceptions), branded
  header; and Print / save as PDF — a print-ready report view in the client-pack pattern.
- **What never appears, pinned by scenario sentinel-scan:** rates or amounts, leave reasons,
  internal note text. Hours, names, projects, dates — nothing else.

## Branding

A shared report header for all four surfaces (daily IMS, weekly pack, monthly governance,
finance): firm name and short name from `OrganizationIdentity`, report title, period,
generated date — plus an optional **logo**: a new `logoDataUri` field on the identity config
(small PNG pasted/uploaded in Configuration), rendered when present; absent means clean
wordmark styling, never a broken image. The config travels the model like every identity
field; no storage change beyond the JSON blob.

## Progress in the client packs

`buildWeeklyClientPack` / `buildMonthlyGovernancePack` gain, per engagement line — computed
AFTER `clientView()`, so only client-visible records feed every number, and the disclosure
line keeps counting what was withheld:

- **Period deltas:** closed in the period (from `actualEnd`), newly raised (from `raised`) —
  derived from record dates, deliberately NOT from the capped audit trail, so the numbers
  are complete however old the period.
- **Completion/schedule position:** % complete rollup, on-track vs overdue counts, and the
  projected finish where a plan exists — fields already on client-visible records.

Daily IMS gains the branded header; its content is untouched.

## The map fixed

- RP2 becomes a DRIVEN scenario: both packs built from a fixture holding internal-only
  records and notes with sentinel strings; assert the sentinels are absent, the progress
  fields compute, and the disclosure line counts shown/total honestly. Verdict earned, not
  declared.
- A new scenario pins the finance builder: approved-only inclusion, the exceptions rule, a
  week straddling the period edge counts only its inside days, and the sentinel scan.

## Error handling

An empty period says so ("No approved hours between …") rather than producing an empty
file; the exceptions sheet exists even when empty ("every week in range is approved"); logo
parsing failures fall back to wordmark styling silently-visibly (the header renders, the
image does not).

## Non-goals

Scheduled or emailed delivery (revisit after content settles), money/rate columns, stored
report runs, the AI progress narrative (a config flip after key-day), per-client report
customization.

## What would send this design back

- If approved-only cannot be resolved cleanly because production timesheets are sparsely
  submitted (most hours would land in exceptions, not the report) — the inclusion rule
  reopens toward "approved plus submitted, labeled", a decision for the user, not a quiet
  widening. Surfaces when the builder meets production data.
- If exceljs cannot produce the branded workbook client-side within reasonable bundle cost,
  generation moves server-side behind the session gate — a placement change, not a redesign;
  but if branding demands true pixel fidelity beyond xlsx styling, the xlsx half shrinks to
  data-only and PDF carries the brand. Surfaces at the xlsx step.
- If the progress deltas disagree with what the packs' current-state counts imply (a record
  closed-and-reopened straddling periods), the delta definitions need the user's ruling
  rather than a silent choice. Surfaces in the scenario fixtures.
