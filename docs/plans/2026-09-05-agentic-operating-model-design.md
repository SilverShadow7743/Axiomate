# Multi-orchestra agentic operating model for Axiomate development

**Status: approved 2026-09-05** (ADR 0001, artifact ART-20260905-003, architect gate passed by the CEO in session). Design for how Axiomate is developed, validated and released by
a governed set of AI agents with the founder as the human in the loop. Written against what this
repository already does (`docs/continuous-development.md`) rather than against a blank page, and
deliberately smaller than the seven-orchestra, forty-agent structure it was asked to evaluate.
The plan that implements Phase 1 is `2026-09-05-agentic-operating-model-plan.md`. The decision
itself is recorded as `docs/adr/0001-agentic-operating-model.md`.

---

## Part 0 — Three things checked before designing

**The stack in the brief is not the stack being built.** The brief names ASP.NET Core MVC, .NET
and Azure DevOps. Three Axiomate codebases exist: `AxiomateV1` (C#, last pushed 4 March 2026,
dormant), `C:\Axiomate` (Next.js, the broader "AI-native platform" repo) and this one, Axiomate
TMS (Next.js 16, Prisma 7, Postgres, GitHub Actions, Azure App Service, 106 commits in the last
three weeks). This design targets the stack that is live. Everything in it is host-agnostic: where
it says "GitHub Actions environment gate" read "Azure DevOps environment approval" if V1 is
revived. What it does not do is design for a .NET codebase nobody is committing to.

**Most of the specialist agents already exist as skills.** Thirty-two `axiomate-*` skills, two
agents and one adversarial-review workflow are in `.claude/`. Requirement analysis, domain
analysis, solution architecture, API design, code review, security review, scenario testing,
release readiness, deviation diagnosis, technical debt and refactoring are all there. The gap is
not agents. The gap is that nothing sequences them with contracts, nothing records their outputs
in a form another agent can consume, and nothing states which of them may act versus recommend.
This design adds the orchestration layer and reuses the skills as the specialists.

**The human in every gate is the same person.** The founder dependency inventory in the
office-axiomate repo (5 Sep 2026) rates product deployment, alerts, Entra administration and
product development all as founder-only. An operating model whose four human gates are all held
by one person does not remove a bottleneck; it makes the bottleneck legible. That is still the
right first step, because a gate that is written down can be handed to someone else and a habit
cannot. The design names the gates by role, not by person, so the handover is a config change.

---

## Part 1 — Executive recommendation

**Build four orchestras, not seven, over the loop that already runs.**

```
                 ┌──────────────────────────────────────────────┐
                 │  INTENT          what should change, and why  │  product + architecture + UX
                 └──────────────────────┬───────────────────────┘
                                        │ Requirement Specification (approved)
                 ┌──────────────────────▼───────────────────────┐
                 │  BUILD           how, then the change itself  │  plan + implement + review
                 └──────────────────────┬───────────────────────┘
                                        │ Change Set
                 ┌──────────────────────▼───────────────────────┐
                 │  PROOF           is it correct, safe, whole   │  gates + scenarios + security
                 └──────────────────────┬───────────────────────┘
                                        │ Validation Result
                 ┌──────────────────────▼───────────────────────┐
                 │  RELEASE         ship it, watch it, learn     │  readiness + deploy + incidents
                 └──────────────────────┬───────────────────────┘
                                        │ Incident Report / regression → back to INTENT
```

Why four and not seven:

- **Product, Architecture and UX collapse into Intent.** They consume the same evidence (the
  domain model, the design docs, the scenario suite, the live data) and produce one thing: an
  approved statement of what should change. Three orchestras would mean three handoffs and three
  orchestrators for a product with one product owner. They stay distinct as *agents* inside
  Intent, with distinct outputs, which is where the separation earns its keep.
- **Quality and Security merge into Proof.** Security review is one gate among the gates. A
  separate security orchestra would approve nothing the Proof orchestra cannot, and would need
  the same change set and the same evidence.
- **DevOps and Operations merge into Release.** Deployment here is a pipeline, not an agent; what
  needs an orchestrator is the decision to release and what happens after. Incident analysis
  belongs beside release because the first question in any incident is "what shipped".
- **Continuous improvement is the loop, not an orchestra.** An incident report, a regression, a
  scenario that sits at PARTIAL for three cycles, a technical-debt finding: each becomes a
  Requirement Specification of kind `correction` or `debt` and enters Intent like any other
  request. Giving it its own orchestra would give it its own backlog, which is how debt gets
  ignored.

Twelve agents in total, of which three are not LLMs at all (the gate runner, the pipeline and the
scheduled pass). Nothing deploys except the pipeline. Nothing approves its own work. Four human
gates, all held by role.

---

## Part 2 — Orchestra map

```
INTENT ORCHESTRA ─── Intent Orchestrator (L2)
   ├── Requirement Analyst (L2)          skill: axiomate-requirement-analysis, -acceptance-criteria
   ├── Domain & Architecture Analyst (L2) skill: axiomate-domain-analysis, -solution-architecture,
   │                                             -work-model, -tenant-isolation, -data-integrity
   └── UX Placement Agent (L2)            agent: ui-ux-architect (exists)

BUILD ORCHESTRA ──── Build Orchestrator (L3)
   ├── Implementation Planner (L2)        skill: axiomate-delivery-planning, -api-design, -estimation
   ├── Implementer (L4, N in parallel)    skill: axiomate-feature-builder, -screen-builder,
   │                                             -ui-design, -refactoring (mode, not agent)
   └── Adversarial Reviewer (L1)          skill: axiomate-code-review; workflow: axiomate-tms-audits

PROOF ORCHESTRA ──── Proof Orchestrator (L1)
   ├── Gate Runner (L5, deterministic)    npm run audit:*, validate:scenarios, tsc — not an LLM
   ├── Scenario Author (L3)               skill: axiomate-scenario-testing
   ├── Security Reviewer (L1)             skill: axiomate-security-review, -tenant-isolation
   └── Deviation Diagnoser (L2)           skill: axiomate-deviation-diagnosis, lib/dataIntegrity.ts

RELEASE ORCHESTRA ── Release Orchestrator (L2)
   ├── Readiness Assessor (L2)            skill: axiomate-release-readiness
   ├── Deployment Pipeline (L5, deterministic)  .github/workflows/deploy.yml — not an LLM
   ├── Post-release Watcher (L1)          scheduled pass + Azure Monitor + health check
   └── Incident Analyst (L2)              skill: axiomate-deviation-diagnosis, -risk-management
```

L-numbers are the governance levels in Part 8.

---

## Part 3 — Agent catalogue

Conventions: **Level** is the governance level (Part 8). **Acts** means it changes files, branches
or environments; **Recommends** means it only produces artifacts. **Memory** names which shared
memory (Part 5) it reads and which it may write.

| Agent | Mission | Inputs | Outputs | Tools | Memory (reads → writes) | Level | Acts or recommends | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Intent Orchestrator** | Turn a request, incident or debt finding into an approved Requirement Specification, or reject it with a reason. | Business request, Incident Report, scenario-suite gap, debt finding | Requirement Specification (proposed), Risk Assessment | Read, Grep, Glob, Write (artifacts only) | Product, Architecture, Quality → Product (artifacts) | 2 | Recommends. Stops at the product-owner gate. | Its three analysts |
| Requirement Analyst | State the problem, scope, acceptance criteria and business rules in testable form; separate what was said from what is inferred. | Request text, prior artifacts, `docs/plans/*-design.md` | Requirement body (Given/When/Then criteria, rules, out-of-scope, open questions) | Read, Grep | Product → none | 2 | Recommends | none |
| Domain & Architecture Analyst | Map the requirement onto the real domain model; name affected modules, tenant-isolation and reducer-purity implications; draft an ADR if the design is open. | Requirement body, `lib/types.ts`, `lib/workspace.ts`, `prisma/schema.prisma`, ADRs | Impact section; Architecture Decision (proposed) when needed | Read, Grep, Glob | Architecture, Engineering → Architecture (ADR draft) | 2 | Recommends. Stops at the architect gate for any ADR. | Requirement Analyst |
| UX Placement Agent | Place the change in the existing information architecture; reuse patterns; justify any new one. | Requirement body, `docs/design/` | UX proposal section (screen, pattern, states) | Read, Grep, Glob | Product (design system) → none | 2 | Recommends | Requirement Analyst |
| **Build Orchestrator** | Turn an approved specification into a merged, reviewed change on a branch, through a plan whose every step is provable. | Approved Requirement Specification, approved ADR if any | Implementation Plan (proposed), Change Set | Read, Write, Edit, Bash (git branch, test commands), Workflow | Architecture, Engineering → Engineering (code, plan) | 3 | Acts on branches only. Never merges to `master`. | Planner, Implementers, Reviewer |
| Implementation Planner | Order the work by the house rule (pure logic → callers → storage → UI), name each step's verification command, declare file ownership per workstream, mark migrations and commit boundaries. | Approved specification, ADR, `docs/plans/*-plan.md` precedents | Implementation Plan | Read, Grep | Engineering, Architecture → none | 2 | Recommends. Stops at the engineering gate when the plan touches protected paths. | Domain & Architecture Analyst |
| Implementer | Execute one workstream of the plan in an isolated worktree, running the step's verification command before reporting done. | One workstream of an approved plan | Commits on a branch; self-validation record | Read, Write, Edit, Bash | Engineering (skills, CLAUDE.md) → Engineering (code) | 4 | Acts, within owned paths, gated by the step's command | Planner |
| Adversarial Reviewer | Find real defects in the change set and try to refute each one before reporting it; never report style. | Change Set diff, plan | Review findings (confirmed only) | Read, Grep, Bash (read-only) | Engineering, Quality → Quality (findings) | 1 | Observes | Implementer |
| **Proof Orchestrator** | Decide whether a change set is correct, safe and whole, from evidence that actually ran. | Change Set | Validation Result, Risk Assessment | Bash (gate commands), Read | Quality, Architecture → Quality (results) | 1 | Observes and records. Cannot alter the change set. | Gate Runner, Scenario Author, Security Reviewer |
| Gate Runner | Run the standing gate deterministically: `tsc --noEmit`, the five `audit:*` proofs, `validate:scenarios`, the regression comparison, `audit:contracts`. | Branch | Gate results with exit codes and logs | Bash | none → Quality (`data/validation.json`) | 5 | Acts autonomously; produces evidence only | none |
| Scenario Author | Add or extend scenarios so every acceptance criterion in the specification has a verdict in the suite; link each to its design. | Requirement Specification, `scripts/scenario-validation.ts` | Scenario code; coverage line per design | Read, Write, Edit, Bash | Quality, Product → Quality (scenarios) | 3 | Acts on the branch, test code only | Requirement Analyst |
| Security Reviewer | Check tenant isolation at both layers, actor attribution, secret handling, data exposure, and authorisation on every new route or reducer arm. | Change Set diff | Security findings by severity | Read, Grep | Architecture, Engineering → Quality (findings) | 1 | Observes. Stops the flow at the security gate on any high finding. | Implementer |
| Deviation Diagnoser | Compare observed behaviour (a report, a screenshot, an integrity audit, a regressed scenario) with the expected model and name the gap and its likely cause. | Observation, expected-model references | Diagnosis; Incident Report or correction Requirement | Read, Grep, Bash (read-only scripts) | Product, Quality, Operational → Operational (incident) | 2 | Recommends | none |
| **Release Orchestrator** | Decide whether the validated change is ready to ship, request the human release approval, and watch what happens after. | Validation Result, Risk Assessment, `wiki/resources/platform/release-readiness.md` | Release Decision (proposed), post-release check results | Read, Bash (health check) | Quality, Operational → Operational (release history) | 2 | Recommends. Stops at the release gate. | Readiness Assessor, Pipeline, Watcher |
| Readiness Assessor | Score readiness area by area against evidence that ran; update the readiness doc in place with a dated re-score. | Validation Result, readiness doc | Readiness verdict with prioritised blockers | Read, Edit | Quality, Operational → Operational (readiness doc) | 2 | Recommends | Proof Orchestrator |
| Deployment Pipeline | Build, migrate a throwaway database, run the persistence audit, run the suite, gate on regression, package, deploy to the slot, swap. | Push to `master` and the environment approval | Deployed release; run log | GitHub Actions | none → Operational (run history) | 5 | Acts autonomously once the human approves the environment | Human release approval |
| Post-release Watcher | Observe the daily scheduled pass, Azure Monitor alerts and the health-check body after every deploy; raise an Incident Report when anything deviates. | Alerts, pass results, health check | Incident Report (draft) | Bash (scripts), Read | Operational → Operational | 1 | Observes | Pipeline |
| Incident Analyst | From an Incident Report, establish root cause and produce a correction Requirement for Intent. | Incident Report | Root cause; Requirement Specification (kind: correction) | Read, Grep, Bash (read-only) | Operational, Engineering, Quality → Product (correction) | 2 | Recommends | Deviation Diagnoser |

Not in the catalogue, and why: a Build Agent, Pipeline Agent, Environment Validation Agent and
Rollback Agent are all jobs in `deploy.yml`, not reasoning agents. A Performance Test Agent is a
step in Proof once a performance baseline exists to compare against (there is one R4 measurement;
it needs a second before an agent has anything to do). A Technical Debt Agent is the existing
audit workflow run on a cadence, whose findings enter Intent as `debt` requirements. A Domain
Knowledge Agent is the shared memory itself.

---

## Part 4 — End-to-end lifecycle

The existing loop is `idea → design → plan → build → proof → gate → deploy`. The orchestras sit on
it rather than replacing it; the artifacts are what make each step consumable by the next agent.

```
 Request / Incident / Gap
        │
        ▼
 ┌─ INTENT ──────────────────────────────────────────────────────┐
 │ Requirement Analyst ─┐                                         │
 │ Domain & Arch Analyst ┼─ parallel ─► Intent Orchestrator       │
 │ UX Placement ────────┘              synthesises               │
 │                                      │                         │
 │            Requirement Specification (proposed)                │
 │            Risk Assessment (final)                             │
 │            Architecture Decision (proposed, if design is open) │
 └──────────────────────────────────────┬─────────────────────────┘
                                        ▼
                     ■ HUMAN GATE 1: product owner approves the specification
                     ■ HUMAN GATE 2: architect approves the ADR (only if one exists)
                                        │
 ┌─ BUILD ───────────────────────────────▼────────────────────────┐
 │ Implementation Planner ─► Implementation Plan (proposed)       │
 │        ■ HUMAN GATE 3 if the plan touches a protected path,    │
 │          a migration, security or tenancy; otherwise auto-approved │
 │ Implementers (one worktree per workstream, in parallel)        │
 │        each step: change → run verify command → next step      │
 │ Adversarial Reviewer ─► confirmed findings ─► Implementer fixes│
 │                                      │                         │
 │            Change Set (final) on branch feat/ART-…             │
 └──────────────────────────────────────┬─────────────────────────┘
                                        ▼
 ┌─ PROOF ────────────────────────────────────────────────────────┐
 │ Gate Runner: tsc, audits, scenarios, regression, contracts     │
 │ Scenario Author: every acceptance criterion has a verdict      │
 │ Security Reviewer ─► high finding? ■ HUMAN GATE 4 (security)   │
 │                                      │                         │
 │            Validation Result (final): pass | conditional | fail│
 └──────────────────────────────────────┬─────────────────────────┘
                                        ▼
 ┌─ RELEASE ──────────────────────────────────────────────────────┐
 │ Readiness Assessor ─► Release Decision (proposed)              │
 │        ■ HUMAN GATE 5: release approval (GitHub environment)   │
 │ Deployment Pipeline: migrate → persistence audit → suite →     │
 │        regression gate → build → slot → swap                   │
 │ Post-release Watcher: health body, scheduled pass, alerts      │
 │        deviation? ─► Incident Report ─► Incident Analyst       │
 │                       ─► correction Requirement ─► INTENT      │
 └────────────────────────────────────────────────────────────────┘
```

**What changed from the workflow in the brief.** Requirement validation and architecture impact
run in parallel, not in sequence, because they read the same request and disagree rarely; when
they do, the Intent Orchestrator surfaces it rather than serialising every request to avoid it.
The human approval sits *before* engineering plans, not after UX, because a plan built on an
unapproved specification is wasted work. Code review is adversarial and precedes Proof, so Proof
never spends gate time on a change the reviewer would have bounced. Security review is inside
Proof rather than a separate late step. Regression analysis is the pipeline's existing rule, "a
scenario that passed and no longer passes fails the run", not a separate agent.

**The low-risk path.** A change whose specification is of kind `correction` or `debt`, whose plan
touches no protected path and no migration, whose validation passes with no conditions and whose
risk assessment is `low` skips Gate 3 and, in Phase 2, may merge to `master` on the Proof result
alone. The release gate still stands: nothing reaches production without a person approving the
environment.

---

## Part 5 — Shared memory and knowledge architecture

The brief asks for five memories and asks where they live. They live in this repository, in
files, under git, because that is where every agent already reads and because git gives
versioning, attribution and diffing for free. A vector index is a retrieval accelerator on top,
added in Phase 3; it is never the source of truth.

| Memory | Lives in today | Written by | Read by | Staleness signal |
| --- | --- | --- | --- | --- |
| **Product** | `docs/plans/*-design.md` (vision, scope, rejected options), `docs/strategy/axiomate-vision.md`, `wiki/`, acceptance criteria inside `scripts/scenario-validation.ts`, `docs/artifacts/*.requirement-specification.json` | Intent Orchestrator (artifacts), the product owner (designs) | Every orchestra | `Status:` line on each design; a design with no scenario carrying `design:` is unproven |
| **Architecture** | `docs/adr/` (new), `docs/plans/*-design.md`, `CLAUDE.md` (resource model), `AGENTS.md`, `prisma/schema.prisma`, `lib/types.ts` | Domain & Architecture Analyst (ADR drafts), the architect (approval) | Build, Proof | An ADR older than the code it governs, detected by the quarterly reread rule |
| **Engineering** | `.claude/skills/axiomate-*`, `CLAUDE.md`, the code, `docs/plans/*-plan.md`, `docs/continuous-development.md` | Implementers (code), Planner (plans) | Build, Proof | A skill that names a file that no longer exists (checkable by grep) |
| **Quality** | `scripts/scenario-validation.ts` and `data/validation.json` (verdicts), `scripts/*-proof.ts`, `docs/verification-checklist.md`, `docs/artifacts/*.validation-result.json` | Gate Runner, Scenario Author, Proof Orchestrator | Release, Intent | `asAt` on `validation.json` older than the last commit |
| **Operational** | `docs/runtime-notes.md`, `docs/scheduled-pass.md`, `docs/deployment.md`, `docs/secrets.md`, `wiki/resources/platform/release-readiness.md`, `docs/artifacts/*.release-decision.json`, `*.incident-report.json`, Azure Monitor | Release Orchestrator, Watcher, Incident Analyst | Intent, Release | Readiness doc's dated re-score callout; a secret's recorded expiry |

**Retrieval.** Phase 1 and 2: grep and read, which is what the skills do now and what a
repository this size supports. Phase 3: Azure AI Search over `docs/`, `wiki/`, `.claude/skills/`
and artifact bodies, refreshed on push by a pipeline job. Retrieval returns file paths and line
ranges; the agent then reads the file. An agent never acts on an embedding.

**Update.** Agents write only the artifacts and files their catalogue row allows. Product memory
is written by Intent and the product owner; nobody else. Architecture memory is written by the
Analyst as a draft and becomes authoritative only when the architect approves the ADR. Quality
memory is written by the Gate Runner, which is deterministic, so a verdict is never an opinion.

**Conflict.** This repository already has the right rule, in `knowledge/delivery/delivery-
principles.md` of the sister repo: when recorded intent and built product disagree, *neither is
declared authoritative*; the conflict is listed with an owner. Artifacts carry that as a field:
a Validation Result that contradicts a Requirement Specification does not overwrite it, it
produces an Incident Report of source `scenario-regression` with both references, and Intent
decides which one was wrong.

**Staleness.** Every knowledge file carries a date (`Status:`, `last_verified`, `asAt`). The
contract checker fails an artifact whose trace points at a superseded artifact. The quarterly
reread of rejected options, already in the cadence, is the human half.

---

## Part 6 — Communication contracts

Agents exchange **artifact ids**, never prose. An artifact is a JSON file at
`docs/artifacts/<id>.<kind>.json`, validated by `scripts/contract-check.mjs` against
`.claude/contracts/<kind>.schema.json`, and every one carries the same envelope:

```
id           ART-YYYYMMDD-NNN
kind         one of the eight below
version      integer, bumped on every change; prior versions live in git
status       draft → proposed → approved | rejected → superseded      (gated kinds)
             draft → final → superseded                               (evidence kinds)
producer     { agent, run }        the registry name and the workflow run id
created      YYYY-MM-DD
title
traces[]     ids this artifact derives from — every one must exist and not be superseded
supersedes   id or null
approvals[]  { role, by, date, evidence }   required for status=approved, role per kind
body         the kind-specific fields
```

| Artifact | Producer | Consumers | Required body fields | Gate role for `approved` | Versioning |
| --- | --- | --- | --- | --- | --- |
| Requirement Specification | Intent Orchestrator | Build, Proof (Scenario Author), Release | problem, source with evidence level, kind (feature / correction / debt / incident-fix), priority P0–P4, scope_in, scope_out, acceptance_criteria[] (id, given, when, then), business_rules[], domain_entities[], open_questions[] | product-owner | New version for any change to criteria; superseded, never edited, once approved |
| Architecture Decision | Domain & Architecture Analyst | Build, Proof | context, decision, alternatives[] (option, rejected_because), consequences[], affects[] (paths), principles_checked[] (tenant-isolation, pure-reducer, attribution-as-parameter, derived-never-stored), adr_path | architect | Immutable once approved; a change is a new ADR that supersedes |
| Implementation Plan | Implementation Planner | Implementers, Reviewer, Proof | design_ref, steps[] (n, title, workstream, owns[], verify_command, risk), protected_paths_touched[], migration, commit_boundaries[], highest_regression_risk_step, rollback | engineering-lead, or architect if protected_paths_touched or migration | Re-planned as a new version; steps already done are recorded as such |
| Change Set | Build Orchestrator | Proof, Release | branch, base, commits[], files[] (path, workstream), plan_ref, self_validation (commands[], passed), review (confirmed, open, verdict) | none (evidence kind) | One per branch state; a rework produces a new version |
| Validation Result | Proof Orchestrator | Release, Intent (on failure) | change_set_ref, gates[] (name, command, result, evidence), scenarios (passed, partial, not_implemented, regressed[]), security (reviewer, findings[]), verdict (pass / conditional / fail), conditions[] | none | Never edited; a re-run is a new version |
| Risk Assessment | Intent or Proof Orchestrator | Build, Release, human gates | subject_ref, risks[] (id, description, likelihood, impact, mitigation, owner), overall (low / medium / high), requires_human, reasons[] | none | New version when a risk changes |
| Release Decision | Release Orchestrator | Pipeline (via the human), Watcher | change_set_refs[], validation_ref, readiness (ready / ready-with-conditions / not-ready), conditions[], deploy_window, rollback_plan, approved_via, post_release_checks[] | release-approver | One per release attempt |
| Incident Report | Post-release Watcher, Deviation Diagnoser | Incident Analyst, Intent | source (azure-monitor / user / scheduled-pass / scenario-regression / integrity-audit), observed, expected, expected_model_ref, gap, root_cause, severity, correction_ref, status | none | Updated in place while open (versioned), final on closure |

**Why files and not a message bus.** The contract checker runs in CI and locally, which makes a
malformed handoff a failed build rather than a confused agent. Git gives every artifact an author,
a timestamp and a diff. A workflow run id in `producer.run` links an artifact to the journal that
produced it. When Phase 3 adds a bus, the bus carries artifact ids; the files remain the record.

---

## Part 7 — Parallel development model

Parallelism is declared in the Implementation Plan, not discovered at merge time.

**Rules.**

1. A plan splits work into *workstreams*; each workstream lists the paths it `owns`. Two
   workstreams may not own the same path. The contract checker enforces this.
2. **Protected paths** are owned by at most one workstream per plan, and their presence triggers
   the engineering gate: `lib/workspace.ts` (the reducer), `lib/types.ts`, `prisma/schema.prisma`,
   `prisma/migrations/**`, `lib/access.ts`, `middleware.ts`, `.github/workflows/**`.
3. Each Implementer runs in its own git worktree (`isolation: 'worktree'` in the workflow) on a
   branch `feat/<ART-id>/<workstream>`. It may not touch a path outside its `owns` list; the
   Reviewer checks the diff against the plan and fails the change set if it does.
4. Order inside a workstream follows the house rule: pure logic first, then callers, then
   storage, then UI. A step is done when its `verify_command` exits 0.
5. **Integration gate.** Workstreams merge into `feat/<ART-id>` in the order the plan states,
   with the reducer or schema workstream first, because everything else depends on it. The
   Adversarial Reviewer reviews the integrated branch, not the pieces.
6. A migration is always its own workstream and its own commit, so it can be reverted alone.
   This is the existing commit-boundary rule, now enforced by the plan schema.
7. Merge conflicts are a plan defect, not a merge-time problem: the Build Orchestrator returns
   the plan to the Planner with the conflicting paths rather than resolving it in place.

```
              Implementation Plan (approved)
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   ws: reducer      ws: api        ws: ui
   owns lib/        owns app/api/  owns components/
   workspace.ts     …/route.ts     TreeGrid.tsx
   (protected →     (verify: tsc,  (verify: tsc,
    gate 3)          audit:tenancy) audit:a11y)
          │              │              │
          └──── merge in plan order ────┘
                         ▼
              Adversarial Reviewer
                         ▼
                   PROOF orchestra
```

---

## Part 8 — Governance and autonomy model

| Level | Meaning | Axiomate agents |
| --- | --- | --- |
| **1 — Observe** | Reads anything it is granted; changes nothing. | Adversarial Reviewer, Security Reviewer, Proof Orchestrator, Post-release Watcher |
| **2 — Recommend** | Produces artifacts and drafts; may write only under `docs/artifacts/` and `docs/adr/`. | Intent Orchestrator and its three analysts, Implementation Planner, Deviation Diagnoser, Release Orchestrator, Readiness Assessor, Incident Analyst |
| **3 — Execute in sandbox** | Changes files on an isolated branch or worktree. | Build Orchestrator, Scenario Author |
| **4 — Execute with validation** | Changes files within declared ownership, and each step must pass its verification command. | Implementer |
| **5 — Autonomous operation** | Runs without a person, on predefined low-risk operations. | Gate Runner, Deployment Pipeline (after the human environment approval), the scheduled pass, the audit workflow on cadence |

Three rules hold at every level. No agent approves an artifact it produced. No agent writes to
`master`. No agent holds a production credential; the pipeline holds a federated token that lasts
minutes and is only released by the environment approval.

Registered in `.claude/contracts/registry.json`, which the contract checker reads: an artifact
whose `producer.agent` is not registered, or whose kind the agent is not registered to produce,
fails the check.

---

## Part 9 — Human approval model

Five gates, held by role. Today one person holds all five; the design does not pretend otherwise,
and it is why the founder dependency inventory rates product operations Amber.

| Gate | Trigger | Role | What the human sees | What happens without them |
| --- | --- | --- | --- | --- |
| 1 Specification | Every Requirement Specification | product-owner | The spec, the risk assessment, the open questions | Nothing is planned or built |
| 2 Architecture | Any Architecture Decision | architect | The ADR with alternatives rejected and principles checked | The specification is approved but blocked on design |
| 3 Plan | Plan touches a protected path, a migration, security or tenancy | engineering-lead (architect for protected paths) | The plan's steps, ownership, the highest-risk step, the rollback | Low-risk plans proceed; risky ones wait |
| 4 Security | Any high-severity security finding in Proof | security-approver | The finding, the exploit path, the proposed fix | Validation is `fail`; nothing ships |
| 5 Release | Every deployment | release-approver | Release Decision, readiness verdict, conditions, rollback | Nothing reaches production |

**Where human time is worth most.** Gate 1 and Gate 5. Gate 1 because a wrong specification costs
every downstream orchestra; Gate 5 because it is the only irreversible step and the one with a
client on the other side. Gates 2 to 4 fire only on the conditions above, which on the last three
weeks of commits would have fired on roughly one change in four (migrations, reducer arms, access
changes). A low-risk bug fix that passes Proof with no conditions touches no gate but 5.

**What is never automated.** Approving a specification, approving an ADR, approving the release
environment. An agent may draft all three and may never set `status: approved`; the contract
checker rejects an approval whose `by` is a registered agent.

---

## Part 10 — Conflict resolution

Conflicts are expected between Intent's analysts (requirement versus architecture), between UX
placement and the planner, between speed and the protected-path gate, and between a new feature
and the debt the suite already measures. The rule: **no agent overrides another; disagreement is
an artifact field, and the orchestrator escalates rather than picks.**

```
Conflict detected by an orchestrator (two artifacts disagree, or a gate blocks a plan)
        │
        ▼
Evidence: each side's claim, its trace ids, its evidence level (E1–E5)
        │
        ▼
Specialist review: the agent whose memory owns the question re-reads the source
   (architecture question → Domain & Architecture Analyst; behaviour → Deviation Diagnoser)
        │
        ▼
Orchestrator recommendation: recorded in a Risk Assessment with requires_human=true
   and the options, never resolved silently
        │
        ▼
Human decision at the gate that owns the question (Part 9), recorded as an approval
   with evidence; the losing artifact is marked superseded, not deleted
```

Worked cases:

- **Product versus architecture.** The Requirement Analyst wants status to propagate from child
  to parent; the Domain Analyst says status is attested by a person and never derived. The Intent
  Orchestrator records both, the analyst drafts an ADR proposing a computed indicator instead, and
  the product owner decides at Gate 1. This is exactly what the status-rollup design did on
  2 September, by hand.
- **Engineering versus security.** The Security Reviewer flags a new route reading a tenant
  without naming it. There is no negotiation: `audit:tenancy` fails, the validation is `fail`,
  the Implementer fixes it. Security findings at high severity are not weighed against speed;
  they are a gate.
- **Speed versus quality.** A plan wants to skip the pure-logic-first ordering to ship a UI
  change faster. The Planner may propose it; the plan's `highest_regression_risk_step` must say
  so; the engineering gate decides. The default is the house rule.
- **Feature versus debt.** The suite reports P1 gaps. The cadence rule, one P1 per cycle chosen
  first, is encoded as a check: a Release Decision must reference at least one `debt` or
  `correction` specification per cycle, or state why not. The release approver sees it.

---

## Part 11 — Technical architecture on Azure

Three stages of infrastructure, matched to the roadmap, so nothing is built before it is needed.

**Stage A (Phases 1–2): no new infrastructure.**

```
 Claude Code (workflows, agents, skills)  ──►  git branches  ──►  GitHub Actions
       │                                            │                   │
       ▼                                            ▼                   ▼
 docs/artifacts (state store)             docs/, wiki/, code       Azure App Service
 scripts/contract-check.mjs (validator)   (knowledge layer)        staging slot → swap
 .claude/contracts/registry.json          data/validation.json     Azure Monitor → mailbox
 (agent + tool registry)                  (quality memory)         (observability)
```

The orchestrator is the workflow script. The event bus is git. The state store is the artifact
folder. The audit log is the git history plus the workflow journals Claude Code persists per run.
This is deliberately boring: it costs nothing to run, and every component is already in use.

**Stage B (Phase 3): scheduled and event-driven runs off the workstation.**

| Component | Azure service | Why this one |
| --- | --- | --- |
| Agent runtime | Azure Container Apps Jobs running the Claude Agent SDK, triggered by cron and by queue | Scales to zero; the same skills and contracts run headless |
| Event bus | Azure Service Bus queue per orchestra, message = artifact id | Ordered, durable, dead-letter for malformed handoffs |
| State store | Azure Database for PostgreSQL, `artifacts` table mirroring the JSON files, written by the pipeline on push | Queryable state without making the DB the source of truth |
| Knowledge retrieval | Azure AI Search, index rebuilt by a pipeline job over `docs/`, `wiki/`, skills, artifact bodies | Hybrid search with file-path results, no custom vector infrastructure |
| Secrets | Key Vault, referenced by Container Apps; agents receive scoped tokens, never the pipeline's | Matches `docs/secrets.md`'s existing rule that no agent holds a production credential |
| Observability | Application Insights for the runtime; Log Analytics for gate results; alerts route to an action group with more than one recipient | Today's alerts go to one mailbox, which the dependency inventory rates Amber |
| Audit | Git plus an immutable append-only table of workflow runs (run id, agent, artifact ids read and written, model, token cost) | Cost control and traceability from the same record |

**Stage C (Phase 4): production learning.** Application Insights telemetry from the product
(`app/api/*`, the scheduled pass, reducer rejection counts) flows into the Post-release Watcher
as Incident Reports of source `azure-monitor`; the expected-behaviour model it compares against
is the scenario suite plus the design docs, indexed. The Cognitive Correction loop in Part 14
runs on this.

**GitHub versus Azure DevOps.** The live pipeline is GitHub Actions with a federated credential
and an environment approval. Azure DevOps offers the same two primitives (service connection with
workload identity, environment with approvers). The design references "the environment approval"
and is unchanged by the choice.

**Cost control.** Every workflow run records its token spend in the audit table. Gate 1 stops
spend before Build, which is where most tokens go. The Gate Runner is deterministic and free.
Adversarial verification uses three refuters only for confirmed findings, not for every review
line. The Anthropic API credit exhaustion recorded in the vision doc (task #113) is the reason
Stage A runs inside Claude Code rather than against the API.

---

## Part 12 — Implementation roadmap

| Phase | Agents introduced | Capabilities | Infrastructure | Risks | Human controls | Success metrics |
| --- | --- | --- | --- | --- | --- | --- |
| **1 — AI-assisted development** (now to +6 weeks) | Intent, Build, Proof and Release Orchestrators as Claude Code agents; contracts, registry, checker, ADR log, `axiomate-change` workflow. Specialists are the existing skills. | A request becomes a validated Requirement Specification; an approved spec becomes a planned, reviewed, gated change set; every handoff is a checked artifact. | None new. `audit:contracts` added to the pipeline. | Artifacts written but not read (ceremony without use); the checker too strict to keep. | All five gates human; nothing merges without a person. | Every commit on `master` traces to an artifact id; contract check green on every push; time from approved spec to validated change set measured per item. |
| **2 — Orchestrated agent teams** (+6 to +14 weeks) | Parallel Implementers in worktrees; Scenario Author; Security Reviewer as a distinct run; low-risk autonomous merge. | Multi-workstream plans executed in parallel; scenario coverage per criterion; `correction` and `debt` changes merge on Proof alone. | Pre-commit hook (Gap 3 in continuous-development); derived-value gate (Gap 2). | Ownership rules too coarse, forcing serial work; autonomous merges eroding trust after one bad one. | Gates 1, 2, 5 human; Gate 3 only for protected paths; every autonomous merge logged and reviewable. | Parallel workstreams per plan; regressions caught before Proof; one P1 debt item shipped per cycle. |
| **3 — Multi-orchestra development** (+14 to +26 weeks) | Headless runtime on Container Apps; Service Bus handoffs; AI Search retrieval; a second human for at least Gate 5. | Orchestras run on schedule and on events without the workstation; intake mail becomes Requirement Specifications automatically (kind `feature`, status `draft`). | Stage B above. | Cost without a ceiling; retrieval returning stale designs; a headless agent with a broader token than it needs. | Token budget per run and per day; Key Vault scoping; the second approver. | Mean spec-to-release time; token cost per shipped change; zero agent-held production credentials (audited). |
| **4 — Continuous autonomous improvement** (+26 weeks on) | Post-release Watcher on telemetry; Incident Analyst end to end; Deviation Diagnoser on a cadence. | Production signal → Incident Report → root cause → correction Requirement → Intent, with no human until Gate 1. | Stage C above. | False incidents consuming Gate 1 time; corrections masking a design flaw. | Gate 1 remains human; incident severity thresholds set by the release approver. | Incidents detected before a user reports them; correction changes merged within one cycle; founder dependency index for product operations moved from Amber to Green. |

---

## Part 13 — Axiomate-specific context the agents must hold

The agents are not generic because the shared memory is not generic. Four things every
specialist reads before acting, all of which already exist:

1. **The resource model in `CLAUDE.md`**: allocation is project-level, assignment is work-level,
   timesheet is actual-level, capacity is computed and never stored. An agent that stores a
   derived value has broken the codebase's founding rule.
2. **The work model**: `Issue` with `parentId` hierarchy, lifecycle activities, the seven-value
   status graph in `lib/workspace.ts` with approval gates, `Engagement` → `Project` →
   `Issue` → `Activity`. The brief's `Organisation → Portfolio → Project → Outcome → Work Item`
   is the V1 vocabulary; the mapping is recorded in the `axiomate-work-model` skill.
3. **The three enforced rules**: the reducer is pure, attribution is a parameter, every
   tenant-scoped query names its tenant. The Gate Runner proves them.
4. **Provenance**: the source issue log has no due dates; the app labels every derived value as
   derived. The `data-honesty` review dimension exists because of this.

---

## Part 14 — Cognitive correction

The capability the brief asks for exists in parts; this design connects them.

| Stage | Mechanism | Exists today |
| --- | --- | --- |
| Observed behaviour | Scheduled pass, `lib/dataIntegrity.ts` seam checks, `audit:integrity`, the scenario suite run, Azure Monitor, a person's report or screenshot | Yes |
| Expected behaviour model | Design docs (`docs/plans/*-design.md`), the scenario suite's Given/When/Then, ADRs, the resource model | Yes, unlinked (Gap 4) |
| Gap detection | Regression gate; integrity audit; the `data-honesty` review dimension; the Deviation Diagnoser comparing report with model | Partly; the diagnoser is a skill run by hand |
| Root cause | Deviation Diagnoser with the Adversarial Reviewer's refutation pattern | Skill exists |
| Correction proposal | Requirement Specification of kind `correction`, traced to the Incident Report | New (this design) |
| Validation | Proof orchestra, with the regressed scenario required to pass | Yes |
| Controlled fix | Build orchestra on the low-risk path, human release gate | Yes |

It operates across business logic (the reducer and its scenarios), data (the integrity audit and
seam checks), API (route tests and tenancy audit), UI (the design audit and a11y dimensions),
workflow (the status graph and approval gates), security (the security reviewer and RLS proofs)
and performance (one baseline today, so detection only, until a second measurement exists).

---

## The smallest viable architecture to build first

**One workflow, four orchestrator agents, eight contracts, one checker, one ADR log.** No new
infrastructure. The specialists are the thirty-two skills that already exist.

- `axiomate-change` workflow with three stages (`intent`, `build`, `proof`) that stop at the
  human gates by writing a `proposed` artifact and returning.
- Intent, Build, Proof and Release Orchestrator agent definitions, each naming which skills it
  runs, which artifacts it reads and writes, and what it must stop for.
- Eight artifact schemas and a registry; `npm run audit:contracts` in the standing gate.
- `docs/adr/` with the first ADR being this decision.

That is Phase 1, and it is what the accompanying plan builds. It accelerates development
immediately because the sequencing skill (`axiomate-feature-builder`) stops being a paragraph and
becomes a run with a journal, and it creates no complexity that a second engineer could not
read in an afternoon. Everything in Parts 11 and 12 beyond it waits until there is a measured
reason to build it.
