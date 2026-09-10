# Mail triage and personal actions — implementation plan

Follows `docs/plans/2026-09-10-mail-triage-and-personal-actions-design.md`. Ordering: the new
private entity and the `needsTriage` marker are pure reducer logic, provable by scenario before
either the intake pipeline or any UI depends on them; the intake pipeline's one new dispatch comes
next since nothing downstream can be exercised without it; the UI — the filter chip, the triage
actions, and the new "My to-dos" screen — comes last. This mirrors the leave-report plan's own
ordering principle and, more directly, an already-shipped precedent inside this very codebase:
`PersonalEvent` (`lib/personalEvents.ts`) is a near-exact structural match for the new
`PersonalAction` entity — private to its owner, no exception for anyone including `ADMIN` — so
most of this plan is "copy that pattern, renamed and re-typed," not new design.

## One correction to the design doc, found while grounding this plan

The design doc types the new field as `Issue.needsTriage?: true` (absent-means-unrecorded,
`email`/`title`'s own convention). That convention exists to distinguish "never recorded" from
"recorded as empty" — a distinction that matters for a title or a phone number, and does not exist
for a plain yes/no review flag: there is no meaningful difference between "no triage needed" and
"never even considered," and forcing the field through an absent-vs-explicit-`true` sentinel would
need a second convention (undefined-means-keep, some-other-value-means-clear) precisely to let the
Confirm action clear it back — the same `undefined`-does-not-survive-JSON class of gotcha
`clientScopeId`/`managerId` solve today with `null`, reinvented for no reason. **Plain
`needsTriage?: boolean`** instead: absent and `false` mean the same thing (no read site needs to
distinguish them), and clearing it is an ordinary explicit `false`, no sentinel needed. Named here
rather than silently changed, per this repo's own convention for correcting a prior document.

## Steps

**0. Schema and persistence plumbing — found missing from this plan at implementation, added
10 Sep.** `personalEvents` is not only a state slice: it has a Prisma model, a row mapper pair in
`lib/db/map.ts` (`personalEventFromRow`/`ToRow`, `:968-997`), a loader in `lib/db/repo.ts`
(the `findMany` list `:193`, the state assembly `:312`), a before/after diff writer in
`lib/db/persist.ts` (`:513-526`), and a local-mirror seed in `lib/autosave.ts` (`:264`). The
first draft of this plan mentioned none of them. `PersonalAction` needs all five, and
`Issue.needsTriage` needs a column plus the two lines in `issueToRow`/`issueFromRow`
(`map.ts:243`, `:292`). One migration, `20260910000001_mail_triage` — additive, no DML, and the
new table carries its own RLS policy in its creation migration as every table since
`20260824000004` does (the checklist migration is the template). **Stands alone as commit 0**,
per this repo's own rule that a schema change is never bundled (`docs/adr/0005`). The entity
type (step 1) is written here too, because the mappers need it to compile.

**Verify:** `npx prisma generate`, `npx tsc --noEmit`, `npm run audit:tenancy` (the mapper count
rises by one and the new mapper must stamp `tenantId` — the audit checks exactly that),
`npx tsx scripts/scenario-validation.ts` (count unchanged), `npm run build`.

**1. `lib/personalActions.ts` (new) — the entity, pure.**

Structural copy of `lib/personalEvents.ts` in full: the interface, a validation function, and the
redaction function — same shape, same absolute-privacy header comment (adjusted for the field
names), same reasoning for why it is a separate pure function rather than inline in `boot.ts`.

```ts
export interface PersonalAction {
  id: string
  personId: string
  text: string
  dueDate?: string
  status: 'To do' | 'Done'
  sourceSubject?: string
  sourceMessageId?: string
  createdAt: string
  deletedAt: string | null
}

export interface ActionProblem { field: 'text'; message: string }
export function actionProblem(a: Pick<PersonalAction, 'text'>): ActionProblem | null
export function personalActionsFor(
  all: Record<string, PersonalAction>,
  mine: string | null,
): Record<string, PersonalAction>
```

`actionProblem` only checks non-empty `text` — no date-ordering check needed (`dueDate` is
optional and has no paired field to be out of order with, unlike `PersonalEvent`'s start/end).

**Verify:** `npx tsc --noEmit` — no harness reaches this until step 2.

**2. `lib/workspace.ts` — the entity's home in `WorkspaceState`, and its three reducer arms.**

- `IssueRecord`: add `needsTriage?: boolean` beside `clientVisible?` (`lib/workspace.ts:259`
  area) — same file, same neighborhood, since both are boundary-relevant boolean flags on the
  same record.
- `WorkspaceState`: add `personalActions: Record<string, PersonalAction>`, and seed it empty
  wherever `WorkspaceState`'s other empty maps are constructed (`initWorkspace`, and any other
  site that builds a from-scratch state — grep `commitments: {}` or `personalEvents: {}` in
  `lib/workspace.ts` to find every site that needs the new key added alongside them).
- Three new `Action` variants and reducer arms, structural copies of `addPersonalEvent` /
  `updatePersonalEvent` / `removePersonalEvent` (`lib/workspace.ts:7678-7739`) — including the
  exact same "This is not your event" → "This is not your action" ownership check on update/
  remove, and the same "no directory entry, nowhere to add it" refusal on create:
  - `addPersonalAction`: `{t, text, dueDate?, sourceSubject?, sourceMessageId?, now}` →
    `personId` resolved from `directoryPersonFor(state.model, actor)`, never carried on the
    wire, exactly as `addPersonalEvent` already does.
  - `updatePersonalAction`: `{t, id, patch: Partial<Pick<PersonalAction,'text'|'dueDate'|'status'>>, now}`.
  - `removePersonalAction`: `{t, id, now}` — soft-delete.
- **`convertToPersonalAction`** — the one action with no `PersonalEvent` precedent, because it
  does two things atomically: `{t: 'convertToPersonalAction', issueId, dueDate?, now}`.
  - Refuses if the issue does not exist or is already deleted.
  - Gated the same way `POST /api/mail/file` already gates filing — `can(state.model, actor,
    'evidence.add')`, plus `internal.view` when the issue has no project ancestor
    (`projectOf(state, issue.parentId)`, the same helper `/api/mail/file` already imports).
  - Soft-deletes the issue (`deletedAt: a.now`) and, in the SAME reducer return, creates a
    `PersonalAction` whose `text` is the issue's subject, `sourceSubject` its subject again (kept
    separately so a later subject edit on nothing — the issue is gone — never applies), and
    `sourceMessageId` read off the matching `InboundMail` row if the intake pipeline recorded one
    (`Object.values(state.inboundMail).find(m => m.issueId === issueId)?.messageId`). One
    dispatch, one audit entry, no window where the issue is gone but no personal action exists
    yet or vice versa — the reason this is its own arm rather than two separate actions the
    caller would have to sequence.
- **The `needsTriage`-clearing rule, inside the existing `case 'updateIssue'` arm**
  (`lib/workspace.ts:2669`): after the patch is merged but before `done(...)`, if
  `i.needsTriage` was `true` and `a.patch.needsTriage === undefined` (caller did not explicitly
  touch it) and at least one other field in the merged record differs from `i`, set
  `needsTriage: false` on the outgoing record. An explicit `a.patch.needsTriage` value (what
  Confirm sends — see step 6) always wins over this inferred rule. **This is the step's real
  risk** — get the "at least one other field differs" check wrong (e.g. compare against `a.patch`
  instead of the actually-changed merged record) and either a no-op edit wrongly clears the flag,
  or a real reclassification leaves it set.

**Verify:** `npx tsc --noEmit`.

**3. New scenarios in `scripts/scenario-validation.ts`.**

- **`PA2`** (picking up after `PA1`'s existing id) — `addPersonalAction`/`updatePersonalAction`/
  `removePersonalAction`: created by one actor, refused for a second actor trying to update or
  remove it ("This is not your action"), `personalActionsFor` returns only the creator's own rows
  from a set containing several people's — proving the absolute redaction, the one property this
  whole entity exists for.
- **`PA3`** — `convertToPersonalAction`: an issue with a matching `InboundMail` row is soft-
  deleted and a `PersonalAction` appears with the right `sourceMessageId`; refused for an actor
  without `evidence.add`; refused for an already-deleted issue; `personalActionsFor` still returns
  it only to its creator afterward (proving the two effects landed in the same state, not a
  partial write).
- **`TRG1`** — the `needsTriage` clearing rule: an issue created with `needsTriage: true` (via
  `updateIssue`), then a no-op `updateIssue` (patch equal to current values) leaves it `true`; a
  real field change clears it to `false`; an explicit `updateIssue` with `patch: {needsTriage:
  false}` and nothing else (the Confirm action's own shape) also clears it; severity/SLA due-date
  math (`computeDurations`/`proposeTargetDate`, `HOL1`'s own precedent) run identically on an
  issue whether `needsTriage` is `true` or `false` — the scenario's own proof of the design's
  central safety claim that this flag changes nothing else.

**Verify:** `npx tsx scripts/scenario-validation.ts` — `PA2 PASS`, `PA3 PASS`, `TRG1 PASS`,
scenario count +3, no regressions.

**4. `lib/types.ts` / `lib/tree.ts` — the filter chip's plumbing.**

- `TreeRow`: add `needsTriage: boolean` beside `raidKind` (`lib/types.ts` ~251); default `false`
  at row construction (`lib/tree.ts` ~319, beside `raidKind: null`).
- Row population: `row.needsTriage = issue.needsTriage === true`, right beside
  `row.raidKind = raidKindOf(...)` (`lib/tree.ts:147`).
- `FilterState`: add `triageOnly: boolean`; `EMPTY_FILTERS.triageOnly = false` (`lib/types.ts`,
  the `raidOnly` neighborhood).
- `matchesFilters`: `if (f.triageOnly && !row.needsTriage) return false`, right beside the
  existing `raidOnly` line (`lib/tree.ts:442`).

**Verify:** `npx tsc --noEmit`.

**5. `lib/db/boot.ts` / `lib/clientBoundary.ts` — redaction wiring.**

- `redactForReader` (`lib/db/boot.ts:315`): `const personalActions =
  personalActionsFor(state.personalActions, mine)`, placed beside `personalEvents` (`:355`), same
  "absolute, no exception even for ADMIN" comment adapted for the new field. Include
  `personalActions` in the function's returned object.
- `clientView` (`lib/clientBoundary.ts`): add `personalActions: {}` to the wholesale-withheld
  block beside `personalEvents: {}` (`:133`) — a client-role reader must never see any internal
  person's private to-dos, the identical reasoning already recorded there for the calendar.

**Verify:** `npx tsc --noEmit`. No new scenario — `PA2`'s redaction proof already covers
`personalActionsFor` directly; this step only wires the same pure function into the two call
sites, the same posture `personalEvents` itself has (no dedicated boot-level scenario beyond the
pure-function one).

**6. `app/api/intake/route.ts` — the one pipeline change.**

Immediately after the existing follow-up `addNote` action (`:290-296`) in the NEW-issue branch
(the `if (matched)` branch above it is untouched — a reply on an already-matched thread keeps
auto-attaching exactly as today, no `needsTriage` involved), add a third action to the same
`follow` batch:

```ts
{ t: 'updateIssue', id: issueId, patch: { needsTriage: true }, now } as Action
```

Dispatched through the same `persistActions(tenantId, INTAKE_ACTOR, follow)` call already there —
one more action in an existing batch, not a new round-trip. `INTAKE_ACTOR` needs no new
permission for this: `updateIssue` is gated on `work.edit`, which `ROLE_AUTOMATION` holds (`lib/access.ts` `[MACHINE_ROLE_ID]` grant — this sentence first said the arm was ungated, which was wrong; `TRG2` pins the grant so the batch cannot be refused whole) (matches
today's behavior — the intake actor already dispatches `create`/`addNote` through this same
unguarded path).

**Verify:** `npx tsc --noEmit`, `npm run build`. No new scenario for this step specifically — the
intake pipeline's existing scenarios (`IT1` and neighbors) already exercise `create` + `addNote`
through this exact code path; extending one of them to also assert `needsTriage === true` on the
resulting issue (and, for a MATCHED reply, that the existing issue's `needsTriage` is untouched)
is a smaller addition to an existing scenario, not a new one — check `IT1`'s own assertions before
deciding whether to extend it or add a short new one purely for this claim.

**7. UI — the filter chip.**

`components/FilterBar.tsx`: a new toggle button, structural copy of the `raidOnly` button
(`:379-384`) — `filters.triageOnly`, label "Needs triage" / "All records", same `btn ghost`/`on`
class pattern, same `aria-pressed`.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint components/FilterBar.tsx`.

**8. UI — triage actions on an unconfirmed issue.**

Wherever an issue's actions already render (the detail panel / row menu — the exact component
depends on what's already there; grep for where `updateIssue` is already dispatched from the UI
to find the right home rather than guessing a new one). Three controls, shown only when
`row.needsTriage`/`issue.needsTriage` is true:

- **Confirm** — dispatches `updateIssue` with `patch: { needsTriage: false }`, nothing else.
- **Reclassify / reparent** — no new UI: the existing parent-change/edit controls already clear
  the flag as a side effect (step 2's rule), so this "action" is really just "the existing edit
  UI now also does this" — worth a one-line note in the UI near the flag's badge, not a new
  control.
- **Convert to a personal to-do** — opens a small form (structural copy of `InboxPanel.tsx`'s
  filing modal, minus the create/attach mode toggle — there is only one destination here): a
  text field pre-filled with the issue's subject, an optional due-date picker, dispatching
  `convertToPersonalAction`.

A small badge or marker on the row/detail itself (e.g. next to the severity chip) so an
unconfirmed issue is visible even outside the `triageOnly` filter — a person should not have to
toggle a filter to notice their own new work needs a look.

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint` on the touched component(s).

**9. UI — "My to-dos."**

- `components/AppSidebar.tsx`: add `'mytodos'` to the `mywork` group's `items` array (`:19`),
  beside `mycalendar` — same group, same "private to you" precedent phrase in its description.
- A new `MyTodos.tsx` component — much simpler than `MyCalendar`'s multi-kind month grid, because
  by the time state reaches the client `state.personalActions` already contains only the signed-
  in person's own rows (step 5's redaction did that work server-side): `Object.values(
  state.personalActions).filter(a => !a.deletedAt).sort(...)` — due date ascending, undated last.
  A checkbox per row toggling `status` via `updatePersonalAction`, and a small inline "add" form
  (text + optional due date) for todos created directly rather than converted from mail.
- `components/IssueWorkspace.tsx`: wire `view === 'mytodos'` into the view switch, structural
  copy of the existing `view === 'mycalendar'` branch (`:2565`).

**Verify:** `npx tsc --noEmit`, `npm run build`, `npx eslint` on the touched files.

## Commits

**Commit 0 — step 0.** Schema, migration, mappers, loader, mirror seed, and the entity type.
Alone, because it carries a migration.

**Commit 1 — steps 1-3.** The reducer arms, the clearing rule, the `persist.ts` case for the
three new action kinds (and for `convertToPersonalAction`, which writes to two collections —
`issues` and `personalActions` — in one case), all three scenarios. Provable end to end with no
pipeline or UI change yet — the same "pure logic first" shape the leave-report plan used.

**Commit 2 — steps 4-6.** The filter/row plumbing and the one intake-pipeline change, bundled
because the filter chip is meaningless until real rows can carry `needsTriage`, and the intake
change is what makes that happen for the first time outside a scenario. **This is the step
carrying the most regression risk** — not the new code, which is small and additive, but the
`updateIssue`-based clearing rule from step 2 running for real, for the first time, against live
production issues once intake starts setting `needsTriage: true`. If the "at least one other
field differs" check is ever wrong in the direction of over-clearing, `needsTriage` could silently
stop working — every new issue would still get flagged, but the flag would vanish the instant
anything else about the issue changed, including changes that have nothing to do with triage. The
concrete guard against this: `TRG1`'s no-op-edit assertion (step 3) is what would have caught this
class of bug before it reached production, so it must genuinely pass, not be adjusted to fit
whatever the code happens to do.

**Commit 3 — steps 7-9.** The full UI — the filter chip, the triage actions, and "My to-dos."
Bundled because none of the three is independently useful without the others (a filter chip with
nothing to act on, actions with no way to see what needs them, a personal to-do list nothing
converts into it yet).

## What would send this back to the design

- **If `TRG1` cannot be made to pass as specified** — if there is genuinely no clean way to tell
  "a real edit happened" from "the exact same values were resent" using only `i` (the stored
  record) and the merged patch — the design's "any edit clears it" rule would need to narrow to
  an explicit list of fields (module, severity, parentId, status) rather than "anything," which
  is a real, if small, design change, not just an implementation detail.
- **If `convertToPersonalAction`'s permission gate turns out to need to differ from
  `/api/mail/file`'s** (for instance, if only the issue's own current owner — not anyone holding
  `evidence.add` broadly — should be allowed to convert it away) — that is a real access-control
  decision belonging back in the design, not a call to make silently while implementing.
