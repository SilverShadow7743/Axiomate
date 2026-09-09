# The issue detail panel reads like a database form — closing the gap

**Status: Tier 1 built, 9 September 2026 — Tier 2 still a design, not started.** Nishant pasted
a UX critique of the issue detail panel (source not this codebase — written against generic
mockup screenshots, not against `DetailPanel.tsx`/`OverviewTab.tsx` as they actually are) and
asked for a full design doc before any code. This reconciles that critique against what is
actually built — some of it holds, some of it doesn't apply, and one structural premise it
assumed is wrong. Once the doc was reviewed, Nishant said "Build the Tier 1 items" — see
"Tier 1 build summary" below for what shipped and how it was verified.

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

## Tier 1 build summary — 9 September 2026

All six items built as scoped, in `components/DetailPanel.tsx`, `components/OverviewTab.tsx`
and `app/globals.css`. No reducer, action-shape or `lib/workspace.ts` change — confirmed by
`git status` touching only those three files.

1. **Title**: a `.detail-title` block (`<h2 className="dt-name">{row.name}</h2>` +
   `.dt-idtag` subline) added above `.detail-head`, outside the `panelState !== 'compact'` gate
   so it survives collapse. `row.name`, not `issue.subject` directly — confirmed identical for
   an issue row (`lib/tree.ts:124` sets `name: issue.subject` at construction) and correct for
   non-issue rows, which have no `issue` at all. The old right-aligned `.idtag` span in
   `.detail-head` removed (its class stays — still used by `TreeGrid.tsx:780`, unrelated).
2. **Severity tag**: `FieldStrip`'s severity `<select>` wrapped in a `.fs-sev` span carrying
   `sev-${issue.severity}` and the same color-blind-safe glyph (`severityGlyph`,
   `lib/severity.ts`) Overview's own severity row already used — one palette, not two.
3. **I24's duplication resolved**: `Subject`, `Severity`, `Status` and `Owner` rows removed
   from Overview's `<dl>`. Checked precisely, not assumed identical to `FieldStrip`'s four
   fields: `Start Date / Due Date` stays (carries Start Date, which the strip doesn't) and
   `Raised by`/`Accountable` stay (neither is in the strip at all) — only the four rows that
   are genuinely redundant came out.
4. **Collapsible description**: a `.ov-desc-clamp` (`-webkit-line-clamp: 3`) wraps the
   read-only `RichTextEditor`; a ref-measured `descOverflows` state (`scrollHeight >
   clientHeight`) decides whether "Show more" renders at all, so the toggle never appears on a
   description that already fits — the same "don't claim what isn't there" discipline this
   session's other work has held to. Resets per issue via `useEffect` keyed on `issue.id`.
5. **Communication row**: Reply/Schedule/Teams collapse to one `.ov-comms-row` of buttons
   (plus inline status text — `sentLine`/`meetResult`/`chatSent`) when idle; each button still
   opens its full, untouched form in a separate `{composing/scheduling/messaging && (...)}`
   block below. One TypeScript-relevant change beyond pure layout: the expanded reply form's
   `isOutboundRefusal(outbound)` guard is now repeated on the block itself
   (`composing && !isOutboundRefusal(outbound)`) rather than assumed from the button that set
   `composing` — needed so TypeScript narrows `outbound` to `OutboundResolution` for
   `.mailbox`/`.recipient`/`.subject`, not just a runtime nicety.
6. **Named `<dl>` groups**: each `.cols-2` column is now a `.kv-col` wrapping two
   heading+`<dl>` pairs instead of one bare `<dl>` — `.cols-2` itself still has exactly two grid
   children, so the two-column layout is unchanged. Left: "Record" (Issue/Description/Source
   artifact) and "Classification" (Tier/Type/Exposure or Outcome). Right: "Ownership &
   timeline" (Raised by/Accountable/Next action/Start-Due/Raised/Last activity) and "Progress"
   (Progress/Lifecycle/Relationships/custom responsibilities) — the exact split point this
   design doc's Tier 1 item 6 named.

**Verification**: clean `tsc`, clean build, scenario suite unchanged (259 scenarios, zero
regressions — expected, since nothing here touches the reducer), clean `audit:tenancy`. Two
pre-existing `audit:a11y` failures in `AnalyticsView.tsx`/`PeopleDirectory.tsx` confirmed
unrelated (`git status` shows neither file touched by this change).

**Live verification in production found two real bugs the build-time checks above could not
catch — both fixed same day, before this was called done:**

- **The description clamp didn't clamp.** `-webkit-line-clamp` was applied to the wrapper
  `<div>` around `RichTextEditor`, but its read-only output is `.rte` > a single `<p>` — one
  block child, not inline text the clamp mechanism could count lines within. Confirmed live:
  `scrollHeight === clientHeight` (196px both) on a description that visibly ran ~9 wrapped
  lines. Fixed by switching to a plain pixel `max-height: 60px` (3 × the description's measured
  19.375px line-height) — a height cap works regardless of nested DOM structure, where
  line-clamp does not.
- **The severity tag rendered every severity in the same muted grey**, not the `--sev-high`/
  `--sev-medium`/`--sev-low` colors it was built to reuse. Cause: `.fs-sev` is itself a direct
  `span` child of `.fs-fld` — the same shape as the field's own label span — so
  `.field-strip .fs-fld > span` (specificity 0,3,0) was silently outranking `.sev-High` etc.
  (0,1,0). Confirmed by reading computed `color` and finding `--text-faint` instead of
  `--sev-high`. Fixed with three selectors specific enough to win
  (`.field-strip .fs-fld > .fs-sev.sev-High`, etc.), still reusing the same tokens.

Both were found by direct DOM/computed-style inspection against a real production issue
(SLG-001), not by looking at a screenshot — the description bug in particular rendered
visually plausible (text simply didn't look clipped, which reads as "fine" at a glance) and
only showed up as a bug once `scrollHeight`/`clientHeight` were actually compared.

**A third bug, found re-verifying the fix above rather than assuming the fix was complete**:
once the `max-height` clamp genuinely clipped the description, "Show more" never appeared at
all — `document.querySelector('.ov-desc-toggle')` came back null even though the DOM directly
confirmed real overflow (`scrollHeight` 196 vs `clientHeight` 60). Cause: the one-shot
measurement `useEffect` (deps `[issue.id, issue.description, descExpanded]`) races
`RichTextEditor` — TipTap with `immediatelyRender: false`, whose content DOM is inserted later
by TipTap's own logic — so the measurement can run before the rich text has painted, read a
near-empty box, and never re-run afterward since nothing in its dependency list changes again.

**First fix attempt (`ResizeObserver` on the clamp div's children) also failed, and was caught
by re-verifying rather than trusting the reasoning that produced it.** Re-deployed, re-checked
live: `descOverflows` was *still* stuck `false`. A `ResizeObserver` only reports size changes on
nodes it was told to watch — if TipTap's content node does not exist yet at the moment the
effect calls `el.children`, there is nothing to attach to, and a node inserted afterward is
never observed. Confirmed the mechanism, not just the symptom, with a direct console test
against the live page before writing a second fix: a `MutationObserver` on the same subtree
fired on a genuine content change; an ad-hoc `ResizeObserver` set up the same way did not — the
discriminating check `ResizeObserver` itself cannot pass, because it needs an existing node to
watch and `MutationObserver` does not. **Fixed by switching to a `MutationObserver`** on the
clamp div's whole subtree (`childList`/`subtree`/`characterData`), which fires on the insertion
itself regardless of what shape TipTap's content node turns out to have, no existing node
required at attach time.

This is the same "verified, not assumed" discipline the earlier two bugs were caught by, applied
twice over here — a fix that looks right by reasoning about the code is not the same as one
confirmed against the live DOM, and that held even for the fix meant to correct the first miss.

**Confirmed working, 9 September 2026, on a true fresh page load** (not a re-selection of an
already-mounted issue, which is the scenario that matters — a real user's first click after
opening the app): `.ov-desc-clamp` showed `scrollHeight` 196 vs `clientHeight` 60 (genuinely
clamped) and `.ov-desc-toggle` read "Show more" — present this time, unlike every prior check.
Clicking it un-clamped the description and flipped the label to "Show less." All six Tier 1
items now confirmed live together on SLG-001 in one screenshot: the title, the red severity
tag, the clamped/expandable description, the compact Schedule/Teams row, and all four named
`<dl>` groups (Record, Classification, Ownership & timeline, Progress).

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
