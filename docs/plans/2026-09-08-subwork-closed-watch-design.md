# A sixth watch condition — every piece of sub-work under it is closed

**Status: draft, 8 September 2026.** Scoped from the user's own observation about Hive's
project rollup and parent-ticket closing, refined against the codebase rather than built from
the raw idea directly, per the user's own request. Not built.

## What already exists, and what's actually missing

The rollup itself is real and live: `rollUp()` (`lib/schedule.ts`) computes a weighted
`percentComplete` from a row's children, shown on every parent row in the Tree. That is not the
gap. The gap is narrower: **nobody is told when a parent's sub-work finishes** — the percentage
quietly reaches 100% and a person has to notice it themselves and close the parent by hand.

## Where this fits — the existing watch-condition shape, extended by one

`WATCH_CONDITIONS` (`lib/watch.ts:40`) is exactly five entries today — `overdue`, `atRisk`,
`dueSoon`, `stale`, `planImpossible`, `sowOverConsumed` — each a `{ key, label, event }` triple
detected once per scheduled pass in `observe()` and raised as an event the same automation rules
already react to (I9, `lib/automation.ts`). This proposes a sixth: `allSubworkClosed`.

```ts
{ key: 'allSubworkClosed', label: 'Every piece of sub-work under it is closed', event: 'issue.allSubworkClosed' }
```

**Detected as:** for each non-terminal issue row, find its direct issue children —
`rows.filter(r => r.parentId === row.id && r.kind === 'issue')` (an `Issue.parentId` pointing at
another issue is exactly how "Sub-Work" is parented under "Work" today, confirmed in
`lib/workspace.ts:2361`). If there is at least one child and every one of them is terminal
(`isTerminal`), raise the condition. Zero children raises nothing — a leaf issue has no
sub-work to be "all closed," and treating an empty set as vacuously true would fire on every
leaf in the register.

## What this does NOT do, on purpose

**No auto-close.** A rule reacting to `issue.allSubworkClosed` with `setStatus: 'Closed -
confirmed'` would be refused by the exact same transition graph a person's own click goes
through — `Closed - confirmed` is gated on client-agreement evidence
(`lib/statusPolicy.ts`'s own comment: *"the status that claims the client agreed... something
has to be producible later"*), and this condition proves nothing about that. The honest,
buildable version is a **notification** — "OAPIL-120's sub-work is all closed" to the owner —
using the exact same `notify` RuleActionKind every other watch condition already uses. Whether
to close it, and on what evidence, stays a person's decision, the same way it already is for a
100%-complete rollup a person has to notice today.

## Scope for this pass

One new entry in `WATCH_CONDITIONS`, one new detection block in `observe()` (`lib/watch.ts`)
following the same `add(row.id, 'allSubworkClosed', detail)` shape as the other five, and one
shipped rule offering it — a `notify` step a firm can point at the owner, the same as
`AUTO_OVERDUE` ships today. No schema change, no new permission, no new `RuleActionKind` (I9
already added `setStatus`/`setOwner`; this condition composes with the `notify` kind that
already existed before I9).

## What would send this back

If a firm actually wants auto-close on this condition despite the evidence gate — that is a
request to weaken `Closed - confirmed`'s own evidence requirement, a different and much bigger
decision than this one, and should be raised against `lib/statusPolicy.ts` directly rather than
smuggled in through a watch condition's default rule.
