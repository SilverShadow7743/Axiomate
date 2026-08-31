---
name: axiomate-ui-design
description: This skill should be used when building, styling, or modifying any Axiomate TMS screen or UI component — new views, forms, tables, cards, status indicators, or CSS changes to app/globals.css. It supplies the project's real design tokens and component specs so new work reuses what already exists instead of drifting from it. Load before writing UI code, not after.
---

# Axiomate UI Design

Axiomate's design system is extracted from the shipped app, not invented — every token and
pattern below is real, in production, as of the clean shell (2026-08-31). This skill exists so
new UI work reuses those tokens and patterns by default, per the product's own stated principle:
**"no screen should invent a new UI pattern unnecessarily."**

## The ten principles (in one line each)

1. Enterprise clarity over visual decoration
2. Data density without cognitive overload
3. Consistent behaviour across all modules
4. Workflow status must always be visually obvious
5. Important actions should require minimal clicks
6. Planning/allocation/timesheet info should be easy to scan
7. Complex functionality should progressively disclose complexity
8. Desktop-first but fully responsive
9. Accessibility built into every component, not bolted on
10. No screen should invent a new UI pattern unnecessarily

Full rationale and real examples for each: `docs/design/ux-principles.md`.

## Before writing any UI code

1. Check `docs/design/screen-inventory.md` — does an existing screen already solve a version of
   this problem? Reuse its pattern.
2. Check `references/design-system.md` (bundled here) for the token to use — never a raw hex,
   px value, or ad hoc color. If the value you need isn't in the table, that's a signal to stop
   and check `docs/design/axiomate-design-system.md` (the fuller doc with rationale) before
   inventing one.
3. Check `references/component-library.md` (bundled here) for the component spec — forms,
   tables, status indicators, cards, dashboard widgets. If you're building one of these five
   things, a spec already exists.
4. For a genuinely new screen (not just a new component), read `references/screen-template.md`
   for the placement decision (which nav pattern, which view type) before writing code.

## Quick token reference

| Category | Where |
|---|---|
| Color (semantic, light+dark) | `references/design-system.md` §Color |
| Typography scale | `references/design-system.md` §Typography |
| Spacing scale | `references/design-system.md` §Spacing |
| Radius/border/shadow | `references/design-system.md` §Radius |
| Z-index ladder | `references/design-system.md` §Z-index (already well-formed — copy its pattern for new layers) |
| Motion/reduced-motion | `references/design-system.md` §Motion — house style is override-to-none |

## Full documents (authoritative source, not duplicated here)

- `docs/design/axiomate-design-system.md` — tokens with full rationale and real value distributions
- `docs/design/ux-principles.md` — the ten principles with examples and anti-patterns
- `docs/design/information-architecture.md` — the sidebar/views/Configuration map
- `docs/design/navigation-model.md` — the four nav pattern specs
- `docs/design/component-standards.md` — forms/tables/status/cards/dashboard specs
- `docs/design/screen-inventory.md` — every screen, flat

## When you're not sure whether something is "new"

If a control looks like it should already exist (a dropdown, a status badge, a card), it
probably does — check `component-library.md` first. If after checking you're building something
genuinely new, that's fine; just document it in `screen-inventory.md` in the same commit, so
the inventory doesn't drift from the real app (an audit skill, `axiomate-design-audit`, checks
for exactly this drift).
