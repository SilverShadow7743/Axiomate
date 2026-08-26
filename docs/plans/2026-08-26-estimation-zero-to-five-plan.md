# Estimation: 0–5 scoring, normalized — implementation plan

Follows `docs/plans/2026-08-26-estimation-zero-to-five-design.md`, approved by the user.
Quotes below are that design's constraints, not restated from memory.

## What's already true, checked before writing this

- **The complexity/sizing engine has zero scenario-suite coverage today.**
  `scripts/scenario-validation.ts` imports only `summarise` from `lib/estimation.ts` and
  nothing at all from `lib/estimator.ts` — no scenario exercises `isScored`,
  `bandForScore`, `deriveEffort`, or `proposeEstimate` directly. Step 1 is not "update
  existing scoring scenarios," there are none; it's the first coverage this logic gets.
- **Four existing scenarios use `setEstimate`** (`K` at line ~1052, `N` at line ~1122, one
  at line ~673, one at line ~1578) but none depend on the scoring/banding change: line
  673 and `N` set `approvedEffortHours` directly, which bypasses band-derived hours
  entirely (`deriveEffort`'s precedence is `approvedEffortHours ?? breakdownHours ??
  suggested`); line 1578 only sets `waitDays`. `K` is the one worth re-checking by
  arithmetic, not just trusting: scores `{business:2, technical:2, integration:1,
  testing:2, data:1}`, raw total 8. Old bands (raw-based): 8 falls in S (8–10). New
  bands (normalized): `round(8/25×15) = round(4.8) = 5`, which falls in the new S (4–6)
  — same band, same `effortHours` (unchanged, out of scope per the design). `K` should
  still pass unmodified; Step 1's verification confirms this by running the suite, not
  by trusting this by-hand check.
- **The reducer's merge is shallow and already correct for partial score patches.**
  `lib/workspace.ts`'s `setEstimate` arm (`case 'setEstimate'` at line 3511) does
  `{ ...base, ...a.patch, ... }` — a patch carrying `scores` replaces the whole `scores`
  object, not a deep merge. `components/EstimationTab.tsx`'s dot click already sends the
  full merged object (`put({ scores: { ...estimate.scores, [p.key]: l.score } })`), so no
  reducer change is needed for the sentinel change to work — the client already carries
  the other dimensions' current values (soon to include `null`) through untouched.
- **The DB mapping layer needs no code change, only a schema-driven type flow-through.**
  `lib/db/map.ts`'s `estimateToRow`/`estimateFromRow` (lines 584–623) are a direct
  five-field pass-through with no cast, no non-null assertion, and `EstimateRow` is a
  bare import alias for Prisma's generated `IssueEstimate` type (line 10: `IssueEstimate
  as EstimateRow`). Once the schema's five columns become `Int?`, Prisma regenerates
  `number | null` for them and these two functions typecheck against the new
  `ComplexityScores` with zero edits — confirmed by `npx tsc --noEmit` in Step 1.5, not
  assumed.
- **`lib/actionShape.ts`'s `setEstimate` entry** (`patch: req(plainObject)`) does not
  shape-validate inside `scores` today and doesn't need to for this change — out of
  scope, unchanged.

## Step 1 — Pure logic: `lib/estimation.ts`, `lib/estimator.ts`, and new scenarios

**Files:** `lib/estimation.ts`, `lib/estimator.ts`, `scripts/scenario-validation.ts`.

`lib/estimation.ts`:
- `ComplexityScores` (line 76) → `Record<ComplexityKey, number | null>`.
- `COMPLEXITY_LEVELS` (line 79) → the deck's table: `{0,'None'}, {1,'Very low'},
  {2,'Low'}, {3,'Moderate'}, {4,'High'}, {5,'Very high'}` — note `'Moderate'`, not the
  shipped `'Medium'`.
- `MIN_COMPLEXITY` (line 87) → `0`. `MAX_COMPLEXITY` (line 88) unchanged (still
  `COMPLEXITY_PARAMETERS.length * 5` = 25 — it describes the *raw* total, which the
  design doesn't change).
- `totalComplexity()` (line 90): sum treating `null` as `0` — `sum + (s[p.key] ?? 0)`.
- `emptyScores()` (line 94): return `null` per key, not `0`.
- `isScored()` (line 99): `COMPLEXITY_PARAMETERS.every((p) => s[p.key] !== null)`.
- New: `export const NORMALISED_MAX = 15` and `export function normaliseScore(raw:
  number): number { return Math.round((raw / MAX_COMPLEXITY) * 15) }`, placed beside
  `totalComplexity()`.
- `DEFAULT_SIZE_BANDS` (line 134): `minScore`/`maxScore` become XS 0-3, S 4-6, M 7-9,
  L 10-12, XL 13-15, XXL 16-20, 3XL 21-25. `storyPoints`/`effortHours` untouched per the
  design's explicit scope boundary.
- `EffortResult` (line 247): rename the existing `score` field's *meaning* by adding a
  second field — `rawScore: number` (what `score` used to hold) and `score: number` (now
  the normalized value, what's actually passed to `bandForScore`). Pick whichever of the
  two names reads better at each call site; the design's requirement is that both values
  are present on the result, not the exact field names.
- `deriveEffort()` (line 264): `const rawScore = totalComplexity(e.scores)`, `const
  score = normaliseScore(rawScore)`, then `bandForScore(bands, score)` — normalization
  inserted exactly where the design says, between the two existing calls.

`lib/estimator.ts`:
- Rule-weight loop (lines 264–269): `if (scores[key] === null || value > scores[key])
  scores[key] = value`.
- `NO_SIGNAL_FLOOR` loop (lines 271–273): check `=== null` instead of `=== 0`.
- `bump()` (line 316): guard `!== null` instead of `> 0`.
- Final pass (lines 298–301): replace the `Math.max(1, Math.min(5, ...))` clamp with
  `scores[p.key] = scores[p.key] === null ? 0 : Math.min(5, scores[p.key])` — a
  still-untouched parameter becomes an explicit `0`; a touched one is only clamped at
  the top, never floored.

New scenarios (fresh coverage, no existing ones to disturb — id prefix check first:
`grep -n "  'EZ[0-9]'" scripts/scenario-validation.ts` to confirm `EZ` is free, same
discipline as this session's `TK` rename after a `TG` collision):
- **EZ1** — `isScored`/`emptyScores`: a freshly-emptied `ComplexityScores` has every key
  `null` and is not scored; setting all five to `0` (not omitting them) makes it scored,
  with `totalComplexity` reporting `0`.
- **EZ2** — `normaliseScore` boundary-by-boundary: raw `0→0`, raw `25→15` (both ends
  exact), and the design's own worked figure raw `12→7` (`round(7.2)`) — proving the
  rounding direction matches the deck, not just the endpoints.
- **EZ3** — `bandForScore` against the new normalized thresholds: scores that produce
  normalized `3` and `4` land in XS and S respectively (the boundary the deck actually
  draws), and a hand-built normalized `16` (unreachable by the real formula, reachable
  only by calling `bandForScore` directly with a fabricated value) lands in XXL, proving
  the nominal 16-20/21-25 ranges are configured, not just documented.
- **EZ4** — `deriveEffort` end-to-end on the design doc's own worked example (Business
  4, Technical 5, Integration 0, Testing 2, Data 1): raw `12`, normalized `7`, size `M` —
  matching the deck's own slide 13 arithmetic exactly, so a future reader can check this
  scenario against the deck directly.
- **EZ5** — `proposeEstimate` no longer floors: an issue whose text fires a rule that
  only touches `business` (via `RULES`, not `NO_SIGNAL_FLOOR`'s `integration` special
  case) ends up with `technical`/`testing`/`data` at explicit `0`, not `1` — and the
  result is still `scored: true`, `outcome: 'scored'` (a rule fired; the drop of the
  floor changes the *values*, not whether the proposal counts as complete).

**Verify:** `npx tsc --noEmit`, then `npm run validate:scenarios` — `EZ1`–`EZ5` new and
`PASS`, the full existing suite (155 scenarios today) still passing including `K`
unmodified, `0` `FAIL`.

This step stands alone as one commit — the type change, the normalization function, and
its test coverage are meaningless split apart (a `ComplexityScores` type change with no
scenario proving `isScored`/`normaliseScore` behave is exactly the kind of "trust me"
change this project's own scenario-suite culture exists to avoid).

## Step 2 — Schema migration: `prisma/schema.prisma`

**Files:** `prisma/schema.prisma`, a new migration under `prisma/migrations/`.

`IssueEstimate`'s five columns (lines 936–940) go from `Int @default(0)` to `Int?`, with
the doc comment at line 935 corrected from `"0 means 'not scored yet'"` to something
describing the new meaning (0 is a real score; `NULL` is unscored). The migration SQL
does both in one file, not two:

```sql
ALTER TABLE "IssueEstimate" ALTER COLUMN "business" DROP DEFAULT, ALTER COLUMN "business" DROP NOT NULL;
-- (repeat for technical, integration, testing, data)
UPDATE "IssueEstimate" SET business = NULL WHERE business = 0;
-- (repeat for technical, integration, testing, data)
```

**This is the detail most likely to be gotten wrong: deploy order.** The schema
migration must reach production *before* the app code from Step 1/3 does, not after.
Reasoning, checked rather than assumed: the *old* `isScored()`
(`s[p.key] >= 1 && s[p.key] <= 5`) evaluates `null >= 1` as `false` (JS coerces `null` to
`0` for numeric comparison) — so old app code reading a migrated row with `NULL` columns
still correctly reports it as unscored, and old `totalComplexity()`'s `s[p.key] || 0`
treats `null` as `0` in the sum, same as before. The migration is backward-compatible
with the code currently running. The reverse is not: if Step 1/3's app code (whose new
`isScored()` checks `!== null`) reaches production while the columns are still `Int
@default(0)`, every issue that has genuinely never been scored reads `business: 0` (etc.)
from the database, the new `isScored()` sees five real numbers, and every unestimated
issue in the register would suddenly render as "scored, XS, total 0" instead of "Not
scored" until the migration catches up. Schema first, app code second — the opposite of
the usual "expand, then migrate data, then contract" instinct, because here the old code
already tolerates the new column shape by accident and the new code does not tolerate
the old one.

**This runs against the real production database** (`axiomate-tms-db.postgres.database.
azure.com`, confirmed this session — not a separate dev instance). Before running:
count existing `IssueEstimate` rows with any of the five columns `= 0`
(`SELECT count(*) FROM "IssueEstimate" WHERE business=0 OR technical=0 OR integration=0
OR testing=0 OR data=0`) and after the migration, re-run `estimateFromRow`'s shape
against a handful of those same `issueId`s to confirm the columns that were `0` are now
`NULL` and nothing else moved — the same direct-database-verification discipline this
session already used for the timesheet-grid work, not a trust-the-migration-tool
assumption.

This step stands alone as its own commit — a schema/migration change never merges with
application code in this project's established convention (seen in every other plan
this session touched a schema).

## Step 3 — Wire the UI: `EstimationTab.tsx`, `ConfigWorkspace.tsx`

**Files:** `components/EstimationTab.tsx`, `components/ConfigWorkspace.tsx`.

Per the design, most of this "falls out" of Steps 1–2 with no code change — the dot-lit
comparison (`estimate.scores[p.key] === l.score`, line 254) and the size-band editor
(data-driven off `DEFAULT_SIZE_BANDS`, line 1546) already do the right thing once the
sentinel and band values are fixed underneath them. What still needs an actual edit:

- Line 124 (`{effort.scored ? `${effort.score} / ${MAX_COMPLEXITY}` : 'Not scored'}`):
  decide whether this reads `effort.score` (normalized, out of 15) or `effort.rawScore`
  (out of 25) — the design says show both somewhere, so this summary line and the
  derivation chain below shouldn't show the *same* number twice with no distinction.
- Lines 270–285 (the arrow chain `raw/25 → size → points → hours`): insert the
  normalized-score step so it reads `raw / 25 → normalized / 15 → size → points →
  hours`, matching the deck's own worked-example presentation (raw total, then the
  `round((raw/25)×15)` line, then the result).
- Line 239 ("Five parameters, one to five each"): "zero to five each."

**Verify:** `npx tsc --noEmit`, `npm run build`, then interactive browser verification
against the dev server. Follow this session's own established (and hard-won) checklist
for this exact codebase, not a generic one:
1. Start `next dev` with `AXIOMATE_ENTRA_CLIENT_ID=` blanked for that process only
   (single-operator mode), per this session's precedent.
2. **Unregister the Service Worker and clear `caches` before testing anything** —
   `navigator.serviceWorker.getRegistrations()` → `unregister()`, `caches.keys()` →
   `delete()` each. This session lost real time to `sw.js` silently serving a pre-fix
   bundle across ordinary reloads during the timesheet-grid work; do this first, not
   after a confusing repro.
3. Open a real issue's Estimation tab, confirm: the dot row now has six dots (0–5) per
   dimension, clicking `0` lights it correctly and is visually distinct from no
   selection, the arrow chain shows both raw and normalized figures matching what
   `EZ4`'s worked example predicts for the same inputs, and a size-band edit in
   Configuration reflects the new XS/S/M/L/XL score ranges.
4. **This dev server points at the real production database** (confirmed this session,
   not a separate instance). Any `IssueEstimate` touched during this verification is
   real production data. After testing, either revert the touched issue's estimate to
   its prior state or note its `issueId` and confirm no lasting change was intended to
   persist — the same cleanup discipline this session used for the timesheet-grid
   feature's test `TimeEntry` rows (created via the browser, withdrawn via the app's own
   `setEstimate`/reducer path afterward, confirmed by a direct database query, not by
   trusting the UI).

This step is one commit — the display fix and its browser verification belong together;
splitting the arrow-chain edit from confirming it renders correctly would leave an
unverified UI change sitting in history.

## The regression-risk step, named

**Step 1's estimator floor-removal, not Step 2's migration.** The migration is riskier
to production *data* if the ordering above is ignored, but it's a one-time, reversible,
directly-verifiable event with an explicit before/after count. The estimator change is
different in kind: `proposeEstimate()` already runs on every new issue this domain
recognizes, today, in production, and the moment this ships, every future auto-generated
estimate's numbers change — lower totals, more visible zeros — for issues nobody has
looked at yet and will act on as if the AI wrote what it always writes. There's no
gradual rollout and no flag; it's a behavior change in code that already runs. If the
floor-removal is wrong (say, a dimension that genuinely always applies to Dynamics F&O
work gets read as `0` because no rule happens to name it), the failure mode is a
plausible-looking auto-estimate that under-states real work, silently, for every issue
the agent touches until somebody notices the pattern in delivered-vs-estimated variance
weeks later — exactly the slow, hard-to-trace failure `assumptionsFor()`'s own header
comment already worries about ("this is a starting point for a conversation, not a
commitment"). `EZ5` covers the mechanism; it cannot cover whether the domain rules
`RULES`/`NO_SIGNAL_FLOOR` are actually complete enough for zero-as-default to be safe —
that's a judgment call the design already made ("more honest... not a regression to
guard against"), and this plan's job is only to flag that it lands in production the
moment Step 1 ships, with no separate gate.

## What would send the design back

- **If `EZ4`'s worked-example arithmetic doesn't match the deck's own slide 13 figure**
  (raw 12 → normalized 7 → M) once actually coded, the normalization formula itself is
  wrong, not the implementation — surfaces immediately in Step 1, cheapest possible
  point, before anything else depends on it.
- **If a real, current production `IssueEstimate` row has any of the five score columns
  at a *non-zero* value that the current app could not have produced** (found while
  running Step 2's before/after count) — that would mean the "every existing 0 has
  always meant unscored" assumption the whole migration safety argument rests on is
  wrong, and the migration needs to be rethought before it runs, not patched after.
- **If the size-band editor in `ConfigWorkspace.tsx` turns out to let a firm set
  `minScore`/`maxScore` outside 0–15** (not yet checked) — the design assumes bands are
  configured against the normalized scale, and if the editor UI doesn't make that scale
  obvious, a firm recalibrating their own bands could silently target the wrong number
  space (raw 0-25 instead of normalized 0-15). Surfaces in Step 3's browser check; if
  found, the editor needs a label change at minimum, possibly a design note about how
  the two scales are explained to a configuring admin.
