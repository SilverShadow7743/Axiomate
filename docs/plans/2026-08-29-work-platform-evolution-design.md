# Evolving Axiomate into the Unified Work Operating Platform

## What this is

The product owner's vision document (2026-08-29) describes a unified work operating platform:
communication + scheduling + execution + time + availability + delivery intelligence, with one
central thesis — *every important conversation can become accountable work, every piece of work
can be scheduled, every scheduled activity can be measured, and the system continuously connects
actual execution back to the outcome.*

This design maps that vision onto the live Axiomate TMS codebase and commits to an evolution
path. Settled with the user during the design conversation, each through an explicit choice:

1. **Deliverable**: evolve Axiomate toward the vision (not greenfield, not spec-first).
2. **Hierarchy mapping**: "Mapping B" — Outcome is a genuinely new tier; Process Area leaves the
   container chain and becomes Classification. Issue → Work, Activity → Task, time moves to Task.
3. **Container prefix**: configurable per organization, above an invariant execution core.
4. **Commercial aim**: multi-tenant commercial product; Axiocloud is tenant #1 and the proving
   ground.
5. **Approach**: strangler evolution in place — stepwise structural migrations on the live
   product, never a parallel rewrite.
6. **Outcome strictness**: optional during transition, org-tightens later.
7. **Leave scope**: minimal — dated absence + approval + privacy, existing only to feed
   Availability. No balances, accruals, or entitlement policy. Not an HRIS.

## The target domain model

One **invariant execution core**, identical for every organization:

    Project → Outcome → Work → Task → TimeEntry

with the vision's own definitions: Outcome = result, Work = commitment, Task = execution,
Time = actual effort.

Above Project, a **configurable structural prefix**. Today's hardcoded
`NODE_KINDS = ['company', 'client', 'engagement', 'project', 'module']` (`lib/types.ts:31`)
is replaced by per-organization *tier definitions* — name, order, semantic flags. The flag that
carries the most machinery is `externalParty: true`: setting it on a tier activates the client
boundary as a structural guarantee — the visibility boundary (`lib/clientBoundary.ts`),
client-visible flags on work, the reply-to-client flow, client packs, and per-client intake
routing all key off it. Axiocloud's tenant migrates to
`Company → Client(externalParty) → Engagement → Project` with unchanged behavior; a flat
internal organization configures no prefix at all and gets the vision's literal
`Organization → Project`.

**Process Area is extracted, not deleted.** It becomes the first Classification dimension — a
label on Work rather than a container above it — joining work types and disciplines, which are
already classification-shaped in the operating model. This matches the vision's own Domain 3
("Classification: organization taxonomy + project sets") being separate from the Outcome
hierarchy, and avoids the semantic pun of calling a taxonomy bucket a "result".

**Outcome is optional during transition.** Work may attach directly to a Project until an
organization flips "outcomes required". The alternative — minting a default Outcome per project
during migration — would put taxonomy in a result's clothing over 250+ live records whose real
outcomes nobody has yet defined, which is exactly what Mapping B was chosen to avoid.

**Tasks absorb Activities.** The existing lifecycle activities (Investigation, Root Cause
Analysis, Corrective Action, Verification, Milestone) become task templates — the vision's own
MVP-1 "work templates" — rather than a fixed vocabulary. Task carries owner, entered progress,
entered status; no estimate, per the vision's derived-data table.

## The derived-data contract

Adopted exactly as the vision's section 15 states it — estimates entered at Work, actuals
summed upward, progress rolled up, status/forecast/risk derived — with **one transitional
amendment**: every existing `TimeEntry` attaches at Work level (`TimeEntry.issueId`,
`lib/time.ts:53`) and is attested history that is never rewritten. New entries attach to Tasks.
During transition:

    Work.actual = Σ(task-level time) + Σ(legacy work-level time)

documented and visible, decaying naturally to the pure model as new work accrues. This follows
the principle already established in this codebase's own incident history: attested hours are
not something a migration rewrites.

## Architecture shifts

Two, stated plainly because the current architecture has already strained against both:

**New domains are server-queried from day one.** Today the whole workspace ships to the browser
at boot and the reducer runs client-side. That architecture produced two hard lessons in
production already (payload redaction done field-by-field, and the silent fallback-to-localStorage
incident). Chat, meetings, leave, and availability are never added to the boot payload; they are
served by their own queries against the server. The existing workspace migrates off the
boot-shipped architecture incrementally, domain by domain — never as a rewrite.

**Availability is derived, never stored.**

    working pattern − leave − meetings − allocation = availability

computed at read time by one engine that scheduling, forecasting, and capacity all consult. This
is how the vision's "don't silently change plans" principle becomes structural: a conflict is a
query result surfaced to a person, not a background mutation.

## Gap map (the vision's ten domains against the codebase)

**Largely exist** — Identity & Organization (operating model, roles, `can()`; gap: Teams).
Projects & Work (after the restructure above). Classification (an extraction, not an invention).
Collaboration (rich-doc notes, evidence/documents, history). Reporting & Administration
(exports, client packs, portfolio, configuration screens).

**Partial** — Communication: inbound mail creating work items and outbound reply-to-client both
run in production today; chat and threading are absent. Scheduling: My calendar, personal
events, and allocation exist; meetings and the availability engine are absent. Time & Leave:
timesheets, approval, the self-approval refusal, and the submitted-week freeze exist; leave is
absent. Delivery Intelligence: schedule health, critical path, and SLA date proposals exist;
true availability-aware forecasting is absent. Resource: allocations, working patterns, and
rates exist; the capacity engine is absent.

**Genuinely new** — the Outcome tier, Task-level time, Teams, Leave, the Availability engine,
Chat, Meetings, forecast-to-target-date, and the AI layer.

## Evolution sequence

- **E0 — Domain restructure.** Tier definitions with `externalParty`, the Outcome tier,
  Classification extraction, Task-level time. The enabling migration everything else builds on;
  the only phase this design commits in implementation depth.
- **E1 — Availability & forecast.** Minimal Leave, working calendars, Availability v1,
  Forecast v1 ("can this land by the target date, given who is actually available").
- **E2 — Personal workspace completion.** Leave requests and approval in My-surfaces; email
  notifications. (My work, My time, My calendar already exist.)
- **E3 — Communication.** Chat MVP (1:1, group, project, work-linked); mail threading deepened.
  Communication attaches to a Work Context; it does not bypass governance — the intake pipeline's
  existing refusal model generalizes.
- **E4 — Scheduling intelligence.** Meetings, calendar/task/dependency/leave joined through the
  availability engine.
- **E5 — AI.** Conversation→work suggestion, delivery-risk narration. Revisits the engine
  decision; the command-palette groundwork and the dormant Claude path in `app/api/chat/route.ts`
  both carry forward as the substrate.

Each phase ships to production under the standing discipline (typecheck, scenario suite, build,
clean-room deploy, live verification) before the next begins — the strangler posture.

## Privacy

The vision's privacy architecture is the codebase's existing posture, extended. Rates are
already withheld server-side from readers without `rate.view`; My calendar is already private to
its person. Leave follows the same pattern at the service layer: leave *dates* visible to
project managers because they move availability; leave *reasons* private, enforced where the
payload is built, never merely hidden in the UI.

## Non-goals

Per the vision's own section 13, unchanged: no HRIS (leave is availability-only), no ERP, no
SMTP/email infrastructure (integrate providers), no video-conferencing infrastructure, no
resource optimization beyond the data model, no AI that creates or modifies work without a
person applying it — the proposal-card contract already in force for the assistant is the
template for every future automation.

## What would send this design back

- If tier definitions cannot carry the client boundary as a flag — i.e. some client-boundary
  machinery turns out to depend structurally on *which* tier is the client tier, not merely
  that one exists — the configurable prefix collapses back into the hardcoded-tiers question.
  Surfaces in E0, while modeling tier definitions against `clientBoundary.ts`.
- If the transitional actuals rule (task time + legacy work time) proves misleading in real
  reports — double-counting risk when legacy entries are later re-keyed, or a Work whose
  actuals visibly disagree with its tasks' sum — the time migration needs a different shape
  than "leave history in place". Surfaces in E0's migration design.
- If optional-Outcome produces a workspace where nobody ever creates an Outcome — the tier
  exists but the product's central noun goes unused — the strictness default was wrong, and the
  fix is product (defaults, templates, prompts at project creation), not more schema. Surfaces
  in E1–E2 usage, measurable by the vision's own adoption KPIs.
