# Reconciling the twelve pillars and the twelve suites

*Recorded 2026-09-06, the task named as "Now" in `docs/strategy/axiomate-roadmap.md`.
`axiomate-vision.md`'s twelve pillars (31 Aug, capability-level, honest about what's real vs.
AI-blocked) and `axiomate-product-blueprint.md`'s twelve suites (6 Sep, screen-level target
state) were produced independently and don't line up one-to-one. This maps them and names where
they genuinely disagree, rather than forcing a clean grid where none exists.*

## The mapping

| Pillar (vision) | Suite(s) (blueprint) | Fit |
|---|---|---|
| 4. Work Management | Delivery Suite | Clean 1:1. Already the most-built pillar/suite pair — Issue/Project/Workstream/Action *is* the reducer today. |
| 10. Workforce Intelligence | People Suite | Clean 1:1. |
| 12. Governance | Governance Suite | Clean 1:1, including the AI/Agent governance screens (GOV-005/006) the pillar's own "agent scopes, explainability" language already anticipated. |
| 7. Automation | Automation Suite (AUT-001/002/003) | Clean. |
| 6. Execution (humans + AI agents jointly) | Delivery Suite (human half) + Automation Suite (AUT-004/005, agent half) | One pillar, two suites — sensible split, not a conflict. |
| 8. Risk Intelligence | Intelligence Suite (INT-003) + Engagement Suite (ENG-006) + Delivery Suite (DLV-016) | One pillar, three suites. This is the pillar with the most real, shipped substance already (`lib/watch.ts`'s six conditions, Project Pulse's capacity concern) — the blueprint scatters it rather than naming it as one capability. |
| 5. Planning | People Suite (PPL-005/006) + Delivery Suite (Gantt/Timeline) | Split, reasonable — allocation data is real (`Allocation`, `availabilityFor()`), the AI-planning half is new. |
| 9. Organizational Memory | Knowledge Suite (KNW-005/006) + Engagement Suite (ENG-007) | Matches the roadmap's "Next" placement — decisions/commitments already exist as concepts (`RaidKind`, `ChangeRequest`), making them queryable is structural, not AI-blocked. |
| 2. Context Graph | Not a suite — it's AXS-005 (Universal Entity View) plus §13/§14 of the blueprint (the cross-suite entity model and cross-suite intelligence chain) | Correctly *not* suite-shaped in the blueprint. This is connective architecture underneath every suite, not a screen anyone opens. Flagged as structurally hardest in both documents independently — that agreement is worth taking seriously. |
| 1. Work Capture | Not a suite — feeds Command Suite's Attention Center, Growth Suite's opportunity intake, Client Suite's communications | Same as pillar 2: correctly absent as its own suite, present as a cross-cutting feed. |
| 11. Business Operations | **Split across three suites**: Client Suite, Engagement Suite, Finance Suite | See finding 1 below — this is the mapping's biggest structural mismatch. |
| 3. Work Intelligence | Intelligence Suite (INT-002/003/004) — **partially** | See finding 2 below — the hardest half of this pillar has no suite at all. |

**Blueprint suites with no pillar ancestor:** Growth Suite, Application Suite, Command Suite
(Command is the presentation layer for pillars 3/4/8 per-persona — reasonable as UI, not a new
capability). Growth and Application are genuinely new scope the 31 August synthesis never
named. See findings 3 and 4.

## Finding 1 — "Business Operations" was one pillar; the blueprint made it three suites

`axiomate-vision.md` treats customers, scope, approvals, delivery, and external collaboration as
one pillar. The blueprint gives customer relationship its own suite (Client), delivery/contract
governance its own suite (Engagement), and money its own suite (Finance). This isn't wrong — the
blueprint is more granular by design — but it means a roadmap that tracks "pillar 11 progress"
and a roadmap that tracks "Client/Engagement/Finance suite progress" will disagree about how much
is done unless someone keeps them synchronized. **Recommendation:** when planning work in this
area, track it as one backlog stream (pillar 11) with three UI surfaces, not three independent
backlogs — the external-collaboration piece in particular (the client-scoped guest role,
`PERSON_85`) is genuinely one capability that Client Suite, Engagement Suite, and even the
Growth Suite's customer-facing proposal flow would all draw on.

## Finding 2 — the blueprint's Intelligence Suite doesn't cover pillar 3's hardest half

Pillar 3, Work Intelligence, is "understand requests, commitments, decisions, requirements,
risks" — and `axiomate-vision.md`'s MVP slice B names the hard part precisely: detecting these
*from unstructured signal* (an email, a meeting note), which is genuinely generative and the one
thing blocked on Anthropic API credits (task #113). Reading the blueprint's Intelligence Suite
screens (INT-001 through INT-008) closely: every one of them assumes the structured facts already
exist and reasons *over* them — Risk Intelligence reads project data, Decision Intelligence
compares named options, Predictive Intelligence forecasts from existing metrics. None of them is
"turn this paragraph of email into a Commitment record." **This means building the entire
Intelligence Suite as specified would not, by itself, close the MVP's most-blocked and
highest-differentiation gap.** That capture-and-understand layer needs to be named as its own
piece of work — closest to a new screen or background process under Command Suite's Work Capture
feed, not under Intelligence — when credits exist and this is picked up.

## Finding 3 — Growth Suite has no pillar ancestor, and raises a build-vs-buy question

Nothing in the 31 August synthesis describes Axiomate needing its own opportunity/pipeline/
contract layer — pillar 11 talks about *managing* customers and scope, not running a sales
process. The blueprint's Growth Suite (GRT-001 through GRT-007) is, in substance, a CRM: pipeline,
opportunity workspace, qualification scoring, proposal and contract workflow. Worth naming
plainly, per this repository's own operating principle to prefer standard functionality before
customization (`CLAUDE.md`'s operating principles, and directly: `office-axiomate/CLAUDE.md`
states **"Business Central and D365 Sales are not core capabilities"** for Axiocloud as of
2026-08-13). Building a bespoke CRM suite inside Axiomate is a real alternative to buying or
using an existing CRM for Axiocloud's own sales process — and that's a build-vs-buy decision for
the business, not something to default into because it appeared in a product blueprint. This
needs an explicit answer before Growth Suite enters any roadmap horizon above "Someday."

## Finding 4 — Application Suite also has no pillar ancestor, but maps more comfortably

Unlike Growth Suite, Application Suite (enterprise application landscape, integration health,
technical-to-business-impact translation) reads as a natural extension of pillar 11's "delivery"
facet and pillar 9's "organizational memory" — tracking what was actually implemented for a
client and its operational health is closer to a delivery/knowledge artifact than to new business
scope. It's still new domain modelling (no `Application`/`Integration` entities exist in
`prisma/schema.prisma` today), but it doesn't raise the same "are we building something we
should buy" question Growth Suite does.

## What this changes in the roadmap

- `docs/strategy/axiomate-roadmap.md`'s "Someday" horizon should treat Growth Suite as blocked on
  a business decision (build vs. buy), not just an architecture pass — a stronger gate than the
  other "Someday" items.
- Pillar 3's capture-and-understand layer should be tracked as its own line in "Later" (blocked
  on AI credits), explicitly not assumed to be delivered by "the Intelligence Suite" as a whole.
- Client/Engagement/Finance suite work should be planned as one pillar-11 stream to avoid
  double-counting or losing the shared external-collaboration capability underneath all three.
