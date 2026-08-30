# My Week — attestation on a phone, not an app

**Status: approved 2026-08-31** (one AskUserQuestion; carries its own plan). Hive steal #3.
Hive ships mobile apps that tick tasks; this puts the attestation loop itself — record with
the reasons the rules demand, submit, decide — on a phone browser, because it is the same
reducer either way.

## Shape

- `app/my-week/page.tsx`: mirrors the root page — `boot()`, the same structural
  redirect-when-unsigned, then a phone-first client component. No new server surface.
- `components/MyWeek.tsx`: this week and last week (a two-entry picker — month-end catch-up
  without a calendar); day cards from `weekGrid`; an add-hours form (my open owned issues,
  hours, billable, note) whose reason box appears exactly when the reducer will demand one
  (grace-gate lateness by date, closed-work by the issue's terminal status); the week total
  with billable split; Submit gated by `submitProblem`'s own words; the sheet status banner
  (Submitted / Approved / Rejected + reason). For `time.approve` holders: the submitted
  queue with each week's justified entries listed, Approve, and Reject-with-reason.
- Dispatch: optimistic `apply` locally for the message and the refusal, then one
  `POST /api/workspace { actions: [action] }` — the same wire the autosave queue drains to,
  where the server runs the full rules (notifications mint server-side). A failed POST
  reverts the optimistic state and says so; nothing pretends to be saved.
- Entry: a "My week" link in the main toolbar that CSS shows only under phone widths — the
  dense grid's users never see it; a phone user landing on `/` does.

## What this deliberately reuses instead of pinning again

Every rule this page touches is already scenario-owned: U/V (submit/approve,
decider≠submitter, freeze), TG1 (grace), TW1 (closed-work extension), SV1-era shape
validation at the boundary. The page is wiring; the suite honestly stays at 190. Gates that
apply: tsc, a11y lint, build, staged deploy, and a phone-width live check.

## Honest limits, stated on the page

Two weeks of reach; corrections beyond adding hours go to the desktop; the measured ~3 MB
boot payload rides along — its cost belongs to the performance track's boot-slimming, not to
a special mobile API.

## What would send this back

- The boot payload makes the page unusable on a real phone connection — boot-slimming
  arrives earlier than planned; no mobile-only API gets invented. Surfaces at the live check.
