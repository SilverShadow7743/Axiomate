---
name: axiomate-work-assignment
description: This skill should be used when a feature determines WHO executes a specific issue or activity in Axiomate TMS — distinct from project allocation (capacity) or project membership (access). It supplies the real responsibility-types model (setAssignment) so work assignment is never collapsed into Allocation or ProjectMember. Load alongside axiomate-project-allocation, which owns the other two resource layers.
---

# Axiomate Work Assignment

**Assignment ≠ Allocation ≠ ProjectMember.** This skill owns exactly one of the four resource
layers documented in `axiomate-project-allocation`'s `resource-model.md` — the one that answers
"who executes THIS issue," not "who has capacity on this project" or "who may see this
project." A person can be 50% allocated to a project, hold a `ProjectMember` role on it, and
still have zero, one, or many issue assignments underneath — none of these three facts implies
either of the others.

## The real model

Not a dedicated database model — assignment rides on the **configurable responsibility-types
system**, editable in Configuration → Responsibilities:

- Each responsibility type carries **cardinality** (how many people can hold it on one issue),
  **requiredness** (must it be filled before the issue can progress), and **role-eligibility**
  (which roles may be assigned this responsibility).
- Reducer: `setAssignment`, read via `readAssignment`, wired through `IssueWorkspace.tsx`'s
  `onSetAssignment`.
- Built-in responsibility types have dedicated columns (owner, accountable, raised-by, per
  `axiomate-domain-analysis`'s label-resolution convention — the labels are configurable
  terminology, the underlying keys are stable); anything configured beyond those three lives
  in the generic custom-responsibilities list, not a bespoke field.

## What this skill determines for a new assignment need

1. **Is this really assignment, or allocation/access?** If the question is "does this person
   have TIME for this," that's `axiomate-capacity-planning`. If it's "can this person even SEE
   this project," that's `ProjectMember` (`axiomate-project-allocation`). Only "who is
   responsible for doing this specific issue" belongs here.
2. **Does it need a new responsibility type, or does an existing one fit?** Check the
   Configuration → Responsibilities list before proposing a new type — most assignment needs
   are a role-eligibility question on an existing type, not a new type.
3. **Cardinality and requiredness are domain decisions, not code decisions** — they're
   configured per tenant, so a feature built here must read them, never hardcode "exactly one
   owner" or "always required."
4. **Attribution** — an assignment change is a write like any other; it names its actor
   (`axiomate-domain-analysis`'s attribution invariant), and shows up in the issue's history the
   same way a status change or field edit does.

## Handoff

Capacity feasibility of an assignment → `axiomate-capacity-planning`. Whether the assignee has
project-level access to see what they're assigned → `axiomate-project-allocation`'s
`ProjectMember` layer (an assignment without matching project access is a real, checkable
inconsistency worth flagging in review).
