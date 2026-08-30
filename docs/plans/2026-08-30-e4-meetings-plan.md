# E4 implementation plan — Meetings

Follows `2026-08-30-e4-meetings-design.md` (approved). Ordering principle: the engine's new
term is pure and golden-checkable before any Meeting row can exist, so it lands first with the
absent-param golden captured BEFORE the threading; storage stands alone; the arms land with
their persist cases and proof checks in one commit (the recorded trap); UI and the deploy
come last.

Standing gates per step: `npx tsc --noEmit` → `npm run validate:scenarios` (180 now; **183**
after step 2) → `npm run build`. After schema/mapper/arm steps: `npm run audit:tenancy`
(32 → **33** mappers), `npm run audit:persistence` (68 → grows by the meeting checks),
`npm run audit:attribution` (3/3), `npm run audit:discussion` (11, untouched). The migration
commit stands alone; `npx prisma migrate deploy` may hit the classifier once — retry once.
Deploy is the staged FOREGROUND recipe. `data/validation.json` rides scenario commits;
scenario splices go through a temp file + python.

Design constraints quoted: "Absent means zero — today's arithmetic byte-identical";
"conflicts warn, never refuse"; "organizer is NOT implicitly an attendee unless in the list"
(the form defaults them in); "aboutId is a free reference" — meeting notifications set
`aboutId` to the MEETING id and route purely on ruleId (`meeting-invite`, `meeting-changed`,
`meeting-cancelled`, all under pref kind `'meeting'`) to My calendar at BOTH
`IssueWorkspace.tsx` onOpen sites.

---

## Step 1 — the engine's fourth term and the Meeting type, golden first

**Files:** `lib/meetings.ts` (new), `lib/availability.ts`, `lib/capacity.ts`,
`lib/forecast.ts`, `lib/assignment.ts`, `scripts/scenario-validation.ts`.

1a. **Capture the golden BEFORE touching signatures**: run `availabilityFor` on E1A's exact
fixture (and one `capacityFor`/`forecastFor` figure) and bake the outputs into scenario E4A's
assertions — the E1 discipline.

1b. `lib/meetings.ts`: the `Meeting` interface (id, title, startAt, endAt, organizer,
organizerId, attendeeIds: string[], scopeKind?: 'issue' | 'project', scopeId?, note,
createdAt, createdBy, deletedAt), `meetingProblem` (title; end after start; ≥1 attendee),
`attends(m, personId)` = `!m.deletedAt && m.attendeeIds.includes(personId)` — ids only, no
name fallback, per the design's third send-back clause.

1c. `lib/availability.ts`: `meetingHours(meetings, personId, from, to)` — for each attended
live meeting, the hour overlap of `[startAt, endAt]` with `[fromT00:00:00, toT23:59:59.999]`
(the stated clipping rule: a straddling meeting counts only its inside hours; a multi-day one
clips the same way), summed and rounded 2dp. `availabilityFor` gains trailing
`meetings?: Meeting[]` — when absent or empty, committedHours arithmetic is UNTOUCHED; when
present, `availableHours = max(0, gross − committed − meetingHours)` and the position gains
`meetingHours` as a field (0 when absent — CapacityPosition consumers build field-by-field,
so the E1 never-spread rule keeps golden JSON shapes stable: verify `capacityFor` still
builds explicitly and add the field there deliberately or not at all — decide at the keyboard,
the golden arbitrates). Thread trailing optional params through `capacityFor`, `planCheck`,
`forecastFor`'s args object, and `lib/assignment.ts`'s `capacityFor` call (line ~183) —
trailing, so every existing call site compiles unchanged.

1d. Scenario **E4A**: the absent-param golden byte-identical; a 90-minute attended meeting
subtracts 1.5h; a straddler counts inside hours only; a non-attendee's numbers hold; a
cancelled meeting subtracts nothing; E1A and E1D pass UNTOUCHED (the tripwires).

**Verify:** `npm run validate:scenarios` → 181, 0 FAIL (E4A added; E1A/E1D untouched);
`npx tsc --noEmit`.

## Step 2 — find-a-slot

**Files:** `lib/scheduling.ts` (new), `scripts/scenario-validation.ts`.

`suggestDays({ attendeeIds, durationHours, from, to, meetings, commitments, holidays,
profiles })` → up to N candidate days, each `{ date, ok, blockers: string[] }`: an attendee's
free hours that day = profile hoursPerDay − that day's `meetingHours` − zeroed by an APPROVED
leave day or an org holiday; **Requested leave never blocks but is named as a caveat** (the
pendingLeave posture, pinned in E4C); weekends skipped via the existing working-day math.
Scenario **E4C**: clear day wins; approved leave blocks and is named; a crowded day fails the
duration; pending leave caveats without blocking; the empty answer is honest.

**Verify:** `npm run validate:scenarios` → 182, 0 FAIL. **Commit 1** = steps 1–2 +
`data/validation.json`.

## Step 3 — storage, standing alone

**Files:** `prisma/schema.prisma`, `prisma/migrations/<stamp>_meeting/migration.sql`,
`lib/db/map.ts`, `scripts/persistence-proof.ts` (scrub), `scripts/discussion-proof.ts` (its
scrub list only if the proof tenants could own meetings — they cannot; skip).

Model `Meeting`: `@@id([tenantId, id])`, attendeeIds `String[]` (Postgres text[]),
scopeKind/scopeId nullable, `@@index([tenantId, startAt])`. Migration: CREATE TABLE +
ENABLE/FORCE RLS + the tenant_isolation policy, verbatim pattern; Tenant back-relation.
Mappers `meetingToRow/FromRow` stamping tenantId. Persistence-proof scrub gains
`tx.meeting.deleteMany({ where })` before the issue deletes.

**Verify:** `npx prisma generate`; `npx tsc --noEmit`; `npx prisma migrate deploy` →
"successfully applied"; `npm run audit:tenancy` → **33 row mappers — all stamp tenantId**.
**Commit 2, standing alone.**

## Step 4 — state, arms, mints, persist cases, proof checks — one commit

**Files:** `lib/workspace.ts`, `lib/actionShape.ts`, `app/api/workspace/route.ts`,
`lib/notifications.ts`, `components/Inbox.tsx`, `lib/db/persist.ts`, `lib/db/repo.ts`,
`lib/autosave.ts`, `lib/clientBoundary.ts`, `scripts/persistence-proof.ts`,
`scripts/scenario-validation.ts`.

- `WorkspaceState.meetings: Record<string, Meeting>`; `initWorkspace` seeds `{}`;
  `lib/db/repo.ts` adds the `meeting.findMany` **at the END of both parallel lists** (the
  file's own nineteen-element destructure warning) and folds via `meetingFromRow`;
  `lib/autosave.ts` mirror-load gains `meetings: parsed.meetings ?? {}` (the established
  absent-tolerant line); `lib/clientBoundary.ts`'s clientView empties `meetings: {}` beside
  commitments — internal machinery, withheld wholesale. Boot needs NOTHING else: `base`
  spreads `...state`, and no redaction applies (meetings are internal-visible as-is).
- **Arms.** `upsertMeeting` (id nullable → `meet-${seq}` minted like commitments; gate:
  the central permission map gets `upsertMeeting: null`-style handling — decide: creation
  and edit take `internal.view` via an explicit `can()` in the arm, the E3 reading; edit
  additionally organizer-or-admin, checked against the STORED row's organizerId/name).
  Conflict scan AFTER validation: attendees whose approved leave or other live meetings
  overlap — into the success message, never a refusal. `cancelMeeting` (organizer-or-admin;
  refuses a second cancel). Mints via the E2 in-arm pattern (NOT the notify action — these
  arms live in the reducer): per attendee minus the actor, kind `'meeting'`, ruleIds
  `meeting-invite` on creation, `meeting-changed` when startAt/endAt/date move on edit,
  `meeting-cancelled` on cancel; `aboutId` = meeting id; **the mint counter starts from the
  arm's own seq and the returned state carries the final counter** (the E2 seq trap, asserted
  in E4B).
- `actionShape.ts` entries for both; route `KINDS` gains both; `NOTIFICATION_KINDS` gains
  `'meeting'`; Inbox `PrefRows` gains `{ kind: 'meeting', label: 'When a meeting I am in is
  booked, moved or cancelled', show: true }`.
- **`persistSteps` cases in this same commit**: `upsertMeeting`/`cancelMeeting` upsert
  changed meeting rows by identity diff AND call `persistNotificationDiff` (E2's exact gap,
  not repeated).
- **Persistence-proof checks in this same commit**: a meeting round-trips with attendeeIds
  and scope intact; its invite notification row lands; a cancellation survives reload and its
  cancelled-mint lands.
- Scenario **E4B**: organizer-or-admin edit rule; named warn-not-refuse conflict message;
  invite fan-out minus the actor with the seq arithmetic asserted (E2A style); change-mint
  only when the time actually moves; cancel mints once and a second cancel refuses; a muted
  attendee is silent with the audit line; actionShape refuses a smuggled field.

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios` → **183, 0 FAIL**;
`npm run audit:persistence` → all pass including the new checks; `npm run build`.
**Commit 3.**

## Step 5 — UI

**Files:** `lib/myCalendar.ts`, `components/MyCalendarPanel.tsx`,
`components/DetailPanel.tsx`, `components/IssueWorkspace.tsx`.

- `myCalendarMonth` gains the fifth entry kind (`{ kind: 'meeting', id, title, date,
  startAt, endAt }`) for meetings the person attends or organizes; the unscheduled rail is
  untouched. `MyCalendarPanel`: "Add meeting" beside "Add event"; MeetingForm — title, date,
  start/end times, attendee multi-select over live `model.people` with the organizer
  defaulted in, optional scope picker (issue/project), note, and **"Suggest a day"** calling
  `suggestDays` with the chosen attendees/duration and rendering candidates with their named
  blockers/caveats; day-rail meeting entries show attendees, with Edit/Cancel for the
  organizer (and admins). The privacy subtitle rewords: leave and meetings are the two stated
  exceptions.
- `DetailPanel` Schedule tab: a read-only "Meetings on this record/project" list when scoped
  meetings exist.
- `IssueWorkspace` BOTH onOpen sites: `n.ruleId.startsWith('meeting-')` →
  `setView('mycalendar'); return` — before the discussion branch.
- MyCalendarPanel's dispatches: `onUpsertMeeting`/`onCancelMeeting` props threaded like the
  E2 leave props.

**Verify:** `npx tsc --noEmit`; `npm run validate:scenarios` (183, untouched);
`npm run build`. **Commit 4.**

## Step 6 — staged deploy, live loop, cleanup

The staged foreground recipe; `migrate status` expects "up to date" (step 3 already applied).
Live in Chrome on production:

1. My calendar → Add meeting: tomorrow, 1.5h, attendees Nishant + M Tarun Kumar, scoped to a
   real record → renders on My calendar; Tarun's `meeting-invite` row confirmed by DB read;
   the 'meeting' prefs row visible.
2. Capacity check: a window covering the meeting shows the owner's numbers moved by 1.5h
   (compare a before/after `capacityFor` via a tmp read script, or the Capacity panel figure).
3. Conflict warning: seed a one-day approved leave for a test person (the E2 pattern —
   self-write via script, or approver-records-other), book a meeting over it → the success
   toast names the conflict; then find-a-slot over that range names the leave day as blocked.
4. Move the meeting (edit time) → `meeting-changed` row; cancel it → `meeting-cancelled`
   row, hours stop subtracting (recheck the capacity figure).
5. Notification click routes to My calendar from the bell.
6. **Cleanup (production)**: cancel/withdraw every test row through the app's actions
   (meeting cancelled is soft — hard-delete the test meeting rows via a tmp script named in
   the report, as E3 did); remove the test leave and person; mark check notifications read.

---

## The step carrying the most regression risk

**Step 1c, threading the optional meetings parameter.** Every capacity figure in the product
— the Capacity panel, plan checks, the forecast, assignment warnings, the watch rules'
planCheck — flows through these signatures. The params are TRAILING optionals so every
existing call compiles unchanged, but the failure mode is silent: a default that subtracts
when it should not (or a shifted positional argument in one of the ~10 call sites) changes
numbers planners act on, with no error anywhere. The absent-param golden in E4A plus the
untouched E1A/E1D baselines are the tripwires, and they run before any Meeting row can exist.

## Details most likely to be got wrong

1. The golden is captured BEFORE the signatures change, from the running code.
2. `meetingHours` clipping is the stated interval-overlap rule, pinned in E4A — not
   day-counting.
3. `attends` is ids-only; the organizer participates only if listed (the form defaults them
   in). If reality ever forces a name fallback here, that is the design's send-back clause,
   not a quiet widening.
4. A cancelled meeting subtracts nothing, mints its cancellation ONCE, and a second cancel
   refuses in words.
5. `forecastFor`'s args grow an optional `meetings` — E1D must pass untouched.
6. `clientView` empties `meetings: {}` explicitly; boot needs no other change (`...state`).
7. `lib/autosave.ts` gains `meetings: parsed.meetings ?? {}` — a mirror predating meetings
   has no such key.
8. `repo.ts`: append at the END of both parallel lists, per its own destructure warning.
9. The upsertMeeting mint counter starts from the arm's own seq (a new row already spent
   state.seq + 1) and the returned state carries the final counter — E4B asserts the
   arithmetic, the E2A pattern.
10. `persistSteps` cases call `persistNotificationDiff` — the arms mint.
11. The change-mint fires only when startAt/endAt actually move; editing the note or the
    attendee list quietly updates the row (an attendee ADDED to an existing meeting gets an
    invite mint; one removed gets nothing — state this in the arm comment and E4B).
12. Requested leave caveats in suggestDays; approved leave blocks — pinned in E4C.
13. The Inbox routing branch goes BEFORE the discussion branch at both sites and returns.
14. Scenario splices via temp file + python.

## Commit boundaries

1. Engine term + Meeting type + scheduling + E4A/E4C + goldens + `data/validation.json`.
2. Migration + model + mappers + scrub — stands alone.
3. State + arms + mints + shapes + KINDS + kind/prefs row + persistSteps cases + proof
   checks + E4B — one commit; the proof lands with the write path.
4. UI.
5. Deploy is not a commit; the report names the sha.

## What would send the design back

- The boot payload measurably suffers under real meeting volume — the stated deviation was
  wrong; the Discussion pattern plus a server availability API returns as a redesign.
  Surfaces only in production use.
- Hour-granular subtraction inside day-granular windows produces figures planners misread
  (fragmentation) — a presentation redesign, not arithmetic. Surfaces in live verification
  and early use.
- `attendeeIds` cannot stay pure directory ids — the join inherits the name-join debt; stop
  and take stock. Surfaces at the mapper/arm steps.
- From planning: if `CapacityPosition` cannot gain a `meetingHours` field without breaking
  a golden shape some consumer serializes, the field waits and the term stays inside
  `availableHours` — a smaller answer, decided at step 1c by the golden, not by preference.
