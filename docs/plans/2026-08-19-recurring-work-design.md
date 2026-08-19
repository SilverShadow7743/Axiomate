# Recurring work — design

Approved 19 August 2026. Phase 2 of the Hive gap program.

## What is being built

A configured rule that raises an issue on a cadence — "Month-end close checklist, under OAPIL
Engagement, on the last day of each month" — fired by the daily pass that already runs every
morning. No new clock, no new entity, no migration.

## The rule, and where it lives

`Recurrence` lives in the `OperatingModel` JSON beside intake mailboxes: configuration rather
than a first-class entity. One new `ConfigOp` kind, `upsertRecurrence`, registered in
`CONFIG_OPS` (`lib/actionShape.ts`), which is compile-time exhaustive and will refuse the build
if forgotten.

Fields: `id`, `name`, `scopeId`, `cadence` (below), `type`, `severity`, `owner`, `enabled`,
`lastRaisedOn: string | null`. `lastRaisedOn` is a fact about what happened — stored, not
derived — and it is the duplicate guard.

## Cadence: two shapes

`{ kind: 'weekly', weekday: 0..6 }` and `{ kind: 'monthly', day: 1..31 }`, with day clamped to
the month's length so 31 means last-of-month everywhere, February included. Deliberately absent:
cron strings, every-N-hours, and "skip if the previous is still open" — a month-end close is
distinct work each month, and an unclosed previous one is a fact for the board to show, not a
reason to withhold the next.

## Firing

`runScheduledPass` gains a recurrence step. For each enabled rule, `dueOccurrence(rule, today)`
answers with at most ONE date: the latest occurrence that is after `lastRaisedOn` and on or
before today. A pass re-running the same morning raises nothing twice; a pass that was down
three days raises the missed occurrence once, not once per missed day — catching up every tick
would flood the register with stale checklist copies.

A due rule raises by dispatching the same issue-creation action a person's click produces,
attributed to the machine actor — so the permission check, the `canParent` guard and the audit
trail all apply. A rule pointed at a scope that cannot hold an issue is refused visibly in the
run's summary, not 409'd silently: intake's own lesson. `lastRaisedOn` is advanced in the same
batch as the raise, and only when the raise succeeded.

## What gets raised

Subject is the rule's name stamped with the occurrence date — "Month-end close — 2026-08-31" —
so two months' issues are distinct records. Type, severity and owner from the rule; owner may be
empty, which is `Unassigned`, a real value the unowned counts already watch.

## Error handling

A refused raise (scope gone, permission withdrawn, name collision) is recorded against the run
exactly as automation failures are, and `lastRaisedOn` does not advance — the next pass tries
the same occurrence again. There is no retry loop inside a single pass.

## Testing

Scenarios before any caller exists: clamping (31 → Feb 28/29), the one-occurrence catch-up rule,
the same-day idempotency, and a rule whose scope cannot hold an issue refusing with the message
naming it. Then the pass integration, the Configuration section, checklist section 17, and the
production run driven by hand once before trusting the morning schedule.
