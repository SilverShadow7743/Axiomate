# Axiomate — granular product blueprint (target state)

*Recorded 2026-09-06, from the user's own synthesis, reproduced faithfully. This is a
**screen-and-suite decomposition of a target state**, not a build spec and not checked against
what exists in Axiomate TMS today — that reality-check is a separate, larger exercise (suite by
suite, screen by screen) requested but not yet run. Treat every screen ID, field list and
diagram below as stated intent, not as confirmed or built.*

**Relationship to `docs/strategy/axiomate-vision.md`.** That doc (31 August 2026) is the
pillar-level business/product strategy — twelve pillars (Work Capture, Context Graph, Work
Intelligence, …), an MVP slice analysis (A–E), and an honest map of what's real in this codebase
versus genuinely AI-blocked. This document is a different decomposition of the same overall
ambition — twelve **suites** and roughly a hundred **screens**, at the information-architecture
and screen-content level rather than the capability-pillar level. The two haven't been
reconciled against each other; that reconciliation, and the reality-check against the actual
codebase (`components/`, `prisma/schema.prisma`, `lib/access.ts`), is future work, not done here.

---

## 0. Product architecture

```
AXIOMATE
├── Command Suite
├── Growth Suite
├── Client Suite
├── Engagement Suite
├── Delivery Suite
├── People Suite
├── Knowledge Suite
├── Application Suite
├── Finance Suite
├── Intelligence Suite
├── Automation Suite
└── Governance Suite
```

**Five career experiences**, a cross-cutting design dimension rather than five duplicated
applications:

| Level | Verb |
|---|---|
| Associate | Execute |
| Consultant | Deliver |
| Senior Consultant | Lead |
| Principal Consultant | Advise |
| Engagement Leader | Govern & Grow |

Every screen answers, for its context: who uses it → why → what they see → what they can do →
what data powers it → what happens after an action → what AI does → what automation does → what
permissions apply → what the empty/error/loading states look like. Section 17 gives the standard
that specification would follow if written out per screen.

---

## 1. Common Axiomate experience

Before the individual suites, a consistent platform shell.

### AXS-001 — Global Application Shell
**Purpose.** Persistent navigation and contextual controls.

```
┌──────────────────────────────────────────────────────┐
│ Axiomate │ Search │ AI Command │ Notifications │ Me │
├──────────┼───────────────────────────────────────────┤
│          │                                           │
│ NAV      │              WORKSPACE                    │
│ Suite    │                                           │
└──────────┴───────────────────────────────────────────┘
```

- **Header:** logo, workspace selector, global search, AI Command, notifications, approvals,
  help, user profile.
- **Sidebar:** dynamic on career level, functional role, engagement role, permissions, enabled
  suites.
- **Required states:** collapsed navigation, expanded navigation, mobile navigation, restricted
  module, unavailable module.

### AXS-002 — Global Search
Searches across: people, clients, engagements, projects, workstreams, deliverables, actions,
documents, applications, decisions, risks, processes.

```
Query → Keyword search → Semantic search → Entity resolution → Relationship search → AI answer
```
Example: *"Find all D365 Commerce engagements with Shopify integration"* should return
engagements, customers, projects, architects, documents, decisions and architecture patterns
together, not a flat list.

### AXS-003 — AI Command
Global AI entry point ("Ask Axiomate"): *"What requires my attention?"*, *"What changed today?"*,
*"Why is Engagement ABC at risk?"*, *"Create a project from this proposal."*, *"Find someone with
D365 Commerce experience."*
- **AI actions:** answer, summarize, analyze, create, modify, recommend, execute.
- **Permission rule:** AI inherits the user's effective permissions — never more.

### AXS-004 — Attention Center
Not merely notifications — aggregates decisions, risks, blockers, approvals, overdue work,
customer issues, financial alerts, application alerts, AI recommendations. Each item carries
severity, reason, affected entity, owner, recommended action, deadline.

### AXS-005 — Universal Entity View
Every major entity (Client, Person, Engagement, Project, Application, Process, Decision, Risk)
gets the same 360° pattern: Header → Overview → Activity → Relationships → Work → Documents →
Intelligence → History.

---

## Suite 01 — Command Suite

- **CMD-001 Associate Command Center** — persona Associate; objective: help them understand and
  execute assigned work. Cards: My Actions, Today's Priorities, Deliverables, Blockers, Upcoming
  Deadlines, Learning, Recent Knowledge. AI: explain assignment, summarize requirement, find
  similar work, review deliverable, generate checklist.
- **CMD-002 Consultant Command Center** — cards: My Deliverables, Workstreams, Customer Requests,
  Dependencies, Risks, Upcoming Milestones, Utilization, AI Recommendations.
- **CMD-003 Senior Consultant Delivery Command Center** — cards: Workstream Health, Team
  Capacity, Milestone Health, Blockers, Risks, Customer Issues, Decisions, Delivery Forecast. AI
  example: *"Testing capacity is insufficient to meet the current deployment date."*
- **CMD-004 Principal Consultant Solution Command Center** — cards: Solution Health, Architecture
  Risks, Design Decisions, Standards Deviations, Cross-Engagement Patterns, Capability Gaps,
  Reusable IP.
- **CMD-005 Engagement Leader Command Center** — cards: Client Health, Delivery Health, Revenue,
  Cost, Margin, Utilization, Risks, Escalations, Change Requests, Expansion Opportunities. AI
  executive brief: what changed, why it matters, what's at risk, what I should decide, what
  Axiomate can execute.
- **CMD-006 My Work** — views: Today, Upcoming, Overdue, Blocked, Waiting, Delegated, Completed,
  Following. Filters: client, engagement, project, workstream, priority, status, date, assignee.
  Bulk ops: assign, change status, change date, change priority, move, archive.
- **CMD-007 Decision Inbox** — one place for every decision requiring this person: decision,
  impact, deadline, recommendation, approvers. Career-level filtering determines what appears.

---

## Suite 02 — Growth Suite

- **GRT-001 Growth Command Center** — metrics: pipeline, weighted pipeline, forecast, win rate,
  average deal size, sales cycle, expansion, renewal. AI: forecast, opportunity scoring,
  expansion detection, stalled-opportunity detection.
- **GRT-002 Opportunity Workspace** — tabs: Overview, Customer, Opportunity, Stakeholders,
  Requirements, Solution, Commercial, Proposal, Activities, Intelligence. Objects: opportunity,
  contacts, competitors, value, probability, expected close, solution.
- **GRT-003 Opportunity Qualification** — evaluates strategic fit, capability fit, relationship,
  commercial potential, delivery feasibility, resource availability, competitive position.
- **GRT-004 Solution & Estimation Workspace** — inputs: scope, requirements, workstreams, effort,
  skills, resources, timeline. Outputs: estimated effort, team, cost, price, margin, delivery
  risk.
- **GRT-005 Proposal Workspace** — Executive Summary, Customer Need, Scope, Solution, Approach,
  Team, Timeline, Commercial, Assumptions, Risks, Approval.
- **GRT-006 Contract Workspace** — connects Contract → Engagement → Revenue → Delivery; tracks
  scope, value, dates, milestones, billing, SLAs, obligations, change requests.
- **GRT-007 Expansion Intelligence** — AI identifies whitespace, unused capabilities, customer
  needs, application opportunities, renewal risk, cross-sell potential.

---

## Suite 03 — Client Suite

- **CLT-001 Client Command Center** — header: client, health, relationship, strategic
  importance. Sections: Relationship, Engagements, Revenue, Margin, Satisfaction, Stakeholders,
  Risks, Applications, Opportunities, Intelligence.
- **CLT-002 Client 360** — contacts, stakeholders, contracts, engagements, projects, revenue,
  applications, communications.
- **CLT-003 Stakeholder Workspace** — attributes: role, influence, sentiment, relationship
  strength, interests, concerns, decisions, interactions. AI: *"Which stakeholders require
  attention?"*
- **CLT-004 Client Health** — dimensions: Relationship, Delivery, Financial, Commercial,
  Satisfaction, Strategic. Overall: Healthy / Watch / At Risk / Critical.
- **CLT-005 Client Intelligence** — AI analyzes communication, project health, financials,
  requests, escalations, opportunities.

---

## Suite 04 — Engagement Suite

- **ENG-001 Engagement Command Center** — primary users: Senior Consultant, Principal
  Consultant, Engagement Leader. Layout: Health, Delivery, Financial, Commercial, People,
  Projects, Risks, Decisions, Intelligence.
- **ENG-002 Engagement Overview** — objective, scope, outcomes, customer, contract, timeline,
  governance, team.
- **ENG-003 Engagement Plan** — hierarchy: Outcome → Workstream → Deliverable → Action.
- **ENG-004 Engagement Financials** — KPIs: contract value, revenue, cost, margin, burn,
  forecast, remaining effort. AI example: *"Margin is projected to decline 3.2 points because of
  additional architecture effort."*
- **ENG-005 Engagement Governance** — steering meetings, governance calendar, decisions,
  approvals, escalations, status reporting.
- **ENG-006 Engagement Risk Center** — dimensions: delivery, technical, people, customer,
  commercial, financial, application.
- **ENG-007 Engagement Decision Center** — lifecycle: Identify → Frame → Analyze → Recommend →
  Approve → Execute → Measure Outcome.
- **ENG-008 Engagement Executive Report** — auto-generated: current health, progress, financials,
  risks, decisions, customer position, next actions.

---

## Suite 05 — Delivery Suite

- **DLV-001 Delivery Command Center** — primary persona Senior Consultant. Components: portfolio
  health, milestone health, workstream status, resource capacity, blockers, dependencies, risks.
- **DLV-002 Project Navigator** — categories: Active, My Projects, Pinned, Shared, Archived.
  Actions: create, duplicate, archive, import, template.
- **DLV-003 Project Workspace** — navigation: Overview, List, Status, Team, Calendar, Gantt,
  Table, Timeline, Workstreams, Deliverables, Risks, Decisions, Documents, Analytics.
- **DLV-004 Project Overview** — header: project name, health, owner, customer, engagement,
  dates, completion. Main: objectives, milestones, progress, risks, dependencies, team.
- **DLV-005 List View** — row: Status | Action | Owner | Priority | Start | Due | Progress.
  Interactions: inline editing, drag/drop, bulk selection, grouping, sorting, filtering.
- **DLV-006 Status View** — columns: Backlog, Ready, In Progress, Review, Blocked, Completed;
  configurable per project.
- **DLV-007 Team View** — person, assigned actions, capacity, utilization, overdue, blockers.
- **DLV-008 Calendar View** — action dates, milestones, deliverables, meetings, dependencies.
- **DLV-009 Gantt View** — start/end, duration, dependency, milestone, critical path, baseline.
- **DLV-010 Table View** — advanced structured editing: custom fields, formulas, grouping,
  filtering, bulk update.
- **DLV-011 Timeline View** — high-level chronological planning.
- **DLV-012 Workstream Workspace** — primary user Senior Consultant. Objective, Owner, Team,
  Deliverables, Actions, Dependencies, Milestones, Health.
- **DLV-013 Deliverable Workspace** (quality-centric) — Objective, Requirements, Owner,
  Contributors, Quality Criteria, Evidence, Review, Approval, Version, Outcome.
- **DLV-014 Action Workspace** — the fundamental work object. Header (title, status, priority,
  owner); Context (customer, engagement, project, workstream, deliverable); Execution (dates,
  effort, dependencies, subtasks); Collaboration (comments, mentions, attachments); Governance
  (approvals, activity); Intelligence (AI summary, recommendations, risk). See §17 for the full
  screen-spec treatment of this one, used as the worked example.
- **DLV-015 Dependency Map** — visualizes Action → Deliverable → Milestone → Project →
  Engagement → Customer Outcome.
- **DLV-016 Delivery Health** — computed from schedule, progress, risk, dependency, resource,
  quality, customer signals.

---

## Suite 06 — People Suite

- **PPL-001 People Command Center** — metrics: headcount, utilization, availability, demand,
  supply, skill gaps.
- **PPL-002 Person Workspace** — Profile, Career, Skills, Experience, Certifications,
  Assignments, Capacity, Performance, Knowledge, Development.
- **PPL-003 Career Command Center** — progression: Associate → Consultant → Senior Consultant →
  Principal Consultant → Engagement Leader.
- **PPL-004 Capability Matrix** — Skill | Proficiency | Demand | Supply | Gap.
- **PPL-005 Resource Workspace** — planning dimensions: availability, skills, experience, cost,
  location, customer, engagement, career development.
- **PPL-006 Staffing Workspace** — Axiomate recommends resources; match score on Skill Fit,
  Experience Fit, Availability, Customer Fit, Cost, Career Opportunity.
- **PPL-007 Career Development** — Current Level, Target Level, Readiness, Capability Gaps,
  Recommended Experience, Learning, Mentoring.
- **PPL-008 Career Evidence** — instead of managers relying only on subjective assessment,
  Axiomate collects evidence from deliverables, project roles, customer interactions,
  leadership, knowledge contributions, certifications, outcomes.

---

## Suite 07 — Knowledge Suite

- **KNW-001 Knowledge Command Center** — Solutions, Architecture, Documents, Decisions, Lessons,
  Accelerators, Templates, Best Practices, IP.
- **KNW-002 Knowledge Search** — natural-language search across organizational knowledge.
- **KNW-003 Solution Library** — every solution carries problem, context, approach, architecture,
  implementation, outcome, lessons, reusable assets.
- **KNW-004 Architecture Library** — patterns, reference architectures, technology decisions,
  standards, exceptions.
- **KNW-005 Decision Library** — search: what was decided + why + by whom + outcome.
- **KNW-006 Lessons Learned** — Situation → Action → Outcome → Lesson → Recommendation.
- **KNW-007 Accelerator Library** — frameworks, templates, code, architectures, methodologies,
  reusable components.

---

## Suite 08 — Application Suite

*Flagged in the source pitch as a candidate flagship capability.*

- **APP-001 Application Command Center** — enterprise application landscape: D365, Salesforce,
  Shopify, Microsoft 365, Power Platform, custom applications.
- **APP-002 Application Workspace** — Overview, Health, Users, Processes, Data, Integrations,
  Dependencies, Configuration, Customizations, Performance, Security, Cost, Intelligence.
- **APP-003 Application Landscape** — relationship visualization: Customer → CRM / ERP /
  Commerce / Data Platform / Integration Layer.
- **APP-004 Integration Intelligence** — tracks source, destination, interface, frequency,
  failures, latency, volume, business process, impact.
- **APP-005 Application Health** — dimensions: availability, performance, integration, data,
  security, customization, operational risk.
- **APP-006 Application Intelligence** — translates technical signal into business impact, e.g.
  Integration failure → Order process affected → Customer fulfillment delayed → Engagement
  milestone impacted → Revenue exposure.
- **APP-007 Technology Dependency Map** — Application → Integration → Process → Customer →
  Engagement.

---

## Suite 09 — Finance Suite

- **FIN-001 Financial Command Center** — KPIs: revenue, cost, margin, forecast, utilization,
  billing.
- **FIN-002 Engagement Financial Workspace** — detailed financial view per engagement.
- **FIN-003 Profitability Workspace** — analyze by customer, engagement, project, service,
  practice, resource.
- **FIN-004 Forecast Workspace** — AI forecasts revenue, cost, margin, resource requirements.
- **FIN-005 Commercial Change Workspace** — manages change requests, scope changes, additional
  effort, price, margin impact, approval.

---

## Suite 10 — Intelligence Suite

- **INT-001 Intelligence Center** — six primary actions: Ask, Analyze, Predict, Recommend,
  Simulate, Execute.
- **INT-002 Insight Workspace** — each insight: Observation, Evidence, Affected Entities, Impact,
  Confidence, Recommendation.
- **INT-003 Risk Intelligence** — identifies risk automatically from project data, people,
  customer signals, financials, applications, dependencies, communications.
- **INT-004 Decision Intelligence** — compares options (A/B/C) on cost, impact, risk, time,
  confidence.
- **INT-005 Predictive Intelligence** — predicts project delay, resource shortage, customer
  escalation, margin deterioration, opportunity risk, application failure.
- **INT-006 Scenario Studio** — e.g. *"What happens if we move two consultants to Project B?"* →
  timeline impact, cost, utilization, margin, customer impact, downstream risk.
- **INT-007 Executive Intelligence** — for Engagement Leaders: what changed, why, what matters,
  what requires my decision, what should happen next.
- **INT-008 Role Intelligence** — Associate → Execution Intelligence; Consultant → Delivery
  Intelligence; Senior Consultant → Leadership Intelligence; Principal Consultant → Solution
  Intelligence; Engagement Leader → Business Intelligence.

---

## Suite 11 — Automation Suite

- **AUT-001 Automation Command Center** — monitors active automations, failures, pending
  approvals, completed executions.
- **AUT-002 Workflow Studio** — Trigger → Condition → Decision → Action → Approval → Execution.
- **AUT-003 Automation Library** — prebuilt: project initiation, customer onboarding, risk
  escalation, resource assignment, deliverable approval, change request, project closure,
  reporting.
- **AUT-004 Agent Studio** — configures Agent Objective, Knowledge, Tools, Permissions, Policies,
  Memory, Approval Rules.
- **AUT-005 Agent Workspace** — monitors active agents, decisions, actions, approvals, failures,
  outcomes.
- **AUT-006 Execution History** — every execution records who / what / why / when / result,
  including AI-originated actions.

---

## Suite 12 — Governance Suite

- **GOV-001 Governance Center** — Security, Permissions, Policies, AI Governance, Agent
  Governance, Compliance, Audit.
- **GOV-002 Organization Workspace** — Organization → Business Units → Practices → Locations →
  Workspaces → Policies.
- **GOV-003 User & Team Management** — every person: Career Level, Functional Role, Engagement
  Role, Skills, Permissions.
- **GOV-004 Role & Permission Studio** — Career Level + Functional Role + Engagement Role +
  System Permissions = Effective Access.
- **GOV-005 AI Governance** — controls data access, AI capabilities, model policies, sensitive
  information, execution authority, human approval.
- **GOV-006 Agent Governance** — controls agent tools, permissions, execution limits, approval
  thresholds, policies, monitoring.
- **GOV-007 Audit Center** — tracks human action, system action, automation, AI action,
  approval, data modification.

---

## 13. Cross-suite entity model

```
CLIENT
 ├── OPPORTUNITIES → CONTRACT → ENGAGEMENT → PROJECT → WORKSTREAM → DELIVERABLE → ACTION
 ├── PEOPLE
 ├── APPLICATIONS
 ├── KNOWLEDGE
 └── FINANCIALS
```

## 14. Cross-suite intelligence

The differentiator: a normal system reports "Action overdue by 3 days." Axiomate should reason
through the consequence chain: Action overdue → Deliverable delayed → Workstream milestone
threatened → Project critical path affected → Customer milestone at risk → Revenue recognition
may shift → Engagement margin may change. The intelligence layer connects those consequences
rather than stopping at the first fact.

## 15. Career-level context engine

Every screen evaluates: Who is this? → Career Level → Functional Role → Engagement Role →
Permissions → Current Context → What information matters? → What actions are appropriate? The
same Project Workspace behaves differently for each person rather than being duplicated per
level.

## 16. Example — same project, five experiences

| Level | Sees | Can |
|---|---|---|
| Associate | assigned actions, deliverables, instructions, knowledge, blockers | update own work, submit deliverables, comment, request help |
| Consultant | workstream, deliverables, dependencies, customer requests | own deliverables, coordinate contributors, manage workstream actions |
| Senior Consultant | team, capacity, dependencies, risks, milestones | assign work, manage workstream, resolve blockers, escalate risks |
| Principal Consultant | architecture, cross-workstream dependencies, solution quality, design decisions | approve solution decisions, define standards, advise engagement |
| Engagement Leader | customer, delivery, commercial, financial, strategic risks | govern engagement, approve commercial decisions, manage escalation, drive expansion |

## 17. Screen specification standard

Every real screen should eventually carry a specification at this depth (worked example:
DLV-014, Action Workspace):

- **Screen ID / name / suite:** DLV-014, Action Workspace, Delivery Suite.
- **Primary persona:** Associate / Consultant. **Secondary:** Senior Consultant / Principal
  Consultant.
- **Purpose:** manage an executable unit of work.
- **Entry points:** My Work, Project, Workstream, Deliverable, Search, Notification, AI Command.
- **Header:** action title, status, priority, owner.
- **Primary content:** description, context, sub-actions, dependencies.
- **Secondary content:** activity, comments, files, AI.
- **Actions:** edit, assign, move, complete, delegate, comment, attach, create sub-action.
- **AI:** summarize, break down, estimate, identify risk, suggest next action.
- **Automation:** status change, due-date trigger, assignment trigger.
- **Permissions:** view, edit, assign, approve, execute.
- **States:** loading, empty, error, blocked, completed, archived, restricted.

## 18. Design system

- **Navigation:** suite navigation, contextual navigation, breadcrumbs, tabs.
- **Data:** entity cards, tables, timelines, boards, graphs, metrics, status indicators.
- **Actions:** primary, secondary, contextual, bulk, AI action.
- **Intelligence components:** Insight Card, Risk Card, Recommendation Card, Decision Card,
  Prediction Card, Scenario Card.

## 19. Intelligence card (standard component)

```
┌─────────────────────────────────┐
│ ⚠ DELIVERY RISK                 │
│                                 │
│ Project ABC                     │
│ Probability       82%          │
│ Impact            High         │
│                                 │
│ WHY                             │
│ Testing capacity is insufficient│
│ for the planned deployment.     │
│                                 │
│ RECOMMENDATION                  │
│ Reallocate 1 consultant.        │
│                                 │
│ [Review] [Simulate] [Execute]   │
└─────────────────────────────────┘
```
Meant to be reusable throughout the product, not bespoke per suite.

## 20. Status architecture

- **Health:** Healthy → Watch → At Risk → Critical.
- **Work:** Not Started → Ready → In Progress → Review → Blocked → Completed.
- **Decision:** Draft → Under Review → Awaiting Decision → Approved → Implemented → Closed.
- **Risk:** Identified → Assessing → Mitigating → Monitoring → Resolved → Accepted.

## 21. Data architecture — core entities

Organization, Business Unit, Practice, Person, Career Level, Functional Role, Engagement Role,
Skill, Customer, Contact, Opportunity, Contract, Engagement, Program, Project, Workstream,
Deliverable, Action, Process, Risk, Issue, Decision, Application, Integration, Document,
Knowledge Asset, Financial Record, Metric, Insight, Prediction, Recommendation, Scenario,
Workflow, Agent, Audit Event.

## 22. Event architecture

Every important fact generates an event: Action Created/Assigned/Completed, Deliverable
Submitted/Approved, Risk Identified/Escalated, Decision Created/Approved, Customer Updated,
Contract Signed, Project Delayed, Resource Assigned, Integration Failed, Application Incident,
Invoice Raised, Payment Received. These events feed Analytics, Intelligence, Automation and AI
Agents.

## 23. AI architecture

```
Enterprise Data → Context Layer → Knowledge Layer → Reasoning Layer → Intelligence
→ Agent → Tool → Approval → Execution → Audit
```
The point of naming every stage: this prevents Axiomate from becoming merely an LLM chat
interface bolted onto the product.

## 24. Build priority — P0, Axiomate Foundation

- **Command:** Command Center, My Work, Attention, Search, AI Command.
- **Delivery:** Engagement, Project, Workstream, Deliverable, Action; List, Kanban, Calendar.
- **People:** Person, Career Level, Team, basic Capacity.
- **Intelligence:** Insights, Risk, AI Assistant.
- **Governance:** Users, Roles, Permissions, Audit.

## 25. P1 — Operating Platform

Add: Growth Suite, Client Suite, Knowledge Suite, Finance Suite; Gantt, Timeline; Resource
Intelligence, Career Intelligence, Decision Intelligence, Application Intelligence; Process
Studio, Workflow Studio.

## 26. P2 — Axiomate Differentiation

Add: AI Agents, Scenario Studio, Predictive Delivery, Autonomous Resource Optimization,
Application Intelligence, Enterprise Knowledge Graph, Digital Operating Model, Autonomous
Reporting, AI-assisted proposals, cross-engagement intelligence, continuous process
optimization.

## 27. Final product map

```
                         AXIOMATE
                            │
                    COMMAND SUITE
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
     GROWTH               CLIENT             ENGAGEMENT
     SUITE                SUITE                SUITE
       │                    │                    │
       └────────────────────┼────────────────────┘
                            ▼
                       DELIVERY SUITE
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
         PEOPLE          KNOWLEDGE      APPLICATION
          SUITE            SUITE            SUITE
            │               │               │
            └───────────────┼───────────────┘
                            ▼
                       FINANCE SUITE
                            │
                            ▼
                   INTELLIGENCE SUITE
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
          INSIGHT        DECISION       PREDICTION
                            │
                            ▼
                     AUTOMATION SUITE
                            │
                            ▼
                      AGENT ECOSYSTEM
                            │
                            ▼
                     GOVERNANCE SUITE
                            │
                            ▼
                         OUTCOME
                            │
                            ▼
                         LEARNING
```

And across everything, the five career experiences (§0). The fundamental equation the source
pitch closes on:

```
People + Work + Customers + Applications + Knowledge + Financials
  → Context → Intelligence → Decision → Automation → Execution → Outcome
  → Organizational Learning
```

## What this document is not

Not a Requirement Specification, not scoped against `axiomate-change`, not checked against
`prisma/schema.prisma`, `lib/access.ts`, or any existing component. The next stated intent (a
field/component/API-level specification per screen) is real additional work, not implied by this
document existing. Before any suite here is built, it should go through Intent the normal way —
and, per the header note above, be read alongside `axiomate-vision.md` rather than instead of it,
since the two are competing decompositions of the same ambition and haven't been reconciled.
