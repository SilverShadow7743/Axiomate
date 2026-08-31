# Axiomate — business & product strategy

*Recorded 31 August 2026, from the user's own synthesis, distilled and anchored against what is
real in this codebase today. Not a transcript — the source conversation had 36 numbered
sections; this keeps the thesis, drops the repetition, and adds the one thing the original
didn't have: which parts already exist in Axiomate TMS, which are genuinely blocked, and why.*

---

## 1. The thesis

Not "companies need a better project-management tool." The deeper claim:

> As a company grows, the coordination required to turn business intent into execution grows
> faster than the company's ability to manage it.

Work is fragmented across email, chat, meetings, calendars, documents, CRM, PM tools, code
hosts, spreadsheets, and people's memory. The result is lost work, missed commitments,
excessive follow-up, poor visibility, delayed decisions, delivery risk.

**The Coordination Tax** is the name for that hidden, growing cost. Axiomate's mission: reduce
it by turning organizational signals into accountable, intelligent execution.

**Competitive read** (per the user's own check): Microsoft is moving Planner toward
natural-language planning and execution inside Copilot; Atlassian is moving Jira toward agentic
execution over a connected organizational context graph (Teamwork Graph, Rovo Dev turning work
items into code). Both are converging on the same territory this thesis describes. The
implication for positioning (§9 below) is specific: don't compete on "tasks + AI" — that's
becoming table stakes for both of them.

## 2. Who it's for

Primary ICP: growing companies, **10–100 employees** — SaaS startups, IT services, consulting,
digital agencies, distributed product companies. Below 10, informal communication still works.
Above 100, entrenched enterprise platforms own the account. The attack point: *"we are growing
faster than our operating system."*

Primary buyers by role: Founder/CEO ("tell me what I need to know"), COO/Ops ("keep the company
running"), Delivery/PM ("keep execution moving"), Team Lead ("where does my team need
attention"), Individual contributor ("tell me what matters, remove the admin work"), Product
Manager ("turn customer signals into product execution").

## 3. Value proposition, three layers

- **Short**: Axiomate turns business conversations into execution.
- **Customer-facing**: Axiomate connects your company's communication, work and people,
  automatically turning requests, commitments and decisions into accountable execution while
  identifying risks before they become problems.
- **Long-term vision**: The AI operating system for running a growing company.

## 4. The twelve pillars

| # | Pillar | Purpose |
|---|---|---|
| 1 | Work Capture | Capture signals from everywhere (email, chat, meetings, documents) |
| 2 | Context Graph | Connect people, work, customers, goals, decisions |
| 3 | Work Intelligence | Understand requests, commitments, decisions, requirements, risks |
| 4 | Work Management | Tasks, projects, goals, milestones — the execution mechanism, not the identity |
| 5 | Planning | AI planning and resource allocation |
| 6 | Execution | Humans + AI agents, jointly |
| 7 | Automation | Autonomous, natural-language-defined workflows |
| 8 | Risk Intelligence | Predict delay, overload, scope creep, dependency failure |
| 9 | Organizational Memory | Decisions, requirements, commitments, history — queryable |
| 10 | Workforce Intelligence | Capacity, skills, availability, permission-aware |
| 11 | Business Operations | Customers, scope, approvals, delivery, external collaboration |
| 12 | Governance | Permissions, audit, agent scopes, explainability |

## 5. The MVP, and where Axiomate TMS already stands against it

The user's own §29 defines five MVP slices. Mapped here against what actually exists in this
codebase — not what the pitch assumed:

| Slice | What it needs | Real in Axiomate TMS today | Genuinely AI-blocked |
|---|---|---|---|
| **A. Connect** | Email, Teams/Slack, Calendar | Meetings are real (`lib/meetings.ts`, id-joined attendees, issue/project scope). Calendar exists (My Calendar). Mailbox intake is live in production (`app/api/intake`, a Logic App watcher proven end to end). Teams/Slack: not connected. | — |
| **B. Understand** | Detect tasks, commitments, decisions, requirements, risks *from unstructured signal* | Nothing — this is exactly what an LLM call does that this codebase has never had budget to run. | **Yes.** Every one of these five detections is generative understanding of free text. |
| **C. Execute** | Create, assign, track work; follow up | This is most of what Axiomate TMS *is* — Assignment (`setAssignment`), the reducer's full transition graph, `lib/watch.ts`'s proactive daily follow-up pass, the Unified Inbox's "waiting on" tracking. | — |
| **D. Intelligence** | "What's overdue / at risk / needs attention" | Almost entirely real: `lib/watch.ts`'s six conditions (`overdue`, `atRisk`, `dueSoon`, `stale`, `planImpossible`, `sowOverConsumed`), Project Pulse's capacity concern, `lib/mywork.ts`'s decision/waiting split. "What changed this week" and free-text company Q&A are not built. | Free-text natural-language queries ("why is Project Phoenix delayed") need an LLM to parse intent, even though the underlying data is already structured and queryable. |
| **E. Founder/manager cockpit** | One executive view | Portfolio (`lib/portfolio.ts`) is close in spirit — every engagement at once, named concerns, no invented score — but it's delivery-health, not the full company-health rollup (commitments, customers, decisions-required) §20 describes. | — |

**The honest summary**: of the MVP's five slices, four (A, C, D, E) are substantially
buildable — and largely already built — without AI. Only B, the *capture-and-understand* layer
that turns an email into a structured Commitment or Decision, is fundamentally generative and
has been blocked all session on zero Anthropic API credits (task #113). That single blocker is
also why six-plus items from the earlier product-vision pitch (AI Daily Planner, "Tell Axiomate
What Happened", AI Meeting→Work, AI Project Assistant, and now Commitment/Requirement Detection
here) sit in the same queue.

## 6. What "AI agents as workforce" (§15–17) requires, precisely

This is the largest gap between the vision and the codebase, and it is not just "needs credits."
Agent orchestration (§17), autonomous agents (§15), and human+AI work assignment (§16) all
assume:

1. An LLM that can act, not just narrate — the one `/api/assist` integration this codebase has
   is narration-only (`narrationFigures`, read-only prose over already-computed figures,
   explicitly walled off from writing anything — `lib/assist.ts`'s payload construction is
   itself security-reviewed to carry no rates, no leave reasons).
2. A governance layer for *agent* actions specifically — scoped permissions, explainability
   ("why did Axiomate make this recommendation"), audit entries distinguishing agent-initiated
   from human-initiated. `lib/access.ts`'s permission model is real and could extend to this,
   but nothing today attributes an action to an agent rather than a person.
3. Agents as directory entries with roles — the `Person`/`personId` model has no concept of a
   non-human actor today.

None of this is close. It is a genuine, multi-quarter build, not a "next" feature.

## 7. Positioning (§33–35)

Don't compete with Microsoft on "tasks + AI." Don't compete with Jira on "AI agents for
software projects." Don't compete with Notion on "AI knowledge management." Own the coordination
layer between business intent and execution — the thing none of them are built around as their
primary identity.

**Category**: AI Company Execution Platform.
**Problem**: growing companies pay a coordination tax because business intent, communication,
people and execution are fragmented across tools.
**Target**: growing companies, 10–100 employees, technology/SaaS/consulting/service.
**Core promise**: turn organizational intent into accountable execution without proportional
management overhead.

**The one sentence**: *Axiomate turns everything a company says, decides and commits to into
intelligent, accountable execution.*

## 8. What this changes about how this session picks "next"

Every feature shipped this session (Today, Unified Inbox, Project Pulse, Zero-Entry Timesheet,
Automatic Resource Replanning) is, in this framing, real work against **pillars 4, 6, 8, 10, and
12** — Work Management, Execution, Risk Intelligence, Workforce Intelligence, Governance — using
exactly the pattern this vision implies for the non-AI 80%: read real structured data, name a
concern honestly, offer a reviewable suggestion, never invent a fact nobody stated. That pattern
generalizes; it is not incidental to this session.

Going forward, "next" should be read against **pillar 9 (Organizational Memory)** and the
remaining slice of **pillar 11 (Business Operations)** as the next-strongest non-AI-blocked
candidates — both have real, unbuilt structure in this codebase (decisions and commitments
already exist as concepts in `RaidKind`/`ChangeRequest`; customer-facing external collaboration
has a real access-control precedent in the client-scoped guest role, `PERSON_85`/A7). Pillar 2
(Context Graph) and pillar 1's *understanding* half remain the two structurally hardest pieces —
one is a genuine architectural undertaking, the other is squarely behind the AI wall.
