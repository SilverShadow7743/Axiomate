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

### Tier 2 — scoped 9 September 2026, ready for review before any build

Re-scoped from four open bullets to concrete specs, by reading further into what the codebase
already has. Three of the four turned out to reduce to composing EXISTING code — no new
modeling, no new decision beyond a label — and are ready to build once reviewed. One
(item 8, tab consolidation) is a genuine, unresolved decision that stays open, named as such
rather than guessed.

**7. A status color palette — fully specified, ready to build.**

Checked and confirmed genuinely absent, unlike severity's — `--sev-high`/`--sev-medium`/
`--sev-low` exist and are live; nothing equivalent exists for status.
`.status-select.st-closing`/`.st-active` (`app/globals.css:2484-2492`) look like a prior
attempt at exactly this, but a repo-wide grep found zero component references to either
class — dead CSS. `BoardView.tsx`'s lanes render status as plain text with no color at all.
And status is not the four-state open/in-progress/blocked/done model the pasted critique
assumed — `ISSUE_STATUSES` (`lib/types.ts:112-120`) is seven real values.

The grouping this needs already exists, twice over, and does not need inventing:
`lib/schedule.ts` already exports `TERMINAL_STATUSES` (`Closed - confirmed`, `Closed - no
defect`, `Superseded`) and `BLOCKED_STATUSES` (`Awaiting client confirmation`, `Needs
clarification` — cited to "Spec §10" in the source), the exact same three-way split a status
palette needs. And the color TOKENS this needs already exist too — `--h-ontrack`/`--h-atrisk`/
`--h-overdue`/`--h-blocked`/`--h-complete`/`--h-unsched` (`app/globals.css:36-143`), the
theme-aware "schedule health" palette already driving the Gantt and Calendar. Composing the
two, nothing invented:

| Status | Group (existing) | Token (existing) |
|---|---|---|
| Open | — | `--h-unsched` (not yet actively worked) |
| In Progress | — | `--h-ontrack` |
| Needs clarification | `BLOCKED_STATUSES` | `--h-blocked` |
| Awaiting client confirmation | `BLOCKED_STATUSES` | `--h-blocked` |
| Closed - confirmed | `TERMINAL_STATUSES` | `--h-complete` |
| Closed - no defect | `TERMINAL_STATUSES` | `--h-complete` |
| Superseded | `TERMINAL_STATUSES` | `--h-complete` |

Same pill treatment as Tier 1's severity tag (`.fs-sev`-shaped, reusing the pattern, not a new
one) — `FieldStrip`'s status `<select>` gets a `.fs-status` wrapper colored by this table via
`lib/schedule.ts`'s own `isTerminal`/`BLOCKED_STATUSES`, not a fourth copy of the grouping
logic. **One thing to confirm, not decide from scratch**: Open vs. In Progress both read as
"nothing wrong" — `--h-unsched`/`--h-ontrack` gives them a visible difference (grey vs. green)
rather than collapsing to one active color; flag if a plainer 3-color version (Open folded into
the same active color as In Progress) is preferred instead.

**Checked for collision with the severity palette, since the two tags now sit side by side in
the same strip**: the `--h-*` and `--sev-*` tokens are not just similar, several are the exact
same hex — `--h-overdue` = `--sev-high` in both themes, `--h-atrisk` ≈ `--sev-medium`,
`--h-complete` ≈ `--sev-low` (`app/globals.css` light/dark blocks). None of the seven statuses
above map to `--h-overdue` or `--h-atrisk`, so no status tag will literally match a severity
tag's color — but `--h-complete` (used by all three terminal statuses) sits close enough to
`--sev-low` that a Low-severity issue in a Closed state would show two adjacent grey-ish pills
reading as one restated signal rather than two.

**Decided, 9 September 2026, revised once against the actual tokens**: differentiate by shape,
not by color, since the color budget is already spent reusing the `--h-*` set. A first pass at
this proposed a solid `background: var(--h-*)` fill with a theme-flipped foreground (white text
on the darker light-mode tokens, token-color text in dark mode). Checked against the tokens
themselves before committing to it: both light mode (`app/globals.css:36-44`, values like
`#8f5500`, explicitly documented as tuned for *text* contrast against white — see the AA
comment at line 37) and dark mode (`:104-109`, `#3fb086` etc., same role, text against dark)
define `--h-*` as **foreground colors in both themes**, never as a background. A solid-fill
treatment would need the token to switch roles per theme — background in light, foreground in
dark — which means two structurally different rules to keep in sync across three
token-redefinition sites (bare `:root`, the dark media query, the `[data-theme="dark"]` stamp),
the exact pattern that produced the Tier 1 severity bug (a rule reasoned about in isolation lost
to something else in the cascade).

**What's actually specified**: keep `.fs-sev`'s `currentColor`-based approach — it already
works in both themes with one rule, since `currentColor` resolves to whichever token is
assigned regardless of theme — but raise the fill weight and drop the border for `.fs-status`:
`background: color-mix(in srgb, currentColor 28%, transparent)`, `border: none`, text color the
`--h-*` token via the same per-status class pattern `.sev-High` etc. already establish. Fill
weight and border-presence are independent axes; a heavier untinted-vs-tinted, bordered-vs-not
pairing reads as two different kinds of tag without inverting anything per theme. Covers every
near-collision in the table, not just Closed+Low, with the one rule this needs.

**8. Tab consolidation — mechanism now recommended; the actual tab order still stays Nishant's call.**

**What's there today, checked directly**: `TABS` is a flat 11-item array for an issue
(`DetailPanel.tsx:366-370`) rendered as a flat row of buttons (`:527-539`). It already has an
overflow behavior — `.tabs` is `overflow-x: auto` with a fade-gradient hint on `.tabs-wrap::after`
(`app/globals.css:1569-1613`) — but that overflow is horizontal *scroll*, not consolidation: every
tab is still reachable in one click, just not all visible at once, which is a different problem
from the one the pasted critique and this doc's own diagnosis raised (eleven flat, equally-weighted
tabs read as a database form regardless of whether they fit on screen).

**Recommended mechanism, sourced from established UX guidance and real precedent, not invented
here**: a *priority navigation* / overflow-tab pattern — render tabs in a fixed priority order,
show as many as fit the available width, collapse the rest under a trailing `⋯ More` (reusing
the `useOverlay`/`createPortal` pattern `RowMenu.tsx` already establishes). Two independent
sources converge on roughly the same visible-tab count: Apple's Human Interface Guidelines cap
tab bars at 5, with the 5th slot becoming the word "More" past that; Nielsen Norman Group's
navigation guidance trends toward ~5 for scannability, inside the broader 7±2 (Miller's Law)
ceiling. Real precedent for the *adaptive* version specifically (collapse by available width,
not a hardcoded cutoff): GitHub's repo nav bar (Code/Issues/PRs/.../Settings collapses into a
`⋯` kebab as the window narrows) and Salesforce Lightning's tabset component (same behavior,
out of the box, on record pages).

**Why adaptive over a hardcoded split, specifically**: a fixed "these 4 are primary, forever"
list is a permanent guess with nothing to check it against — `lib/analytics.ts` reports
issue-count aggregates, not per-tab click data, and nothing in this codebase tracks which
`DetailPanel` tab gets opened, so a hardcoded cutoff can never be revisited with real usage
later. Measuring available width and collapsing only what doesn't fit turns "pick 4 of 11,
permanently" into "confirm the priority order" — order still matters (whichever tabs sort
first are the ones that stay visible), but the decision shrinks and stops being irreversible.
Implementation note, from the Tier 1 lesson on trusting an observer without checking what it's
actually attached to: `TABS`' 11 entries are static per row (unlike TipTap's async-mounted
content that broke a `ResizeObserver` in Tier 1), so a `ResizeObserver` on `.tabs-wrap` measuring
against each button's offset width is the right tool here and doesn't carry that same race — but
still wants a live-verification pass once built, same discipline as everything else this session,
not assumed correct from the reasoning alone.

**Still Nishant's call, narrowed**: the priority order itself. `Overview, Checklist, Discussion,
Time` remains the proposed default first four (unchanged from the original draft) — confirm
those four, or reorder/rename them, before this gets built. What's no longer open is *whether*
the mechanism is a hardcoded split or an adaptive one — recommended as adaptive, for the reasons
above.

**9. A "Time" KPI strip — placement narrowed to one recommendation.**

The data was already free (`effortVariance()`, established in the Tier 1 build summary above).
Recommendation: place it in `FieldStrip`, not as a separate Overview section — the whole point
of `FieldStrip`'s own original design (*"the fields a delivery manager touches most must never
be more than one click away, whichever tab is open"*) applies exactly as much to "how much of
the estimate is left" as it does to status or owner. Render as a compact inline readout — e.g.
`18h / 32h · 14h left` with `TimeTab.tsx:453-460`'s own established over/under-by phrasing —
rather than a bar, since `FieldStrip` is a single-line strip today and a progress bar would be
the one element in it that isn't text-height; a bar is worth adding only if this reads as too
terse in practice, which is a call to make after seeing it built, not before.

**10. Context-sensitive primary action — the suggestion already exists in the transition table.**

`DEFAULT_STATUS_POLICY.transitions` (`lib/statusPolicy.ts:69-85`) is not an unordered set —
its own comment says so directly: *"Read it as the route work actually takes: something
arrives Open, someone picks it up, it may bounce to the client and back, and it ends in one of
three places."* Each status's transition array already lists the ordinary next step FIRST.
`allowedNext(policy, from)` returns `[from, ...next]` (`lib/statusPolicy.ts:112-119`), so
`allowedNext(policy, status)[1]` is already, by construction, "the one ordinary next move" —
no new rule to invent, no mapping to design from scratch, just a label per status reading that
existing first element:

| From | `[1]` resolves to | Suggested label |
|---|---|---|
| Open | In Progress | "Start" |
| In Progress | Awaiting client confirmation | "Send to client" |
| Needs clarification | In Progress | "Resume" |
| Awaiting client confirmation | Closed - confirmed | "Confirm closed" |
| Closed - confirmed / Closed - no defect / Superseded | In Progress | "Reopen" |

The button calls the exact same `chooseStatus`/`onCommitCell` path `FieldStrip`'s own status
`<select>` already uses (`DetailPanel.tsx`). **Checked, and this is not uniform across rows** —
`checkTransition` (`lib/statusPolicy.ts:130-153`) returns two different problem kinds, and
`dropOutcome` (`lib/board.ts:53-67`) routes them differently: `kind: 'reason'` becomes
`{kind: 'ask', ...}`, which `chooseStatus` (`DetailPanel.tsx:1335-1348`) turns into the inline
`fs-ask` text prompt — a real path forward. But `kind: 'evidence'` (the one that fires for
exactly the "Confirm closed" row, since `requireEvidence: ['Closed - confirmed']`) is NOT
`'reason'`, so `dropOutcome` maps it to `{kind: 'refused', message}` instead — `chooseStatus`
just sets `refusal` and stops; no prompt opens. Built as specified, the one row this table
calls "already the answer" would be the one row that dead-ends the button with a refusal
string instead of a way to comply. **Decided, 9 September 2026**: point the refusal at the
evidence manager rather than suppress the suggestion. Suppressing it makes "Confirm closed"
silently vanish exactly when the transition-table logic is proudest of itself (the ordinary
next move is known, but the button that would say so just isn't there) — worse than showing
it and explaining what's missing. `onManageEvidence(issue.id)` (`components/DetailPanel.tsx:135`,
opens `EvidencePanel` via `IssueWorkspace.tsx`'s `evidenceFor` state) is exactly this action,
already built.

**Placement, corrected after a first pass got this backwards**: an earlier draft of this
decision put the button in `OverviewTab` because `onManageEvidence` is already a prop there.
That reasoning didn't survive a second check — `chooseStatus`, `pendingStatus`, and the inline
`fs-ask` reason prompt (`DetailPanel.tsx:1335-1384`) are private to `FieldStrip`, not reachable
from `OverviewTab`. Four of the five rows in the table above resolve to `kind: 'reason'`, not
`kind: 'evidence'` — putting the button in `OverviewTab` would mean either reimplementing
`checkTransition`/`dropOutcome`/the reason-prompt UI a second time (a divergent copy of rules
that must stay in lockstep with `FieldStrip`'s), or the button silently not handling the more
common case at all. **The button lives inside `FieldStrip`, next to the status `<select>` it
already contains**, and calls `chooseStatus(suggested)` directly — the exact same function,
not a parallel one, so the reason prompt keeps working for all four `'reason'` rows with no new
code. The only genuinely new plumbing is threading `onManageEvidence` as a new prop into
`FieldStrip` (currently `DetailPanel.tsx:582` passes only `row`/`issue`/`state`/`onCommitCell`)
and one small change inside `chooseStatus`: call `checkTransition` (`lib/statusPolicy.ts:130`,
not currently imported into `DetailPanel.tsx` — only `dropOutcome` is) directly when `dropOutcome`
returns `'refused'`, so the `'evidence'` kind can be told apart from the (here, unreachable in
practice, since the table only ever proposes an already-allowed route) `'route'` kind and routed
to `onManageEvidence` instead of a plain message.

## Tier 2 build summary — items 7, 9, 10 — 9 September 2026

Built as specified above, with two issues caught and fixed before the first live check rather
than discovered by one. Clean `tsc`, clean build, 259 scenarios unchanged (this suite covers
reducer/business logic — `chooseStatus` is component-internal, so it was never going to be
exercised here; the real check was live), clean `audit:a11y` on the touched files.

**Two specificity/inheritance issues caught in review before shipping**: `.fs-time-val` sits in
the same position `.fs-sev` did in Tier 1 — a direct `span` child of `.fs-fld` — so it would
have inherited the generic `.field-strip .fs-fld > span` label rule's color (losing to it on
specificity, the exact Tier 1 bug) and its `text-transform: uppercase` (rendering "18h / 32h" as
"18H / 32H", which `.fs-sev`/`.fs-status` don't suffer because they wrap word-shaped `<select>`
option text, not numerals). Both fixed with explicit overrides before any deploy.

**Live-verified against production (SLG-001) after deploy, not assumed from the reasoning
alone**:
- **Item 7**: `.fs-status` carries class `st-ontrack` for "In Progress", computed `color: rgb(21,
  127, 92)` (exactly `--h-ontrack`), 28%-alpha `currentColor` background, `border: 0px` —
  matches the spec exactly. Severity's tag re-checked alongside it and still correctly bordered
  and colored (`sev-High` → `--sev-high`, `1px solid` border) — no regression from adding the
  new selectors.
- **Item 9**: confirmed both branches. SLG-001 genuinely has no estimate yet, and `.fs-time`
  correctly does not render at all (the "hide, don't show an empty slot" decision working as
  intended, not a bug). The has-an-estimate branch was verified by injecting a synthetic
  `.fs-time-val`/`.fs-time-note` pair into the live page and reading real computed styles off
  the actual cascade (rather than fabricating estimate data through the Estimation tab's
  five-dimension complexity scorer, which resisted scripted input) — confirmed `color: rgb(26,
  24, 21)` (`--text`, not the muted label grey), `text-transform: none`, `font-size: 12px`, and
  the note rendering in `--text-faint` beside it. Both specificity fixes hold under the real
  cascade, not just in isolation.
- **Item 10, the riskiest piece — exercised end to end, not just inspected**: moved SLG-001
  Open-adjacent "In Progress" → "Awaiting client confirmation" (reason prompt opened and
  committed correctly, confirming the `'reason'`-kind path is untouched), confirmed the
  suggested-action label updated to "Confirm closed", then clicked it with zero evidence
  attached. Result: no `.fs-refusal` dead-end message, no reason prompt — a portal-mounted
  `<aside class="evi">` "Evidence & Documents" panel for SLG-001 opened directly, exactly the
  fix as decided. Reverted both the status and the reason-prompt test data back to "In Progress"
  afterward so the live record was left clean; the two test transitions remain in SLG-001's own
  History as an honest audit trail, not scrubbed.

**Confirmed working, 9 September 2026, all three items live together on SLG-001.** Item 8 (tab
consolidation) is the only Tier 2 item left to build.

## Item 8 build summary — 9 September 2026

Built as specified: `TabsBar` (`DetailPanel.tsx`) replaces the flat, always-all-11 tab row with
priority navigation — `TABS` reordered to lead with `Overview, Checklist, Discussion, Time`,
tab widths cached once on first paint (`useLayoutEffect`), a `ResizeObserver` on the wrap
re-decides the visible count from the cache on every resize, the active tab is always forced
into the visible set, and the rest collapse under a portal-rendered `⋯ More` menu reusing
`RowMenu`'s `useOverlay`/`createPortal` shape. Clean `tsc`, clean build, clean `eslint`, 259
scenarios unchanged (no reducer touched).

**Two real bugs found live-verifying against production (SLG-001), neither caught by
`tsc`/build/eslint — both are CSS cascade bugs, not logic bugs, and the underlying adaptive
width-fitting mechanism was correct from the first deploy**:

1. **The wrapper div around `.tabs` and the `⋯ More` button had no `display: flex`.** The core
   logic was already right — shrinking the wrap to 160px correctly cut the visible set down to
   just "Overview" — but with no flex on the wrapper, `⋯ More` fell onto its own line below the
   tabs instead of sitting inline with them. Confirmed via screenshot (this one genuinely needed
   a screenshot — the layout bug is about visual position, not something a DOM query would
   catch). Fixed with `display: flex; align-items: center` on the wrapper.
2. **`.tabs-more-menu` was computing `position: absolute`, not the `fixed` it was written to
   have.** `.menu` (declared later in `globals.css`, same 0,1,0 specificity as `.tabs-more-menu`
   alone) was winning the position property on source order — a different flavor of the same
   specificity-adjacent class of bug Tier 1 hit with `.fs-sev`, this time by ordering rather than
   raw specificity. Caught by reading `getComputedStyle(menu).position` directly rather than
   trusting the written CSS — the menu was still fully functional at the wrong position value
   (confirmed via `elementFromPoint` hit-testing and a real click-through to select "History"
   from the menu, which worked end to end even before the fix), so this was a real but latent
   bug: harmless at zero page-scroll, would have misbehaved once the page actually scrolled.
   Fixed by targeting `.menu.tabs-more-menu` (both classes, matching what the element actually
   carries) rather than depending on staying above `.menu` in the file.

**Both resize directions confirmed working on the final pass**: shrinking the wrap to 160px
correctly reduced the bar to "Overview" + a correctly-inline, correctly-fixed-position `⋯ More`
listing the other ten; widening back restored the natural 8-visible/3-overflowed split without
needing to re-render the hidden tabs to re-measure them (the width cache holding up under a
real resize, not just in the reasoning). Clicking a tab inside the More menu correctly closed
the menu, switched the active tab, and rendered that tab's real content.

**All four Tier 2 items (7, 8, 9, 10) now built and confirmed working live.** I25 Tier 1 and
Tier 2 are both complete.

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
