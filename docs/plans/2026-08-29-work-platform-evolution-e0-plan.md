# E0 — Domain restructure: implementation plan

Follows `docs/plans/2026-08-29-work-platform-evolution-design.md`, scoped to phase E0 only:
tier definitions with an `externalParty` flag, the optional Outcome tier, Process Area →
Classification, the Issue→Work / Activity→Task renames, and Task-level time with the
transitional actuals rule. E1–E5 are direction, not plannable work; anything below that seems
to need leave, availability, chat, meetings, forecasting, or a boot-architecture migration is
scope creep to refuse, not to absorb.

Standing facts this plan is written against, verified in code before writing:

- `NODE_KINDS = ['company','client','engagement','project','module']` at `lib/types.ts:31`,
  with `isGroupRow`/`isNodeKind` deriving from it — already the single declaration point.
- `ALLOWED_PARENTS` at `lib/workspace.ts:494` permits tier-skipping (module under client,
  engagement, or project) — any generalized rule must reproduce this exactly.
- `lib/clientBoundary.ts`'s `clientView` is **scope-id-driven, not kind-driven**: it takes a
  `clientScopeId` node id and walks ancestor chains. The literal `kind === 'client'` tests in
  production lib code are exactly seven: `lib/autosave.ts:439` (mirror reconciliation),
  `lib/reports/clientPack.ts:89` (name→node lookup), `lib/tree.ts:448` (nearest-client-ancestor
  display name), `lib/workspace.ts:617` (seed init), `:1809` and `:2781` (client-name
  derivation), and `:6925` (validating `clientScopeId` names a client node). Scenario fixtures
  also select nodes by `kind === 'client'` (~30 sites in `scripts/scenario-validation.ts`) —
  fixtures, not product code, and they keep passing as long as the default tier set keeps the
  literal kind strings.
- `HierarchyNode.kind` is a **Postgres enum** (`NodeKind`: COMPANY…MODULE) in
  `prisma/schema.prisma:56` — org-defined tiers require enum→string, a real migration.
- Node ids embed kind strings (`client:OAPIL`, `module:OAPIL:Inventory`) and configuration
  scope overrides are keyed on them (schema comment at `HierarchyNode.id`). **Ids are opaque
  and are never rewritten by anything in this plan.**
- `TimeEntry` (`prisma/schema.prisma:887`, `lib/time.ts:50`) has required `issueId`, no
  activity reference.
- Terminology is already configurable: `KIND_LABEL_KEY` + `resolveLabel` render configured tier
  names everywhere (`lib/workspace.ts:483`, `termFor`). The `RowType` union was already deleted
  for exactly this reason (`lib/types.ts:78` comment).
- The scenario suite drives the reducer directly — 33 hits across `canParent`/module-kind/
  `percentComplete`/`addTime`, plus dedicated client-boundary scenarios (`cb1Client` at
  `scripts/scenario-validation.ts:5044` and the run at 5757–6177). This is the rare change
  where scenarios give real pre-browser coverage; they are the primary gate for steps 1–5.
- Live production, 4 tenants, RLS. Any migration with DML loops tenants with
  `set_config('app.tenant_id', …)` per the proven pattern in
  `prisma/migrations/20260827000001_rich_content_json/migration.sql`. Schema and code ship
  together so no deployed commit reads a shape the database lacks — the rich-content incident
  is the standing reason.

Per-step gates, abbreviated below as **[gates]**: `npx tsc --noEmit`, `npm run
validate:scenarios` (167 scenarios, 0 FAIL; `data/validation.json` committed only when
scenarios genuinely changed), `npm run build`. Migration steps add `npm run audit:persistence`
(62/62), `npm run audit:tenancy`, `npm run audit:attribution` (3/3) against the real database.
User-visible steps add the clean-room deploy (git archive → scratch dir → `.env` → `npm ci` →
`prisma generate` → `tsc` → `build` → `package-release.py --extra .next/static:.next/static
--extra public:public` → `prisma migrate status` → `az webapp deploy`) and live Chrome
verification.

## Step 1 — Confirm the kind-test enumeration (no commit)

Re-run the enumeration this plan was grounded on and read each site before touching anything:

    grep -rn "kind === 'client'\|kind: 'client'\|kind !== 'client'" lib/ app/ scripts/ --include="*.ts" --include="*.tsx"
    grep -rn "'module'\|'engagement'" lib/ app/api/ scripts/intake-mailbox.ts --include="*.ts" | grep -i "kind"

If a production site appears that is not in the seven above (components/ included — the
grounding pass did not sweep `components/`), add it to Step 3's list before Step 2 begins.
**Verify:** the written list in Step 3 matches the grep output. This step exists because the
design's own send-back clause hangs on this enumeration being complete.

**Step 1 conclusion (run 2026-08-29).** The `components/` sweep found seven more production
`'client'` sites beyond lib's seven — all display/picker/form logic, all confirmed by reading
to generalize to the same two helpers (flag test, ancestor walk); Step 3's list is updated
below. Two scoping findings, neither a send-back:

- **Engagement is a well-known tier, not a generic one.** SOW filing (`lib/workspace.ts:5457`,
  `:5988`), blueprints (`lib/blueprint.ts:105`, `components/RowMenu.tsx:220`), the
  `Engagement` Prisma relation ("present only on engagement nodes"), and the
  default-engagement lookup (`lib/engagement.ts:183`) all key on the literal `'engagement'`
  kind. E0 does **not** generalize these: default tier kinds are *well-known strings* that
  optional machinery may key on, and an org that omits the engagement tier simply has no SOW
  filing targets. Only the client boundary moves to the `externalParty` flag. This refines the
  design's tier-definition section without reopening it.
- **Module literal tests** (`lib/autosave.ts:446`, `lib/blueprint.ts:105`,
  `lib/workspace.ts:640/1808/2780`, `scripts/intake-mailbox.ts:97`) are Step 8's business,
  untouched by Step 3.

## Step 2 — Tier definitions in the model layer (pure logic)

**Files:** `lib/config.ts`, `lib/types.ts`, `lib/workspace.ts`.

The operating model (`OperatingModel.model` Json — configuration's existing home; no new table)
gains `tiers: TierDef[]`: `{ kind: string; labelKey: string; order: number; externalParty?:
boolean }`. Shipped default = the current five tiers with their current kind strings verbatim
(`client` flagged `externalParty`), so every stored node id, config override key, and scenario
fixture keeps working — the default org's model is indistinguishable from today's.

- `NODE_KINDS`/`isNodeKind`/`isGroupRow` become model-aware lookups (`tiersOf(model)`), with the
  static list retained only as the shipped default. Callers that have no model in hand are the
  finding of this step — enumerate them; if one genuinely cannot reach a model, that is a
  send-back item, not a hack.
- `ALLOWED_PARENTS` for tier rows becomes order-derived: a tier may parent under any strictly
  coarser tier (which reproduces today's skip-tier table exactly — verify by table, not by
  assumption); leaf rules stay explicit (`issue` under any tier or `issue`; `activity` under
  `issue`; `milestone` under `issue`/`activity`).

**Verify:** a throwaway `npx tsx scripts/tmp-verify-tiers.ts` (deleted after) driving
`canParent` across the full old-table cross-product for the default tiers and asserting
identical answers, plus a non-default tier set exercising the order rule. Then **[gates]** —
the 33 parenting/rollup hits in the scenario suite are the real check. One commit.

## Step 3 — `externalParty` replaces the literal `'client'` tests

**This is the step carrying the most regression risk in the plan.** The seven sites are the
live tenant's disclosure controls' plumbing. A wrong generalization does not error: it silently
widens what a client-scoped guest receives (a disclosure, landing on a real client) or narrows
it (a support ticket). The design doc's send-back clause — "if any boundary machinery depends
structurally on *which* tier is the client tier" — is decided here.

**Files:** `lib/access.ts` or `lib/config.ts` (new helpers), then `lib/autosave.ts`,
`lib/reports/clientPack.ts`, `lib/tree.ts`, `lib/workspace.ts` (four sites), and per Step 1's
completed enumeration: `components/ConfigWorkspace.tsx:869` and `:2798` (scope pickers),
`components/DetailPanel.tsx:568` (node-detail branch), `components/Dialogs.tsx:178` (the
client form branch — its own comment already says "derived from the tier list rather than
named"; the flag completes that intent), `components/GanttChart.tsx:387` (bar color, may key
on tier order instead), `components/IssueWorkspace.tsx:1562` (default parent for "+ New
Issue"), `components/ScopePanel.tsx:44/:229` (unassigned-under count), and
`components/TreeGrid.tsx:782` (top-of-tree banner styling — order-based, not flag-based: the
banner belongs to the top two tier orders, whatever they are).

- Two helpers, written first: `isExternalPartyTier(model, kind)` and
  `nearestExternalPartyAncestor(state, rowId)` (the `lib/tree.ts:448` walk, generalized).
- Each site rewritten against them (or against tier *order* where the test was really "top of
  tree", per the two cosmetic sites above). `lib/workspace.ts:6925` (the `clientScopeId`
  validation) becomes "names a node whose tier is flagged externalParty".
- `IssueWorkspace.tsx:1562`'s default parent must handle a flat org with no externalParty
  tier: first externalParty node, else first node of the coarsest configured tier — never
  null-crash on an org shape the default tenant doesn't have.
- `clientView` itself is untouched — it is already scope-id-driven; state that in the commit.
- Fixture-class scripts (`persistence-proof.ts:699`, `restore-proof.ts:96`,
  `seed-allocations.ts:109`) keep their literal selectors — the default tier set preserves the
  kind strings, so they pass unchanged.

**Verify:** **[gates]**, with specific attention to the client-boundary scenario block
(`scripts/scenario-validation.ts:5044`, 5544–6177) — these drive `clientView` and the scoped
reader through the reducer and are the pre-browser proof that disclosure behavior is
unchanged. Then `npm run audit:persistence` and `audit:tenancy` (this touches no schema, but
the boundary is what those proofs exist for). One commit, separate from Step 2 — this one is
read under incident conditions if anything ever goes wrong at the boundary.

## Step 4 — Migration: `HierarchyNode.kind` enum → string (stands alone)

**Files:** `prisma/schema.prisma`, new `prisma/migrations/…_node_kind_string/migration.sql`.

Pure DDL, no DML, so the RLS tenant loop is not needed: `ALTER TABLE "HierarchyNode" ALTER
COLUMN "kind" TYPE TEXT USING "kind"::text` (values arrive as the uppercase enum labels —
confirm what the Prisma client maps them to today and preserve exactly that stored spelling;
`lib/types.ts:29` says "the database enum is their uppercase form", and the repo layer owns
the case mapping — read `lib/db/repo.ts`'s node read/write before writing the migration, and
convert case in the migration only if the repo expects it), then drop the `NodeKind` enum
type. Schema: `kind NodeKind` → `kind String`.

Ordered before the Outcome step so Outcome needs no enum surgery — after this, a new tier kind
is data, not DDL.

**Verify:** `npx prisma migrate deploy` against production during the deploy, preceded by
`npx prisma migrate diff` review; **[gates]** plus all three audits; then the clean-room deploy
in the same release as Step 2+3's code (schema and code travel together — the app before this
step never sees a string kind it doesn't know, because the default tier set is the same five).
Live check: tree renders, a node can be created and moved. Standalone commit.

## Step 5 — The Outcome tier

**Files:** `lib/config.ts` (default tier set), `lib/workspace.ts` (create/move vocabulary,
`KIND_LABEL_KEY` entry), `components/` create menus (`Dialogs.tsx`, row menu), `lib/tree.ts`
(group-row rendering picks it up via `isGroupRow` automatically — verify, don't assume).

`outcome` joins the default tier set between `project` and `module`, unflagged, with a new
label key (default label "Outcome"). Optional per the design: `ALLOWED_PARENTS`' derived rule
already permits work under project *or* outcome once the tier exists; no org is forced to
create one. No migration — after Step 4, a new tier is configuration.

**Verify:** **[gates]**; add reducer-driven scenario entries for outcome parenting (create
outcome under project, work under outcome, refuse outcome under issue) — this changes
`data/validation.json`, which is committed with this step. Live: create an Outcome in the real
workspace, file a work item under it, confirm rollups aggregate through it (the
`attachRollups` walk in `lib/tree.ts:273` is kind-agnostic — confirm with the real row). One
commit.

## Step 6 — Migration + model: Task-level time (stands alone)

**Files:** `prisma/schema.prisma`, new migration, `lib/time.ts`, `lib/workspace.ts` (addTime
arm), `components/DetailPanel.tsx` Time tab.

- Migration: `TimeEntry` gains nullable `activityId` + FK to `IssueActivity` + index. Additive,
  no DML, no backfill — **existing rows are attested history and are not touched**.
- `issueId` stays **required** on every entry, including task-level ones (a task's entry
  carries its work's id too). This is what makes the transitional actuals rule automatic:
  `Work.actual = Σ(entries where issueId = W)` is *unchanged*, already counting both legacy
  work-level entries and new task-level ones. `Task.actual = Σ(entries where activityId = T)`
  is the only new sum. No summing site needs a special legacy branch — record this in the code
  comment where `activityId` is declared, because it is the reason the field is nullable and
  `issueId` is not.
- `addTime` accepts an optional task reference, validating the task belongs to the entry's
  work. New code reads `personId` when present but must not deepen the name-join
  (`TimeEntry.person`) — out of E0 scope to fix, in scope to not worsen.
- Time tab gains a task picker on entry (optional, defaulting to work-level).

**Verify:** **[gates]**; extend the addTime scenario coverage with a task-level entry and the
belongs-to-work refusal (commits `data/validation.json`); `audit:persistence` must cover the
new column round-trip — extend `scripts/persistence-proof.ts` in the same commit if it proves
TimeEntry fields individually (read it; do not assume). Clean-room deploy; live: record one
task-level entry against real work, confirm the work's actual includes it, then remove it
through the app. Migration in its own commit; model+UI in a second.

## Step 7 — Renames as shipped defaults

**Files:** `lib/config.ts` (`LABEL_KEYS` shipped defaults), docs.

Default labels change: the issue record's default term becomes "Work", the activity's "Task",
module's "Classification" groundwork aside (Step 8). **No code identifiers are renamed** —
`Issue`/`IssueActivity`/`issueId` stay, per the same reasoning the `RowType` union was deleted:
the rendered word is configuration, and an 8,000-line identifier churn has zero behavior and
real merge risk. Tenant #1's workspace already overrides terms; confirm whether its stored
overrides shadow the new defaults (they will — stored config wins) and update tenant #1's
configuration through the app, not the database.

**Verify:** **[gates]**; live check that the tree's Type column, dialogs, and assistant
placeholder (`config.terms.issue` flows through `ChatConfig`) all say Work/Task. The assistant
grammar needs nothing: `ID_RE` matches displayIds, which do not change. One commit.

## Step 8 — Classification extraction (two standalone migrations, last)

**Files:** `prisma/schema.prisma` + migration (8a), `lib/workspace.ts`, `lib/tree.ts`,
`components/FilterBar.tsx`; second migration + `scripts/intake-mailbox.ts` (8b).

- **8a — the label exists.** `Issue` gains nullable `classification String?`. Backfill DML:
  per tenant (RLS loop, the 20260827000001 pattern), set each issue's `classification` to its
  nearest module-ancestor's name. Module nodes remain containers — dual-running, nothing moves.
  FilterBar's module facet reads the stored label (falling back to the ancestor walk during
  transition). **Verify:** **[gates]** + all three audits; a throwaway `npx tsx` script
  comparing stored classification against the ancestor walk for every live issue, expecting
  zero mismatches.
- **8b — tenant #1 converts.** Per tenant *opting in* (axiocloud only, after 8a has soaked):
  DML reparents each issue under its module node to the module's parent, soft-deletes the
  module nodes, and — decided here, not during implementation — **intake retargets**:
  `scripts/intake-mailbox.ts`'s triage location (`TRIAGE_NAME = 'Unfiled intake'`,
  `intake-mailbox.ts:63`) becomes a project-tier node under the same client, with
  `classification: 'Unfiled intake'` on the filed work; its `canParent('issue', scope.kind)`
  check already tolerates the new parent kinds via Step 2's rule. Node ids of reparented
  issues do not change; module node ids are soft-deleted, not rewritten. **Verify:**
  **[gates]** + audits; live: the tree shows issues under projects with the classification
  facet filtering them; post one test intake message end-to-end, confirm it files and remove
  it. Each migration its own commit.

## Details most likely to be got wrong

1. **Node ids are opaque and never rewritten** — `module:OAPIL:Inventory` keeps that id even
   after its node is retired; config scope overrides key on ids.
2. **`issueId` stays required on task-level TimeEntry rows** — the transitional actuals rule
   depends on it; making it nullable "for cleanliness" breaks the sum.
3. **The enum→string cast must preserve the stored spelling the repo layer expects** — read
   `lib/db/repo.ts`'s kind mapping before writing Step 4's `USING` clause.
4. **Scenario fixtures select by `kind === 'client'`** — the default tier set must keep the
   literal kind strings or ~30 fixture sites fail for reasons that look like boundary breaks.
5. **Seed/bootstrap** (`lib/workspace.ts:617`, `initWorkspace`) creates nodes with literal
   kinds — it must build from the default tier set, or a fresh tenant's first boot breaks
   (checked by `audit:persistence`'s proof tenants, which import from seed).
6. **`data/validation.json`** rides only commits whose scenarios changed (Steps 5, 6).
7. **Tenant #1's stored terminology overrides shadow new shipped defaults** — the rename lands
   for tenant #1 via its configuration screen, not by editing defaults alone.

## What would send the design back

- **Step 2:** a `NODE_KINDS` consumer that genuinely cannot reach an operating model (a static
  context with no state), or the order-derived parent rule failing to reproduce the skip-tier
  table — either means tier definitions need a different shape (explicit parent lists, or a
  tiers-without-model fallback contract) and the design's "configurable prefix" section reopens.
- **Step 3:** any of the seven sites turning out to need *which* tier, not *whether flagged* —
  the design doc's own first send-back clause, decided by this step's scenario run.
- **Step 6:** the transitional actuals rule producing visible double-counting in any real
  report (a summing site found to add task sums *and* entry sums) — the time migration needs a
  different shape than "issueId carries both".
- **Step 8b:** if reparenting under projects breaks an invariant the module tier was silently
  providing (e.g. per-module numbering, or the intake refusal model losing its filing target)
  — classification-as-label was the design bet, and this is where it is falsified cheaply,
  tenant-by-tenant, before any other org exists.
