# Reporting — implementation plan

Executes `docs/plans/2026-08-30-reporting-design.md` (approved 2026-08-30, four recorded
decisions). Ordering principle: pure builders first, each driven by a scenario before any
caller exists; UI next; the deploy and everything needing a browser last. The plan exists to
stop eleven specific details being got wrong — they are listed at the end and referenced from
the steps that carry them.

Ground truth verified while writing (cite, don't re-derive):

- `lib/reports/clientPack.ts` (207 lines): `buildWeeklyClientPack(state, clientScopeId, asOf)`
  windows `asOf−7 … asOf`; `buildMonthlyGovernancePack` windows `asOf−30 … asOf` and reads its
  `movement` from the CAPPED audit trail with a `trailAvailable` flag. Both build on
  `clientView()` first and count the withheld remainder for the disclosure line.
- `clientView` (`lib/clientBoundary.ts:16`) returns a full redacted `WorkspaceState`; it strips
  estimates entirely (`estimates: {}` at line 102) and filters `activities` to surviving issues.
- `buildTree(state, today)` (`lib/tree.ts:16`) is the canonical per-issue schedule row builder:
  percent = `percentOverride` → `rollUp(activities)` → `STATUS_PROGRESS[status]` (tree.ts:170–179),
  plus `scheduleHealth` (computeHealth) and `projectedCompletionDate = plannedEndDate` (tree.ts:182).
  Progress in the packs = `buildTree(clientView(...), asOf)` — after the boundary, by construction.
- Timesheets: `Timesheet` rows (person/personId/weekStarting always-Monday/status) and
  `TimeEntry` (`lib/time.ts:50`: issueId required, person/personId, date, hours, activity,
  billable, note) live in `state.timesheets` / `state.timeEntries`. `sheetFor(sheets, person,
  week, personId?)` at `lib/timesheet.ts:175`; `weekStarting` at :51.
- Issue→scope: `scopeChainOf(state, id)` at `lib/workspace.ts:755`, `projectOf` at :776;
  external-party tiers via `externalPartyKinds(tiersOf(state.model))` as clientPack.ts:90 does.
- Identity: `OrganizationIdentity {name, shortName, partyCode, description}` at
  `lib/config.ts:165`, held at `model.organization` (config.ts:787), edited by the
  `setOrganization` config op (`lib/workspace.ts:1419` shape, :7878 arm), edited in
  ConfigWorkspace (org section from :536). Config persists WHOLESALE via
  `operatingModel.upsert` (`lib/db/persist.ts:904`) — **no persistSteps or proof work in this
  phase; the four audits stay untouched. No new reducer arms, no migrations.**
- Export menu handlers in `components/IssueWorkspace.tsx`: `exportDailyIms` (:1751, text+CSV
  via `renderImsText`/`renderImsCsv` — there is NO daily-IMS view), `openClientPack` (:1768,
  refuses unless one client is picked), menu items at ~1976–2005. `ClientPackView`
  (components/ClientPackView.tsx, 125 lines) is the print-ready overlay pattern.
- RP2's hardcoded NOT IMPLEMENTED verdict: `scripts/scenario-validation.ts:1988–1999`.
  Scenario count 186 → **187** (RF1 new; RP2 stays one scenario, re-driven).

Standing gates after every commit: `npx tsc --noEmit` → `npm run validate:scenarios` (0 FAIL;
`data/validation.json` rides the scenario commits, timestamp-only diffs reverted) →
`npm run build` before deploy. Scenario splices go through a temp file + python replace at a
unique marker — Bash heredocs eat escapes in this repo's history.

---

## Step 1 — `lib/reports/finance.ts` (pure builder)

New file. Exports:

```ts
export interface FinanceSummaryRow { client; engagement; project; person; billable; nonBillable; total }
export interface FinanceDetailRow  { date; person; issueId; project; activity; billable: boolean; hours }
export interface FinanceException  { person; weekStarting; status: string }
export interface FinanceReport     { period: {from; to}; summary: FinanceSummaryRow[]; dailyDetail: FinanceDetailRow[]; exceptions: FinanceException[]; empty: boolean }
export function buildFinanceReport(state: WorkspaceState, from: string, to: string): FinanceReport
```

Rules, in the order the code should apply them:

1. Enumerate the person-weeks touching the period: for every distinct (person, personId) in
   `state.timeEntries` with a date in `[from, to]`, the weeks are `weekStarting(date)` values —
   NOT a synthetic week walk; only weeks that actually hold entries can be approved or excepted.
2. A week is **included** only when `sheetFor(Object.values(state.timesheets), person, week,
   personId)` returns a sheet with `status === 'Approved'` (detail 1). An included week
   contributes **only its entries with `date` in `[from, to]`** — a straddling week clips.
3. Every non-approved person-week with in-range entries lands in `exceptions`, wording by
   case: no sheet → `"not submitted"`; `Submitted` → `"Submitted — awaiting decision"`;
   `Rejected` → `"Rejected — returned, not re-submitted"` (detail 2 — three cases, not two).
4. Summary grouping: `entry.issueId` → issue → `scopeChainOf(state, issue.parentId)`; client =
   the chain's external-party node name (via `externalPartyKinds(tiersOf(state.model))`, the
   clientPack.ts:90 pattern) else `"(internal)"`; project = `projectOf` name else `"(unfiled)"`;
   engagement = the chain node between them else `"—"`. Billable split from the entry flag.
5. `empty: true` when no approved hours exist in range — the caller renders "No approved hours
   between {from} and {to}", never an empty file. Exceptions still populate when empty.
6. **Nothing money-shaped**: no rate lookup anywhere in the module; the sentinel scan in Step 2
   is the tripwire.

Verify: `npx tsc --noEmit` (clean).

## Step 2 — RF1, the finance scenario (same commit as Step 1)

Splice a new `scenario('RF1', ...)` immediately after RP2's closing `)` (before the
`* 10 — Audit, AI, failure` banner at scenario-validation.ts:2001) via temp file + python.
Fixture builds a state with: one approved week fully inside the period; one approved week
straddling the period edge (assert only inside days count); one submitted-not-decided week;
one recorded-never-submitted week; entries carrying `billable` both ways; and planted
sentinels — a rate amount `77123.45` in the state's rate rows, a leave reason string, an
internal note body (the E5A pattern). Checks:

- approved-only: the two non-approved weeks contribute 0 hours and appear in `exceptions`
  with their exact wordings;
- straddle: the clipped week's total equals its inside-days sum;
- empty period: a range with no approved hours returns `empty: true`;
- sentinel scan: `JSON.stringify(report)` contains none of the three planted strings.

Verify: `npx tsc --noEmit && npm run validate:scenarios` → **187 scenarios, 0 FAIL**, RF1 PASS.

**Commit 1**: `lib/reports/finance.ts` + RF1 splice + `data/validation.json`.

## Step 3 — Progress in the client packs ⚠ highest-regression-risk step

**This is the step carrying the most regression risk, and here is why: the packs are the
product's highest-stakes output — they go to CLIENTS. `buildWeeklyClientPack` and
`buildMonthlyGovernancePack` are live code paths behind the Export menu today. A progress
figure computed from `state` instead of from `clientView(state, ...)`'s return would put the
existence (counts, dates) of internal records into a client document, and nothing on screen
would look wrong. The re-driven RP2 sentinel scan (Step 4) is the tripwire and MUST land in
the same commit as these changes.**

In `lib/reports/clientPack.ts`, both packs gain one field:

```ts
export interface PackProgress {
  periodDeltas: { closed: number; raised: number }   // record dates, never audit (detail 4)
  schedule: { pctComplete: number; onTrack: number; overdue: number; projectedFinish: string | null }
}
```

- Compute from `visible = clientView(state, clientScopeId)` and NOTHING else — the same
  `visible` the builders already hold. `periodDeltas.closed` = visible issues with `actualEnd`
  in `[window.from, window.to]`; `.raised` likewise from `raised`. Each pack uses its own
  existing window.
- `schedule` from `buildTree(visible, asOf)` issue rows: `pctComplete` = mean
  `percentComplete` over non-deleted issue rows (buildTree already encodes override → rollup →
  status-derived); `onTrack`/`overdue` = open rows partitioned by `scheduleHealth`;
  `projectedFinish` = max `plannedEndDate` — schedule fields only; estimates cannot leak
  because clientView already returns `estimates: {}` (detail 3).
- The monthly pack's existing audit-based `movement` (and its `trailAvailable` honesty flag)
  stays exactly as it is; the deltas are a second, complete measure beside it. If RP2's
  fixture shows the two disagreeing for a reason other than the known audit cap, that is the
  design's third send-back clause — stop and put the delta definition to the user.

`components/ClientPackView.tsx` gains a `Progress` section rendering both halves for both pack
kinds, with the deltas labeled "from record dates" so a reader beside the monthly Movement
section understands why two raised-counts can differ.

Verify: `npx tsc --noEmit`; goldens: existing pack fields must be byte-identical for a state
with no in-window deltas (the RP2 fixture asserts the old fields still compute).

## Step 4 — RP2 re-driven (same commit as Step 3)

Replace scenario-validation.ts:1988–1999 wholesale (temp file + python at the `'RP2',`
marker). The new driven body: fixture with a client scope, client-visible records (some with
`actualEnd`/`raised` inside the windows, planned dates, a percentOverride), internal-only
records and notes carrying sentinel strings, plus a rate row sentinel. Build BOTH packs and
check:

- sentinels absent from `JSON.stringify` of each pack (detail 11 — the packs are the
  highest-stakes leak surface, this is the tripwire for Step 3);
- `progress.periodDeltas` and `progress.schedule` compute the expected figures;
- disclosure counts shown < total honestly (internal records counted, never listed).

**The verdict must be EARNED** (detail 9): if the driven checks expose a real remaining gap,
record PARTIAL with the honest stop — a vanity PASS re-breaks the map this phase exists to fix.

Verify: `npm run validate:scenarios` → 187, 0 FAIL, RP2 no longer NOT IMPLEMENTED.

**Commit 2**: clientPack.ts + ClientPackView progress section + RP2 splice + validation.json.

## Step 5 — Branding

- `lib/config.ts:165`: `logoDataUri?: string` on `OrganizationIdentity` with a doc comment
  (small PNG/JPEG as a data URI; absent = wordmark styling).
- `setOrganization` arm (`lib/workspace.ts:7878`): validate the patch — a non-empty
  `logoDataUri` must start `data:image/` and be ≤ 200 000 characters, else refuse with a
  message naming both rules (detail 5 — the guard lives at the op, not the UI). Check
  `lib/actionShape.ts`'s `setOrganization` patch whitelist admits the new field, and extend it.
- ConfigWorkspace organization section (from :536): a file input read via
  `FileReader.readAsDataURL`, a thumbnail preview when set, and a Clear button.
- `components/reports/ReportHeader.tsx` (new, shared): firm name + shortName from
  `model.organization`, report title, period line, generated date; `<img>` only when
  `logoDataUri` is present, with `onError` hiding it (broken data never renders as a broken
  image). Mounted in `ClientPackView` above the existing `<h1>` and in Step 6's finance views.
- `renderImsText` (lib/reports/dailyIms.ts:268): the first line gains the firm name. **Honest
  design adjustment, noted here as the design requires:** the daily IMS is text+CSV with no
  view (IssueWorkspace:1751 downloads two files), so "the IMS gains the branded header"
  shrinks to a firm-name header line (detail 8). `buildDailyIms`'s signature must not change —
  pass the name into `renderImsText` as a new optional trailing parameter so existing calls
  stay byte-identical when absent.
- No persistence work: config persists wholesale (persist.ts:904). No audit changes.

Verify: `npx tsc --noEmit && npm run validate:scenarios` (187, 0 FAIL — pack goldens
unchanged; ReportHeader is view-only) and the four audits still at 33/71/3/11.

**Commit 3**: branding end to end.

## Step 6 — exceljs, the finance dialog and views

- `npm i exceljs` (exact version pinned by the lockfile). Import ONLY via
  `await import('exceljs')` inside the download handler (detail 6 — a static import grows the
  main chunk for everyone).
- `components/FinanceReportDialog.tsx`: period pickers (a week `<select>` built by stepping
  `weekStarting` back from today, a month picker, custom from/to), a preview table rendered
  from ONE `buildFinanceReport` call held in component state, the exceptions listed beneath,
  and the empty-period message when `report.empty`. Buttons:
  - **Download .xlsx** — generated from THE SAME `report` object the preview rendered
    (detail 7, one builder call shared): three sheets `Summary`, `Daily detail`, `Exceptions`
    (the exceptions sheet exists even when empty, carrying "every week in range is approved");
    header rows from the identity (styled firm name + period) and `workbook.addImage` when
    `logoDataUri` is present.
  - **Print / save as PDF** — opens `components/FinanceReportView.tsx`, a print-ready overlay
    in the ClientPackView pattern (`.pack-scrim`/`.pack-page`), ReportHeader on top.
- Export menu (~IssueWorkspace:1976): new item `Finance timesheet…` opening the dialog. No
  client-scoping precondition — this report is internal-financial, not a client pack.

Verify: `npx tsc --noEmit && npm run validate:scenarios && npm run build` — and confirm in the
build output that exceljs landed in its own async chunk, not the shared first-load bundle.

**Commit 4**: exceljs + dialog + view + menu entry.

## Step 7 — Staged deploy and live verification

Staged FOREGROUND deploy (background jobs get killed in this environment): fresh scratch dir
under `$HOME/.claude/jobs/de2e6ea5/tmp/deploy-<sha>` → `git archive` → cp `.env` → `npm ci` →
`prisma generate` → build → `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*" python
scripts/package-release.py .next/standalone release.zip --extra .next/static:.next/static
--extra public:public` → `prisma migrate status` (no new migrations expected this phase) →
`az webapp deploy`.

Live verification, in this order:

1. **Test-person pattern for approvals — never the user's real weeks.** Production's real
   recorded weeks (2026-08-10/17) are unsubmitted; submitting or approving them is a REAL
   business action. Do NOT do it unprompted. Instead: seed a test person + a handful of
   entries (billable and not, two weeks, one straddling the chosen period) via a script actor,
   submit and approve that week through the app's own actions, run the report over it, then
   remove the entries/timesheet/person. The real weeks appearing in the exceptions list IS the
   correct honest output — verify the wording, and tell the user their own weeks are pending
   so they can submit when ready.
2. Download the .xlsx and read it back locally with python/openpyxl: three sheet names, one
   expected summary row with the right billable split, and **no cell anywhere containing a
   rate figure** — the file-level half of the sentinel discipline.
3. Print view: screenshot, header + logo slot render.
4. Logo: paste/upload a small PNG in Configuration, confirm the header shows it; clear it,
   confirm wordmark fallback (no broken image); confirm an oversized/non-image paste is
   refused with the op's message.
5. Packs: scope to one client, open the weekly pack — Progress section, deltas, disclosure
   line; monthly likewise with Movement and deltas side by side.
6. Cleanup through the app's own actions; confirm the register holds no test residue.

**Commit 5**: any live-found fixes (each with its own gate run).

---

## Details most likely to be got wrong

1. Approved-only is resolved per person-WEEK (the sheet), never per entry; an approved week
   straddling the period edge contributes only its in-range days.
2. Exceptions have THREE wordings — not submitted / Submitted — awaiting decision / Rejected —
   returned — because a rejected week is neither approved nor pending.
3. The client packs' no-commercial rule: projected finish from schedule fields only, never
   estimate hours (clientView strips estimates — clientBoundary.ts:102 — so computing from
   `visible` makes the leak impossible; computing from `state` makes it silent).
4. periodDeltas from record dates (`actualEnd`, `raised`), never the capped audit trail; the
   monthly pack's audit-based `movement` stays untouched beside them.
5. `logoDataUri` validated at the `setOrganization` op (`data:image/` prefix + 200KB cap), not
   only in the UI — and `actionShape.ts`'s patch whitelist must admit the field or the op
   silently drops it.
6. exceljs is dynamically imported in the handler; a static import taxes every visitor.
7. The xlsx is generated from the SAME `FinanceReport` object the preview rendered — one
   builder call, or the file and the screen can disagree.
8. The daily IMS has no view — its branding is a header LINE in `renderImsText`, passed as an
   optional trailing parameter so existing output stays byte-identical when absent.
9. RP2's new verdict must be EARNED from the driven checks; PARTIAL-with-honest-stop beats a
   vanity PASS.
10. Scenario splices via temp file + python replace at a unique marker; `data/validation.json`
    rides the scenario commits; timestamp-only diffs get reverted.
11. The sentinel scan covers the finance report AND both packs — the packs go to clients, the
    highest-stakes leak surface in the product — and the pack scan lands in the SAME commit as
    the pack changes.

## Commit boundaries

| Commit | Contents | Gate |
|---|---|---|
| 1 | finance.ts + RF1 + validation.json | tsc; scenarios 187/0 FAIL |
| 2 | clientPack progress + ClientPackView section + RP2 re-driven + validation.json | tsc; scenarios; pack goldens hold |
| 3 | logoDataUri + op guard + actionShape + ConfigWorkspace + ReportHeader + IMS header line | tsc; scenarios; audits 33/71/3/11 |
| 4 | exceljs + FinanceReportDialog/View + Export entry | tsc; scenarios; build (async chunk) |
| 5 | live-found fixes only | full gate + live checks |

## What would send the design back (from the design, with where each surfaces)

- **Sparse approvals gut the report** — if production data puts most hours in exceptions, the
  inclusion rule reopens toward "approved plus submitted, labeled" as a USER decision, never a
  quiet widening. Surfaces at Step 7.1.
- **exceljs infeasible client-side** (bundle cost or styling fidelity) — generation moves
  server-side behind the session gate, or the xlsx shrinks to data-only with PDF carrying the
  brand. Surfaces at Step 6's build check.
- **Delta definitions ambiguous on reopened/straddling records**, or the record-date deltas
  disagree with the audit movement for a reason other than the cap — the definition goes to
  the user for a ruling. Surfaces in Step 4's fixture.
