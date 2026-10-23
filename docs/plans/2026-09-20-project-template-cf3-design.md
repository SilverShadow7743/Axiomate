# CF3 — a complete project template: design

Validation finding CF3: "A project is created from a template … stops at everything the template
does not carry." Coverage Roadmap Tier 6: needed a spec from the user before this could become a
bounded fix. The user supplied one directly — reproduced in full below the analysis, since it's
the source of everything downstream.

**This document proposes an architecture and names the open decisions. It does not implement
anything.** The scope is larger than any single fix this session has shipped, and it converges on
work already in progress elsewhere in this codebase — see §3.

## 1. Three things already called "template," none of them what CF3 means

Reading the code before proposing anything new turned up three distinct, non-overlapping
mechanisms, which is worth naming precisely because a fourth, uncoordinated one would make this
worse, not better:

| Name | Where | What it actually does |
| --- | --- | --- |
| `ProjectTemplate` (`model.templates`, `adoptTemplate`) | `lib/config.ts` | A bundle of **agents and workflows** a project can turn on, plus one approval default. Client-scoped. This is what CF3's own scenario exercises — and its scope (automation defaults, not structure) is correct as built. It was never meant to create work items. |
| `ActivityTemplate` | `lib/config.ts` | A named **phase sequence for one issue's lifecycle** (e.g. Investigation → RCA → Corrective Action → Verification → Closure), with phase weights `buildLifecycle` uses for scheduling. |
| `IssueTemplate` | `lib/config.ts` | **Defaults and a starting checklist for creating one issue** — type, severity, which `ActivityTemplate` to attach, a checklist recorded as real rows. |
| `Blueprint` (`lib/commercial/blueprint.ts`) | `extractBlueprint` / `applyBlueprint` | **Structural.** Derives a reusable shape from a real engagement's `project`/`module`/`issue` subtree (offsets from one anchor date, never absolute dates), and applies it under a new target — creating real records, not just defaults. Deliberately excludes owners, statuses and anything commercial, by explicit design comment. |

**CF3's actual gap is that none of these four creates a project's structural scaffolding at the
point a project is created.** `Blueprint` is closest to what the user described, but it operates
on an already-existing subtree (extract-then-apply), it doesn't run at project-creation time, and
it doesn't touch the `outcome` tier or milestones at all (its `BlueprintEntry.kind` is
`'project' | 'module' | 'issue'` — no `'outcome'`, no milestone concept).

## 2. The user's hierarchy already exists — checked, not assumed

The user's principle: **Project → Outcome → Deliverable → Work Item**, with a template that
"should not become a giant 'project master record.' It should establish the project and
automatically instantiate the required child structures."

`lib/types.ts`'s `NODE_KINDS` — the one place the tier vocabulary is declared —
is `['company', 'client', 'engagement', 'project', 'outcome', 'module']`. **`outcome` already
exists as a tier directly beneath `project`.** `module` is the tier beneath that, and in the live
production tenant checked this session it's configured with the display label "Process Area" —
tier labels are per-organisation configuration (`tiersOf`, `lib/config.ts`), not fixed strings, so
whether `module` should be relabeled "Deliverable" for this org, or a new tier added, is a
terminology decision, not a schema one. **Work Item = `issue`**, the existing leaf kind.

This means the user's hierarchy maps onto the *existing* structural vocabulary almost exactly:

```
project → outcome → module ("Deliverable") → issue ("Work Item")
```

No new tier needs inventing. What's missing is a template mechanism that *populates* this shape
at creation time, and extends to the two structural pieces `Blueprint` doesn't currently reach:
`outcome` nodes, and milestones.

## 3. The project-level field list — checked against what's deliberately excluded, not silently missing

The user's Project-level field list (Project ID, Customer/Account, SOW reference, Commercial
owner, baseline effort/budget, billing model, governance cadence, risk/escalation level, …) maps
almost entirely onto fields `Blueprint`'s own design comment says are **deliberately absent** from
a reusable template: "owners (people are per-engagement — a name baked in here is the
identity-join failure waiting to recur), statuses …, and anything commercial."

That reasoning is sound and this design doesn't propose overriding it for the *structural*
template. The resolution isn't to cram commercial/administrative fields into `Blueprint` — it's to
recognise that the user's field list splits into two different questions:

- **What shape does this project have** (Outcomes, Deliverables, Work Items, Milestones,
  dependencies) — `Blueprint`'s job, extended per §4.
- **What is this specific engagement's commercial and administrative context** (SOW reference,
  commercial owner, budget, billing model) — already modeled, per-engagement, on `Engagement` and
  `Sow` (see `CommercialPanel`, built and fixed earlier this session). A template doesn't
  populate these; a person does, once, when the engagement itself is set up — exactly the
  boundary `Blueprint`'s design comment already drew, now confirmed against the user's own list
  rather than assumed correct.

The user's child-record list splits the same way. **Structural** (Blueprint's domain, extended):
Outcomes, Deliverables, Work Items, Milestones, Dependencies. **Already real, per-engagement, and
correctly not template-populated**: Project Team/Roles (allocations are people-specific, the same
reasoning `Blueprint` already applies to issue owners), Baseline/Commercial records, Risks,
Change Requests, Approvals, Timesheets/Actuals — each already has its own model and reducer arm,
none should be conjured from a template. **Not yet modeled anywhere, structural or not**: Project
Documents, Communications/Decisions as first-class records (evidence/notes exist per-issue, not
yet at the project level) — a real gap, but a separate one from CF3, not addressed here.

## 4. Proposed direction (for review, not committed)

1. **Extend `BlueprintEntry.kind` to include `'outcome'`.** Structural, additive, matches the
   existing pattern exactly — `extractBlueprint` already walks the tree; teaching it to include
   `outcome`-kind nodes is the same class of change as the `project`/`module`/`issue` case it
   already handles.
2. **Add a milestone shape to `Blueprint`**, parallel to `BlueprintEntry` — currently absent
   entirely. Milestones carry a planned date, which fits the existing offset-from-anchor pattern
   cleanly (`startOffset`/`endOffset` already exist for exactly this reason).
3. **Wire `adoptTemplate` (the `ProjectTemplate` config action) to optionally reference a
   `Blueprint` id.** Adopting a `ProjectTemplate` still sets agent/workflow defaults exactly as
   today (CF3's current PARTIAL behaviour is correct for what it does); if the template also names
   a blueprint, `applyBlueprint` runs against the new project in the same action. This keeps the
   two systems' existing, correct responsibilities intact — governance defaults stay
   `ProjectTemplate`'s job, structure stays `Blueprint`'s — rather than merging them into one
   wider, harder-to-reason-about mechanism.
4. **Do not build a structural template for Documents/Communications** (§3's genuine gap) as part
   of this — it's a different, currently-unmodeled concept and deserves its own design, not a
   rider on this one.

## Open decisions, for the user

- Does `module`'s default label change to "Deliverable" for this deployment (a Terminology
  configuration change, `Configuration → Terminology`), or does the existing "Process Area"/
  whatever-it-is-today label stay, with "Deliverable" understood as this session's own gloss on
  it rather than a UI change?
- Is linking one `ProjectTemplate` to one `Blueprint` (§4.3) the right relationship, or should a
  `ProjectTemplate` name several blueprints for different project types?
- Priority relative to the other unbuilt Tier 6 items (N, the SOP runbooks, browser test
  coverage) — this is comparable in size to N, larger than anything shipped this session.

## Testing, once a direction is chosen

`Blueprint` already has scenario coverage for the extract/apply round-trip (not itemized here —
see `scripts/scenario-validation.ts`'s existing blueprint scenarios). Extending `BlueprintEntry`
to `outcome` and adding milestones would extend those same scenarios, not replace them. CF3 itself
would move from PARTIAL to PASS once `adoptTemplate` can be shown creating real structure, with a
new scenario proving the combined action, not a hand check.
