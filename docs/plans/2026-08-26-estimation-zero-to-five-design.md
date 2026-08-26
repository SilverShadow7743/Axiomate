# Estimation: 0–5 per-dimension scoring, normalized to the Axiomate model

## Problem

The request was "Estimation should start from numbering 0 to 5 score instead of 1 to
5." That reads simply, but the current 1–5 scale is load-bearing in three places at
once: `lib/estimation.ts`'s `emptyScores()` already returns `0` per dimension as the
"nothing entered yet" sentinel, and `isScored()` checks `>= 1` specifically so a `0`
reads as unscored — the doc comment says "a scored 0 is not a score." `lib/estimator.ts`
independently depends on `0` meaning "no rule has touched this parameter yet," and
floors every touched parameter to a minimum of 1 before returning. Widening the scale to
include a real `0` breaks both without a design, not just a wider `<input>`.

Two source documents settled what "0" is actually supposed to mean and how it fits the
firm's real estimation model, superseding an initial recommendation made before either
was found:

- `Activity Logger.xlsx` ("Effort" sheet) — a live reference table and worked per-outcome
  examples already in production use.
- `Axiomate_Estimation_Model_Team_Training.pptx` — the canonical "Team Training — Effort
  Estimation" deck, more authoritative than either the spreadsheet or an unverified
  default. Quotes below are from this deck; it is the source of truth for this design.

## The score scale

`COMPLEXITY_LEVELS` becomes the deck's own table (slide 7) exactly — including a label
correction from the shipped "Medium" to "Moderate":

| Score | Label | Meaning |
|---|---|---|
| 0 | None | No meaningful effort in this dimension |
| 1 | Very low | Minimal impact; straightforward |
| 2 | Low | Small amount of work or limited complexity |
| 3 | Moderate | Normal delivery complexity |
| 4 | High | Significant complexity, dependencies or uncertainty |
| 5 | Very high | Complex, cross-functional or high-risk |

0 is a real, common score, not an edge case — the deck states this explicitly ("Technical
= 0 is a valid, common score. Functional-only configuration and fit-gap work still
carries real complexity — captured through Business, Testing and Data") and every worked
example in the deck scores at least one dimension at 0.

## The unscored sentinel

Since `0` is now a real score, "not yet scored" needs its own representation.
`ComplexityScores` becomes `Record<ComplexityKey, number | null>`. `emptyScores()`
returns `null` per dimension. `isScored()` checks `s[p.key] !== null` for every
parameter, replacing the old `>= 1 && <= 5` bound. `totalComplexity()` treats `null` as
`0` when summing (defensive — it should not throw on a partially-scored estimate, which
`isScored()` already reports honestly as not-yet-scored regardless of the sum).

This exact null-vs-zero distinction is already how the firm's own spreadsheet records
estimates: one worked row (SLG-POSENH-1) has Integration entered as literal `0` and
totals 10; another (Axio-Growth-1) has Business=5 with Technical/Integration/Testing/Data
left **blank**, not zero. The design just gives the app's own storage the same
distinction the firm is already keeping by hand.

## Normalization — the piece this session had missed

The real Axiomate model does not map the raw 5-dimension total (0–25) directly to size
bands. It normalizes first (deck, slide 13):

    Raw Total = Business + Technical + Integration + Testing + Data      (max 25)
    Normalised Score = ROUND( (Raw Total / 25) × 15 )                    (0–15 band)

"Axiomate's T-shirt mapping uses a 0–15 band, so the five raw dimension scores (max 25)
are normalised before size thresholds are applied. Use one scoring method consistently —
never mix a 25-point raw score with 15-point thresholds." Every worked example in the
deck shows both numbers side by side (e.g. "Raw Total: 12" then "12/25×15=7.2→7", result
M) — the raw total explains *why*, the normalized score decides the size.

`lib/estimation.ts` gains:

```ts
export const NORMALISED_MAX = 15 // the deck's fixed 0–15 band, not derived from COMPLEXITY_PARAMETERS.length
export function normaliseScore(raw: number): number {
  return Math.round((raw / MAX_COMPLEXITY) * 15)
}
```

`deriveEffort()` calls `normaliseScore()` between `totalComplexity()` and
`bandForScore()`, so bands are matched against the normalized score, not the raw total.
`EffortResult` carries both: `rawScore` (unchanged meaning, the old `score` field) and
`score` (now the normalized value bands are actually matched against) — the UI shows
both, matching the deck's own presentation, not one replacing the other.

## Size bands

`DEFAULT_SIZE_BANDS`' `minScore`/`maxScore` become the deck's own normalized thresholds
(slide 15) exactly — XS 0-3, S 4-6, M 7-9, L 10-12, XL 13-15. No tier below XS: the deck's
own threshold table has none, directly contradicting an earlier "add a new tier" answer
given before this deck was found.

XXL and 3XL keep no scored range in the normal sense — a normalized score is
mathematically capped at exactly 15 (25/25×15), so nothing beyond XL is *reachable* by
the formula. The deck is explicit about this (slide 15): "For work scoring above 15,
treat the item as an XXL / 3XL candidate and review it for decomposition rather than
scoring it directly," and governance for XXL/3XL is "Separate SOW / Project," not a
score-driven approval. They still need a `minScore`/`maxScore` in the app's `SizeBand`
type (both fields are required) and still need to be selectable — the existing
`sizeOverride` field is exactly the mechanism — so they get a nominal range above the
reachable ceiling (XXL 16-20, 3XL 21-25) purely so `bandProblems()` keeps reporting a
clean, gap-free configuration. In practice that range is dead territory for
`bandForScore()`; only an override or a future change to the model (more dimensions, a
higher per-dimension max) could ever reach it.

**Explicitly out of scope:** the deck's own hours/story-points table (slide 14) uses a
different calibration from what's shipped today (e.g. XS: 2–4h vs. the app's single 4h;
M: 24–40h vs. the app's single 16h) and a low/high range shape the app's `SizeBand`
doesn't have (`effortHours` is one number, not a range). Recalibrating those numbers, or
changing the shape to a range, is not required by "0 to 5 scoring" and is not part of
this change — `effortHours`/`storyPoints` are already firm-editable configuration, per
`SizeBand`'s own doc comment ("a starting point a firm is expected to change... which is
exactly why they are editable"). Only `minScore`/`maxScore` change, because normalization
makes the old raw-total ranges wrong regardless of what this request asked for.

## The auto-estimator (`lib/estimator.ts`)

Its internal working scores also start `null`-based (reusing `emptyScores()`). Rule-weight
assignment (`if (value > scores[key]) scores[key] = value`) treats `null` as lower than
any real weight. `NO_SIGNAL_FLOOR`'s fill-in step checks `=== null` instead of `=== 0`.
`bump()` drops its `> 0` guard in favor of `!== null` (a dimension no rule has touched at
all still cannot be bumped by a type/severity signal alone). The final pass that used to
force every parameter to `Math.max(1, Math.min(5, ...))` is replaced: a parameter still
`null` after all rules run becomes an explicit `0` ("nothing in the text suggested this
applies") instead of being inflated to 1 — dropping a floor the deck's own worked
examples show isn't how a person would score it by hand either. This means every future
auto-proposed total will generally read lower than today's for issues that don't clearly
speak to every dimension; that is the intended, more honest behavior, not a regression to
guard against.

## UI (`components/EstimationTab.tsx`, `components/ConfigWorkspace.tsx`)

Both already iterate `COMPLEXITY_LEVELS` and the configured size bands data-driven — the
new `0` dot and the widened XS range need no separate UI code once the data model above
is fixed. The dot-lit comparison (`estimate.scores[p.key] === l.score`) already does the
right thing once `null`, not `0`, is the unscored sentinel — today's bug (an unscored
dimension rendering as if "0" were already chosen) disappears as a side effect of fixing
the sentinel, not from a separate UI fix.

The existing derivation chain at `components/EstimationTab.tsx`'s "A · Complexity and
effort" section (`{effort.scored ? effort.score : '—'} / {MAX_COMPLEXITY} → size → points
→ hours`) gains one more step for the normalized score, matching the deck's own
presentation of raw → normalized → size: `raw / 25 → normalized / 15 → size → points →
hours`. The section's descriptive text ("Five parameters, one to five each") is corrected
to "zero to five each."

## Schema migration — real production data

`prisma/schema.prisma`'s `IssueEstimate` stores the five dimensions as `Int @default(0)`
columns, with a doc comment reading "0 means 'not scored yet'." That confirms the
migration is unambiguous: under the *current* schema, a stored `0` has only ever meant
unscored, since no write path could previously store a deliberate `0` (the UI only ever
wrote 1–5, and the estimator floored everything to at least 1). The five columns become
nullable (`Int?`, default removed, comment corrected), and — in the same migration, not a
follow-up — every existing stored `0` in `business`, `technical`, `integration`,
`testing`, `data` is set to `NULL`. An `ALTER COLUMN` alone would leave every
already-unscored dimension in production silently reinterpreted as "deliberately scored
0" under the new meaning, which is exactly the kind of thing this session already learned
to check directly against the database rather than assume.
