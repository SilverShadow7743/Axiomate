# Issue and activity templates — the largest gap G1 named, made concrete

*7 September 2026. A design, not an increment — G1 in `docs/pending-actions.md` names this the
largest single gap, clearest payback: "Every engagement's skeleton is rebuilt from memory — which
is how the register grew 48 duplicate points." This settles what an issue template and an
activity template actually are, against what already exists rather than starting from nothing.*

## What already exists, and why it isn't a template

Two mechanisms already do part of this job, and neither is configurable — which is the actual
gap, not the absence of structure entirely.

**`buildLifecycle`** (`lib/workspace.ts:3378-3445`) generates a fixed five-phase sequence —
Investigation (25%) → Root Cause Analysis (20%) → Corrective Action (35%) → Verification (20%) →
Closure (milestone) — for *any* issue, from a hardcoded `ACTIVITY_PHASES` array and a hardcoded
`weights` map. It is a real activity template, just one, applied the same way regardless of
module, discipline or work type. This is why pending-actions.md's own framing ("an activity has
none at all") slightly overstates it — the gap is that there is exactly one, not zero.

**`ProjectTemplate`** (`lib/config.ts:592-604`) — a bundle a project adopts, `agentIds`/
`workflowIds`/`requireApproval`, applied via `adoptTemplate` (`lib/workspace.ts:8411-8437`). Pure
automation configuration: it turns agents on and decides who signs off. It creates nothing —
no issue, no activity, no field.

So today: a project template configures behaviour, and one fixed activity lifecycle configures
timing. Nothing configures *content* — what fields an issue of a given kind starts with, or which
of several possible phase sequences applies to it.

## What this design adds

### `ActivityTemplate` — a named phase sequence, replacing the one hardcoded one

```ts
export interface ActivityTemplate {
  id: string
  name: string
  /** e.g. ['Investigation', 'Root Cause Analysis', 'Corrective Action', 'Verification', 'Closure'] */
  phases: string[]
  /** Same shape buildLifecycle already computes from — must sum to 1. */
  weights: Record<string, number>
  /** Which phase, if any, is the closing milestone. */
  milestonePhase: string | null
}
```

`buildLifecycle`'s current `ACTIVITY_PHASES`/`weights` constants become the shipped default
template (`id: 'standard-corrective-action'`), not a special case — every other phase sequence a
firm wants (a Configuration issue's phases look nothing like a Defect's) is the same shape.
`buildLifecycle`'s action gains an optional `templateId`, defaulting to whichever template the
issue's `discipline` (the new field D2 in this same backlog recommends) or `module` resolves to,
falling back to the shipped default when nothing resolves.

### `IssueTemplate` — default field values, not automatic creation

```ts
export interface IssueTemplate {
  id: string
  name: string
  /** Which module/discipline this applies to, for the create-form's own suggestion — not enforced */
  appliesTo: { module?: string; discipline?: string }
  defaults: {
    type?: WorkType
    priority?: Priority
    activityTemplateId?: string
  }
  /** Checklist shown on create, recorded as IssueNote items — not a separate entity. Deliberately
      thin: content that needs its own lifecycle (approval, assignment) is a real Issue, not a
      checklist row pretending to be one. */
  checklist?: string[]
}
```

Deliberately **not** a scaffold that spawns child issues or activities directly on creation —
that's `buildLifecycle`'s job, invoked explicitly, and folding it into template adoption would
make "create an issue" silently also decide its own schedule, which is a bigger behavioural
change than a template should carry on its own. An `IssueTemplate` pre-fills the create form
(`defaults`) and, if it names an `activityTemplateId`, offers "Build the standard lifecycle" as a
one-click follow-up — the same `buildLifecycle` action a person can already invoke by hand, not a
new code path.

### Where these live

Same place `ProjectTemplate` already lives — the `OperatingModel` JSON blob
(`prisma/schema.prisma`'s `OperatingModel.model`), via new `activityTemplates`/`issueTemplates`
maps alongside the existing `templates` map. No new Prisma model, no migration — this follows the
existing pattern rather than introducing a second storage mechanism for template-shaped things.

## What this does not do

Auto-apply a template without a person choosing one (every create stays a choice, per the
`ProjectTemplate` precedent — `adoptTemplate` is also explicit, never inferred). Retrofit
existing issues — a template changes what happens next, not what a duplicate-checking sweep does
to the 48 points already in the register. Module-level or client-level default templates (a
sensible follow-on, once it's clear which templates get reused across engagements rather than
being written once per project).

## What would send this back

- If most firms end up with one template per project rather than a handful reused across many —
  the reuse this design assumes doesn't hold, and a lighter "just remember the last five fields
  I typed" mechanism would serve better than a named, administered template object.
- If `buildLifecycle`'s weight-based scheduling doesn't generalise past corrective-action work
  (a Configuration issue's phases may not want percentage-of-SLA-days timing at all) — surfaces
  the first time a non-defect template is actually built against this shape.
