# Timesheet grace and justification — implementation plan

**Design:** `2026-08-22-time-grace-design.md` (approved) · **Date:** 2026-08-22

Ordering: pure policy and rule first, then the arms the scenario can drive, then storage,
then screens, then the deployment nothing can harness. Each step is proven before the next
depends on it.

## Steps

**1. The policy and the parameter — `lib/config.ts`, `lib/timeWindow.ts`.**
`TimePolicy { backdatingAllowanceDays: number }` interface; `timePolicy` on `OperatingModel`
(`lib/config.ts:602` block), defaulted `{ backdatingAllowanceDays: 7 }` in the seed model
factory (~line 1021, beside `statusPolicy`), and merged in `mergeModel` (~line 1274) the way
`statusPolicy` is — a stored model predating the key reads the default, never `undefined`.
`backdated(workDate, entryDate, allowanceDays = BACKDATING_ALLOWANCE_DAYS)` gains the third
parameter; the constant survives as the shipped default only, its comment updated to say so.
*Verify:* `npx tsc --noEmit`; `npm run validate:scenarios` then parse `data/validation.json`
with python (utf-8) — 87 scenarios, 0 FAIL: the default parameter preserves the existing
backdating scenario's boundary assertions unchanged.

**2. The arms, the wire, the op, and TG1 — `lib/workspace.ts`, `lib/actionShape.ts`,
`lib/time.ts`, `scripts/scenario-validation.ts`.
THE STEP CARRYING THE MOST REGRESSION RISK** — it puts a refusal in front of `addTime`,
which succeeds today for every backdated entry, and the person it lands on is a consultant
recording a genuinely late week. If the gate is wrong side of the boundary, honest hours
are refused; if the wire half is missed, the screen's optimistic accept sticks at
"Not saved" exactly as `updateIssue` did this morning (828f975).

- `TimeEntry` (`lib/time.ts:50`) gains `justification?: string | null`.
- `addTime` action arm gains `justification?: string`; the arm computes
  `backdated(a.date, a.now.slice(0, 10), state.model.timePolicy.backdatingAllowanceDays)`
  after the window verdict; when `justificationRequired` and `!a.justification?.trim()`,
  refuse with the module's own message plus what to do; when given, store it trimmed on the
  entry and append `· ${days} days late` to the audit `to`.
- `updateTime`: the patch already flows (`{ ...entry, ...a.patch }` at ~3287 — no reducer
  whitelist exists, so `justification` needs no widening there). The GATE: when the patch
  changes `date` or `hours`, run the same `backdated` check against the **stored** entry's
  date and, if the date moves, the **destination** date — both ends, mirroring the frozen
  check at 3304–3308 — refusing without a justification on the patch.
- SHAPES (`lib/actionShape.ts:556`): `justification: opt(text)` on `addTime` — in the SAME
  commit as the arm, never later.
- `ConfigOp` union (`lib/workspace.ts:1101` block) gains
  `{ k: 'setTimePolicy'; patch: Partial<TimePolicy> }` with an arm beside `setSla` (~5754):
  validate an integer 0–60, refuse outside it in words, audit the change.
- Scenario **TG1**: through the real ops — `config {k:'setTimePolicy'}` to a non-default
  allowance (e.g. 3), then: an entry 3 days late accepted with no reason demanded; one
  4 days late refused without a justification, in the refusal's words; the same accepted
  with one and the reason on the stored entry; `updateTime` moving a stale entry's hours
  gated identically; the audit row carrying the lateness.
*Verify:* `npm run validate:scenarios` — 88 scenarios, 0 FAIL parsed from JSON (never
grepped); TG1 PASS.

**3. Storage — `prisma/schema.prisma`, migration, `lib/db/map.ts`,
`scripts/persistence-proof.ts`.**
`justification String? @db.Text` on `TimeEntry` (schema line ~807, after `note`).
Migration `20260822000004_time_justification` via
`npx prisma migrate diff --from-schema <git show HEAD:prisma/schema.prisma> --to-schema
prisma/schema.prisma --script` — **strip the "Loaded Prisma config" banner line** before
saving. Apply to production with `npx prisma migrate deploy` BEFORE any code deploy.
`timeToRow` / `timeFromRow` (`lib/db/map.ts:666/688`) carry it both ways
(`justification: e.justification ?? null`). The persistence proof gains a late entry whose
justification round-trips.
*Verify:* `npx prisma migrate deploy` reports the migration applied;
`npm run audit:persistence` — 50 passed, 0 failed; `npm run audit:tenancy` unchanged (26).

**4. Screens — `components/TimeTab.tsx` (CRLF), `components/DetailPanel.tsx` (CRLF),
`components/IssueWorkspace.tsx` (CRLF), `components/ConfigWorkspace.tsx` (CRLF),
`app/globals.css` (CRLF).**
- TimeTab add form: compute `backdated(date, today, allowance)` live as the date changes;
  when required, show the lateness sentence and a reason input, and disable Add until it is
  filled — both halves, the arm refusing what the form demands. `onAdd`'s entry type gains
  `justification?: string`; the `IssueWorkspace` dispatch (`{ t: 'addTime', issueId,
  ...entry, now }` at ~2179) carries it by the existing spread — type widening only.
- Recorded entries: a late entry (its stored `justification` non-null) renders a
  `late` marker with the reason beside the note.
- Week decision block: above the Approve/Return controls, list the week's late entries with
  their reasons — this is where the design discharges `approvalRequired`.
- ConfigWorkspace: section `{ id: 'timePolicy', label: 'Time recording', group:
  'Operating model' }` beside `watch` (~line 108); a card with the allowance number input
  dispatching `onConfig({ k: 'setTimePolicy', patch: { backdatingAllowanceDays: n } })`,
  worded "Entries recorded more than N days after the work need a reason."
- `globals.css`: a small `late` marker style beside the existing chip styles.
All five files are CRLF — edit via the python anchored-edit script pattern with count
asserts, never the Edit tool.
*Verify:* `npx tsc --noEmit && npm run build` clean.

**5. Sweep, release, deploy, checklist section 24.**
Full suite re-run (parsed), `npm run audit:persistence`, `npm run audit:attribution`.
Clean-room release: `git archive HEAD` → `npm ci` → `npx prisma generate` →
`npx tsc --noEmit` → `npm run build` → `python scripts/package-release.py .next/standalone
release.zip --extra .next/static=.next/static` → `az webapp deploy` → health probe until
`{"status":"healthy"}`. Checklist section 24 written and driven in the browser: set the
allowance on the config card; record an entry inside it (no reason asked); attempt one past
it (refused in words); justify it (accepted, marker visible); see it flagged in the week
block. Watch the save pill reach "Up to date" — the wire lesson, verified live.

## Details most likely to be got wrong

- **The wire and the reducer widen together.** `justification: opt(text)` lands in SHAPES
  in the same commit as the arm — the exact gap the client-boundary drive found on
  `updateIssue` (828f975), named in the design so it cannot happen twice.
- **Lateness is judged by the server's clock**: `a.now.slice(0, 10)`, never the client's
  `today` prop — the form's live hint may disagree by a timezone, the arm is authoritative.
- **`updateTime` reads the STORED entry's date first**, and the destination only if the
  patch moves it — the same both-ends rule as the freeze check directly above it, and for
  the same reason: editing is the two-step around any gate on adding.
- **`daysBetween` is inclusive** — `days = daysBetween(work, entry) - 1`; exactly at the
  allowance is inside. TG1 asserts the boundary at a non-default allowance so the
  parameter, not the constant, is what is proven.
- **`mergeModel` must default `timePolicy`** or every stored workspace crashes on
  `state.model.timePolicy.backdatingAllowanceDays` — the `statusPolicy` merge at
  config.ts:1276 is the template.
- **Negative lateness stays not-backdated** — `checkEntry` already refuses future work
  dates; `backdated` must not re-refuse them as enormous lateness.
- **CRLF discipline**: workspace.ts, actionShape.ts, config.ts, schema.prisma,
  scenario-validation.ts, persistence-proof.ts, and all four step-4 components are CRLF —
  python anchored edits with count asserts throughout.
- **FAIL gates parse JSON** — `data/validation.json` via python with utf-8 stdout, never a
  string grep.

## Commits

Step 1 alone. Step 2 alone (the risky one). Step 3 alone (migration). Step 4 alone.
Step 5 with the checklist.

## What would send the design back

- **Working days wanted instead of calendar days** — surfaces at TG1 review (step 2), when
  the boundary sentences are read.
- **Late entries wanted blocked outright, not justified** — surfaces at the browser drive
  (step 5), when the refusal-then-accept flow is felt.
- **Per-engagement allowances wanted** — surfaces when the config card is placed (step 4);
  that reopens where the policy lives, not its value, and is a design question.
