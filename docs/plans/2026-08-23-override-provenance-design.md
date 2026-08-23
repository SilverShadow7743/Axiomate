# Override provenance and blast radius — design

**Date:** 2026-08-23 · **Register item:** #7 · **Status:** approved (batch go)

## The gap

The scope-override system resolves correctly — `resolveLabel` / `resolveAgentEnabled` /
`resolveRequired` walk fine → coarse → organisation default → shipped default — but the
screens tell only half the story. The Scopes screen lists what a scope CHANGES, never what
it EFFECTIVELY SEES or where each value came from; and setting a value anywhere previews
nothing about what it touches. The PRD's "project-overrides-defaults" rule needs both to be
legible: a value's provenance where it is read, and a change's reach before it is made.

## The design

**No reducer or storage change** — the values and the walk already exist; this is the
read-side made legible, plus one pure function.

### 1. The sources

Beside the resolvers in `lib/config.ts`: `labelSource`, `agentEnabledSource`,
`requiredSource` — each the same walk as its resolver, returning `{ value, at }` where `at`
is the scope id that supplied the value, `ROOT_SCOPE` for the organisation default, and
`null` for the shipped default (or the agent's / responsibility type's own flag). The
resolvers stay as they are; the sources are the annotated twins, and a divergence between a
resolver and its source would be a bug the scenario catches by comparing them.

### 2. The blast radius

`blastRadius(options, at, sets)` — pure over the configurable scopes (`{ id, chain }`,
chain fine → coarse as `scopeChainOf` builds it), a change point `at`, and a predicate
`sets(scopeId)` saying whether a scope pins the key itself. A scope is IN the radius when
`at` is itself or in its chain; walking from the scope outward, the first pin met before
reaching `at` shields it — returned as `{ id, by }` so the screen can name the shield.
Returns `{ affected, shielded }`.

### 3. The screens

- **Scopes → "Effective here"**: a new section under "What this scope changes" showing the
  full resolved picture at the selected scope — every label, every agent, every
  responsibility — each with a source chip: `set here` / `from <scope name>` /
  `organisation default` / `shipped default`. The question "what does this engagement
  actually call things, and who decided" gets one screen.
- **Scopes → per-override radius**: each "What this scope changes" row gains one line —
  "applies to everything beneath <scope> · N scopes set their own and will not move" —
  from `blastRadius` with the row's own key.
- **Terminology at a scope**: when the editor's target is not the organisation default,
  the same radius line under the input, BEFORE the save — the preview half of the item.

### 4. Proof

Scenario **OV1**: overrides at two nested scopes; every source kind produced (own,
ancestor, organisation, shipped) and each source's `value` equal to its resolver's answer;
`blastRadius` at the root shielding the overriding branch and naming the shield; at a
mid-scope reaching only its own subtree; a scope pinning the key counted shielded by
itself.

## Out of scope, stated

- Provenance chips on every CONSUMING screen (the grid's column headers, the detail panel)
  — the labels hook resolves per scope chain already; annotating every read surface is a
  sweep of its own, and the Scopes screen is where the question is actually asked.
- Blast radius for template adoption — templates apply at create time, not retroactively,
  so "reach" means something different there.

## What would send this back

- A wish to see provenance at the point of USE (tooltips on every label) — a different,
  much wider surface.
- Scope-level permissions ("who may override here") — a policy dimension the model does
  not carry.
