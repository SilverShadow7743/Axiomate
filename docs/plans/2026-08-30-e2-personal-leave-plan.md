# E2 implementation plan — personal leave loop and approval notifications

Follows `2026-08-30-e2-personal-leave-design.md` (approved). Ordering principle: the reducer
minting is scenario-provable the moment it exists, so it lands complete and proven before either
UI surface is touched; the two surfaces follow; the one deploy and the live loop come last.

Standing gates per step, same as E0/E1: `npx tsc --noEmit` → `npm run validate:scenarios` →
`npm run build`. **No migration and no redaction change exist in this phase**, so the
persistence/tenancy/attribution audits are not in the loop (running them anyway is harmless and
they must not regress: 66/66, PASS, 3/3). `data/validation.json` rides the commit whose
scenarios change; timestamp-only diffs are reverted with `git checkout -- data/validation.json`.

Design constraints quoted, not paraphrased: mint "exactly when the arm's own computed status
lands 'Requested'"; "no notification body ever carries the private leave reason"; the decide
queue is "deliberately NOT allocation-filtered".

---

## Step 1 — the kind, and the grant-holder walk

**Files:** `lib/notifications.ts`, `lib/workspace.ts`.

- `NOTIFICATION_KINDS` gains `'approval'` (after `'mention'`). `modeFor`'s
  absent-anything → `'in-app'` default means no stored data changes meaning.
- A local helper in `lib/workspace.ts` — `grantHolders(state, grant, exclude: Set<string>)` —
  returning live-role holders of a grant, sorted by name, capped at 8, excluding the given
  directory ids: the same walk the intake-arrival mint does inline at ~line 1930
  (`state.model.access.grants` + `people.roleIds`, role live). The intake-arrival block itself
  is **not** refactored onto it — working code, out of scope.

**Verify:** `npx tsc --noEmit` exits 0. Behavior unchanged (nothing calls the helper yet):
`npm run validate:scenarios` still reports 174 scenarios, 0 FAIL.

## Step 2 — minting inside the four arms

**File:** `lib/workspace.ts` — the phase's real work, and the highest-regression-risk step
(named below). Every mint copies the assignment pattern at ~2459–2533 verbatim: `modeFor` gate
on kind `'approval'`, `seqAfter += 1`, `notif-${seqAfter}` ids, in-app record with
`delivery: 'delivered'`, a **second** email record via `deliveryFor('email')` when the mode is
`in-app+email`, and on `mute` an audit line instead (the "why didn't I get this" rule).
`ruleId` carries the finer name — `'leave-requested'`, `'leave-decided'`,
`'timesheet-submitted'`, `'timesheet-decided'` — while the preference is the one `'approval'`
kind; the Inbox routes on ruleId, the person configures on kind.

- **`upsertCommitment` (~5961).** Mint after every problem check, right before the return.
  Two mints, discriminated by the arm's own `status` const (the design's first send-back
  clause — the rule is never restated outside the arm):
  - `isLeave && status === 'Requested'` → **leave-requested** to
    `grantHolders(state, 'leave.approve', excluding the subject's directory id and the actor's)`.
    Body: person, dates, working days (`workingDaysBetween` with `holidaySetOf(state.model)`)
    — never the reason. Covers both a new request and a decided row re-opened by an edit.
  - `isLeave && status === 'Approved' && !selfWrite && (!existing || datesChanged)` →
    **leave-decided** to the subject (the approver-records-other flow: the subject learns their
    absence is on the calendar). A no-change edit of an approved row mints nothing.
  - `aboutId: id` (the commitment id). Non-Leave kinds mint nothing, ever.
- **`decideLeave` (~6057).** After the checks: **leave-decided** to the subject
  (`c.person`/`c.personId`), body "approved"/"returned" + dates + the decision note when
  returned (the note is not private; the reason is, and does not appear).
- **`submitTimesheet` (~4928).** **timesheet-submitted** to
  `grantHolders(state, 'time.approve', excluding the submitter)`. Body: person, `weekLabel`,
  `total.hours` — both already computed in the arm.
- **`decideTimesheet` (~4982).** **timesheet-decided** to the sheet's person, body
  approved/returned + week + the rejection reason (not private — include it).

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios` — 174 scenarios must still be
0 FAIL (existing scenarios exercise all four arms; any FAIL here is a regression this step
caused, not noise).

## Step 3 — scenarios E2A, E2B, E2C

**Files:** `scripts/scenario-validation.ts`, `data/validation.json`.

- **E2A — minting fan-out.** A self-request mints leave-requested to `leave.approve` holders
  and not to the subject; a muted holder gets no record while the others still do (and the
  audit line writes); flipping a holder to `in-app+email` yields exactly one extra pending
  email record; the approver-records-other flow mints leave-decided to the subject and **no**
  leave-requested; a non-Leave `upsertCommitment` mints nothing.
- **E2B — the loop closes.** `decideLeave` mints leave-decided to the subject carrying the
  return note; `submitTimesheet`/`decideTimesheet` mint symmetrically to holders/subject;
  editing an Approved row's dates re-mints leave-requested.
- **E2C — the reason never travels.** With a distinctive reason string on the request, assert
  no minted notification's subject or body contains it — any mode, any recipient, across
  request, decide, and re-open. This is the regression net for the design's firmest line.

Splice with the E1 pattern (write blocks to `$CLAUDE_JOB_DIR/tmp`, python-splice — Bash
heredocs ate escapes twice in E1).

**Verify:** `npm run validate:scenarios` → **177 scenarios, 0 FAIL**; then `npm run build`.
**Commit 1** = steps 1–3 + `data/validation.json`: reducer-complete and scenario-proven before
any UI exists.

## Step 4 — My calendar grows the leave loop

**Files:** `components/MyCalendarPanel.tsx`, `components/IssueWorkspace.tsx`
(`lib/myCalendar.ts` deliberately untouched — see details list).

- "Request leave" button beside "Add event" (~line 100). A `LeaveForm` modal modeled on the
  existing `EventForm`: start, end, hours/day defaulted from the person's stated pattern
  (`profileAt(Object.values(state.versions), state.model.resourceProfiles, meId, today)`, the
  DetailPanel forecast's own call; fall back 7.5), optional private reason with the design's
  honesty sentence ("dates are visible to the firm's planners because they move availability;
  the reason is private to you and leave approvers"), optional note. No person picker.
- Day-rail rows: `EntryRow`'s commitment branch, for **own Leave** entries, resolves the full
  row from `state.commitments[entry.id]` (panel already holds `state`) and shows status,
  the note on a Returned row, and Edit / Withdraw buttons. Editing an Approved row's dates
  warns in the modal that it re-opens the request.
- New props threaded at the `<MyCalendarPanel>` site (`IssueWorkspace.tsx` ~2158), mirroring
  E1's `onDecideLeave` threading: `onRequestLeave(input)` / `onUpdateLeave(id, input)`
  dispatching `upsertCommitment` with `person: actor.name`, `kind: 'Leave'`;
  `onWithdrawLeave(id)` dispatching `removeCommitment`.
- **Inbox routing** (same commit — the mints from commit 1 are already live in dev, and a
  click on one currently toasts "commit-241 is no longer in the workspace"): at **both**
  `onOpen` sites (~1920 toolbar bell, ~2143 docked view), before `revealIssue`, branch on the
  four approval ruleIds — `'leave-decided'` → the My calendar view; `'leave-requested'`,
  `'timesheet-submitted'`, `'timesheet-decided'` → the Timesheets view. No `revealIssue` call
  for these. `lib/db/notifyDrain.ts`'s `mailboxFor` already falls back to `enabled[0]` when
  `aboutId` is not an issue — verified, no change, do not "fix" it.
- `components/Inbox.tsx`: `PrefRows` is a **hand-maintained** list — add
  `{ kind: 'approval', label: 'When leave or a timesheet needs or gets a decision', show: true }`.
  Without this row the kind mints but nobody can configure it.

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios` (177, 0 FAIL — untouched);
`npm run build`. **Commit 2.**

## Step 5 — the Timesheets view's "Leave to decide" queue

**Files:** `components/TimesheetPanel.tsx`, `components/IssueWorkspace.tsx`.

- A section rendered when `can(state.model, actor, 'leave.approve').allowed`, listing every
  live commitment with `kind === 'Leave' && status === 'Requested'` from `state.commitments`
  **firm-wide** — not `CapacityPanel`'s `commitmentsHere` allocation filter, whose reuse would
  recreate the exact undecidable-requests hole this phase exists to close — excluding the
  viewer's own rows (by directory id, name fallback). Columns: person, dates, working days
  (`workingDaysBetween` + `holidaySetOf`), hours/day, reason (grant-holders receive it — the
  server already decided that), note.
- Approve / Return per row; Return collects an optional note. New prop
  `onDecideLeave(id, decision, note?)` threaded at the `<TimesheetPanel>` site (~2110)
  dispatching `decideLeave` **with the note** (the CapacityPanel prop from E1 omits it and
  stays as-is).

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios`; `npm run build`. **Commit 3.**

## Step 6 — one deploy, then the loop live

One clean-room deploy after commit 3 (the E1 recipe verbatim: `git archive HEAD` → scratch dir
under `$CLAUDE_JOB_DIR/tmp` → `cp .env` → `npm ci` → `npx prisma generate` → `npm run build` →
`package-release.py` → `npx prisma migrate status` (expect "up to date" — no new migration) →
`az webapp deploy`). Then in Chrome against production:

1. My calendar → Request leave (with a distinctive reason) → lands **Requested**, chip renders,
   rail row shows status with Edit/Withdraw.
2. The request notification reached the other `leave.approve` holders' inboxes — spot-check via
   a tmp read script if no second sign-in is at hand.
3. Seed one Requested row for a test directory person via `persistActions` with that person as
   actor (the E1 proof-priya pattern — a self-write is the only way to a Requested row for
   somebody else). It appears in the Timesheets view's queue with its reason; **Return it with
   a note** in the browser; the subject's leave-decided notification exists and its body carries
   the note and **not the reason** (read the row, not the UI).
4. Prefs: set own `approval` to `also email me`; have a script actor holding `leave.approve`
   decide a fresh own-request; confirm the email record queues, and after the scheduled pass
   runs, its delivery stamp says sent (or trigger the daily pass once).
5. A notification click routes to the right view — both from the bell and the docked inbox.
6. **Clean up through the app's own actions**: withdraw every test leave row
   (`removeCommitment`), reset the pref if changed. This is production.

---

## The step carrying the most regression risk

**Step 2, the `upsertCommitment` mint.** Every commitment write in the product — Leave,
Internal, Training, all of them, from the Capacity panel used daily — flows through this arm. A
wrong discriminator mints noise on every non-Leave write or double-mints request+decided on one
write; and the arm's seq bookkeeping is a trap all its own: it computes
`const seq = existing ? state.seq : state.seq + 1` for the row id **before** any notification
exists, so the mint's counter must start at `let seqAfter = seq` (NOT `state.seq`) and the
returned state must carry the final `seqAfter` (NOT `seq`) — either mistake silently reuses an
id and a later write overwrites an unrelated notification record. The breakage lands in the
hands of whoever records any absence — the most routine capacity write there is.

## Details most likely to be got wrong

1. **`seqAfter` starts from the arm's `seq`, and the returned state's `seq` is the final
   `seqAfter`** — see above; the assignment mint reads `state.seq` because *its* arm minted no
   row id first, and copying that line verbatim into this arm is the bug.
2. Mint **after** every early-return problem check, in all four arms.
3. The two upsert discriminators: request iff `isLeave && status === 'Requested'`; decided iff
   `isLeave && status === 'Approved' && !selfWrite && (!existing || datesChanged)`. A no-change
   edit keeps the decision and mints nothing. Never restate the who-writes rule — read the
   `status` const.
4. Recipient exclusion is by directory id **and** trimmed-lowercase name fallback, and excludes
   the actor: a `leave.approve` holder requesting their own leave must not be notified of it.
5. The email record is a second notification with its own incremented id and
   `deliveryFor('email')` — not a channel flag on the first.
6. The leave **reason** never appears in any subject or body (E2C is the net). The decideLeave
   return **note** and decideTimesheet rejection **reason** are not private — include them.
7. `modeFor` is consulted on kind `'approval'` for all four mints; `ruleId` carries the finer
   rule name; Inbox routing branches on ruleId, preferences on kind. Do not invent four kinds.
8. `Inbox.tsx`'s `PrefRows` list is hand-maintained — the `'approval'` row must be added or the
   kind is configurable by nobody.
9. There are **two** Inbox `onOpen` sites in `IssueWorkspace.tsx` (bell ~1920, docked ~2143);
   the routing branch goes in both, before `revealIssue` — whose miss-toast ("no longer in the
   workspace") is the wrong message for a commitment id.
10. The decide queue reads `state.commitments` firm-wide; `commitmentsHere` must not be copied.
11. `mute` still writes the audit line, per the assignment mint's own pattern.
12. `notifyDrain.mailboxFor` needs no change for non-issue `aboutId` — its `enabled[0]`
    fallback is the design's intended degradation; leave it alone.
13. `lib/myCalendar.ts` stays untouched: the rail resolves status/note from
    `state.commitments[entry.id]` rather than widening `MyCalendarEntry` — the entry's id is
    already the commitment id.
14. The scenario splice uses temp files + python, not Bash heredocs (E1 burned twice).

## Commit boundaries

- **Commit 1** — steps 1–3: kind, helper, four mints, scenarios E2A–E2C, `data/validation.json`.
  Meaningless in halves: a mint without its scenarios is unproven; scenarios without the mints
  fail the gate.
- **Commit 2** — step 4: My calendar loop + Inbox routing + prefs row.
- **Commit 3** — step 5: the decide queue.
- One clean-room deploy after commit 3; live verification covers both surfaces and the
  notification loop end to end, including one drain-stamped real email.

## What would send the design back

- The upsert discriminator cannot tell a request from the approver-records-other flow without
  restating the who-writes rule outside the arm — the mint is in the wrong place and the
  design's "the arm's status is the discriminator" premise failed. Surfaces in step 2.
- Graceful `aboutId` degradation turns into a routing rewrite — the branch on ruleId at two
  sites doesn't cover the click-throughs, or the drain needs to resolve commitment/timesheet
  ids after all. Stop and redesign the aboutId contract; do not patch. Surfaces in step 4.
- The firm-wide queue is unusably slow or crowded at real volumes — the "one approvals surface"
  decision was wrong and the separate Approvals-view option returns. Surfaces in step 6, live.
- A fourth, discovered in planning: if scenario E2A cannot distinguish "muted holder silent
  while others mint" because the fan-out shares one mode lookup, the per-recipient preference
  premise (each holder's own choice, as intake-arrival does it) was violated in the helper's
  design — fix is a redesign of the mint loop, not a scenario workaround. Surfaces in step 3.
