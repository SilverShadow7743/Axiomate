# Design System — Quick Reference

Condensed from `docs/design/axiomate-design-system.md` (read that for rationale, real value
distributions, and the case studies behind each proposed consolidation). This file is for
lookup while coding.

## Color

**Surface/text** — `--bg` `--surface` `--surface-2` `--surface-3` (elevation, light→dark);
`--border` (hairline) / `--border-strong` (emphasis); `--text` / `--text-muted` / `--text-faint`
(three-tier hierarchy). Every one has an independently-tuned dark counterpart — never assume
inheritance, always define both.

**Accent** — `--accent` is the ONLY brand color: primary buttons, active nav, the "today"
marker. `--accent-soft` for tinted fills. `--accent-2` is reserved for exactly one distinction
(Calendar vs. My Calendar) — do not reach for it as a generic second color.

**Status — three separate families, never conflate:**
- Schedule health: `--h-ontrack` `--h-atrisk` `--h-overdue` `--h-blocked` `--h-complete`
  `--h-unsched` — pair with a shape/glyph too, never color alone (see the Gantt Legend).
- Severity: `--sev-high` = `var(--h-overdue)`, `--sev-medium` = `var(--h-atrisk)`, `--sev-low` =
  `var(--h-complete)` — an alias, not a new family.
- Save-state: reuses `--h-ontrack`/`--h-atrisk`/`--h-overdue` on `.persist-tag` — no new tokens
  needed.

**Bars/charts** — `--bar-issue` `--bar-issue-done` `--bar-group` `--bar-activity`
`--bar-proposed` — "what kind of bar," kept separate from health ("what condition").

## Typography

Stacks: `--sans` (UI text), `--mono` (IDs/dates/tabular numbers — pair with
`font-variant-numeric: tabular-nums`). Base 13px/1.45 line-height — smaller than typical web
defaults, correct for a dense scheduling tool.

| Token | Value | Role |
|---|---|---|
| `--text-2xs` | 10px | Micro captions, badges |
| `--text-xs` | 10.5px | Faint labels, uppercase eyebrows |
| `--text-sm` | 12px | **Default UI text** |
| `--text-base` | 13px | Body default |
| `--text-md` | 15px | Emphasized labels, dialog titles |

Weight: 400 body · 500 medium emphasis · 600 active state · 700 rare, severity/status badges
only. Uppercase tracking (`0.06–0.09em`) only on section labels/eyebrows, never body/buttons.

## Spacing

| Token | Value |
|---|---|
| `--space-1` | 2px |
| `--space-2` | 4px |
| `--space-3` | 6px |
| `--space-4` | 8px |
| `--space-5` | 10px |
| `--space-6` | 12px |
| `--space-7` | 14px |
| `--space-8` | 16px |
| `--space-10` | 24px |
| `--space-12` | 32px+ |

Two adjacent bands (a chip row and the control row it reveals, a rail and the bar above it)
must share a padding value from this scale — the exact bug class fixed in commits `72f5ed7`/
`adc8645`.

## Radius / border / shadow

`--radius-sm` 2px · `--radius-default` 4px (buttons/inputs/nav items) · `--radius-md` 6px
(cards/menus/modals) · `--radius-lg` 9px (pills/badges). Borders: `--border` (default) /
`--border-strong` (emphasis) — two tiers only. Shadow: small popover → menu/toast → modal →
directional overlay, an ascending ladder — see the full doc for exact values.

## Z-index (already correct — copy this pattern)

`--z-drawer 140 < --z-dock 150 < --z-modal 200 < --z-overlay 300 < --z-overlay-stacked 320 <
--z-lightbox 360 < --z-toast 400`. Every token has a one-line "why this ordering" comment — do
the same for any new layer.

## Motion

`--duration-fast` 0.12s (hover/interaction) · `--duration-entrance` 0.16s (panel/overlay
appearance). **House style for reduced motion: override-to-none** — declare the animation
unconditionally, then null it inside `@media (prefers-reduced-motion: reduce)`. Do not use the
gate-the-declaration alternative for new components; it's a competing pattern that has already
caused one missed-guard bug.
