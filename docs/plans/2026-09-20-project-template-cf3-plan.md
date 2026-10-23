# CF3 — project template: implementation plan

Design at `docs/plans/2026-09-20-project-template-cf3-design.md`. Two open decisions there are now
answered directly by the user:

1. **The `module` tier's default label changes to "Deliverable"** for this deployment.
2. **One `ProjectTemplate` links to exactly one `Blueprint`** — not a menu of several.

## What decision 1 actually requires: nothing to build

Checked against `lib/config.ts`'s own comment on `LABEL_KEYS`: "Adding a key here is a code
change because something must render it. Changing its *label* is a configuration change and
needs no code at all." `TIER_MODULE: 'Process Area'` is the shipped default; the per-organisation
override lives in stored `OperatingModel` data, edited through Configuration → Terminology in the
running app. This environment cannot reach the live tenant's database (unchanged limitation, every
pass this session), so this decision is recorded — done — but the actual relabel is an operational
action for whoever has access to the live Configuration screen, not a commit. Nothing further
below depends on the label string itself; the reducer and schema work entirely in terms of the
`module` kind, not its display name, exactly as the configurability design intends.

## Ordered by provability, smallest first

**Slice 1 — extend `Blueprint` to the `outcome` tier.**
`extractBlueprint`'s subtree walk (`lib/commercial/blueprint.ts:105`) currently keeps `n.kind === 'project'
|| n.kind === 'module'`; add `|| n.kind === 'outcome'`. `BlueprintEntry.kind`'s type union
(`'project' | 'module' | 'issue'`) gains `'outcome'`. `applyBlueprint`'s `create` action
(`lib/commercial/blueprint.ts:236`) already branches only on `entry.kind === 'issue'` vs. everything else
for the draft shape (`{ name: entry.name }` for any non-issue kind) — an outcome entry needs no
new branch, it falls into the existing "structural node" path unchanged. Mechanical, same shape
as the existing project/module handling, highest confidence of the three slices.

**Slice 2 — link `ProjectTemplate` to a `Blueprint`, apply it on adoption.**
`ProjectTemplate` (`lib/config.ts:768`) gains `blueprintId: string | null`. The `adoptTemplate`
config action's reducer arm, after setting the agent/workflow/approval defaults exactly as today,
checks whether the adopted template names a blueprint; if so, calls `applyBlueprint` against the
scope the template was adopted at, using today's date as the anchor (the scope being adopted onto
is new — there is no prior dated work to derive an anchor from, unlike `extractBlueprint`'s
own case) and `keep` set to every entry (the whole blueprint, not a partial pick — picking a
subset is the existing blueprint-application screen's job when someone applies one by hand;
`adoptTemplate` applying automatically shouldn't add a second UI for the same choice). CF3's own
scenario moves from PARTIAL to PASS once this is proven: adopting a template that names a
blueprint creates real project/outcome/module/issue structure, not just defaults.

**Slice 3 — milestones. Named, not built this pass.**
The user's "Milestones" child record turns out to be a different mechanism than the structural
nodes above: the schedule-level milestone (`kind: 'Milestone'`, confirmed live in this session's
browser check as a child *activity* of an issue, e.g. `OAPIL-120-01 └ Milestone`) is created
through `addActivity`, not `create` — a different action, scoped to a parent *issue*, not a
hierarchy node. Capturing it means `BlueprintEntry` (or a new, related shape) recording which
issue-entries carried a milestone activity and re-creating it via `addActivity` on apply, offset
from the same anchor `BlueprintEntry.startOffset`/`endOffset` already use for issues. Real, scoped,
and deliberately deferred — Slices 1 and 2 are what "the template instantiates the required child
structures" concretely needs first; milestones are a fast-follow, same discipline this session
already applied to the Commercial register's own deferred piece.

## Testing

Slice 1: extend whatever scenario already proves the extract/apply round-trip
(`scripts/scenario-validation.ts`) with an outcome-kind node in the source subtree, proving it
survives both `extractBlueprint` and `applyBlueprint`.

Slice 2: a new scenario — adopt a template naming a blueprint at a fresh scope, confirm the
resulting structure matches the blueprint's shape (same proof style `RSC1`/`COM1` already used
for "did this actually go firm-wide", here "did this actually create what the blueprint said").
CF3 itself is rewritten to use this path and its verdict moves to PASS.

## Risk

Slice 1: low — additive to an existing, working mechanism. Slice 2: moderate — `adoptTemplate`
gains a real side effect (creating records) it didn't have before; the failure mode to guard
against is a template naming a blueprint that no longer exists or was deleted, which
`applyBlueprint`'s existing refusal-collection (`BlueprintRun.refusals`) already handles by
design — nothing new needed there, just wiring `adoptTemplate` to surface those refusals rather
than swallow them.
