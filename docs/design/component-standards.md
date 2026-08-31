# Axiomate Component Standards

**Status:** Proposal — form, table, status-indicator, card, and dashboard-widget specs,
extracted from the shipped component library. Tokens referenced here are defined in
`axiomate-design-system.md`.

## Forms

### Self-labelling select — `.field select` (`FilterBar.tsx`)

No separate `<label>` element. The resting `<option value="All">{label}: All</option>` carries
the caption; `aria-label`/`title` on the `<select>` back it for assistive tech. `.on` (accent
border + accent text) marks a set value.

**Documented rationale** (in-code, `FilterBar.tsx`): saves horizontal space across eight facets
at the cost of losing the visible caption once a value is picked — mitigated by a stable
position, the accent color, and the tooltip.

**Reuse rule:** name it `SelfLabellingSelect`. It only works when the control has a **stable
position** in a fixed facet bar. Do not propagate it into free-flowing config forms — those get
the structured pattern below.

### Structured field — `.cfg-fld` (`ConfigWorkspace.tsx`)

Conventional label-above-input: a `<span>` caption (10px uppercase, `--text-faint`) stacked
above a full-width control. `.cfg-fld-row` groups related fields horizontally; `.cfg-fld-wide`
spans the full row. Focus state is `outline: 2px solid var(--accent); outline-offset: -1px`.

**Two real gaps, flag for fix:**
- **No inline required-field marker.** A form with load-bearing fields currently discloses
  nothing about which ones are required until submission — violates Principle 7 (progressive
  disclosure should still tell you what's required).
- **No inline validation-error convention found** in the sampled sections. Define one before
  the next config form ships: error text directly below the field, in `--h-overdue`, matching
  the color already used for refusal/warning states elsewhere.

### Collapsible filter group — `.fh-chip` (`FiltersHeader.tsx`)

"Filters · N" chip toggles the full filter bar in place. N excludes `search` (which lives
globally in the top bar) and counts `showCompleted` as a boolean deviation from rest. **Starts
pre-expanded whenever N > 0** — active filters are never hidden behind a click by default, a
real accessibility and trust win worth calling out as the standard, not an implementation
detail.

**Reuse rule:** any view with more than ~3 optional narrowing controls should collapse behind
this exact chip pattern rather than always-visible controls or a separate settings panel.

### Phone-first form — `.mw-form input/select`, `.mw-btn`, `.mw-reject-input` (`MyWeek.tsx`)

The one true touch surface in the app. `font-size: 16px` (prevents iOS auto-zoom on focus —
comment this explicitly in any new phone-facing input), `min-height: 44px` on every input and
button (the touch-target floor; fixed app-wide on this page in commit `adc8645`).

**A pattern to avoid replicating:** the reject-reason input relies on `aria-label` with no
visible `<label>`. Acceptable here (space-constrained, single field, clear placeholder context)
but should not become the default — prefer a visible label per the checklist in
`accessibility.md`.

### Button hierarchy — shared across every form context

| Class | Height | Use |
|---|---|---|
| `.btn` | 26px | Default secondary action |
| `.btn.primary` | 26px, accent fill | One per view/context — see the top bar's one-primary-action rule |
| `.btn.ghost` | 26px, transparent border | Secondary/toggle actions; `.on` variant marks an active toggle |
| `.btn.danger-solid` | 26px, `--h-overdue` fill | Standalone destructive confirm button — already in use in `Dialogs.tsx` (Archive/Delete confirm), `ConfigWorkspace.tsx` (reset confirm), `NotesTab.tsx` (delete confirm) |
| `.menu-item.danger` | text-only, `color: var(--h-overdue)` | Destructive entries inside a menu (a different context, not a substitute for `.btn.danger-solid`) |

**Correction from this document's first pass:** it originally reported no standalone danger
button existed. That was wrong — it missed `.btn.danger-solid`, already well-formed and used in
three real places. Both classes are correct and should stay; the only loose end is the
`.danger` vs. `.danger-solid` naming difference between the two, not worth a rename given both
are already established and unambiguous in context.

## Tables

### Primary grid — `TreeGrid.tsx`

Custom virtualized-scroll grid, not a native `<table>` — this is the densest, most bespoke
component in the app and should be documented as its own spec, not squeezed into a generic
"Table" pattern.

- **Header:** `role="columnheader"`, click-to-sort with a `▲`/`▼` indicator, drag-to-reorder
  (native HTML5 drag-and-drop), drag-handle column resize.
- **Frozen columns:** `position: sticky` with computed `left` offset; sticky header cell at
  `z-index: 4` (a locally-scoped stacking context — see the Z-index section of
  `axiomate-design-system.md`).
- **Row states:** hover (`background: var(--surface)`), selected (`--accent-soft` fill + inset
  top/bottom border, which correctly extends into the sticky column via
  `.grid-row.selected .sticky-col`), and four **row-kind** background tiers
  (`.kind-company`/`.kind-client` get `--surface-3` + heavier borders; `.kind-engagement`/
  `.kind-project`/`.kind-module` get `--surface`) — independent of selection, and confirmed to
  compose correctly with it (selection wins via specificity).
- **Density:** row height is token-driven (`--row-h`), not the 40/48/56px tiers a generic table
  spec would suggest. This grid is deliberately more compact — do not "fix" it toward a taller
  generic row height.

### Static data tables — `.cfg-table`, `.est-table`

Two lightweight variants for config/read-only contexts, neither with hover or selection states
(correct — neither is interactive):

- **`.cfg-table`** — 11.5px, uppercase 10px headers, bottom-border-only rows, no header
  background.
- **`.est-table`** — 12px, bolder header, no borders at all — closer to a definition list than
  a data table.

**Reuse rule:** use `.cfg-table`/`.est-table` for any read-only reference table. Reach for
`TreeGrid`'s patterns ONLY when the data is genuinely interactive (sortable, resizable,
selectable) — most config/reference tables are not, and don't need that weight.

## Status indicators — three separate systems, never conflate

### 1. Schedule health

`--h-ontrack/-atrisk/-overdue/-blocked/-complete/-unsched`. Used on Gantt bars, the counts
strip, RAID items.

**The Gantt's `Legend` component (`FilterBar.tsx`) is a self-documenting spec already in the
codebase — lift it directly rather than re-deriving:**

Bar *shapes* carry record-kind: `.lg-summary` (roll-up), `.lg-issue` (primary, taller/
saturated), `.lg-activity` (lifecycle, shorter/lighter), `.lg-milestone`, `.lg-proposed`
(dashed, uncommitted). Crossed with health *color* (six values above) plus glyph markers —
`!` overdue, `⌧` blocked, `✓` completed. **Color is never the sole signal** in this family;
shape and glyph both carry information independently. This is the model to copy for every other
status family that's currently color-only.

### 2. Severity

`--sev-high/-medium/-low` (aliased to health tokens, per `axiomate-design-system.md`). Currently
**text-color-only** on the grid's severity column — no icon/glyph pairing.

**Real gap, flag for fix:** give severity the same treatment schedule-health already has — a
small glyph or shape distinct from color, so it isn't a color-vision-dependent read. This is
the single most concrete, highest-value fix this document surfaces.

### 3. Save/sync state

`.persist-tag` + `.persist-dot`. Four states: `saved`/`local`/`idle` (green, reuses
`--h-ontrack` — intentional economy, the two never appear in the same context), `saving`/
`retrying` (animated pulse, `prefers-reduced-motion`-guarded), `error` (`--h-overdue`).

### Related micro-systems — fold in, don't add a fourth family

- **`.mywork-tag`** — six reason-codes (decide/overdue/blocked/attest/due/open), each its own
  color; `decide` uses `--accent` itself (it's "someone else waiting," the one case that earns
  the brand color outside primary buttons/active-nav). Document as a My-work-scoped extension
  of the severity/health families, not a fourth independent system.
- **`.cfg-chip`** — linked-record reference chips, bordered in `--h-ontrack` (reuses the
  "healthy/linked" green). Not a new color meaning.

## Cards

| Class | Radius | Border | Shadow | Structure |
|---|---|---|---|---|
| `.cfg-card` | `--radius-md` (6px) | `--border` | none | Header (`.cfg-card-head`) + body; actions live inline, no separate footer |
| `.fr-card` (first-run) | same family | `--border` + `border-left: 3px solid var(--accent)` attention rule | none | Centered, `max-width: 720px` — a deliberate single-instance callout, not a repeatable card variant |
| `.modal` | `--radius-md`+ (8px, one step up — modals read as more elevated) | `--border-strong` | `0 20px 60px rgba(0,0,0,.32)` | `.modal-head` / `.modal-body` / `.modal-actions` (right-aligned) — the closest match to a canonical header/content/footer card anatomy |

**Reuse rule:** `.modal` anchors the canonical "Card" spec (it has the full header/body/footer
structure). `.cfg-card` is its flatter, borderless-shadow "inline card" variant for
non-modal surfaces. `.fr-card`'s attention-border treatment is reserved for genuinely
single-instance callouts — don't reuse it as a generic "important card" style.

## Dashboard / summary widgets

Axiomate deliberately does **not** use boxed KPI tiles — every summary widget in the app is
inline or list-grouped, consistent with Principle 1 (clarity over decoration). Don't propose
converting these to card-based stat tiles; that would add visual weight without adding
information.

- **Counts strip** (`.counts`, `FilterBar.tsx`) — inline stat row: bold number + muted label,
  five counters (shown/total, overdue, at-risk, blocked, done, unscheduled), each colored via
  its matching `.hl-*` class. The app's only "KPI tile" equivalent, and it's a row, not a grid
  of boxes.
- **My work grouping** (`.mywork-group`/`.mywork-head`/`.mywork-title`) — a sectioned list
  grouped by the six `.mywork-tag` reason-codes, each section's count shown inline via
  `justify-content: space-between` on the header, not a separate badge.
- **Portfolio** — same docked-panel convention as My work; no distinct widget system beyond
  what's covered above.

## Priority fix list (from this extraction)

1. ~~**Severity color-not-only**~~ — fixed 2026-08-31: `lib/severity.ts`'s `severityGlyph()`
   adds a shape (▲/●/–) alongside color everywhere severity renders (`TreeGrid.tsx`,
   `OverviewTab.tsx`), matching schedule-health's discipline.
2. ~~**`.cfg-fld` required-marker + inline-error convention**~~ — fixed 2026-08-31:
   `.cfg-fld.required` (paired with the input's native `required` attribute) and
   `.cfg-fld-error` are defined in `app/globals.css` and applied to the holidays "Add" form in
   `ConfigWorkspace.tsx` as the first real usage.
3. ~~**Danger button variant**~~ — not actually a gap. `.btn.danger-solid` already existed and
   is in real use (see the button-hierarchy table above); this document's first pass missed it.
