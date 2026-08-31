# Audit Template

Copy this structure for a design-system drift audit. Read-only unless explicitly asked to fix.

## 1. Token usage

- [ ] Grep `app/globals.css` for raw hex values outside the `:root`/dark-mode blocks — anything
  found is either a missed token reference or a genuinely new color that needs one.
- [ ] Grep for px values that don't land on the spacing scale (`--space-1` through `--space-12`
  in `docs/design/axiomate-design-system.md`) — flag near-misses (5px vs 6px) as scale drift,
  not necessarily wrong, but worth naming.
- [ ] Same for radius (`--radius-sm/default/md/lg`) and font-size (`--text-2xs` through
  `--text-md`).

## 2. Two-idiom drift

- [ ] For each pattern family in `docs/design/navigation-model.md` and
  `component-standards.md`, check every instance of that family uses the SAME visual idiom
  (same radius/fill/color-on-active convention). The Configuration-rail-vs-sidebar drift
  (fixed commit `47239f1`) is the reference case: two things doing the same job, styled
  differently, for no functional reason.

## 3. Reduced-motion coverage

- [ ] Grep `animation:`/`transition:` for entrance/mount effects. For each, confirm a
  `prefers-reduced-motion` guard exists, using the override-to-none house style
  (`axiomate-ux-review/references/accessibility.md`).

## 4. Touch-target coverage

- [ ] On any touch-primary surface, confirm every interactive control computes to
  `min-height: 44px` or more. Do NOT flag the desktop shell's grid/sidebar/topbar controls —
  that density is intentional (Principle 1/2).

## 5. Color-not-only

- [ ] Every status indicator (health, severity, save-state, and any new family) pairs color
  with shape/glyph/text. Known unresolved: severity. Check for new instances of the same gap.

## 6. Documentation freshness

- [ ] `docs/design/screen-inventory.md`'s workspace-view table matches `AppSidebar.tsx`'s
  actual `GROUPS`/`VIEW_LABEL` exactly.
- [ ] Its Configuration table matches `ConfigWorkspace.tsx`'s actual section array exactly.
- [ ] Any overlay/route added since the inventory's last edit is present.

## Report format

Findings ranked worst-first, each: file:line, what was found, genuine-defect-or-intentional
call, and (only if asked) a proposed minimal fix. Mirror the tone of this project's prior
audits — concrete, evidence-based, no speculative claims.
