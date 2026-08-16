# Axiomate TMS — Issue Tree & Resolution Schedule

A Microsoft Project-style planning surface for the OAPIL and SLG issue log: a hierarchical
issue tree on the left, a synchronised Gantt timeline on the right, lifecycle activities,
dependencies, milestones and schedule health.

```
npm install
npm run dev          # http://localhost:3000
```

Persistence is optional. With no database the app runs from the seed file and says so in the
topbar. To save changes, put a connection string in `.env`:

```
DATABASE_URL=postgresql://user:password@localhost:5432/axiomate_tms?schema=public
```

then create the tables:

```
npm run db:push      # applies prisma/schema.prisma
```

`.env` rather than `.env.local` on purpose. Next reads both, but the Prisma CLI reads only
`.env`, through `prisma.config.ts` — and when it finds nothing there it falls back to a
localhost default rather than failing. A `DATABASE_URL` that lives only in `.env.local` will
therefore create the tables in one database and serve the app from another.

---

## Where the data came from

179 issues (OAPIL 142, SLG 37) were extracted from the consolidated v2 issue log embedded in
the Joint Resolution Board artifact, then transformed:

```
npm run transform    # data/issues.raw.json -> data/issues.seed.json
```

`scripts/transform-issues.mjs` is the only place raw data is interpreted, and it enforces the
provenance rules below. The **Data Source** tab in the app shows the same information at
runtime.

### What the log actually contains

| Field | Coverage |
| --- | --- |
| `raised` | 179 / 179 |
| `lastActivity` | 179 / 179 |
| `evidenceDate` | 116 / 179 |
| `committedDate`, `closedOn`, `committedOn` | **0 / 179** |

The three date fields that would normally supply a due date are empty in every row — they
were runtime fields of the board this data came from, not part of the log. There is **no due
date anywhere in the source**, and nothing forward-looking: the whole range is
2026-05-04 → 2026-08-13.

### How that shaped the design

Rather than invent deadlines to fill the chart, the timeline carries two distinct layers:

- **Actual (solid bars, real data)** — raised date → last recorded activity, or → today for
  an open issue. Every one of the 179 issues has this.
- **Planned (only when someone sets it)** — empty on import. Issues with no due date render as
  `Unscheduled`, which is a first-class health state rather than a default of "On Track".

Two escape hatches turn that into a working plan. Both **synthesise values**, and both are
labelled as synthesised rather than presented as recorded fact:

1. **SLA proposals** — *Show proposed SLA targets* draws a dashed, hollow target window
   (High 5 / Medium 10 / Low 20 working days from the raised date). It is a suggestion until
   the user commits it, at which point it becomes a planned date with an audit entry.
2. **Build lifecycle** — creates the five standard activities (Investigation → Root Cause
   Analysis → Corrective Action → Verification → Closure) linked finish-to-start. The log has
   no activity breakdown, so this only ever runs on explicit user action. Be clear about what
   it invents: the per-activity **dates** are an SLA window split across the phases, and the
   per-activity **percentages** are apportioned from the issue's own status-derived figure.
   Neither was reported by anyone. Generated activities therefore carry
   `origin: 'generated'` and surface as *derived* / *status-derived*, flipping to
   *user* only once someone edits or drags the row.

Derived values are labelled at the point of display:

- `% Complete` on an un-decomposed issue comes from a published status → percentage table and
  is tagged *status-derived* (italic in the grid, explained in the tooltip). Its inline editor
  opens **empty**, so a stray blur cannot silently convert a derived figure into a fixed
  user override.
- `actualEnd` for a closed issue is its last recorded activity, tagged *derived*. It is only
  rewritten when the status actually changes, and that rewrite is itself audited.
- Summary-bar tooltips distinguish a genuine rolled-up end date from "elapsed to today".
- **Critical Resolution Path** reports *insufficient data* rather than guessing when an issue
  has no dated, dependency-linked activities.

The source board's private register fields (`_partner`, `_rawAcc`, `_rawOwn`) are dropped
during transform and never surfaced.

### The Axiomate project itself

`data/axiomate.internal.json` is a second log, and a real one: the defects and limitations
found while building this application, filed in it. 39 entries — 30 defects and 9 limitations —
under client `Axiocloud`, engagement `Axiomate`, across eight process areas (Issue Tree,
Accessibility, Evidence, Data Provenance, Assistant, Configuration, Persistence, Automation).

| Status | Entries |
| --- | --- |
| Closed - confirmed | 30 |
| Open | 7 |
| In Progress | 2 |

Closed entries were fixed and verified in the build; the open ones are current limitations of
this app. It is a separate file rather than rows in the client log because it is a different
body of work with a different origin, and because keeping it apart is what stops the client
issue counts elsewhere in the app being inflated by internal work. `loadSeed` in `lib/data.ts`
appends it to the seed; missing or unreadable is not an error, because the client log has to
load whether or not it is there.

---

## Hierarchy

The tree is `Company ▸ Client ▸ Engagement ▸ Project ▸ Process Area ▸ Issue`, with sub-issues
beneath an issue, and Lifecycle Activities and Milestones beneath that.

Those five structural tiers are written down once, as `NODE_KINDS` in `lib/types.ts`.
`NodeKind`, `RowKind`, `CreatableKind` and `isGroupRow` are all derived from that array, so a
new tier is one edit rather than three lists to keep in step — which is worth insisting on
because the three lists that preceded it had already drifted apart, one of them calling the
client tier `organization` and omitting Company altogether.

Import materialises Company ▸ Client ▸ Engagement ▸ Process Area from the log. There is one
company node (`company:root`), named from the configured organisation and not offered by
`+ Add`, and one engagement per client — with exactly one engagement per client, which one an
issue belongs to is settled by the structure rather than inferred, so process areas hang off
the engagement rather than off the client. A second engagement is a `create` followed by
`Move`; nothing assumes there will only ever be one. Project is the tier nothing in the log
identifies, so it exists only once a user creates one.

`company:root` is how the firm appears *in* its own tree — a row that can be renamed or
archived. It is not the isolation boundary; that is the tenant, which the application never
edits. See *Multi-tenancy* under Persistence.

### Engagements

An engagement is the commercial and delivery envelope around a body of work: code, type,
status, start and end dates, engagement leader, project manager, client sponsor, SOW reference.
None of that is in the issue log — the log records issues, not contracts — so `lib/engagement.ts`
keeps recorded fields and derived ones apart, and all nine recorded fields ship **blank**. They
render as `Not recorded` rather than as a guess, and `recordedCount` reports how much of the
record actually exists, because a plausible invented code or sponsor would make the screen look
finished and would read exactly like a fact.

The derived half — issue counts, open/closed split, first raised → last activity, process
areas, owner count, accountable parties and status spread — is computed from the issues beneath
the node on every render and never stored, the same rule that keeps `duration` and
`scheduleHealth` out of the database. `unassignedUnder` reports issues sitting under a client
but under none of its engagements, so that state is legible rather than looking like a bug.

## Operations

Four families are kept separate in `lib/workspace.ts`, in the Prisma schema, and in the audit
log, because they mean different things:

| Family | What it changes |
| --- | --- |
| **CRUD** | create / edit / soft-delete a record |
| **Hierarchy** | where a record sits (`+ Add`, `Move`) |
| **Relationships** | business links between issues (`Link`) — no scheduling effect |
| **Scheduling** | dates, duration, dependencies, milestones |

`IssueRelationship` ("OAPIL-007 relates to OAPIL-008") and `IssueDependency`
("Corrective Action FS→ Verification") are separate tables. Merging them would make it
impossible to explain why a date moved.

The toolbar is contextual — `+ Add` offers only what is legal beneath the selected row, and
the parent is always the selection, so a parent is never chosen by hand. `Move` validates
parent type, circular hierarchy and child impact before saving. Delete is a **soft delete**:
records are archived and retained in history, and a record with children always asks whether
to archive the branch or lift the children up one level — children are never silently
cascade-deleted.

Every mutation goes through a single `dispatch` funnel, so validation and the audit trail
cannot be bypassed. Changes are visible in the **History** tab.

### Two levels of editing

| Change | Where |
| --- | --- |
| Status, severity, owner, accountable party, next action, dates, progress | **Inline in the grid** — double-click the cell |
| Subject, description, several fields at once | **Full-page focus mode** — the `Edit` button |
| Move, link, add dependency, archive, add a structural tier | Modal — each is one decision |

Clicking `Edit` opens a **full-page edit workspace**, not a side panel. A dense operational
tool shouldn't ask someone to do a focused task in a 480px column while the rest of the
screen sits dimmed and unusable.

The page carries a back bar (`← Issue Tree & Resolution Schedule`), the issue ID, an
`Unsaved changes` flag, then identity — eyebrow, large title, badges, and a context strip
(raised, last activity, lifecycle, relationships, raised by). The form is a **responsive
grid**, so a wide screen shortens the form rather than padding it:

```
1  ISSUE            (spans full width — subject and description want the room)
2  CURRENT STATE  |  3  RESPONSIBILITY
4  NEXT STEP      |  5  SCHEDULE
```

Content is capped at 1180px and centred — a full page is not licence to stretch a text input
across 1900px. Cancel/Save are pinned in a footer that never scrolls away (with an
`● Unsaved changes` indicator once the form is dirty), and `Ctrl/Cmd+Enter` saves.

Vertical space is spent where it earns its place:

- **Textareas fit their content** — 76px minimum, growing with the text to a 240px cap and
  then scrolling internally, and shrinking again when text is removed. A fixed six-row box
  spent ~120px on a one-line description and pushed the sections below it off the fold.
- **Progress uses progressive disclosure.** Automatic is the common case, so it shows the bar,
  the value on the label line, and one sentence naming the source; the slider and numeric
  entry appear only after `Override manually`, with `Use automatic progress instead` to go
  back.
- **The fact strip holds facts.** Raised / Last activity / Lifecycle / Relationships sit in a
  fixed four-cell row; `Raised context` is a separate line beneath it, because a sentence of
  narrative does not belong in a metadata cell.
- **Owner and Accountable each say what they mean** — "who is progressing the issue day to
  day" versus "which organisation is answerable for resolution" — since in this governance
  model they are different roles that frequently hold the same value.

**Context is preserved exactly.** Focus mode renders as an opaque overlay above the
still-mounted workspace, so nothing below unmounts and leaving is a pure unmount. Verified
byte-identical on return: active filters, zoom level, selected row, visible row count, detail
pane height, and all four scroll offsets (tree x/y, Gantt x/y). For the same reason the bottom
pane is deliberately *not* collapsed while editing — the user cannot see it anyway, and
resizing the split above would clamp exactly the scroll positions focus mode exists to keep.

Leaving with unsaved changes raises an in-page confirmation (`Keep editing` / `Discard`)
rather than a browser dialog, which would block the app.

There is no "Save Draft" button: the model has no draft state, and a control that appears to
save but doesn't would be worse than its absence.

### Naming

The bottom pane **inspects and manages**; focus mode **edits**. Its first tab is therefore
`Overview`, not `Details` — otherwise "Details" here and the "Edit Issue" form there read as
two routes to the same thing.

### Adaptive detail pane

The bottom pane is a third workspace region, not a footer. Its height is derived from the
viewport and from whether anything is selected, so the common path never starts with dragging
a divider. Rules live in `lib/panel.ts`:

| Condition | Result |
| --- | --- |
| Nothing selected | Compact — tabs only, 46px |
| Selected, viewport ≥ 850px | Standard, 32% of available height |
| Selected, viewport 700–849px | Standard, 24% |
| Selected, viewport < 700px | Compact — stays out of the way |
| Opening a table-shaped tab from compact | Expands to standard, so the click does something |
| Expand control | 55% of available height |

Selecting a row opens the pane; switching to Lifecycle, Relationships, Resolution Path,
History or Data Source from a collapsed pane reveals it. Explicit collapse or expand is
remembered and beats the automatic rule.

A drag is stored as a **fraction** of available height, not a pixel value, so the same
preference scales correctly between a laptop and an external display. Preferences persist in
`localStorage` and are re-clamped against the current viewport on load. The tree and timeline
always keep at least 200px.

### Inline editing

Double-click a cell to edit it in place. **Enter** commits, **Escape** abandons, **Tab** commits
and steps to the next editable cell on the row, and blurring commits (every change is audited
and reversible, so saving beats discarding a typed value).

Editable: name, owner, status, severity, accountable party, next action, start, due, duration
and % complete. Rules live in `lib/editing.ts`, not in the component.

Two deliberate exclusions:

- **Summary rows** expose only name and owner. Their dates and progress are rolled up from
  children, so typing over a derived value would silently break the roll-up — edit the rows
  beneath instead.
- **Computed columns** (ID, Type, Schedule Health, Sched. Mode, Dependency) are read-only.

An inline edit is routed through the same `dispatch` funnel as the dialogs, so it gets
identical validation and the same audit entry — the grid is a faster route to an operation,
not a way around one. Date edits additionally run the dependency and parent-constraint checks
used by bar dragging: entering a date that violates an FS link is rejected, and **the editor
stays open with the typed value intact** rather than discarding it. Clearing `% Complete` on
an issue hands progress back to the status-derived rule instead of pinning it to zero.

---

## Assistant

An `Assistant` button in the topbar opens a docked panel that can **find** an issue, **log** a
new one, or **change** an existing one from a plain description. It is a dock rather than a
modal because all three of those are things you do *while* looking at the tree.

**It never writes.** It draws a proposal card showing the exact before → after, and you press
Apply. Applying dispatches the ordinary workspace action, so validation and the History trail
are identical to editing the row by hand — the assistant only chose the arguments. Field
changes go through `updateIssue`; date changes go through `setDates`, the same action the
Gantt drag uses, and carry `Accepted from the assistant` as the audit reason.

Two engines sit behind one endpoint:

| | When | What it handles |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` is set | Natural language. Tool loop over `find_issues`, `propose_update`, `propose_new_issue` on `claude-opus-5`. |
| Deterministic | No key | Structured phrasings: `find inventory`, `OAPIL-010 status = In Progress`, `OAPIL-016 due = 2026-09-15`, `new issue OAPIL/Inventory: <subject>`. |

The panel labels which one answered, so it is never ambiguous whether the model actually ran.
To enable Claude, put a key in `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Why proposals are validated twice

The reducer does not runtime-check enums — until now every write came from a `<select>` that
could only emit legal values, so `patch: Partial<IssueRecord>` was a compile-time guarantee
that held. A model can emit `status: "Done"`. `lib/chat.ts` is the gate: it rejects (never
coerces) anything outside `ISSUE_STATUSES`, the severity and accountable vocabularies, and
real `YYYY-MM-DD` dates. The route checks, and the **client checks again on the response**
immediately before dispatch — the response body is model output, and the client-side check is
the one that actually protects the reducer. Rejections are shown rather than swallowed.

The workspace lives in the browser, so the client posts a flat catalogue of its live issues
with every turn and `find_issues` runs against that catalogue server-side. The catalogue never
enters the prompt — only the facet lists do — because a model that can already see all 180
rows stops calling the search tool and starts answering from a stale copy of them.

## Configuration architecture

The rule is: **configure the operating model, do not hardcode it.** Code depends on stable
system keys; every human-readable label attached to a key is data.

```
ISSUE_OWNER    system key     — referenced by code, never changes
"Owner"        display label  — referenced by nobody, editable
```

Renaming `ISSUE_OWNER` to "Resolution Lead" changes every screen and not one stored record:
the column heading, the filter, the form field and the assistant's vocabulary all resolve the
label at render time, while the issue keeps its id and its `owner` field. It never appears in
an audit entry as a label either — a terminology change is recorded against the system key
(`label:ISSUE_OWNER`), and an assignment change records the responsibility's label *as it read
at the time of the write* next to a record id that has not moved.

### What is configurable, and what deliberately is not

| Configurable | |
| --- | --- |
| Terminology | `LABEL_KEYS`, grouped for editing by `LABEL_GROUPS` |
| Organisation roles and the person directory | seeded roles can be relabelled, not deleted |
| Issue responsibility types | cardinality (`minCount` / `maxCount`), `required`, and which roles may fill them (`eligibleRoleIds`) |
| The accountable-party vocabulary | which organisations can be answerable for an issue |
| The agent registry, workflow composition, project templates | |
| Routing rules and mail intake | records only — see *Known limitations* |

Issue **status** and **severity** are not configurable. They are not labels: they drive derived
computation. `STATUS_PROGRESS` maps a status to a percent complete and `computeHealth` reads
both. Adding "Parked" through a settings screen would silently produce issues with no progress
and no health. The line is therefore a principle rather than an omission — **a vocabulary that
only labels an organisational fact is configurable; a vocabulary that drives computation is
not.** Making these editable means making the derivation editable too, which is a different
piece of work.

### Scope

Any configured value can be overridden per scope. The spec names Organization → Engagement →
Project → Issue; resolution does not walk that list, or any list — `scopeChainOf` walks the
*real* tree upwards from the record (Company ▸ Client ▸ Engagement ▸ Project ▸ Process Area ▸
Issue), and the nearest override wins. `ROOT`, the organisation-wide
default, is appended by the resolvers rather than by the caller, so it is always consulted and
always last. Process Area participates because it is a real tier in the data and a real place
people redefine a term: "Owner" means something different in Payroll.

The UI mirrors the same rule with nested `LabelProvider`s. The outer provider carries
organisation-wide terms, because the grid header spans every client at once and cannot show
one client's vocabulary. Everything about a single record — the detail pane, the forms, the
dialogs — sits inside a provider resolved against that record's own scope chain. Nearest wins,
in React exactly as in the resolver.

### Seeded responsibilities keep their columns

The three seeded responsibilities (`ISSUE_OWNER`, `ISSUE_ACCOUNTABLE`, `ISSUE_RAISED_BY`)
carry a `systemField` and still write to the existing `owner`, `accountable` and `raisedBy`
columns, so the grid, the filters, sorting and the assistant keep working unchanged. Custom
responsibilities live in `IssueRecord.assignments`, keyed by responsibility id, and
`readAssignment` hides which side of the split a value sits on.

Migrating everything to one assignment map would be tidier, and was rejected on blast radius:
it would touch the grid, the filters, the sort comparators and the assistant's tool schemas,
to make no visible difference to anyone using the app.

### Eligibility degrades gracefully

A responsibility can be limited to particular roles, but `checkAssignment` enforces that only
for people who actually carry a role — an unknown or unroled name passes. The imported log has
60-odd owner names and no directory behind them, so strict enforcement would reject every
existing assignment and make the app read-only until someone typed in the whole company. The
rule tightens by itself as the directory is filled in.

### The agent registry

Agents are **records, not implementations** — capabilities that workflows compose, per the
delivery architecture. 38 entries across 8 families, each with a delivery priority (`P0`, `P1`
or `backlog`) and a `runtime` of `live` or `declared`.

Exactly one is `live`: the Workspace Assistant. The other 37 are `declared`, which means the
decision has been recorded — what the agent is for, how autonomous it may be, whether a person
signs off — and nothing executes it. Every screen that renders an agent says which it is,
because a settings page that looks identical for both is a page that lies.

| Autonomy | What it permits |
| --- | --- |
| `off` | Nothing |
| `suggest` | Read and answer, never propose a change |
| `propose` | Draft changes for a person to approve |
| `act` | Apply changes directly |

`act` exists in the type so the model can express the level, but no agent in this build offers
it: acting without a person needs an execution runtime that does not exist, and shipping the
setting would be a switch that silently does nothing.

### Autonomy is enforced, not decorative

Setting the Workspace Assistant below `propose` does not grey out a button — it changes what
the model is given. `app/api/chat/route.ts` omits `propose_update` and `propose_new_issue`
from the tool list entirely, so there is no instruction to ignore and no path by which a
proposal card can be produced. `offlineReply` in `lib/chat.ts` applies the same rule to the
deterministic engine and declines the mutation in words. A policy that only hides a button is
not a policy.

The route's `parseConfig` reads an unrecognised or missing autonomy value as `suggest`, so a
malformed request loses the ability to propose rather than gaining it.

### Configuration is an operation

Configuration changes go through the same `dispatch` funnel as everything else, as a `config`
action family alongside CRUD / Hierarchy / Relationships / Scheduling with a `ConfigOp` union
of its own. Changing what "Owner" means therefore lands in the **History** tab with the same
from → to shape as moving a bar.

With no database configured, the model is mirrored to `localStorage` (`saveModel` /
`loadModel`). That session's workspace is in-memory, but configuration is not workspace data —
it is the shape of the workspace, and a renamed label that vanishes on refresh reads as broken
rather than as unsaved. With a database the mirror is switched off and Postgres owns the
model; see *Persistence* below. The stored copy is **merged over the current seed**, not
substituted for it, so a model saved before a label key or an agent existed does not silently
drop it. `mergeAgents`
goes further: `runtime` and `maxAutonomy` always come from the seed and never from storage,
because they describe what the code can do, and a stale record must not be able to claim a
capability this build does not have.

## Persistence

The server does not have a second set of rules. It loads the workspace, runs **the same pure
`apply()` the browser ran**, and writes down what changed. The reducer has been the single
funnel every mutation goes through since the first commit, so re-implementing its validation
and its audit entries in SQL would be the fastest available way to make the two disagree.

What gets written is **targeted, not a full-state diff**. Every action names the records it can
possibly touch, so the `writeAction` switch in `lib/db/persist.ts` mirrors the reducer's own
arms — a 200-row rewrite per committed cell edit is not a persistence strategy. Two families
legitimately write many rows. The lifecycle arms are one: `buildLifecycle` creates a batch of
activities and the dependencies between them, and `clearLifecycle` removes them (dependencies
fall with their activities via `onDelete: Cascade`). `softDelete` / `restore` are the other,
because archiving touches a whole subtree; they find their rows by **object-identity
comparison** between the two states, which is a sound test only because the reducer is
immutable throughout — an untouched record is the same object in both states, and a touched one
is always a fresh copy.

**The UI is not blocked on the database.** `dispatch` stays synchronous and the write is
queued rather than awaited, because its callers depend on the synchronous return: `applyProposal` reads
the folded state back in the same tick to reveal the row it just created. Making the write
awaitable would mean rewriting every call site to handle a promise, for a confirmation the UI
has no reason to wait on. The consequence is stated rather than hidden — the database is
written *behind* the UI, so a rejected write surfaces as an error toast after the fact and asks
the user to reload. It cannot silently diverge: the server runs the same reducer, and
`app/api/workspace/route.ts` returns the reducer's own rejection rather than a generic failure.

### Ids are supplied by the application

`client:OAPIL`, `module:OAPIL:Inventory` and `OAPIL-143#7` are not opaque keys. `moduleNodeId()`
constructs them in order to look a record up, and configuration scope overrides are keyed on
them, so a database-generated cuid would silently detach every scope override and send a
chat-created issue to the wrong parent. `@default(cuid())` survives in the schema only as a
fallback for rows nothing constructs by hand.

That is why `WorkspaceMeta.seq` had to be persisted. `seq` mints `engagement:5`, `OAPIL-143#7`,
`ev-12`, `dep-9` from a counter that lives in memory for one process and would restart at 1 on
every boot — handing out ids that collide with records already stored. Contrast `nextIssueId`,
which derives the next issue number from the highest existing number for that prefix and
therefore self-heals on any restart, archived issues included. `seq` does not self-heal, so it
is stored.

`ScheduleAudit.id` runs the other way and is left to the schema's `@default(cuid())`:
the app's own `aud-3-OAPIL-010` counter restarts every session and would collide on a primary
key across restarts, so `auditToRow` deliberately omits the id and lets the default mint it.

### Multi-tenancy

Those ids follow a second rule, and it follows from the first rather than being a separate
choice: an application-supplied id is unique **within one tenant**, not globally. Two firms
running Axiomate both have a `company:root`, both mint `rel-1`, `dep-1` and `ev-1` from their
own counter, and both may serve a client coded `OAPIL`. So the tenant is part of every key.
`Tenant` is a table of its own; every other table carries `tenantId`; the primary key of each
is `(tenantId, id)` (`(tenantId, nodeId)` for `Engagement`); foreign keys are composite and
carry the tenant across with them; and every uniqueness constraint and index is scoped by it.
`OperatingModel` and `WorkspaceMeta` are keyed by tenant rather than by a row literally called
`singleton`, which was a hardcoded assertion that only one workspace could exist. A tenant that
owns records is suspended with `deletedAt`, never dropped — the relations are `onDelete:
Restrict`, so deleting a firm cannot take every issue anyone filed under it with it.

`lib/tenant.ts` holds the seam. `TenantId` is a branded string, and every function in `lib/db`
takes one as its first argument with no un-scoped alternative to reach for, so "remember to
filter by tenant" is a compile error rather than a convention — the same move as `isNodeKind`,
for the same reason. `currentTenantId()` is the single place resolution happens: today it reads
`AXIOMATE_TENANT` and defaults to the `axiocloud` slug, and it **throws** on a malformed value
rather than falling back, because quietly serving the default tenant to a request that asked
for a different one is precisely the failure the boundary exists to prevent and would be
invisible. `provisioningName()` supplies the name written when a tenant row is first created;
`OperatingModel.organization.name` is the configured name and supersedes it wherever it exists,
so renaming the firm never orphans the rows filed under it.

**This is a tenant-scoped data model, not enforced isolation, and the distance between the two
is identity.** Authentication now exists — Entra ID sign-in, in `lib/auth/` — and it activates
only when four environment values are set. Even with it on, `currentTenantId` still reads one
configured value rather than deriving a tenant from the person who signed in: knowing who
somebody is and knowing which firm's data they may see are different questions, and only the
first is answered. Nothing in the schema stops a
query that forgets its `where` either; the compiler does that, and the database does not. The
enforcement layer is row-level security, and RLS needs a database role per request, which needs
identity — so it arrives with identity, not before it. The scoping is done first because it is
the expensive half to retrofit, not because tenancy is finished.

### Derived values are not stored

`duration`, `scheduleHealth` and `projectedCompletionDate` had columns here and were removed.
Nothing in the reducer produces them — they are recomputed from dates and status on every
render — so a stored copy is a stale computation wearing the costume of a recorded one. That is
the same provenance rule the rest of this document runs on: a value is recorded fact, or it is
labelled as derived. A database column is the strongest claim of recorded fact this system can
make, so a derivation must not have one. The same reasoning removed evidence's source-document
columns; `detectSourceDocument()` derives that from the subject and reference at render time,
and a stored copy would freeze a derivation its inputs can outgrow. `% Complete` already worked
this way and still does: `percentOverride` is written only when a user overrides the
status-derived figure, and null means "derive it".

Evidence *records* are written; the files are not. A `blob:` URL is a handle into one browser
session's memory, so `evidenceToRow` stores `null` rather than a link that is already dead by
the time anyone reads the row.

### Two schema changes the configuration work forced

`Issue.accountable` is a `String` rather than an enum. The accountable-party vocabulary is
user-configurable (`OperatingModel.parties`), so an enum here would have the database rejecting
any party someone adds through the screen that invites them to add it.

The operating model is **one JSONB document row**, deliberately. It is small, it is edited
wholesale, and the app already serialises exactly that shape for `localStorage`. The tradeoff
is real and worth stating: there is no referential integrity between the `overrides` keys and
`HierarchyNode.id`, so a deleted node leaves an orphaned override behind. Resolution ignores
overrides for scopes that no longer resolve, so the effect is dead weight rather than incorrect
behaviour. The other half of the same decision is that any configuration change rewrites the
whole document — accepted, because the alternative is eleven tables for something one person
changes a handful of times.

### Three boot outcomes, each visible in the UI

A `Saved` / `Not saved` indicator sits in the topbar with the reason in its tooltip. A tool that
silently drops from "your edits are saved" to "your edits are not saved" is worse than one that
never offered saving.

| On boot | What the app does |
| --- | --- |
| No `DATABASE_URL` | In-memory session from the seed file; the tooltip says how to enable saving |
| Database reachable | Workspace served from Postgres, with a one-time import of the seed log |
| Configured but unreachable | Falls back to the seed file and says so, rather than failing the page |

The import is guarded by `WorkspaceMeta.seededAt` — a timestamp, not a row count — so a
workspace someone has deliberately emptied is not silently refilled on the next boot. Import is
a one-time event with a recorded time, not a reconciliation. `loadWorkspace` reports issues
whose parent column points nowhere in the same tooltip ("*N* issues have no parent and are not
shown in the tree") rather than silently rehoming them.

### localStorage and the database do not both own configuration

With a database, the local mirror is switched off entirely, in both directions. Reading it would
let a stale browser copy overwrite what another session saved; writing it would leave two stores
disagreeing about what "Owner" is called. The mirror exists for the no-database mode, and only
for that.

## Layout note

The tree grid and the Gantt are independent horizontal scroll containers sharing one vertical
axis, mirrored in JS. Every row height in both panes comes from `ROW_H` in `lib/layout.ts`;
if those ever diverge the two panes stop lining up, so that constant is the single source of
truth for row geometry.

## Structure

```
app/page.tsx              server component; boots persistence, resolves "today"
components/
  IssueWorkspace.tsx      state owner, dispatch funnel, scroll sync
  TreeGrid.tsx            frozen columns, resize/reorder/sort
  GanttChart.tsx          bars, dependency connectors, milestones, drag scheduling
  SelectionToolbar.tsx    contextual actions
  Dialogs.tsx             add / edit / move / link / dependency / archive
  DetailPanel.tsx         Details, Schedule, Lifecycle, Relationships, Resolution Path, History, Data Source
  ChatPanel.tsx           assistant dock; proposal cards, apply/dismiss
  ConfigWorkspace.tsx     settings screen: terminology, roles & people, responsibilities, agents, workflows, routing, scope overrides
  labels.tsx              terminology context; nested providers resolve per scope
app/api/
  chat/route.ts           assistant endpoint; Claude tool loop + deterministic fallback
  workspace/route.ts      the write endpoint; replays one action against stored state
lib/
  types.ts                the tier vocabulary (NODE_KINDS) and the domain types derived from it
  tenant.ts               TenantId, currentTenantId — the one place a tenant is resolved
  workspace.ts            records + reducer; the four operation families
  engagement.ts           engagement detail: recorded fields vs facts derived from the log
  config.ts               the operating model: system keys vs labels, roles, responsibilities, agents, scope resolution
  chat.ts                 assistant contract: tool schemas, validation gate, search, offline engine
  tree.ts                 row hierarchy, roll-up, filtering
  schedule.ts             health, roll-up, SLA proposals, critical path, drag validation
  timeline.ts             zoom scales and header bands
  db/
    client.ts             lazy Prisma client; whether a database is configured at all
    map.ts                row ↔ reducer shapes, both directions; dates pinned to midnight UTC
    repo.ts               load the whole workspace; one-time import of the seed log
    persist.ts            apply one action to stored state, write the records it touched
    boot.ts               the three boot outcomes
  dates.ts  layout.ts  columns.ts  sort.ts
prisma/schema.prisma      durable model
prisma.config.ts          where Prisma 7 reads DATABASE_URL from
```

## Verified behaviour

A full round-trip was executed against the running app, not just opened as dialogs:
create Process Area → create issue beneath it (auto-allocated `OAPIL-143`) → move the issue
to Finance → archive the now-empty Process Area. All four steps appear in the History tab
with timestamps and from → to values. Row alignment between the two panes is pixel-exact
(204 rows, identical offsets), vertical scroll syncs in both directions, and roll-up badges
reconcile with the header counts under an active filter (37 + 17 = 54 of 180 at Severity =
High).

## Evidence & documents

Evidence is a first-class domain alongside Schedule and Lifecycle, not an attachment widget.
Three things that look alike are kept apart, because they answer different questions:

| Concept | Question | Where |
| --- | --- | --- |
| **Data Source** | Where did this *record* come from? | Data Source tab |
| **Source artifact** | What file was this issue raised *from*? | Top of the editor, and the Evidence panel |
| **Evidence** | What material supports the issue? | Evidence tab, Evidence panel |
| **History** | What happened to the issue? | History tab |

**Snapshot vs document** are also distinct. A snapshot is point-in-time proof and carries a
purpose — *Before fix*, *Investigation evidence*, *Resolution evidence*, *Client
confirmation* — which is what makes a screenshot auditable rather than just an image. A
document is a supporting artifact (Excel, PDF, spec, email export). Links are a third kind.
Files route to a category automatically by extension; images become snapshots.

**Source traceability.** Many rows name their originating file in the subject — e.g.
`Updated sheet of current points. — ERP_Go-Live_Pending points_210726.xlsx`. That string is
really in the source data, so it is surfaced as the issue's source artifact. It is labelled
**detected in the issue subject · file not held by this app**: the log has no attachment
field, so the app must not offer to open something it does not have.

The log's own `evidence` field is a **quoted snippet**, not a file, and is shown as such
rather than being dressed up as an attachment.

**Where each job happens.** The full-page editor gets section ⑥ — four category counts, the
latest item, and a way in — so it stays a form rather than becoming a document library.
Managing files happens in a right-side panel: the shape that was wrong for editing is right
for inspecting a list with the issue still visible behind it. Attachments go through the same
audited `dispatch` funnel as every other change, so `Attached "…"` appears in History.

> Files are held in the browser session only. There is no upload backend yet, so they are lost
> on reload — the panel says so rather than implying storage that does not exist.

## User context

The header carries `Nishant Sekhar · 14 Aug 2026 · 4:26 pm IST`, live and self-updating.

- Rendered **only after mount** — formatting a time during SSR would both trip a hydration
  mismatch and briefly show the *server's* clock as if it were the viewer's.
- Ticks on the **minute boundary** rather than polling every second, since minutes are the
  smallest unit shown.
- Progressive collapse: the date drops below 1500px and the zone below 1180px, leaving
  `Nishant Sekhar · 4:26 pm`. The full weekday form stays in the tooltip.

Identity lives in `lib/session.ts` as a single `CURRENT_USER`, standing in for authentication
that does not exist yet — one place to replace when it does. The same constant is the actor
recorded in every audit entry, so the header and History can never disagree about who acted.

The timezone abbreviation comes from `Intl`, not a hardcoded string: browsers only emit "IST"
for locales where that is the convention, and the same zone renders as "GMT+5:30" under
`en-US`. `CURRENT_USER.locale` is therefore explicit (`en-IN`); set it to `null` to follow the
viewer's device instead.

## Keyboard and screen readers

The whole app is operable without a mouse.

**Tree grid** — `role="treegrid"` with `role="row"` children carrying `aria-level`,
`aria-selected`, `aria-expanded` and `aria-rowindex`; cells are `role="gridcell"` with
`aria-colindex`. A **roving tabindex** gives the grid one tab stop rather than one per row.

| Key | Action |
| --- | --- |
| ↑ / ↓ | Move selection |
| Home / End | First / last row |
| → | Expand, or step into the first child if already open |
| ← | Collapse, or step out to the parent |
| Enter / F2 | Edit the first editable cell |
| Space | Select the focused row |

Arrow handling lives on the grid, not on `window`. On `window` it fired wherever focus
happened to be and — more to the point — nothing could put focus on the grid at all, so a
keyboard user could never select a row. Since selection gates every toolbar action, that one
gap made the entire app keyboard-inoperable.

**Timeline** — bars, summary brackets and milestones are real `<button>`s with descriptive
`aria-label`s (`"Corrective Action: 27-Jul-2026 to 30-Jul-2026, 4 days, 0% complete, Blocked"`),
not hover-only `title` text. Only the **selected** row's bar is a tab stop, so Tab moves from
the grid straight to the matching bar instead of walking hundreds of elements. On a focused
bar, ← / → reschedule by a day and Shift + ← / → change duration — routed through the same
commit path as dragging, so dependency validation and the audit trail still apply. The elapsed
bar is `role="img"` because recorded history is not reschedulable; purely decorative layers
(progress fill, hatching, end caps, labels) are `aria-hidden`.

**Overlays** — focus mode and the modals are portaled to `document.body`, set `inert` on the
app shell, trap Tab/Shift+Tab, take `aria-labelledby` from their own heading (so the issue is
announced by name), and restore focus to the control that opened them.

A `:focus-visible` ring is defined once and applies throughout; it stays off mouse clicks so a
dense grid does not light up on every press.

## Known limitations

- **The Postgres read and write path has never been executed.** No working `DATABASE_URL` was
  available in the environment this was written in. The schema is `prisma validate`-clean, the
  client generates, the mapper's conversion was exercised in both directions in-process, and
  the no-database path was verified in the browser — but every actual database read and write
  is typecheck-only, the same standing as the assistant's Claude branch below.
- Authentication exists and is off unless configured. Entra ID sign-in is built, and once a
  provider is set the write endpoint refuses an unverified request; without one the app runs as
  the configured operator, and the permissions screen says which of the two it is. What has not
  happened is a deployment with it switched on. Concurrency between writers *is* handled —
  `persistActions` runs the load and the fold inside one `Serializable` transaction and retries
  up to three times on a serialization failure, so a batch that would have interleaved replays
  against what the winner produced rather than overwriting it. What is still missing above that
  is per-user conflict reporting: two people editing the same field produce two valid, audited
  writes and the later one stands, whether or not either signed in.
- Tenant isolation is not enforced. Every table is tenant-scoped and every query names a
  tenant, but nothing establishes which tenant a request belongs to, because that needs
  identity — and row-level security, the layer that would enforce it, needs identity too. See
  *Multi-tenancy*.
- Writes are queued, not fire-and-forget: `useAutosave` drains a serial FIFO queue one request
  at a time with exponential backoff, batches what accumulates, and flushes on page hide via
  `sendBeacon`. The gap that remains is recovery, not delivery — after the retries are
  exhausted the queue halts and the user is asked to reload. There is still no automatic
  resync, because reconciling a diverged client against stored state needs a conflict model
  this does not have.
- The schema has a baseline migration (`prisma/migrations/20260815000000_init`) and
  `db:migrate` scripts, but it has never been applied: no `DATABASE_URL` has been available.
  `db:push` remains for throwaway databases. Treat the migration as reviewed, not as run.
- The Critical Resolution Path uses a forward pass over binding constraints rather than a full
  forward/backward float calculation, so an activity with calendar slack (e.g. a weekend gap
  before its successor) is correctly excluded from the chain but no explicit float figure is
  reported per activity.
- Dependencies can currently be drawn only between activities of the same issue.
- The assistant's Claude branch is type-checked and built but has not been executed — no
  `ANTHROPIC_API_KEY` was available in the environment it was written in. The deterministic
  branch, the validation gate, and the whole apply path were exercised end-to-end in the
  browser against the real log.
- The assistant can find, create and update. It deliberately cannot delete, archive, move,
  link, or change dependencies — those stay in the tree, where the confirmation and the
  consequences are both visible.
- Routing rules and mail intake are configuration records only. Nothing reads a mailbox and
  nothing applies a rule: there is no backend and no scheduler to run one on. The screens
  create, edit and audit the records, and that is all they do.
- 37 of the 38 registered agents are `declared` — the decision is recorded, the implementation
  is not written. Only the Workspace Assistant runs today.
- The issue status and severity vocabularies are fixed, for the reason given under
  *Configuration architecture*: they drive `% Complete` and schedule health, so making them
  editable means making the derivation editable too.
