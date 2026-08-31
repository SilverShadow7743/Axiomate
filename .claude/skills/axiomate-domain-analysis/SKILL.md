---
name: axiomate-domain-analysis
description: This skill should be used when a new requirement, feature, or data need must be checked against Axiomate TMS's real domain model — before creating a new entity, field, or concept. It supplies the actual tier chain, work-item kinds, status model, and invariants from the shipped schema, so new work extends what exists instead of inventing a parallel concept. Load before axiomate-work-model, axiomate-estimation, or axiomate-project-allocation when the question is "does this already exist."
---

# Axiomate Domain Analysis

**The critical rule: don't create a new entity or field if an existing concept already
represents it.** This skill is how you check. Everything here is cited to real schema/code, not
inferred from naming — Axiomate's domain vocabulary has already surprised generic assumptions
twice (see below), so verify, don't assume.

## Process

1. Read `references/domain-model.md` — the real tier chain, work-item kinds, status model, and
   the two seams (person/personId, tenant scoping) every domain question eventually touches.
2. Ask: does the new concept map onto an EXISTING tier, work-item kind, or status, or a
   configurable extension of one (a new `NodeKind` string, a new status in the policy)? Most
   "new entity" requests turn out to be this.
3. If it's genuinely new, name what invariant it must inherit (tenant scoping, actor
   attribution, RLS) — nothing in this domain is exempt from those regardless of how new it is.
4. Hand off: work-item placement → `axiomate-work-model`; effort/complexity → `axiomate-estimation`;
   people/capacity → `axiomate-project-allocation`/`axiomate-capacity-planning`.

## Two corrections worth internalizing before anything else

- **"Outcome" is real, but it's a hierarchy TIER** (between `project` and `module` in the
  default chain), not a work-item type sitting between Project and Issue. Don't build a
  work-item concept named Outcome — it already means something else.
- **"Story" and "Bug" do not exist anywhere in the schema or types.** The real work-item kinds
  are `issue` and `activity`, with `isMilestone` as a boolean flag on `activity`, not a third
  kind. See `axiomate-work-model` for the full, corrected model.

## Full reference

`references/domain-model.md` — tier chain, work-item kinds, `canParent` law, status/transition
model, tenancy and attribution invariants, the person/personId seam.
