---
type: resource
title: "Configuration taxonomy gap analysis"
created: "2026-09-01"
tags:
  - resource
  - competitive
---

# Configuration taxonomy gap analysis

The user supplied a 21-section, ~180-leaf configuration taxonomy labeled "HIVE." Checked before
treating it as ground truth: several leaves (Cost Centers, Legal Entities among them) do not
appear anywhere in Hive's real documentation (`help.hive.com`), which describes a much narrower
admin surface (Workspace Settings: General/Defaults/Apps — three tabs). **This is not verified
Hive** — the user confirmed it's their own target shape for Axiomate's Configuration, not a
literal Hive scrape, and it's compared on that basis: as an aspirational admin taxonomy, checked
against what `components/ConfigWorkspace.tsx`'s real 25 tabs (3 groups: Operating model,
Automation, Governance) actually cover.

## Verdict key

- **Present** — a real Axiomate tab or mechanism does this today.
- **Partial** — something related exists but doesn't cover the full leaf list.
- **Absent, plausible gap** — nothing today, and a single delivery firm could plausibly want it.
- **Absent, out of scope by design** — nothing today, and it doesn't fit what this product is:
  a single firm's own delivery tool, not a multi-tenant platform sold to many customers.

## Section by section

| # | Section | Verdict | Real Axiomate anchor |
|---|---|---|---|
| 1 | Platform (branding, localization, currencies, system defaults) | Absent, out of scope | Terminology tab covers vocabulary; no white-labeling or multi-language — single-firm, single-language by design |
| 2 | Organization (business units, cost centers, legal entities, org hierarchy) | Absent, out of scope | The tree (company→client→engagement→project→outcome→module) models *client delivery structure*, not internal corporate structure — this product doesn't run a firm's HR/finance org chart |
| 3 | User & People (roles, job titles, career levels, skills, lifecycle) | **Present** | Roles & people, Skills tabs; career profile fields (`PS1`-`PS7`); people are added/removed via directory rather than a formal onboarding/offboarding workflow |
| 4 | Access & Security (permissions, SSO, MFA, session/IP policies, audit) | Partial | Permissions + Capabilities tabs are real and rich (`PERMISSION_KEYS`/`DEFAULT_GRANTS`, this session's reconcile-grants work); SSO is real (Entra ID) but delegated to infra, not app-configurable; MFA/session/IP policies correctly live in Entra, not duplicated here; the audit trail is always-on, not a toggle |
| 5 | Workspace (creation, types, members, templates) | Absent, out of scope | Axiomate is single-workspace-per-tenant — the concept this section assumes doesn't exist here |
| 6 | Project (types, templates, stages, statuses, priorities, milestones, roles, health rules) | **Present** | Work types, Status transitions, Blueprints, Milestones (`lib/milestone.ts`), `ProjectMember` roles, computed (not manually set) health via Portfolio's concerns |
| 7 | Work/Task (types, statuses, categories, custom fields, dependencies, estimates, SLAs, assignment) | **Present** | Work types, Status transitions, Disciplines, Service levels, Responsibilities (the `setAssignment` model), Schedule/Resolution Path for dependencies. No user-defined custom fields — fixed schema by design, matching the "no invented facts" principle this whole codebase follows |
| 8 | Workflow (states, transitions, approvals, escalations, automations) | **Present** | Status transitions, Approvals, Automation tabs — this session's Z (time-driven automation) work confirmed the automation engine directly |
| 9 | Communication (email, chat, channels, templates) | Partial | Mail send/receive (Graph) and per-user notification preferences are real mechanisms; no admin-facing "Communication Configuration" screen. Native chat explicitly skipped on purpose (`docs/plans/2026-08-22-hive-layout-attention-plan.md`: "competes with Teams") |
| 10 | Calendar & Scheduling (working days/hours, holidays, availability) | **Present** | Time recording + Allocation tabs, versioned working patterns (`profileFor`/`resourceProfiles`) — core to the capacity engine, not a peripheral setting |
| 11 | Leave & Availability (types, policies, accrual) | Partial | Leave is a `Commitment` kind with a real approval flow (`leave.approve`) and a private-reason boundary (E1C/E2C) — but leave *types* aren't an admin-configurable taxonomy, they're fixed |
| 12 | Document (types, templates, versioning, retention) | Absent, plausible gap | Document storage and review permission (`document.review`) are real; no admin config for document types/templates |
| 13 | Meeting (types, templates, recording, transcription) | Absent, plausible gap | Meetings work (booked/warned/moved/cancelled, E4B) but aren't admin-configurable |
| 14 | AI (agents, permissions, knowledge sources, governance) | Partial | Agent registry tab is real and names this space directly — but scenario `AI1`'s own stops text says "at the autonomy fields — declared, unread," a known, already-tracked gap, not a new finding |
| 15 | Integration (M365, GitHub, Jira, Slack, CRM, APIs, webhooks) | Partial | Graph/Outlook/Entra integration is real and deep, but env-var/infra-level, not an admin UI. Public API + webhooks is steal-list item 6 in `hive-comparison.md` — already tracked, deliberately deferred |
| 16 | Notification (types, preferences, digest rules) | Partial | Per-user preferences exist (`notificationPrefs`); no admin-facing notification-type/template config screen |
| 17 | Reporting & Analytics (dashboards, KPIs, scheduled reports) | Partial | Report delivery config (this session's resolution-notice work) is real; Portfolio/Project Pulse are fixed, well-designed dashboards, not a user-configurable report builder — a deliberate "named concerns, not a chart" philosophy stated repeatedly in this codebase, not an oversight |
| 18 | Data (custom objects/fields, taxonomies, import/export, retention) | Partial | Terminology (taxonomy), Work types/Disciplines (lookup values), Archive (retention — never-destroy) are real; no user-defined custom objects/fields, matching item 7's own reasoning |
| 19 | Automation (triggers, conditions, scheduled jobs) | **Present** | Automation, Recurring work, Scheduled pass (Watch) tabs — directly, strongly covered |
| 20 | Administration (health, audit, storage, licenses, billing, feature flags) | Absent, mostly out of scope | `/api/health` exists; audit is pervasive rather than a separate screen; no licensing/billing/feature-flag admin — single-tenant deployment has no per-customer billing to manage |
| 21 | Developer (API keys, OAuth apps, webhooks, service accounts) | Absent, tracked gap | No public API surface at all — the same steal-list item 6, restated at finer grain |

## Read

Nine of 21 are real, substantial matches or strong partials (3, 6, 7, 8, 10, 14, 15, 18, 19) —
Axiomate's actual strength, the domain-governed core (work, workflow, automation, scheduling,
capacity), maps closely onto this taxonomy's middle sections. The clearest absences cluster in
two very different buckets:

- **Out of scope by design** (1, 2, 5, most of 20) — this taxonomy assumes a multi-tenant
  platform being configured per customer (branding, licensing, business units, workspaces as a
  first-class concept). Axiomate is one firm's own tool. Building these would be solving a
  problem this product doesn't have.
- **Plausible, previously-untracked gaps** (12 Document, 13 Meeting, and pieces of 9/16/17) —
  real mechanisms exist underneath, but nothing lets an admin *configure* the vocabulary around
  them (document types, meeting types, notification templates). Smaller and more concrete than
  they look in the taxonomy — likely a few fields each, not new subsystems.

Nothing here duplicates or contradicts the existing steal-list (`hive-comparison.md`) — items 6
(API/webhooks) and 21 overlap exactly, confirmed rather than newly found.

## Related

- [[hive-comparison]]
- [[hive-screen-comparison]]
