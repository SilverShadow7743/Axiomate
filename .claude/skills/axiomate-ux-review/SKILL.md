---
name: axiomate-ux-review
description: This skill should be used when reviewing Axiomate TMS UI code for user experience, accessibility, or visual-consistency issues — before a commit, during code review, or when the user asks to check a screen for UX problems. It supplies the project's real checklist (not a generic one) so review finds actual gaps rather than restating the ui-ux-pro-max generic checklist against a codebase it's never seen.
---

# Axiomate UX Review

Review against what this specific app actually promises (`docs/design/ux-principles.md`'s ten
principles), not a generic checklist. Two known real gaps are already tracked — check for
regressions on those specifically, not just new ones.

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

## Known gaps (check these are not regressed, and flag if genuinely unresolved elsewhere)

- Severity color-only, no glyph (unlike schedule-health, which has one) — `docs/design/component-standards.md`
- `.cfg-fld` forms have no required-marker or inline-error convention
- No dedicated `.btn.danger` — destructive actions currently menu-only

## Full documents

- `docs/design/ux-principles.md` — the ten principles with real examples
- `docs/design/component-standards.md` — the "priority fix list" at the bottom
- `docs/design/axiomate-design-system.md` — token rationale, for flagging drift from the scale
