---
name: axiomate-screen-builder
description: This skill should be used when building a brand-new screen, view, or major surface in Axiomate TMS (a new workspace view, a new Configuration section, a new standalone route, or a new overlay). It walks through the placement decision and the build-to-gate workflow so a new screen lands consistent with the existing shell instead of as a one-off. Use axiomate-ui-design for styling an existing screen's components — this skill is specifically for NEW screens.
---

# Axiomate Screen Builder

A new screen touches more than its own file — it has to fit the sidebar's grouping logic, pick
the right nav pattern, and pass the same standing gate every other change does. This skill is
the workflow for getting that right the first time.

## Workflow

1. **Placement decision** — read `references/screen-workflow.md` step 1. Is this a workspace
   view, a Configuration section, a standalone route, or an overlay? Get this right before
   writing any component code; retrofitting the wrong choice is expensive.
2. **Reuse the pattern spec** — once placement is decided, `docs/design/navigation-model.md`
   has the exact spec for the nav pattern involved. Don't improvise a variant.
3. **Reuse component patterns** — forms, tables, status indicators, cards: check
   `axiomate-ui-design`'s `component-library.md` before building any of these from scratch.
4. **Build** — following `references/screen-workflow.md` step 2 (the concrete wiring: sidebar
   entry, view-switch case, or Configuration section array entry).
5. **Gate** — `references/screen-workflow.md` step 3: the standing checklist (tsc, scenarios,
   a11y, build) plus the design-system-specific checks (token usage, status color-not-only,
   inventory update).
6. **Inventory** — add the new screen to `docs/design/screen-inventory.md` in the same commit.
   An inventory that drifts from the real app gets trusted anyway, which is worse than no
   inventory — `axiomate-design-audit` checks for this drift specifically.

## When NOT to use this skill

Modifying an existing screen's styling or components → use `axiomate-ui-design` instead.
Reviewing a screen for UX issues → use `axiomate-ux-review`. This skill is for genuinely new
surfaces only.
