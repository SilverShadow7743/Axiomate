# The F&O page grammar — implementation plan

Follows `docs/plans/2026-09-10-fno-page-grammar-design.md` (approved 10 Sep — page grammar not
skin; dashboards decision reopened; a health score admitted on the condition that its weights
are configured and printed). Ordering: the health score is pure logic and the only genuinely new
computation, so it goes first and is proven by scenario before any tile shows it; then the
details drawer, which is the highest-traffic surface and the highest regression risk; then the
one new element (FactBox blade); then the list-page discipline, which is many small edits; then
the two workspaces and the Configuration section; docs last, because the inventory can only be
refreshed truthfully once the shell has changed.

## Steps

**1. The health score — `lib/config.ts`, `lib/workspace.ts`, `lib/portfolio.ts`.**

- `lib/config.ts`: a `HealthScorePolicy` interface — `weights: Record<ConcernKind, number>`
  (import `ConcernKind` from `./portfolio`, or move `CONCERN_ORDER` into config to avoid the
  cycle; check which direction `lib/portfolio.ts` already imports from `./config` — it does, so
  the constant moves to config and portfolio re-exports it) and `thresholds: { amber: number;
  red: number }`. `OperatingModel.healthScore: HealthScorePolicy` beside `sla` (`lib/config.ts:942`);
  `DEFAULT_HEALTH_SCORE` seeded where `DEFAULT_SLA` is (`:1422`). Default weights follow
  `CONCERN_ORDER`'s own argument ("the order is the argument" — overdue heaviest, stale lightest):
  overdue 3, forecast 2, capacity 2, blocked 2, unowned 1, stale 1; thresholds amber 4, red 10.
  These are defaults to be argued with in Configuration, which is the point.
- `lib/workspace.ts`: a `setHealthScore` `ConfigOp` (`{ k: 'setHealthScore'; patch:
  Partial<HealthScorePolicy> }`), structural copy of `setSla` (`:1544` type, `:8202` reducer):
  every weight a finite number ≥ 0, `red > amber ≥ 0`, an `unchanged` early return, an audit
  entry `rowId: 'HEALTH'`. **Existing workspaces predate the field** — the same lesson I19's
  live-verify found with `signatureTemplate`: read it as `state.model.healthScore ??
  DEFAULT_HEALTH_SCORE` at every consumer rather than assuming the seed reached a stored
  model.
- `lib/portfolio.ts`: `healthScore(line: PortfolioLine, policy: HealthScorePolicy, exclude?:
  ConcernKind[]): HealthScore` where `HealthScore = { value: number; band: 'green' | 'amber' |
  'red'; terms: { kind: ConcernKind; count: number; weight: number }[]; excluded: ConcernKind[] }`
  — `terms` is what every rendering prints ("Overdue 3 × 2 + …"), `excluded` is what the
  client-pack disclosure names. Pure; reads only the line's existing `concerns`.
- **Rewrite the header comment** (`lib/portfolio.ts:13-46`): keep the refusal and its reason
  verbatim, then record the 10 Sep reversal, why (client packs), and the four conditions the
  design sets. `PortfolioPanel.tsx:20-24` and `MyWorkPanel.tsx:25-29` restate the refusal —
  update both so no comment in the codebase still says "there will not be one."

**Verify:** `npx tsc --noEmit`.

**2. The client-pack score — `lib/reports/clientPack.ts`.**

Add `health?: HealthScore` to `WeeklyClientPack` and `MonthlyGovernancePack` (`:112`, `:125`),
computed **inside the builders after `clientView()` has been applied** — from a `portfolio()` run
over the boundary-applied state, with `exclude: ['capacity']` (allocations and project
membership are withheld by `clientView`, so the concern cannot be computed honestly for a
client). The pack's existing `disclosure` line gains the `excluded` list so the printed score
says what it is not counting. Money is not a concern kind, so nothing new is withheld.

**Verify:** `npx tsc --noEmit`.

**3. Scenarios — `scripts/scenario-validation.ts`.**

- **`PF3`** (after `PF1`/`PF2`, `:5664`–): `healthScore` sums `count × weight` per concern, bands
  at the thresholds (inclusive on `amber`, exclusive below), `terms` lists every non-zero
  concern with its weight, a zero-concern line scores 0/green with empty terms; `setHealthScore`
  refuses a negative weight and `red ≤ amber`, applies a partial patch, and returns unchanged
  for a no-op — the `setSla` scenario's own shape.
- **`CP3`** (after `CP2`, `:6165`): the weekly pack's `health.excluded` is exactly
  `['capacity']`; an engagement whose only concern is capacity scores 0 in the pack and non-zero
  internally — **the design's own send-back clause, pinned as a number so it is seen rather than
  inferred**; a client-invisible overdue issue does not move the pack score (the boundary holds
  under the score as it does under counts).

**Verify:** `npx tsx scripts/scenario-validation.ts` — `PF3 PASS`, `CP3 PASS`, count +2, no
regressions.

**4. The details drawer becomes a details page — `components/DetailPanel.tsx`,
`components/DetailDrawer.tsx`, `app/globals.css`.**

- **FastTabs.** `TABS` (`DetailPanel.tsx:375-379`) stays the single source of order — the two
  effects that depend on it (`:400-408` landing on a tab the row has; `:417-419` honouring
  `requestTab`) are load-bearing and their comments say why. The tab bar (`:537-541`,
  `tabs={TABS}`) is replaced by a stacked list of `<details>`-style FastTab sections in `TABS`
  order, each header carrying a summary (open checklist count, latest note date, logged hours,
  planned end — one or two per section, read from data the section already has). `tab` state
  becomes "which sections are open"; `requestTab` opens *and scrolls to* its section, which is
  the "opens a collapsed pane" behaviour `:413-415` says must not be lost. The first section
  open by default and sized to fit a 720px drawer without scrolling — the design's send-back
  clause; if Overview does not fit, cut summary fields, do not scroll.
- **Page title area.** `<h2 className="dt-name">` (`:526`) becomes `<ID> : <Subject>`; the
  record's status pinned upper-right of the header as a chip; both read from `row`, nothing
  new computed.
- **Record action pane.** A row beneath the title gathering whole-record actions already
  dispatched from inside the panels (status transition, assign/owner, escalate/severity, archive,
  convert-to-personal from the mail-triage plan when it lands). Grep each existing action's
  current button and move it, do not duplicate it — F&O's "no duplicate New/Delete" rule. One
  `.btn.primary` (the most likely next status transition from `lib/statusPolicy.ts`); the rest
  `.btn`. Part-level actions (add note, upload evidence, add checklist item) stay in their
  FastTab as local toolbars.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/DetailPanel.tsx
components/DetailDrawer.tsx`, and `npm run audit:a11y` (the FastTab headers are new
interactive elements; the gate must stay clean).

**5. The FactBox blade — `components/FactBoxBlade.tsx` (new), wired into `DetailDrawer` and the
list views.**

A right-edge, collapsed-by-default "Related information" tab; opened, a column of FactBoxes for
the selected row: *Owner* card (`directoryPersonFor` + `ownerLeaveCaveat` — I14's function),
*Schedule* card (planned/actual/SLA target from the row), *Related records* grid
(`state.relationships` + `state.dependencies` for the row, five rows, "More" opens Links),
*Recent activity* grid (`state.notes` for the row, five newest). **Every FactBox renders an
existing pure function's output** — the design's constraint, checked at review: no `useMemo`
in this file may compute a figure that does not already exist in `lib/`. Stacks at `--z-drawer`
beside the drawer, below `--z-dock`; closing routes through nothing — it holds no edits, so it
needs no `requestSelect` gate.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/FactBoxBlade.tsx`,
`npm run audit:a11y`.

**6. List-page discipline — `components/FilterBar.tsx`, `TreeGrid.tsx`, `BoardView.tsx`,
`PeopleDirectory.tsx`, the Applications view, `TimesheetPanel.tsx`.**

- A **quick filter** input directly above each grid, bound to the view's most-narrowed field
  (subject / name / application name), autofocused on view open. For Tree/Board it narrows the
  same `filters.search` the top bar's global search feeds — one state, two inputs, so they never
  disagree; for People/Applications it is the local filter those views already have, moved and
  focused.
- **First textual column as the link** on every grid that pairs with the drawer — audit each
  grid's first `<td>` and route it through `requestSelect`, the same gate every selection path
  already uses (`ux-principles.md` #3).
- **Plural page titles** via the terminology layer (`lib/config.ts` terminology overrides) —
  never a hardcoded "Issues".

**Verify:** `npx tsc --noEmit`, `npm run build`, eslint on the touched files, `npm run
audit:a11y`.

**7. Workspaces — `components/MyWorkPanel.tsx`, `components/PortfolioPanel.tsx`, and a
*Health score* Configuration section in `components/ConfigWorkspace.tsx`.**

- **Home (My work) as an operational workspace:** a *Summary* tile row above the existing ranked
  list — each tile a count already computed (`FilterBar.tsx`'s counts interface `:193-199`:
  total, overdue, blocked, unscheduled; plus `myWork`'s per-reason group sizes), each tile
  setting the matching filter and switching to Tree (the F&O tile = a count with a query). The
  ranked list becomes the *tabbed list* section. Nothing new is counted.
- **Portfolio as a workspace:** one tile per `PortfolioLine` showing `healthScore(...)` — the
  band as colour **and** the value, and the `terms` printed beneath on hover/expand, never the
  number alone. The concern lines stay beneath as the tabbed-list section; the tile is a summary
  of them, not a replacement.
- **Configuration → Health score:** a new section in the *Governance* group beside *Goals*
  (`screen-inventory.md` "Governance"), structural copy of the *Service levels* section: one
  numeric input per concern kind, two for the thresholds, `onBlur` → `onConfig({ k:
  'setHealthScore', patch })`, refusals shown the way *Service levels* shows them. A one-line
  note beneath: these weights are printed beside every score, which is why they are here and
  not in code.
- **Packs:** `ClientPackView` renders `pack.health` when present — value, band, the terms, and
  the disclosure's `excluded` list in words ("capacity not counted — staffing is not shown to
  clients").

**Verify:** `npx tsc --noEmit`, `npm run build`, eslint on the touched files,
`npm run audit:a11y`.

**8. Docs refresh — `docs/design/screen-inventory.md`, `information-architecture.md`,
`navigation-model.md`, `docs/plans/2026-09-07-dashboards-design.md`.**

- `screen-inventory.md` and `information-architecture.md`: from nine views to twelve (Analytics,
  Applications, People), the FactBox blade as a fifth overlay pattern, the workspace pattern on
  My work and Portfolio, the Health score section — and a new "as of" commit stamp. The
  inventory's own coverage note says a drifted inventory "gets trusted anyway"; this step is what
  it asks for.
- `navigation-model.md`: a fifth pattern, *FactBox blade*, and a decision-table row for it; the
  drawer's entry updated for FastTabs and the record action pane.
- `2026-09-07-dashboards-design.md`: a dated status line at the top — reopened 10 Sep by the
  F&O design, with a pointer — so a reader of the old doc is not misled by its refusal.

**Verify:** none mechanical — read each against the running app after step 7.

**9. Live verification (last).**

Against production: open an issue — the drawer shows `ID : Subject`, status upper-right, one
primary action, FastTabs with Overview open and fitting without scroll; open the Related
information blade — four FactBoxes, every figure matching what the tabs beneath show; Tree's
quick filter has focus on view open and narrows the same as the global search; My work shows
tiles whose numbers equal the counts strip and whose clicks land on the matching filtered Tree;
Portfolio shows a score per engagement with its terms readable; Configuration → Health score
accepts a weight change and the Portfolio tile moves accordingly (then restore the default);
build a weekly client pack and confirm the score prints with "capacity not counted" — and that
the same engagement's internal score differs only by the capacity term, nothing else.

## Commits

**Commit 1 — steps 1–3.** Score logic, config op, pack score, both scenarios, the three header
comments corrected. Pure; provable; ships nothing visible.

**Commit 2 — step 4.** The drawer. **The step carrying the most regression risk in this plan**,
for a reason its own comments state: `DetailPanel`'s tab landing (`:400-408`) and `requestTab`
(`:417-419`) effects exist because of two real past bugs ("an activity showed eleven tabs and
bounced off eight of them"; "Log time on a workspace with the details hidden would switch to a
tab nobody can see"). Rebuilding the tab bar as FastTabs touches exactly those paths, and the
drawer is opened on every row selection in Tree, Board and Calendar. The concrete guard:
`requestTab` must still open *and reveal* its section from a collapsed drawer, checked by hand
on Log time from My week before this commit lands.

**Commit 3 — step 5.** The blade, alone — the only genuinely new element, so it stands alone.

**Commit 4 — step 6.** List-page discipline across the grids, together — the quick-filter/first-
column/plural-title trio is one idiom and half of it shipped would read as inconsistency.

**Commit 5 — step 7.** Both workspaces, the Configuration section, the pack rendering — together
because a score with no way to set its weights, or weights with nowhere to show, is the hidden
sentence the design forbids.

**Commit 6 — step 8.** Docs.

## What would send this back to the design

- **If Overview cannot fit a 720px drawer without scrolling** once it is a FastTab with a summary
  header — surfaces at step 4. The design's answer is fewer summary fields; if even the body
  cannot fit, the drawer width or the Overview content is the design question, not the FastTab.
- **If a FactBox needs a number no `lib/` function provides** — surfaces at step 5. Build the
  function under its module's doctrine first; the blade never computes.
- **If the pack score and the internal score for one engagement differ by more than the
  capacity term** — `CP3` is written to pin exactly this; if it fails for any other reason, the
  boundary is leaking into the score and that is a disclosure question for the design.
- **If a second `.btn.primary` is needed on the record action pane for some row kind** —
  surfaces at step 4; means the status-transition model has two "most likely next" moves, which
  is a `lib/statusPolicy.ts` question.
