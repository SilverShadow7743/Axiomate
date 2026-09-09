# Scoping the auto-emailed daily IMS to one engagement — or every engagement, automatically

**Status: built, 9 September 2026.** User's direct request — *"I need a daily report on progress
of engagement"* — followed by *"Yes, check the toggle and scope it to one engagement"*, then,
once a single-scope selector was built and shown live, *"Automate for every engagement with
proper indentation"*. That phrase was ambiguous between two real shapes (one combined report with
indented per-engagement sections, or one separate email per engagement) — asked directly rather
than guessed, given this touches a feature that emails people automatically. Answer: **one email
per engagement**, the same shape the weekly/monthly client packs already use.

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

Two delivery shapes now exist for the daily IMS, both off the same underlying data:

**1. A single, optionally scoped email** (built first, from "scope it to one engagement"):

- `ReportDeliveryConfig` (`lib/reports/delivery.ts`) gains `imsScopeNodeId: string | null` —
  `null` (default) keeps the original unscoped behaviour byte-identical; a node id narrows the
  IMS to that node's subtree.
- `setReportDelivery`'s reducer arm (`lib/workspace.ts`) validates the id against `state.nodes`
  when set — a deleted or invented scope is refused outright (*"That scope no longer exists in
  the tree"*), rather than silently mailing an empty report. Proven by scenario `DL2`.
- Configuration → Scheduled pass → Report delivery gains an **"Or scope the single IMS to"**
  selector, listing live engagement-tier nodes (`kind === 'engagement'`) — deliberately narrower
  than the "Files under" picker elsewhere in Configuration, which offers every tier: the one
  control this half needs answers "which engagement", not "which node at any tier".

**2. Fanned out one email per engagement** (built second, from "automate for every engagement"):

- `ReportDeliveryConfig` gains `imsPerEngagement: boolean` (default `false`). When `true` it
  overrides `imsScopeNodeId` — `lib/db/schedule.ts`'s `runDelivery` loops every live
  engagement-tier node, same shape `sendPacks` already uses for clients: one PDF per engagement
  per recipient, an engagement with nothing under it skipped rather than mailing an empty report
  to eyeball, and the whole batch's `imsSentOn` stamp only advances once every non-empty
  engagement's send succeeded (`allOk` starting `true` and only ever set `false` by a real
  failure — the same "all-empty is a complete outcome and must still stamp" reasoning
  `sendPacks`'s own `allOk || !any` already encodes, without needing a second flag here). Each
  email's subject and attachment filename name their own engagement
  (`Daily IMS — <name> — <date>`), so two engagements' reports never collide in an inbox or a
  downloads folder.
- Configuration gains a **"Send one automatically for every engagement"** checkbox, right above
  the single-scope selector, which it disables when checked.

Both share `underScopeOf` (exported from `lib/reports/clientPack.ts`, where the identical
ancestry-walk already existed for the packs' pre-boundary total — reused rather than a third
copy) and the same `buildDailyIms`/`renderImsPdf` pipeline; only which rows go in and how many
emails come out differ.

## What this does not change

The weekly/monthly client packs, the resolution-notice prompt, and the manual on-screen Daily IMS
export are all untouched — each already had its own correct scope (per-client fan-out, or
whatever the screen's live filters say). Only the scheduled Daily IMS's delivery shape changes.

## A verification limit, named rather than glossed over

Scenario `DL2` proves the reducer half — `imsScopeNodeId`/`imsPerEngagement` set, clear, and
refuse correctly. The *send-time* fan-out logic in `lib/db/schedule.ts` (which engagements get
skipped, whether the stamp advances, what each subject line says) is not reachable by the pure
scenario harness — the same limit the packs' own fan-out has always had, never claimed to be
covered by a scenario either. It was checked by direct code reading against the packs' proven
pattern, not by running it against production, since running it would mean actually emailing
people.

## Verification

Clean `tsc`, clean build, scenario `DL2` (259 scenarios total, +1, zero regressions), clean
`audit:tenancy`/`audit:attribution`/`audit:restore`/`audit:persistence`.
