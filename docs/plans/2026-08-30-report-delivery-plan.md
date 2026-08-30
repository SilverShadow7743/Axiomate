# Report delivery — implementation plan

Executes `docs/plans/2026-08-30-report-delivery-design.md` (approved 2026-08-30, four recorded
decisions). Ordering principle: the due-logic and the PDF renderers are pure and get driven by
a scenario before the pass — live unattended automation — is touched at all; the deploy and the
inbox come last. The plan exists to stop ten specific details being got wrong, chiefly two
discovered by reading the pass's code while writing this:

- **`run.observation` is built FRESH by `runWatch`** (lib/db/schedule.ts:66) and is what gets
  upserted (:108–121). A `delivery` field on the stored JSON does NOT survive the write
  automatically — the stamps must be read from the raw row and explicitly carried.
- **Sends cannot run inside the pass's Serializable transaction** (30s timeout, :133). Graph
  HTTP inside it would hold locks through network I/O. Delivery runs after commit; the stamp
  lands in a small follow-up update.

Ground truth verified while writing:

- `runScheduledPass` (lib/db/schedule.ts:40): `today = new Date().toISOString().slice(0,10)` —
  **UTC** (:41–42) — one clock, reused. Loads observation defensively as `Partial<Observation>`
  (:60–64), runs watch + recurrences, persists steps, upserts `scheduleWatch` with
  `run.observation` even on a quiet pass. Returns `ScheduledRun {ok, summary, raised,
  recurrences, diff, misses, refusals}` (:28).
- `Observation {watching, subjects}` (lib/watch.ts:84, `EMPTY_OBSERVATION` :99).
- `sendAsMailbox(mailbox, to, subject, text)` (lib/mail.ts:49): plain-text Graph `sendMail`,
  returns `{ok:true} | {ok:false, status, detail}`; 401/403 drops the token cache.
- Builders: `buildDailyIms(state, rows, asAt, scope)` (lib/reports/dailyIms.ts:107; rows are
  `ScheduleRow[]` — server side that is `buildTree(state, today)` filtered to `kind==='issue'`);
  `buildWeeklyClientPack`/`buildMonthlyGovernancePack(state, clientScopeId, asOf)` with the
  new `PackProgress`; client nodes via `externalPartyKinds(tiersOf(state.model))`.
- Config-op pattern to copy — **`setWatch`**: op type at lib/workspace.ts:1383, arm at :7161,
  name in `CONFIG_OPS` at lib/actionShape.ts:147 (name-only validation, no field whitelist).
  Model merge site at lib/config.ts:~1630 — `documentFiling` shows the **explicit-merge**
  pattern with the load-bearing comment (a stored model predating the key must not yield
  `undefined`). Config persists wholesale via `operatingModel` upsert (lib/db/persist.ts:904)
  — **no persistence, audit or migration work anywhere in this phase**.
- Configuration UI: sidebar id `'watch'` → "Scheduled pass" section (ConfigWorkspace.tsx:117,
  section at ~1436). The delivery card mounts INSIDE that section — its natural home — not a
  new sidebar entry.
- Manual trigger: POST `/api/schedule/run` with `AXIOMATE_SCHEDULE_TOKEN` (App Service setting
  exists, length 32). Linux B1, Node 22; pdfkit is pure JS and fits.

Standing gates after every commit: `npx tsc --noEmit` → `npm run validate:scenarios`
(187 → **188** with RD1, 0 FAIL; `data/validation.json` rides scenario commits, timestamp-only
diffs to data/discussion.json and data/persistence.json reverted) → `npm run build` before
deploy. Scenario splices via temp file + python replace at a unique marker.

---

## Step 1 — `lib/reports/delivery.ts` (pure due-logic)

New file. Exports:

```ts
export interface ReportDeliveryConfig {
  imsEnabled: boolean; packsEnabled: boolean
  imsRecipients: string[]; packDestination: string  // '' = resolve operator at send time
}
export const DEFAULT_REPORT_DELIVERY: ReportDeliveryConfig  // everything false/empty — off by default
export function parseReportDelivery(raw: unknown): ReportDeliveryConfig  // fail-closed: junk → defaults
export interface DeliveryStamps { imsSentOn?: string; weeklySentFor?: string; monthlySentFor?: string }
export function deliveryDue(config, stamps: DeliveryStamps, today: string):
  { ims: boolean; weeklyFor: string | null; monthlyFor: string | null }
```

Rules: `ims` true when `imsEnabled`, recipients non-empty, `today` is Mon–Fri **in UTC** (the
pass's own clock — no second timezone), and `stamps.imsSentOn !== today`. `weeklyFor` is the
**prior** week's Monday (`weekStarting` of `today` minus 7) when `packsEnabled`, today is a
Monday, and `stamps.weeklySentFor` differs. `monthlyFor` is the **prior** month `'YYYY-MM'`
when today is the 1st and `stamps.monthlySentFor` differs. Reuse `weekStarting` from
lib/timesheet.ts rather than re-deriving Mondays.

Verify: `npx tsc --noEmit` clean.

## Step 2 — `lib/reports/pdf.ts` (renderers) + pdfkit

`npm i pdfkit && npm i -D @types/pdfkit`. New file with the design's hard rule in its header:
renderers take **only the report objects and `OrganizationIdentity` — never `WorkspaceState`**
(RP2's sentinel scan pins what a pack object may carry; a renderer that cannot see state
cannot leak what the object does not hold). Exports:

```ts
export async function renderImsPdf(r: DailyIms, org: OrganizationIdentity): Promise<Buffer>
export async function renderWeeklyPackPdf(p: WeeklyClientPack, org: OrganizationIdentity): Promise<Buffer>
export async function renderMonthlyPackPdf(p: MonthlyGovernancePack, org: OrganizationIdentity): Promise<Buffer>
```

Shared branded header (firm name + shortName; logo embedded only when `logoDataUri` matches
`^data:image\/(png|jpeg);base64,` — pdfkit takes the decoded Buffer — wordmark otherwise, and
a failed embed falls back to wordmark inside a try/catch, never a broken document). Bodies
mirror the on-screen sections: IMS position/sections; packs' disclosure line, Position,
Progress (deltas + schedule), weekly Activity table / monthly Movement. Import pdfkit with a
plain server-side import — the module is only ever imported from server code; Step 6's build
check confirms it stays out of the client bundle.

Verify: `npx tsc --noEmit`; RD1 (next step) is the functional check.

## Step 3 — RD1 scenario (same commit as Steps 1–2)

Splice `scenario('RD1', ...)` after RF1 (unique marker: the section-10 banner, as RF1 itself
was placed) via temp file + python. Drives:

- due-logic: a Wednesday with everything enabled → `{ims:true, weeklyFor:null, monthlyFor:null}`;
  a Monday → `weeklyFor` = prior Monday's date (assert the exact string — the off-by-one that
  would send a week still in flight is THE bug this scenario exists to catch); the 1st →
  `monthlyFor` = prior `'YYYY-MM'`; a Saturday → no IMS; stamped `imsSentOn: today` → no IMS;
  `weeklySentFor` already the prior week → `weeklyFor:null`; `DEFAULT_REPORT_DELIVERY` →
  nothing due ever (off by default); enabled but `imsRecipients: []` → `ims:false`;
  `parseReportDelivery(garbage)` → defaults (fail-closed).
- renderer smoke: build an RP2-style fixture pack object and a DailyIms fixture, call all
  three renderers (`await`), assert each Buffer starts `%PDF` and is non-trivially sized
  (> 1000 bytes); one render with a valid tiny PNG data URI and one with `logoDataUri:
  'data:image/svg+xml,...'` (skipped, still `%PDF`).

Note: the scenario runner is sync-per-scenario today — check how existing async work is driven
(E5B and the discussion proof handle async); if `scenario()` bodies must stay sync, RD1's
renderer half uses the established async pattern the suite already contains, or the smoke
moves to a tiny `scripts/pdf-smoke.ts` run by the same gate — decide from what the runner
supports, do not force `await` into a sync body.

Verify: `npx tsc --noEmit && npm run validate:scenarios` → **188 scenarios, 0 FAIL**, RD1 PASS.

**Commit 1**: delivery.ts + pdf.ts + package.json/lock + RD1 + data/validation.json.

## Step 4 — config: `reportDelivery` on the model, op, and the card

- `lib/config.ts`: `reportDelivery: ReportDeliveryConfig` on `OperatingModel` (import the type
  from lib/reports/delivery.ts or define beside `WatchPolicy` and have delivery.ts import it —
  prefer defining in config.ts beside the other policies to keep lib/reports state-free);
  default in the two seed sites (`:1264`-region and wherever `defaultWatchPolicy()` is built);
  **explicit merge** at the :1630 merge block, `documentFiling`-style with the same
  load-bearing comment — a stored model predating the key must parse to disabled, never
  `undefined`. Merge via `parseReportDelivery(stored.reportDelivery)` so junk fails closed.
- `lib/workspace.ts`: `{ k: 'setReportDelivery'; patch: Partial<ReportDeliveryConfig> }` beside
  `setWatch` (:1383), arm beside :7161 — validate emails loosely (trimmed, contains `@`, refuse
  otherwise naming the address), audit line field `reportDelivery`.
- `lib/actionShape.ts`: add `'setReportDelivery'` to CONFIG_OPS (:147 region).
- `components/ConfigWorkspace.tsx`: a "Report delivery" card inside the existing Scheduled
  pass section (~1436): two toggles (IMS / packs), a recipients editor (comma-separated or
  add-row, match the section's idiom), pack destination input with placeholder "operator's
  directory email"; off-state copy says plainly that nothing sends until enabled.

Verify: `npx tsc --noEmit && npm run validate:scenarios` (188, 0 FAIL — config work must not
move any verdict) and the four audits unchanged: `npm run audit:tenancy` (33) /
`audit:persistence` (71) / `audit:attribution` (3/3) / `audit:discussion` (11).

**Commit 2**: config type + seeds + merge + op + actionShape + card.

## Step 5 — ⚠ the pass delivery phase + `sendAsMailbox` attachments

**This is the step carrying the most regression risk, and here is why: `runScheduledPass` is
live automation that runs unattended against production every day. Wrong dedupe spams; wrong
due-logic goes silent; and worst, a wrong Observation write corrupts the memory shared with
the overdue/at-risk watch conditions — re-raising months-old conditions on the next pass, in
nobody's presence. The specific trap found while writing this plan: the upsert writes
`run.observation`, which `runWatch` builds FRESH — stamps spread onto the stored JSON vanish
unless carried explicitly.**

- `lib/mail.ts`: `sendAsMailbox` gains optional TRAILING
  `attachments?: {name: string; contentType: string; contentBytes: string}[]`; the Graph body
  gains `attachments: [...]` with `"@odata.type": "#microsoft.graph.fileAttachment"` **only
  when the parameter is present** — every existing call and its wire body stay byte-identical.
- `lib/db/schedule.ts`, in `runScheduledPass`:
  1. Inside the transaction, additionally read `raw?.delivery` (the stamps) and return the
     loaded `state`, `run.observation` and stamps out of the tx result.
  2. **After the transaction commits**, run the delivery phase: `deliveryDue(parseReportDelivery
     (state.model.reportDelivery), stamps, today)`. For each due item build → render → send:
     IMS from `buildTree(state, today)` issue rows, scope `'All clients'`, one email per
     recipient (or one with multiple recipients — pick one and say so in the run report);
     weekly/monthly packs for every external-party node with ≥1 non-deleted `clientVisible`
     record (skip clients with none — an empty pack to eyeball is noise), `asOf` = the period
     end, sent to `packDestination` or, when blank, the operator's directory email (resolve by
     `AXIOMATE_OPERATOR` name; unresolvable → a miss line, not a throw). Subject names report,
     client and period; body is one line saying what is attached; the PDF is the content.
  3. Stamps: after ALL sends for a kind succeed, one `tx`-free
     `prisma.scheduleWatch.update({where:{tenantId}, data:{observation: {...run.observation,
     delivery: newStamps}}})` — the observation just written this request, held in memory,
     plus stamps. **When delivery is disabled or nothing is due, this update does not run and
     the written observation carries no `delivery` key — byte-identical to today's writes.**
     A failed send leaves its stamp unset (retries next pass, per the design). Honest race,
     stated in code: two concurrent MANUAL triggers can double-send (the daily Logic App alone
     cannot); a duplicate email to the operator is the accepted cost of never blocking the
     watch transaction on network I/O.
  4. `ScheduledRun` gains `delivery: {sent: string[]; refused: {what: string; status: number;
     detail: string}[]}` and the summary line mentions sends — the pass's honesty pattern.

Verify: `npx tsc --noEmit && npm run validate:scenarios` (188, 0 FAIL) — and the specific
guard: with `DEFAULT_REPORT_DELIVERY` the pass's observation write path is untouched (RD1's
off-by-default case plus reading the diff of schedule.ts to confirm the disabled path skips
the second update entirely). `npm run build` clean, and confirm pdfkit appears in NO client
chunk: `grep -l "pdfkit" .next/static/chunks/*.js` returns nothing.

**Commit 3**: mail attachments + pass delivery phase + ScheduledRun shape.

## Step 6 — staged deploy + live verification

Staged FOREGROUND deploy: fresh dir under `$HOME/.claude/jobs/de2e6ea5/tmp/deploy-<sha>` →
`git archive` → cp .env → `npm ci` → `prisma generate` → build → `MSYS_NO_PATHCONV=1
MSYS2_ARG_CONV_EXCL="*" python scripts/package-release.py .next/standalone release.zip --extra
.next/static:.next/static --extra public:public` → `prisma migrate status` ("up to date" — no
migrations this phase) → `az webapp deploy` → health 200.

Live, in order:

1. Deploy is INERT: trigger the pass manually (`POST /api/schedule/run` with the token) with
   delivery still disabled — run report shows no delivery lines, watch behaviour unchanged.
2. Configuration → Scheduled pass → enable IMS + packs, recipients = the operator's address.
3. Trigger the pass manually. Expect: 1 IMS email (if a weekday) + pack emails only if today
   is Monday/the 1st — on any other day, verify the run report says weekly/monthly not due
   (the cadence is the feature; do not force-send what is not due).
4. The user opens the received PDF(s) — branded header, disclosure line, Progress block.
5. Trigger the pass a SECOND time: run report shows nothing sent (stamp dedupe live).
6. Ask the user whether delivery stays enabled — it is the feature, but it is their inbox and
   their Monday mornings; leaving it on is the expected end state.

**Commit 4**: live-found fixes only, each through the full gate.

---

## Details most likely to be got wrong

1. Delivery stamps must be **explicitly carried** into the observation write — `run.observation`
   is fresh from `runWatch` and silently drops unknown fields; and when nothing was sent, no
   `delivery` key is added, keeping disabled-path writes byte-identical.
2. Monday sends the **prior** week (`weekStarting(today) − 7`... precisely: the week whose
   Monday is 7 days before today's); the 1st sends the **prior** month. RD1 asserts exact
   strings.
3. Sends run **after** the transaction — never Graph HTTP inside Serializable; stamps go in a
   follow-up update, written only after successful sends.
4. `sendAsMailbox`'s attachment parameter is trailing and the wire body gains the key only
   when present — existing notification-drain sends stay byte-identical.
5. PDF renderers accept report objects + identity only, never `WorkspaceState`; pdfkit is
   imported from server-only code (Step 5's grep of client chunks is the proof).
6. Client enumeration = external-party nodes with ≥1 non-deleted `clientVisible` record; a
   client with none gets no email.
7. `parseReportDelivery` fails closed (junk/missing → disabled) and the model merge is
   explicit, `documentFiling`-style — a pre-key stored model must not yield `undefined`.
8. One clock: the pass's UTC `today` (schedule.ts:41–42) decides weekday/Monday/1st — no IST
   conversion, no second date source.
9. The run report names what was sent and what was refused, with Graph status — the pass's
   honesty pattern extends to delivery.
10. Scenario splice via temp file + python; `data/validation.json` rides the scenario commit;
    timestamp-only audit-output diffs reverted.

## Commit boundaries

| Commit | Contents | Gate |
|---|---|---|
| 1 | delivery.ts + pdf.ts + pdfkit dep + RD1 + validation.json | tsc; scenarios 188/0 FAIL |
| 2 | reportDelivery config + setReportDelivery op + actionShape + card | tsc; scenarios; audits 33/71/3/11 |
| 3 | sendAsMailbox attachments + pass delivery phase + ScheduledRun.delivery | tsc; scenarios; build; pdfkit absent from client chunks |
| 4 | live-found fixes only | full gate + live checks |

## What would send the design back (from the design, with where each surfaces)

- **The Observation cannot carry stamps cleanly** — if carrying `delivery` through the write
  path disturbs the watch's own fields in any way RD1 or the Step-5 diff review reveals, the
  stamp needs its own column: a storage change the design said it does not need. Surfaces at
  Step 5.
- **pdfkit cannot embed the logos users actually upload** — PDFs ship wordmark-only, a noted
  reduction, not a redesign. Surfaces at Step 2/RD1.
- **Graph refuses attachments for this app registration** — delivery falls back to text bodies
  pointing at the app while consent is fixed, and the PDF half reopens with the user.
  Surfaces at Step 6.3.
