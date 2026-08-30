# E2 — Personal leave loop and approval notifications

**Status: approved 2026-08-30** (four explicit decisions, recorded below).
Phase E2 of the platform evolution (`2026-08-29-work-platform-evolution-design.md`): "Personal
workspace completion — leave requests and approval in My-surfaces; email notifications."
E0 and E1 are complete and live.

## The gap, precisely

E1 built the leave *rules* — request lands Requested on any self-write, `leave.approve` decides,
never your own, reasons private, pending never subtracts from availability — and proved them in
scenarios and in production. What E1 did not build is anywhere for a person to *stand*:

- The only place leave can be recorded is a **project's Capacity panel**, whose table filters to
  people allocated to that project. E1's own live verification proved the consequence: an
  unallocated person's requests are invisible there, and therefore **undecidable through any
  screen**. The reducer is ready; the doors are missing.
- **My calendar** shows leave (with E1's "Leave (requested)" pending marker) but is read-only
  for it — its header comment says "this screen gathers them, it does not manage them", which
  was true until leave became personal.
- The notification machinery is nearly complete — kinds, per-person prefs
  (mute / in-app / in-app+email), the Graph email transport, and the scheduled pass's drain that
  stamps real outcomes — but **no approval loop mints anything**. Leave requested, leave
  decided, timesheet submitted, timesheet decided: all silent. People find out by looking.

## Decisions (settled with the user, 2026-08-30)

1. **Leave requests live on My calendar** — not a new "My leave" view, not the Timesheets view.
   Leave is calendar-shaped; the pending chip already renders there; no eleventh nav tab.
2. **Approvers decide in the Timesheets view**, which grows a "Leave to decide" queue beside the
   timesheet queue and becomes the firm's approvals surface. Not inbox action buttons (the inbox
   stays a record of what happened, not an action surface), not a new Approvals view.
3. **One `'approval'` notification kind covers both loops** — leave and timesheets — as a single
   preference row. Not a leave-only kind, not two kinds.
4. **Approach: thin completion.** Reuse the existing arms (`upsertCommitment`,
   `removeCommitment`, `decideLeave`, `submitTimesheet`, `decideTimesheet`) and the existing
   notification machinery; mint inside the arms following the assignment/mention pattern.
   No new entities, no new action kinds for requesting, **no schema change, no migration**.
   The rejected alternatives: a generalized Approval entity (a refactor nothing here needs —
   `lib/approval.ts` is deliberately scoped to issue-status gates) and deciding from the inbox
   (declined in decision 2).

## Design

### 1. My calendar grows the leave loop

`components/MyCalendarPanel.tsx`, `lib/myCalendar.ts`.

- A **"Request leave"** button beside "Add event" opens a modal: start date, end date, hours per
  day (defaulted from the person's working pattern, falling back to 7.5), an optional **private
  reason**, an optional note. Submitting dispatches the existing
  `upsertCommitment { kind: 'Leave' }` — E1's arm computes **Requested** on any self-write, so
  no new action kind exists for a request. The person the row is for is the signed-in actor;
  the modal has no person picker.
- The day rail's own-leave rows become **actionable**: Edit (dates/hours — E1's rule re-opens a
  decided row, and the modal says so when editing an Approved one) and Withdraw
  (`removeCommitment`). Each row shows its status; a Returned row shows the decider's note.
- Honesty amendment: the panel's "Private to you" subtitle stays (it is true of events), and the
  request modal states the leave split explicitly — *dates are visible to the firm's planners
  because they move availability; the reason is private to you and leave approvers.*
- The Capacity panel keeps its existing leave entry — it is the approver-records-somebody-else's
  flow (lands Approved in one step, E1's rule) and the team view of a project's absences.

### 2. The Timesheets view grows "Leave to decide"

`components/TimesheetPanel.tsx` — already the precedent: "It GATHERS and it decides; it never
edits."

- A section visible to `leave.approve` holders listing every **Requested** leave commitment
  firm-wide — deliberately NOT allocation-filtered; that filter is exactly what made requests
  undecidable. Each row: person, dates, working days (holiday-aware, via the availability
  engine's date math), hours/day, the **reason** (the server already delivers it to
  grant-holders — presence is permission, the E1 rule), and the note.
- Approve / Return buttons per row dispatch the existing `decideLeave`. A Return asks for an
  optional note. The viewer's **own requests are excluded** from the queue — they live on My
  calendar, and the arm refuses them anyway; a queue that lists rows it will refuse is noise.
- No batch decide. Leave queues are small; `onDecideMany` stays a timesheet affordance.

### 3. One `'approval'` notification kind

`lib/notifications.ts` (`NOTIFICATION_KINDS` gains `'approval'`) and four reducer arms in
`lib/workspace.ts`. Every mint respects `modeFor` per recipient — mute mints nothing (audit
still writes), in-app mints one delivered record, in-app+email adds the pending email record the
scheduled pass drains and stamps. This is the exact assignment/mention pattern; the prefs row,
the prefs editor, the email transport and the drain need no new machinery.

| Event | Recipients | Body says |
|---|---|---|
| Leave requested (or a decided row re-opened by an edit) | `leave.approve` holders, sorted, capped at 8, subject excluded | person, dates, working days |
| Leave decided | the subject | approved/returned, dates, the decider's note on a return |
| Timesheet submitted | `time.approve` holders, capped at 8, submitter excluded | person, week, hours |
| Timesheet decided | the subject | approved/returned, week, the rejection reason |

**No notification body ever carries the private leave reason.** Email lands in mailboxes outside
the app's redaction; the body states dates only. This is the design's firmest line.

### 4. What does not change

No Prisma change, no migration, no new audits: notifications and prefs already persist; leave
columns shipped in E1. `redactLeaveReasons`, the availability engine, the forecast, and the
Capacity screens are untouched. Boot payload shape is unchanged (notifications already ride it).

## Error handling

All refusals already exist in the arms (never-your-own, settled rows, unknown wire keys); the
new surfaces route them to the user verbatim, the same as every other dispatch. A request
overlapping an existing one is not refused — the engine already counts overlapping approved
rows once each, and policing overlap is HRIS territory (out of scope per the parent design).

## Testing

Scenario suite first (the standing pre-browser gate), then live:

- **E2A — minting fan-out**: a self-request mints to `leave.approve` holders and not the
  subject; a muted holder gets nothing while others still do; `in-app+email` adds exactly one
  pending email record; the approver-records-other flow (lands Approved) mints the *decided*
  notification to the subject, not the request one.
- **E2B — the loop closes**: decideLeave mints to the subject with the note; submit/decide
  timesheet mint symmetrically; re-opening an approved row by editing dates mints the request
  notification again.
- **E2C — the reason never travels**: no minted subject/body string contains the reason, in any
  mode, for any recipient.
- Queue derivation (requested-only, own-excluded) driven pure if extracted, else covered in E2A.
- Live: request from My calendar as an unallocated person → appears in another sign-in's
  Timesheets queue → return it with a note → subject's inbox and calendar show the outcome →
  withdraw the row; prefs flip to email → drain stamps a real send. Clean up through the app's
  own actions (production).

## What would send this design back

- If minting inside `upsertCommitment` cannot tell a leave request from the approver-records-
  other flow cleanly (the arm's own computed status is the discriminator — if that needs
  restating outside the arm, the mint is in the wrong place).
- If the inbox's "take you there" click or the drain's `mailboxFor` cannot degrade gracefully
  when `aboutId` names a commitment or timesheet rather than an issue — both currently assume
  issues; if graceful degradation turns into a routing rewrite, stop and redesign the aboutId
  contract instead of patching it.
- If the firm-wide decide queue makes the Timesheets view unusably slow or crowded at real data
  volumes — the "one approvals surface" decision was wrong and the Approvals-view option
  returns.
