---
name: axiomate-refactoring
description: This skill should be used when refactoring Axiomate TMS code without changing intended behavior — reducing duplication, complexity, or coupling. It generalizes axiomate-ui-refactor's already-established CSS-consolidation safety rules (named-selector scoping, the CRLF trap, dark-mode verification) to application code, citing this session's own real refactors as worked examples. Use axiomate-ui-refactor specifically for CSS/token consolidation; use this for everything else.
---

# Axiomate Refactoring

The safety discipline here is proven, not theoretical — every rule below either prevented a
real mistake this session or is generalized from one that happened and was caught.

## Rules, generalized from `axiomate-ui-refactor` and this session's own history

1. **Named-selector / named-symbol scoping, never a blanket rewrite.** The CSS calm pass
   (commit `c8417fa`) touched an explicit, reviewable list of selectors, not every rule
   matching a pattern. The same discipline applies to code: a refactor names the exact
   functions/files it touches in its description, and the diff should match that list — a
   diff far larger than the stated scope is a signal to stop and check what actually changed.
2. **Verify before and after, one unit at a time.** `lib/severity.ts`'s extraction (commit
   `66d4051`) pulled one small, shared mapping out of two call sites (`TreeGrid.tsx`,
   `OverviewTab.tsx`) specifically so the mapping couldn't drift between them — a worked
   example of the right SIZE for a single refactor: one concept, wherever it was duplicated,
   in one commit, gated before and after.
3. **Preserve line endings on any script-driven edit.** A python (or similar) script that opens
   a file without explicit `newline=''` handling on BOTH read and write silently flips CRLF to
   LF, producing a diff thousands of lines long for a content-identical change. Happened twice
   in this project's history (`persistence-proof.ts` in commit `d18448d`, and once more caught
   mid-session during the CSS calm pass before it was committed). Always check `git diff
   --stat` before committing a refactor — if the line count is wildly disproportionate to the
   actual change, stop and check line endings before anything else.
4. **Never touch dark-mode/theme-adjacent values without re-verifying independently.** The
   light-theme calm pass deliberately left the dark theme untouched; a refactor that touches a
   value defined per-theme must verify both, never assume one theme's fix carries to the other.
5. **One category per commit.** Spacing, radius, naming, and structural changes are independent
   — bundling them makes a regression in one hard to isolate from the others (the same
   discipline `axiomate-code-review` expects of any commit's scope).
6. **A false "gap" is worth correcting publicly, not just quietly not-fixing.** The
   `.btn.danger-solid` case (commit `66d4051`): the design-system extraction claimed no danger
   button existed; it did, in three real places. Rather than building a redundant class, the
   docs that had it wrong were corrected in the same commit. Refactoring toward a "missing"
   pattern should always re-check that the pattern is actually missing first.

## Process

1. Identify duplication/complexity/coupling with a specific citation (file:line, or the
   repeated pattern across named call sites) — not a general "this could be cleaner."
2. Scope the refactor to ONE thing, sized like `lib/severity.ts`'s extraction — a single shared
   concept, wherever it's duplicated, not a sweep across unrelated code that happens to also
   look messy.
3. Run the full gate before and after (`axiomate-code-review`'s standing checklist) — a
   refactor that changes a gate result (a scenario verdict moves, a11y count changes) was not
   behavior-preserving, whatever its intent.
4. `git diff --stat` sanity check before committing (rule 3, above).
5. Commit with the specific before→after named, matching this project's own commit-message
   convention — cite what moved and why, not just "refactor."
