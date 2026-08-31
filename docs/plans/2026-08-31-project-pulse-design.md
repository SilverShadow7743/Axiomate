# Project Pulse — a sixth Portfolio concern, not a new construct

**Status: approved 2026-08-31** (three AskUserQuestion decisions, recorded below). Third
concrete step out of the product-vision pitch — but not built as literally pitched. The
pitch's "Project Pulse" (🟢🟡🔴 per-dimension verdicts, an AI summary, a "Why?" drill-down)
turned out, on inspection, to substantially already exist under a different name and a
different — and deliberately opposite — design philosophy.

## What changed the shape of this feature

`lib/portfolio.ts` is not similar to Project Pulse; it is a direct, documented counter-argument
to it. Its own header comment:

> "This module was written a week after `myWork` shipped claiming to have 'no priority score'
> while in fact weighting severity at zero... The lesson taken from that is not 'be careful
> with scores'. It is: name the concerns, count them, and let the reader do the weighing."

Two more findings settled this decisively:

- **`PortfolioPanel.tsx` already has a working AI-narrate button**, wired to `/api/assist`,
  non-functional only because the Anthropic account has zero credits — the same constraint
  blocking six other pitch items. The "AI summary" half of Project Pulse already exists,
  unused, waiting on the same fix.
- **Portfolio already counts concerns per engagement** — `overdue`, `forecast`, `blocked`,
  `unowned`, `stale` — as checkable numbers ("13 blocked, 14 with no owner"), not colors.
- **Budget/commercial data is already deliberately excluded**, with a real, already-documented
  reason: no `sow.view`-shaped read grant exists yet, and inventing one mid-feature is how
  coarse access gets quietly widened. That gap stays open; this feature doesn't touch it.

## The three decisions

1. **Extend Portfolio's counted-concerns model, not build a scored/colored construct.**
   Building the literal pitch would mean deliberately contradicting a principle this codebase
   already learned the hard way, with no new argument for why this case is different.
2. **Budget/commercial data stays out of this pass.** The access-control work it needs
   (a proper `sow.view`-shaped grant, redacted from payload like `rate.view`/`skill.view`
   already are) is real, separate work — not a byproduct of adding one concern.
3. **Approach: a sixth Portfolio concern — `capacity`** — following `concernsFor()`'s existing
   pattern exactly, over `axiomate-capacity-planning`'s real `availabilityFor()` formula.

## The addition

`concernsFor()` gains a sixth block. A new `projectIdsUnder(state, nodeId)` (mirrors the
existing `projectsUnder()`, same subtree-walk shape) finds every project-tier id under the
engagement. Every person holding a live `Allocation` on any of those projects is checked via
the real `availabilityFor()` — the same function already documented in
`axiomate-capacity-planning` — over a fixed near-term window, **today → today+28 days**
(matching the "Week 3" near-term framing the original pitch used, without inventing a new
windowing concept). The concern counts how many come back `overallocated`
(`remainingHours < 0`); its phrase names the worst one, mirroring `forecast`'s own "worst
shortfall" convention: `"${count} over-committed (worst ${name}, by ${hours}h)"`.

**Deliberately checked against the person's TOTAL allocation, not just this engagement's.**
`availabilityFor()` takes the full `state.allocations` array — someone allocated 60% here and
70% elsewhere is over-committed regardless of which engagement asks, and the concern should say
so honestly rather than only counting the slice visible from one line.

## Where it ranks

`CONCERN_ORDER` becomes `['overdue', 'forecast', 'capacity', 'blocked', 'unowned', 'stale']`.
Overdue is a broken commitment; forecast is one specific record trending toward becoming one;
capacity is the same risk read from the people side — less tied to one identifiable record than
forecast, but still forward-looking evidence that work is about to slip — so it sits just after
forecast and before `blocked` (not the team's fault) and `unowned`/`stale` (weaker evidence).
Named explicitly because capacity is a genuinely different *kind* of concern than the other
five: they're about issues (or issue-completion); this one is about people. The ranking states
that difference as a judgment, not hides it — matching the file's own stated principle that the
order itself is the argument.

## What stays untouched

Budget/commercial figures — same exclusion, same reason, already documented. The AI-narrate
button and its `/api/assist` wiring — this pass adds a data source it will already narrate over
for free once credits exist; no narration code changes.

## Testing

One new scenario, pinning the real functions against constructed state: a person allocated
across two projects under the SAME engagement whose combined allocation exceeds their capacity
is counted once, not twice (the distinct-people set, not one row per allocation); a person
allocated but comfortably within capacity doesn't appear; the phrase correctly names the
worst-affected person when more than one is over-committed.

## What would send this back

- If `projectIdsUnder`'s subtree walk turns out to need the SAME double-counting guard
  `portfolio()`'s own header comment describes fixing once already (a project counted under
  both its own name and a parent's), that's a real signal to reuse `hasAncestor`/
  `hasPortfolioAncestor` directly rather than re-deriving the traversal — not a new bug to
  silently work around.
- If the 28-day window turns out to produce noisy, constantly-flickering counts (someone
  crossing the overallocated line every few days as allocations start/end), that's grounds to
  revisit the window length — a config decision, not a reason to abandon the concern.
