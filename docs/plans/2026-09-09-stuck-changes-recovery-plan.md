# Stuck-changes recovery — implementation plan

Follows `docs/plans/2026-09-09-stuck-changes-recovery-design.md` (approved). This plan orders
the work so the riskiest piece — touching `useAutosave.ts`, the code that decides whether a
change is safe to hold — is built and verified in isolation, with zero user-visible surface,
before any UI is layered on top of it.

## Ordering principle

Storage-and-plumbing first, silently active and checkable on its own; the review UI that makes
it visible comes after, once the data it reads is already known to be correct. Nothing in this
plan needs a browser to verify until the very end — the one piece of new *logic* (stripping a
stale `expected` for reapply) is separable from `localStorage` and gets exercised without one;
everything storage-shaped does not have that option (see step 5) and says so rather than
claiming coverage it would not have.

## Steps

**1. `lib/pendingActions.ts` (new file).**

Mirrors `lib/autosave.ts`'s existing local-mirror conventions exactly, not a new pattern:
tenant-namespaced key (`axiomate.pending-actions.v1:${tenantId}`), JSON-serialised, every
function returns a result rather than throwing (`saveWorkspaceLocally`'s
`{ok, error?}` shape), `typeof window === 'undefined'` guarded like every function in that file.

Stores `SubmittedAction[]` (`lib/idempotency.ts`'s existing type — `Action & {key?: string}`) —
not a new shape. The `key` `mintKey()` already stamps at enqueue time (`components/useAutosave.ts:44-48,373`)
is the same id used here, so nothing new is minted and nothing can drift out of sync with the
in-memory queue's own identity scheme.

Exports:
- `savePendingAction(tenantId, action: SubmittedAction): void` — appends, keyed by `action.key`.
  A missing/falsy key is a caller bug (every action reaching this point was just stamped one) —
  skip silently rather than throw, matching `split()`'s own "absent means not eligible" stance
  (`lib/idempotency.ts:107-108`) instead of inventing a new failure mode.
- `clearPendingAction(tenantId, key: string): void` — removes one entry by key.
- `loadPendingActions(tenantId): SubmittedAction[]` — returns everything currently held,
  `[]` on a missing, unreadable, or malformed value (same shape-check-then-clear posture
  `loadWorkspaceLocally` already takes, `lib/autosave.ts:141-160`).

**Verify:** `npx tsc --noEmit` — no test harness reaches this file yet (see step 5), so a clean
type-check is what step 1 alone can promise, and step 2 is what actually exercises it.

**2. Wire `components/useAutosave.ts` at its three queue-mutation points.**

This is the step carrying the most regression risk in this plan, and it is named as such: it
edits the one file this codebase's own comments call the exact fix for a prior incident
("There was one `halted` flag, set in four places and cleared in none" — `useAutosave.ts:31-33`)
and that a bug here breaks silently, exactly as this incident did. If `savePendingAction` or
`clearPendingAction` ever threw, or were called at the wrong point, the failure would not throw
a visible error — it would either under-report (an entry cleared too early looks safe when it
is not) or over-report (an entry kept too long shows a false "stuck" item on every future boot).
Both are worse than not building this at all, because they would misinform exactly the person
trying to recover from a real loss.

Changes:
- Signature: `useAutosave(enabled: boolean, tenantId: string): Autosave`. One call site to
  update: `components/IssueWorkspace.tsx:310`, `useAutosave(persistence.enabled)` →
  `useAutosave(persistence.enabled, tenantId)` (`tenantId` is already an in-scope prop there,
  `IssueWorkspace.tsx:177`).
- In `enqueueAll` (`useAutosave.ts:373`, right after
  `queue.current.push(...actions.map((action) => ({ ...action, key: mintKey() })))`): call
  `savePendingAction(tenantId, action)` for each newly-keyed action pushed.
- In the success branch (`useAutosave.ts:205-206`, right after
  `queue.current = withoutKeys(queue.current, batch)` under `if (data.ok)`): call
  `clearPendingAction(tenantId, key)` for every key in `batch`.
- In the partial-commit branch (`useAutosave.ts:246-251`, right after the `committedKeys`
  `withoutKeys` call): call `clearPendingAction(tenantId, key)` for every key in
  `data.committedKeys` — **easy to miss, and worth stating why it is needed**: a refused batch
  can still have committed some actions before the rejection (`lib/db/persist.ts`'s sequential
  fold breaks on the first failure, but everything before it in the same batch already landed).
  Skipping this branch would leave already-safe, already-in-Postgres actions sitting in the
  pending log forever, showing as falsely "stuck" on every future boot.

**Verify:** `npx tsc --noEmit`, `npm run build`, then `npx tsx scripts/scenario-validation.ts`
— expect the scenario count and pass/fail breakdown unchanged from the pre-change baseline
(this step changes no reducer, no server route, and no action semantics; it only adds a
side-channel write next to three existing state mutations). A live pass against production
confirming ordinary saves still work exactly as before (edit a field, confirm the `.persist-tag`
still reads "Saved", confirm no regression in the toast fix already shipped) is worth doing
before step 3, precisely because this step's whole risk is silent, not thrown.

**3. Reapply logic as its own function, separated from any UI.**

`lib/reapplyPendingAction.ts` (new, small) or a plain function inside the component from step 4
if it turns out too small to warrant its own file — decide at write time based on size, but
write the *logic* before the button that calls it:

```
function reapplyable(a: SubmittedAction): Action {
  const { key, expected, ...rest } = a
  return rest as Action
}
```

Grounded in `components/IssueWorkspace.tsx:374-386`'s `withExpectation`: it only re-stamps
`expected` when `action.expected` is falsy (`if (action.t !== 'updateIssue' || action.expected)
return action` — line 376). A stored action that still carries its *original* `expected` would
silently skip re-stamping and `dispatch` would resend the exact stale comparison that failed
before, conflicting identically again even though the underlying data may now be perfectly
fine to write. Stripping `expected` before `dispatch` is the entire mechanism that makes
"Reapply" mean "check against what is true now," not "resend what failed before" — the one
detail in this whole plan most likely to be got wrong, because skipping it produces something
that *looks* like it works (the button does something, a request goes out) right up until the
first genuine reapply-of-a-real-conflict, which would then falsely succeed by overwriting
someone else's still-current change.

**Verify:** a scenario in `scripts/scenario-validation.ts` — construct a `SubmittedAction` with
a stale `expected`, run it through `reapplyable`, confirm the result has no `expected` key;
separately, confirm `withExpectation` (already existing, called from `dispatch`) re-stamps a
fresh one from a given `WorkspaceState` when handed an action with none. This is the one part
of the whole feature that is pure logic and does not need a browser — command:
`npx tsx scripts/scenario-validation.ts`, a new scenario id, PASS expected.

**4. The recovery view component + wiring into `IssueWorkspace.tsx`.**

New component (name TBD — `StuckChangesPanel` or similar), rendered from `IssueWorkspace.tsx`
alongside the existing toast stack (`:3076-3079`) and modals. Two triggers, both reading
`loadPendingActions(tenantId)` fresh rather than threading state through `useAutosave`'s public
API (which stays untouched — `Autosave`'s `{state, enqueue, enqueueAll}` shape does not change):

- **Boot check**, modeled directly on the existing local-mirror notice
  (`IssueWorkspace.tsx:665-687`, same `if (!persistence.enabled) return` guard, same
  "once, not every mount" shape): if `loadPendingActions(tenantId)` returns anything on mount,
  open the panel.
- **Live halt**, reusing the transition-detection ref already shipped for the toast fix
  (`wasSaveError`, `IssueWorkspace.tsx`, commit `9e03d34`) — same `saveStatus.status === 'error'`
  transition, additionally opens the panel (does not replace the toast; both fire).

Per item: the same plain-language shape `History` already renders from an `AuditEntry`
(`rowId`/`field`/`from`/`to` — `lib/types.ts:176-182`, rendered in `components/DetailPanel.tsx`)
— reusing the *rendering convention*, since a `SubmittedAction` is not an `AuditEntry` and there
is no existing formatter to import; write a small `describeAction(action)` for the handful of
action shapes that can actually reach this state (in practice: `updateIssue` and whatever else
routes through `onCommitCell`) rather than every `Action` variant this app has. **Reapply**
calls `dispatch(reapplyable(action))` (step 3) then `clearPendingAction` on success — but note
`dispatch` (`IssueWorkspace.tsx:389-406`) already calls `persist(stamped)` internally, which
re-enters `enqueueAll`, which (per step 2) re-adds the action to the pending log with a *new*
key — so the explicit clear after a successful reapply is for the *old* key, not the new one;
the new one clears itself normally when the server confirms it, same as any other edit. **Discard**
calls `clearPendingAction(tenantId, key)` directly, no dispatch.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/IssueWorkspace.tsx
<new component file>`, then live verification (step 6) — this step has no scenario-level
verification of its own; it is UI wiring over logic already verified in steps 2 and 3.

**5. What does *not* get scenario coverage, stated plainly rather than skipped over.**

`savePendingAction`/`clearPendingAction`/`loadPendingActions` themselves (step 1), and the two
`IssueWorkspace.tsx` triggers (step 4), are all `window`/`localStorage`-shaped —
`scripts/scenario-validation.ts` runs in Node, which has none, and this codebase's existing
precedent for this exact category of code (`lib/autosave.ts`'s local mirror) has never had
scenario coverage either. Not a gap introduced by this plan — a limit this plan inherits and
states rather than silently accepting a false sense of coverage from the scenarios steps 2-3 do
have.

**6. Live verification against production.**

Last, because it is the one step no harness can check and the one whose failures are slowest to
diagnose — matching this plan's ordering principle exactly. Sequence:
1. Trigger a genuine halt the same way this session already did once (two rapid edits in one
   tab, or a real concurrent edit on a shared record).
2. Confirm the panel opens live, without a reload, listing the correct stuck item(s) in plain
   language.
3. Reload. Confirm the panel reopens on boot with the same item(s) still present.
4. Click Reapply on one item. Confirm it saves for real (`.persist-tag` reads "Saved", a fresh
   reload shows the change survived) and the old entry is gone from the panel.
5. Click Discard on another. Confirm it disappears with no network request fired (check via
   the browser's network panel, the same method used to confirm the original bug) and no
   change appears anywhere.

**Run against production, 9–10 September 2026 — what actually happened.** Two tabs open on
SLG-001; tab B set Severity to Medium and it confirmed; tab A, still holding the stale "High"
read, changed Severity twice more (to Medium, then to Low), producing a real 409 on the first of
the two and halting the queue with both stuck. Every step above passed as written, with one
addition the plan did not anticipate:

- Steps 1–3 passed exactly as described — panel opened live with both items in plain language
  ("SLG-001 — severity: High → Medium", "SLG-001 — severity: Medium → Low"), survived a real
  reload (forced through the `beforeunload` warning, which fired correctly and is itself a
  passing check — see the design doc's "Resolved during implementation" section) with the same
  two items.
- Step 4 (Reapply) surfaced a real bug before advisor review flagged the two issues fixed before
  first deploy (see below) even ran a second time: `clearHalted` was being called wherever a
  queue happened to empty, including `useAutosave.ts`'s in-memory ref — which starts fresh on
  every mount. Reapplying one of the two stuck items queued and drained successfully in the
  *new*, post-reload session, whose ref queue naturally started and ended empty; that cleared
  the tenant's halted marker even though the second item was still sitting unresolved in the
  persisted log. The next reload's boot check then read `wasHalted()` as false and silently
  discarded that still-open entry as a stray — exactly the "what would send this back to the
  design" false-positive risk below, arrived at from the opposite direction (a false *negative*
  that suppressed a real stuck item, not a false positive that showed a fake one). Fixed by
  moving the clear into `clearPendingAction` itself — the one place every removal path already
  funnels through, and the only one that actually knows when the persisted log is empty. Full
  sequence re-run afterward end to end, including a second live confirmation that Reapply saves
  for real and survives a reload.
- Step 5 (Discard) passed as written on the re-run: zero network requests fired
  (`read_network_requests` showed none), the entry disappeared, and the persisted log plus the
  halted marker both cleared the instant the log actually emptied.
- Additional check beyond the plan's five steps, added live once the halt-marker gate existed:
  simulated the ordinary enqueue-to-confirm gap directly (wrote a `pendingActions` entry with no
  halted marker set) and confirmed the panel does *not* open and the stray entry is cleared
  silently on boot — the false-positive case the "what would send this back to the design"
  section below worried about, now closed by the gate rather than by a server-state check.
- All test data (SLG-001's Severity) restored to its original value, "High", after each round.

## Commits

**Commit 1 — steps 1, 2, 3 and their scenario.** The storage layer and the reapply logic,
silently active, zero UI change, verifiable by `tsc`/`build`/scenarios alone. Ships the riskiest
part in isolation, with nothing yet depending on it being right.

**Commit 2 — step 4.** The recovery view and its wiring — the actual user-facing deliverable,
built once the data it reads is already known correct.

Step 5 is documentation, folded into whichever commit's message it is closest to (commit 1,
since that is where the untested surface actually lives). Step 6 is verification, not a commit.

## What would send this back to the design

- **If reapplying a stripped-`expected` action does *not* get a fresh `expected` from
  `withExpectation`** — e.g. if some other layer between `dispatch` and `persist` re-populates
  it, or if `withExpectation`'s `updateIssue`-only scope means some other action type this
  design assumed was safe to blindly redispatch actually needs its own staleness check. Surfaces
  at step 3's scenario, cheaply, before any UI exists.
- ~~**If the boot-time "found leftovers" check produces false positives**~~ — **resolved before
  ship, not by a server-state check.** The race is real (confirmed by reasoning about
  `savePendingAction`/`clearPendingAction`'s enqueue-to-confirm gap, not by reproducing an actual
  beacon race live — that would need a genuinely flaky network, which was not manufactured here)
  but did not need querying the server to close: the boot check is now gated on a second marker
  (`markHalted`/`wasHalted`, `lib/pendingActions.ts`) stamped only on a genuine
  `Halt: 'stopped'`, never on an entry merely existing. An entry with no recorded halt is treated
  as a stray and cleared silently rather than shown. Live-verified directly (see step 6's log):
  a manufactured leftover entry with no halted marker did not open the panel and was cleared on
  boot. See the design doc's "Data flow" section for the full mechanism, including a related bug
  this same area produced and fixed live (`clearHalted` originally cleared on the wrong signal).
- **If the panel itself becomes a second thing users learn to ignore** (the same failure mode
  the toast fix already exists to correct once) — not verifiable in this pass, but worth
  Nishant's judgment after it has been live for real conflicts, not manufactured ones. One
  concrete version of this already surfaced during live verification, not the full pattern but
  worth flagging early: discarding every stuck entry clears the log but leaves the live session's
  save-status indicator reporting `'error'` until reload (the underlying halt only ever clears on
  reload, by policy). See the design doc's "Resolved during implementation" section for the full
  note — recorded as a known limitation, not fixed in this pass.
