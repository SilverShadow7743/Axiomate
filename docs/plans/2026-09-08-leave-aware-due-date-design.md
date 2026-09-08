# A visible caveat when the owner is on leave — never a silent shift of the due date

**Status: draft, 8 September 2026.** I13's third open question, approved to scope (not build)
the same day. One open question for Nishant at the end.

## The answer, sourced from this codebase's own doctrine

A due date is a commitment, not a derived fact, and this codebase already says so in its own
words. `lib/sla.ts`'s header, on why an SLA proposal never auto-writes: *"A date already here
is a commitment somebody made. Never overwritten."* `lib/scheduling.ts`'s leave posture, on why
approved leave never silently reschedules anything it touches: leave "blocks nothing... a named
conflict" surfaces instead of a silent change.

So the answer is not a design choice made here — it follows from what the codebase already
enforces: **a visible caveat next to the due date, never a rewrite of `plannedEndDate`.** An
issue whose owner is on approved leave between today and its planned end shows something like
*"Priya is on leave 9–11 Sep, inside this window"* beside the date. The date itself does not
move; a person decides whether that matters, the same way a `dueSoon`/`overdue` finding is a
fact to act on, not an automatic rewrite.

## Whose leave counts

The issue's **current `owner`** only — not every person who might touch it before the due date.
Future assignment is speculation this codebase already refuses elsewhere (`lib/skills.ts`'s
`candidatesFor` returns candidates and refuses to guess a best one, for the same reason: a
claim about the future beyond what is actually known). The owner is the one concrete,
recorded fact today; if ownership changes, the caveat recomputes at read time like everything
else here; it does not need to anticipate a change that has not happened.

## Shape

A pure function, `ownerLeaveCaveat(issue, commitments, today)` or similar, checking whether any
`Commitment` with `kind: 'Leave'` for the owner's directory id, passing `commitmentCounts` (the
existing approved-only predicate, `lib/availability.ts:110`), overlaps `[today, plannedEndDate]`.
Returns a sentence or `null` — the same "computed string or null" shape `milestoneRisk` and
`describeGoals` already use, not a new pattern.

**Attachment point**: `components/DetailPanel.tsx`'s Overview tab, right beside "Planned end"
(line 792) — the screen that already shows the date this caveats. This is named as the one
certain attachment point; whether it also belongs anywhere else is the open question below.

## What this does not propose

Writing the caveat into the audit trail, notifying anyone about it, or feeding it into
`AUTO_*` automation rules — this is read-only, computed-at-render information, the same
category as `describeGoals`'s prose, not a new event or notification class.

## Open question for Nishant

**Which screen(s) carry the caveat beyond DetailPanel's Overview tab** — Tree/Board's own row
(a small icon or note), the daily IMS, My work? And separately: **does `lib/watch.ts` treat
this purely as a display caveat, or does an owner's leave inside the `dueSoon` window make that
finding fire earlier** (a due date that is nominally 4 working days out but whose owner is on
leave for 2 of them is a tighter risk than the raw count implies) — or is that conflating two
different signals (a date risk and a staffing risk) that should stay visibly separate? Nishant's
call, not decided here.
