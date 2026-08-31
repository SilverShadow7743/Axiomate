---
name: axiomate-ux-review
description: This skill should be used when reviewing Axiomate TMS UI code for user experience, accessibility, or visual-consistency issues — before a commit, during code review, or when the user asks to check a screen for UX problems. It supplies the project's real checklist (not a generic one) so review finds actual gaps rather than restating the ui-ux-pro-max generic checklist against a codebase it's never seen.
---

# Axiomate UX Review

Review against what this specific app actually promises (`docs/design/ux-principles.md`'s ten
principles), not a generic checklist. Two real gaps were tracked from the first extraction and
fixed 2026-08-31 (severity's color-not-only signal, `.cfg-fld`'s required/error convention) —
check regressions on those specifically, not just new ones.

## Process

1. Read `references/ux-checklist.md` — the project-specific checklist, organized by the ten
   principles, with the known gaps and their fix status.
2. Read `references/accessibility.md` — the concrete conventions (focus rings, reduced-motion
   house style, touch targets, aria patterns) already established in this codebase.
3. Apply both against the code under review. Cite real file:line, not generic advice.
4. Distinguish density (intentional, per Principle 1/2 — do not flag) from genuine gaps
   (color-only status, missing reduced-motion guard, sub-44px touch target on a phone surface,
   missing focus-visible coverage).
5. Report findings ranked by real impact — a workflow-status color-only gap on the primary grid
   outranks a padding mismatch nobody will notice.

## Fixed gaps (check these are not regressed)

- Severity color-not-only — `lib/severity.ts`'s `severityGlyph()` now pairs a shape with color
  everywhere severity renders. If a NEW severity render site skips it, that's a regression.
- `.cfg-fld` required-marker/inline-error — `.cfg-fld.required` + `.cfg-fld-error` exist; a new
  required config field that doesn't use them is a regression, not a fresh finding.
- `.btn.danger-solid` was never actually missing — the first extraction pass mistakenly
  reported it as a gap. Don't re-flag it; do flag a NEW destructive button that reinvents its
  own inline styling instead of using the existing class.

## Full documents

- `docs/design/ux-principles.md` — the ten principles with real examples
- `docs/design/component-standards.md` — the "priority fix list" at the bottom
- `docs/design/axiomate-design-system.md` — token rationale, for flagging drift from the scale
