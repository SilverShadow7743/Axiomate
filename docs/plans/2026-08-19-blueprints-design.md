# Blueprints — design

Approved 19 August 2026. Phase 4 of the Hive gap program, and the largest piece of it.

## What is being built

The shape of an engagement that already ran, stored so the next one starts from it: the tree of
projects and process areas, the standard work items, the dependencies between them, and
**offsets instead of dates**. Hive's project templates store a list of actions and stamp copies
dated today; that is the part this deliberately refuses. A blueprint holds "UAT sign-off,
+5 days after the anchor", and applying it names one anchor date from which every date is
computed.

The name is "blueprint" because `templates` is taken: `ProjectTemplate` in `lib/config.ts` is
the agent-enablement bundle a scope adopts, and two things called templates that do different
things would be a permanent source of confusion.

## Derived, not authored

A blueprint is extracted from a real engagement. The extractor takes the engagement's subtree
and proposes: the structural tiers, the work items, offsets computed from the dates the
engagement actually carried (planned dates where present, and the anchor is the earliest dated
item), and the dependency links between included items. **The proposal is shown and pruned
before anything is stored** — most of a real engagement's issues are client-specific history,
and the person extracting unticks what is not repeatable. Nothing is stored unreviewed.

A stored blueprint can be edited afterwards — entries renamed, offsets corrected, items
removed — but it is born from evidence, not from a blank form.

## What an entry holds

Kind (project / process-area / module / issue), name, parent (within the blueprint, by entry
id), type, severity, discipline, and for dated items `startOffset` / `endOffset` in days from
the anchor. Dependencies are links between blueprint entries carrying their type and lag.

Deliberately absent:

- **Owners.** People are per-engagement, and a name baked into a blueprint is the
  identity-join failure waiting to happen again.
- **Statuses.** Everything applies at the entry state; a blueprint may not decide work is in
  progress.
- **Anything commercial.** SOW, rates, milestones and scope stay outside — the same refusal as
  Portfolio and Goals.

## Versioning and provenance

A blueprint carries `version`, incremented on every edit after creation. Applying writes a
pinned note on the target engagement naming the blueprint and the version it came from — so
when a blueprint is later corrected, the engagements built from the old version are findable.
That is the question Hive cannot answer.

## Applying is the same lever

Apply names a target parent (client or engagement) and an anchor date, then dispatches
ordinary `create`, `setDates` and `addDependency` actions through the reducer, attributed to
the person who clicked. Permissions, `canParent`, and the archived-parent guard all apply. A
partial failure is visible and partial: what applied stands, what refused is listed with the
reducer's own message, nothing is half-written. Undated entries stay undated — `Unscheduled`
is a first-class state, and inventing dates for items the source engagement never dated would
be a guess rendered as a plan.

## Storage

`blueprints: Record<string, Blueprint>` in the `OperatingModel` — configuration like
everything else in this program. No migration; explicit `mergeModel` line;
`upsertBlueprint` / `deleteBlueprint` registered in the compile-time-exhaustive `CONFIG_OPS`.
A blueprint of a hundred entries is small JSON.

## Error handling

Extraction is pure and cannot fail — an engagement with no dated items produces a blueprint
whose entries are all undated, stated on screen rather than discovered. Apply failures are
per-action: collected, shown with the reducer's messages, never retried silently.

## Testing

The round-trip is the proof: extract from a fixture engagement, apply to a fresh client in the
same fixture, and the applied subtree must reproduce the structure — same tiers, same items,
same dependency shape — with dates re-anchored to the named day and undated items still
undated. Scenarios pin that, plus offset arithmetic against the anchor, pruning (an unticked
entry and its children do not apply), and the provenance note. Then the screens, checklist
section 19, and one real extraction from OAPIL in production — **stored, not applied**;
applying creates a real engagement, which happens when a real one starts.
