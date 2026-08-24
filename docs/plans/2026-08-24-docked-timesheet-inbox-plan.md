# Dock Timesheet and Notifications as views — implementation plan

Follows `docs/plans/2026-08-24-docked-timesheet-inbox-design.md`, approved. The design's own
words: "Extends `MyWorkPanel`'s docked prop... to `TimesheetPanel` and `Inbox` rather than
inventing a new pattern" — every step below is checked against that existing, already-shipped
implementation (`components/MyWorkPanel.tsx`) rather than invented fresh.

No pure-logic-first ordering applies here in the usual sense — this is UI wiring over already-
correct business logic, not new domain rules. The ordering principle instead follows dependency:
the type widens first (so the compiler's own exhaustiveness check — the same discipline
`ACTION_PERMISSIONS`'s `satisfies` assertion uses elsewhere in this codebase — catches every
place that needs updating), then each panel gains `docked` independently and is checked in
isolation, then both are wired into the switch together as the one step that actually depends on
both existing.

## Step 1 — Widen `WorkspaceView` and its labels

**Touches:** `lib/viewChoice.ts` (`WORKSPACE_VIEWS` gains `'timesheet'`, `'inbox'`),
`components/FilterBar.tsx` (`VIEW_ORDER`, `VIEW_LABEL: Record<WorkspaceView, string>`,
`VIEW_TITLE: Record<WorkspaceView, string>` — both records fail to compile with a missing key,
which is the check).

**Verified:** `npx tsc --noEmit` — a missing entry in either `Record<WorkspaceView, string>` is a
compile error naming the type, not a runtime gap found later. This is the whole verification for
this step; there is no behaviour yet, only a wider menu with two new labelled, unclickable-so-far
buttons (they render; nothing in the main pane responds to them until step 4).

## Step 2 — `TimesheetPanel` gains `docked`

**Touches:** `components/TimesheetPanel.tsx`.

Four changes, each mirroring the corresponding line in `MyWorkPanel.tsx`:

1. `docked?: boolean` added to the props type, defaulting falsy (every existing caller —
   the toolbar modal — keeps working unchanged by omitting it).
2. `useOverlay(ref, true, onClose)` → `useOverlay(ref, !docked, onClose)`. This is the load-
   bearing line: `useOverlay` no-ops entirely when `active` is false (`if (!active) return`,
   confirmed by reading `components/useOverlay.ts:56`), so docked mode correctly skips the
   `inert` background lock, the Tab-wrap focus trap, and focus restoration — the docked pane
   *is* the main content, not an overlay sitting on top of it. Leaving this hardcoded `true`
   would make a docked timesheet trap keyboard focus inside itself forever, since nothing
   would ever call the `onClose` that ends the trap.
3. The `modal-scrim` wrapper and the `createPortal(...)` call become conditional on `!docked`
   — docked mode renders the `modal timesheet-modal` div's content inline in the pane, not
   portaled to `document.body`.
4. The Close button in `modal-head` becomes conditional on `!docked`, and `role="dialog"` /
   `aria-label` follow the same `docked ? undefined : ...` shape `MyWorkPanel` already uses.

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`. No new scenario — this changes rendering
mode, not the business logic `onSubmitWeek`/`onDecideWeek`/`onDecideMany` already call through
to, which the existing WG1 scenario already covers.

## Step 3 — `Inbox` gains `docked`

**Touches:** `components/Inbox.tsx`.

The same shape as step 2, with one real difference worth naming rather than glossing over:
`Inbox` today is ONE component that is both the trigger (the bell button) and the content (the
dropdown), toggled by its own internal `open` state. A docked instance is not "the dropdown, left
open" — it is a second, independent mount of the same component with no bell button at all,
existing *alongside* the toolbar's own un-docked instance (`docked` defaulting falsy there, same
as `TimesheetPanel`). Concretely:

- `docked?: boolean` added to props.
- When `docked`, the `inbox-btn` bell button is not rendered at all — there is no toggle to
  provide, since navigating to the `inbox` view already is the "open" action.
- The notification-list markup (currently inside the `open && createPortal(...)` block) renders
  unconditionally when `docked`, un-portaled, the same conditional shape as step 2's scrim/portal
  change.
- `useOverlay(ref, open)` stays exactly as it is for the un-docked bell instance (it already
  correctly no-ops when `open` is false) and is not called at all in the docked render path —
  there is no overlay to trap focus in when the content is the main pane.

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`.

**Named here rather than discovered later:** once step 4 wires this in, viewing the `inbox` pane
means TWO `Inbox` component instances are mounted simultaneously — the toolbar's un-docked bell
(still rendered on every view, unchanged) and the docked full-pane instance. Each computes its own
`inboxFor`/`unreadCount`/`undelivered` independently (`useMemo`-cached per instance, not shared),
which is redundant work, not a correctness bug — both read the same `state.notifications` and
will always agree. Not worth solving in this pass; named so a future profiling pass doesn't
mistake it for a mystery.

## Step 4 — Wire both into the view switch

**Touches:** `components/IssueWorkspace.tsx`.

The main-pane switch (`view === 'mywork' ? <MyWorkPanel .../> : view === 'portfolio' ? ... : view
=== 'calendar' ? ... : view === 'board' ? ... : <TreeGrid .../>`) gains two more branches,
`view === 'timesheet'` and `view === 'inbox'`, each rendering the panel with `docked` and the
same callback props its existing call site already passes — `onSubmitWeek`/`onDecideWeek`/
`onDecideMany`/`onOpen` for `TimesheetPanel` (from the existing modal render around line 2362),
`onRead`/`onReadAll`/`onOpen`/`onSetPref` for `Inbox` (from the existing toolbar render around
line 1803). No new callback is invented; both are copied from their existing call sites verbatim.

The existing toolbar "Timesheets" button and the persistent bell keep their current renders
untouched — `timesheetsOpen` state and the toolbar `<Inbox />` instance are not removed, per the
design's "two doors, not a moved one."

**This is the step carrying what regression risk this plan has**, and it is small: the only way
to get it wrong is passing a *different* callback than the existing call site uses (e.g. a stale
closure, or a prop name typo TypeScript happens to structurally accept). The check is direct —
`npx tsc --noEmit` catches a missing or mistyped prop against each component's now-`docked`-aware
prop type, and a manual diff of the two callback blocks (new vs. existing) confirms they're
copies, not near-copies.

**Verified:** `npx tsc --noEmit`, `npm run audit:a11y`.

## Commit boundaries

Steps 1–4 are small enough, and sequenced tightly enough by the type system itself, to land in
one commit — there is no meaningful intermediate state where shipping step 2 without step 1 (or
step 4 without steps 2–3) would compile at all, let alone be independently useful. This is the
one place this plan departs from "migrations stand alone, everything else merges by meaning":
there is no migration here, and the four steps are one meaningful unit of work — a view that
didn't exist and now does — not four separable ones.

## Verification, whole

`npx tsc --noEmit`, `npm run audit:a11y`. No scenario harness changes — no reducer arm, no
permission key, no new pure logic exists for it to drive; `WG1` (timesheets) and the existing
notification scenarios already cover the business logic these panels call through to, unchanged.
Not verified: a live browser drive of the two new view-switcher entries — this session has no
Chrome access, the same limitation named at the end of the project-membership build.

## What would send this back to the design

- If `TimesheetPanel` or `Inbox`, once read closely during step 2/3, turn out to have a
  `useEffect` or piece of internal state that assumes it is always mounted/unmounted by its own
  open/close transition (rather than by the parent view switching away) — `MyWorkPanel`'s
  precedent assumes docking is a rendering-mode change onto content that already tolerates being
  permanently mounted. If either panel's internals fight that assumption, that's a finding about
  the panel to fix, not a reason to invent a third pattern for it.
