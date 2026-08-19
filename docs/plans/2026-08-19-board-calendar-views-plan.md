# Board and Calendar views — implementation plan

Follows `docs/plans/2026-08-19-board-calendar-views-design.md` (approved 19 Aug 2026). Ordering
principle: pure lane/placement logic first so the scenario harness can prove the rules before a
single component exists; the drop handler — the one step that puts a refusal in front of a
gesture — lands only after its logic is already proven; browser and deployment last.

The design's two governing constraints, quoted: *"a drag is the same lever as the grid's status
editor"* and *"a calendar that quietly renders half the register would be the clipped-summary
fault in a new costume."*

## Steps

**1. Pure view models — `lib/board.ts` and `lib/calendar.ts` (new).**
`boardLanes(state, filters)` groups filtered issues into lanes ordered as `ISSUE_STATUSES`
(lib/types.ts) with counts; `dropOutcome(policy, issue, toStatus)` wraps
`checkTransition`/`allowedNext` from `lib/statusPolicy.ts` and returns one of
`{ ok } | { needs: 'reason'|'evidence' } | { refused: message }` — the message taken verbatim
from the policy result, never composed here. `calendarMonth(state, filters, monthIso)` returns
placed spans plus the unscheduled list and both counts; `scheduled + unscheduled` must equal the
filtered total by construction.
*Verify:* `npx tsc --noEmit` clean.

**2. Scenario coverage before any UI — `scripts/scenario-validation.ts`.**
Two scenarios from the design: (a) `dropOutcome` on an illegal move returns the policy's own
message, and on `Closed - no defect` returns `needs: 'reason'` (per `requireReason`,
lib/statusPolicy.ts:95); (b) `calendarMonth` counts reconcile with the register under an active
filter. Also assert the board never invents a lane: every lane key ∈ `ISSUE_STATUSES`.
*Verify:* `npm run validate:scenarios` — count rises by 2, nothing previously passing regresses.

**3. `components/BoardView.tsx` (new) — render only.**
Lanes from step 1, cards opening the existing detail panel via the same `onSelect` the grid
uses. No drag yet. Persist the view choice with the columns-preference pattern
(components/IssueWorkspace.tsx:1419 — "opening a tab never persists a preference the user did
not choose").
*Verify:* `npx tsc --noEmit`; `npm run build`.

**4. The drop handler — `components/BoardView.tsx` + wiring in `IssueWorkspace.tsx`.**
**The step carrying the most regression risk, and it is not close.** It puts `checkTransition`
in front of a gesture on a screen where every prior interaction succeeded. Three outcomes, all
through `dropOutcome`: ok → dispatch the ordinary `updateIssue` (the same callback TreeGrid
uses — found at the `<TreeGrid` mount, IssueWorkspace.tsx:1820); `needs` → open the
IssueFocus-style closure dialog with reason/evidence enforcement, dispatch only on submit;
refused → snap back and render the message at the lane header. If this is wrong, a consultant
closes work by drag with less ceremony than the form demands — the exact bypass the design
forbids — or legal moves silently fail, which reads as "the board is broken."
*Verify:* `npm run validate:scenarios` (step 2's scenarios now describe live code paths);
manual: drag Open→Awaiting directly must refuse — the graph forbids it (found by PF1 failing
twice in the fixtures).

**5. `components/CalendarView.tsx` (new) + view switcher in `IssueWorkspace.tsx`.**
Month grid from `calendarMonth`, the Unscheduled rail with its count, header sentence stating
the split. `Tree | Board | Calendar` toggle; Day/Week/Month/Quarter zoom controls render only
with the Gantt. No mutations on this view (v1, per design).
*Verify:* `npm run build`; then the count sentence against the toolbar's own `124 unscheduled`.

**6. Checklist, verification sweep, deploy.**
`docs/verification-checklist.md` gains sections 15 (Board) and 16 (Calendar). Full sweep:
`npx tsc --noEmit && npm run validate:scenarios && npm run audit:tenancy &&
npm run audit:attribution && npm run audit:persistence && npm run build`, then the release
pipeline (`git archive` → package → `az webapp deploy`), then both sections clicked in
production and recorded in "What has actually been opened in a browser."

## Details most likely to be got wrong

- The refusal message comes from `checkTransition`'s result, which "notes which requirement
  failed so a caller can ask for the missing thing" (lib/statusPolicy.ts:101) — do not compose a
  new message in the component.
- `allowedNext(policy, from)` takes `IssueStatus | null` — a brand-new issue has null status;
  the board must place it without crashing.
- The closure dialog must read `requireEvidence` against the issue's *existing* evidence items,
  exactly as `IssueFocus` does — an empty evidence list refuses `Closed - confirmed` even with a
  reason typed.
- `Unscheduled` is "a first-class state, not a failure" (lib/types.ts comment) — the rail is not
  an error style.
- Filters are props already computed in `IssueWorkspace`; do not re-derive them per view or the
  counts diverge between the toolbar and the calendar sentence.
- Line endings: `file` every touched file before committing — Python/sed writes flip LF silently.

## Commits

Steps 1–2 together (logic + its proof are meaningless apart). Step 3 alone. Step 4 alone — it is
the risky one and wants a clean revert line. Steps 5–6 together with the checklist edit.

## What would send the design back

- A second mutation path proves necessary — if the drop cannot reuse `updateIssue` unchanged
  (surfaces in step 4), the "same lever" premise fails and the design reopens.
- Lane count from configuration is unusable — if a tenant's status set makes more lanes than a
  screen can hold (surfaces in step 3 with real data), the board needs a grouping concept the
  design does not have.
- The calendar's reconciliation cannot be made exact under some filter combination (surfaces in
  step 2) — that would mean filtered state is not the single source the design assumes.
