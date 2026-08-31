# Accessibility Conventions — Axiomate-Specific

The concrete, already-established conventions in this codebase. Point new work at these rather
than generic WCAG advice — this app already implements most of the hard parts correctly.

## Focus

Single global `:focus-visible` rule — 2px accent outline. Every custom control (`.side-item`,
`.fh-chip`, `.cfg-rail-item`, drawer controls) inherits it by construction. **Never** redefine
focus styling per-component; if a component's focus ring looks wrong, the bug is almost
certainly a `outline: none` or a competing style overriding the global rule, not a missing
per-component style.

## Reduced motion — the house style

**Override-to-none**, not gate-the-declaration. Declare the animation unconditionally on the
base rule, then null it separately:

```css
.my-component {
  animation: my-entrance 0.16s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .my-component {
    animation: none;
  }
}
```

This is the pattern used 3-to-1 across the codebase (`.sidebar`, `.persist-tag`, `.focus`,
`.cfg`). The alternative (wrapping the whole `animation` declaration inside
`@media (prefers-reduced-motion: no-preference)`, as `.drawer` does) is a legitimate but
DIFFERENT pattern — do not introduce a third variant. Missing this guard entirely was a real,
shipped gap on `.focus`/`.cfg` until commit `adc8645` — check for it explicitly on every new
animated mount.

## Touch targets

`min-height: 44px` on every interactive control on a touch-primary surface. Currently this
means `/my-week` specifically — the desktop shell's density is a deliberate exception (Principle
1/2), not an oversight; do not apply 44px targets to the Tree grid or sidebar. If a new
phone-first surface is added, it inherits the 44px rule from day one, not as a follow-up fix.

## Color and status

Never color-only. Pair with shape, glyph, or text — the Gantt `Legend` (schedule health) is the
model; severity is the known gap (color-only, flagged for fix, not yet resolved). Check any new
status indicator against this before it ships, not after.

## ARIA patterns already in use — reuse these, don't reinvent

- **Self-labelling selects** — visible caption disappears once a value is set;
  `aria-label`/`title` on the `<select>` carries the accessible name regardless. Reuse for any
  new self-labelling control.
- **`aria-current="page"`** — on the active sidebar/rail item, backing up the color+weight
  visual cue for assistive tech.
- **`role="dialog" aria-modal="true"`** — on the detail drawer and modals.
- **`role="columnheader"`** — on the primary grid's sortable headers.

## Known open gaps (do not let a new component repeat these)

- Severity status has no non-color signal (§Color and status, above).
- The `/my-week` reject-reason field uses `aria-label` only, no visible `<label>` — acceptable
  there (space-constrained, single field) but shouldn't become the default pattern; prefer a
  visible label when space allows.
