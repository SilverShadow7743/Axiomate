# Custom fields — a minimal, typed extension point for Issue data

**Status: draft, 8 September 2026.** Scoped from the 8 Sep live walkthrough of Hive's
Customization → Custom fields (`docs/plans/2026-09-07-hive-comparison.md`'s companion
granular pass). Not built, and not a small addition — this is a new data-foundation layer,
scoped deliberately narrow below. Needs a decision from Nishant before Gate 1: see
"What this is not," and the open questions at the end.

## The gap, and what Hive actually has

Hive's real, live custom-field system (checked in "FnO Technical Team," not assumed): a field
has a **name**, an optional **group** (organizes the library, not the data), an **item type**
(Action field or Project field), and a **field type** — 8 of them: Select, Text, User, Date,
Project, Formula, Table lookup, Number. A field is defined once, workspace-wide, then opted
into individual projects ("Add existing fields to this project" — a checkbox picker; a field
can be live on one project and absent from another).

Axiomate has no equivalent. `Issue` is a fixed schema plus config-driven **vocabularies** —
Work types, Disciplines, Service levels, Skills — each its own purpose-built axis with its own
meaning, validated its own way. None of them are "a firm types in a field and gets a column."
There is no mechanism today for a firm to say "we also want to track X on every issue" without
that becoming a schema change somebody at Axiocloud makes for them.

## What this is not

Not a general-purpose dynamic-schema engine, and not Hive's 8-type system. Two of Hive's
types are structurally large on their own:

- **Formula** — a computed field needs an expression language, a dependency graph, and a
  recompute story. This codebase's own repeated position (`lib/portfolio.ts`, `lib/skills.ts`,
  `lib/capacity.ts`, and now `docs/plans/2026-09-08-admin-first-run-design.md`'s own
  reasoning) is that **derived values are computed at read time from a pure function, never
  stored as fact** — `bySeverityAndStatus`, `candidatesFor`, `profileAt` all work this way. A
  user-authored formula stored as a value would be the first place in the whole product where
  a derived number is treated as data. That is not a small precedent to set alongside a custom
  field — it is a reversal of a rule this codebase enforces everywhere else, and needs its own
  decision, separate from this one.
- **Table lookup** — a relational reference to another custom field's data, which presumes
  custom fields already have enough structure to be looked up into. Ordering problem: this
  cannot exist before the base system does, and probably shouldn't exist in the same phase as it.

So this proposes the other four, and no more: **Select, Text, Date, Number**. All four are
values, not computations — no dependency graph, no expression language, no second system.
Assignee-shaped fields (Hive's "User") already have a home on `Issue` (`owner`, `assignments`)
and don't need reinventing as a custom field type here.

## Shape, following the two precedents this codebase already has

**The catalogue** — same shape as `Skill`, `WorkType`, `Discipline` (`lib/config.ts`): a new
`CustomFieldDef` type living in `OperatingModel`, stable ids (`CF_<n>`), soft-deleted not
hard-deleted (existing values on issues must keep meaning even after a field is retired —
same reasoning `Skill.deletedAt` already established for `candidatesFor`).

```ts
interface CustomFieldDef {
  id: string
  name: string
  fieldType: 'select' | 'text' | 'date' | 'number'
  /** Only present, and only meaningful, when fieldType is 'select'. */
  options?: string[]
  deletedAt: string | null
}
```

No per-project opt-in in this first cut — Hive's project-scoping is real but adds a second
axis (which fields, on which projects) this design does not need to solve on day one. Start
workspace-wide; a project-scoping pass is a legitimate follow-up once there is a firm asking
for it, not before.

**The value** — same shape as `Issue.requiredSkills` (`docs/plans/2026-09-08-*` and the I3
build): a `Record<fieldId, value>` Json column on `Issue`, written through the existing
`updateIssue` patch path. No new action, no new permission — gated on `work.edit` like every
other Overview field, exactly as `requiredSkills` was. A composite `actionShape.ts` validator
checks each entry's `value` against its field's declared `fieldType` — the same pattern as the
`requiredSkills` checker, extended to look up the field definition rather than a fixed shape.

**Rendering**: a new small section on the Overview tab (or its own tab, if the list grows past
a handful) — one input per live, non-deleted field, typed to `fieldType`. `select` renders the
field's own `options`; the others are a plain text/date/number input. Nothing here is invented
UI — it is the same "one row per config-driven field" pattern `OverviewTab` already applies to
Discipline and Service level.

## What would send this back

If Select's `options` need to change shape mid-life (add one, remove one that's in use on live
issues) without orphaning stored values — the same problem `Skill`/`WorkType` soft-delete
already solved once; this reuses that answer rather than re-deciding it. If a firm's first ask
turns out to be Formula or Table lookup specifically (not Select/Text/Date/Number) — that is
evidence this scope cut was wrong, not a reason to quietly add them here without the derived-
value decision above being made on its own.

## Open questions for Nishant, before this goes further

1. **Is this worth building at all right now?** Nothing in this codebase's own backlog asked
   for it — this is a Hive-comparison finding, not a customer or delivery request. Worth
   checking whether OAPIL or SLG has actually hit a wall needing a field the fixed schema
   doesn't have, versus building ahead of a real need.
2. **Per-project opt-in, deferred above — agree, or does day one need it?** If different
   engagements want visibly different fields (a common real reason firms want this at all),
   deferring it may undercut the point of building this now rather than later.
3. **Formula and Table lookup, dropped above — permanently, or "not yet"?** If a real use case
   for a computed field shows up, the derived-value doctrine question needs its own decision
   before code, not a quiet exception carved into this feature.
