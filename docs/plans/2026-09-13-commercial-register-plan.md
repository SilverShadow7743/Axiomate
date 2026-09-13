# Commercial register — implementation plan

Follows `docs/plans/2026-09-13-commercial-register-design.md`. Same ordering principle as
Resourcing's plan: the one new join proven by a scenario before any component calls it, view
wiring and the panel together after.

## 1. Scenario before any wiring

New scenario in `scripts/scenario-validation.ts`: two project nodes under different parts of
the tree (different parents), both with `sowId` set to the same SOW, each with a distinct
issue beneath it. Asserts the union of `issuesUnder(state, projectId)` across both projects
contains both issues — proving a SOW's true issue set spans projects wherever they sit, not
just the first project found. This is the empirical core `RSC1` gave Resourcing, here for the
SOW-to-projects direction.

**Verified by:** `npm run validate:scenarios` showing the new scenario `PASS`;
`git diff data/validation.json` additive-only.

## 2. View wiring

- `lib/viewChoice.ts`: `WORKSPACE_VIEWS` gains `'commercial'`.
- `components/AppSidebar.tsx`: `GROUPS`' **Records** group gains `'commercial'` (after
  `'people'`); `VIEW_LABEL`/`VIEW_TITLE` gain entries. Never `CLIENT_GROUPS`.
- `components/IssueWorkspace.tsx`: stale-view guard, same shape as `resourcing`'s, gated on
  `rate.view`:
  ```ts
  if (view === 'commercial' && !can(state.model, actor, 'rate.view').allowed) setView('mywork')
  ```
- View-ternary chain gains a `CommercialRegister` branch beside `resourcing`.

**Verified by:** `npx tsc --noEmit` and `npx eslint` on the three touched files, clean.

## 3. `components/CommercialRegister.tsx`

New component, same shell conventions `ResourcingPanel.tsx` established (`.evi.mywork`,
`.evi-head`, quick filter, `.cfg-table`). Sub-tabs (`.subtabs`-equivalent — check
`CommercialPanel.tsx`/existing tab markup for the real class name before inventing one) for
All SOWs / Overdue milestones / Unpaid invoices / At-risk margin. The margin-threshold number
input for the At-risk tab is local component state, no config write.

**Detail likely to be got wrong:** `rate.view` must gate the component's entire render, not
just the cost/margin columns — checked once at the top (`if (!mayViewRate.allowed) return
<the same refusal shape CommercialPanel's own cost block already uses>`), not per-column,
so a reader without the grant never receives SOW value or status either. This is the design's
own named risk, restated here as the specific line not to get backwards.

**Verified by:** `npx tsc --noEmit` and `npx eslint components/CommercialRegister.tsx` clean;
`npm run validate:scenarios` re-run, byte-identical (no new pure logic beyond step 1's); a
manual pass — each sub-tab's row count matches a hand count against the fixture data, the
margin threshold input actually changes which rows the At-risk tab shows.

## Commits

- Step 1 alone — the join and its proof.
- Steps 2 + 3 together — wiring and the component, same reasoning as Resourcing's.

## What would send the design back

- If `rate.view` holders turn out to be a meaningfully different set of people from who
  actually wants this register (e.g. delivery leads who need SOW status but not margin) — the
  single-permission gate would be wrong, and the page would need column-level, not page-level,
  redaction. Not expected; `CommercialPanel` already ties SOW value/status to the same grant.
