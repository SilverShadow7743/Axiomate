---
name: axiomate-ui-refactor
description: This skill should be used when consolidating design-system drift in Axiomate TMS toward the formal token scales — renaming ad hoc pixel/hex values to tokens, merging near-duplicate spacing or type sizes, or unifying two divergent implementations of the same pattern. Use after axiomate-design-audit has identified what's drifted; this skill covers how to fix it safely.
---

# Axiomate UI Refactor

Consolidating toward the token scales in `docs/design/axiomate-design-system.md` is meant to be
a rename pass with zero visual regression — every real value in the codebase already maps onto
a proposed token within half a pixel. This skill exists so that stays true in practice, not
just in theory.

## Rules, drawn from this project's actual refactor history

1. **Named-selector scoping, never a blanket rewrite.** The calm-pass restyle (commit `c8417fa`)
   touched an explicit, reviewable list of selectors — not every rule that happened to contain
   a color. A diff a reviewer can actually read is the point; a thousand-line CSS rewrite is not
   more thorough, it's less reviewable.

2. **Verify with the design-system skill's `validate-tokens.cjs`** before and after any
   consolidation pass, one file at a time. A 12px→12.5px merge is sub-pixel and should be
   invisible; verify that, don't assume it.

3. **Preserve line endings.** A python/script-driven CSS edit that opens a file without
   `newline=''` on both read and write will silently flip the whole file's line endings
   (CRLF→LF), producing a diff thousands of lines long for a content-identical change. This
   happened once in this project (persistence-proof.ts, commit `d18448d`) and once again
   mid-session during the calm pass (caught and redone before commit). Always read and write
   with explicit newline handling; check `git diff --stat` before committing — if the line
   count looks wildly disproportionate to the actual change, stop and check line endings before
   anything else.

4. **Two adjacent bands sharing an edge must share a padding value from the scale.** This is
   the specific bug class fixed in commits `72f5ed7`/`adc8645` — a chip row and the control row
   it reveals, a rail and the bar above it. When consolidating spacing, check pairs of adjacent
   elements specifically, not just each rule in isolation.

5. **Never touch dark-mode tokens without re-verifying contrast independently.** The light-theme
   calm pass deliberately left the dark theme untouched — confirm any consolidation preserves
   that boundary unless the refactor explicitly targets dark-mode tokens too, in which case
   verify both themes separately, never assume a light-theme fix carries over.

6. **One category per commit.** Spacing, radius, and type-scale consolidations are independent
   changes — don't bundle them into one commit where a regression in one is hard to isolate
   from the others.

## Process

1. Start from an `axiomate-design-audit` finding, not a hunch — know exactly which values are
   drifting and onto which token before touching code.
2. Pick ONE category (spacing, radius, type, color) and ONE bounded set of files.
3. Script the replacement with explicit before/after value pairs (see the pattern used in
   commits `c8417fa`, `72f5ed7`, `adc8645` — python with `newline=''` on read and write,
   asserting each replacement is unique before applying it).
4. Run the full gate (tsc, scenarios, a11y, build) — a token rename should never move any of
   these.
5. `git diff --stat` sanity check — the line count should roughly match the number of rules
   actually touched, not the whole file.
6. Commit with the specific before→after values named in the message, matching this project's
   existing commit-message convention.

Full token target reference: `docs/design/axiomate-design-system.md`.
