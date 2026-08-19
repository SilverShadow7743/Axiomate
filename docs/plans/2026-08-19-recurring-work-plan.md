# Recurring work — implementation plan

Follows `docs/plans/2026-08-19-recurring-work-design.md` (approved 19 Aug 2026). Ordering
principle: the cadence arithmetic is proven by scenarios before any caller exists, the config
plumbing next (compile-time exhaustive, so a forgotten registration fails the build rather than
the morning run), and the pass integration — the step that writes inside a transaction that
currently always succeeds — lands second-to-last with the Configuration screen after it.

The design's governing constraints, quoted: *"`lastRaisedOn` is a fact about what happened —
stored, not derived — and it is the duplicate guard"*; *"a pass that was down three days raises
the missed occurrence once, not once per missed day"*; *"`lastRaisedOn` is advanced in the same
batch as the raise, and only when the raise succeeded."*

## Steps

**1. `lib/recurrence.ts` (new) — the cadence arithmetic, no clock, no I/O.**
`Recurrence` interface per the design (`id, name, scopeId, cadence, type, severity, owner,
enabled, lastRaisedOn`). `occurrenceOnOrBefore(cadence, date)` — the latest occurrence on or
before the date, with monthly `day` clamped to the month's length (31 becomes 28/29 in
February). `dueOccurrence(rule, today)` — that occurrence when it is strictly after
`lastRaisedOn`, else null; at most ONE date, which is the whole catch-up rule.
`describeRecurrence(rule)` — the sentence for the screen. `subjectFor(rule, occurrence)` —
"name — YYYY-MM-DD".
*Verify:* `npx tsc --noEmit` clean.

**2. Scenarios — `scripts/scenario-validation.ts` (CRLF; preserve endings, insert with the
same python-and-CRLF technique BV1/CV1 used).**
RW1 drives the arithmetic: a day-31 rule lands on Feb 28 (and 29 in a leap year); a weekly rule
lands on the right weekday; a same-day re-run returns null once `lastRaisedOn` has advanced; a
rule three days stale returns exactly one date; a disabled rule returns null.
*Verify:* `npm run validate:scenarios` — count rises, nothing regresses, RW1 PASS.

**3. Config plumbing — `lib/config.ts`, `lib/workspace.ts`, `lib/actionShape.ts`.**
`recurrences: Recurrence[]` on `OperatingModel`; empty array in the seed; an explicit line in
`mergeModel` (`lib/config.ts:1219`) — `recurrences: stored.recurrences ?? seed.recurrences` —
because a model stored before the key existed arrives without it, and the missing-key crash is
this codebase's known production failure shape. `ConfigOp` gains
`{ k: 'upsertRecurrence'; id: string | null; patch: Partial<Recurrence> }` beside
`upsertIntake` (`lib/workspace.ts:1113`); the reducer arm beside `case 'upsertIntake'`
(`lib/workspace.ts:5977`) validates the scope with `canParent('issue', kindOf(state, scopeId))`
at WRITE time — a rule that could never file is refused when configured, not discovered at
seven in the morning. Register the kind in `CONFIG_OPS` (`lib/actionShape.ts:120`); `allOf`
makes forgetting it a compile error.
*Verify:* `npx tsc --noEmit`; scenario RW2 upserts a rule through the real reducer and asserts
a scope that cannot hold an issue is refused with the message naming it.

**4. The pass integration — `lib/db/schedule.ts` plus a raise helper in `lib/recurrence.ts`.
THE STEP CARRYING THE MOST REGRESSION RISK.**
Inside `runScheduledPass`'s Serializable transaction, after `runWatch`: for each enabled rule
with a due occurrence, dispatch
`{ t: 'create', parentId: rule.scopeId, kind: 'issue', draft: { name: subjectFor(...), type,
severity, status: 'Open', ... } }` through `apply` with the machine actor — status is the entry
state, exactly as intake insists ("a machine may file work; it may not decide it is being
worked on"). On success, dispatch the config action advancing `lastRaisedOn` to the occurrence
IN THE SAME transaction batch; on refusal, record it in the run's `refusals` and do NOT
advance — the next pass retries the same occurrence. Why this is the risky step: it adds
writes to an unattended morning transaction that currently always succeeds. A wrong guard
direction floods the register (raise-per-missed-day) or goes silent (advance-on-refusal);
either lands on whoever reads the register at 9am, and the silent version is not noticed until
the month-end checklist that never appeared.
*Verify:* RW3 drives a full raise cycle twice against the fixture: the first run raises one
issue and advances `lastRaisedOn`; the second same-day run raises zero.
`npm run validate:scenarios` — RW1–RW3 PASS, nothing regresses.

**5. Configuration screen — `components/ConfigWorkspace.tsx`.**
A "Recurring work" section under AUTOMATION (beside Agent registry): a list with
`describeRecurrence` sentences and `lastRaisedOn`, and a form (name, scope picker, cadence,
type, severity, owner, enabled) dispatching `upsertRecurrence`. The All-settings card counts
rules and their firing state.
*Verify:* `npx tsc --noEmit && npm run build`.

**6. Checklist section 17, sweep, deploy, and one hand-driven production run.**
Checklist: configure a weekly rule due today against a real engagement, POST
`/api/schedule/run` by hand (operator session or bearer token), confirm the issue appears with
the machine attribution and the occurrence-stamped subject, confirm a second POST raises
nothing, then keep or disable the rule as wanted. Sweep:
`npx tsc --noEmit && npm run validate:scenarios && npm run audit:tenancy && npm run
audit:attribution && npm run build`; release via `git archive`, `package-release.py`,
`az webapp deploy`.

## Details most likely to be got wrong

- **`mergeModel` must name `recurrences` explicitly.** The spread does not cover new keys on
  old stored models; `undefined` here crashes the first `model.recurrences.filter` in
  production and nowhere else.
- **Advance `lastRaisedOn` to the OCCURRENCE date, not today.** A pass down since the 31st
  running on the 2nd must record the 31st; recording the 2nd makes the next monthly occurrence
  compute from the wrong anchor.
- **`dueOccurrence` compares strictly after `lastRaisedOn`.** Comparing on-or-after re-raises
  the same occurrence forever; the scenario in step 2 pins this.
- **Status in the draft is `'Open'` — the entry state** — copied from intake's own comment,
  not from the rule.
- **The scope check runs twice on purpose**: at upsert (step 3, courtesy) and at raise (the
  reducer's own check inside `create`, the half that holds when the scope is deleted after the
  rule was written).
- **Owner empty means `'Unassigned'`** — the stored value the unowned counts watch, not the
  empty string.
- `scripts/scenario-validation.ts` is CRLF; `lib/*.ts` are LF. Run `file` on every touched
  file before committing.

## Commits

Steps 1–2 together (arithmetic and its proof). Step 3 alone (config plumbing is self-contained
and revertable). Step 4 alone — the risky one wants its own revert line. Steps 5–6 together.

## What would send the design back

- The `create` arm proves unusable from inside the pass transaction (surfaces in step 4) —
  for instance `apply` needing request-scoped context the pass lacks. That breaks "raises by
  dispatching the same action a person's click produces" and reopens the design rather than
  growing a parallel write path.
- `lastRaisedOn` in config JSON races with concurrent config edits under Serializable retries
  (surfaces in step 4's double-run test) — would mean the guard belongs in its own table,
  which is a design change, not a patch.
- A second cadence shape is needed before the first two ship (surfaces in step 5 when the form
  is drawn) — would mean the two-shape decision was wrong at the design level.
