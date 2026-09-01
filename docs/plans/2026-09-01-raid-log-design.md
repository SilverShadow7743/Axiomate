# RAID log — Organizational Memory's first buildable slice

**Status: approved 2026-09-01** (three AskUserQuestion decisions, recorded below). Sixth
concrete step out of the product-vision work, picked from `docs/strategy/axiomate-vision.md`'s
own guidance: Pillar 9 (Organizational Memory) and Pillar 11 (Business Operations) were flagged
as the strongest remaining non-AI-blocked candidates, with real unbuilt structure already in
`RaidKind`.

## What's real today, and the actual gap

`lib/raid.ts` already classifies an issue as `'risk'` or `'decision'` via `raidKindOf()`,
resolved through the live work-type registry by stable id (`WT_RISK`/`WT_DECISION`), not by
label — a renamed type keeps its semantics. A Risk carries `riskLikelihood`/`riskImpact`
(1–5, nullable — "not yet judged" is a real, distinct state, never defaulted).
`exposure(likelihood, impact)` is **always computed, never stored** — the same "never invent a
fact nobody stated" discipline as everywhere else in this codebase. A Decision carries
`decisionOutcome: string`. Both fields are real and already editable — confirmed in
`components/OverviewTab.tsx` — but only one issue at a time, in that issue's own Overview tab.

**The actual gap, checked rather than assumed**: `lib/search.ts` (built earlier this session)
never searches `decisionOutcome`, never surfaces `riskLikelihood`/`riskImpact`/exposure band,
and has no RaidKind awareness at all — it can find a risk or decision by keyword if you already
know roughly what you're looking for, but there's no way to browse "every open Critical risk"
or "every decision made this month" without opening records one at a time. Portfolio
(`lib/portfolio.ts`) has no RAID-aware concern either.

## The three decisions

1. **Extend the Tree view, not a new screen.** Tree already has a real, user-toggleable column
   system (`lib/columns.ts`'s `ColumnDef[]`) and a filter bar with Saved Views. A new dedicated
   screen would duplicate both for no real gain — this is fundamentally "browse issues with a
   narrower lens and two more fields," which is exactly what Tree's grid already does for every
   other lens.
2. **A new, separate filter facet — not multi-select on the existing `type` filter.**
   `matchesFilters`'s `type` check (`lib/tree.ts:379`) is exact-match, single-value, and shared
   by every other view that filters on type. Converting it to multi-select for this one
   feature's need would be a bigger, riskier change to a widely-used facet than the feature
   itself asks for. A new `raidOnly: boolean` is additive and touches nothing else.
3. **Combined Risk+Decision filtering is needed** — the point of an organizational-memory log is
   seeing both together ("everything judged or decided, in one place"), not just narrowing to
   one type at a time (which the existing `type` filter already does, for free).

## What's computed

`buildTree()` (`lib/tree.ts`) gains one more field per row, computed once per row, not
re-derived per filter check: `raidKind: 'risk' | 'decision' | null`, via the already-real
`raidKindOf(state.model, issue.type)`. `ScheduleRow` (`lib/types.ts`) gains three more nullable
fields — `riskLikelihood`, `riskImpact`, `decisionOutcome` — copied straight from the issue at
both of `buildTree`'s existing construction sites (the real row and the empty "seed" row),
exactly the way `severity`/`owner`/every other field already is. No new derivation logic; this
is the same copy-through pattern the file already follows for a dozen other fields.

## The filter

A new `raidOnly: boolean` on `FilterState`, checked in `matchesFilters`
(`if (f.raidOnly && row.raidKind === null) return false`) — additive, doesn't touch the
existing `type`/`status`/`owner`/etc. checks. Surfaced as a checkbox in the filter bar, not a
dropdown: it's binary (show RAID records, or don't), not a value picked from a list. Combines
with every existing filter for free — "open Risks only" is already possible via the existing
type filter; `raidOnly` adds "Risks and Decisions together," and a person can still narrow
further (by status, owner, client) using controls that already exist.

## The two new columns

Following `lib/columns.ts`'s exact existing `ColumnDef` shape, both invisible by default (added
to `COLUMNS`, not to `DEFAULT_VISIBLE`) — nobody's existing view changes; a person toggles them
on, or a Saved View captures the choice once made:

- **Exposure** — computed via the real `exposure(riskLikelihood, riskImpact)`, sorts by the
  numeric score, displays the band (Low/Medium/High/Critical) or an honest "not yet judged" —
  never a default score for an unjudged risk. Blank (not "not yet judged") on a non-Risk row.
- **Decision Outcome** — the raw `decisionOutcome` text, or "not yet decided" on an open
  Decision. Blank on a non-Decision row.

## Testing

One new scenario pinning `buildTree()` and `matchesFilters()` together, not in isolation: a
judged Risk (exposure computed correctly), an unjudged Risk (exposure absent, not defaulted), a
Decision with a recorded outcome, and an ordinary issue in the same fixture. Asserts: `raidOnly`
returns exactly the Risk and Decision rows, never the ordinary issue; each row's `raidKind`,
exposure, and outcome read correctly; the ordinary issue's three new fields are all null.

## What stays untouched

No schema change beyond the read-through (the three fields already exist on `Issue`, nothing
new is stored). No change to `lib/search.ts`, `lib/portfolio.ts`, or the existing `type` filter.
No AI, no natural-language question-answering — that half of the strategy doc's Organizational
Memory framing ("why did we make this decision") stays exactly as blocked as it was; this
builds only the structured, human-browsable half.

## What would send this back

- If `raidKind`, computed once per row in `buildTree`, and `raidKindOf()` called directly ever
  disagree for the same issue — a second, forked reading of the same classification — that's a
  real bug in the pre-computation, not something to route around with a second call site.
- If the two new columns turn out to need to be visible on views OTHER than Tree (Board,
  Calendar) to be genuinely useful, that's a real scope question the design didn't anticipate —
  worth reopening, not silently extending column visibility to screens that weren't asked for.
