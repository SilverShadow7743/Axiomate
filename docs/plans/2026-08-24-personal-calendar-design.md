# A personal calendar — design

## What this answers

The second slice of "Personal Workspace consolidation." The BOS reference document's §4 asked
for one calendar aggregating meetings, due dates, milestones, leave, holidays, allocation and
personal events. Two of those turned out not to be real data anywhere in this app — there is no
meeting/event entity or calendar integration (`AGENT_MEETING_ACTIONS` is *declared*, `runtime:
'declared'`, with no implementation — the same "declared, no runtime" honesty this codebase
already applies elsewhere), and `Milestone` (`lib/milestone.ts:64`) carries no person field at
all, only a `sowId` — "my milestones" is not a well-defined question the data can answer.

Resolved, not glossed over: `PersonalEvent` is a new, minimal, manually-entered record (no sync,
no integration) so meetings have *some* real presence; milestones stay out of a personal
calendar entirely, the same reasoning that kept them out of the project-membership write gate
(commercial records one level coarser than what this screen is about).

## What this is

A new record, `PersonalEvent` — title, start, end, an all-day flag, a note, attendees as free
text, owned by exactly one person. A new pure aggregation (`lib/myCalendar.ts`) combining, for
one person: their `PersonalEvent`s, their `Commitment`s (Leave / Public holiday / Internal /
Training), their live `Allocation`s, and their own due-date work (the same id-aware ownership
join `lib/mywork.ts`'s `isMine` already uses). A new view-switcher entry, **"My calendar"**,
distinct in name and content from the existing **"Calendar"** (the work-item schedule everyone
already sees, unchanged).

## What this deliberately is not

**Not a replacement for the existing `calendar` view.** That screen answers "what's due when,
across the whole workspace" and stays exactly as it is. This answers a different question — "what
does my week look like" — mixing four kinds of things the existing screen was never built to
show. Folding them into one screen was tried once already this slice (the original "consolidate
into one home surface" framing) and turned out to be the wrong move once the actual code was
read; the same lesson applies here on purpose.

**Not synced from anywhere.** `PersonalEvent` is typed in, not pulled from Outlook, Graph, or
anything else. This app does have some Graph integration already (the intake mailbox watcher),
but wiring calendar sync is a materially different, much larger piece of work — OAuth consent,
the Graph Calendar API, two-way sync semantics — and building a manual record first is how this
program has approached every "declared but no runtime" gap so far: ship the honest, smaller thing,
and let real usage argue for the integration rather than assuming it.

**Not visible to anyone but its owner — not even `ADMIN`.** Every other privacy boundary in this
app is *conditional*: rates are withheld without `rate.view`, project content is withheld without
membership, both with an exemption for the operator. A personal event has no such exemption. This
is deliberately the single strongest rule in the codebase, because it is the one place "personal"
in "Personal Workspace" is actually load-bearing — a firm's administrator has no legitimate reason
to read what someone privately calendared, and a redaction that carved out an ADMIN exception here
would be quietly saying otherwise.

## Data model

```ts
export interface PersonalEvent {
  id: string
  /** Resolved from the actor, never a request field — see "Who may write" below. */
  personId: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  note: string
  /** Free text, not a directory reference — nothing here is validated against, or notifies,
   *  anybody named. This is a note to yourself about who else is involved, not an invitation. */
  attendees: string
  createdAt: string
  deletedAt: string | null
}
```

## Who may write

`addPersonalEvent` / `updatePersonalEvent` / `removePersonalEvent` carry no field naming which
person the event belongs to — the reducer resolves `personId` from `directoryPersonFor(model,
actor)` itself, the same join `myWork` already uses. This is the thing that makes "private to the
owner" actually true rather than merely intended: if the action carried a `personId` field the way
`addProjectMember` carries a `person` name, nothing would stop a request naming somebody else's id,
and the whole privacy guarantee would rest on client code nobody has to write correctly. Making it
structurally unwritable to anyone but yourself is stronger than gating it behind a permission a
future role could accidentally be granted.

`ACTION_PERMISSIONS` carries `null` for all three — the same shape `setNotificationPref` already
uses ("Self-or-admin, decided in the arm — only it knows whose preferences these are"), except
here there is no admin half: `updatePersonalEvent` / `removePersonalEvent` refuse when the actor's
own resolved id does not match the existing row's `personId`, full stop.

## The read side

`redactForReader` (`lib/db/boot.ts:250`) gains one more filter, applied unconditionally — before
the `internal.view` branch, not inside it, because this has nothing to do with the internal/client
boundary or project membership:

```ts
const personalEvents = Object.fromEntries(
  Object.entries(state.personalEvents).filter(([, e]) => e.personId === mine),
)
```

`mine` is already computed in this function. A reader with no directory entry (`mine === null`)
gets an empty map, correctly — there is no "whose" for an unrecognised sign-in to own.

## The aggregation and the screen

`lib/myCalendar.ts` is new rather than an extension of `lib/calendar.ts`'s `calendarMonth`, for
the same reason `projectView` is a separate function from `clientView`: the two answer different
questions and happen to both produce a month grid, and a function that does both today is the
kind of convenient collapse that breaks the day one of them needs to change alone.
`calendarMonth` is typed to `ScheduleRow[]` throughout — a homogeneous collection where every
row has (or lacks) one `plannedEndDate`. This aggregates four heterogeneous kinds into one grid
and reuses only the *shape* of `calendarMonth`'s padding algorithm (Monday-first weeks, padded to
whole weeks), not its signature.

```ts
export type MyCalendarEntry =
  | { kind: 'event'; id: string; title: string; date: string; allDay: boolean }
  | { kind: 'commitment'; id: string; label: string; date: string }  // one entry per day covered
  | { kind: 'allocation'; id: string; label: string; date: string }  // one entry per day covered
  | { kind: 'work'; id: string; title: string; date: string; row: ScheduleRow }
```

Work items reuse the same "no planned end = cannot be on a calendar" honesty `calendarMonth`
already established — an owned issue with no planned date is not silently dropped, it is a
first-class "unscheduled" state, listed beside the grid the same way `CalendarView`'s rail
already does it.

A new component, `MyCalendarPanel`, docked the same way this slice's first piece already
established for `TimesheetPanel`/`Inbox` — no scrim, no focus trap, the view switcher is how you
leave. `'mycalendar'` joins `WORKSPACE_VIEWS`.

## What's out of scope, on purpose

- Meeting sync (Outlook/Graph) — the honest "declared, no runtime" gap this design names rather
  than fakes with a manual record pretending to be more than it is.
- Milestones — no person field exists to hang "mine" off of.
- Recurring personal events — a real feature with real complexity (recurrence rules, exceptions
  to a series) that a single one-off record does not need to solve to be useful.
- Sharing an event, or any visibility broader than the owner — the whole point of this slice.

## What would send this back

- If, once `myCalendar.ts` is written, the four entry kinds turn out not to compose cleanly into
  one day-grid (a genuine structural mismatch, not just more code needed) — that would mean the
  four kinds of things are not actually one "calendar" and the design's central premise needs
  re-examining, not patching.
- If the self-only write rule turns out to make a legitimate scenario impossible — a firm that
  genuinely needs an assistant to manage a principal's calendar, say — that is a real gap in "no
  admin override, full stop," and the answer is reopening this design's privacy section, not
  quietly adding a bypass.
