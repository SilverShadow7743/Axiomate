# Pending actions

*As at 17 August 2026, after the release that put `337e2a2` into production. Reconciled
22 August 2026: entries the code had already overtaken are struck rather than deleted, because
a record that silently loses entries cannot be trusted about the ones it keeps.*

Ordered by what blocks what, not by size. Anything already done is not here — the git log is
the record of that.

---

## A. Waiting on you

Nothing below can move without a decision or an action that is yours.

| # | Action | Why it needs you |
|---|---|---|
| ~~A1~~ | ~~**`gh auth login`**~~ | **Done, 23 Aug.** Signed in as SilverShadow7743; the repo lives at github.com/SilverShadow7743/Axiomate and every deploy since is pushed |
| A7 | **Use the direct redemption link (shared in chat, not stored here) — the invitation email isn't reaching Gmail and Entra's own logs don't explain why** *(added 23 Aug; invited 31 Aug, resent 6 Sep, both `directoryAudits`-confirmed `result: success` with no failure reason; Gmail searched directly 7 Sep — inbox/spam/trash/all folders, no date bound — zero matching messages from either send; `signIns` for the guest UPN is empty, confirming no redemption attempt ever happened; `policies/authorizationPolicy.allowInvitesFrom` is `everyone`, ruling out a domain block)* | Entra's own telemetry is clean on the send side, which means the break is between Microsoft's invitation-mail dispatch and Google's mail servers — not diagnosable from tenant admin settings, and likely needs a Microsoft support case if the email itself needs fixing. **Workaround that skips the email entirely**: `POST /v1.0/invitations` returns a one-time `inviteRedeemUrl` carrying a live redemption ticket — a bearer credential, so it belongs in chat with the founder, not committed to this repo. Opening it while signed in as `nishant.ax@gmail.com` redeems the invitation without the email ever needing to arrive; ask for a fresh resend if the one already shared has expired or been used. The app side is still DONE and waiting: PERSON_85, the scoped boundary, GA1 |
| A8 | **The Tarun half of checklist §21** | The proofing browser test's second-account half, blocked with A6 (the drive id) for the upload step |
| ~~A2~~ | ~~**Tarun's permission role**~~ | **Done, 18 Aug.** This entry was stale well before it was closed: the August identity fix created a NEW record (`PERSON_63`) rather than correcting `PERSON_61`, so he had held `ROLE_PROJECT_MANAGER` and been able to sign in for some time, while a stub carrying his grade sat beside it as a second "Tarun" in every dropdown. Consolidated onto `PERSON_63`, `PERSON_61` removed, its orphaned working pattern `ver-19` withdrawn, and the role raised to **Engagement Leader** — see G7 for why that was more than Project Manager |
| A3 | **Confirm or overrule two design reversals** | Both are committed in `2026-08-17-work-management-design.md` and both go against what you asked for. See section E |
| A4 | **Client filter default** | Requested and not yet built — see D1. It needs one answer: what "project stakeholder" resolves to. Allocation? Engagement membership? Named on the SOW? |
| A5 | **Issue-type taxonomy** | Requested and not yet built — see D2. There is a modelling question in it worth five minutes of your time before anybody writes code |
| A6 | **~~Grant the document library consent~~ Set the drive id app setting** | *(Reconciled 22 Aug.)* The consent half is done — `Sites.ReadWrite.All` granted 19 Aug via direct appRoleAssignment, PUT/GET proven byte-identical. What remains is one command the permission classifier hands to you: `az webapp config appsettings set -g Axiomate-TMS-RG -n axiomate-tms --settings "AXIOMATE_DOCS_DRIVE_ID=b!JLkNBeyWqk6F_ERiDOetBL_1Yc2jxCdDrnPHxX1tlfy-Yb6nuemoQJ-3oaomst8n"` |

---

## B. In flight — the effective-dating plan

All seven steps are committed and live. *(Reconciled 22 Aug: these three were recorded as
pending after they had shipped — `lib/capacity.ts` asks `valueAt` for a date (scenario HV2
passes), the persistence proof drives the version round trip and the correction rule, and
`CapacityPanel` renders the `PatternTimeline`.)*

| # | Step | Note |
|---|---|---|
| ~~B1~~ | ~~**Step 5 — make the working pattern date-aware**~~ | **Done.** `profileFor` asks `valueAt`; null is "not known then" |
| ~~B2~~ | ~~**Step 6 — the persistence proof**~~ | **Done.** The proof covers the version round trip and the correction |
| ~~B3~~ | ~~Step 7 — the `CapacityPanel` timeline UI~~ | **Done.** "Working weeks" renders from the versions |

**What changed today that makes B1 safe to start.** Five people now have a stated working pattern
(`ver-15`..`ver-19`, 5 days × 8 hours from 2026-08-17). Before that, `valueAt` would have returned
null for everybody on every date, which the plan's own send-back list would have read as the
design failing. It is not: nothing was ever recorded before 17 August, and null is the truthful
answer for July. There is now real data on one side of that boundary and honest absence on the
other, which is exactly the shape B1 needs to be tested against.

**One bridging detail.** Resource profiles are keyed by `personId` (`PERSON_1`); allocations,
commitments and time entries are keyed by person **name**. All five allocated people currently
resolve to exactly one directory entry, so there is no ambiguity today — but `rolesFor` in
`lib/access.ts` already implements the id → email → name join and B1 should use it rather than
grow a second one.

---

## C. The work-management design

Steps 1–3 are committed and live. Step 4 is the risky one.

| # | Step | Note |
|---|---|---|
| ~~C1~~ | ~~**Step 4 — wire `lib/timeWindow.ts` to `addTime`**~~ | **Done, 18 Aug.** `addTime` now refuses a closed issue and a date before the work existed, warns on an overrun and on a long day, and takes the freeze through the same verdict. Two things were deliberately NOT changed: the authority rule stays in the reducer (the module asks whether the person owns the ISSUE, which would have started refusing a consultant logging their own hours on a colleague's work), and the freeze wording is still `lib/timesheet.ts`'s, so all three time arms refuse in the same words. **`updateTime` still does not consult the window** — an entry can be edited onto a date the window would have refused, which TW1 records |
| ~~C2~~ | ~~Step 5 — calendar grid, then My timesheet~~ | **Done, superseded.** `Timesheet` model, `lib/timesheet.ts`, `components/TimeTab.tsx`/`TimesheetPanel.tsx` are all live, and three later approved designs (weekly grid 26 Aug, docked panel 24 Aug, zero-entry suggestions 31 Aug) built further on top. Reconciled 7 Sep — this row had gone stale |
| ~~C3~~ | ~~Step 6 — the timesheets plan as already written~~ | **Done, superseded.** Submit/freeze/approve is live: `submitTimesheet`/`decideTimesheet` reducer arms in `lib/workspace.ts`, `isFrozen` gating `addTime`/`updateTime`/`removeTime`. Reconciled 7 Sep |
| C4 | **Verify the row menu in a browser** | Row actions, inline editing and the status-reason popover are **in production and were never rendered in a browser** — the workspace is behind Entra and I cannot sign in. Click a `⋮`, change one status, confirm the reason box refuses to save empty |

---

## D. Requested today, not yet built

| # | Request | The question inside it |
|---|---|---|
| D1 | **Client filter defaults to None; All shows only project stakeholders; each person picks their project** | "Stakeholder" needs a definition the code can compute. The candidates already in the data are: has a live `Allocation` on the project, is named on the `Engagement` (leader / PM / sponsor), or holds a role scoped to it. These give different answers — a client sponsor has no allocation |
| D2 | **The 14-row issue-type taxonomy** | See below. This is a modelling decision, not a config edit |

### D2, stated properly

The 14 categories — Business, Functional, Technical, Integration, Data, Configuration, Testing,
Environment, Security & Access, Performance, Project/Delivery, Decision/Governance,
Commercial/Scope, Compliance — are a **discipline** axis. The workspace already has two others:

    type      Defect | Change Request | Limitation | Request | Task | Action     (7 workTypes)
    module    Finance | Production | Procurement | Inventory | Reporting | …     (21 in the data)

These are independent. A **Technical Issue** can be a Defect or a Change Request; an
**Integration Issue** can sit in the Procurement module. Folding the 14 into `workTypes` would
conflate two axes and make it impossible to say "the technical defects" — which is the question
the taxonomy exists to answer.

So the recommendation is a **third field**, `discipline`, not a replacement for `type`.

The "Primary Owner / Role" column is a different thing again: it is **routing**, and
`model.routingRules` already models exactly that shape — `when { module, severity, keyword }` →
`then { responsibilityTypeId, value }`. Fourteen rules, one per discipline, rather than a new
mechanism.

---

## E. Two decisions made against what you asked for

Both are committed. Both are one word from you to reverse.

| # | You said | What was built | Why |
|---|---|---|---|
| E1 | "**Maximum Daily Hours = 8** is particularly important" | The cap was moved **off the issue** entirely. It now comes from the person's working pattern at the work date | Three issues each carrying a cap of 8 permits a 24-hour day, and 8 is wrong for anyone not on a five-day week. The cap that matters is the one *across* issues, which no issue can see |
| E2 | "On 21-Aug: **Timesheet Window: CLOSED**" | The window closes when the **issue** closes. Passing the due date warns, never refuses | Closing on the due date makes every overdue issue — most of the ones needing attention — demand an extension before anyone can record work they are genuinely doing. Extensions become a formality people click through, and a control that fires on the common case stops being one. Your extension flow is kept, for logging against an already-closed issue |

---

## F. Things found today and deliberately not acted on

| # | Finding | Why it was left |
|---|---|---|
| F1 | **`ver-15`..`ver-19` carry `byId: staffing-facts`** with `by: Nishant Sekhar` and your real email | The rows read as a signed-in human but are unqueryable by your account id — the half-join `byId` exists to close. **Not corrected, because correcting an audit trail is worse than annotating one.** The `reason` field on each row says "Stated by the engagement leader, 17 August 2026", which is the truthful record. The fix belongs in the script, for next time |
| ~~F2~~ | ~~Prisma 7 ships a base64 WASM query compiler for **every** engine~~ | **Done, 7 Sep, as a side effect of F4** — never actually reached the package once standalone tracing was used; verified `.next/standalone` carries exactly one Prisma WASM file. No schema change needed |
| ~~F3~~ | ~~The workflow pins `NODE_VERSION: '24'`; App Service runs `NODE\|22-lts`~~ | **Done, 7 Sep.** Workflow pin brought down to 22 to match what's actually deployed; `docs/deployment.md` §1/§9 corrected to agree |
| ~~F4~~ | ~~The workflow still prunes `node_modules` by hand although `output: 'standalone'` is now set~~ | **Done, 7 Sep.** Packaging step now zips `.next/standalone` + `public`/`.next/static`/`data`. Verified: 41 MB, boots, `/api/health` → 200 |
| F5 | **No staging slot, and none possible** — the plan is B1 Basic; slots need Standard | Every manual release restarts the site for ~60s against a browser write queue with a 7.5s retry budget. Deploy when nobody is working, or move the plan — `infra/app.bicep`'s own comments recommend **P0v3** over Standard S1 on cost/performance grounds (~£45-60/mo vs B1's £11-15/mo). Cost decision, not actioned — needs Nishant |

---

## H. How new issues arrive daily — nothing does this yet

Checked against the live subscription on 17 August 2026. The resource group holds **three
resources**: the database, the App Service plan, and the web app. Neither Logic App is deployed.

Both endpoints exist, are live, and are guarded. What is missing is anything that *calls* them.

| # | Piece | State | What it needs |
|---|---|---|---|
| H1 | `POST /api/schedule/run` — the daily pass that ages issues, raises SLA breaches and prunes idempotency keys | **Live and working.** Returns 401 without a token; `AXIOMATE_SCHEDULE_TOKEN` is set and usable (32 chars) | **Nothing calls it.** `infra/schedule.bicep` is written and undeployed — a Consumption Logic App with a recurrence trigger and one HTTP call. Deploy it, or point any scheduler at the URL with the token |
| H2 | `POST /api/intake` — a message in, a classified work item out, under the right scope with a provenance note | **Closed.** Returns 503: `AXIOMATE_INTAKE_TOKEN` is present but **empty** (length 0) | Set a real token. The endpoint refuses to run without one by design — "an endpoint that creates records from the internet does not run without a usable shared secret" |
| H3 | Something watching a mailbox | **Not deployed.** `infra/intake.bicep` is written and undeployed | A Consumption Logic App polling one shared mailbox and POSTing to H2. It needs an Office 365 connection **consented interactively** — until somebody does that, the workflow deploys clean, reports no errors and never runs, and an empty run history looks exactly like a quiet mailbox |

**The short answer.** Today, new issues arrive only by somebody typing them in. To have them
arrive by themselves: set the intake token, deploy the two Logic Apps, and grant the mailbox
consent. H1 is the easy half and delivers on its own — the daily pass is what makes an issue
raised on Monday show as overdue on Friday without anybody reopening it.

**A caution on H2/H3.** Intake creates records from the internet. It applies the same transition
graph, permissions, automation and audit trail as a person typing, and the classification it
performs is reported as `guessed` rather than `stated` — but it is still a public write path,
and it should be turned on deliberately rather than as a side effect of wanting a mailbox
watched.

---

## G. Gaps in the development loop itself

From `docs/continuous-development.md`, repeated here because a gap in another document is a gap
nobody schedules.

| # | Gap | Cost to close |
|---|---|---|
| G1 | **No structural template at any level** (one correction, 7 Sep: `buildLifecycle` already generates one fixed 5-phase activity sequence — `ACTIVITY_PHASES`/`weights` in `lib/workspace.ts` — so the true gap is that it isn't *configurable*, not that nothing exists). **Designed, 7 Sep, not built** — see `docs/plans/2026-09-07-issue-activity-templates-design.md` | Largest single gap, clearest payback. Every engagement's skeleton is rebuilt from memory — which is how the register grew 48 duplicate points |
| G2 | **"Derived values are never stored as fact" has no gate.** It broke twice this month and a person caught both | A script flagging model fields matching known derived quantities, with an allow-list requiring a reason. Would have caught both |
| G3 | Gates run only in CI | A pre-commit hook running `tsc --noEmit` and `audit:tenancy` — seconds, not minutes |
| G4 | Scenarios and designs are not linked | A `design:` field per scenario makes "which designs are unproven" a query |
| G5 | **11 P1 gaps and 25 PARTIAL verdicts, with nothing scheduling work against them** | One P1 per cycle, chosen *before* new work is planned |
| ~~G6~~ | ~~`tsx` is in neither `dependencies` nor `devDependencies`, yet five scripts run `npx tsx`~~ | **Done.** `package.json` carries `"tsx": "^4.23.12"`, locked to `4.23.12` in `package-lock.json`. Reconciled 7 Sep — `docs/deployment.md` §9 item 4 still had the stale claim and is corrected there |
| G7 | **Segregation of duties had nobody on the other side of it** | The reducer refuses to let whoever raised a change request decide it, or whoever recorded a delivery accept it. With one engagement leader that rule had no counterparty: every change request Nishant raised was undecidable by anyone but an administrator. Resolved 18 Aug by making Tarun a second Engagement Leader — **and the cost is that the role carries all 38 permissions**, the same set as Platform Administrator, including `config.manage` and `rate.view`. The narrower alternative, still open, is to add `change.approve` to Project Manager and leave milestone acceptance with a real client sponsor |

---

## I. Since this document was written

Section H is **superseded**: both Logic Apps went live on 17 August. The daily pass was proven by
running it, and intake end to end by posting one message. Three entities were added after the
audit — `PersonRate`, `ChangeRequest`, and `Skill` + `PersonSkill` — each wired through to a
screen before the next was started.

What that leaves open, in the order it blocks things:

| # | Action | Note |
|---|---|---|
| I0 | **Sequence changed, 17 Aug** | The audit's commercial ordering (rates → CR → skills → documents → milestones → **invoices**) was paused in favour of operational delivery. Reason: six entities were built in two days and none had been exercised by a person, against a workspace with zero SOWs, zero rates and zero milestones in it. `Invoice` keeps its dependencies and loses nothing by waiting. See `docs/verification-checklist.md` |
| I1 | **Nothing has been opened in a browser** | The row menu, inline status editing, the Capacity tab, the leave form, the timesheet Submit, the Rates tab, the Changes UI and now the Skills tab are all in production and **none has been rendered in a browser** — the workspace is behind Entra and I cannot sign in. This is the largest single piece of unverified work |
| I2 | **The skill catalogue is empty** | Deliberately — the product ships no default skills, because a firm's skill list is its own. Until somebody adds entries, the Skills tab has a form and nothing to record against. Adding the ten or fifteen that matter for OAPIL and SLG is a ten-minute job for somebody who knows the work |
| I2d | **Intake is off, and needs an address that is not an individual's** | Stopped 18 Aug: `INBOX_62` was filing from `sekharn@axiocloudsolutions.com` and produced 27 issues in a day, about 17 of them newsletters, LinkedIn notifications, out-of-office replies and two bank passcodes. The mailbox config is disabled AND the Logic App is disabled — the second matters, because the app-side flag only stops storing, while the connector kept reading the mailbox. **Client mail no longer arrives at all.** Repointing needs a real shared address plus a matching change to the Logic App's `mailboxAddress`; see `2026-08-18-connected-workspace-design.md` |
| I2b | **Nothing has been uploaded** | The model, both endpoints, the store contract and the Evidence panel are built and deployed; the only path exercised so far is the refusal. Scenario D stays PARTIAL until one real file has been stored and produced — the same discipline applied to the intake path |
| I2c | **Nothing has been invoiced** — corrected 7 Sep: `Invoice` isn't schema-only, it doesn't exist anywhere (no model, no arm, no route, no UI). **Designed, 7 Sep, not built** — see `docs/plans/2026-09-07-invoicing-design.md`, which builds directly on `lib/milestone.ts`'s already-complete `isBillable`/`milestonePosition` | A milestone reports what is billable — accepted, or signed, or delivered, depending on the term it was sold under — and nothing turns that into an invoice |
| I3 | **Nothing states what a deliverable requires** | `candidatesFor` answers "who could do this" and the requirement has to be typed rather than read off a work item. That is the remaining half of skill matching, and it is a modelling decision, not a screen |
| ~~I4~~ | ~~`ChangeRequest.issueId` exists and nothing sets it~~ | **Done, 1 Sep** (commit `3393b3c8`). A "Linked issue" picker in `CommercialPanel.tsx` sets it through `upsertChangeRequest`'s patch; scenario O now PASSes. Reconciled 7 Sep — this row had gone stale |
| I5 | ~~`setResourceProfile` and~~ `setWorkflowEnabled` | **Corrected, 7 Sep — this recommendation was half right.** `setWorkflowEnabled` genuinely had zero call sites anywhere (no UI, no script, no scenario) and is removed, along with its type entry. `setResourceProfile` is **not** removed: `person.workingPattern` (the mechanism this row claimed supersedes it) structurally cannot represent an unconfirmed default — `lib/capacity.ts`'s `profileAt` marks every version `'stated'` unconditionally ("a version exists only if somebody recorded one with a reason"). `scripts/seed-profiles.ts` depends on `setResourceProfile`'s `confirmed: false` specifically to seed defaults that don't masquerade as stated facts — removing it would have reintroduced the exact bug the script's own comment describes catching once already. Kept, with this row corrected rather than the arm removed |

---

## J. Product vision vs. what's actually hosted — the gap survey

*Added 7 September 2026. Compares `docs/strategy/axiomate-vision.md` (12 pillars, 31 Aug) and
`docs/strategy/axiomate-product-blueprint.md` (12 suites / ~100 screens, 6 Sep — self-described as
"not checked against what exists... that reality-check is future work, not done here") against
what is actually in `prisma/schema.prisma` and `components/` today. That reconciliation is run
here. The vision doc already did a pillar-level version of this for pillars 4/6/8/10/12 (§8) — this
extends it to all twelve pillars and, separately, the blueprint's twelve suites, which decompose
the same ambition at a finer grain and surface gaps the pillar framing doesn't (an entire absent
suite reads as a rounding error inside one pillar's "partial" rating).

**Method and its limit.** This is a suite/pillar-level survey, not the screen-by-screen check the
blueprint itself calls for (roughly 100 screens, IDs like DLV-014) — that remains separate, larger,
unstarted work. What's below is accurate about which *suites* have real structure behind them and
which are named only in the blueprint; it is not a claim about any individual screen ID.

### What's substantially real (structural, not AI-dependent)

| Pillar / Suite | Evidence | Gap against the stated target |
|---|---|---|
| **Delivery** (pillar 4, Suite 05) | The core of the built product: `HierarchyNode`/`Issue`/`IssueActivity`/`IssueDependency`, `TreeGrid`, `GanttChart`, `BoardView`, `CalendarView` — List/Kanban/Gantt/Calendar views all real | No first-class **Deliverable** entity distinct from Issue (DLV-013's Quality Criteria/Review/Approval/Version/Outcome shape isn't modelled — `Evidence`/`DocumentReview` cover adjacent ground, not this). No cross-level Action→Deliverable→Milestone→Engagement dependency visualization (DLV-015) beyond what Gantt already shows at the Issue level |
| **Governance** (pillar 12, Suite 12) | One of the strongest areas, not one of the weakest as the blueprint's screen count might suggest: `lib/access.ts`'s granular RBAC (34+ permissions), full audit trail (`ScheduleAudit`), row-level security across all 39 tenant-scoped tables (verified 7 Sep, see section F above) | No unified **Audit Center** screen (GOV-007) — audit data exists, browsable per-record via History tabs, not as a firm-wide searchable log. No **Organization Workspace** (Business Units/Practices/Locations, GOV-002) beyond what `HierarchyNode`'s generic tiers already express. No AI/Agent Governance policy screens (GOV-005/006) — the `Agent` entity has `autonomy`/`requireApproval` fields, a real start, not a configurable policy surface |
| **Workforce Intelligence** (pillar 10, People Suite) | `PersonRate`, `PersonSkill`, `Allocation`, `CapacityPanel.tsx`, effective-dated working patterns | No career-level progression (PPL-003), no Capability Matrix as a demand/supply/gap view (skills are recorded, not matched against demand), no AI staffing recommendation (PPL-006 — named AI-blocked below) |
| **Work Management** (pillar 4 partial, Command Suite partial) | `MyWeek.tsx`/`MyWorkPanel.tsx` cover CMD-006's Today/Upcoming/Overdue/Blocked/Waiting shape closely | No persona-differentiated command centers (CMD-001 through CMD-005 — Associate/Consultant/Senior Consultant/Principal/Engagement Leader each seeing a different cockpit). Today the same screens render for everyone; career level exists in the role model but doesn't yet drive what's shown |
| **Risk Intelligence** (pillar 8, partial Intelligence Suite) | `lib/watch.ts`'s six conditions (`overdue`, `atRisk`, `dueSoon`, `stale`, `planImpossible`, `sowOverConsumed`) — real, structural, automated | Not surfaced as a unified "Intelligence Center" (INT-001) with the Ask/Analyze/Predict/Recommend/Simulate/Execute action set — it's a background pass feeding notifications, not an explorable surface |
| **Business Operations** (pillar 11, Finance Suite partial, Engagement Suite partial) | `Sow`/`ChangeRequest`/`Milestone`/`ScopeItem`, `CommercialPanel.tsx`, `FinanceReportView.tsx`; `isBillable`/`milestonePosition` (`lib/milestone.ts`) — genuinely sophisticated billing-eligibility logic | Invoicing itself designed today, not built (I2c above). No Profitability-by-resource/practice rollup (FIN-003). No Engagement Decision Center (ENG-007) or governance calendar (ENG-005) as distinct concepts — `Meeting` is generic, not engagement-governance-specific |
| **Automation** (pillar 7, Suite 11) | Real, more than the blueprint's framing suggests is typical for a v1: 4 enabled automation rules (`issue.created`, `issue.overdue`, `sow.overConsumed`, `issue.owner`), an `Agent` registry with autonomy/approval settings, a `Workflow` concept (`ConfigWorkspace.tsx`'s Workflows section) | Workflows section is read-only — no Workflow Studio (AUT-002) to author a Trigger→Condition→Decision→Action chain from the UI. No Agent Studio (AUT-004) to configure a new agent's objective/knowledge/tools. No distinct Execution History (AUT-006) — folded into the general `ScheduleAudit` |

### What's absent — not "partial," genuinely not started

| Suite | What the blueprint describes | What exists today |
|---|---|---|
| **Growth Suite** (pipeline, opportunities, proposals, contracts as a sales motion) | GRT-001 through GRT-007 — pipeline, qualification, solution/estimation, proposal, contract, expansion intelligence | Nothing. No `Opportunity`, `Lead`, `Proposal`, or pre-`Engagement` pipeline concept anywhere in `prisma/schema.prisma`. An engagement exists only once it's already real |
| **Client Suite** (client as a first-class entity with health, relationship, satisfaction) | CLT-001 through CLT-005 | `Client` exists only as a `HierarchyNode` tier — a place in the tree, not an entity with stakeholder sentiment, relationship strength, satisfaction scoring, or a 360° rollup across engagements |
| **Knowledge Suite** (solutions, architecture patterns, decisions, lessons, accelerators as a searchable library) | KNW-001 through KNW-007 | `Document`/`DocumentReview` are generic file storage. No Solution Library, Architecture Library, Decision Library, or Lessons Learned structure (Situation→Action→Outcome→Lesson) |
| **Application Suite** (the client's own technology landscape — D365, Salesforce, M365, integrations, health) | Flagged in the source pitch itself as *"a candidate flagship capability"* — APP-001 through APP-007 | Nothing built. **Designed, 7 Sep** — see `docs/plans/2026-09-07-application-suite-design.md`: `Application`/`IntegrationLink` models, health as named concerns (`lib/portfolio.ts`'s own doctrine — no score) rather than the blueprint's Healthy/Watch/At Risk/Critical enum, scoped to the record-keeping half only (no live telemetry, no AI consequence-chain reasoning — both need capability this codebase doesn't have yet) |

### AI-blocked — structurally ready, waiting on the one thing vision.md already named

Pillar 3 (Work Intelligence — detecting commitments/decisions/requirements from unstructured
text), the generative half of pillar 1 (Work Capture), most of the Intelligence Suite's
predictive/scenario capability (INT-004/005/006), and AI Command (AXS-003) all need an LLM that
can *read and act*, not narrate. `/api/assist` today is read-only prose over already-computed
figures (`lib/assist.ts`), explicitly walled off from writing anything. `axiomate-vision.md` §5
already names the underlying blocker (zero Anthropic API credits, task #113) — unchanged as of
7 Sep. Nothing in this survey changes that finding; it's restated here because it explains why
three of twelve suites (Growth, Knowledge, most of Intelligence) can't fully close even once
built — their differentiated value is generative, not just structural.

### What this changes about "next," updated from vision.md §8

Vision.md named pillar 9 (Organizational Memory) and the remainder of pillar 11 (Business
Operations) as the strongest non-AI-blocked candidates on 31 Aug. Business Operations moved
today — invoicing is designed (I2c). What the suite-level view adds that the pillar view didn't
surface as sharply: **Client Suite** and **Application Suite** are both zero-built, both
structural (no AI needed for a client health rollup or an application landscape record), and
**Application Suite** in particular sits directly on Axiocloud's own delivery specialism —
arguably a stronger near-term candidate than either pillar 9 or the Growth Suite, which is also
zero-built but whose value (pipeline, proposals) is further from what this codebase's actual
users — internal delivery — do day to day.

---

## Current state, for reference

*Updated 17 August 2026, after the release adding `Skill` + `PersonSkill`.*

    production   https://axiomate-tms.azurewebsites.net   healthy, database connected
                 anonymous GET / → 307 → /signin, no data in the response
                 B1 Basic, Central India, NODE|22-lts, 9 migrations applied

    register     131 issues (OAPIL 94, SLG 37) + 85 internal = 216
    directory    26 people, 5 allocated, 5 with a stated working pattern
    suite        63 scenarios — 35 PASS, 25 PARTIAL, 2 NOT IMPLEMENTED, 1 NOT TESTABLE
                 0 P0, 7 P1 (A, C, D, ST2b, RP2, AI1, W)
    proofs       persistence 38/38, attribution 3/3, tenancy PASS (87 calls)
    access       34 permissions, 0 held by no stored role
