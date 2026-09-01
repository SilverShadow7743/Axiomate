# Rate/margin rollup — design

## The gap

Scenarios `J` and `K` both stop at the same place, from two directions. `J` ("A consultant
records time against an issue"): *"stops at money — hours are recorded, and a rate to multiply
them by does not exist anywhere."* `K` ("Actual effort overruns the estimate"): *"stops before it
reaches the project — the variance is per issue, and nothing rolls it up to a milestone, a SOW or
a margin."*

Neither claim is quite right, and finding out how was most of this round's work. `costOf()`
(`lib/rates.ts`) already exists, is fully proven by scenario `RT1` (`PASS`), and correctly prices
worked hours against dated cost/bill rates with an honest-absence rule (a single unrated hour
makes the whole total `null`, never a smaller number). It has **zero callers** anywhere outside
`lib/rates.ts` and the suite. A Rates configuration tab (`recordRate`/`correctRate`,
`rate.view`/`rate.edit` gated) already exists too — `RT1`'s own `stops` text claiming "no screen
records a rate" was itself stale, and is corrected as part of this round.

`effortVariance()` (`lib/time.ts`) is genuinely per-issue only — `K`'s claim holds. No function
anywhere sums it across a SOW's work.

So the real, current gap is narrower than either scenario implies: the math for both halves
already exists and is proven. What's missing is wiring it to real data and showing it somewhere.

## What this is not

Not a new money model — `costOf`, `PersonRate`, `effortVariance` and `SowPosition` all already
exist and stay exactly as they are. Not a milestone-level rollup — `Milestone` (`lib/milestone.ts`)
is a payment-schedule line item with no relationship to specific issues at all (no `issueIds`, no
`attributeToMilestone` action), so attributing hours to one would mean inventing a new attribution
concept with no domain precedent. That's a real, separate design question for later, not something
to guess at here. This round is SOW-level only, extending `SowPosition` — the unit `sowPosition()`
already aggregates issues into.

## Two additions, split by sensitivity

**Variance — ordinary delivery data, joins `SowPosition` (`lib/sow.ts`).** Two new fields,
computed inside `sowPosition()`'s existing `issueIds` loop:

```ts
export interface SowPosition {
  // ...existing fields unchanged...
  /** Signed sum of effortVariance across issues whose estimate has been baselined. Positive is
   *  a net overrun. An issue not yet baselined contributes nothing — the same "an overrun
   *  against a draft is not yet news" rule effortVariance already states, applied here instead
   *  of reinvented. */
  varianceHours: number
  /** How many issues contributed to varianceHours — the exclusion made visible, the same way
   *  estimatedCount/unestimatedCount already report what plannedHours could and couldn't see. */
  varianceIssueCount: number
}
```

No permission gate: anyone who can see the SOW's issues can already see each one's individual
variance, so a sum of visible facts needs no new gate.

**Cost/margin — permission-sensitive, a new function in `lib/rates.ts`, beside `costOf`:**

```ts
export function sowCostOf(
  rates: PersonRate[],
  issueIds: string[],
  timeEntries: Record<string, TimeEntry>,
): CostOfWork
```

Gathers the SOW's real `TimeEntry` rows (the same `issueIds` `sowPosition` already has), maps
each to `costOf`'s `{ personId, date, hours }` shape, and calls `costOf` unchanged — no new
pricing logic, this function is purely the join between "which hours belong to this SOW" and
"what do worked hours cost."

The one real addition: an entry with **no resolvable `personId`** (an unresolved name — see
`TW2`, and the person/personId seam correction earlier this session) is folded into `unratedHours`
rather than silently dropped, so "this hour cannot be priced" reads as one honest absence whatever
the cause — a missing rate or an unresolved identity — never two different silent failure modes
wearing the same blank space.

`lib/sow.ts` gains no new import of `lib/rates.ts` — `sowCostOf` and `sowPosition` are called
separately by whoever needs both, keeping the ordinary-data module free of the permission-
sensitive one, the same boundary `lib/portfolio.ts`'s own exclusion of commercial figures already
draws at the screen level.

## Wiring — `CommercialPanel.tsx`

Variance renders unconditionally, next to the existing baseline/contracted/consumed line — e.g.
*"14h over baseline across 3 baselined issues."* Zero variance or zero baselined issues reads as
the ordinary case, not an error.

Cost/margin renders only when `can(state.model, actor, 'rate.view').allowed` — matching every
other rate-gated surface in this codebase. The wording distinguishes two different absences,
which is the detail most likely to be got wrong: **"no rate recorded for this work yet"** (rates
exist as a concept, genuinely nothing recorded) is only ever shown to someone who actually has
`rate.view` and got a real `unratedHours > 0` back from `sowCostOf`. Someone without `rate.view`
sees no cost block at all — never a message implying rates don't exist, which would leak the fact
by omission to someone not meant to see the boundary either way.

## Testing

Extends `RT1`'s own setup (it already builds rates and a SOW) rather than starting fresh: drives
`sowCostOf` against real `TimeEntry` rows including one with no resolvable `personId`, asserting
it folds into `unratedHours` correctly; drives `sowPosition`'s new `varianceHours`/
`varianceIssueCount` fields against a mix of baselined, unbaselined and unestimated issues.
`RT1`'s own `stops` text updates from *"nothing feeds worked hours into this yet, and no screen
shows the result"* to reflect that it now is, both feeding the function and reaching a screen.
`J`'s and `K`'s `stops` texts update in place too — both were pointing at exactly this gap.

## What would send this back

- If `sowCostOf`'s fold-in of no-`personId` hours turns out to make `unratedHours` misleading in
  some case not yet considered (e.g. a large volume of genuinely-unattributable historical
  entries dominating every SOW's total) — a plan-stage finding, not assumed here.
- If `CommercialPanel`'s existing permission checks (`mayEdit`, `mayDecideChange`, etc.) turn out
  not to cleanly compose with a `rate.view`-gated block added alongside them — the component's
  actual prop/permission shape needs rereading at plan time, not assumed from this design.
