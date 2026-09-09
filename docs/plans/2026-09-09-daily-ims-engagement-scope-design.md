# Scoping the auto-emailed daily IMS to one engagement

**Status: built, 9 September 2026.** User's direct request — *"I need a daily report on progress
of engagement"* — followed by *"Yes, check the toggle and scope it to one engagement"* once the
research below was reported back.

## What already existed, checked before building anything

Almost everything the request named was already built. `lib/reports/dailyIms.ts`'s **Daily IMS**
covers position (open/closed, severity, overdue/at-risk/blocked/unscheduled), movement in the
last 24 hours from the audit trail, and six actionable sections (Overdue, Blocked, At risk, No
owner, No next action, Quiet 2+ weeks) — counted from real records, never estimated, with the
report itself distinguishing a quiet day from an unavailable audit trail.

`docs/plans/2026-08-30-report-delivery-design.md` (approved 30 Aug) already wired the Daily IMS
to auto-send as a branded PDF every weekday, via `runScheduledPass`'s delivery phase
(`lib/db/schedule.ts`). Checked live in production: **the toggle is already on** —
`reportDelivery.imsEnabled: true`, recipient `sekharn@axiocloudsolutions.com`, and the scheduled
pass itself is confirmed running (last ran 2026-09-09 01:30 UTC, triggered by the Logic App
that's been live since 17 August). Manual on-demand export already supported per-engagement
scope too — filter the workspace to one engagement, click "Daily IMS — status report".

**The one real gap**: the auto-emailed version always covered `'All clients'`
(`buildDailyIms(state, rows, today, 'All clients')`, `rows` from the unfiltered tree) —
hardcoded, no way to narrow it. That's what this change adds.

## Shape

**Not the client-packs' fan-out pattern.** The weekly/monthly packs already send one email per
client automatically (`lib/reports/clientPack.ts`'s loop over every external-party node). The
user's own words — "scope it to **one** engagement" — asked for narrowing the existing single
IMS email, not multiplying it into one-per-engagement. Fanning out was considered and set aside:
it changes recipients' inbox volume from 1/day to N/day without being asked, and the manual
on-screen export already covers "I want today's numbers for engagement X" for anyone who wants a
different one on demand.

- `ReportDeliveryConfig` (`lib/reports/delivery.ts`) gains `imsScopeNodeId: string | null` —
  `null` (default) keeps today's unscoped behaviour byte-identical; a node id narrows the IMS to
  that node's subtree.
- `setReportDelivery`'s reducer arm (`lib/workspace.ts`) validates the id against `state.nodes`
  when set — a deleted or invented scope is refused outright (*"That scope no longer exists in
  the tree"*), rather than silently mailing an empty report. Proven by scenario `DL2`.
- `lib/db/schedule.ts`'s `runDelivery` filters rows to the scope's subtree via `underScopeOf`
  (exported from `lib/reports/clientPack.ts`, where the identical ancestry-walk already existed
  for the packs' pre-boundary total — reused rather than a third copy) and passes the node's own
  name as the report's `scope` label instead of the hardcoded string. The email subject also
  names the engagement (`Daily IMS — <name> — <date>`) so a scoped report doesn't read
  identically to an unscoped one in an inbox.
- Configuration → Scheduled pass → Report delivery gains a **"Scope the IMS to"** selector,
  listing live engagement-tier nodes (`kind === 'engagement'`) — deliberately narrower than the
  "Files under" picker elsewhere in Configuration, which offers every tier: the one control this
  feature needs answers "which engagement", not "which node at any tier".

## What this does not change

The weekly/monthly client packs, the resolution-notice prompt, and the manual on-screen Daily IMS
export are all untouched — each already had its own correct scope (per-client fan-out, or
whatever the screen's live filters say). Only the scheduled Daily IMS's single hardcoded scope
changes.

## Verification

Clean `tsc`, clean build, scenario `DL2` (259 scenarios total, +1, zero regressions), clean
`audit:tenancy`/`audit:attribution`/`audit:restore`.
