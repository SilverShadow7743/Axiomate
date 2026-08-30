# E4 — Meetings: the availability engine's fourth term, and a slot worth suggesting

**Status: approved 2026-08-30** (four explicit decisions, recorded below).
Phase E4 of the platform evolution (`2026-08-29-work-platform-evolution-design.md`):
"Scheduling intelligence — Meetings, calendar/task/dependency/leave joined through the
availability engine." E0–E3 are complete and live.

## The debt this pays

`lib/availability.ts` has carried its own IOU since E1: *"meetings (ZERO until E4 — no
meetings exist yet; stated, not hidden)"*. E4 makes the term real:

    available = pattern gross − approved commitments − holidays − MEETINGS − allocations

## Decisions (settled with the user, 2026-08-30)

1. **Scope: meetings + the engine term + find-a-slot.** Conflict warnings ride along;
   recurrence does not (a series multiplies every edit/cancel edge in an MVP).
2. **Boot-shipped, like commitments** — an honest, STATED deviation from the parent design's
   server-queried rule, which named "chat/meetings-scale domains". The decisive fact: the
   engine and every consumer (CapacityPanel, the forecast, assignment warnings) run
   client-side against the boot payload. A server-queried meeting store would leave them all
   blind unless availability itself became a server API — a rewrite of every capacity surface
   for an MVP. Meetings at this firm's scale are commitment-sized, not chat-sized; if volume
   ever proves otherwise, the E3 Discussion pattern is the escape hatch and this line is the
   record that the trade was made knowingly.
3. **Any internal person organizes; attendees are notified.** `internal.view` is the gate
   (the same "internal collaboration" reading E3 used); the organizer or an admin edits.
   A new `'meeting'` notification kind — invite, material change, cancellation — rides the
   existing prefs/drain machinery, muteable like every kind.
4. **Approach: a first-class Meeting entity.** Rejected: per-attendee Commitment rows (kind
   'Meeting') — reuses everything but shatters the shared identity; editing one meeting means
   editing N rows in step. Rejected: promoting PersonalEvent with a "shared" flag — it
   collides with the one no-exemption privacy rule in the app.

Stated rather than asked, on precedent: **conflicts warn, never refuse** — E1's own words
("the leave is not the problem, the plan around it is") apply verbatim to a meeting booked
over leave; and a meeting **optionally attaches to a Work Context** (issue or project),
the parent design's rule for communication.

## The entity

`Meeting`: id, title, `startAt`/`endAt` (ISO datetimes; same-day expected, not forced),
organizer + organizerId, `attendeeIds` (directory references — real invitations, unlike
PersonalEvent's free-text note-to-self), optional `scopeKind`/`scopeId` ('issue' | 'project'),
note, createdAt/By, soft `deletedAt`. In `WorkspaceState`, on the boot payload, in the browser
mirror. New Prisma table with the forced-RLS policy, `lib/db/map.ts` mappers stamping
tenantId, scrub entries in both proofs; the migration stands alone (no DML).

## The engine's fourth term

- `meetingHours(meetings, person, personId, from, to)` in `lib/availability.ts`: for each
  live meeting the person attends, the duration falling inside the window, summed —
  hour-granular inside the day-granular engine (a 90-minute meeting subtracts 1.5h). The
  attendee join is the standard one: directory id when both sides have one, trimmed-name
  fallback never needed here because attendeeIds ARE ids — organizer matching alone keeps
  the name fallback.
- `availabilityFor` gains an optional `meetings` parameter. **Absent means zero — today's
  arithmetic byte-identical**, the tiers/holidays optional-param pattern, held by a golden
  check before any caller passes it. The IOU comment is rewritten to describe the real term.
- `capacityFor`, `planCheck`, `forecastFor` and the assignment warning pass meetings through;
  every capacity number in the product then prices meetings in.

## Reducer arms

- `upsertMeeting` — organizer-or-admin edits (the arm checks; creation needs
  `internal.view` via the standard gate). Validation in words: a title, an end after the
  start, at least one attendee, attendees resolve to directory people. The success message
  carries the NAMED conflicts (attendees on approved leave that day; attendees already in an
  overlapping meeting) — warn, never refuse.
- `cancelMeeting` — soft; organizer-or-admin.
- Notifications minted in the arms (the E2 pattern: modeFor per recipient, mute-audit,
  email record when opted): kind `'meeting'`, to attendees minus the actor, on invite,
  on a time/date change, on cancellation. `NOTIFICATION_KINDS` gains `'meeting'`;
  the Inbox's hand-maintained prefs list gains its row. Both persistSteps cases and
  persistence-proof checks land IN THE SAME COMMIT as the arms (the recorded trap).

## Find-a-slot

`lib/scheduling.ts`, pure: `suggestDays(args: { attendeeIds, durationHours, from, to,
meetings, commitments, holidays, profiles })` → the earliest N working days where EVERY
attendee's free hours (pattern day − that day's meeting hours − zeroed by leave/holiday)
clear the duration, each candidate carrying its named blockers ("Fri 4 Sep: Sam on leave").
Day-granular — mornings/afternoons wait for a time grid that does not exist. Surfaced in the
meeting form as "Suggest a day"; an honest empty answer ("no day in this range clears 2h for
all four") rather than a forced pick.

## Surfaces

- **My calendar**: meetings join as the fifth entry kind — every attendee sees theirs; the
  organizer gets Edit/Cancel in the day rail; "Add meeting" beside "Add event", with a
  directory attendee picker and the slot suggester. (The privacy subtitle grows its second
  honest exception: meetings are visible to their attendees and planners.)
- **Schedule tab**: a record's or project's scoped meetings listed read-only.
- **Inbox routing**: `'meeting'`-kind ruleIds route to My calendar, both onOpen sites.
- **Capacity/forecast**: no new UI — the numbers simply start pricing meetings in, and
  `describeCapacity`/`describeForecast` sentences hold.

## Error handling

Arm refusals in words (no attendees, unknown attendee, end before start, editing another's
meeting). Conflicts are message content, never refusals. A cancelled meeting leaves audit and
notification trails; its hours stop subtracting immediately.

## Testing

- **E4A** — `meetingHours` + the engine term: the absent-param golden (byte-identical to
  today), window clipping (a meeting straddling the boundary counts only its inside hours),
  non-attendees unaffected, cancelled meetings subtract nothing.
- **E4B** — the arms: organizer-or-admin rule, named warn-not-refuse conflicts, invite/
  change/cancel fan-out minus the actor, a muted attendee silent with the audit line,
  wire-smuggle refusals via actionShape.
- **E4C** — find-a-slot: the clear day wins, leave blocks and is named, a crowded day fails
  the duration, the empty answer is honest.
- Persistence proof: a meeting round-trips with its attendee list and scope; a cancellation
  survives reload. Tenancy audit grows by the new mappers.
- Standing gates unchanged; staged foreground deploy; live verification on production ends
  with cleanup through the app's own actions.

## Non-goals

Recurring series, Outlook/Graph calendar sync (providers later; the Graph client stays
mail-only), video links or rooms, time-of-day grids and timezones (a single-timezone firm;
datetimes stored as entered), cross-firm attendees.

## What would send this design back

- If the boot payload measurably suffers under real meeting volume — the stated deviation was
  wrong and the Discussion pattern (server-queried + availability API) returns as a redesign,
  not a patch. Surfaces only in production use; the doc records the escape hatch.
- If hour-granular meeting subtraction inside day-granular windows produces figures planners
  read as wrong (a 6-meeting day showing 1.5h "available" that is actually fragmented) — the
  term needs a fragmentation-aware presentation, which is a design question, not arithmetic.
  Surfaces in live verification and early use.
- If `attendeeIds` cannot stay pure directory ids (imports or renames force a name fallback
  after all), the join inherits the name-join debt everywhere else carries — stop and take
  stock rather than quietly widening. Surfaces in the mapper/arm step.
