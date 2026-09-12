# Axiomate-TMS — business-process-driven product and application review

*A critical review of the existing application against its own business processes, not a
conventional UI-modernisation pass. Grounded in the actual code at `HEAD b5bf4b7` (12 Sep
2026), the F&O page-grammar redesign that shipped the same day, and the resource model in
`CLAUDE.md`. Where a finding names a page or process already redesigned today, it says so and
does not re-propose it. Every register row cites the file it was verified against. This
does not modify code, and does not re-litigate decisions already made — see §0.*

## 0. What not to re-open

Read this before anything else below, because a large fraction of what a conventional review
would recommend is already built, shipped today (2026-09-10 through 12), and deliberately
scoped the way it is:

- **This is not a multi-route app.** `app/page.tsx` mounts one client shell,
  `components/IssueWorkspace.tsx`, and thirteen "pages" (Tree, Board, Calendar, Portfolio,
  Applications, Analytics, My work, My calendar, My to-dos, Timesheets, Mail, People, plus the
  Inbox bell) are view-state switches inside it, not URLs. `/signin`, `/my-week`, and
  `/intake/form/[token]` are the only real routes. A recommendation to "add a page" almost
  always means "add a view key," not a route.
- **The F&O page-grammar redesign is fully shipped**, not in-flight: list-page discipline
  (quick filter, first-column-as-link, plural titles), the details-drawer pattern (title,
  status pinned top-right, single-open FastTabs, one primary action from `lib/statusPolicy.ts`),
  and the FactBox blade (`components/FactBoxBlade.tsx`, collapsed by default, never computes,
  only surfaces existing pure-function output) all landed 10-11 Sep. The detail panel's own
  prior redesign (real title, glyph-paired severity, adaptive tab collapse) shipped 9 Sep.
- **Portfolio's engagement health score already exists** (`lib/portfolio.ts`) under a strict,
  deliberate discipline — six pre-existing named concerns only, weights configurable in
  Configuration, every rendering prints its working, client-facing version excludes anything
  unmeasurable under the client boundary and says so. It was rejected twice before being
  admitted on these terms. Any recommendation touching scoring must engage with this doctrine,
  not restate "add a health score" as new.
- **No AI-driven insight, risk, or triage feature exists anywhere, and this is a documented
  refusal, not an oversight.** No computed data source exists for a risk score, and Operating
  Principle 2 ("never invent information") forecloses inventing one. Email triage specifically
  is named as fundamentally generative and blocked on zero Anthropic API credits. Nothing below
  proposes AI features; where the credit blocker is the reason something can't move, it's named
  as such.
- **The client boundary (`lib/clientBoundary.ts`'s `clientView()`) is a hard, mature redaction
  layer**, re-audited 12 Sep. Don't propose "hide sensitive data from clients" — propose
  specific corrections to it, which §3 does.
- **Commercial governance (SOW, change control, milestone acceptance, invoicing) is genuinely
  mature**: change requests need an approver who isn't the asker; milestone delivery and
  acceptance are separate permissions; invoices only fire off accepted, billable milestones.
  The gap in this area is aggregation and visibility, not the underlying discipline — see §4.

## 1. Current application assessment

**Architecture.** One authenticated shell (`IssueWorkspace.tsx`, 3,274 lines) renders every
internal view; `ConfigWorkspace.tsx` (6,396 lines) is a full-screen admin overlay with 30
sections across three groups (Operating model / Governance / Automation). A client-role actor
gets a structurally reduced nav (`CLIENT_GROUPS`: Tree, Board, Calendar only) via
`clientView()`'s server-side redaction, not client-side hiding.

**What works well, confirmed by direct code read:**
- The resource model's four-layer separation (Allocation / ProjectMember / Assignment /
  Timesheet) is real in the code, not just documented — each layer's write paths stay
  independent, as `CLAUDE.md` describes.
- Status-transition discipline (`lib/statusPolicy.ts`) enforces reason and evidence
  requirements per-transition, and the same funnel serves Tree, Board, and bulk-adjacent code.
- Commercial governance's separation of duties (asker ≠ approver on changes, deliverer ≠
  accepter on milestones) is enforced server-side, not just hidden in the UI.
- Departure is a status flip with history preserved, never a delete — the right instinct, even
  though three downstream write paths still ignore it (§2, People, row 1).
- The People directory and Profile panel, rebuilt today, are already the F&O
  list-page + drawer pattern the review would otherwise recommend.

**What creates unnecessary complexity or friction, confirmed by direct code read:**
- Configuration (governance/admin) and `CommercialPanel.tsx` (the actual SOW/change/milestone/
  invoice tracking) are two disconnected UI paradigms with no cross-link, even though both are
  "commercial setup" to the person using them.
- Capacity/resourcing has no view above a single project — every allocation action requires
  opening that project's detail drawer, and nothing shows "who is free" across the practice.
- Three separate triangle computations exist (estimate-vs-allocation, estimate-vs-actual) but
  the fourth, allocation-vs-actual — the number a status meeting actually asks for — exists
  nowhere.
- Two silent data-integrity gaps sit directly on the business processes they touch: a client's
  own note can be invisible to the client who wrote it (§3, row 1 — a real bug, not a design
  gap), and Calendar silently drops every lifecycle milestone that Gantt shows, because
  `calendarMonth`'s admission test skips any row with a null `status`.
- Onboarding — both a new hire's and a new client's — is a manual, multi-step, unreconciled
  process in each case, discoverable as broken only when someone notices an empty workspace or
  a blank profile.

## 2. Business process and user journey map

| Process | Outcome | Initiates → Responsible → Approves | Connects to | Disconnection found |
|---|---|---|---|---|
| Issue/project delivery | Work resolved, client-confirmed where required | Consultant/intake → owner → (client, implicitly, on confirmed-close) | Evidence, TimeEntry, Checklist | Checklist completion never gates closure — the one modelled precondition left unenforced |
| Lifecycle scheduling (CRP/Gantt) | Predictable delivery date | PM builds activities | Calendar (should, doesn't fully) | Calendar drops every row with a null `status` — lifecycle milestones invisible there though visible on Gantt |
| Resource allocation | Capacity committed to a project | Resource manager, project-scoped | Assignment (independent by design), Timesheet | No firm-wide view of who's allocated where; adjustment only reactive, only via a Portfolio capacity alert |
| Timesheet / effort tracking | Actual effort recorded, approved | Consultant → self-submits → any approver but self | Allocation (via reconciliation — missing), billing (`TimeEntry.billable`, unused downstream in this review's scope) | Allocation-vs-actual reconciliation doesn't exist anywhere |
| Leave | Time off recorded and decided | Consultant self-service, or manager | Availability computation | Manager-side leave entry gated by project allocation — a bench/unallocated person's leave can't be recorded by a manager at all |
| People / org identity | Directory reflects reality; person is staffable | Admin (identity), person (career self-assessment) | Everything downstream that names a person | No notification fires when a person's own record changes; departure doesn't gate Owner/Allocate/Next-action writes |
| Onboarding (new hire) | New joiner is staffable, week-one supported | Admin, one form | Skills, Career, Work tabs | No checklist, no manager/buddy task, no first-week flow — confirmed absent by direct search |
| Client transparency | Client sees accurate status without confidential detail | Client, self-service | Tree/Board/Calendar, periodic pack | Client notes can be invisible to their own author; milestones wholesale withheld from the live app; the pack itself is entirely manual to build and send |
| Guest onboarding (new client) | Client can sign in and sees their own work | Ops/PM, three separate manual steps (Entra invite, seat+scope, per-record flag) | — | Nothing reconciles the three steps; failure is discoverable only when the client reports an empty workspace |
| External intake (public form) | A request becomes a tracked, client-visible issue | Anonymous submitter | Guest access (should, doesn't) | Submitter gets a one-time on-screen reference only — no confirmation email, no status lookup, no bridge to later guest access |
| Commercial governance (SOW/change/milestone/invoice) | Contract, scope, and billing tracked with separation of duties | Delivery lead / finance approver, per engagement | Rates, Finance report | Mature internally, but invisible outside opening one engagement — no portfolio-wide register of open SOWs, overdue milestones, or unpaid invoices |
| Rate administration | Cost/bill rates recorded per person | Ops/finance admin | Every downstream margin figure | No approval step on a change that silently redefines every future margin the firm reports |
| Permissions / governance | Access granted matching a role | Admin | Everything the grant touches | 47 ungrouped permission columns, no bundles, no role-to-role copy — workable today, will not scale gracefully |

## 3. Page and section assessment register

*Full register, combined from a per-domain review of every list/detail page and configuration
section that exists. Columns: Business area · Page/section · Primary user · Current purpose ·
Identified issue · Recommended perspective · Proposed changes · Business benefit ·
Implementation impact · Priority.*

### P0 — fix now, no design debate needed

| Business area | Page/section | Primary user | Current purpose | Identified issue | Recommended perspective | Proposed changes | Business benefit | Impl. impact | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Client transparency | `components/NotesTab.tsx` composer + `lib/clientBoundary.ts` note filter | Client guest | Add a note to an issue | `draftVisible` defaults `false` for every writer with no author carve-out (unlike issue creation, which has `bornVisible` for client/machine actors) — **a client's own note can be invisible to the client who wrote it** | Apply the same `bornVisible` rule `addNote` needs, matching issue creation | A client-facing "ask a question" feature currently hides the client's own question from them | Reducer fix, `lib/workspace.ts` `addNote` case | P0 |
| People / org identity | `components/ProfilePanel.tsx` "Mark departed" | Admin | Flip status, preserve history | Owner (free text), Allocate-to-project, and Next-action assignment are not checked against `status === 'Departed'` — a departed person can be freshly assigned or allocated. Admitted in the 8-Sep design doc, never closed | Departure should gate every write path that names a person, not just the ones that happened to be checked first | Add the status check to the three unwired write paths; surface open work/allocations with a reassign shortcut | Closes a documented, still-open data-integrity hole | Workflow + 3 write-path checks | P0 |

### P1 — highest business value, do soon

| Business area | Page/section | Primary user | Current purpose | Identified issue | Recommended perspective | Proposed changes | Business benefit | Impl. impact | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Delivery | `components/BoardView.tsx` card meta | Delivery consultant/PM | Kanban lanes by status | Cards never show `scheduleHealth` — an Overdue card looks identical to On-Track until opened | Board's value is scan-and-spot; the health signal exists and renders everywhere else | Show the existing health chip on each card; sort within lane by health then planned-end | Fewer overdue items missed on the one at-a-glance view | UI-only | P1 |
| Delivery | `IssueWorkspace.tsx`/`TreeGrid.tsx`/`BoardView.tsx` selection | PM | One record selected/edited at a time | No multi-select anywhere — every status change, reassignment, or close is single-record | Highest throughput tax on delivery at real portfolio volume | Multi-select feeding a bulk variant of the existing commit path, reusing `checkTransition`/reason | Materially faster batch triage after intake or a workshop | Workflow | P1 |
| Delivery | `lib/calendar.ts` (`calendarMonth`), `lib/tree.ts` (`blank()`) | PM / client-facing lead | Read-only month grid of planned dates | Rows with a null `status` are skipped — no lifecycle milestone ever appears on Calendar, though the same schedule renders on Gantt | Two views of one schedule disagreeing, silently | Admit milestone rows keyed on `milestoneDate`, styled distinctly | Removes an undocumented gap between two renderings of one schedule | UI-only + row-shape fix | P1 |
| Delivery | `lib/statusPolicy.ts`, `components/ChecklistTab.tsx` | Issue owner / QA | Evidence/reason gates on closing transitions; checklist shows N-of-M | Checklist completion is never read by the transition gate — it's decorative | The gating pattern already exists for evidence/reason; checklist is the one precondition left unenforced | Optional `requireChecklistComplete` on `StatusPolicy`, configuration-driven, off by default | Prevents a documented QA step from being silently skippable | Workflow + `StatusPolicy` shape | P1 |
| Resourcing | *(absence)* — no firm-wide view | Resource manager | — | Every allocation action requires opening one project's detail drawer; nothing answers "who's free" across the practice | See §5, Design 1 | New workspace-level Resourcing view | Removes the need to open every project to plan staffing | UI-only (existing lib functions) | P1 |
| Resourcing | *(absence)* — no reconciliation | Resource manager / delivery lead | — | Allocation-vs-actual (committed vs. billed) exists nowhere, though estimate-vs-allocation and estimate-vs-actual both do | Closes the loop between the model's own separated layers | Add actual-hours-in-window beside the existing per-person allocation row | Answers the burn question leadership actually asks live | UI-only | P1 |
| Resourcing | `Allocation`/`Commitment` writes | Resource manager | Commit or adjust an allocation | Last-writer-wins (the `expected` optimistic-concurrency check only covers `updateIssue`, per the 12-Sep audit's M4) | Two managers editing the same allocation during a reactive reshuffle lose one edit silently | Extend `expected` to Allocation/Commitment writes (already tracked in the audit's own plan) | Prevents silent lost updates at exactly the highest-pressure moment | Data-model / workflow | P1 |
| People | `components/ProfilePanel.tsx` Overview + `Inbox.tsx` notification kinds | Admin writes, subject reads | Inline edit of manager/role/scope/title | No notification fires when a person's own record changes — silent to the subject | Identity changes are business events, same class as leave/timesheet decisions, which already notify | Add a `profile-change` notification kind | Fewer "why does my dashboard still show my old manager" questions | New notification kind + workflow | P1 |
| People | `components/ProfilePanel.tsx` roles + client scope | Admin | Grant roles; set client scope separately | A client-facing role can be saved with no client scope — a seat that looks configured but sees nothing, silently | Two fields form one operation, not two independent ones | Inline validation when a client role is saved with no scope | Avoids a silent, hard-to-diagnose access failure | UI-only validation | P1 |
| People / onboarding | No dedicated component — the intake form in `PeopleDirectory.tsx` is the entire flow | Admin / new joiner / manager | Records one Person row | No checklist, no manager/buddy notification, no first-week task — confirmed absent by direct search | Onboarding is a process with owners and tasks, not a database write | Seed a checklist (reusing the existing personal-action concept) for the person and/or manager on creation | Nothing falls through the cracks in week one | Workflow + small data-model + notification | P1 |
| People | `components/MyWorkPanel.tsx`, `lib/mywork.ts` | Every consultant, daily | Ranked "what needs me" | Owner match is a name-string join; an unmatched name yields a quiet, easy-to-miss empty state | A false negative on the one screen checked every morning is the worst failure mode it can have | Prominent banner with a fix-it pointer on the unrecognised-name state | Prevents "nothing to do" being mistaken for a broken join | UI-only now | P1 |
| Client transparency | `lib/clientBoundary.ts` `clientView()` — `milestones: {}` | Client guest | Redacted live view | Delivery/payment milestones exist in the data model but are never visible in the live app — only in the manually-built monthly pack | Exactly the "lightweight progress" signal transparency without confidential exposure calls for | Client-safe milestone projection (name + planned/delivered/accepted dates only, no amount/percentage) added to `CLIENT_GROUPS` | Cheapest possible build against a named brief requirement | New client-safe shape + UI | P1 |
| Client transparency | *(absence)* — clients have no notification surface | Client guest | — | The bell/Inbox is internal-only; `notifications` is wholesale withheld server-side; a client's only channel is re-checking the app or a human remembering to email | The single biggest named transparency gap | A narrow, purpose-built client notification class (new record/status-change on something already client-visible), delivered via the existing pending-email drain | Closes the biggest single transparency gap in the brief | New notification class + reuses existing email drain | P1 |
| Client transparency | `app/intake/form/[token]` | Anonymous client/prospect | Public tokenised intake | No confirmation email, no status-lookup path — the submitter gets only an on-screen reference string, worse than emailing in | Turns "raise a request" into something the submitter can trust landed | Confirmation email via the existing pending-email drain, carrying the reference | Strictly improves on today's "nothing but a string on a screen" | Integration + minor workflow | P1 |
| Commercial | `Rates` (`ConfigWorkspace.tsx`) | Finance/ops admin | Record dated cost/bill rate | Weakest form-discipline in the file (no `.cfg-fld.required` markers) despite being the single input that redefines every downstream margin figure; no approval step on the change | A financially load-bearing form should carry the strongest, not the weakest, discipline | Convert to `.cfg-fld`; add a lightweight second-actor confirmation above a threshold | Fewer silent mis-entries in a number every SOW margin depends on | UI-only + workflow | P1 |
| Commercial | *(absence)* — no portfolio-wide commercial view | Partner/finance lead | — | Margin, at-risk-SOW, and unbilled-milestone figures are all computable per-engagement already (`sowCostOf`, `invoicePosition`) but never aggregated | The primitive already exists and is disciplined — the gap is aggregation, not computation | Portfolio-level commercial register reusing the existing per-engagement computations verbatim | Firm-wide margin/AR visibility without a spreadsheet exercise | Workflow / light aggregation, no new model | P1 |
| Governance | `SettingsIndex` (`ConfigWorkspace.tsx`) | Any admin | Curated "all settings" summary meant to make the 30-tab surface navigable | 11 of ~29 tabs missing summary cards, including 3 of 5 Governance-group tabs (rates, goals, duplicates) — missing exactly where the stakes are highest | The index's own stated purpose is undermined precisely where it matters most | Add cards for all Governance-group tabs at minimum | An admin can no longer miss that rates exist/are stale without hunting the tab rail | UI-only | P1 |

### P2 — real value, lower urgency

| Business area | Page/section | Identified issue | Proposed changes | Impl. impact | Priority |
|---|---|---|---|---|---|
| Delivery | `PortfolioPanel.tsx` / `ApplicationLandscape.tsx` concern phrases | Five of six concern kinds have no drill-down to the flagged records — click opens the whole engagement | Link concern phrases to a pre-filtered Tree, reusing existing filter state | UI-only | P2 |
| Delivery | `AnalyticsView.tsx` | No table cell links back to a filtered Tree/Board | Reuse the pattern `MyWorkPanel`'s `onShowInTree` already has | UI-only | P2 |
| Delivery | `FactBoxBlade.tsx` | Renders nothing useful for non-issue rows (Client/Engagement/Project), though `DetailPanel` opens these and Portfolio/Applications are organised around them | Engagement/Project blade variant using the already-computed `PortfolioLine` | UI-only | P2 |
| Delivery | Calendar/Gantt vs. commercial `Milestone` | Neither schedule view plots a payment-gate milestone — a PM must leave the schedule entirely to see one | Read-only commercial-milestone marker on Calendar/Gantt, sourced from `Sow.milestones` | Data-model (row-shape) + UI | P2 |
| Delivery | `GanttChart.tsx`, `lib/tree.ts` | No virtualization; ancestor chains re-walked per row — O(n²)-shaped, fine at 247 issues, a scale ceiling | Windowed rendering; memoize ancestor chains | UI + algorithm | P2 |
| Resourcing | `CapacityPanel.tsx` `AllocateForm` | No in-place edit of an existing allocation — only delete-and-recreate or the narrower reactive drawer | Inline Edit action reusing the edit-by-id path already proven in `ReplanningDrawer` | UI-only | P2 |
| Resourcing | `CapacityPanel.tsx` `CommitmentForm` | Leave/commitment entry gated to people already allocated to the open project — bench staff unrecordable | Person-first leave/commitment entry independent of project allocation | UI-only | P2 |
| Resourcing | `PatternTimeline` (working pattern) | Only reachable for people already allocated — a new joiner's capacity stays on the shipped default until first staffed | Surface from a people-directory/profile screen | UI-only | P2 |
| Resourcing | `app/my-week` mobile entry | Filtered to `owner === me` only, no correction path — an Assignment-holder who isn't the owner can't log time from a phone at all | Extend picker to assigned-but-not-owned issues; lightweight correct/withdraw | UI-only (reuses existing rules) | P2 |
| People | `ProfilePanel.tsx` History tab | Shows what a person did, never what was done to them | Add a toggle filtering audit rows where the person is the object, not the actor | UI (audit data already exists) | P2 |
| People | `PeopleDirectory.tsx` columns | No skill/grade/track column or facet | Optional grade/track/top-skill column or filter chip | UI-only | P2 |
| People | Joiner intake form | Skills, grade/track, client-scope excluded from intake despite being fully modelled | Prompt to continue into Skills/Career after "Add person" succeeds | UI-only (workflow) | P2 |
| People | Career tab / My calendar | `ResourceProfile` (hours/day, days/week, billable target) never shown to the person it describes | Read-only display on Career tab | UI-only | P2 |
| Client | `ClientPackView.tsx` | Generation and distribution are entirely manual — no schedule, no auto-delivery | Scheduled job (reusing the existing `infra/schedule.bicep` pattern) building and placing the pack | Workflow / integration | P2 |
| Client | `docs/guest-access.md` (3 unreconciled manual systems) | Failure discoverable only when the client reports an empty workspace | A Configuration screen showing, per client, whether Entra invite / seat / at least one visible record all exist | UI (reads existing state) | P2 |
| Client | Mailbox intake pipeline (`docs/intake.md`) | Every reply becomes a new, unlinked issue even once deployed — self-documented, not yet fixed | Thread by `conversationId` per the doc's own named fix | Data-model + integration | P2 (contingent on the already-known deployment blocker) |
| Governance | `Permissions` tab | 47 ungrouped columns, no bundles, no role-to-role copy | Group columns by logical cluster; add "copy grants from role" | UI-only | P2 |
| Governance | Health-score weight changes | No audit trail on who/when changed a weight, unlike Rates or Changes | Record and surface by/recordedAt/reason, same shape as `PersonRate` | Small data-model + UI | P2 |
| Governance/Finance | `FinanceReportDialog.tsx` | Named "Finance report" but contains no rates/amounts by design — mismatched expectation | Relabel to make the hours-only boundary explicit | UI-only (copy) | P2 |

### P3 — worth doing, no urgency; and decisions needed before building

| Business area | Item | Note | Priority |
|---|---|---|---|
| Delivery | Board swimlane grouping by owner/client | Genuine gap vs. Jira/Trello class, but status-lane structure stays as-is | P3 |
| Delivery | Severity vs. business-priority conflation | **Needs Nishant's decision, not a build** — one field currently carries both "how serious" and "how urgent to the client"; flag, don't fix, without confirming intent first | P3 — decision first |
| Resourcing | `TimesheetPanel.tsx` project/client filter | Minor, scale-only usability gap | P3 |
| Client | `MailLog.tsx` search | No date range or outcome (accepted/refused) filter | P3 |
| Governance | `Service levels` tab bundling SLA + holidays | Discoverability only, not incorrect | P3 |
| Governance | `Goals` vs. SOW value relationship | **Needs a product decision, not a build** — two independently-typed "target" numbers with no stated relationship | P3 — decision first |
| Strategy | Growth Suite (CRM) | Already an open build-vs-buy question, and outside Axiocloud's recorded core capability per `office-axiomate/CLAUDE.md` — not a TMS code gap | — flagged for awareness only |

## 4. Recommended page designs — the three highest-priority *new* pages

*The P0/P1 register above is mostly targeted fixes to existing pages. These three items are
the genuinely new pages worth designing properly before building, because each closes a gap
named independently by more than one domain review.*

### Design 1 — Resourcing workspace (new view, "resourcing" key)

**Why this one first:** it's the single most-repeated gap across the review — resourcing has
no home above a single project, and the reconciliation gap (allocation vs. actual) has nowhere
to live either. Everything it needs already exists as a pure function (`lib/availability.ts`,
`lib/capacity.ts`); this is an aggregation view, not new computation — consistent with the
project's own "never invent information" discipline.

**Structure:**
```
┌─ Resourcing ──────────────────────────────────────── [Window: Sep–Nov ▾] ─┐
│ Summary tiles: Fully staffed · Under-allocated · Over-allocated · Bench   │
├────────────────────────────────────────────────────────────────────────┤
│ [Quick filter: name/project/client            ]  Group by: Person ▾     │
├──────────────┬────────────┬──────────┬───────────┬──────────┬──────────┤
│ Person       │ Allocated %│ Actual hrs│ Variance  │ Projects │ Bench?   │
├──────────────┼────────────┼──────────┼───────────┼──────────┼──────────┤
│ (rows, sortable, clicking a row opens that person's ProfilePanel Work tab)│
└────────────────────────────────────────────────────────────────────────┘
```
- List page pattern, consistent with the shipped discipline: quick filter above the grid,
  first column links out, plural title.
- "Group by" toggle: Person (staffing view) or Project (capacity-per-engagement view) — reuses
  the same underlying rows, just pivoted.
- Allocated % and Actual hrs side by side is the reconciliation figure (§3, P1 row) — the one
  new computation needed, and it's a join of two already-correct pure functions, not a new
  metric.
- Row action: "Allocate" opens the existing `AllocateForm`, unchanged, just reachable from a
  person instead of only from a project.
- Role difference: only resource-manager-permission holders see this view at all — it never
  reaches the client nav, consistent with `CLIENT_GROUPS`.
- Responsive: on narrow viewports, collapse to a card list (name + the four key figures),
  matching the existing card fallback pattern used elsewhere in the app.

**Why better than today:** today this same information requires opening every project's
Capacity tab one at a time. This view answers "who's free" and "are we over-committed and
under-delivering" in one place, using only data and logic that already exists.

### Design 2 — Portfolio-wide commercial register (new view or Portfolio tab)

**Why this one:** the commercial governance machinery (`CommercialPanel.tsx`) is the most
mature process reviewed, and its computations (`sowPosition`, `milestonePosition`,
`invoicePosition`) already produce exactly the figures a partner needs — just per-engagement,
one at a time.

**Structure:**
```
┌─ Commercial ──────────────────────────────────── [rate.view-gated] ─────┐
│ Tabs: All SOWs │ Overdue milestones │ Unpaid invoices │ At-risk margin  │
├──────────────┬──────────┬───────────┬───────────┬──────────┬──────────┤
│ Engagement   │ SOW value│ Cost/Margin│ Status   │ Next mile.│ Owner    │
├──────────────┼──────────┼───────────┼───────────┼──────────┼──────────┤
│ (rows link into that engagement's CommercialPanel; nothing computed new)│
└────────────────────────────────────────────────────────────────────────┘
```
- Gated on `rate.view`, same as today's per-engagement commercial data — no new access
  surface.
- Each tab is a filter over the same underlying register (overdue = `milestonePosition`
  showing a past-due delivery date and no acceptance; at-risk margin = `sowCostOf`'s margin
  under a configurable threshold, reusing the health-score's own "configurable threshold,
  printed working" discipline rather than inventing a silent cutoff).
- Row click opens the real `CommercialPanel` for that engagement — this view is a finder, not
  a replacement for the detail screen.

**Why better than today:** turns "check every engagement one at a time before the Monday
finance meeting" into a single screen, using logic that's already correct.

### Design 3 — Client Milestones view (new client-facing view, `CLIENT_GROUPS` addition)

**Why this one:** it's the cheapest possible build against the brief's specific ask
("transparency without exposing confidential information") — the underlying `Milestone` data
already exists, only a client-safe projection is missing.

**Structure:**
```
┌─ Milestones ──────────────────────────────────── (client view) ────────┐
│ Timeline / list: name · planned date · delivered date · status         │
│  ✓ Discovery workshop        Delivered  12 Aug                         │
│  ● Phase 1 build             In progress · due 30 Sep                  │
│  ○ UAT sign-off              Planned · 15 Oct                          │
└────────────────────────────────────────────────────────────────────────┘
```
- Deliberately excludes `amount`/`percentage` (commercial) — only name, planned/delivered/
  accepted dates, and status, matching exactly what `ClientPackView.tsx`'s payment-schedule
  section already shows manually.
- Added to `CLIENT_GROUPS` alongside Tree/Board/Calendar — a fourth read-only client tab, not
  a new permission model.
- Pairs naturally with Design in §3's "client notification" row (P1): a milestone delivered
  could fire the same new notification class, closing two gaps with one underlying event.

## 5. Prioritized improvement roadmap

**1. Quick wins — UI-only, no business-rule change (do in one pass, same shape as a normal
sprint of small fixes):**
Board health chip + sort · Analytics/Portfolio/Applications row-to-filtered-Tree links ·
FactBox Engagement/Project variant · Rates form `.cfg-fld` conversion · Settings-index missing
Governance cards · MailLog date/outcome filter · People-directory grade/skill column ·
`ResourceProfile` visibility on Career tab · "Finance report" relabel · Permissions column
grouping. Business value: real, compounding usability; low risk, no data migration, no
approval workflow touched.

**2. High-value workflow fixes — the two P0s plus the workflow-shaped P1s (do next, deliberately
before new pages, since they're correctness gaps on processes already live):**
Client-note visibility fix (P0) · Departure write-path gating (P0) · Checklist-gates-closure
(config-driven) · Multi-select/bulk actions in Tree/Board · Calendar admitting milestone rows ·
Rate-change approval step · Client intake confirmation email · Person-first leave/allocation
entry · Profile-change notification. Business value: closes real, sometimes reproducible,
defects on processes the firm already depends on daily. Risk: the client-note fix and
departure-gating both touch write paths shared by other kinds — test against the existing
reducer harness before shipping, per this codebase's own established discipline.

**3. Structural improvements — data-model or cross-cutting architecture (need a maintenance
window or an explicit design pass, not a quick PR):**
Resourcing workspace (§4 Design 1) · Allocation-vs-actual reconciliation · Portfolio-wide
Commercial register (§4 Design 2) · Client Milestones view (§4 Design 3) · Client notification
class · `expected` optimistic-concurrency extended to Allocation/Commitment (already tracked as
audit finding M4) · Calendar/Gantt showing commercial milestones · Onboarding checklist model ·
Mail threading by `conversationId` (contingent on the mailbox-intake deployment blocker, already
known). Business value: closes the gaps most repeated across independent domain reviews
(resourcing visibility, reconciliation, client transparency). Dependencies: Resourcing and
Commercial register both only need aggregation over existing pure functions — no new
permission model, no schema migration for the register itself. The client notification class
and client milestone projection do need small, additive schema/shape work.

**4. Longer-term product opportunities (need either an architecture pass or a blocker to
clear first):**
People Suite's Capability Matrix / Staffing match-score / Career Evidence (blocked on a
missing "skill demand" schema concept — no project or role records required skills, so there's
no denominator for a supply-vs-demand computation; cheapest fix is building the report layer
once that concept exists, not before) · Scheduled/auto-delivered client packs (reuses the
existing `infra/schedule.bicep` pattern, but is genuinely a new automation, not a UI change) ·
Guest-onboarding reconciliation screen · Board swimlanes. **Two items need a decision, not a
build, before anything happens**: whether severity should stay a single overloaded field or
split from a separate business-priority axis, and what relationship (if any) `Goals` targets
should have to SOW value. Both are named explicitly rather than guessed at, per Operating
Principle 3 (challenge unclear requirements) — see §3's P3 table.

## 6. Open questions for Nishant

1. Is severity deliberately a single axis (technical severity only), or should business
   priority/urgency-to-client be tracked separately? (§3, P3)
2. Should `Goals` targets relate to SOW value at all, or are they intentionally independent
   measures living in the same Governance group by coincidence? (§3, P3)
3. Is the Resourcing workspace (§4, Design 1) worth building before or after the Commercial
   register (§4, Design 2) — they're independent, so this is purely a sequencing call given
   founder gate-approval bandwidth is the real constraint, not effort.
4. Confirm whether the client-note visibility bug (§3, P0) should be fixed for future notes
   only, or whether existing "invisible to their author" notes need a one-time backfill pass
   correcting `clientVisible` for notes authored by a client-role actor.
