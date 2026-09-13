# Client Milestones view — implementation plan

Follows `docs/plans/2026-09-13-client-milestones-design.md`. Different ordering emphasis
from Resourcing's and Commercial's plans: the riskiest step here is not a join, it is a
disclosure boundary, so the proof comes before the type change is even usable and is
re-run, unchanged, after every later step touches anything nearby.

## 1. `ClientMilestoneLine` and `clientMilestones`, proven by a disclosure scenario

- `lib/clientBoundary.ts`: add `export interface ClientMilestoneLine` (the eight fields the
  design names: `id`, `sowReference`, `name`, `sequence`, `plannedDate`, `delivery`,
  `deliveredAt`, `acceptance`, `acceptedAt`) and populate a local `clientMilestones` inside
  `clientView()`, reusing the function's own existing `underScope` closure — no new helper,
  no import from `lib/reports/clientPack.ts` (that module depends on this one; the reverse
  would be circular). Filter: `!m.deletedAt`, `state.sows[m.sowId]` exists, and
  `underScope(sow.engagementId)`. Returned only when `clientScopeId` is truthy, `{}`
  otherwise — the same shape the function's own `issues` line already has one line above.
- `lib/workspace.ts`: add `clientMilestones: Record<string, ClientMilestoneLine>` to the
  `WorkspaceState` interface (~line 443, beside `milestones`) and `clientMilestones: {}` to
  the one seed constructor (~line 778, beside `milestones: {}`). Nowhere else constructs a
  full `WorkspaceState` literal — confirmed by grep for `milestones:\s*\{\}` before writing
  this plan, one interface site and one seed site.
- `scripts/scenario-validation.ts`: new scenario (`CMS1`), built on the sentinel-payload
  pattern already at ~2195 (proving the same class of claim for `milestonesOf()`). Two SOWs
  under two different clients' engagements, a milestone on each — the test client's own
  milestone carrying real dates, the other client's carrying a name sentinel; a third
  milestone under the test client's own SOW but soft-deleted, carrying its own sentinel; all
  three milestones carrying a `COST_SENTINEL`-shaped `amount`/`percentage`/`currency`. Assert
  against `clientView(st, testClientScopeId).clientMilestones`:
  - exactly one entry, matching the test client's own live milestone's id;
  - its `sowReference`/`name`/`sequence`/`plannedDate`/`delivery`/`deliveredAt`/`acceptance`/
    `acceptedAt` equal the source record's;
  - `JSON.stringify(view.clientMilestones)` contains neither the other client's milestone
    name sentinel nor the soft-deleted one's, and does not contain `COST_SENTINEL` (proving
    `amount`/`percentage`/`currency` never rode along, the same falsifiable-value technique
    `COST_SENTINEL` already uses at ~2195, not just "the field isn't in the type");
  - `clientView(st, null).clientMilestones` is `{}`.

**Verified by:** `npx tsc --noEmit`; `npm run validate:scenarios` showing `CMS1` `PASS`;
`git diff data/validation.json` additive-only (one new row).

**This is the step most likely to be got wrong, and how:** reusing `underScope` correctly
means calling it with `sow.engagementId`, not `m.sowId` or the milestone's own (nonexistent)
parent — the same mistake would compile, since both are strings, and would only be caught by
`CMS1` actually asserting scope (a milestone under the WRONG client's engagement must be
absent, not just present-with-wrong-data). The second likely mistake: filtering `deletedAt`
on the wrong record (checking `sow.deletedAt` instead of `m.deletedAt`, or neither) —
`milestonesOf()`'s own history (fixed this session, commit `7fe7305`) is the concrete
precedent for exactly this slip.

## 2. View wiring

- `lib/viewChoice.ts`: `WORKSPACE_VIEWS` gains `'milestones'`.
- `components/AppSidebar.tsx`: `CLIENT_GROUPS`' `'Workspace'` group gains `'milestones'`
  after `'calendar'` — never `GROUPS`, the opposite of every prior page in this trio.
  `VIEW_LABEL`/`VIEW_TITLE` gain entries for both dictionaries (both are keyed by the full
  `WorkspaceView` union regardless of which group renders them, per the existing pattern —
  confirmed by `resourcing`/`commercial` already appearing in both `VIEW_LABEL` and
  `VIEW_TITLE` despite `resourcing` never appearing in `CLIENT_GROUPS`).
- `components/IssueWorkspace.tsx`: a stale-view guard, but the FIRST one in this trio that
  runs the other direction from `resourcing`'s/`commercial`'s — those protect an
  internal-only view from a reader who lost the grant; this protects a client-only view from
  a reader who has `internal.view` (mirroring the existing `people`/`!isInternal` guard's
  shape, inverted):
  ```ts
  if (view === 'milestones' && isInternal) setView('mywork')
  ```
  View-ternary chain gains a `ClientMilestonesPanel` branch.

**Verified by:** `npx tsc --noEmit` and `npx eslint` on the three touched files, clean.

## 3. `components/ClientMilestonesPanel.tsx`

New component, same `.evi.mywork`/`.evi-head`/`.evi-list` shell family as `ResourcingPanel.tsx`
and `CommercialRegister.tsx`, but no `.evi-tabs` (one audience-appropriate cut, not four) and
no quick-filter input (named out of scope in the design — a client's own milestone count is
small). Reads `state.clientMilestones` directly — never `state.milestones`, which stays `{}`
for this reader and would silently produce an empty page if reached by mistake (the exact
failure the design doc opens with). Renders the icon/label table from the design's own
delivery×acceptance grid, sorted by `sowReference` then `sequence`.

**Detail likely to be got wrong:** the Rejected row must not read `rejectionNote` — it is not
on `ClientMilestoneLine` at all after step 1, so this can only be gotten wrong by widening the
type later, not by this step; named here so a future edit to add it back gets stopped by
re-reading this line, not by rediscovering the reasoning.

**Verified by:** `npx tsc --noEmit` and `npx eslint components/ClientMilestonesPanel.tsx`
clean; `npm run validate:scenarios` re-run, byte-identical (no new pure logic beyond step 1's
— this component contains presentation only).

## Commits

- Step 1 alone — the boundary change and its disclosure proof. The one step here that
  matches Resourcing's/Commercial's "prove the join before anything depends on it" discipline
  is doing more work in this feature, and stands alone for that reason.
- Steps 2 + 3 together — wiring and the component, same reasoning as the other two pages:
  neither half means anything without the other.

## The step carrying the most regression risk

Step 1, and only step 1 — named explicitly per the design's own "Risk" section. Every other
step in this plan is ordinary read-only rendering once `clientMilestones` is correct. A wrong
`underScope` call, or a `!m.deletedAt` check on the wrong record, both compile and both pass
`npx tsc --noEmit` and `npx eslint` clean — only `CMS1`'s scope-leak and sentinel assertions
catch either, which is why step 1 is not allowed to proceed on typecheck alone the way the
later steps are.

## What would send the design back

- If `CMS1` cannot construct two distinct clients each resolving their own `clientScopeId`
  from `BASE` (the existing fixture seeds exactly one client, per `scripts/scenario-
  validation.ts`'s own "one client, one engagement" comment near the PK sentinel scenario) —
  would mean fabricating a second client node the same way that scenario fabricates a second
  engagement, which is a fixture-construction detail, not a design problem, but is named here
  because discovering it needs a second client's `HierarchyNode` with `kind: 'client'` under
  the company root, not just a second engagement.
- If a later `Milestone` field turns out to be commercial but not obviously so from its name
  (named in the design's own "What would send this back") — would mean revisiting
  `ClientMilestoneLine`'s hand-written field list, not the mechanism.
