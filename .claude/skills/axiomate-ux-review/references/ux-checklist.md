# UX Checklist — Axiomate-Specific

Organized by the ten principles (`docs/design/ux-principles.md`). Each line is a real,
checkable question against THIS codebase — not a generic rule.

## 1. Enterprise clarity over visual decoration
- [ ] No hero image, gradient, or illustrative graphic added where a plain message + action
  would do.
- [ ] Density in Tree/Gantt/grid contexts is not "fixed" toward more whitespace — that's
  intentional, not a defect.

## 2. Data density without cognitive overload
- [ ] Any screen with 3+ optional narrowing controls uses the Filters-chip collapse pattern,
  not always-visible controls.
- [ ] Density is paired with a way to narrow it (filter/sort/group) — dense with no narrowing
  affordance is overload, not density.

## 3. Consistent behaviour across all modules
- [ ] Row/record selection routes through the existing `requestSelect`-equivalent dirty-check
  gate — no new selection path bypasses it.
- [ ] A nav idiom (rail, chip, drawer) is REUSED, not reinvented for one screen — check against
  `docs/design/navigation-model.md`'s four patterns before approving a new one.

## 4. Workflow status must always be visually obvious
- [ ] Every status indicator pairs color with a non-color signal (shape, glyph, text) — the
  Gantt Legend is the standard; severity is the known exception, still color-only.
- [ ] A new status family doesn't silently reuse an existing color's HEX without declaring the
  relationship as an explicit token alias.

## 5. Important actions should require minimal clicks
- [ ] A frequent action (done multiple times/session) has a one-click surface, not
  menu-within-menu.
- [ ] The top bar still has exactly ONE `.btn.primary` — a new primary CTA doesn't create a
  second one.

## 6. Planning/allocation/timesheet info should be easy to scan
- [ ] Any numeric column (hours, IDs, dates in a list) uses `.mono` + tabular-nums, not the
  proportional body font.

## 7. Complex functionality should progressively disclose complexity
- [ ] A form with required vs. optional fields marks the distinction visibly (known gap —
  `.cfg-fld` doesn't yet; don't let a NEW form skip it too).
- [ ] Validation errors, if any, appear inline near the field, not only at submission.

## 8. Desktop-first but fully responsive
- [ ] A dense grid/Gantt screen is not being force-fit to a phone breakpoint — that's the wrong
  fix; a phone-first alternative surface (like `/my-week`) is the right one.
- [ ] Any new full-screen overlay picks ONE collapse strategy deliberately (off-canvas overlay
  vs. horizontal tab strip) based on whether the underlying page needs to stay visible.

## 9. Accessibility built into every component
- [ ] `:focus-visible` is inherited from the global rule, not redefined per-component.
- [ ] Every mount/entrance animation has a `prefers-reduced-motion` guard, using the
  override-to-none house style (see `references/accessibility.md`).
- [ ] Touch targets on any phone-primary surface are `min-height: 44px` (currently only
  `/my-week` — check if a new phone-facing surface is added).
- [ ] Interactive icon-only controls have `aria-label`.

## 10. No screen should invent a new UI pattern unnecessarily
- [ ] Checked `docs/design/screen-inventory.md` and `component-standards.md` for an existing
  pattern before building a new one.
- [ ] If a new pattern was genuinely needed, the reason is documented (not just "looked nicer").
