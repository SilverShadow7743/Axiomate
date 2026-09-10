# The F&O page grammar — Axiomate's shell reshaped to the patterns its users already know

**Status: approved, 10 September 2026** (three decisions taken by Nishant in review, recorded
below). User's direct request — *"a design pattern like D365 F&O has"*, following the brand-voice
work on the email signature. Not built.

## What was asked, and how deep it goes

Axiocloud's consultants live in Dynamics 365 Finance & Operations all day. A delivery tool that
uses F&O's page grammar — its list pages, details pages, action panes, FactBoxes and workspaces
— costs them nothing to learn and reads as finished to the people they work beside. **Decision 1
(Nishant, 10 Sep): adopt the page grammar, not the skin.** F&O's structural patterns on
Axiomate's existing tokens, red accent and typography; no Fluent restyle, no lifted-card
shadows, no gray action pane. F&O's own 2018 Fluent restyle deliberately keeps theme colour out
of the action pane, so the brand and the grammar were never in conflict.

Grounded in Microsoft's own pattern documentation, read rather than recalled: the List Page,
Details Master/Transaction, Workspace and FactBox form patterns, Navigation concepts, and the
General Form Guidelines all the pattern pages defer to
(`learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/user-interface/…`). Every rule cited
below is one of theirs.

## What already exists — the shell is F&O-shaped under different names

`docs/design/navigation-model.md` records four navigation patterns; `screen-inventory.md` lists
the screens (as of 31 Aug — it names nine views, the shell now has twelve: Analytics,
Applications and People shipped since). The mapping is close:

| F&O element | Axiomate today | Gap |
| --- | --- | --- |
| Navigation pane (Favorites / Recent / Workspaces / Modules) | Primary rail, `AppSidebar`, four groups by "whose question" | None structural. Favorites/Recent are a later addition, not this design. |
| List page — quick filter above the grid, focus in it on open, first column a link to details, <15 columns, plural title | Tree, Board, Timesheets, People, Applications grids; Filters chip; global search in the top bar | No quick filter *on the grid*; first column is not consistently the link; titles are not consistently plural. |
| Details page — action pane, `ID : Description` title, entity status upper-right, FastTabs with the first fully visible | `DetailDrawer` + `DetailPanel` with a horizontal tab bar (`TABS`, assembled per row kind — `DetailPanel.tsx:375`) | Tabs, not FastTabs; no record-level action pane; status is a field, not pinned. |
| Action pane — whole-entity actions at the top, ≤10 tabs, 1–8 actions per group, local toolbars for parts | Top bar's one-primary-action rule (global); per-panel buttons inside the drawer | Nothing at the *record* level gathers the record's actions. |
| FactBox pane — related information on the right, collapsed as a "Related information" blade | Nothing; related data is inside the drawer's tabs | A genuinely new element. |
| Workspace — tiles + tabbed lists + related links, 0–5 filters, page title a noun phrase | My work (a ranked list); Portfolio (concern lines); Configuration (a rail of sections) | No workspace surface; the home page is a list. |
| Filter pane — slides in from the left, pill filters | Filters chip collapsing eight facets in place, pre-expanded when any is set | A choice, not a gap — see below. |

## The shape

### 1. List pages

Every grid view gains F&O's list-page discipline, applied to what is already there:

- A **quick filter** directly above the grid, defaulting to the field a person most often narrows
  by (subject for Tree/Board, name for People, application name for Applications), with focus in
  it when the view opens. The Filters chip stays for the other facets — F&O's own guideline caps
  custom filters at five and prefers a pre-populated pane; the chip is Axiomate's equivalent, and
  it already pre-expands exactly when something is set. **The left-sliding filter pane is not
  adopted**: the chip does the same job without hiding the grid.
- The **first textual column is the link** to the record — the F&O "default action" — everywhere,
  not only where it happens to be today.
- **Page titles in the plural** — Issues, People, Applications — where the tier vocabulary allows
  (`lib/config.ts` terminology overrides still win; a firm that renames "Issue" renames the
  title).

### 2. Details pages — the drawer becomes a details form

`DetailPanel`'s tab bar becomes **FastTabs**: stacked, collapsible sections in the same order the
tabs are assembled today, each header carrying one or two summary values (F&O's own rule —
"FastTabs should display summary information"), the first section fully visible without
scrolling. The tab *set* per row kind is unchanged; only its presentation is.

The drawer header becomes the F&O **page title area**: `<ID> : <Subject>` on the left, the
**entity status pinned upper-right** (F&O: "the entity status must appear in the upper-right of
the form, to the right of the title fields"), and beneath it a **record-level action pane** —
the actions that apply to the whole record (status transition, assign, escalate, archive,
convert), gathered in one row instead of scattered across panels. Actions that apply to a part
of the record (add a note, upload evidence, add a checklist item) stay as **local toolbars** on
their own FastTab, which is F&O's rule verbatim: "never put actions that apply only to portions
of the entity on the Action Pane."

The top bar's one-primary-action rule is untouched — it governs the *global* bar. The record
action pane has its own single primary (the most likely next transition), which is the same rule
applied one level down, not an exception to it.

### 3. The FactBox blade — the one new element

A right-edge **Related information** blade on every list page and inside the details drawer,
collapsed by default to a labelled edge tab (F&O post-PU20 idiom), opening to a column of
FactBoxes for the selected record. Two FactBox shapes, both F&O's: a **card** (a set of related
fields) and a **grid** (a child collection, capped at five rows with a "More" that opens the full
list).

For an issue: *Owner* card (name, title, current leave caveat from `ownerLeaveCaveat` — the same
function I14 already ships), *Schedule* card (planned/actual, SLA target, health), *Related
records* grid (linked change request, duplicates, dependencies), *Recent activity* grid (last
five notes). Every FactBox reads an existing pure function; **none introduces a new
computation** — the same constraint the dashboards design placed on widgets, kept here for the
same reason.

### 4. Workspaces — the home page, and Portfolio

**Decision 2 (Nishant, 10 Sep): reopen the 7 Sep dashboards decision.** That design refused
tiles and a blended score, in writing, for the second time; it was never built (no
`DashboardLayout` model exists). Reopening it is recorded here as a decision with its reason,
not slid past.

The home page becomes an F&O **operational workspace**: a *Summary* section of count tiles, a
*tabbed list* section, and *related links*. The tiles are the counts strip made clickable — "8
overdue", "6 blocked", "11 done", "75 unscheduled" — each opening the list filtered to exactly
those records, which is what an F&O tile is (a count with a query behind it). No tile carries a
number that is not already computed by a shipped pure function (`lib/mywork.ts`, `lib/tree.ts`'s
counts, `lib/portfolio.ts`'s concerns).

Portfolio becomes a workspace too: one tile per engagement carrying its **health score** — the
part of this design that reverses `lib/portfolio.ts`'s own header, and is treated below at the
length that reversal deserves.

### 5. The engagement health score

**Decision 3 (Nishant, 10 Sep): a health score exists, because clients expect one in the packs.**

`lib/portfolio.ts:17` says "There is no health score, and there will not be one," and gives its
reason: *"a score is a sentence about weights nobody can see, and the weights are exactly what a
partner would want to argue with."* That objection is not overruled here — it is the design
constraint. A score is admissible on exactly these terms:

- **Components are the six named concerns that already exist** (`CONCERN_ORDER`: overdue,
  forecast, capacity, blocked, unowned, stale — each a plain count, each checkable against the
  tree in one click). The score introduces no new measurement.
- **Weights are configuration, not code.** A new Configuration section, *Health score*, holds one
  weight per concern kind and the two RAG thresholds, shipped with defaults and edited through a
  config op like every other threshold (`setSlaThresholds` is the precedent). The weights are the
  argument; they are now the firm's to have, in the open.
- **Every rendering prints its working.** Beside the number: `Overdue 3 × 2 + Blocked 1 × 1 + …
  = 7`. A score that cannot be read back into its parts is exactly the hidden sentence the header
  refused; one that always shows them is a summary of visible facts.
- **The client-facing score uses only client-safe components.** The packs are built on
  `clientView()` (`lib/reports/clientPack.ts` header), which withholds allocations and project
  membership — so the *capacity* concern cannot be computed for a client and is excluded from the
  pack's score, and the pack says so with the same `{shown, total}` disclosure line it already
  prints for records. Money stays out, as Portfolio already keeps it out.
- **The score is derived at render, never stored** — the rule every report in `lib/reports/`
  already follows, so it cannot drift from the tree behind it.

`lib/portfolio.ts`'s header is rewritten to record this: the refusal, the reason it was reopened
(client packs), and the conditions under which a score was admitted. The `mywork` lesson the
header tells — a "no priority score" that silently weighted severity at zero — is exactly why the
weights are printed.

## Non-goals

**The Fluent skin** — lifted cards, gray action pane, pill filters, tile artwork. Decision 1.
**Navigation-pane Favorites/Recent** — real F&O features, deferred; the rail's four groups stand.
**The left filter pane** — the chip is kept, see §1. **A score anywhere but engagements** — no
per-issue or per-person score; the concerns model is engagement-level and this design does not
widen it. **Custom formulas or per-person thresholds** — the weights are one firm-wide
configuration, which is what keeps them arguable rather than private.

## What would send this back to the design

- If the FastTab conversion makes the first section not fit without scrolling on a 720px drawer
  for the commonest row kind — F&O's rule is exact and this design inherits it; the fix is fewer
  summary fields, not a scroll.
- If a FactBox needs a computation no pure function already provides — build the function under
  its own module's doctrine first, as the dashboards design required of widgets; do not compute
  inside the FactBox.
- If the client-safe component subset produces a score materially different from the internal
  one for the same engagement — that is a real disclosure question (two numbers for one
  engagement) and needs a decision on which the pack shows and how it says so, not a quiet pick.
- If the record action pane ends up with more than one primary action per row kind — the
  one-primary rule is load-bearing at both levels; a second primary means the transition model,
  not the pane, needs looking at.

## Related

- `docs/design/navigation-model.md` — the four patterns this design reshapes; its decision table
  told a shell-wide pattern change to "stop and reopen the design", which this is.
- `docs/design/screen-inventory.md` — nine views listed, twelve shipped; refreshed as part of the
  plan.
- `docs/plans/2026-09-07-dashboards-design.md` — the decision reopened in §4–5.
- `docs/plans/2026-08-25-client-pack-design.md` — the client boundary the pack score inherits.
- `docs/plans/2026-09-07-hive-comparison.md` — the previous competitor-pattern pass.
