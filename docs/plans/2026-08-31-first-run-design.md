# First-run — a checklist that computes itself, not a tour

**Status: approved 2026-08-31** (one AskUserQuestion; carries its own plan). Hive steal #4.
Hive offers guided setup and CSM tiers; this is smaller and harder to lie with: a
state-aware checklist at the top of My work that computes its progress from the workspace
and retires itself when the loop is learned. A tour can be clicked through; this card
cannot claim a step happened when the state says it did not.

## Who sees it

`firstRunState(state, actor)` — pure, no clock, no storage: eligible when the actor matches
a directory person, holds at least one role granting `time.record` but NOT `config.manage`
(operators and admins never see it; an unmatched sign-in or client-seat guest never sees
internal onboarding), and owns zero non-deleted time entries. Dismissal is a localStorage
flag — a walkthrough reappearing on a new device is acceptable, and UI state does not
belong on the model.

## The steps, each computed

1. Find your work — My work's own printed ranking rationale; done by being here.
2. Record your first hours — deep-links `/my-week`; done when ≥1 own entry exists.
3. Submit the week — done when an own timesheet exists; the copy names the second person
   and that a returned week comes back with a reason.
4. Know where things live — search reaches notes and mail; Views ▾ holds the team's saved
   views; the Tree is the whole record. Done when 1–3 are; the card then offers dismissal.

## Pinned by FR1 (suite 190 → 191)

Eligibility: a roled consultant with no entries → eligible; the same person with one entry
→ step 2 done; with a sheet → step 3 done; a `config.manage` holder → never; an actor
matching nobody → never. The card is thin render over the helper.

## What would send this back

Consultants dismissing without recording — the card failed to teach, and the answer is a
human onboarding session, not more UI. Surfaces in adoption week.
