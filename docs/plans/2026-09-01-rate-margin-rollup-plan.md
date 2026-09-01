# Rate/margin rollup — implementation plan

Follows `docs/plans/2026-09-01-rate-margin-rollup-design.md`, approved as written. Ordering
follows the standard rule: the pure additions (`SowPosition`'s new fields, `sowCostOf`) are
provable directly via a scenario before `CommercialPanel` consumes either.

## Step 1 — `lib/sow.ts`: variance rollup on `SowPosition`

`SowPosition` (`lib/sow.ts:97-137`) gains two fields, next to `estimatedCount`/`unestimatedCount`:

```ts
/** Signed sum of effortVariance across issues whose estimate has been baselined. Positive is a
 *  net overrun. An issue not yet baselined contributes nothing. */
varianceHours: number
/** How many issues contributed — the exclusion made visible, same role as estimatedCount. */
varianceIssueCount: number
```

`sowPosition()` (`lib/sow.ts:146-205`) already loops `issueIds` once for `plannedHours`/
`estimatedCount`. Add the variance accumulation to that same loop rather than a second pass:

```ts
let varianceHours = 0
let varianceIssueCount = 0
for (const id of issueIds) {
  const estimate = estimates[id]
  const hours = estimate ? deriveEffort(estimate, bands).effortHours : null
  if (hours === null) { unestimatedCount += 1; continue }
  estimatedCount += 1
  plannedHours += hours
  if (estimate.baselinedAt) {
    const v = effortVariance(timeEntries, id, estimate, bands)
    if (v.varianceHours !== null) {
      varianceHours += v.varianceHours
      varianceIssueCount += 1
    }
  }
}
```

`lib/sow.ts` already imports `type TimeEntry` and `hoursOn` from `./time` — add `effortVariance`
to that same import line. Round `varianceHours` the same way `plannedHours`/`actualHours` are
rounded in the existing `return`.

**Verification:** `npx tsc --noEmit`.

## Step 2 — `lib/rates.ts`: `sowCostOf`

Beside `costOf` (`lib/rates.ts:152-192`):

```ts
/**
 * What a SOW's real worked hours cost and earned — the join between "which hours belong to this
 * SOW" and costOf's own pricing. No new pricing logic; this function only gathers the input.
 *
 * An entry with no resolvable personId (an unresolved name — see the person/personId seam) folds
 * into unratedHours exactly like an entry with no rate on its day: two different causes, one
 * honest absence, never two silent failure modes wearing the same blank space.
 */
export function sowCostOf(
  rates: PersonRate[],
  issueIds: string[],
  timeEntries: Record<string, TimeEntry>,
): CostOfWork {
  const live = Object.values(timeEntries).filter((e) => !e.deletedAt && issueIds.includes(e.issueId))
  const withPerson = live.filter((e) => e.personId)
  const noPersonHours = withPerson.length === live.length
    ? 0
    : Math.round(live.filter((e) => !e.personId).reduce((n, e) => n + e.hours, 0) * 100) / 100

  const priced = costOf(
    rates,
    withPerson.map((e) => ({ personId: e.personId!, date: e.date, hours: e.hours })),
  )
  if (noPersonHours === 0) return priced

  return {
    hours: Math.round((priced.hours + noPersonHours) * 100) / 100,
    cost: null,
    revenue: null,
    margin: null,
    marginPct: null,
    currency: priced.currency,
    unratedHours: Math.round((priced.unratedHours + noPersonHours) * 100) / 100,
  }
}
```

Needs `TimeEntry` imported into `lib/rates.ts` (check current imports — likely not present yet,
since `lib/rates.ts` today only imports from `./versioning`).

**Verification:** `npx tsc --noEmit`.

## Step 3 — scenario: prove both additions directly

Extend `RT1` (`scripts/scenario-validation.ts`, ~line 3757-3874) rather than adding a new id —
it already builds a `PersonRate[]` fixture and is the natural home. After its existing
assertions, before the `return`:

1. Build a small SOW + 2-3 issues via the same `upsertSow`/`create` pattern scenario O and P
   already use, with estimates on at least two (one baselined via `setEstimate`+
   `baselineEstimate`, one left unbaselined) and `addTime` entries against them — reuse `RT1`'s
   existing `P`/rate fixtures for the `personId`s so the rates already recorded apply.
2. Add one `addTime` entry whose `person` does not resolve to any directory entry (so its
   `personId` stays unset on the stored row — the same mechanism `TW2` already exercises) to
   prove `sowCostOf`'s no-`personId` fold-in.
3. Assert `sowPosition(...).varianceHours` and `.varianceIssueCount` reflect only the baselined
   issue's variance, and `sowCostOf(rates, issueIds, timeEntries).unratedHours` includes the
   unresolved entry's hours with `cost === null`.

**Verification:** `npm run validate:scenarios` — `RT1` still reports (verdict and text updated
per step 5), 0 FAIL, scenario count unchanged (same id, strengthened in place).

**Detail most likely to be gotten wrong:** an `addTime` action needs a `person` string that
genuinely does not resolve via `directoryIdByName` — reread `BASE`'s directory fixture before
picking a name, so it is actually unmatched rather than accidentally hitting a real seeded person.

## Step 4 — `CommercialPanel.tsx`: wire both, cost gated on `rate.view`

`positions` (`components/CommercialPanel.tsx:169-176`) already maps `sows` to `sowPosition(...)`
results using a per-SOW `ids` (issueIds) computed inline — `varianceHours`/`varianceIssueCount`
arrive on `position` automatically once step 1 lands, no change needed to this `useMemo` itself.

Add, beside the existing `mayDecideChange`/`mayEditScope` permission checks (~line 96-100):

```ts
const mayViewRate = can(state.model, actor, 'rate.view')
```

Add a parallel `useMemo`, reusing the same per-SOW `ids` computation `positions` already does
(duplicate the `projects.filter(...).flatMap(...)` line rather than restructuring `positions`
itself — the two arrays serve different permission scopes and should stay independently
computable):

```ts
const costPositions = useMemo(() => {
  if (!mayViewRate.allowed) return null
  return sows.map((sow) => {
    const ids = projects.filter((p) => p.sowId === sow.id).flatMap((p) => issuesUnder[p.id] ?? [])
    return sowCostOf(Object.values(state.rates), ids, state.timeEntries)
  })
}, [mayViewRate.allowed, sows, projects, issuesUnder, state.rates, state.timeEntries])
```

Import `sowCostOf` and `describeCost` from `@/lib/rates` at the top of the file.

In the per-SOW render block (~line 235-260, the `comm-figures` block and the `describePosition`
line right after it): add a variance line unconditionally, right after the existing
`describePosition` paragraph:

```tsx
{position.varianceIssueCount > 0 && (
  <p className={`comm-position${position.varianceHours > 0 ? ' warn' : ''}`}>
    {position.varianceHours > 0 ? '+' : ''}{position.varianceHours}h against baseline across{' '}
    {position.varianceIssueCount} baselined {position.varianceIssueCount === 1 ? 'issue' : 'issues'}.
  </p>
)}
```

And, only when `mayViewRate.allowed`, a cost block using `costPositions[i]` and `describeCost`:

```tsx
{costPositions && (
  <p className="comm-position">{describeCost(costPositions[i])}</p>
)}
```

**Detail most likely to be gotten wrong** — the exact one the design doc calls out: when
`costPositions[i].unratedHours > 0`, `describeCost` already produces the honest-absence
sentence ("N of Mh has no rate on the day it was worked"). This must never render for someone
without `rate.view` — confirmed by construction here since `costPositions` is `null` entirely in
that case — but double-check no other code path (a future edit) could call `describeCost` outside
this `mayViewRate.allowed` guard.

**Verification:** `npx tsc --noEmit`; `npm run audit:a11y` (two new text blocks, no new
interactive controls — expect 0).

## Step 5 — correct `RT1`, `J`, `K` scenario text in place

All three currently describe this exact gap as unclosed. Update each `stops` (and `verdict`
where earned):

- `RT1`: `stops` moves from *"nothing feeds worked hours into this yet, and no screen shows the
  result"* to reflect that `sowCostOf` now feeds it and `CommercialPanel` now shows it, gated on
  `rate.view`.
- `J`: `stops` moves from *"at money — hours are recorded, and a rate to multiply them by does
  not exist anywhere"* — the rate and the multiplication both now exist and reach a screen; if
  `J`'s own fixture doesn't already touch a SOW/rates, either extend it to prove the join or say
  plainly in the corrected text that the money side is proven by `RT1`, not by `J` itself.
- `K`: `stops` moves from *"before it reaches the project — the variance is per issue, and
  nothing rolls it up to a milestone, a SOW or a margin"* to state the SOW half is now rolled up,
  and milestone-level attribution remains open (out of scope per the design doc, not silently
  dropped).

**Verification:** `npm run validate:scenarios` — 0 FAIL, count unchanged (all three ids
strengthened in place, no new ids besides what step 3 added to `RT1`).

## Step 6 — standing gate, commit, staged deploy

```
npx tsc --noEmit
npm run validate:scenarios      # RT1/J/K corrected, 0 FAIL
npm run audit:a11y              # two new text blocks, no new controls — expect 0
npm run build
```

One commit — steps 1-5 are meaningless in isolation the same way the CR-approval-join round's
were (the pure additions have no caller until the UI step lands, the UI step doesn't compile
without them), so they land together.

Then the established staged-deploy recipe: `git archive $SHA` → fresh dir under
`$HOME/.claude/jobs/de2e6ea5/tmp/deploy-<sha>` → `npm ci` → `prisma generate` → `npm run build` →
`npx prisma migrate status` (expect "Database schema is up to date!", no schema touched) →
`MSYS_NO_PATHCONV=1 python scripts/package-release.py .next/standalone release.zip --extra
.next/static:.next/static --extra public:public` → `az webapp deploy` → health poll on
`"database":"connected"` → verify via grep-ing a distinctive new string (e.g. `"against
baseline across"` or `"no rate on the day it was worked"`) inside a deployed
`.next/static/chunks/*.js` or `.next/server/chunks/*.js` file.

## The step carrying the most regression risk

**Step 4's `mayViewRate` gate.** Every other step is additive (new fields, a new pure function,
corrected scenario text). Step 4 is the one place a mistake has a real consequence beyond a
wrong test result: if `costPositions` were ever computed or rendered without checking
`mayViewRate.allowed` first, cost/margin figures — the one class of data `lib/rates.ts`'s own
header comment explains was deliberately kept out of `WorkspaceState.versions` specifically to
avoid this — would reach a reader without `rate.view`. `boot()`'s redaction of `state.rates` to
`{}` for such an actor is a second, independent line of defense (an unpermissioned reader's
`sowCostOf` call would see empty rates and get an all-`unratedHours` result even if the UI gate
were missing) — but the plan should not rely on that alone; the explicit `mayViewRate.allowed`
check in the component is the one to get right.

## What would send this back

- If `sowCostOf`'s fold-in of no-`personId` hours turns out to make `unratedHours` misleading in
  some case not yet considered (e.g. a large volume of genuinely-unattributable historical
  entries dominating every SOW's total) — a finding for implementation to surface, not assumed
  here.
