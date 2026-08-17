# Timesheets

**Status:** approved, 17 August 2026
**Closes:** scenarios U ("A consultant submits a timesheet") and V ("A submitted timesheet is rejected"), both NOT IMPLEMENTED

## Why now

Delivery consultants start recording hours shortly. Time entry already works — a
consultant can log 2.25 hours against an issue, the quarter-hour survives the round trip to
Postgres, and `effortVariance` compares it to the estimate. What is missing is the layer above:
nothing gathers those hours into a period anybody submits or approves.

Rates and money are deliberately out of scope. The system has no rate anywhere — not on a
person, a role or an engagement — so every commercial figure stops at hours. That is the larger
piece and it comes second, for one reason: putting money against hours nobody has attested to
means invoicing unreviewed data. The attestation has to exist first.

## What a timesheet is

`(person, week starting Monday, status)`, and nothing else.

The total is **computed** from the time entries falling in that window. It is never stored and
the entries are never copied. This follows the rule the rest of the application already keeps —
nothing derived is written down as fact — and it is the decision most likely to be argued with,
so the reasoning is worth recording.

The conventional alternative is that a timesheet owns lines, copied from the entries at
submission. It is more familiar and it is wrong here: it duplicates the hours, and on the day
the copy and the original disagree there are two answers to "how long did AXM-042 take" and
nothing to say which is true. Keeping the period as a query over entries means there is only
ever one answer.

Consequences worth stating:

- An entry cannot belong to two timesheets, because it belongs to none. The period is a query.
- Recording time neither creates nor touches a timesheet. The two are independent until somebody
  submits.
- A week with no hours is a legitimate claim — "I was on leave, there is nothing to bill" — so an
  empty timesheet is submittable.
- No timesheet is created in advance. Twenty-four people do not get a row every Monday whether
  they worked or not; a record exists because somebody submitted it.

## States

    Submitted ──→ Approved     (terminal)
        ↑ │
        │ └────→ Rejected      (with a reason; the week becomes editable again)
        └───────────┘            resubmit

Rejected persists rather than reverting to nothing. "This was sent back on Tuesday, and why" is
exactly what a trail exists to answer, and deleting the record to reopen the week would erase it.

## The rule that makes it mean anything

**While a week is Submitted or Approved, its hours are frozen.** `addTime`, `updateTime` and
`removeTime` refuse for that person within that window.

This is the point of the feature. Without it an approver approves a number that can change
underneath them and the attestation is decorative. It is also the only place this work touches
existing reducer arms, so it is where the risk of regression sits.

The refusal names both sides, as every other refusal in this codebase does:

> The week of 17 Aug is submitted and awaiting approval. Hours cannot be changed until it is
> approved or returned to you.

## Who approves

`lib/approval.ts` already encodes the pattern — a rule names the decider roles, and the asker
cannot be the decider. Reuse it rather than growing a second approval concept that is free to
disagree with the first.

Default deciders: Engagement Leader and Platform Administrator.

**One approver per person-week, not per engagement.** A consultant's week can span OAPIL and
SLG. Splitting approval by engagement produces a week that is half approved, which is a state
nobody can act on and every downstream reader has to special-case. A firm that genuinely needs
it can have it later.

## Where it lives

| Piece | File | Note |
|---|---|---|
| Period arithmetic, submittability, the freeze test | `lib/timesheet.ts` | Pure. No clock, no I/O — so scenarios U and V drive it directly rather than asserting a regex matched some source. |
| `submitTimesheet`, `decideTimesheet` | `lib/workspace.ts` | Ordinary actions, so attribution and audit come free and automation cannot do what a person could not. |
| The freeze guard | `lib/workspace.ts` time arms | Calls the pure function. Three arms, one call each. |
| `Timesheet` model | `prisma/schema.prisma` | Composite key `(tenantId, id)` like every other table, unique on `(tenantId, person, weekStarting)`. |
| Mapper pair, persist arm | `lib/db/map.ts`, `lib/db/persist.ts` | Follows the existing shape exactly. |
| Submit control and status | The existing Time tab | Not a new screen. |

## Permissions

Two new: `time.submit` and `time.approve`.

`time.submit` covers a person's own weeks only — the reducer compares the actor to the person on
the timesheet, so holding the permission is not enough to submit somebody else's. Client User
gets neither.

## Deliberately not building

Rates and money. Partial approval of a week. Reminders or nudges. Delegated submission. A
per-day entry grid, since entries already carry dates. Timesheets for machine actors, which do
not have weeks.

## How it gets proven

Scenarios U and V stop being NOT IMPLEMENTED and drive the real module end to end: submit a
week, try to change an hour inside it and be refused, reject it with a reason, edit, resubmit,
approve.

The persistence proof gains a timesheet round trip and — the check that matters — that **the
freeze survives a reload**. A guard that exists only in the browser's copy of state is not a
guard, and this repository has already shipped one thing that was true in memory and false in
Postgres.

## The risk

The freeze touches three reducer arms that currently always succeed. A mistake there does not
produce a broken timesheet; it produces a consultant who cannot record time and does not know
why. The guard is therefore a single pure function called in three places rather than three
implementations of the same idea, and the scenario coverage asserts both directions: refused
inside a submitted week, and allowed everywhere else.

---

## Addendum, 17 August 2026 — the agent layer above this

Recorded after approval, because a proposal for a Timesheet Agent raised one question this
design had to answer and several it did not.

**The eight-level hierarchy is a reporting rollup, not storage.** A proposed agent design
described `Timesheet Week → Daily Entry → Project → Billing Bucket → Deliverable → Work Package
→ Work Item → Outcome`. Read as storage that contradicts this design directly, and three of its
tiers do not exist. Read as a rollup — an hour must be *traceable* to an outcome, by query — it
is compatible, and that is the reading confirmed. Nothing here changes: a timesheet remains a
query over a period, entries remain owned by their issue, nothing is copied.

**The agents are already declared.** `AGENT_TIMESHEET`, `AGENT_EFFORT_VARIANCE`,
`AGENT_UTILIZATION`, `AGENT_CAPACITY_ACTUAL` and `AGENT_BILLING_READY` exist in `SEED_AGENTS`
with `runtime: 'declared'` and `maxAutonomy: 'suggest'` — which is issue AXM-027, thirty-seven
registered agents with no implementation. Anything built above this design implements entries
that exist rather than adding new ones, and inherits two constraints already written down: the
autonomy ceiling, and `AGENT_TIMESHEET`'s stated purpose — *"for accuracy and governance, not
for pressing people to book more hours."*

**The build order is the reverse of the user's order.** An agent flow reads Draft → Classify →
Validate → Submit. Submission is the foundation and is what this design covers; the validation
engines largely exist already and lack only a caller (`planCheck` in `lib/capacity.ts`,
`effortVariance` in `lib/time.ts`, `sowPosition` and `describePosition` in `lib/sow.ts`);
classification should reuse the `stated | guessed | default` vocabulary from `lib/intake.ts`
rather than invent a confidence percentage; and drafting is last because it is the only part
that needs capabilities this system does not have — natural language capture and a calendar.
