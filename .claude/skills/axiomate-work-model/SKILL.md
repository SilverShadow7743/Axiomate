---
name: axiomate-work-model
description: This skill should be used when deciding how a piece of work should be represented in Axiomate TMS — what kind it is, where it belongs in the hierarchy, and its parent/child rules. It supplies the real, corrected work model (issue/activity, not Story/Task/Bug) so new work items are placed using canParent's actual law rather than invented categories. Load alongside axiomate-domain-analysis.
---

# Axiomate Work Model

**There is no Story, Bug, or standalone Task model.** The real work-item vocabulary is `issue`
and `activity` (with `isMilestone` as a flag on activity, not a third kind). This correction
matters enough to lead with — building a feature around "Story" or "Bug" as if they were real
kinds will not compile against anything, because nothing in the codebase names them.

## The real model

```
HierarchyNode (configurable tier chain — default: company → client → engagement
               → project → outcome → module; "outcome" is a TIER, not a work item)
       ↓
     Issue (the primary work item — can also parent sub-issues via self-relation)
       ↓
  IssueActivity (task/phase-level; isMilestone: Boolean marks a milestone,
                 it is not a separate model or kind)
```

An `Issue` sits under a `HierarchyNode` OR a parent `Issue`, never both at once. Placement
between these is governed by `canParent(childKind, parentKind, tiers)` in `lib/workspace.ts` —
consult that function directly rather than reasoning about hierarchy from first principles; it
is the actual law, not a convention that happens to usually hold.

## What this skill determines for a new piece of work

1. **Kind** — `issue` (a deliverable, defect, or request) or `activity` (a step within an
   issue's lifecycle, optionally a milestone). There is no third option; if something doesn't
   fit either, that's a `axiomate-domain-analysis` question before it's a work-model question.
2. **Placement** — check `canParent` for what the chosen kind may sit under. `activity` only
   under `issue`; `milestone` (the flag) under `issue` or `activity`; `issue` under another
   `issue` or any configured tier.
3. **Lifecycle** — status comes from the configurable transition graph
   (`lib/statusPolicy.ts`'s `DEFAULT_STATUS_POLICY`, `allowedNext`), never a free-text field.
4. **Ownership/completion** — via the responsibility-types/assignment model
   (`axiomate-project-allocation`'s Assignment layer), not a bespoke owner field.

## Full reference

`references/domain-model.md` (shared with `axiomate-domain-analysis` — same document, this
skill's entry point is the work-item section specifically).
