# OAPIL/SLG WBS import — implementation plan

Follows `docs/plans/2026-09-02-oapil-slg-wbs-import-design.md` (Phases 1–2 only). Ordering
principle: pure logic first — the extraction and transform scripts are provable with zero
database access before either touches the reducer; the two reducer changes each get a scenario
before the import script is allowed to call them; the actual writes against production are last,
and are runs, not commits, exactly like the 2026-09-01 work-tree wipe.

Two corrections to the design doc's assumptions, found while grounding this plan against the
real code (both are why they're written down here rather than trusted from the design doc):

- `upsertWorkType`'s `ConfigOp` has no `fromSource` field — a new type's `fromSource` is always
  `false` (`lib/workspace.ts:7628`, `existing?.fromSource ?? false`). That's fine: `WT_RISK` and
  `WT_DECISION` — the two existing types this workspace added itself rather than inherited from
  the source log — are also `fromSource: false` in the live data. `WT_EPIC`/`WT_DELIVERABLE`
  match that precedent, not the design doc's stated "fromSource: true".
- `meetingProblem()` has exactly **one** call site in the whole codebase —
  `lib/workspace.ts:6614`, inside `case 'upsertMeeting':`. There is no separate client-side form
  validator calling it too. This makes the `requireAttendees` change lower-risk than the design
  doc worried (one call site to update, not several to find), but the risk described below still
  applies to that one site, because it's the one every meeting in the app goes through.

## Step 1 — Extract the two WBS sheets to raw JSON (pure, no DB)

New script `scripts/extract-wbs.ts`, run with `npx tsx scripts/extract-wbs.ts`. Reads
`OAPIL_SLG_PM_Tracker_STAGED.xlsx` via `ExcelJS.Workbook().xlsx.readFile(path)` (the package is
already a dependency — `package.json`, `"exceljs": "^4.4.0"` — but has zero existing TypeScript
callers in this repo, so this is the first real use; confirm the row/cell iteration API
(`worksheet.eachRow`, `row.getCell(n).value`) against the installed version before assuming it,
by running it against the real file and checking the output, not by reading exceljs's own
source first). Reads both `OAPIL WBS` and `SLG WBS` sheets — title row 1, blank row 2, header
row 3, data from row 4 — into one flat array of plain objects keyed by the real header strings
(`ID`, `Workstream`, `Parent`, `Type`, `Title`, `Owner`, `Client Stakeholder`, `Status`,
`Priority`, `Origin`, `Source Ref`, `Estimate`, `Planned Start`, `Planned Finish`, `Dependency`,
`Flag`, `Comments`, `Description`, `Next Action`), tagging each row with which project it came
from (`OAPIL` or `SLG`) since the sheet itself doesn't carry that as a column. Writes
`data/wbs.raw.json`. Takes the xlsx path as a CLI argument rather than hardcoding
`C:\Users\NishantSekhar\Downloads\...` — a path under a specific user's `Downloads` folder has
no business being a constant in a committed script.

**Verify:** `npx tsx scripts/extract-wbs.ts "<path to xlsx>"` then `node -e "const d =
require('./data/wbs.raw.json'); console.log(d.length)"` — must print `151`. Spot-check one row
from each project against a value read directly from the workbook this session already has
(e.g. `OAPIL-001`'s `Title` should read "MSA & Service Order commercial framework (phased 2-yr
commitment)"; `SLG-001`'s should read "POS Purchase Order Receiving Requirements").

## Step 2 — Pure transform: raw JSON → seed actions (pure, no DB)

New script `scripts/transform-wbs.mjs`, following `scripts/transform-issues.mjs`'s shape exactly
(the one precedent this repo has for this exact kind of step): reads `data/wbs.raw.json`, applies
the design doc's own mapping tables — type routing, status best-fit, workstream→module name — and
**throws on any `Type` or `Status` value not in those tables**, the same refusal
`transform-issues.mjs` already uses ("refusing to guess"). Does not touch the database. Writes
`data/wbs.seed.json`.

This step does the real modeling work the design doc specifies:

- **Topological ordering.** Walks `Parent` to build a dependency graph, then emits rows in an
  order where every row appears after its `Parent`. Rows with `Parent = 'Not Provided'` are
  roots. Detects cycles and unresolvable references (a `Parent` value that matches no `ID` in
  either sheet) and throws immediately, naming the offending row — this is the design doc's own
  first "what would send this back" condition, and it must be checked here, in a script a human
  reads the output of, not discovered as a runtime failure deep inside the actual import.
- **Type routing**, per the design doc's table: `Task/Epic/Decision/Requirement/Deliverable/
  Issue/Risk/Dependency/Work Package/CHALLENGE/Defect/Change/Development` → an issue-shaped
  record (with `type`, `sourceType` set per the table). `Corrective Action/Milestone/
  Investigation/Verification` → an activity-shaped record referencing its parent's (future)
  issue id. `Approval` → an approval-shaped record. `Meeting` → a meeting-shaped record.
- **Status mapping**, per the design doc's table, with the raw value appended to the record's
  description text (`"Source status: <raw value>"`) rather than dropped.
- **Hierarchy targeting.** Each root row's `Workstream` value, split on the first `(`, becomes a
  module name; the transform collects the distinct set (11 for OAPIL, 3 for SLG — confirm the
  exact count against Step 1's real output, don't assume the count read during design) as a
  separate `modules` list in the seed output, so the import step can create them once each rather
  than the transform trying to deduplicate node-creation across 151 rows itself.
- **Owner/Discipline**: written through verbatim as raw text (`owner` field), `ownerId` and
  `discipline` absent from the seed record entirely — not merely null, absent, so a later reader
  can't mistake "the transform ran and found nothing" for "this field was never attempted."

Output shape mirrors `issues.seed.json`'s own convention: `{ meta: {...}, modules: [...], issues:
[...], activities: [...], approvals: [...], meetings: [...] }`.

**Verify:** `node scripts/transform-wbs.mjs` (no `--apply` flag exists or is needed — this script
never touches a database) then inspect `data/wbs.seed.json`: `issues.length` should be `151 -
14 (activities) - 2 (approvals) - 2 (meetings) = 133`, `activities.length === 14`,
`approvals.length === 2`, `meetings.length === 2`, `modules.length === 14` (11 OAPIL + 3 SLG).
Re-run with one row's `Type` temporarily edited in `data/wbs.raw.json` to an unmapped value and
confirm the script throws rather than silently defaulting — this is the one behavior in this
step worth proving negatively, not just positively.

**This is the single detail most likely to be gotten wrong across the whole plan**: if the
topological sort or the module-name split is off by even one row, every downstream id
(`parentIssueId` references, activity/approval/meeting parent links) is wrong in a way that
won't necessarily error — it'll just attach the wrong things to the wrong issues. Step 2's own
verification above (inspect the seed JSON directly, don't just check it ran without throwing) is
what catches this before it reaches production.

## Step 3 — `addActivity`: new reducer action (code)

`lib/workspace.ts`: add `{ t: 'addActivity'; issueId: string; phase: string; isMilestone:
boolean; plannedStartDate: string; plannedEndDate: string; owner: string; now: string }` to the
`Action` union (near `buildLifecycle`, line ~1311), and a `case 'addActivity':` reducer arm
alongside `case 'buildLifecycle':` (line ~3343).

Shape, grounded against `buildLifecycle`'s own arm and the real `ActivityRec` interface
(`lib/workspace.ts:318`): refuse if `state.issues[a.issueId]` doesn't exist; refuse if the actor
lacks `lifecycle.build` (the same permission `buildLifecycle` already requires —
`lib/access.ts:525`, `ACTION_PERMISSIONS.buildLifecycle: 'lifecycle.build'` — reuse the same key
rather than inventing a new one, since this is the same authority exercised a different way).
Mint the id by continuing `buildLifecycle`'s own per-issue counter
(`${issueId}#${existingCountForThisIssue + 1}`) rather than a fixed `#1..#5` — so a caller that
runs both `buildLifecycle` and `addActivity` against the same issue never collides, even though
nothing in this plan actually does that. Set `origin: 'user'` (not `'generated'`) — an imported
historical row is a reported fact, not something the lifecycle generator synthesised, and
`ActivityRec.origin`'s own doc comment says exactly this distinction matters for how a row is
presented. `order` = the same counter used for the id. `scheduleMode: 'MANUAL'` (the caller
supplied explicit dates; `AUTO` is for rows the generator is still allowed to reflow).
`percentComplete`: derive from the parent issue's status the same way `buildLifecycle` does
(`STATUS_PROGRESS[issue.status]`), not left at 0 — a Completed WBS row's Investigation phase
shouldn't read as 0% done.

**Verify:** new scenario `AA1` in `scripts/scenario-validation.ts` (pick the next free 2-letter
prefix — confirm `AA` is actually unused by grepping the file first, this session has used up a
lot of prefixes) proving: (a) `addActivity` on a real issue succeeds and the resulting
`ActivityRec` has the fields above; (b) refused without `lifecycle.build`; (c) refused against a
nonexistent `issueId`; (d) a second `addActivity` on the same issue mints a non-colliding id.
Run `npm run validate:scenarios` — PASS count increases by 1, 0 FAIL, nothing that passed before
regresses.

## Step 4 — `meetingProblem`/`upsertMeeting`: scoped validation relaxation (code)

`lib/meetings.ts`: `meetingProblem(m, opts?: { requireAttendees?: boolean })` — the
`attendeeIds.length` check (line 52) becomes `if ((opts?.requireAttendees ?? true) &&
!m.attendeeIds.length)`. The title and time checks are unchanged and unconditional — both
sampled Meeting rows have real dates, so nothing about this import needs the time check relaxed,
and relaxing it anyway would be loosening a rule for no reason this data requires.

`lib/workspace.ts`: `upsertMeeting`'s action type gains one optional field,
`requireAttendees?: boolean`; `case 'upsertMeeting':`'s call to `meetingProblem` becomes
`meetingProblem({ title: a.title, startAt: a.startAt, endAt: a.endAt, attendeeIds }, {
requireAttendees: a.requireAttendees })`. Every existing caller of `upsertMeeting` (the UI form —
find it, it's the only other place besides this import that will ever construct this action)
omits the field, so `?? true` keeps today's behavior exactly. Only the import script sets
`requireAttendees: false`, and only for the 2 Meeting-typed rows.

**This is the step carrying the most regression risk in this plan.** `meetingProblem` gates every
meeting anyone in the app creates, through the one call site confirmed above. If the default
flips (an `?? true` typo'd as `?? false`, or the optional field accidentally required), the
failure mode is silent, not loud: a person using the ordinary "schedule a meeting" UI could book
a meeting with nobody in it, and nothing would refuse it — the same "wall vs. silent gap" pattern
`ruleProblems` itself warns about elsewhere in this codebase. The scenario below exists
specifically to catch this before it ships, and the plan's own review of the diff should treat
the default value as the single line most worth re-reading.

**Verify:** extend or add a scenario proving both directions explicitly: (a) `upsertMeeting`
with `attendeeIds: []` and no `requireAttendees` field is refused exactly as today ("A meeting
with nobody in it is a calendar note"); (b) the same call with `requireAttendees: false`
succeeds. `npm run validate:scenarios` — PASS count increases, 0 FAIL, and specifically confirm
by name that any existing meeting-related scenario (grep the file for `upsertMeeting` first to
find its id) still PASSes unchanged.

**Steps 3 and 4 are one commit.** Both are `lib/workspace.ts` reducer changes with their own new
scenarios; splitting them would leave either half-tested against a partial standing gate.

## Step 5 — Standing gate for the code changes (Steps 3–4)

`npx tsc --noEmit` → `npm run validate:scenarios` (exact new PASS count, 0 FAIL, nothing
regresses) → `npm run audit:a11y` (this plan touches zero UI — `.tsx` files — so this should be a
no-op; run it anyway rather than assuming) → `npm run build`. Commit Steps 3–4 together per the
message above. This commit must be **deployed to the live app before Step 8**, because Step 8
dispatches `addActivity`/the new `upsertMeeting` field through `persistActions`, which runs the
same reducer code the deployed app runs — the production database's row-level security means
nothing in Step 8 can bypass this reducer anyway (confirmed this session: an unscoped connection
sees zero rows, and there is no path around `applyWithRules`/`runBatch` for a tenant-scoped
write), so the new action literally cannot be dispatched against production until the code that
defines it is what's running there. Follow the same staged-deploy recipe used all session
(archive → fresh dir → `npm ci` → `prisma generate` → `npm run build` → package → `az webapp
deploy` → health poll → grep the deployed bundle for `addActivity` to confirm it shipped).

## Step 6 — Phase 1 config write: two work types + one approval rule (live data, not a commit)

New one-off script (deleted after this run, same convention as the wipe script), using
`withTenant('axiocloud', ...)` / `persistActions` against the deployed code from Step 5:

1. `{ t: 'config', op: { k: 'upsertWorkType', id: 'WT_EPIC', label: 'Epic', description: "The
   WBS's own top-of-chain concept — everything else's Parent chain traces back to one." }, now }`
2. Same for `WT_DELIVERABLE`.
3. Read the current `state.model.approvalRules` (must not discard the existing array —
   `setApprovalRules` replaces it wholesale, confirmed at `lib/workspace.ts:7455`), append one
   new `ApprovalRule`: `id: 'imported-historical'`, `label: 'Imported historical approval'`,
   `workTypes: []` (matches everything — this rule isn't gating a live status transition, it
   exists only so `requestApproval` has a rule to point at for 2 historical rows),
   `status`: pick whichever `IssueStatus` reads most honestly for a record of something already
   decided (`'Closed - confirmed'` is the closest fit — confirm against the two real rows'
   actual `Status` values from the sheet, which Step 1's output will show, before hardcoding
   this), `deciderRoleIds`: at least one real, live role id (`ROLE_ENGAGEMENT_LEAD` or
   `ROLE_PROJECT_MANAGER` — check which the live `OperatingModel.model.roles` actually has
   enabled, don't assume), `question`: a real sentence, `enabled: true`. Dispatch
   `{ t: 'config', op: { k: 'setApprovalRules', rules: [...existing, newRule] }, now }`.

**Verify:** before dispatching, run `ruleProblems([...existing, newRule])` locally against the
real current rules (read live, the same way the wipe script's counts were read live) and confirm
it returns `[]` — this is the same validation the reducer itself runs, and catching a problem
before the write is cheaper than after. After dispatching, `withTenant('axiocloud', tx =>
tx.$queryRaw...)` or simplest: re-run `loadWorkspace('axiocloud')` and check
`state.model.workTypes.WT_EPIC`, `.WT_DELIVERABLE`, and `state.model.approvalRules.find(r =>
r.id === 'imported-historical')` are all present with the expected fields.

## Step 7 — Phase 2 hierarchy write: 14 new module nodes (live data, not a commit)

Same one-off script, continuing the batch or a second `persistActions` call (either is fine —
these are structural, non-issue creates, and don't depend on Step 6 having happened in a
separate transaction, only on having happened first). For each of the 14 module names Step 2's
`data/wbs.seed.json` collected: `{ t: 'create', parentId: 'project:2' (OAPIL) or 'project:3'
(SLG), kind: 'module', draft: { name: <workstream name> }, now }`. Confirm `canParent('module',
'project')` holds (it must — the existing Client-Issue-Log-derived modules already sit at this
exact position) before dispatching, and confirm the createdId scheme (`module:<seq>`, per
`case 'create':`'s structural-node branch, line ~2002) so Step 8 can look each new module id up
by matching on `.name` after this step, rather than needing this step to hand ids back directly.

**Verify:** re-load the workspace, `Object.values(state.nodes).filter(n => n.kind === 'module'
&& n.parentId === 'project:2').length` should be `existing OAPIL module count (12, confirmed
this session) + 11`; same check for SLG (`existing 3 + 3`). Confirm none of the 14 new names
collide with an existing module's name under the same project (they shouldn't — the two
taxonomies were confirmed not to overlap during design — but confirm rather than assume).

## Step 8 — Phase 2 issue/activity/approval/meeting write (live data, not a commit)

Same one-off script. Reads `data/wbs.seed.json` (Step 2's output) and Step 7's real created
module ids (matched by name), and dispatches one `persistActions` batch, **in the topological
order Step 2 already computed** — this is why that ordering lived in the pure transform step
and not here: this step should not need to re-derive it, only trust it.

For each `issues` entry: `{ t: 'create', parentId: <module id (root row) or parent's real
created issue id (child row)>, kind: 'issue', draft: { name: subject, type, description,
status, ... } }` — **this plan does not reuse the ordinary `create` action's own field-inference
for anything historical**: `raisedDate`, `lastActivityDate`, `severity` need to land as real
values from the sheet, and `case 'create':`'s own arm (confirmed this session, line ~1973) does
not accept them as draft fields at all — it hardcodes `sourceType: ''`, derives `client`/`module`
by walking ancestors rather than accepting them, and has no field for a historical date. **This
is a real gap between what Step 8 needs and what `create` currently does, and it must be
resolved as part of writing this step's actual code** — either by extending `create`'s draft
handling to accept `raisedDate`/`lastActivityDate`/`sourceType` when explicitly supplied (small,
additive, and the safest option since every other caller keeps passing none of those fields and
gets today's behavior), or by a second new action purpose-built for historical import. Recommend
the former, following the same "additive, existing callers unaffected" shape as Steps 3–4 —
write this as its own scenario-provable sub-step before Step 8 dispatches anything, not
discovered mid-import.

For each `activities` entry: `{ t: 'addActivity', issueId: <parent's real created issue id>,
... }`. For each `approvals` entry: `{ t: 'requestApproval', subjectId: <parent's real created
issue id>, ruleId: 'imported-historical', note, now }` immediately followed by
`{ t: 'decideApproval', id: <the created approval's id>, decision: 'approved', note, now }` —
confirm from the sheet whether both real Approval rows (`OAPIL-044`, `OAPIL-109`) were actually
approved historically (their `Status` column) before hardcoding `'approved'`; if either shows a
different real status, decide (or leave the approval open) accordingly, per row. For each
`meetings` entry: `{ t: 'upsertMeeting', id: null, title, startAt: <Planned Start>, endAt:
<Planned Finish>, attendeeIds: [], requireAttendees: false, note, now }`.

**Verify:** before dispatching, print the full batch (issue count, activity count, approval
count, meeting count, and the topological order's first/last few ids) and read it — this is the
same "review before apply" discipline `scripts/merge-duplicate-threads.ts` already follows with
its dry-run default. After dispatching: re-load the workspace and confirm exact counts —
`Object.keys(state.issues).length === 133`, activities added `=== 14`, approvals `=== 2`,
meetings `=== 2` — plus spot-check one full row end-to-end (e.g. `OAPIL-082`, an Investigation
activity, really attached to the real created id for `OAPIL-081`'s issue, with the right dates).

## What would send this back to design

Carried from the design doc's own list, plus what this grounding pass surfaced:

- A `Parent` value that doesn't resolve (cycle, or points at nothing) — caught in Step 2, before
  any reducer code runs, per the design doc's own first condition.
- The new module nodes needing to merge with the Client-Issue-Log-derived set once Phase 3 is
  designed — per the design doc, watched for, not solved here.
- `addActivity` needing more validation than "parent exists, actor authorized" once real rows go
  through it (Step 3's scenario is where this surfaces, before Step 8 ever calls it live).
- **New**: if `case 'create':` needs more than an additive field extension to accept historical
  `raisedDate`/`lastActivityDate`/`sourceType` — if the ancestor-walk client/module inheritance
  turns out to be load-bearing for something this plan didn't check, extending it blind could
  break the ordinary UI creation path every other feature depends on. Step 8's own sub-step
  (extend `create`, prove it with a scenario) is where this must be caught, before it is wired
  into the live import.
- **New**: if the two real Approval rows' `Status` values (to be read fresh in Step 8, not
  assumed here) show something other than a clean approved/still-pending state — the
  `requestApproval`/`decideApproval` pairing this plan assumes may need a third state (an
  approval requested but never decided, which `decideApproval` simply isn't called for).
