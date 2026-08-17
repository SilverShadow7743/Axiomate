# Axiomate — product audit

*17 August 2026. Evidence-based. Every claim below was traced to a file, a schema line, a live
database query or the project's own scenario harness. Where something is absent, "absent" means
a repo-wide search found nothing — not that it was not looked for.*

Labels used throughout: **Observed** (fact), **Gap**, **Risk**, **Recommendation**.

---

## A. Executive assessment

**Axiomate is a well-built delivery-tracking system with an unusually honest engineering culture,
sitting roughly one third of the way to being a consulting operating system.**

What exists is better than most products at this stage: a pure reducer as the single mutation
funnel, attribution as a parameter that cannot be forged, a 57-scenario harness that is a map of
what does *not* work rather than a pass/fail badge, five independent proofs, and a codebase that
argues with itself in comments and records why it rejected things. That discipline is an asset
and should not be traded away for speed.

Three findings dominate everything else.

**1. There is no financial layer at all.** Not partial — absent. No cost rate, no bill rate, no
invoice, no revenue, no margin, anywhere in the schema or the types. Every occurrence of those
words is a comment or an agent description. The product can tell you a SOW is forty hours over.
It cannot tell you what that cost, what it earned, or whether it made money. Capability domain 10
is empty, and domains 8 (allocation intelligence) and 12 (several agents) depend on it.

**2. The commercial spine is built and unused.** `Sow` is a real, well-shaped model — and it has
**zero rows in production**. So do `Approval`, `Evidence`, `IssueActivity`, `IssueDependency`,
`Commitment` and `EstimateRevision`. Eight of twenty-five tables have never been written to. The
delivery layer that *is* used is issues, notes, allocations, estimates and audit.

**3. The entire master-data layer is one 35 KB JSON document.** People, roles, resource profiles,
work types, disciplines, agents, workflows, templates, SLA and the access policy all live in a
single `OperatingModel.model Json` column, one row per tenant. Every org concept the vision needs
— legal entity, business unit, department, practice, service line, team, location, country,
skills, certifications — would have to land there too, or force a real schema. This is the single
most consequential architectural decision to revisit.

**Maturity by domain**, on the vision's own fifteen:

| Domain | State |
|---|---|
| 5 Delivery & work management | **Strong** — the core of the product |
| 15 Security & governance | **Strong** for authorisation and audit; weak for isolation |
| 7 Project governance (RAID) | **Partial** — issues yes, risks/decisions/actions no |
| 9 Timesheets | **Partial** — built today, honest, thin |
| 2 Resource & people | **Partial** — capacity yes, profile no, skills absent |
| 3 Commercial lifecycle | **Partial** — SOW exists and is unused; no lead, no CR entity |
| 6 Milestones & outcomes | **Weak** — a boolean on an activity |
| 11 Workflow & automation | **Weak** — declared, not executed |
| 14 Notifications | **Weak** — an in-app inbox; no transport |
| 13 Documents | **Weak** — metadata only; no file is ever stored |
| 1 Organisation master data | **Minimal** |
| 8 Allocation intelligence | **Minimal** — capacity arithmetic, no skills, no cost |
| 12 AI agents | **Minimal** — 2 of 38 run |
| 4 SOW intelligence | **Absent** |
| 10 Billing, cost, margin | **Absent** |

**The architecture can support the intended product**, with two changes that should happen before
much more is built: master data must leave the JSON blob, and people must acquire stable keys.
Neither is a rewrite. Both get harder every month.

---

## B. Current feature inventory

Status vocabulary as requested. "Evidence" cites the actual implementation.

### Delivery and work management

| Module | Feature | Status | Evidence | Current capability | Gap | Recommended action |
|---|---|---|---|---|---|---|
| Hierarchy | 5 structural tiers | **Implemented & working** | `ALLOWED_PARENTS` `lib/workspace.ts:347`; 59 rows | Company▸Client▸Engagement▸Project▸Process Area, compile-checked | No Work Package / Process / Scenario tier | Keep; add tiers only if a real engagement needs them |
| Work items | One table, typed | **Implemented & working** | `Issue`; 224 rows; 7 types in data | Issues, defects, CRs, tasks nest to any depth | — | Keep. The one-table decision is argued and right |
| Discipline | 3rd classification axis | **Implemented & working** | `Issue.discipline`, migration `…_discipline`; 14 seeded | Technical/Functional/Data… independent of type and module | 216 issues unclassified | Classify the back catalogue |
| Lifecycle activities | Phases under an issue | **Backend only / not exposed in use** | `IssueActivity`; **0 rows** | Builder generates 5 phases | Nobody uses it | Validate before extending |
| Dependencies | FS/SS/FF/SF between activities | **Backend only / not used** | `IssueDependency`; **0 rows** | Full scheduling constraint model | Unused | Validate |
| Gantt | Timeline rendering | **Implemented — needs validation** | `components/GanttChart.tsx` | Renders from planned dates | Depends on activities, which are unused | Validate |
| Row actions | ⋮ menu, inline edit | **Implemented — needs validation** | `components/RowMenu.tsx`, `StatusCellEditor.tsx` | Add/edit/move/duplicate/link/log time | Never opened in a browser | **Click it** |
| Duplicate | Copy + `DUPLICATE_OF` | **Implemented & working** | `duplicate` arm `lib/workspace.ts` | Always records the link | — | Keep |

### Commercial

| Module | Feature | Status | Evidence | Current capability | Gap | Recommended action |
|---|---|---|---|---|---|---|
| SOW | Contract record | **Backend only / never used** | `Sow` schema:636; **0 rows** | reference, status, dates, effortHours, value+currency, scope, exclusions, acceptance | No deliverables, milestones, assumptions, risks, roles, versioning, document | Use it before extending it |
| SOW | Consumption | **Implemented — needs validation** | `sowPosition` `lib/sow.ts:96` | baseline vs planned vs actual **hours** | Value never consumed against anything | Add money after rates exist |
| SOW | Variation | **Partial** | `SOW_STATUSES` includes `Varied` | A status says a variation happened | Nothing says what it was or what it was worth | Model CR as an entity |
| Change Request | Commercial change | **Planned but missing** | `type = 'Change Request'` string only | An issue with a type | No scope, effort, value, approval, effective date, SOW link | **P1 — model it** |
| Lead / Opportunity | Pre-sale | **Missing entirely** | repo-wide search: nothing | — | Chain starts at a signed contract | Decide if in scope |
| Engagement | Commercial envelope | **Implemented & working** | `Engagement` sidecar; 3 rows | leader, PM, sponsor, type, status, dates | No history of who led it when | Keep |

### People, capacity, time

| Module | Feature | Status | Evidence | Current capability | Gap | Recommended action |
|---|---|---|---|---|---|---|
| Directory | People | **Partially implemented** | `Person` `lib/config.ts:182`; 26 in JSON | 9 fields: id, name, roleIds, email, grade, track, developingToward, source | Not a table. No manager, location, employment type, dates | **Refactor to a model** |
| Resource profile | Working pattern | **Implemented & working** | `ResourceProfile`; 24 entries | hoursPerDay, daysPerWeek, billableTargetPct, source | No cost, no bill rate, no location class | Add rates (protected) |
| Effective dating | Dated history | **Implemented & working** | `Version` + migration; 6 rows | valid periods, exclusive `validTo`, reason, identity | **One subject kind in use** | Extend to role, manager, rate |
| Stamping | Freeze a value | **Backend only / no consumer** | `Stamped<T>` `lib/versioning.ts:89` | Declared, proven in isolation | Nothing stamps anything | Wire when rates exist |
| Allocation | Person→project % | **Implemented & working** | `Allocation`; 6 rows | %, period, overallocation refusal | Name-keyed | Key by person id |
| Commitment | Leave/holiday | **Backend only / not used** | `Commitment`; **0 rows** | 4 kinds, comes off capacity | No calendar entity; a holiday is N rows | Add a holiday calendar |
| Timesheets | Weekly attestation | **Implemented — needs validation** | `lib/timesheet.ts`, `Timesheet`; 0 rows | Mon-start week, submit, approve, return with reason, freeze | No outcome codes, no bucket hours, no lock rule, no My Timesheet view | Validate, then extend |
| Time entries | Hours | **Implemented & working** | `TimeEntry`; 3 rows | date, hours, activity, billable, note | No rate, so no cost | Depends on rates |
| Capacity | Available vs allocated | **Implemented & working** | `capacityFor`, `CapacityPosition` | gross/committed/available/allocated/remaining + `basis` | Assumes Mon–Fri; no skills | Keep |

### Estimation

| Module | Feature | Status | Evidence | Capability | Gap | Action |
|---|---|---|---|---|---|---|
| Estimation | Complexity → size → hours | **Implemented & working** | `IssueEstimate`; 110 rows | 5 scores, T-shirt bands, breakdown, confidence | — | Keep |
| Estimation agent | Auto-proposal | **Implemented & working** | `lib/estimator.ts`; 108 proposals | Domain-gated, provenance in assumptions, never baselined | Rule-based, not learned | Keep |
| Revisions | Post-baseline change log | **Backend only / not used** | `EstimateRevision`; **0 rows** | from/to snapshots + reason | Nothing baselined yet | Validate |

### Platform

| Module | Feature | Status | Evidence | Capability | Gap | Action |
|---|---|---|---|---|---|---|
| Authentication | Entra OIDC | **Implemented & working** | `lib/auth/`, live | auth-code + PKCE, signed cookie, verified identity | — | Keep |
| Authorisation | 28 permissions, 11 roles | **Implemented & working** | `lib/access.ts`; enforced at the funnel | Per-action, compile-enforced table | Coarse by design | Keep |
| Audit | Every change | **Implemented & working** | `ScheduleAudit`; 356 rows | field-level from/to, actor id + email | Keyed by `rowId` string, no FK | Keep |
| Tenancy | Composite keys + branded type | **Partial** | `lib/tenant.ts`, `audit:tenancy` | Compile-time scoping, 77 calls checked | **No RLS. One deployment = one tenant via env var** | See D |
| Idempotency | Re-delivered batches | **Implemented & working** | `AppliedAction`; 40 rows | Per-action keys, 30-day prune | — | Keep |
| Intake | Email → issue | **Implemented & working** | `/api/intake`, Logic App live | Classifies, files, provenance `guessed` | No real client mail has flowed | Watch one arrive |
| Scheduled pass | Daily clock | **Implemented & working** | Logic App, run verified | Ages issues, SLA, prunes keys | — | Keep |
| Notifications | In-app inbox | **Partially implemented** | `Notification`; 1 row | Raised, read, delivery status | **No transport exists** — no SMTP, Graph or Teams code | See C |
| Documents | Evidence | **UI only / placeholder** | `Evidence`; **0 rows** | Metadata + optional external URL | **No file is ever stored.** `blob:` URLs are explicitly refused | See C |
| Agents | Registry | **Backend only / declared** | 38 agents, **2 live** | Registry is the design | 36 do nothing, and the UI says so | Keep the honesty |
| Workflow | Steps | **Backend only / not executed** | `WorkflowRecord`; 2 seeded | Stored, orderable | Nothing runs them | See C |
| Reporting | Daily IMS | **Partially implemented** | `lib/reports/dailyIms` | CSV/text export | Scenario RP2 `NOT IMPLEMENTED` | P2 |

---

## B2. Built, but with no way in

**This is the single most actionable section of the audit**, and it answers the vision's
questions 3 and 4 directly. These are not gaps in the model — the reducer arm exists, the
permission exists, the persist arm exists, the table exists. There is simply no screen that
dispatches it.

### Reducer arms with no UI dispatcher (11)

| Action | Consequence today | Action |
|---|---|---|
| `upsertCommitment` / `removeCommitment` | **This is why `Commitment` has 0 rows.** Nobody can record leave or a public holiday, so capacity subtracts nothing and every availability figure is optimistic. `CapacityPanel` *reads* commitments it gives no way to create | **P1 — a form** |
| `updateTime` | An hour can be logged and withdrawn but **not corrected**. The reducer arm, the API allowlist entry and the persist arm all exist | **P1 — an edit control** |
| `correctVersion` | A working pattern can be recorded and never corrected — half the effective-dating mechanism is unreachable | **P2** |
| `archiveSow` | A SOW can be created and never retired | P2 |
| `setResourceProfile` | The stored working pattern cannot be edited from any screen | P2 |
| `upsertDiscipline` / `deleteDiscipline` | The 14 disciplines cannot be renamed or extended by a firm | P2 |
| `deletePerson` | Somebody can be added to the directory and never removed | P3 |
| `setWorkflowEnabled` | **Doubly unreachable**: nothing dispatches it, and the arm refuses anyway because both seeded workflows are `declared` | Remove or implement |
| `notify` | Unreachable **by design** — excluded from the API allowlist because client and server run the same planner, so a `notify` over the wire could only be one the client invented | Keep as is |

### Update, same day — eight of the eleven are now reachable

`upsertCommitment` / `removeCommitment` (leave and holidays, with the commitments touching the
window shown beside the allocations they were silently subtracted from), `updateTime` (a Correct
control, deliberately not offering date or person — moving an entry between weeks or people is
not a correction and the freeze is built around that), `correctVersion` (on each period in the
working-weeks timeline), `archiveSow`, `deletePerson`, and `upsertDiscipline` / `deleteDiscipline`
(a new Disciplines tab in Configuration).

**Two remain unwired, and both are decisions rather than omissions:**

- **`setResourceProfile`** — it edits the *stored* working pattern, which effective dating has
  now superseded: `recordVersion` is the route, and it carries a date and a reason where this
  carries neither. Wiring it would offer two ways to change one fact, one of which loses the
  history. **Recommendation: delete the arm**, once nothing depends on it.
- **`setWorkflowEnabled`** — unreachable *and* self-refusing, because both seeded workflows are
  `declared` and the arm refuses to enable a workflow with no runtime. It is correct in refusing.
  **Recommendation: remove the arm and the two seeded workflows**, or build an executor. A
  mechanism that stores, renders and refuses is the one shape this codebase otherwise avoids.

### Rendered, but with no way through

- **`EvidencePanel` persists a dead URL.** A picked file becomes `URL.createObjectURL(file)` — a
  handle into one browser session — and the reducer stores that `blob:` string **in the Evidence
  table as text**. It is dead on the next page load. The footer says so honestly, but the row is
  written either way. *(Note: `lib/db/map.ts` nulls a `blob:` URL on the way to Postgres, so the
  damage is contained — but the in-memory record and the mirror still carry it.)*
- **`lib/timeWindow.ts` — 441 lines, imported by exactly one file: the validation script.** The
  overrun warning, the closed-issue window, the derived opening date and the daily cap are all
  built and none of it is consulted by `addTime`. This is Phase 5 of the plan and it is the
  largest single piece of finished-but-unwired code in the repo.
- **`AGENT_ESTIMATION` is not reachable from the application.** `lib/estimator.ts` is imported
  only by `scripts/estimate-backlog.ts`, a CLI. So of 39 registry entries, **exactly one —
  the workspace assistant — changes anything a user can see.**
- **`AgentRecord.requireApproval` is inert.** It is stored, rendered, and audited when changed.
  It is never read in a conditional.

### Corrections to my own earlier statements and to the repo's documentation

Recorded because a stale map is worse than no map, and this audit found four instances:

1. `lib/config.ts` says "38 entries… exactly one of which has a runtime." There are **39**, and
   **two** are `live` — contradicted 34 lines later in the same file.
2. Scenario `AI1` says autonomy fields are "registry fields with no runtime that reads them".
   `resolveAutonomy` **is** read, in `IssueWorkspace.tsx`, to gate what the assistant may do.
   The unread field is `requireApproval`.
3. Scenario `U2` said "no timesheet is stored yet" — **written by me this morning and left stale
   by my own commit that afternoon.** Corrected.
4. `lib/time.ts` predicts a timesheet "will name exactly which entries it covered". The timesheet
   that shipped deliberately does not, and argues why.

**`data/validation.json` contains 59 findings, not 57** — two carry an alias (`ST4`/`AB`,
`AI1`/`X`), which is the likely origin of the figure quoted everywhere including this document.

### One unauthenticated route

`GET /api/health` returns `{status, database, checkedAt}` with no auth. It leaks only whether a
database is reachable. **Observed, not flagged as a risk** — this is normal for a liveness probe
and the App Service warm-up depends on it.

---

## C. Missing and incomplete, by capability domain

### 1. Organisation master data — **minimal**

**Observed.** Only two org concepts exist: `OrganizationIdentity` (name, shortName, partyCode,
description) and the person directory — both inside the JSON blob.

**Absent entirely:** legal entity (beyond one name), business unit, department, practice, service
line, team, location, country, employment type, contractor type, skills, skill proficiency,
certifications, reporting manager, career framework.

**Partial:** working calendar is **hardcoded Mon–Fri** (`workingDaysBetween` skips days 0 and 6);
a four-day week is applied as a *ratio*, and which day is off is explicitly not modelled. Holiday
calendar does not exist as an entity — a public holiday is one `Commitment` row **per person**.
Time zone exists only as a viewer display preference. Grade/track are free text.

**Risk.** Every one of these is a downstream dependency. Skills block allocation intelligence.
Cost rate blocks margin. Location blocks onshore/offshore. Employment type blocks contractor
invoicing. Building any of domains 8, 10 or 12 without them produces a screen that cannot be
populated.

> **Since the audit (17 August).** Three of these were built and are live: `PersonRate`
> (effective-dated cost and charge-out), `ChangeRequest` (a signed delta against a SOW baseline),
> and `Skill` + `PersonSkill` (named levels, provenance, and when the skill was last used). The
> paragraph above stands for what remains — location, employment type, certifications, industry
> and past experience are all still absent. The entries below are annotated where they have
> changed; anything unannotated is still true.

### 2. Resource and people — **partial**

**Observed.** Core profile: name, email, roleIds, grade, track — 9 fields. Delivery profile:
hoursPerDay, daysPerWeek, billableTargetPct, availability, capacity, current allocation.

**Gap.** First/last name (one `name` string only), base location, country, time zone, employment
type, resource type, job, reporting manager. Entire professional profile: skills, levels, past
experience, certifications, expertise, specialisation, industry. Entire financial profile:
internal cost rate, bill rate, onshore/offshore.

**On protecting sensitive rate fields:** there is nothing to protect yet. When rates arrive they
need a permission of their own — the current model is coarse by design and has no field-level
scoping, which is documented as deliberate. That decision must be revisited for rates.

### 3. Commercial lifecycle — **partial, with one structural defect**

**Observed.** Client ▸ Engagement ▸ SOW ▸ Project all exist. One engagement **can** have many
SOWs. A project links to a SOW via `HierarchyNode.sowId`.

**Gap.** No Lead or Opportunity. No Change Request entity. No baseline-vs-approved-changes.
No commercial versioning. No planned or actual revenue. `Sow.value` is recorded and never
consumed against anything.

**Defect (observed).** SOW audit entries are filed under `rowId = engagementId`, not the SOW id.
Given the audit index is `(tenantId, rowId, at)`, **"the history of this SOW" is not a queryable
question**, and two SOWs under one engagement interleave into one stream.

**Duplicate (observed).** `Engagement.sowReference` — the free-text field the `Sow` model was
built to replace — still exists and still counts toward engagement completeness.

### 4. SOW intelligence — **absent**

Nothing extracts scope, deliverables, assumptions, exclusions, acceptance criteria, timeline,
milestones, effort, commercial model, roles, dependencies or risks from a document. There is no
document. `Sow.scope`, `exclusions` and `acceptanceCriteria` are three free-text blobs somebody
types.

The codebase states its own boundary honestly (`lib/sow.ts:22`): reading a scope statement and
deciding whether a request is inside it *"is a judgement, and pretending otherwise would be the
worst kind of feature: a machine answer to a commercial question, wrong occasionally and
confidently."*

**Minimum viable architecture, if built:**

1. `SowDocument` — file storage first (see 13); a SOW without a document cannot be extracted from.
2. `SowScopeItem` — `{ sowId, kind: deliverable|assumption|exclusion|acceptance|milestone, text,
   effortHours?, source: 'stated'|'extracted', confidence, approvedBy, approvedAt }`.
3. Extraction proposes rows with `source: 'extracted'`; **a person promotes them to `stated`**.
   Nothing extracted is ever a baseline until approved — the same shape the estimation agent
   already uses, and the same rule as `ResourceProfile.source`.
4. Baseline = the approved set at a point in time. A CR adds items and supersedes others.

Do not build this before file storage and the CR entity exist.

### 5. Delivery and work management — **strong, with one rigidity**

**Gap.** The hierarchy cannot express Work Package, Process or Scenario. Process Area exists (the
`module` tier). Deliverable is namable as a work type but would be a flat issue, not a container.

**Recommendation.** Do **not** add tiers speculatively. The one-table + configurable-type design
is sound and argued. If Deliverable needs children, the cheapest correct change is to allow
`issue` under `issue` — which already works — and add a `Deliverable` work type.

### 6. Milestones and outcomes — **weak, and the most under-built domain relative to the vision**

**Observed.** A milestone is `IssueActivity.isMilestone = true`. It carries: phase (used as its
name), owner, planned dates, percentComplete. Zero-duration by construction.

**Gap.** No objective, no success criteria, no acceptance criteria, no completion evidence, no
approval, no forecast date, no risks/blockers link. **A milestone can only exist beneath an
issue** — there is no project-, engagement- or SOW-level milestone.

**Risk.** Three declared agents assume project-level milestones exist (`AGENT_PROJECT_HEALTH`,
`AGENT_MILESTONE_RISK`, `AGENT_BILLING_READY`). Milestone billing is impossible without one.

Can the system answer the vision's four questions today?

| Question | Answer |
|---|---|
| What blocks delivery? | **Partly** — blocked-by-dependency exists, but `IssueDependency` has 0 rows |
| Which milestone is at risk? | **No** — no project milestone, no forecast |
| What outcome is expected next? | **No** — there is no outcome concept |
| What has been delivered but not accepted? | **No** — no acceptance state on work |

### 7. Project governance — **partial**

**Observed.** Issues, ownership, severity, priority (via severity), aging, SLA, resolution
tracking, escalation conditions — all real. Decisions and blockers exist as **note types**.

**Gap.** No RAID structure. Risk, Assumption and Decision are not records — they have no owner,
no probability/impact, no review date, no mitigation. Actions exist as a work type.

**Recommendation.** Do **not** build four new modules. The vision itself warns against this. Add
`Risk` and `Decision` as **work types** with a small set of type-specific fields, reusing the
existing issue machinery — ownership, aging, audit, notes and approval all come free. That is the
architecture already in place, and `lib/config.ts` explicitly declined to seed them only because
the imported log did not contain any.

### 8. Allocation intelligence — **minimal**

**Observed.** Availability, capacity, allocation %, dates, partial allocation, over-allocation
refusal with an explicit override, and — as of today — capacity computed against the working
pattern *in force at the time*, with `basis` saying whether that pattern was stated or assumed.

**Gap.** The whole intelligence chain. No skills, so no deliverable→skill→resource matching. No
bench view. No future demand. No cost, so no margin impact.

**The desired flow cannot be supported today**: it requires skills (absent), demand (absent) and
cost (absent). Capacity — the middle link — is the only part that exists.

### 9. Timesheets — **partial, honest**

**Observed.** Mon–Sun week, submit, approve, return-with-reason, resubmit, freeze on all three
time arms, self-approval refused, empty week submittable, durable across reload (33/33 proof).

**Gap.** Outcome-based entry and outcome codes (O-S01…), bucket hours, Tuesday lock rule, a
My Timesheet view, weekly totals against expected. Time links to an **issue**, not to an outcome
or a deliverable.

**The question asked — are timesheets connected to Delivery → Cost → Billing → Utilisation →
Forecasting?** Delivery: yes. Utilisation: partly (`billableTargetPct` exists; nothing computes
against it). **Cost, billing and forecasting: no — there is no rate.**

### 10. Billing, cost and margin — **absent**

Nothing in this domain exists. Not T&M, not fixed price, not retainer, not milestone billing, not
invoicing, not payment terms, not rates, not revenue, not margin.

**This is the largest single gap and the highest-value one**, because it is what makes the rest
commercially meaningful — and because three domains depend on it.

### 11. Workflow and automation — **weak**

**Observed.** Approval rules exist and gate issue status transitions. Automation rules exist (4
configured). The scheduled pass runs daily and raises conditions once. `WorkflowRecord` stores
ordered agent steps.

**Gap.** Nothing executes a workflow. Configurable workflow states exist only for issue status.
No assignment rules, no reminder logic, no batch jobs beyond the daily pass.

**Observed — and this is the good news:** workflow logic is **centralised**, not scattered. Every
mutation goes through one reducer with one permission check. That is the right foundation.

### 12. AI and agents — **2 of 38 live**

| Agent | Status | Inputs | Data required | Output | Human approval | Priority |
|---|---|---|---|---|---|---|
| Workspace Assistant | **Live** | free text | workspace state | proposed actions | yes — `propose` | keep |
| Estimation | **Live** | subject, description, module, type, severity | domain gate | 5 complexity scores + basis | yes — never baselined | keep |
| Email Intake | **Live in effect** | mailbox message | routing rules | classified issue | provenance `guessed` | keep |
| Timesheet Intelligence | declared | entries, weeks | timesheets ✓ | missing time, wrong coding | required | **P2 — now feasible** |
| SOW Intelligence | declared | SOW document | **file storage — absent** | structured scope | required | P3 — blocked |
| Resource Allocation / Skill Match | declared | demand, skills | skills ✓ · **demand — absent** | recommended allocation | required | **P2 — half unblocked.** `candidatesFor` answers "who could do this" from recorded skill and returns candidates, never a ranking. Nothing yet states what a deliverable *needs*, so the requirement has to be typed rather than read |
| Margin Protection | declared | revenue, cost, hours | rates ✓ | threshold breach | required | **P2 — unblocked.** `costOf` prices each hour at the rate in force on its own date, and reports the whole total as absent rather than short when any hour is unrated |
| Milestone Risk | declared | milestones | **project milestones — absent** | forecast | required | P3 — blocked |
| Duplicate Detection | declared | inbound issue | issues ✓ | is this new? | `suggest` | **P2 — feasible now** |
| Issue Triage / Routing | declared | new issue | routing rules ✓, skills ✗ | severity, owner | required | P2 partial |

**Observed.** Six of the ten most-wanted agents are blocked on data that does not exist. This is
the clearest argument for sequencing: **agents are the last release, not the next one.**

**Recommendation.** Build only the three whose data already exists — Timesheet Intelligence,
Duplicate Detection, Triage — and only after the data they read is actually in use.

### 13. Documents — **weak**

**Observed.** `Evidence` records name, kind, purpose, note, origin and an optional URL. **No file
is ever stored.** There is no blob storage, no SharePoint integration, no upload handler; a
`blob:` URL is explicitly nulled on save because it is a handle into one browser session.

**Gap.** File upload, storage, version history, SharePoint, calendar. `detectSourceDocument`
surfaces a filename found in an issue's subject and labels it *"file not held by this app"* —
which is honest and is the whole current capability.

**Risk.** Deliverable evidence, SOW documents and acceptance proof all depend on this. It is a
prerequisite for domains 4 and 6.

### 14. Notifications — **weak**

**Observed.** In-app inbox works: raised, targeted, read state, delivery status, failure visible.
Three channels are *typed* — in-app, email, teams.

**Gap.** **No transport exists.** No SMTP, no Graph, no webhook code anywhere. Email and Teams
notifications are recorded as pending and never sent. Scenario W (P1) says exactly this.

### 15. Security and governance — **strong, with one stated limit**

**Observed.** Entra OIDC with PKCE, nonce and issuer/audience verification. Signed session cookie
with `Secure` derived from the public origin. 28 permissions enforced at the single funnel, with
the table now compile-checked against the action union. Full audit with actor id and email.
Secrets validated for length and placeholder shape.

**Gap / Risk.** **No row-level security.** Tenancy is composite keys + a branded `TenantId` +
a text-scanning CI check. One deployment serves one tenant, resolved from an environment
variable. The schema says so plainly: *"Nothing here stops a query that forgets its `where`."*
This is adequate for one firm and **not** adequate for multi-tenant SaaS.

---

## D. Architecture and database assessment

### Keep

- **Composite `(tenantId, id)` keys on every table.** Applied without exception. Correct.
- **The pure reducer as the single mutation funnel**, with the actor as a parameter. This is what
  makes audit, permissions and replay trustworthy, and it is enforced by a CI check.
- **Derived values are not stored.** `duration`, `scheduleHealth`, `projectedCompletionDate` were
  deliberately removed. Estimation stores inputs, not results. Keep this rule absolutely.
- **One work-item table with a configurable type.** Argued from the data, not from a blueprint.
- **`Version` as a general effective-dating mechanism.** Exclusive `validTo`, reason required,
  identity stamped. It is right and it is under-used.
- **The scenario harness and the five proofs.** This is the project's competitive advantage.

### Refactor

| What | Why | Effort |
|---|---|---|
| **Master data out of `OperatingModel` JSON** | 35 KB blob holds people, roles, profiles, types, disciplines, agents, workflows, templates, SLA, access. No referential integrity, no per-entity history, whole document rewritten per change. Cannot absorb legal entities, BUs, practices, locations, skills, calendars | **L** |
| **People get a stable key** | `TimeEntry.person`, `Allocation.person`, `Commitment.person`, `Timesheet.person`, `Notification.to` are all **name strings**. This cost real breakage twice today. The schema itself says *"until people have keys"* | **M** |
| **SOW audit keyed by SOW id** | Currently filed under `engagementId`, so SOW history is unqueryable | **S** |
| **`Engagement.sowReference` removed** | Duplicate of the `Sow` model it was built to replace, still counted in completeness | **S** |
| **`AccountableParty` union** | Hardcoded 5 values in `lib/types.ts`, duplicated in two more files in different orders, while the DB column and `model.parties` are both open | **S** |
| **`ENGAGEMENT_TYPES` / `SOW_STATUSES`** | Closed TS unions over columns the schema deliberately left open, with a comment arguing for openness | **S** |
| **Six models lack `deletedAt`** | Against the schema's own claim that nothing is destroyed | **S** |

### Add

| Entity | Why | Priority |
|---|---|---|
| ~~`RateCard` / `PersonRate` (effective-dated)~~ | Unblocks cost, margin, billing, three agents | **BUILT** — `lib/rates.ts`, withheld whole from anybody without `rate.view` |
| ~~`ChangeRequest`~~ | Commercial change is currently a string | **BUILT** — a signed delta; the SOW baseline is never edited |
| ~~`Skill`, `PersonSkill` (with proficiency)~~ | Unblocks allocation intelligence and two agents | **BUILT** — named levels not numbers, provenance (`self`/`assessed`/`certified`), and `lastUsedOn` so a lapsed skill reads as lapsed. Catalogue in the model, levels in a table, judgement fields redacted at the boundary |
| `Document` / file storage | Unblocks SOW intelligence and deliverable evidence | **P1** |
| `Milestone` as a first-class record at project/SOW level | Unblocks outcomes, milestone billing, two agents | **P1** |
| `HolidayCalendar` + `CalendarDay` | A holiday is currently N person-rows; Mon–Fri is hardcoded | **P2** |
| `Location`, `BusinessUnit`, `Practice` | Org master data; onshore/offshore | **P2** |
| `Invoice`, `InvoiceLine` | After rates | **P2** |
| `Lead` / `Opportunity` | Only if pre-sale is in scope | **P3** |

### Remove

- `Engagement.sowReference` (superseded by `Sow`).
- Duplicate `SEVERITIES` / `ACCOUNTABLES` declarations in `lib/chat.ts` and `lib/editing.ts`.
- Nothing else. There is very little dead code — the declared agents are honestly labelled and
  the registry is deliberate.

---

## E. Duplicate and overlap analysis

| Overlap | Observed | Single source of truth | Action |
|---|---|---|---|
| **Resource vs User** | One `Person`, no separate user. Actor resolves to it by id→email→name | `Person` — but it needs to be a table with a stable id | Refactor; keep one concept |
| **Role vs Job vs Title** | `roleIds` = permissions; `grade`/`track` = career. **Correctly separated already**, and argued | Role = access. Grade = career | Keep. Do not merge |
| **Task vs Work Item** | One `Issue` table; Task is a `type` value | `Issue` | Keep |
| **Project vs Engagement** | Distinct tiers; Engagement has a commercial sidecar | Both, correctly | Keep |
| **Deliverable vs Milestone** | Neither is a first-class record | — | Add Milestone as a record; Deliverable as a work type |
| **Issue vs Risk vs Action** | Action is a work type; Risk and Decision are **note types** | `Issue` + type | Promote Risk and Decision to work types, not modules |
| **Notification vs Alert** | One `Notification` model, channel-typed | `Notification` | Keep |
| **Workflow vs Automation** | `WorkflowRecord` (unexecuted) and `automationRules` (executed) — **two mechanisms for one idea** | `automationRules`, which runs | Fold workflows into automation, or delete the unexecuted one |
| **Skill vs Capability** | ~~Neither exists~~ **Added once, as `Skill`** | `Skill` + `PersonSkill` | Done. "Capability" is not a second concept and should not become one |
| **Timesheet outcome vs Work item** | Time links to an issue; no outcome concept | Decide before building outcome codes | See validation questions |
| **SOW scope vs Project scope** | `Sow.scope` free text; project scope is the issue tree | Ambiguous — this is the SOW intelligence gap | Structure SOW scope items |
| **CR vs Project change** | CR is a work type; `Sow.status='Varied'` is the only commercial trace | `ChangeRequest` entity | **Add it** |
| **`sowReference` vs `Sow`** | Both exist | `Sow` | **Remove the string** |

---

## F. Priority gap matrix

| Capability | Existing | Partial | Missing | Priority | Dependency | Recommended next step |
|---|:--:|:--:|:--:|---|---|---|
| Row-level security / real multi-tenancy | | ✓ | | **P0** | identity ✓ (now exists) | Design RLS; identity is no longer the blocker |
| People as a table with stable keys | | ✓ | | **P0** | — | Migrate from JSON; add `personId` FKs |
| Rate card (cost + bill), effective-dated | | | ✓ | **P0** | `Version` ✓ | Model rates; protect with a new permission |
| Master data out of JSON | | ✓ | | **P0** | — | Start with people; then roles, profiles |
| Change Request entity | | | ✓ | **P1** | SOW ✓ | Model with scope, effort, value, approval, dates |
| Milestone as a first-class record | | ✓ | | **P1** | — | Project/SOW level, with acceptance and evidence |
| File storage | | | ✓ | **P1** | Azure Blob | Upload → store → link to Evidence/SOW |
| ~~Skills + proficiency~~ | | | ✓ | **DONE** | people table | `Skill`, `PersonSkill` — reachable: catalogue, record, correct, withdraw |
| Notification transport | | ✓ | | **P1** | Graph/SMTP | Email first; Teams second |
| Use the SOW module | ✓ | | | **P1** | — | Enter the real OAPIL/SLG contracts |
| Validate what was built today | | ✓ | | **P1** | — | Click the row menu, timesheet, capacity tab |
| Invoicing + margin | | | ✓ | **P2** | rates | After rates and CR |
| RAID as work types | | ✓ | | **P2** | — | Add Risk, Decision types |
| Holiday calendar | | ✓ | | **P2** | — | Calendar entity; stop per-person rows |
| Timesheet outcomes / bucket hours | | ✓ | | **P2** | outcome model | Answer the validation question first |
| Reporting (RP2) | | | ✓ | **P2** | — | Weekly client + monthly governance |
| Org tiers (BU, practice, location) | | | ✓ | **P2** | master data refactor | After the JSON refactor |
| Workflow execution | | ✓ | | **P3** | — | Or delete the unexecuted mechanism |
| Blocked agents (margin, skill, SOW, milestone) | | | ✓ | **P3** | all of the above | Do not build yet |
| Lead / Opportunity / CRM | | | ✓ | **Future** | — | Decide if in scope at all |
| SOW document extraction | | | ✓ | **Future** | file storage, CR | Not before its dependencies |

---

## G. Recommended roadmap

### Release 1 — Foundation
*Correct master data, keys and security. Nothing user-visible. This is the release that makes the
rest possible.*

| Feature | Problem solved | Dependencies | Size | Build/Refactor/Validate |
|---|---|---|---|---|
| People as a Prisma model with stable ids | Renaming a person orphans their allocations, time and notifications. Cost real breakage twice today | — | **L** | Refactor |
| `personId` FKs on Allocation, Commitment, TimeEntry, Timesheet, Notification | Same | people table | **M** | Refactor |
| Effective-dated rate card (cost + bill) | Nothing can be costed, billed or margined | `Version` ✓ | **M** | Build |
| Field-level protection for rates | Rates must not be visible to everyone; the model is coarse by design | permissions | **S** | Build |
| Row-level security | Multi-tenant isolation is a discipline, not a guarantee | identity ✓ | **L** | Build |
| Remove `sowReference`; fix SOW audit key | Duplicate truth; SOW history unqueryable | — | **S** | Refactor |

### Release 2 — Delivery control
*Run a real engagement end to end.*

| Feature | Problem solved | Dependencies | Size | Action |
|---|---|---|---|---|
| Use the SOW module for real contracts | The commercial spine has zero rows | — | **S** | Validate |
| `ChangeRequest` entity | Scope change is a string with no value or approval | SOW | **M** | Build |
| Milestone as a record at project/SOW level | Cannot answer "which milestone is at risk" | — | **M** | Build |
| Acceptance state on deliverables | Cannot answer "delivered but not accepted" | milestone | **M** | Build |
| File storage + upload | No evidence, no SOW document | Azure Blob | **M** | Build |
| Email notification transport | Nothing leaves the app | Graph | **S** | Build |
| RAID as work types | Governance without four new modules | — | **S** | Build |
| Validate today's work in a browser | Three features shipped unopened | — | **S** | Validate |

### Release 3 — Commercial intelligence
*Make the delivery data mean money.*

| Feature | Dependencies | Size |
|---|---|---|
| Skills + proficiency ✓, and skill→deliverable matching (**the half still missing**) | people table | **M** — matching exists and is driven by SK1; what is absent is anything that states what a deliverable requires |
| Utilisation: planned vs actual, against `billableTargetPct` | rates, timesheets in use | **M** |
| Cost of allocation; margin by project / engagement / resource | rates | **L** |
| Invoicing: T&M, fixed price, retainer, milestone | rates, CR, milestones | **XL** |
| Bench and future demand | skills, allocation | **M** |
| Holiday calendar and per-location working calendars | master data | **M** |
| Weekly client + monthly governance reporting (RP2) | — | **M** |

### Release 4 — Automation and AI
*Only now, and only the ones whose data exists.*

Timesheet Intelligence → Duplicate Detection → Triage/Routing (needs skills) → Margin Protection
(needs rates) → Milestone Risk (needs milestones) → SOW Intelligence (needs documents).

**The sequencing rule this audit most wants to record: six of the ten most-wanted agents are
blocked on data that does not exist. Building them now produces screens that cannot be populated.**

---

## H. Immediate next actions — the ten highest value, in order

1. **Validate what shipped today in a browser.** Row menu, inline status editing, the timesheet
   Submit control, the Capacity tab. Three features are in production and have never been
   rendered by a human. This is the cheapest possible risk reduction.
2. **Enter the real OAPIL and SLG statements of work.** `Sow` has zero rows. The commercial layer
   cannot be validated, and no commercial feature can be sequenced honestly, until it holds real
   contracts.
3. **Make `Person` a Prisma model with a stable id.** It is the root of two failures already seen
   and it blocks Release 1 entirely.
4. **Add `personId` foreign keys** to Allocation, Commitment, TimeEntry, Timesheet, Notification.
5. **Model the rate card, effective-dated, with its own permission.** This single addition
   unblocks cost, margin, billing, utilisation and three agents.
6. **Fix the two SOW defects** — audit keyed by SOW id, and remove `Engagement.sowReference`.
   Both are small and both create wrong answers today.
7. **Model `ChangeRequest` as an entity.** Scope change is the most common commercial event in
   consulting and it currently has nowhere to live.
8. **Add file storage.** It blocks deliverable evidence, SOW documents and acceptance proof.
9. **Promote Milestone to a record at project level**, with acceptance criteria and evidence.
10. **Decide on row-level security.** Identity now exists, which was the stated blocker. Either
    commit to real multi-tenancy or write down that this is a single-firm deployment.

---

## I. Validation questions

Only what the codebase cannot answer.

1. **Is pre-sale in scope?** No Lead or Opportunity concept exists. Adding CRM is a large,
   separable decision, and the product works without it.
2. **Is Axiomate multi-tenant SaaS, or one deployment per firm?** The schema is modelled for
   many; the runtime serves one from an environment variable. The answer decides whether RLS is
   P0 or unnecessary.
3. **What is an "outcome", precisely?** The vision asks for outcome-based timesheet entry and
   codes like O-S01. Is an outcome a deliverable, a milestone, a support category, or a billing
   bucket? This determines whether it is a new entity or a work type.
4. **Where do cost rates come from, and who may see them?** Per person, per role, per grade, per
   engagement? The rate card's shape and its permission depend on this.
5. **Which currencies?** `Sow.currency` defaults to GBP and the operator is in India serving OAPIL
   (Oman) and SLG. Multi-currency with conversion is a materially larger build than single.
6. **Is the Tuesday lock rule real policy?** It appears in the vision; nothing in the codebase
   implements or references it. Confirm before building.
7. **Do you want extracted SOW content to ever be authoritative**, or always a proposal a person
   promotes? The codebase's existing pattern is the latter, and this audit recommends keeping it.
8. **Contractor invoicing** — are contractors paid through this system, or only costed in it?
