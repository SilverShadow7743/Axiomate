---
type: resource
title: "Hive comparison"
created: "2026-08-30"
tags:
  - resource
  - competitive
---

# Hive comparison

Sub-feature comparison against Hive (hive.com), grounded in Hive's own features/pricing/apps
pages (fetched 2026-08-30) and Axiomate's evidence base (scenario suite + proofs + live
verifications). Full 40-row analysis:

**https://claude.ai/code/artifact/6962f552-c2fe-4cab-9cb2-94a07e562886**

## The shape of it

Different species, large overlap. Hive wins on polish, breadth, liveness: co-edited notes,
native chat, mobile apps, 1,000+ integrations, an AI that answers today. Axiomate wins on
what Hive cannot claim at any tier: DB-enforced isolation, attestation semantics, the proven
client-redaction boundary, estimation discipline, the audit trail, and executable evidence
for all of it. Most of what Hive sells as $5/user add-ons (timesheets, resourcing, proofing,
external users, SSO, finance) is Axiomate core.

Expanded 2026-08-30 with four characteristic sections beyond feature surface: under-counted
modules (RAID, skills matrix, SLA engine, meetings, search, dedupe), extensibility &
portability (no public API/webhooks — but zero lock-in, DB is ours), personal-productivity UX
(dark mode ✓, no undo by design — soft-delete+restore, no onboarding), and vendor/trust
(no SOC2 but data never leaves our tenant; restore PROVEN vs vendor promise; bus-factor 1).

## Steal-list, value order

> [!note] Re-scored 2026-08-31
> Four of the five original steals shipped and deployed over 2026-08-30/31, plus a full
> layout restructure the list didn't originally call for — the "above the Hive bar" phase
> and the clean shell both closed. Only client portal activation remains genuinely open.

1. ✅ **Client portal activation** — DONE (engine, staged 2026-08-31): the `clientView`
   boundary was already built and sentinel-proven; a guest was invited via Entra B2B
   (PendingAcceptance). **Still open:** the user hasn't walked the portal through yet —
   this is the one item on the original list not yet closed end to end.
2. ✅ **Savable views/tabs** — DONE (2026-08-31): team-shared `SavedView` records on the
   operating model, not per-browser localStorage — audited like any other config change.
3. ✅ **Mobile timesheet entry** — DONE (2026-08-31): `/my-week`, a phone-first attestation
   page covering record → submit → approve.
4. ✅ **Global full-text search** — DONE (2026-08-30 night): client-side scan over the
   already-redacted boot state — leak-proof by construction, pinned by GS1.
5. ✅ **Consultant onboarding UX** — DONE (2026-08-31): a first-run checklist that computes
   itself from state and retires on the first submitted week.
6. **Public API + webhooks** — the extensibility gap. Still open, deliberately deferred
   (multi-firm gate, not a single-firm blocker).
7. Real-time co-edited notes — hard; only if meeting notes move in-tool. Open.
8. Visual proofing markup — only if review volume grows. Open.
9. **Project-level baseline/snapshot** — 2026-09-01, screen-by-screen pass (see
   [[hive-screen-comparison]]): Hive's Baseline snapshots planned start/end dates AND budget
   for a whole project at once, multiple per project, compared via a dropdown. Axiomate's
   `Estimate.baselinedAt` is a false friend — per-issue, effort-only, one at a time, no history
   of prior snapshots. The strongest genuinely-missing concept found in this pass. Open,
   deliberately not scoped yet — the per-issue estimate model isn't obviously the right thing
   to extend; needs its own brainstorm if a real need surfaces.

**Beyond the original list:** the clean-shell layout restructure (sidebar navigation, a
right-overlay detail drawer replacing the bottom dock, per-view filters, calm visual tokens)
shipped 2026-08-31, deployed and user-walkthrough-confirmed — closing the gap the comparison
itself named ("Hive wins on polish") more directly than any single steal-list item did.

Where Hive is simply ahead regardless of philosophy: uptime redundancy, support org,
integration ecosystem, mobile, localization, shipped API. None block the single-firm
deployment; all gate any multi-firm future.

## Six more, shipped 2026-08-31 (later the same day as the re-score above)

None of these are in the 40-row analysis or Hive's own documented feature set — checked, not
assumed. Layout-plan cross-reference: `docs/plans/2026-08-22-hive-layout-attention-plan.md`'s
own "Status as of 2026-08-31" section has the line-cited detail; this is the competitive read.

- **Today/My Work landing** — closes the original layout review's own theme #1
  ("the layout grammar is inverted relative to how delivery staff work") exactly. Table stakes
  against Hive, not a lead — Hive already lands people on "what needs me."
- **Unified Work Inbox** — a decision/waiting split derived from real work-item state
  (`decisionItems`/`waitingItems`), not a chat/notification-centric inbox. No Hive equivalent
  found.
- **Project Pulse** — Portfolio's sixth concern, `capacity`: names who is over-committed and by
  how much, workspace-wide, as a count, not a chart or a score. **Workforce intelligence** —
  add this to the under-counted-modules list in the full 40-row artifact next revision; Hive's
  resourcing views exist but are visual, not a named counted concern in this idiom.
- **Zero-Entry Timesheet** — meeting-derived, pre-filled-but-always-confirmed timesheet
  suggestions. Neither Hive's manual entry nor its start/stop timers (this plan's own
  "Deliberately skipped" list — a second source of hours, rejected on purpose) do this; a
  genuinely different mechanism, not a catch-up move.
- **Automatic Resource Replanning** — decision-support over an over-committed person's
  allocations (the deficit, every overlapping allocation's hours, no number picked
  automatically), extending Project Pulse. **Workforce intelligence**, same axis. No equivalent
  in the 40-row analysis.
- **Data integrity audit** (`npm run audit:integrity`) — not layout or a feature surface; belongs
  in **vendor/trust**, beside the existing restore-proof entry: seven referential-integrity
  checks (person/personId seam, dangling allocations, orphaned time entries, date/status
  consistency, capacity overlaps), read-only, run against production 2026-08-31 with zero
  findings.

## Related

- [[hive-screen-comparison]] — screen-by-screen, action-by-action, 2026-08-31
- [[release-readiness]]
- [[application-improvement-index]]
