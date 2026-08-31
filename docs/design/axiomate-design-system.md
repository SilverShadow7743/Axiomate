# Axiomate Design System

**Status:** Proposal — extracted from the shipped application, not invented. Every value below
is real, pulled from `app/globals.css` and the component library as of 2026-08-31 (through
commit `adc8645`). Where the current implementation is well-formed, this document names it as
the standard. Where it has drifted, this document proposes the minimal-diff rationalization —
a rename/consolidation pass, not a redesign. See `ux-principles.md` for the ten principles this
system exists to serve, and `component-standards.md` / `navigation-model.md` for the patterns
built on top of these tokens.

## Why semantic-first, no primitive layer

Standard token architecture runs three layers: primitive (`--color-blue-600: #2563EB`) →
semantic (`--color-primary: var(--color-blue-600)`) → component
(`--button-bg: var(--color-primary)`). Axiomate's CSS skips the primitive layer entirely —
`--accent: #b92a2a` is named by *purpose*, not by hue. That is the right call here, not a gap:
a primitive layer earns its cost when multiple brands or themes need to remix one raw palette.
Axiomate is a single-brand product with exactly two themes (light/dark), and every color below
already carries its meaning in its name. **This document keeps that convention** — semantic and
component tokens only, no primitive renaming exercise.

## Color

Every light token has a confirmed, independently-tuned dark counterpart (both the
`prefers-color-scheme: dark` media query and the explicit `data-theme="dark"` override stay in
lockstep) — no cross-theme leakage, no gaps found.

### Surface & text

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--bg` | `#ffffff` | `#14171a` | Page canvas |
| `--surface` | `#f8f8f6` | `#1a1e22` | Panels, bars, the drawer |
| `--surface-2` | `#f0efec` | `#21262b` | Hover fill, selected-nav fill |
| `--surface-3` | `#e6e4e0` | `#2a3037` | Third elevation tier (structural grid rows) |
| `--border` | `#e2dfda` | `#2c333a` | Hairline dividers (the default weight) |
| `--border-strong` | `#c8c3bc` | `#3d454e` | Emphasis borders, control outlines |
| `--text` | `#1a1815` | `#e6eaee` | Primary reading text |
| `--text-muted` | `#64605a` | `#9aa5b1` | Secondary text, captions |
| `--text-faint` | `#948f88` | `#6f7b87` | Tertiary — labels, disabled hints |

Three-tier text and two-tier border are each a complete, closed system — do not introduce a
fourth text weight or third border weight without a documented reason.

### Brand accent — scoped, not general-purpose

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--accent` | `#b92a2a` | `#e05a5a` | The ONE brand color: primary buttons, active nav, the "today" marker |
| `--accent-soft` | `#fbeaea` | `#35201f` | Accent-tinted fill (selected grid rows) |
| `--accent-2` | `#4a3f9e` | `#8b7fe8` | Reserved for exactly one distinction: Calendar vs. My Calendar |
| `--accent-2-soft` | `#ece9fa` | `#241f3d` | `--accent-2`'s fill counterpart |

`--accent-2` is documented in the source as deliberately scoped, not a general "second button
color." **Keep that constraint explicit here** so a future screen doesn't reach for purple as a
generic alternate accent. If a genuinely new distinction needs its own color, that is a design
decision for `axiomate-ui-design`'s reviewer, not a default.

### Status — three separate semantic families

These are NOT interchangeable, even where a value happens to be reused. Full spec with icons/
glyphs is in `component-standards.md`; this table is the color reference only.

**Schedule health** (`--h-*`) — six-value enum, used on Gantt bars, the counts strip, RAID:

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--h-ontrack` | `#157f5c` | `#3fb086` | On track |
| `--h-atrisk` | `#b06a00` | `#d99432` | At risk |
| `--h-overdue` | `#c0392b` | `#e2685a` | Overdue |
| `--h-blocked` | `#6b4ead` | `#9b83d4` | Blocked |
| `--h-complete` | `#5a6b7a` | `#8998a6` | Completed |
| `--h-unsched` | `#98a2ad` | `#6f7b87` | Unscheduled (no due date recorded) |

**Severity** (`--sev-*`) — the grid's severity column. Currently matches health hues by
coincidence rather than declared alias; **formalize the reuse**:

```css
--sev-high: var(--h-overdue);
--sev-medium: var(--h-atrisk);
--sev-low: var(--h-complete);
```

This makes the intentional reuse visible in the token file instead of two colors that happen to
match. It is also a one-line diff with zero visual change.

**Save/sync state** (on `.persist-tag`/`.persist-dot`) — reuses `--h-ontrack` for "saved" (an
intentional economy: the two never appear in the same context, so the shared green never reads
as ambiguous) plus its own `retrying`/`error` states, which map to `--h-atrisk` and
`--h-overdue` respectively. No new tokens needed — this family is fully covered by the health
palette; document it as "borrows from `--h-*`," not as a fourth color family.

### Chart / schedule bars

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--bar-issue` | `#3d6fa8` | (dark variant defined) | Open issue bar |
| `--bar-issue-done` | `#6d8ba8` | (dark variant defined) | Completed issue bar |
| `--bar-group` | `#57636f` | (dark variant defined) | Structural roll-up bar |
| `--bar-activity` | `#4b8fb5` | (dark variant defined) | Lifecycle activity bar |
| `--bar-proposed` | `#9aa7b4` | (dark variant defined) | Dashed, uncommitted SLA suggestion |

Correctly kept separate from `--h-*`: these answer "what kind of bar," health answers "what
condition." Never merge the two families — a bar's kind and its health compose independently
(an activity bar can be at-risk, overdue, or on-track).

### Grid rules

`--grid-line` (`#eceff3` / `#21262b`) and `--grid-line-strong` (`#dde2e8` / `#2c333a`) — kept
distinct from `--border` because the scheduling grid's internal rules read at a different
weight than the app's structural dividers. Keep separate.

## Typography

**Stacks:** `--sans: 'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
Helvetica, Arial, sans-serif` for all UI text; `--mono: 'JetBrains Mono', ui-monospace,
SFMono-Regular, Menlo, Consolas, monospace` for IDs, dates, and tabular numbers (`.mono`,
paired with `font-variant-numeric: tabular-nums`).

**Base:** `13px` / `line-height: 1.45` on `html, body` — smaller than typical web defaults,
correctly so: this is a scheduling grid, not a marketing page (the file's own header comment
says exactly this).

### The real distribution, and why it needs a scale

Font-size values currently in use, by occurrence count: 12px ×77, 11.5px ×43, 12.5px ×37,
10.5px ×37, 11px ×36, 10px ×31, 13px ×22, 15px ×9, 13.5px ×7, 16px ×6, 14px ×5, plus rare
outliers (9, 9.5, 18, 20, 22, 24, 25, 26px). This is not chaos — it is a half-step scale used to
fine-tune density inside a genuinely tight grid — but the half-steps have drifted into
near-duplicates that no longer reliably signal a different *role*. 12px, 12.5px, and 13px are
each used for what reads, in different places, as the same "small body text" job.

### Proposed scale — a consolidation, not a redesign

Every real value maps onto a named step within half a pixel, so applying this is a rename pass
with no visual change — verifiable with `validate-tokens.cjs` before rollout.

| Token | Value | Absorbs | Role |
|---|---|---|---|
| `--text-2xs` | 10px | 9, 9.5, 10 | Micro captions, badges |
| `--text-xs` | 10.5px | 10.5, 11 | Faint labels, uppercase eyebrows |
| `--text-sm` | 12px | 11.5, 12, 12.5 | **Default UI text** — the workhorse, ~half of all sampled sizes |
| `--text-base` | 13px | 13, 13.5 | Body default (matches `html`'s own 13px) |
| `--text-md` | 15px | 14, 15, 16 | Emphasized labels, dialog titles |
| `--text-lg` | 20–26px | rare one-off headings/empty-states | Not tokenized further — too rare to warrant a sub-scale |

### Weight, tracking, and where each belongs

- **400** — body text (the default)
- **500** — medium emphasis: selected menu items, secondary labels
- **600** — active state: `.side-item.active`, `.cfg-rail-item.on`, section headers, primary emphasis
- **700** — rare, reserved for severity/status badges only

Letter-spacing (`0.06–0.09em`) is used consistently and *only* on uppercase section labels and
eyebrows (`.side-title`, `.cfg-rail-group`, `.mywork-tag`) — well-formed, keep exactly as-is.
Do not add tracking to body or button text.

## Spacing

No `--space-*` tokens exist today; padding/gap/margin are literal pixels throughout. The real
distribution (top values by occurrence): 8px ×85, 6px ×69, 10px ×59, 4px ×53, 5px ×37, 12px
×34, 2px ×33, 7px ×26, 3px ×21, 9px ×19, 1px ×19, 16px ×12, 11px ×10, 14px ×9, then larger
one-offs (18, 24, 28, 30, 40, 48, 60px) at container/page level.

This is a de facto 4px-rounded-to-odd rhythm: 5, 7, 9, 11px appear almost as often as their even
neighbors, because odd values get reached for constantly to fine-tune density — exactly the
same drift pattern as the type scale above.

**This is precisely the class of drift that caused two real, shipped bugs today**: `.side-item`
padding (10px) didn't line up with the top bar's 14px inset (fixed in commit `72f5ed7`), and
`.fh-row`'s 5px vertical padding didn't match `.filterbar`'s 7px directly below it (fixed in
the same commit). Both were caught by manual review and fixed by hand-tuning pixel math — a
formal scale prevents the mismatch from being expressible in the first place, because there is
no 5px/7px pair to drift apart.

### Proposed scale

Snaps every real value onto a true 4px/8px system with no visual regression — verify via
`validate-tokens.cjs` before any rollout, one file at a time.

| Token | Value | Absorbs |
|---|---|---|
| `--space-1` | 2px | — |
| `--space-2` | 4px | — |
| `--space-3` | 6px | 5, 7 |
| `--space-4` | 8px | 9 |
| `--space-5` | 10px | 11 |
| `--space-6` | 12px | — |
| `--space-7` | 14px | — |
| `--space-8` | 16px | — |
| `--space-10` | 24px | 18, 20, 28, 30 (container-level) |
| `--space-12` | 32px+ | page-level gaps |

## Radius, borders, shadow

**Radius** in use: 3px ×41, 4px ×23, 2px ×18, 6px ×14, 5px ×8, 8px ×6, 9px ×5, plus rare 1, 7,
10, 11, 14px.

| Token | Value | Absorbs | Role |
|---|---|---|---|
| `--radius-sm` | 2px | — | Chips, small controls |
| `--radius-default` | 4px | 3px (1px nudge, invisible in practice) | Buttons, inputs, sidebar items |
| `--radius-md` | 6px | 5px | Cards, menus, modals-adjacent surfaces |
| `--radius-lg` | 9px | — | Pills, badges |
| `--radius-full` | 9999px | — | Avatar/dot shapes (not yet named in code) |

**Borders** — a clean, already well-formed two-tier system: `--border` (hairline, the large
majority of dividers) and `--border-strong` (emphasis, control outlines, focus). Keep as-is;
this needs a name applied to it, not a redesign.

**Shadow** — a real elevation ladder exists by pattern, without token names yet:

| Tier | Value (light) | Used for |
|---|---|---|
| Small popover | `0 4-6px 16-20px rgba(0,0,0,.16-.18)` | Dropdowns, small popovers |
| Menu/toast | `0 8-12px 26-32px rgba(0,0,0,.16-.22)` | `.menu`, toasts |
| Modal | `0 20px 60px rgba(0,0,0,.32)` | `.modal` |
| Overlay | directional `±14px 0 34-40px` | Drawer, sidebar overlay |

**Selection/focus rings** are a genuinely separate category from elevation — state indication,
not depth — and should be named separately: `--ring-selected` (inset accent border on selected
grid rows) and `--ring-focus` (the 2px accent outline on `:focus-visible`). Do not fold these
into the shadow scale.

## Z-index — already the model to copy

```
--z-drawer: 140  <  --z-dock: 150  <  --z-modal: 200  <  --z-overlay: 300
  <  --z-overlay-stacked: 320  <  --z-lightbox: 360  <  --z-toast: 400
```

Every token carries an inline comment explaining *why* it sits where it does relative to its
neighbors — for example, the drawer sits deliberately below the assistant dock so chat stays
usable beside an open record. **This is the single best-formed token system in the codebase.**
When formalizing every other category above, copy this exact pattern: named tokens plus a
one-line "why this ordering" comment on each. Numeric literals used locally inside individual
components (`z-index: 1` through `10`, `49`, `50`, `60`) are correctly scoped stacking contexts
within one component — they are not competing with the global ladder and should not be folded
into it.

## Motion

**Durations in use:** 0.12s ×8 (hover/background transitions — the default), 0.14–0.16s ×5
(entrance animations — drawer, focus editor), plus a couple of 1–1.1s pulse loops for live
status indicators. Close enough to a two-tier system to formalize directly:

```css
--duration-fast: 0.12s;      /* hover, background-color, interaction feedback */
--duration-entrance: 0.16s;  /* panel/overlay/drawer appearance */
```

Easing: `ease-out` on entrances, `ease-in-out`/`linear` on the pulse loops. Keep as-is.

### The one real inconsistency — pick a house style

Two competing `prefers-reduced-motion` patterns coexist:

- **Gate the declaration** — `.drawer`'s slide-in sits entirely inside
  `@media (prefers-reduced-motion: no-preference)`, so a reduced-motion user never receives the
  `animation` property at all.
- **Override to none** — `.sidebar`, `.persist-tag`, `.focus`, and `.cfg` declare the animation
  unconditionally, then override it to `none` inside a separate
  `@media (prefers-reduced-motion: reduce)` block.

Both are correct outcomes. But maintaining two authoring patterns for the same rule is exactly
how a gap gets introduced and only caught after the fact — `.focus`/`.cfg` were missing their
guard entirely until a UI/UX review found it (fixed in commit `adc8645`).

**Proposed house style: override-to-none.** It is already used 3-to-1 in the file and requires
no restructuring of existing declarations — a new component just adds the override block rather
than needing its animation wrapped. Document this as the standard in `accessibility.md`
(`axiomate-ux-review` skill).

## Naming convention summary

- Semantic tokens are named by **purpose**, never by raw value (`--accent`, not `--red-600`).
- Component-specific needs get their own token only when a semantic token would be misleading —
  otherwise reference the semantic token directly (`background: var(--accent)`, not a new
  `--button-primary-bg` that just re-points to the same value).
- Every color must be defined in **both** the light `:root` block and the dark
  `prefers-color-scheme`/`data-theme="dark"` blocks — never inherited, never assumed.
- Reduced-motion: override-to-none (see Motion, above).
- Status color, once assigned a family (health / severity / save-state), stays in that family —
  never introduce a fourth ad hoc color for "just this one badge."
