# Component Library — Quick Reference

Condensed from `docs/design/component-standards.md` (read that for full rationale, real class
names and file references).

## Forms

- **Self-labelling select** (`.field select`) — for a control in a STABLE-position facet bar
  only. No `<label>`; the resting option carries the caption, `aria-label` backs it.
- **Structured field** (`.cfg-fld`) — label-above-input, for everything else. Required fields
  get `className="cfg-fld required"` (pairs with the input's native `required` attribute — the
  visible `*` marker plus the accessible semantics the attribute already carries) and, on
  validation failure, a `.cfg-fld-error` block directly under the control. First real usage:
  the holidays "Add" form in `ConfigWorkspace.tsx`.
- **Collapsible filter group** (`.fh-chip` / `FiltersHeader`) — for 3+ optional narrowing
  controls on any view. Starts expanded whenever something is active — never hide an active
  filter behind a collapsed chip by default.
- **Phone-first inputs** — `min-height: 44px`, `font-size: 16px` on any control on a
  touch-primary surface (currently only `/my-week`). Prefer a visible `<label>` over
  `aria-label`-only where space allows.
- **Buttons** — `.btn` (default) → `.btn.primary` (ONE per view) → `.btn.ghost` (secondary/
  toggle, `.on` for active toggles) → `.btn.danger-solid` (standalone destructive confirm — see
  `Dialogs.tsx`'s `Actions` component) → `.menu-item.danger` (destructive entries inside a
  menu, a different context from a standalone button).

## Tables

- **Primary grid** (`TreeGrid`) — for genuinely interactive data: sortable, resizable,
  selectable, frozen columns. Row states: hover, selected (accent-soft + inset border,
  including sticky columns), plus four independent row-kind background tiers. Row height is
  token-driven and deliberately compact — don't "fix" it taller.
- **Static tables** (`.cfg-table`, `.est-table`) — for read-only reference data. No hover/
  selection states (correct — they're not interactive). Use these for any new config/reference
  table; reach for `TreeGrid`'s weight only when the data is genuinely interactive.

## Status indicators — three families, keep them separate

1. **Schedule health** — color + shape/glyph together (see the Gantt `Legend` in
   `FilterBar.tsx` for the exact spec: bar shape = record kind, color = health, glyph = extra
   emphasis on overdue/blocked/complete). This is the model — color is never the only signal.
2. **Severity** — pairs `sev-High/-Medium/-Low` color with a shape glyph
   (`lib/severity.ts`'s `severityGlyph()`: ▲/●/–), matching schedule health's discipline. Use
   this helper for any new severity render site rather than a bare colored label.
3. **Save/sync state** (`.persist-tag`) — reuses the health palette; not a new family.

Related micro-systems that extend these (don't add a fourth family): `.mywork-tag` (My-work
reason codes), `.cfg-chip` (linked-record references, reuses the "healthy" green).

## Cards

`.modal` (header/body/footer, most elevated, `--radius-md`+) anchors the canonical card
anatomy. `.cfg-card` is its flatter inline variant (no shadow). `.fr-card`'s accent-left-border
attention treatment is reserved for genuinely single-instance callouts — don't reuse it as a
general "important card" style.

## Dashboard / summary widgets

No boxed KPI tiles anywhere in the app — every summary is inline (`.counts` strip) or
list-grouped (My work's `.mywork-group`). Keep new summary widgets inline/list-shaped;
converting to card-grid stat tiles adds visual weight without adding information (Principle 1).
