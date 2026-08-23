# Allocation hard cap — implementation plan

**Design:** `2026-08-23-allocation-cap-design.md` (approved) · **Date:** 2026-08-23

Ordering: the policy plumbed first (behaviour-preserving, provable by the suite not
moving), then the gate and its op with AC1 driving both modes, then the screens, then the
deployment nothing can harness. The design's judgement — `capacityFor` — is untouched
throughout; only the gate over it changes.

## Steps

**1. The policy, plumbed — `lib/capacity.ts`, `lib/config.ts`.**
In `capacity.ts`, beside the rule it parameterises: `AllocationPolicy { cap: 'hard' |
'advisory' }`, `DEFAULT_ALLOCATION_POLICY = { cap: 'hard' }`, and
`allocationPolicyProblem(patch)` — refuse any value outside the two-member union, in words.
In `config.ts` (LF, Edit tool): import; `allocationPolicy: AllocationPolicy` on
`OperatingModel` directly under `timePolicy`; `allocationPolicy: { ...DEFAULT_ALLOCATION_POLICY }`
in the seed factory beside `timePolicy`; an explicit `mergeModel` arm
(`{ ...seed.allocationPolicy, ...(stored.allocationPolicy ?? {}) }`) — the crash class the
`sla` comment documents. No cycle: `capacity.ts` imports nothing from `config.ts` (checked
for `timePolicy`, same edge).
*Verify:* `npx tsc --noEmit`; `npm run validate:scenarios` → 88 scenarios, 0 FAIL parsed
from `data/validation.json` with python (utf-8) — nothing reads the key yet.

**2. The gate, the op, and AC1 — `lib/workspace.ts`, `lib/actionShape.ts`,
`scripts/scenario-validation.ts` (all CRLF; python anchored edits).
THE STEP CARRYING THE MOST REGRESSION RISK** — it changes a refusal that production
allocators can currently override into one they cannot, and the shipped default is hard, so
it lands on whoever staffs the next project on the live workspace. Wrong side of the
boundary refuses honest staffing; a missed branch quietly keeps the override alive and the
register item undelivered.

- `upsertAllocation` (`lib/workspace.ts:5228` branch): when
  `state.model.allocationPolicy.cap === 'hard'` and `position.overallocated`, refuse
  REGARDLESS of `a.acceptOverallocation`: `describeCapacity(position)` plus "This workspace
  enforces the allocation cap — free up the person, shorten the window, or lower the share.
  The cap is set on the Configuration screen, under Allocation." The advisory branch is
  byte-for-byte today's behaviour, override audit included. The policy is read from
  `state.model` at apply time, never from anything on the wire.
- `ConfigOp` union (~line 1101) gains `{ k: 'setAllocationPolicy'; patch:
  Partial<AllocationPolicy> }`; the arm sits beside `setTimePolicy`, delegates validation
  to `allocationPolicyProblem`, audits `from`/`to` as the mode words, answers "Nothing
  changed." when already so.
- `lib/actionShape.ts`: `'setAllocationPolicy'` joins the `CONFIG_OPS` completeness list —
  the tsc error from the time-grace build (allOf satisfies) fires if forgotten, and the
  build must not stop there. `acceptOverallocation` STAYS in the `upsertAllocation` shape:
  advisory mode needs it, and narrowing the wire strands advisory clients.
- Scenario **AC1**: through the real ops, on `BASE`'s directory person Priya — overlapping
  60% + 60% over one window refused under hard even with `acceptOverallocation: true`, the
  refusal naming the Configuration screen; `setAllocationPolicy` → advisory and the same
  allocation commits with the override audited "Deliberately overallocated"; flipped back
  hard, refused again; `checkAllocation`'s single-allocation >100% refusal unchanged in
  both modes; an invalid `cap` value refused by the op. *Contingency named:* if
  `capacityFor`'s no-pattern fallback answers unknown rather than overallocated for Priya,
  seed her working pattern first through the real pattern-recording action the Capacity
  screen dispatches — the scenario must reach a genuine `overallocated: true`, not assume
  one.
*Verify:* `npm run validate:scenarios` → 89 scenarios, 0 FAIL parsed from JSON; AC1 PASS.

**3. The screens — `components/CapacityPanel.tsx`, `components/ConfigWorkspace.tsx`
(both CRLF; python).**
- `AllocateForm` (CapacityPanel:362) gains a `capMode: 'hard' | 'advisory'` prop, passed at
  the one call site (line ~319) from `state.model.allocationPolicy.cap`. The `refused`
  block (line ~452): under advisory, today's sentence and "Commit anyway"; under hard, the
  refusal sentence alone — "That is more time than they have, and this workspace enforces
  the cap. Lower the share, shorten the window, or free them up first." — form values kept
  so the person can adjust in place. The reducer refuses either way; the button's absence
  is the UI half of both-halves.
- ConfigWorkspace: `'allocationPolicy'` joins the `Tab` union (line ~68 — the union AND the
  `TABS` list, the two-place edit the time-grace build hit); TABS entry
  `{ id: 'allocationPolicy', label: 'Allocation', group: 'Operating model' }` after
  `timePolicy`; tab render `{tab === 'allocationPolicy' && <AllocationCap … />}`; the
  `AllocationCap` card component beside `TimeRecording` — two labelled choices dispatching
  `onConfig({ k: 'setAllocationPolicy', patch: { cap } })`, worded per the design (hard:
  "Nobody can be committed past their capacity, full stop." / advisory: "Over-capacity
  commitments warn, and can be accepted — each acceptance is recorded as a deliberate
  decision.").
*Verify:* `npx tsc --noEmit && npm run build` clean.

**4. Sweep, deploy, checklist section 25, push.**
`npm run validate:scenarios` (parsed), `npm run audit:persistence` (50 — no storage
change), `npm run audit:attribution`, `npm run audit:tenancy`. Clean-room release
(`git archive HEAD` → `npm ci` → `npx prisma generate` → `npx tsc --noEmit` →
`npm run build` → `python scripts/package-release.py .next/standalone release.zip --extra
.next/static=.next/static`) → `az webapp deploy` → health probe. Checklist section 25,
driven: the card reads hard on first load (the merged default); an over-capacity
allocation refused with no "Commit anyway" anywhere; advisory set on the card → the same
allocation two-steps through with the override audited; the test allocation released and
the card returned to hard; the pill at "Up to date" throughout. `git push origin master`.

## Details most likely to be got wrong

- **`mergeModel` must default `allocationPolicy` explicitly** — the spread leaves a stored
  model's missing key `undefined`, and the first `state.model.allocationPolicy.cap` read
  crashes production, not the seed.
- **The policy is read from stored state at apply time** — never from the action, and never
  captured at enqueue: a queued allocation drained after a mode flip is judged by the mode
  in force when it applies, which is the same rule every other policy here follows.
- **`acceptOverallocation` stays on the wire** — hard mode refuses it in the arm; deleting
  it from SHAPES would 400 every advisory client instead.
- **The advisory branch must not drift** — byte-for-byte today's two-step, audit reason
  included; U-series and capacity scenarios prove it stays.
- **The `Tab` union and the `TABS` list are two edits** — the time-grace build stopped on
  exactly this; budget for both before running tsc.
- **AC1 must reach a real `overallocated: true`** — seed the pattern if the fallback
  answers unknown; a scenario passing against an unknown-capacity no-op proves nothing.
- **FAIL gates parse JSON** — python, utf-8 stdout, never a string grep.

## Commits

Step 1 alone. Step 2 alone (the risky one). Step 3 alone. Step 4 with the checklist.

## What would send the design back

- **A numeric cap other than 100%** wanted (an 80% billable ceiling) — surfaces at the card
  wording (step 3); that is a different policy shape, not a boolean hardness.
- **Per-person or per-engagement exceptions** wanted — surfaces at AC1 review (step 2);
  reopens where the policy lives.
- **Advisory-by-default** wanted after all — surfaces at the deploy (step 4), when the
  first hard refusal lands; a one-line default flip, but a product decision, not a patch.
