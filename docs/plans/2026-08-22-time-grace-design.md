# Timesheet grace and justification — design

**Date:** 2026-08-22 · **Register item:** #3 · **Status:** approved

## The two gaps this closes

`lib/timeWindow.ts` already enforces the time-entry window: before-window, closed-issue and
frozen-week refusals; past-due-date and long-day warnings. What it does not do:

1. **The grace period is a hardcoded constant.** `BACKDATING_ALLOWANCE_DAYS = 7` lives in
   code, against this codebase's first rule — "Configure the operating model — do not
   hardcode it." Two firms will not agree on seven.
2. **`backdated()` has no production consumer.** It computes `justificationRequired` and
   `approvalRequired`, the scenario suite proves both sides of its boundary — and `addTime`
   never calls it. An entry recorded three weeks after the work is accepted today in
   silence: no reason collected, nothing flagged for the week's approver.

## The chosen approach, and the two rejected

**Chosen: policy in the model, justification on the entry, the week approval stays the
second person.** The existing week submit/approve flow already puts a decider (who cannot be
the asker — `lib/approval.ts`) in front of every attested week; a late entry needs a reason
*recorded* and *visible to that decider*, not a second approval object. Rejected: **B**,
approval-gated late entries (a pending lifecycle on TimeEntry duplicating the week-level
attestation — heavier, no added honesty), and **C**, justification without configuration
(leaves the constant hardcoded, which is the register item's own complaint).

## The design

### 1. The policy

`model.timePolicy = { backdatingAllowanceDays: number }` on the OperatingModel — shipped
default **7**, validated to an integer 0–60. Merged into stored models the way
`statusPolicy` is (`mergeModel`), so a workspace written before the key exists reads the
default rather than `undefined`. Configuration rather than a constant for the same reason
the service levels are: how long an entry may lag before it must explain itself is a
governance term, not a property of the software.

A small **"Time recording"** card in Configuration edits it, in words: "Entries recorded
more than N days after the work need a reason." Zero is legitimate — it means any entry not
made the same day must explain itself.

### 2. The pure rule

`backdated(workDate, entryDate, allowanceDays)` — the allowance becomes a parameter. The
constant survives as `BACKDATING_ALLOWANCE_DAYS`, now documented as the shipped default the
policy carries, not a rule of its own. Lateness stays in **calendar days**, which is what
`daysBetween` speaks and what the existing scenario asserts on both sides of the boundary
(same-day = 0 late, day 7 inside, day 8 outside).

`approvalRequired` stays on the return shape but is satisfied by the week decision — the
field is a statement that a second person must see the entry, and the decider seeing it
flagged at approval time is that.

### 3. The arms

- **`addTime`** computes lateness from `a.date` (the work) against `a.now` (the claim),
  with the allowance read from `state.model.timePolicy`. Past the allowance: refused
  without `a.justification` in the module's own sentence, recorded with one — the reason
  stored on the entry, the audit `to` saying how many days late.
- **`updateTime`** applies the same gate when a patch moves `date` or `hours` on an entry
  whose work date is past the allowance relative to `a.now` — a correction that changes the
  hours of a three-week-old day is the same reconstruction as recording it late. Patches
  that touch neither (activity, billable, note) pass untouched.
- **`removeTime`** is left alone: frozen weeks already guard attested data, and deleting is
  not claiming.

### 4. The wire

`addTime` gains `justification: opt(text)` in SHAPES; the `updateTime` patch whitelist in
the reducer gains `justification`. The wire shape and the reducer widen **together** — the
client-boundary drive caught exactly this gap on `updateIssue` earlier today (828f975), and
this design names it so the plan cannot miss it.

### 5. Storage

`justification String?` on `TimeEntry` — additive, nullable, migration alone, applied to
production before the code that writes it. Mappers carry it both ways. The persistence
proof round-trips a late entry's justification.

### 6. The screens

- **TimeTab add form**: shows the lateness live as the date changes, and reveals the reason
  box only when the policy requires it — both halves, the arm refusing what the form
  demands.
- **Recorded entries**: a late entry carries a "late · N days" marker with its reason
  visible where the entry is read.
- **Week decision**: the submitted-week view flags late entries and shows their reasons, so
  the approver reads them before approving — this is where `approvalRequired` is
  discharged.
- **Configuration**: the "Time recording" card.

### 7. Proof

Scenario **TG1** drives, at a configured (non-default) allowance: an entry inside the
allowance accepted with no reason demanded; one past it refused without a justification, in
words; the same entry accepted with one and the reason stored; `updateTime` moving a stale
entry's hours gated the same way; the audit row carrying the lateness. The existing
backdating scenario keeps proving the pure boundary arithmetic.

## Out of scope, stated

- The **closed-issue extension** the window's refusal message promises ("with a reason and
  an approval to reopen the window") — a separate mechanism, register-worthy on its own.
- **Week-submission deadlines** — nothing forces a submit today; a deadline is a different
  policy with a different enforcement point.

## What would send this back

- Lateness wanted in **working days** rather than calendar days.
- Late entries wanted **blocked outright** rather than justified.
- A firm needing **per-engagement** allowances rather than one workspace policy — that
  would reopen where the policy lives, not just its value.
