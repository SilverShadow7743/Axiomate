# Blueprints — implementation plan

Follows `docs/plans/2026-08-19-blueprints-design.md` (approved 19 Aug 2026). Ordering
principle: the round-trip — extract from a fixture, apply to a fresh client, reproduce the
structure — is provable entirely in pure code plus the reducer, so it is proven before any
screen exists; the two screens are the browser part and come last.

The design's governing constraints, quoted: *"offsets instead of dates"*; *"nothing is stored
unreviewed"*; *"a partial failure is visible and partial"*; *"undated entries stay undated"*.

**One deviation from the design, decided here with its reason:** the design says applying
writes a pinned note on the target engagement. Notes attach to issues only
(`addNote.issueId`, lib/actionShape.ts:539), and an engagement is a node. Provenance therefore
lives on the BLUEPRINT: `applications: { at, by, targetId, version }[]` — a stored fact like
`lastRaisedOn`, appended in the same batch as a successful apply. It answers the design's own
question ("which engagements came from version N") from one place, and the audit trail already
stamps every created record with who and when.

## Steps

**1. `lib/blueprint.ts` (new) — types and the pure halves.**
`BlueprintEntry { id, kind: 'project'|'module'|'issue', name, parentEntryId: string|null,
type, severity, discipline, startOffset: number|null, endOffset: number|null }` — note the
stored node kind is `module` (NODE_KINDS, lib/types.ts:29); the screens may render the firm's
terminology for it, the data does not. `BlueprintLink { predecessorEntryId, successorEntryId,
dependencyType, lagDays }`. `Blueprint { id, name, sourceEngagementId, version, entries,
links, applications }`.
`extractBlueprint(state, engagementId)` — walks the subtree (nodes via parentId, issues via
`issuesUnder`), anchor = earliest planned start/end among dated items, offsets =
`daysBetween(anchor, date)`, links carried where both ends are inside the subtree, deleted
rows excluded. Pure; an engagement with no dated items yields all-null offsets.
*Verify:* `npx tsc --noEmit` clean.

**2. `applyBlueprint(state, blueprint, targetParentId, anchor, actor, keep: Set<string>)` —
also in `lib/blueprint.ts`, mirroring `runRecurrences`' shape.**
Sequential `apply` calls, parents before children (entries sorted so `parentEntryId` is
always already applied; the root entry's parent is `targetParentId`): `create` for each kept
entry (id learned by diffing state keys, as `runRecurrences` does), `setDates` where offsets
exist (`addDays(anchor, offset)`), `addDependency` for links whose BOTH ends were kept and
applied. An entry not in `keep` is skipped WITH its descendants — pruning is subtree pruning.
Returns `{ state, steps, refusals, mapping }`. No config write here; the `applications`
append is a separate `upsertBlueprint` the caller dispatches on success (same transaction at
the persist layer, same pattern as the recurrence guard).
*Verify:* step 3's scenarios.

**3. Scenarios BP1–BP2 — `scripts/scenario-validation.ts` (CRLF; python script file, not a
heredoc).**
BP1, the round-trip: extract from the fixture engagement, apply to a client node in the same
fixture with anchor `2026-09-01`; assert same tier structure under the new parent, same issue
count, a dated item's new date = anchor + its old offset, an undated item still undated, and
the dependency reproduced between the MAPPED ids. BP2, pruning and refusal: apply with a
subtree's root unticked — none of its descendants appear; apply targeting an archived node —
every create refuses (the phase-2 guard) and `refusals` carries the reducer's message.
*Verify:* `npm run validate:scenarios` — BP1, BP2 PASS; nothing regresses.

**4. Config plumbing — `lib/config.ts`, `lib/workspace.ts`, `lib/actionShape.ts`.**
`blueprints: Record<string, Blueprint>` on the model; seed `{}`; **explicit `mergeModel`
line**. `upsertBlueprint` (validates name; increments `version` on every update where
`patch.entries` or `patch.links` changed — creation is version 1) and `deleteBlueprint`;
both in `CONFIG_OPS`. The `applications` append travels as
`{ k: 'upsertBlueprint', id, patch: { applications } }` — permission note: applying a
blueprint is issue/node creation plus this one config append; reuse the phase-2 gate shape
ONLY if a machine ever applies — people applying hold real permissions, and v1 has no machine
path, so no gate change.
*Verify:* `npx tsc --noEmit`; BP3 scenario: version increments on an entries edit, not on a
rename; the applications append does not bump the version.

**5. The screens — `components/ConfigWorkspace.tsx` (Blueprints section under Governance) +
an Apply affordance.
THE STEP CARRYING THE MOST REGRESSION RISK** — not for what it breaks but for what it can
quietly do: the Apply button is the first control in the product that creates DOZENS of
records in one click. Guards: the extract screen lists the proposal with every entry ticked
and uncheckable (prune before store); the apply screen demands target + anchor date and shows
the count it is about to create ("41 records under Axio-Retail, dated from 2026-09-01") before
the button enables; refusals render per-entry afterwards with the reducer's words. If this is
wrong, somebody builds 40 records in the wrong place — recoverable (softDelete cascade
exists) but noisy, so the confirmation sentence is load-bearing.
*Verify:* `npx tsc --noEmit && npm run build`; the count sentence against the fixture in BP1's
numbers.

**6. Checklist section 19, sweep, deploy, and the production extraction.**
Section 19: extract from OAPIL, prune to the repeatable shape, store as "D365 implementation
v1", confirm the card shows entries/version — **stored, not applied**, per the design; the
apply half of section 19 is written but marked "runs when a real engagement starts". Sweep +
release as phases 1–3.

## Details most likely to be got wrong

- **Entry order in `applyBlueprint`**: children before parents means every child refuses with
  "parent does not exist". Sort by depth within the blueprint, and map `parentEntryId`
  through `mapping` at dispatch time.
- **The anchor is day zero, offsets may be negative** — an item that started before the
  engagement's earliest dated item cannot exist by construction (anchor is the minimum), but
  an edited blueprint can hold one; `addDays` handles negatives, do not clamp.
- **`daysBetween`/`addDays` come from `lib/dates.ts`** — do not reimplement; timezone bugs
  live in reimplementations.
- **Prune is subtree prune**: an unticked parent removes its children from the apply even if
  ticked; BP2 pins it.
- **Version bumps on structural edits only** (entries/links), not on rename, not on the
  applications append — otherwise provenance points at versions nobody authored.
- **The stored kind is `module`**, whatever the terminology renders. Extraction must not
  store display labels as kinds.
- `create` for a node draft: name + owner only (lib/workspace.ts create arm) — do not try to
  set dates in the create; `setDates` is its own action and its own refusal.
- CRLF/LF per file; long edits via python script files.

## Commits

Steps 1–3 together (the pure core and its round-trip proof are one thing). Step 4 alone.
Step 5 alone (the screens). Step 6 with the checklist.

## What would send the design back

- The round-trip cannot reproduce dependencies because `addDependency` refuses cross-subtree
  or issue-only constraints the fixture needs (surfaces in BP1) — would mean links do not
  belong in v1 and the design's scope changes.
- Blueprint JSON for OAPIL-scale extraction is too large for the config document in practice
  (surfaces in step 6's real extraction) — would mean first-class entity + migration, a
  storage design change.
- Pruning at extract time proves the wrong moment — people want to prune at APPLY time too
  (surfaces the first time the stored blueprint is applied for real) — that is a v2 feature
  request, not a patch, and it reopens the "nothing stored unreviewed" clause.
