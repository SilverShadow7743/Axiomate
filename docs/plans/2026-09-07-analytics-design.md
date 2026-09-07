**Status: built, 7 September 2026**, same day as the design — `lib/analytics.ts` (pure functions,
no schema, no reducer arm needed), a new `Analytics` sidebar view (`components/AnalyticsView.tsx`).
Four scenarios (AN1–AN4) drive the pure functions directly; all PASS, alongside all 239
pre-existing scenarios. `tsc --noEmit`, `npm run build` and `npm run audit:tenancy` all clean.

# Analytics — cross-tabs over the live register, not trend lines the data can't support

*7 September 2026. From the Hive gap survey's "Analytics" line. The obvious shape — a chart of a
metric over time — is not honestly buildable today, and this design says why rather than faking
it, before saying what is.*

## Why not a trend line

A trend chart needs the same fact measured repeatedly over time. This codebase's own doctrine —
stated first in `lib/portfolio.ts`, restated in `lib/goals.ts`, restated again in the Application
Suite design — is that derived values are computed on every read and never stored as fact. Nothing
in this codebase captures a daily or weekly point-in-time count of anything. `Snapshot`
(`prisma/schema.prisma`) is the one thing that freezes a number, and it is a deliberate, manual
act taken per-project at a specific moment (a baseline before a re-plan) — not an automatic time
series, and reading `Snapshot` rows as one would misrepresent what they are for.

`ScheduleAudit` has real per-event timestamps, but it is capped (`auditWindow()`,
`lib/db/repo.ts`) and records field-level changes, not period-boundary counts — reconstructing
"open issue count on the 1st of each month for the last six months" from it would mean replaying
every change since the cap, an expensive and fragile thing to build for a chart nobody asked to
see specifically.

**So this design does the honest thing available: a live cross-tab, computed from the register as
it stands right now, refreshed every time the view is opened — same discipline `lib/portfolio.ts`
already applies to its own concern counts.** A trend view is a real, separate design, gated on
this codebase actually capturing period snapshots on a schedule, which it does not do today.

## What it shows

Firm-wide, across every client and engagement at once — the one cross-cutting view `Portfolio`
does not offer, because `Portfolio` is deliberately per-engagement. Four cross-tabs, each a table
of counts, each answering a question `lib/portfolio.ts`'s own doctrine would recognise — a
named count, not a score:

- **By severity × status** — how much High/Medium/Low work sits in each status, firm-wide.
- **By client** — open count, and of that, how many are High severity — the two facts
  `lib/portfolio.ts` already leads with per engagement, rolled up across all of them.
- **By age bucket** — 0–7 / 8–30 / 31–90 / 90+ days since raised, open issues only. Bucketed
  rather than an average, because an average of ages hides exactly the long tail a firm needs to
  see (ten issues at 3 days and one at 400 days averages to a number that alarms nobody).
- **By owner** — open count per person, the same figure `CapacityPanel` already computes for
  allocation but not shown firm-wide in one table today.

Every figure is `Object.values(state.issues).filter(...)`, computed in `lib/analytics.ts` as pure
functions with no clock and no I/O — the same shape `lib/portfolio.ts`'s `summariseScope` already
takes. No new schema, no new reducer arm, no new permission: this is a read view over data every
other screen already reads, gated on whatever already gates seeing the issue register (no
narrower access than Tree or Board already grant).

## Where it surfaces

A new `Analytics` workspace view, sidebar entry beside `Portfolio` — `lib/viewChoice.ts`'s
`WORKSPACE_VIEWS` gains `'analytics'`. Internal-only, like `Applications`: not added to
`CLIENT_GROUPS` in `AppSidebar.tsx`, because a client should not see a firm-wide cross-tab of
every other client's work.

## What this does not do

No trend over time — see above. No forecasting, no anomaly detection, no AI-generated
commentary — `axiomate-vision.md`'s own generative-reasoning gate applies here exactly as it does
to the Application Suite's deferred consequence-chain reasoning. No export beyond what the
existing `Export` action already offers. No drill-down click-through to a filtered issue list in
this first cut — each cross-tab is read, not yet a navigation surface; a person wanting the
underlying issues still goes to Tree/Board and filters there.

## What would send this back

If a firm's real question turns out to be "is this getting better or worse," this design cannot
answer it and should not be stretched to pretend it can — that needs the period-snapshot capture
this codebase does not have, designed as its own piece of infrastructure, not retrofitted onto a
live cross-tab.
