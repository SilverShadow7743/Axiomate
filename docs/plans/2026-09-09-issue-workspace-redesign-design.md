# The issue detail panel reads like a database form — closing the gap

**Status: draft, 9 September 2026.** Nishant pasted a UX critique of the issue detail panel
(source not this codebase — written against generic mockup screenshots, not against
`DetailPanel.tsx`/`OverviewTab.tsx` as they actually are) and asked for a full design doc
before any code. This reconciles that critique against what is actually built — some of it
holds, some of it doesn't apply, and one structural premise it assumed is wrong.

## What exists today — read directly from the code, not assumed

**The panel is bottom-docked, not a right-side pane.** This is the load-bearing correction: the
pasted critique's central layout recommendation was a three-column width ratio (nav 15% / tree
35% / detail 50%). That doesn't apply here. `.main { flex-direction: column }`,
`.detail { flex: 0 0 auto; border-top }`, `.detail-grip { cursor: row-resize }`
(`app/globals.css:215-1462`) — the tree/grid sits on top, full width, and `DetailPanel` docks
below it, resized by dragging its **height**, not shared with the tree horizontally. It already
has three explicit size states (`compact` / `standard` / `expanded`, `panelState` prop) with
one-click controls (`▲`/`▼` collapse, `⤢`/`⤡` expand) — `DetailPanel.tsx:530-562`. There is no
width ratio to fix because there is no horizontal split.

**A pinned KPI-style header already exists**, and its own comment states the exact
reasoning the critique arrives at independently: *"The record's vital signs, pinned above every
tab. They lived only inside Overview's edit mode, four clicks from the Time tab — and the
fields a delivery manager touches most must never be more than one click away, whichever tab is
open."* (`DetailPanel.tsx:565-570`). `FieldStrip` renders Status / Owner / Due date / Severity
above the tab body on every tab, for every issue, not buried in a form. This was evidently
already built in response to the same diagnosis. What it does NOT have: a visual priority
hierarchy (all four fields are plain `<select>`/`<input>` controls, none styled as a status
pill or badge) and no title. The row's name appears only as small text on the right of the tab
bar (`{row.displayId || row.name} · {row.type}`, `DetailPanel.tsx:526-528`) — genuinely
undersized for what should anchor the screen. **This part of the critique is real.**

**The Overview tab is a flat `<dl className="kv">` list**, and it is exactly the "database
record" the critique describes. `OverviewTab.tsx:814-995`: two consecutive `<dl>` blocks —
Issue / Subject / Description / Source artifact / Tier / Type / Severity / Status / Exposure,
then Owner / Raised by / Accountable / Next action / Start-Due / Raised / Last activity /
Progress / Lifecycle / Relationships — twenty-odd label/value rows, Subject and Description
sitting among them as two more `<dt>/<dd>` pairs, no visual distinction from `Source artifact`
or `Exposure`. **This part of the critique is real.**

**Description renders in full, uncollapsed**, every time (`OverviewTab.tsx:819-833`, a
`RichTextEditor` in read-only mode with no length cap or "show more"). **Real.**

**The three communication actions (Reply to client / Schedule a meeting / Message on Teams)
are three full `<section className="appr-block">` blocks**, each with its own `<h4>`, each
rendered whether or not the person is about to use it (`OverviewTab.tsx:583-810`) — collapsed
to a single button until clicked, but the button itself, plus its section chrome, costs three
full-width rows before anything happens. **Real, and the fix is close to free**: they already
collapse to one line each when not in use; the ask is to put those three lines in one row
instead of three.

**Eleven tabs, confirmed**: `TABS = ['Overview', 'Checklist', 'Skills', 'Fields', 'Notes',
'Discussion', 'Estimation', 'Time', 'Schedule', 'Links', 'History']` for an issue
(`DetailPanel.tsx:365-366`) — this is also I24's own finding (9 Sep), which already shipped a
fade-gradient + scroll affordance for the overflowing tab bar rather than reducing the count.
**Real**, and this design doc is where the reduction I24 didn't attempt gets scoped.

**The "Time" KPI panel the critique wants is nearly free.** `lib/time.ts`'s `effortVariance()`
already returns `{ estimated, actual, varianceHours, variancePct, againstBaseline }` — exactly
estimate/logged/remaining/progress, correctly distinguishing "no estimate" from "zero" (a null,
not a zero, when nothing has been estimated — `lib/time.ts:178-184`'s own comment is explicit
about why that distinction matters). It is already called from both `EstimationTab.tsx:114` and
`TimeTab.tsx:110`, just never surfaced anywhere more prominent. **Building the KPI strip means
reading a value that already exists, not computing a new one.**

**No "Next Best Action" or "Delivery Risk" data exists anywhere.** Nothing in `lib/` computes a
risk score, a recommended next action, or any comparable inference. Building the critique's
proposed insight cards as literal text ("⚠ Delivery risk: Medium") would mean inventing a
number this codebase has never computed and has no stated method for — directly against this
repo's own operating principle 2 ("never invent information"). **Flagged as a real idea with no
supporting data today, not built, not designed further here** — see Non-goals.

## Shape — three tiers, by what each actually costs

### Tier 1 — cheap, low-risk, ready to build now (CSS/layout only, no new data, no reducer change)

1. **A real title.** Promote the row's name to a heading above the tab bar (or directly above
   `FieldStrip`) — a genuine `<h2>` reading `{issue.subject}` with `{row.displayId} · {row.type}`
   as a smaller subline underneath, replacing today's small right-aligned `idtag`. The subject
   already exists on every issue; this is a rendering change only. **Shows in `compact` state
   too** — `FieldStrip` is gated on `panelState !== 'compact'` (`DetailPanel.tsx:568`) and stays
   that way, but the title sits above that gate alongside the tab bar, so a collapsed panel
   still names what's selected instead of showing only tabs and a one-line hint
   (`DetailPanel.tsx:578-589`).
2. **Severity becomes a colored tag, not a plain `<select>`.** Checked, not assumed: a real
   palette already exists and is already live elsewhere — `--sev-high`/`--sev-medium`/
   `--sev-low` (theme-aware, `app/globals.css:46-146`) driving `.sev-High`/`.sev-Medium`/
   `.sev-Low` (`app/globals.css:1033-1040`). Reuse it directly; this is a restyle of an existing
   control, not a new decision.
3. **This design doc resolves I24's flagged duplication, rather than leaving it open.** I24
   (9 Sep) flagged the header strip and the Overview `<dl>` both showing Status/Owner/Due
   date/Severity as "a real design decision, not built." Checked precisely against
   `OverviewTab.tsx:814-995` rather than assumed — the exact overlap is narrower than "four
   fields": `Subject` (`:817-818`, redundant against item 1's new title), `Severity`
   (`:866-870`) and `Status` (`:871-872`, both redundant against `FieldStrip`/Tier 2's status
   pill), and `Owner` (`:942-943`, redundant against `FieldStrip`'s own Owner). **These four
   rows come out of the `<dl>`.** `Start Date / Due Date` (`:950-957`) stays — it is one combined
   row carrying Start Date, which `FieldStrip` does not show, so removing it would lose
   information, not just de-duplicate it. `Raised by` and `Accountable` (`:944, :946-947`) also
   stay — neither appears in `FieldStrip` at all. What the `<dl>` keeps overall: `Issue` (the id,
   `mono`-formatted, distinct from the title), `Description`, `Source artifact`, tier/type/
   exposure, `Raised by`/`Accountable`/`Next action`/`Start-Due`, and `Raised`/`Last activity`/
   `Progress`/`Lifecycle`/`Relationships`. This is a genuine content change a person will see
   immediately (four rows disappear from Overview) — stated as a decision with its rationale,
   not silently folded into "restyling."
4. **Collapsible description.** Cap the read-only render at ~3 lines with a "Show more" toggle,
   consistent with how `RichTextEditor` is already used read-only elsewhere. A local
   `useState` toggle in `OverviewTab.tsx`, nothing touching the stored value.
5. **Communication actions become one compact row**, not three stacked sections: `[ Reply ]
   [ Schedule ] [ Teams ]` as one `.ov-actions` row of buttons, each still expanding into its
   existing full form on click — the forms themselves are untouched, only the collapsed-state
   chrome changes.
6. **Add named headings within the two existing `<dl>` columns** (`OverviewTab.tsx:813`,
   `.cols-2` — already a two-column grid, not one continuous list as an earlier draft of this
   doc mis-stated; corrected here). The left column mixes record identity (Issue/Description/
   Source artifact) with classification (Tier/Type/Exposure) — split into two labeled groups.
   The right column mixes Raised/Last activity (provenance) with Progress/Lifecycle/
   Relationships (state) — split the same way. Four small headings across the two existing
   columns, once item 3's redundant rows are removed from both.

None of tier 1 touches the reducer, `lib/workspace.ts`, or any action shape. Verification is
`tsc`/`build`/live browser check only, the same posture I20's and I24's CSS-only fixes used —
no new scenario needed for a pure display change.

### Tier 2 — real work, scoped here, needs its own build pass (not "while we're at it")

7. **A status color palette — checked and confirmed genuinely absent, unlike severity's.**
   `--sev-high`/`--sev-medium`/`--sev-low` exist and are live; nothing equivalent exists for
   status. `.status-select.st-closing`/`.st-active` (`app/globals.css:2484-2492`) look like a
   prior attempt at exactly this, but a repo-wide grep found zero component references to
   either class — dead CSS, not a usable palette. `BoardView.tsx`'s lanes render status as plain
   text with no color at all (`components/BoardView.tsx:96`). And status isn't a four-state
   open/in-progress/blocked/done model as the pasted critique assumed — `ISSUE_STATUSES`
   (`lib/types.ts:112-120`) is seven real values (`Open, In Progress, Needs clarification,
   Awaiting client confirmation, Closed - confirmed, Closed - no defect, Superseded`), so this
   is a genuine small design decision — which of the seven read as "active" vs "waiting on
   someone else" vs "closed," and what three (or more) colors represent that — not a mechanical
   restyle. Scoped here as Tier 2 specifically because Tier 1 item 2 initially assumed this
   existed and it doesn't.
8. **Reduce eleven tabs to fewer, with the rest under a "More" menu.** Primary:
   `Overview, Checklist, Discussion, Time`. Secondary, under a `⋯ More` dropdown (reuse the
   `useOverlay`/`createPortal` pattern `RowMenu.tsx` already establishes, not a new dropdown
   implementation): `Skills, Fields, Notes, Estimation, Schedule, Links, History`. This is a
   real navigation change — tabs currently reached in one click move to two — so it needs its
   own before/after check on which tabs people actually use, not a guess. **Open question**,
   not decided here: is there any usage signal (even informal — "which tab do people open most
   after Overview") to base the primary-four choice on, or is it Nishant's judgment call?
9. **A "Time" KPI strip**, reading the existing `effortVariance()` — Estimated / Logged /
   Remaining / a progress bar — placed either in `FieldStrip` (visible on every tab, cheapest)
   or as a small always-visible section at the top of Overview. Needs a decision on which,
   since `FieldStrip` today is exactly four fields and this would be a fifth, differently-shaped
   element (a bar, not a form control) — a real layout decision, not a data one (the data is
   already there, per the tier-0 finding above).
10. **Context-sensitive primary action** (the critique's "Update status" / "Resolve blocker" /
    "Close" idea). This needs a rule: which status maps to which suggested next action, and
    whether "suggested" ever writes anything without a click. `lib/statusPolicy.ts`'s
    `allowedNext` already knows the legal transitions from a given status — the action-labeling
    layer on top of it is new, but the legality check it would sit on already exists and is
    already used by `FieldStrip`'s own status dropdown (`DetailPanel.tsx`, `chooseStatus`).

### Non-goals — explicitly not building, and why

- **"Next Best Action" / "Delivery Risk" AI insight cards.** No data source, no computation
  method, no stated definition of "risk" anywhere in this codebase. Building this as static or
  templated text would be inventing information principle 2 rules out. If wanted, it needs its
  own design doc that first defines what "at risk" means in terms of fields this app actually
  has (overdue? blocked with no next action set? both, per `lib/reports/dailyIms.ts`'s own
  Overdue/Blocked/At-risk sections, which already compute exactly this for the Daily IMS report
  — reusing that logic rather than a new invented one would be the honest way to build this,
  but that is its own scoping pass, not a checkbox on this one).
- **Rewriting the three-pane width ratio.** There is no three-pane width layout in this app
  today (see "What exists today" above) — nothing to change here without first deciding whether
  to introduce a horizontal split at all, which is a much bigger structural change than this
  critique's framing suggested and is out of scope for a detail-panel redesign.
- **A full "Issue Workspace" rebrand/rename.** The critique's framing ("stop calling it a form,
  call it a workspace") is a naming/mental-model point, not a UI change with a concrete before
  and after. Nothing to build against it.

## What would send this back

- Tier 1's "Show more" description cap, if a real workflow turns out to depend on the full
  description being visible without a click (e.g., copy-pasting from it routinely) — would
  scope down to a taller default rather than 3 lines, not abandon the idea.
- Tier 2 item 8 (tab consolidation), if whichever four tabs get chosen as "primary" turn out to
  be wrong for how people actually work this screen — reversible (it's a rendering list, not a
  data change) but worth getting right before shipping, hence the open question left standing
  rather than guessed.
