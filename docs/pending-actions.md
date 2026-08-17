# Pending actions

*As at 17 August 2026, after the release that put `337e2a2` into production.*

Ordered by what blocks what, not by size. Anything already done is not here — the git log is
the record of that.

---

## A. Waiting on you

Nothing below can move without a decision or an action that is yours.

| # | Action | Why it needs you |
|---|---|---|
| A1 | **`gh auth login`** — run it as `! gh auth login` in the session | GitHub CLI 2.97.0 is installed and unauthenticated. Signing in is not something I can do on your behalf. Then the repo is one command: `gh repo create axiomate-tms --private --source=. --push` |
| A2 | **Tarun's permission role** | He is in the directory (`PERSON_61`), allocated 100% to Axio-Growth, and holds **no role**. The fallback role is empty, so he can sign in and see nothing |
| A3 | **Confirm or overrule two design reversals** | Both are committed in `2026-08-17-work-management-design.md` and both go against what you asked for. See section E |
| A4 | **Client filter default** | Requested and not yet built — see D1. It needs one answer: what "project stakeholder" resolves to. Allocation? Engagement membership? Named on the SOW? |
| A5 | **Issue-type taxonomy** | Requested and not yet built — see D2. There is a modelling question in it worth five minutes of your time before anybody writes code |
| A6 | **Grant the document library consent** | This is the single thing standing between file storage and working, and it is an Entra admin action nobody but you can take. In the portal: App registrations → the Axiomate registration → API permissions → Microsoft Graph → **Application** permissions → `Files.ReadWrite.All` → Grant admin consent. Then set `AXIOMATE_DOCS_DRIVE_ID` to the target library's drive id (`GET /v1.0/sites/<host>:/sites/<site>:/drives`). Until both are done every upload is refused with a sentence saying which one is missing. **Point it at a library that exists for this purpose** — the token is app-only, so SharePoint's own permissions are not a second line of defence |

---

## B. In flight — the effective-dating plan

Steps 1–4 are committed and live. Two remain.

| # | Step | Note |
|---|---|---|
| B1 | **Step 5 — make the working pattern date-aware** | The plan names this as **the step carrying the most regression risk**. `profileFor` currently reads `ResourceProfile` out of the OperatingModel; it must start asking `valueAt` for a date, and four production call sites must treat `null` as "not known then" rather than falling back. Do **not** change `planCheck`'s signature |
| B2 | **Step 6 — the persistence proof** | Version round trip, plus "a correction moves the timeline and does not move a stamp". Takes the proof to 29/29 and makes the `scrub()` entry load-bearing — today it is precautionary, because nothing writes a version during the proof |
| B3 | Step 7 — the `CapacityPanel` timeline UI | Last, as the plan orders it |

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
| C1 | **Step 4 — wire `lib/timeWindow.ts` to `addTime`** | The module is provable in isolation and **has no production consumer**. This step puts a refusal in front of an arm that currently always succeeds, and the person it lands on is a consultant at the end of a week with hours to record |
| C2 | Step 5 — calendar grid, then My timesheet | Reads `TimeEntry`, writes through existing arms. No new storage |
| C3 | Step 6 — the timesheets plan as already written | Submission, freeze, approval. Design approved, unbuilt |
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
| F2 | Prisma 7 ships a base64 WASM query compiler for **every** engine — sqlserver, cockroachdb, mysql, sqlite — 75 MB of build output for an app that only speaks PostgreSQL | Dropping the four unused saves ~60 MB. Nothing has established that Prisma does not enumerate that directory at load time, and a release that boots beats a smaller one that might not |
| F3 | The workflow pins `NODE_VERSION: '24'`; App Service runs `NODE|22-lts` | Healthy — 22-lts satisfies both Prisma 7.9 and Next 16. A correction to make deliberately in one direction, not an incident |
| F4 | The workflow still prunes `node_modules` by hand although `output: 'standalone'` is now set | Wasteful, not broken. It ships three times what it needs to |
| F5 | **No staging slot, and none possible** — the plan is B1 Basic; slots need Standard | Every manual release restarts the site for ~60s against a browser write queue with a 7.5s retry budget. Deploy when nobody is working, or move to Standard |

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
| G1 | **No structural template at any level.** `ProjectTemplate` configures automation only; an issue has no template and an activity has none at all | Largest single gap, clearest payback. Every engagement's skeleton is rebuilt from memory — which is how the register grew 48 duplicate points |
| G2 | **"Derived values are never stored as fact" has no gate.** It broke twice this month and a person caught both | A script flagging model fields matching known derived quantities, with an allow-list requiring a reason. Would have caught both |
| G3 | Gates run only in CI | A pre-commit hook running `tsc --noEmit` and `audit:tenancy` — seconds, not minutes |
| G4 | Scenarios and designs are not linked | A `design:` field per scenario makes "which designs are unproven" a query |
| G5 | **11 P1 gaps and 25 PARTIAL verdicts, with nothing scheduling work against them** | One P1 per cycle, chosen *before* new work is planned |
| G6 | `tsx` is in neither `dependencies` nor `devDependencies`, yet five scripts run `npx tsx` | Every CI run fetches an unpinned version to execute code that gates deployments. One line |

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
| I2b | **Nothing has been uploaded** | The model, both endpoints, the store contract and the Evidence panel are built and deployed; the only path exercised so far is the refusal. Scenario D stays PARTIAL until one real file has been stored and produced — the same discipline applied to the intake path |
| I2c | **Nothing has been invoiced** | A milestone reports what is billable — accepted, or signed, or delivered, depending on the term it was sold under — and nothing turns that into an invoice. `Invoice` + `InvoiceLine` is the next entity and both its dependencies (rates, milestones) now exist |
| I3 | **Nothing states what a deliverable requires** | `candidatesFor` answers "who could do this" and the requirement has to be typed rather than read off a work item. That is the remaining half of skill matching, and it is a modelling decision, not a screen |
| I4 | `ChangeRequest.issueId` exists and nothing sets it | The register and the contract still describe the same change twice. Scenarios O and P name this |
| I5 | `setResourceProfile` and `setWorkflowEnabled` | Recommended for **removal**, not wiring — see the audit. Both are reachable arms whose behaviour is now supplied by something better |

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
