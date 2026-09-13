# Client Milestones view — design

Third of the three new pages (`docs/strategy/2026-09-12-business-process-review.md` §4,
Design 3). Different shape from Resourcing and Commercial: those two were new callers over
data an internal reader already receives. This one needs the data to cross a boundary it
does not cross today — the review's own roadmap names this explicitly (§5, item 3): *"The
client notification class and client milestone projection do need small, additive
schema/shape work."* This design is that shape work.

## Why the review's own build estimate ("cheapest possible build") still needs a schema change

`Milestone`/`Sow` are not merely hidden by the UI for a client seat — they are withheld
**server-side**. `lib/db/boot.ts` (~430) returns `clientView(base, clientScopeId)` directly
for any non-`internal.view` reader, with no second merge afterward, and `clientView()`
(`lib/clientBoundary.ts`) sets `milestones: {}` and `sows: {}` unconditionally: *"Same
sensitivity class as rates/sows above — a frozen cost figure is still a cost figure."* A
`WorkspaceState` in a client seat's browser has no milestones in it at all. A `CLIENT_GROUPS`
view reading `state.milestones` would render an empty table, and typecheck/eslint/scenarios
would all pass while it did — a page that renders nothing is not a smaller version of this
feature, it is a different bug.

The narrow exception that already exists — `lib/reports/clientPack.ts`'s `milestonesOf()`,
which reads `Milestone`/`Sow` off the FULL state to build the monthly governance pack's
payment schedule — does not transfer. Its own header comment says why: it works *because*
`buildMonthlyGovernancePack` runs **server-side**, over full state, generating a document.
A `CLIENT_GROUPS` view runs **client-side**, over whatever `boot()` already sent. Same shape
of function, opposite side of the boundary that matters.

## What must change, and why here

A new field on `WorkspaceState`, computed **inside `clientView()`** (not beside it, not in a
separate module) from the full `state` argument `clientView()` already receives, before any
zeroing:

```ts
clientMilestones: Record<string, ClientMilestoneLine>
```

`ClientMilestoneLine` (new type, in `lib/clientBoundary.ts` beside `clientView()`):

```ts
interface ClientMilestoneLine {
  id: string
  sowReference: string
  name: string
  sequence: number
  plannedDate: string | null
  delivery: DeliveryState
  deliveredAt: string | null
  acceptance: AcceptanceState
  acceptedAt: string | null
}
```

Deliberately excluded: `amount`, `percentage`, `currency`, `basis`, `billOn`,
`acceptedValue`, `rejectionNote`, `description` — everything commercial or internal-process,
matching the design brief's own framing ("transparency without exposing confidential
information") and `clientPack.ts`'s own reasoning for its payment-schedule line, minus the
money fields that line deliberately keeps for the periodic report and this live tab
deliberately does not. `sowReference` survives because it is the document's own number, not
a value — the same class of fact a client already holds on the paper they signed.

Scoped with `clientView()`'s own local `underScope` closure (already in the function, no new
helper): a milestone survives only when `state.sows[m.sowId]` exists, is not soft-deleted,
and its `engagementId` is `underScope` of the reader's `clientScopeId` — the same ancestry
rule `issues` uses two lines above it. `!m.deletedAt` is checked explicitly — the exact
one-line gap `milestonesOf()` had until the fix earlier this session (commit `7fe7305`),
not repeated here on a fresh read of the same interface.

**Why this must not be done by populating `milestones`/`sows` with field-redacted copies**:
`clientView()`'s own header comment states the invariant this file has followed throughout —
*"Two cuts, both dropping whole entries — never redacting a field inside one."* A
field-stripped `Milestone` object handed to `state.milestones` would violate that literally,
and would put a partially-populated record in front of every other reader of a redacted
state that has only ever seen an empty map there. A genuinely different, narrower TYPE in a
new field keeps the invariant true rather than bending it for one caller.

**Why this must not be a Configuration-level or per-record toggle**: unlike issues/notes/
documents, a `Milestone` carries no `clientVisible` flag today, and the review's own ask is
transparency into the CONTRACTED schedule, not a selectively-curated one — every milestone
under the client's own signed SOWs, or none of the value of the page is lost to "why is this
one missing." Adding a flag would be inventing a curation feature nobody asked for.

## Where this is empty, and why that is correct, not a bug

- Internal readers (`can(..., 'internal.view').allowed`): `clientMilestones` is never
  populated for them — `boot()`'s internal branch returns `projectView(base, ...)` or `base`
  directly, never `clientView()`. They already have `CommercialPanel`'s full milestone view,
  a strict superset; there is no separate internal audience for a narrower copy of their own
  data.
- The reducer's own in-memory state and the seed constructor: `clientMilestones: {}` always
  — it is not persisted, not mutated by any action, and recomputed fresh on every `clientView()`
  call from whatever `state.milestones`/`state.sows` hold at read time. It is exactly as
  derived as `issues`/`nodes` already are in the same function, just carrying a narrower shape
  than the collection it derives from.
- A client seat with no `clientScopeId` resolved (no directory entry, or unattached): `{}`,
  the same "null empties everything" rule `clientView()` already applies to `issues`.

## The page itself

Added to `CLIENT_GROUPS` (`components/AppSidebar.tsx`) as a fourth item, alongside Tree/
Board/Calendar — explicit choice, stated here rather than left implicit: this is a
client-facing view with no internal equivalent, the same reasoning `CLIENT_GROUPS` already
applies to Tree/Board/Calendar being the client's OWN narrow slice rather than a permission-
gated cut of a shared one. `GROUPS`/`CLIENT_GROUPS` stay disjoint, as everywhere else in this
file — an internal reader reaches milestones through `CommercialPanel`, never through this
view.

**Structure**, per the review's own mockup — a flat list, delivery-state icon, one status
line, no sub-tabs (there is exactly one audience-appropriate cut, unlike Commercial's four):

```
┌─ Milestones ──────────────────────────────────── (client view) ────────┐
│  ✓ Discovery workshop        Delivered  12 Aug                         │
│  ● Phase 1 build             In progress · due 30 Sep                  │
│  ○ UAT sign-off              Planned · due 15 Oct                      │
└────────────────────────────────────────────────────────────────────────┘
```

Icon and status label are **presentation**, derived in the component from `delivery`/
`acceptance` (matching Resourcing/Commercial's own split — the lib function decides WHICH
records survive and WHAT fields they carry; the component decides how to word them):

| delivery     | acceptance          | icon | label                     |
|--------------|----------------------|------|---------------------------|
| Planned      | (n/a)                | ○    | Planned · due `<date>`    |
| InProgress   | (n/a)                | ●    | In progress · due `<date>`|
| Delivered    | Pending              | ●    | Delivered · awaiting review |
| (any)        | Accepted             | ✓    | Delivered `<deliveredAt>` · Accepted `<acceptedAt>` |
| (any)        | Rejected             | ✗    | Returned · `<rejectionNote>` withheld — see label below |

The Accepted row is deliberately not keyed to `delivery === 'Delivered'`: a signature-billed
milestone (`billOn: 'signature'`, owed on signing) can be accepted before delivery even
starts — `acceptProblem` in `lib/milestone.ts` only requires `delivery === 'Delivered'` when
`billOn !== 'signature'` — so `deliveredAt` is not guaranteed to exist on an accepted row and
the label omits the "Delivered" clause when it does not.

Rejected carries no `rejectionNote` in the projection (it is process detail, not a date or a
name) — the label reads "Returned for rework" with no reason text, matching the same
"withhold the class, don't half-show it" reasoning as everything else in `clientView()`.
Grouped/sorted by `sowReference` then `sequence` — the same order `milestonesOf()` already
uses for the pack, so a client who has seen the pack finds the same order here.

Shell conventions: same `.evi.mywork`/`.evi-head`/`.evi-list` family as Resourcing and
Commercial, but no `.evi-tabs` (nothing to switch between) and no quick-filter input (a
client's own milestone count across one or two engagements is small enough that a filter box
would be furniture, not a tool — revisit only if that stops being true).

## Out of scope (v1)

- A `clientVisible`-style per-milestone toggle (named above — the review's ask is contracted
  transparency, not curation).
- Linking Design 3 to the client-notification class the review pairs it with (§4: "a
  milestone delivered could fire the same new notification class"). That notification class
  does not exist yet — building it here would be a second feature riding this one's commit.
  Named as a natural fast-follow once it exists, not built now.
- Rejected-milestone reason text in the client's view (named above).

## Risk

Different class from Resourcing and Commercial, and worth being explicit about: those two
added a **new caller** over data already flowing to its existing readers — read-only, no new
disclosure surface. This one **adds a disclosure surface that does not exist today** — a
client seat gains visibility into records (`Milestone`, transitively `Sow.reference`) it
currently receives zeroed entirely. The regression risk is not "wrong numbers on a new page,"
it is "a money field or another client's milestone reaches a browser that must never see it."
That risk is carried entirely by `clientView()`'s new fifteen or so lines — everything
downstream (the component, the view wiring) is ordinary read-only rendering once the
projection is correct.

## What would send this back

- If `underScope`'s ancestry walk (already proven by every existing `clientView()` scenario)
  turns out not to be the right scoping rule for a client with more than one engagement under
  one client node — e.g. if milestones should be groupable by engagement in the UI rather than
  presented as one flat list. Not expected; the review's own mockup shows a flat list, and nothing
  in `HierarchyNode`'s shape suggests a client audience distinguishes its own engagements from each
  other differently than it distinguishes its own SOWs.
- If a `Milestone` gains a field between now and implementation that is itself commercial but
  does not obviously read as commercial from its name (the `basis`/`billOn`/`acceptedValue`
  triad, named explicitly above, is what exists today) — the projection's field list is written
  by hand, not derived by `Omit<Milestone, ...>`, precisely so that a new field on `Milestone`
  does not silently become client-visible by inheritance. This is named as a standing
  maintenance cost, not a one-time risk: reviewed at the point `Milestone` next gains a field.

## Testing

A disclosure proof, not a join proof — different from `RSC1`/`COM1`. Following the existing
sentinel-payload pattern at `scripts/scenario-validation.ts` ~2195 (which proves the same
class of claim for `milestonesOf()`'s pack line): two SOWs, one under the test client's
engagement and one under a different client's engagement, each with a milestone carrying a
`COST_SENTINEL`-shaped `amount`, one of the test client's own milestones soft-deleted. Assert,
against `clientView(...).clientMilestones` and its `JSON.stringify`:

- the surviving milestone is exactly the one under the client's own engagement — the other
  client's milestone, and the soft-deleted one, are both absent (not just filtered from a
  UI list — absent from the object the function returns);
- `amount`/`percentage`/`currency`/`basis`/`billOn`/`acceptedValue`/`rejectionNote` appear
  nowhere in the JSON string for the surviving line, proven with a sentinel value the way
  `COST_SENTINEL` proves it elsewhere in this file, not merely "not in the interface";
  and its `sowReference`/`name`/`sequence`/`plannedDate`/`delivery`/`deliveredAt`/
  `acceptance`/`acceptedAt` match the source record exactly.
- an unscoped reader (`clientScopeId: null`) gets `{}` — the same "null empties everything"
  rule `issues` already proves for `clientView()`.
