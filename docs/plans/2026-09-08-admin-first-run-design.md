# Admin first-run — a second, narrower checklist for a genuinely empty tenant

**Status: built, 8 September 2026.** Proposed from the 8 Sep live re-verification of
`docs/plans/2026-09-07-hive-comparison.md`, approved to build the same day. `lib/firstRun.ts`
(`adminFirstRunState`/`adminFirstRunVisible`), `components/AdminFirstRunCard.tsx`, mounted
beside `FirstRunCard` in `IssueWorkspace.tsx`. Scenario AFR1 PASSes — and caught a real bug
in the first `adminFirstRunVisible` formula before this ever reached a real tenant (it showed
the card to any non-admin actor; see the scenario file's own diagnostic history in git).

## The gap

`firstRunState` (`lib/firstRun.ts`, design at `docs/plans/2026-08-31-first-run-design.md`)
is eligible only for a directory-matched person who holds `time.record` and **not**
`config.manage`. Operators and admins never see it — deliberately: *"Operators and admins
configure the platform; onboarding them to their own product would be noise."*

That reasoning is sound and unchanged by this proposal. But it answers a different question
than the one this proposal asks. The existing card teaches a consultant the record → submit
loop. Nobody guides a `config.manage` holder through the handful of things that must happen
*before* that loop has anyone to run it: invite a second person, give them a role, create
the first project. On a brand-new tenant, today, there is no computed nudge for any of that —
just the empty screens themselves.

## What this is not

Not a reopening of the exclusion above. The existing card's job is "teach the product to
someone who will use it daily"; admins were excluded from that because they already know it.
This proposal's job is narrower and time-boxed to a state that exists for one tenant, once:
the moment right after provisioning, before a second person or a first project exists. It
retires the same way the original does — on evidence, not on a click — and asks nothing an
admin doesn't already need to do regardless of whether this card exists.

**The one thing worth a second opinion before this is built**: is "guide the admin through
the first three setup actions" still inside the spirit of *"the answer is a human onboarding
session, not more UI"* from the original design's own send-back clause? My read is yes — this
is three computed checkboxes on an already-empty screen, not a new surface — but that clause
was written deliberately and this proposal should not quietly step around it without someone
who wasn't in the room for the original decision confirming that reading.

## Who sees it

`adminFirstRunState(state, actor)` — pure, no clock, no storage, same shape as the original:

Eligible when the actor matches a directory person, holds `config.manage`, and the tenant is
**genuinely fresh**: zero other non-deleted people in the directory and zero non-deleted
`project`-kind nodes anywhere in the tree. Both conditions, not either — a tenant with people
already imported but no project structure yet (or the reverse) is mid-setup, not fresh, and
gets no card retroactively.

Dismissal: the same per-browser `localStorage` flag pattern as the original, under its own
key (`axiomate.adminFirstRun.dismissed`) — never shared with the consultant card's flag, since
the two are shown to different roles for different reasons and a dismissal of one saying
nothing about the other is the honest behaviour.

## The steps, each computed

1. **Invite a second person** — done when any directory person exists besides the signed-in
   admin. (Configuration → Roles & people already does this; nothing new is built here.)
2. **Give them a role** — done when any person besides the admin holds at least one role.
3. **Create the first project** — done when any non-deleted `project`-kind node exists
   anywhere in the tree.

No fourth "know where things live" step is proposed — the admin, unlike a brand-new
consultant, has already been through Configuration to reach this point and does not need
that pointer restated.

## Visibility

Shows from first sight (nothing invited, no project) until all three steps are done, exactly
mirroring the original's "eligible until the loop is learned" rule — not until dismissed
early, and not lingering once a tenant is genuinely staffed and running.

## Where it renders

Same mount point as the original: `view === 'mywork'` in `IssueWorkspace.tsx`, since My work
is the landing view for every signed-in seat including admins — no new view or route.
Rendered as a second, distinctly-titled card (e.g. "Set up your workspace") beside — never
merged into — `FirstRunCard`, since the two are eligible to entirely disjoint audiences and a
merged component would be answering "is this person a consultant or an admin" every render
for no reason the design needs.

## Size

Small. One new pure function beside the existing one (`lib/firstRun.ts` or a sibling file),
one new thin card component following `FirstRunCard.tsx`'s exact shape, one new mount line.
No schema change, no new action, no new permission — reads only what already exists
(`state.model.people`, `state.nodes`).

## What would send this back

Same failure mode as the original, watched the same way: an admin dismissing without
inviting anyone — the card failed to teach, and per the original clause, the fix is a human
onboarding conversation, not a third checklist bolted onto this one.
