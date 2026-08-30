# E1 — Leave, holidays, availability, forecast: implementation plan

Follows `docs/plans/2026-08-30-e1-availability-forecast-design.md` (five decisions settled with
the user, recorded there). Standing per-step gates, abbreviated below as **[gates]**: `npx tsc
--noEmit`, `npm run validate:scenarios` (170 scenarios, 0 FAIL; `data/validation.json` rides
only commits whose scenarios changed), `npm run build`. Schema/redaction steps add `npm run
audit:persistence` (64/64), `audit:tenancy`, `audit:attribution` against production.
User-visible steps add the clean-room deploy (archive → scratch → `.env` → `npm ci` → `prisma
generate` → `build` → `package-release.py --extra .next/static:.next/static --extra
public:public` → `migrate status` → `az webapp deploy`) and live Chrome verification.

Ground facts this plan is written against, verified in code:

- `workingDaysBetween`/`addWorkingDays` (`lib/dates.ts:31/:42`) know weekends only.
- `capacityFor` (`lib/capacity.ts:288`) already computes gross − commitments − allocations
  with: `round()` to 2dp at every aggregate, `Math.max(0, gross − committed)` on available,
  the window-average `daysPerWeek / 5` approximation, and the `isPerson` id-or-name join.
  `overlapWorkingDays` (`:274`) clamps ranges then calls `workingDaysBetween`. `planCheck`
  (`:390`) repeats the allocation arithmetic against a project.
- `upsertCommitment` (`lib/workspace.ts:5950`) rebuilds the row **field-by-field** — a new
  field not added there is silently dropped on every edit, and a status a requester could
  rewrite by re-upserting is the design's second send-back clause made concrete.
- `decideTimesheet` (`lib/workspace.ts:4971`) + `decideProblem` (`lib/timesheet.ts`) are the
  asker-cannot-decide pattern to mirror.
- `redactForReader` (`lib/db/boot.ts:286`) already computes `mine` (the reader's directory id)
  and holds the rates precedent; `clientView` empties commitments wholesale (verified,
  `lib/clientBoundary.ts` return block).
- Permissions: declarations live in `lib/access.ts` (`time.approve` at `:78`); role seeds at
  `:251` (ENGAGEMENT_LEAD) and `:258` (PROJECT_MANAGER) both hold `time.approve` — the design's
  "same holders" default for `leave.approve`.
- Prisma `Commitment` (`prisma/schema.prisma` ~`:732`) has no status/reason columns; the
  mappers live in `lib/db/map.ts`; `app/api/workspace/route.ts`'s KINDS allowlist carries
  `upsertCommitment` and must gain any new kind. `lib/autosave.ts:202` parses commitments with
  `parsed.commitments ?? {}` — plain passthrough, optional new fields round-trip.
- Portfolio concerns are `{ kind, count, phrase }` pushes (`lib/portfolio.ts:183–208`).
- To locate during implementation, not assumed: the shared estimate-hours derivation that
  `effortVariance` consumes (imported by `components/TimeTab.tsx` — find its module), and the
  component behind DetailPanel's Schedule tab.

## Step 1 — Holidays in the date math, and the config field (pure)

**Files:** `lib/dates.ts`, `lib/config.ts`.

- `model.holidays?: { date: string; name: string }[]` on `OperatingModel` — optional, absent
  means none, the exact `tiers` pattern from E0 Step 2 (stored Json stays valid, no migration).
  Accessor `holidaySetOf(model): ReadonlySet<string>` beside it.
- `workingDaysBetween(start, end, holidays?: ReadonlySet<string>)` and
  `addWorkingDays(start, n, holidays?)`: a listed date that falls on a weekday stops counting;
  one on a weekend changes nothing (it already didn't count — do not double-subtract). Absent
  set = byte-identical behavior.

**Verify:** throwaway `npx tsx scripts/tmp-verify-holidays.ts` (deleted after): a matrix of
windows with holidays mid-week, on weekends, at range edges, and the empty-set identity against
today's outputs. Then **[gates]**. Commits with Step 2.

## Step 2 — The engine extraction (pure) — THE highest-regression-risk step

**Files:** new `lib/availability.ts`, `lib/capacity.ts`, `lib/workspace.ts` (only the
`upsertCommitment` arm's `capacityFor` call threading holidays — no behavior change),
plus every `capacityFor`/`planCheck` call site gaining the holiday argument (grep
`capacityFor(|planCheck(` for the full list at implementation time).

Every capacity number in the product flows through what this step touches — the Capacity tab,
the leave-booking overallocation warning, assignment availability, the day warning on time
entry. A numeric drift here doesn't error; it quietly changes figures people have already read,
and lands on whoever quotes them next. That is why the golden-value check below is captured
BEFORE the refactor, not reconstructed after.

- **Before touching anything**: write `scripts/tmp-verify-engine.ts` capturing `capacityFor`'s
  and `planCheck`'s current outputs over a fixture matrix (profiles stated/default, 4-day week,
  overlapping commitments, allocations, empty windows). Run it against the UNCHANGED code and
  bake the outputs into the script as expected values.
- `availabilityFor(person, window, deps)` in `lib/availability.ts`, extracted from
  `capacityFor` with its conventions intact: same `round()`, same `Math.max(0, …)`, same
  `isPerson` join (do not "fix" the name-join — E0 Step 6's rule), same window-average.
  Gains: the holiday set (threaded into `overlapWorkingDays`/`workingDaysBetween`), and a
  `pendingLeave` output — Requested-status Leave commitments overlapping the window, counted
  and dated, **never subtracted**. A commitment with absent status is treated as Approved
  (pre-E1 history; see Step 3). The meetings term is a documented zero.
- `capacityFor` becomes a thin consumer returning exactly its current shape; `planCheck`'s
  allocation arithmetic moves onto the same helpers.
- The `Commitment` interface (`lib/capacity.ts:198`) gains
  `status?: 'Requested' | 'Approved' | 'Returned'` and `reason?: string | null` — types only;
  no writer sets them until Step 4.

**Verify:** the golden-value script now runs against the refactored code and must match
byte-for-byte; then extend it with holiday and pending-leave cases (asserting pending never
moves the numbers). **[gates]** — the 170 scenarios include capacity/planCheck coverage and
must stay byte-identical. Add scenario `E1A` (reducer-driven): the engine over a fixture with a
holiday and a Requested leave — numbers unmoved, conflict named. Steps 1+2 are **one commit**
(the engine consuming holidays is the point; halves are meaningless), including
`data/validation.json` for E1A.

## Step 3 — Migration: status and reason on Commitment (stands alone)

**Files:** `prisma/schema.prisma`, new migration, `lib/db/map.ts`.

Additive, **no DML at all**: `status String?` and `reason String?` nullable. Absent status
means Approved by definition in the domain (Step 2's rule), which achieves the design's
"existing Leave rows become Approved" with zero backfill — no RLS loop, no reducer batch,
nothing to re-run. Mappers carry both fields both directions (`?? null`).

**Verify:** `npx prisma migrate deploy` (the user-approval prompt is expected; hand over if
blocked twice), `migrate status` clean; extend `scripts/persistence-proof.ts` with a
status+reason round-trip on a Leave commitment and an absent-stays-absent check (the E0 Step 6
precedent), run `npm run audit:persistence` — 66/66 expected — plus tenancy/attribution.
**[gates]**. One commit, migration and mappers and proof extension together.

## Step 4 — Leave arms, access, redaction (one commit)

**Files:** `lib/access.ts`, `lib/workspace.ts`, `lib/actionShape.ts`,
`app/api/workspace/route.ts`, `lib/db/boot.ts`, `scripts/scenario-validation.ts`.

- `leave.approve` joins the permission declarations (mirroring `time.approve`'s wording:
  "Never your own") and the ENGAGEMENT_LEAD + PROJECT_MANAGER seeds.
- `upsertCommitment`: Leave-kind writes gain the status rule —
  `status = (actor holds leave.approve AND the row's person is not the actor) ? 'Approved' : 'Requested'`.
  An approver recording someone else's leave keeps today's one-step flow (they could approve it
  anyway, and recorder ≠ subject satisfies the rule); anyone's write about THEIR OWN leave —
  including an approver's — lands as Requested. Editing an Approved row's dates/hours by its
  subject re-opens it to Requested (the field-by-field rebuild makes this the natural shape:
  status is computed, never copied from the wire). `reason` rides the action, optional.
  Non-Leave kinds: both fields forced null, exactly as today.
- New arm `decideLeave { id, decision: 'approved' | 'returned', note?, now }`: refuses a
  non-Leave commitment, a missing/deleted row, a decider without `leave.approve`, and the
  subject deciding their own — in `decideProblem`'s words, adapted. `Returned` keeps the row
  visible (My calendar shows it as returned; the subject edits or removes it).
- `actionShape.ts`: `reason: opt(text)` on upsertCommitment; the `decideLeave` shape with
  `decision: req(oneOf(...))`. Route KINDS gains `'decideLeave'`.
- `redactForReader`: commitments mapped so `reason` survives only for `leave.approve` holders
  or when the row's `personId` (or trimmed-name match) is `mine` — the rates posture, using the
  `mine` the function already computes. Dates/hours/status pass untouched.
- Scenarios: `E1B` (request → decide lifecycle: own-decide refused in the right words,
  approver-records-other lands Approved, subject's own write lands Requested, edit re-opens),
  `E1C` (redaction driven directly: a reader without the grant gets dates but no reason; the
  subject gets their own reason; the pending row still names its conflict through the engine).

**Verify:** **[gates]** + all three audits (this step changes what leaves the server). One
commit, arms+shapes+access+redaction together — approval that exists without its privacy half,
or vice versa, is the design shipped in a misleading state.

## Step 5 — Forecast v1 (pure + scenarios)

**Files:** new `lib/forecast.ts`, `scripts/scenario-validation.ts`.

- `forecastFor(issue, estimate, timeEntries, availabilityDeps, today)` returning a verdict
  union: `no-estimate`, `unscheduled`, `achievable { spareHours }`,
  `short { shortfallHours }` — each carrying `remainingHours`, `availableHours`, and the
  engine's `pendingLeave` conflicts. `remaining = max(0, derived estimate hours − Σ actuals)`;
  `available` from `availabilityFor(owner, today → plannedEnd)`. The sentence builder lives
  beside it (one place, so the Schedule tab and Portfolio agree word-for-word), naming an
  assumed working-pattern basis exactly as `describeCapacity` does. Reuse the estimate-hours
  derivation `effortVariance` consumes — locate it first; do not re-derive band math.
- Scenarios `E1D`: the honest-input matrix — no estimate, no due date, short, achievable,
  owner unresolved (assumed basis named), pending-leave conflict riding along.

**Verify:** **[gates]** with the new scenarios; `data/validation.json` rides this commit. One
commit. Nothing user-visible yet — deliberately provable before any screen shows it.

## Step 6 — Surfaces, and the deploy

**Files:** `components/ConfigWorkspace.tsx` (holidays editor + a `setHolidays` op in
`lib/config.ts`'s ConfigOp union, `lib/workspace.ts`'s config arm, and `actionShape.ts`'s
CONFIG_OPS list), the Capacity panel component (leave request keeps its existing form; gains
the reason field and, for `leave.approve` holders, an "awaiting your decision" list mirroring
the timesheet queue's shape), `components/MyCalendarPanel.tsx` (a Requested row renders with a
pending marker — shown, never hidden; a Returned row says so), the Schedule tab component (the
forecast sentence), `lib/portfolio.ts` (worst shortfall as a
`{ kind: 'forecast', phrase: 'shortest on X: short by Nh' }` concern), `app/globals.css`.

**Verify:** **[gates]**, then the clean-room deploy, then live in Chrome:
1. Configuration → add a holiday; confirm a capacity window spanning it drops a day.
2. Request leave as yourself → lands Requested, pending marker on My calendar, availability
   numbers unmoved, conflict sentence present where capacity is shown.
3. Decide it (the account holds `leave.approve`; deciding YOUR OWN must refuse — that refusal
   is itself the live check, in the arm's words) — then record leave for another directory
   person and confirm it lands Approved in one step.
4. Open a record with an estimate and a due date → Schedule tab states the verdict; one
   without an estimate → says so plainly. Portfolio shows a shortfall phrase where one exists.
5. Clean up every test row through the app's own actions (this is production).
One or two commits (config op + editor may stand apart from the leave/forecast surfaces if the
diff grows); each deployed increment gets the full discipline.

## Details most likely to be got wrong

1. **`round()` and `Math.max(0, …)` must survive the extraction exactly** — the golden-value
   script exists to catch precisely the "cleaner" rewrite that moves a rounding.
2. **The `isPerson` join is not to be fixed here** — id when both sides have it, else trimmed
   lowercase name. Deepening it or repairing it are both out of scope (E0 Step 6's rule).
3. **Absent status means Approved** — one rule, stated in the `Commitment` type's comment, the
   engine, and the mapper. A second place deciding differently (e.g. a UI treating absent as
   pending) reintroduces the double-source drift the one-engine rule exists to kill.
4. **`status` is computed in the arm, never copied from the wire** — `upsertCommitment` must
   not accept a status field at the boundary at all (`actionShape` refuses unknown keys; keep
   it that way), or approval becomes decorative exactly as the design's send-back clause warns.
5. **Holidays optional everywhere** — absent `model.holidays` must be byte-identical to today,
   including in `proposeTargetDate`/SLA math if it gains the param; if wiring holidays into SLA
   proposals changes any scenario verdict, that is a legitimate, named baseline change to
   record in the commit — not to absorb silently, and not to avoid by leaving SLA math
   holiday-blind without saying so.
6. **The weekend-holiday no-double-count** in `workingDaysBetween` — a listed Saturday must
   subtract nothing.
7. **`data/validation.json`** rides only the commits that add scenarios (Steps 2, 4, 5).

## What would send the design back

- **Step 2**: the golden-value check failing for any fixture — either the extraction is wrong
  or the old arithmetic was; both reopen the engine section before anything consumes it.
- **Step 4**: the status rule proving unenforceable in `upsertCommitment`'s rebuild shape —
  e.g. a path where the wire can influence status after all — reopens "extension, not new
  entity"; a dedicated Leave entity with its own arms was the alternative the design weighed.
- **Step 5**: the honest-input matrix showing most live records produce "nothing to forecast"
  — the design's own third clause; Portfolio-only was the truer v1 in that world, and the
  Schedule-tab surface should be reconsidered rather than shipped as a wall of shrugs.
- **Step 6**: the leave queue needing more than a list (routing, notifications, delegation) to
  be usable — that is E2's personal-workspace territory arriving early, and it should be named
  and deferred, not absorbed.
