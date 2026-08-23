# The accessibility gate — design

**Date:** 2026-08-23 · **Register item:** #10 · **Status:** approved (batch go)

## The gap

Accessibility in this codebase is a habit, not a gate: aria-labels and Escape contracts
appear where somebody thought of them, and nothing catches the place nobody did. The
register item asks for a GATE — a check that fails loudly, sits beside the other audits,
and stops a regression before it ships.

## The design

**A static gate, honestly scoped.** A browser-driven audit (axe over rendered pages) is
the fuller instrument, but it needs a running app and a driver — the same dependency that
keeps checklist browser-halves waiting on a Chrome extension. A static JSX gate runs in
the same breath as `tsc` and the suite, deterministically, on every sweep. The design is
explicit about what that buys and what it does not: it catches structural violations
(interactions without keyboard equivalents, controls without names, misused ARIA); it
cannot judge contrast or focus order. The checklist carries the manual keyboard walk for
what the static gate cannot see.

### 1. The tooling

`eslint` + `eslint-plugin-jsx-a11y` (recommended ruleset) + `@typescript-eslint/parser`,
flat config in `eslint.config.mjs`, scoped to `components/**/*.tsx` and `app/**/*.tsx`.
No style rules, no code-quality rules — this is an accessibility gate, not a linter
adoption; widening it later is a separate decision.

### 2. The gate

`npm run audit:a11y` — exit non-zero on any error — joining the sweep beside
`audit:persistence` and the suite. Every violation the first run finds is either FIXED or
DOWNGRADED WITH A WRITTEN REASON in the config (a comment naming the rule, the surface,
and why the recommended treatment is wrong there) — never silenced bare.

### 3. The fixes

Whatever the first run surfaces, fixed in the same pass — the gate ships green, because a
gate that ships red teaches everybody to ignore it.

## Out of scope, stated

- **Contrast and focus order** — the manual keyboard walk in checklist 31 carries these;
  a browser-driven axe pass is a future instrument.
- **Linting beyond accessibility** — a separate adoption decision.

## What would send this back

- The recommended ruleset proving structurally wrong for this codebase (dozens of
  justified downgrades) — the gate would be theatre, and a browser-driven audit should
  replace it rather than a config full of exceptions.
