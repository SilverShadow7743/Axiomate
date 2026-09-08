# A visible caveat when the owner is on leave — never a silent shift of the due date

**Status: built, 8 September 2026.** I13's third open question, approved to scope the same day,
then approved to build once the two questions below were resolved.

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

**Attachment point**: `components/OverviewTab.tsx`, beside the due-date `<dd>` — the same row
that already shows `issue.owner` immediately above it, which is why Overview is the right home
rather than DetailPanel's Schedule tab. (An earlier draft of this doc cited `DetailPanel.tsx`
line 792 for this; that citation was wrong — it named the Schedule tab, which shows the planned-
end date but not the owner. Found and corrected during the build.)

## What this does not propose

Writing the caveat into the audit trail, notifying anyone about it, or feeding it into
`AUTO_*` automation rules — this is read-only, computed-at-render information, the same
category as `describeGoals`'s prose, not a new event or notification class.

## Resolved

**Which screen(s) carry the caveat** — Overview tab only. Not Tree/Board, not the daily IMS, not
My work. **Does `lib/watch.ts`'s `dueSoon` window fire earlier for a leave-affected owner** —
no: display-only. The date-risk (`dueSoon`/`overdue`) and staffing-risk (leave) signals stay
visibly separate rather than being merged into one number.

## Build summary

- `lib/availability.ts` — `ownerLeaveCaveat(ownerId, commitments, from, to)`: pure function,
  returns the earliest approved (non-Requested, non-`deletedAt`) Leave commitment for the owner
  overlapping `[from, to]`, or `null`. Reuses the existing `commitmentCounts` predicate.
- `components/DetailPanel.tsx` — threads `today` into `<OverviewTab>` (a new required prop;
  `DetailPanel` is `OverviewTab`'s only caller, so `tsc --noEmit` clean is sufficient proof this
  is safe).
- `components/OverviewTab.tsx` — resolves `issue.owner`'s directory id via `directoryIdByName`,
  calls `ownerLeaveCaveat` against `state.commitments` and `row.plannedEndDate`, renders the
  result as a third `.prov` clause beside the existing due-date `<dd>` (reusing the CSS class
  already used for the "rolled up from its lifecycle" note — no new CSS). Null-safe: an owner
  name that doesn't resolve via the directory (`directoryIdByName` returns `null`) silently
  yields no caveat rather than an error, matching how `requiredSkills` already treats stale
  owner references.
- `scripts/scenario-validation.ts` — new scenario `HOL4`: confirms the approved-leave overlap is
  found, a leave outside the window is excluded, a no-owner issue returns `null`, a leave whose
  window doesn't reach the plannedEnd returns `null`, a chronologically-earlier but still
  *Requested* (not yet approved) leave is correctly excluded in favor of the later approved one,
  and `plannedEndDate` itself is never written.

**Verification**: `tsc --noEmit` clean; scenario suite `HOL4 PASS`, 257 total (256 → 257, exactly
+1, zero regressions); `npm run build` clean; `audit:tenancy` PASS.

**Not yet live-verified in a browser** — unlike I12, this UI has only been scenario-tested
against fixtures, not rendered. Whether any real OAPIL/SLG issue today has an owner both (a)
resolvable via `directoryIdByName` and (b) on approved leave overlapping its due-date window is
unconfirmed, so the render path itself is unconfirmed until checked post-deploy.
