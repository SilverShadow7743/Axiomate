# Hive layout and attention areas — review, plan, schedule

22 August 2026. Produced from a six-agent review (66 findings): Hive's layout grammar
researched from the web, Axiomate's information architecture and UX friction read from the
components, discoverability of everything phases 1–5 shipped, Hive's aspects beyond the
original eight gaps, and the repository's own unfinished threads. Findings the review made
against records that were stale on the day (the phase-5 tenant grant, the access-policy
Denied proof, and checklist section 20 were all completed 22 Aug) are closed, not scheduled.

## What the review agreed on

Three themes carry most of the 66 findings:

1. **The layout grammar is inverted relative to how delivery staff work.** Hive lands people
   on "what needs me" and keeps a record's vital signs pinned beside every view of it.
   Axiomate lands on the all-clients tree, keeps My Work and Portfolio as modal drawers, puts
   the selected row's verbs in the top bar, and hides status/owner/due behind one tab's edit
   mode.
2. **Shipped capability is invisible at the moment of need.** Board/Calendar sit mid-way
   through a crowded filter bar; blueprints never appear when someone creates an engagement;
   the client-mail compose is below the fold of one tab; the intake screen opens with a
   banner saying the shipped intake system does not exist; arriving requests notify nobody
   by default.
3. **Several controls lie or lose work.** The record History tab shows the whole workspace's
   audit log; five tree-only controls render dead in Board/Calendar; Inbox/My Work/Portfolio
   selection bypasses the unsaved-work guard; toasts are invisible to assistive tech and drop
   stacked messages; a recurring rule says "firing" whether or not the pass has ever run.

## Schedule

Working weeks, starting Monday 25 August. Each batch is independently shippable and ends
with `tsc`, the scenario suite, build, deploy, and a click-through of what changed.

### Week 1 (25–29 Aug) — controls that lie, work that vanishes  *(small fixes, high trust)*
- Route Inbox, MyWorkPanel, PortfolioPanel selection through `requestSelect` so drafts
  survive navigation (IssueWorkspace.tsx ~1704/2208/2225).
- Filter the DetailPanel History tab to the selected record (DetailPanel.tsx ~674).
- Gate Expand/Collapse/Today/Columns/Legend/SLA-toggle on `view === 'tree'`
  (FilterBar.tsx ~285–396), matching the zoom control.
- Toast: `role="status"` / `role="alert"`, queue instead of overwrite; list every missed
  automation message, not `missed[0]`.
- Intake screen truth: replace the "nothing reads a mailbox" banner with live status per
  surface; show the pass's last-run time on Recurring work and downgrade "firing" to a
  warning when no run has happened; absolute form URL with Copy/Open on each form card.
- Records reconciliation: strike stale pending-actions items (B1–B3, superseded A/I2d),
  re-run the suite to refresh `data/validation.json`, record section 20 as driven.
- Pin `tsx` in devDependencies (five gate scripts run it unpinned today).

### Week 2 (1–5 Sep) — the Hive layout grammar  *(the structural week)*
- **My Work becomes a view and the landing surface**: fourth entry in the Tree/Board/Calendar
  segmented control; first-run sessions with `myWorkCount > 0` land on it; the drawer stays
  as quick-peek. Portfolio becomes the fifth view; both drawers retire.
- **SelectionToolbar moves out of the top bar** into the DetailPanel header/context row, so
  the top bar holds only stable global chrome.
- **Persistent field strip** on the DetailPanel header — status, owner, due date, severity —
  visible and editable from every tab via the existing `commitCell` path.
- Anchor the view switcher at the leading edge of the filter bar with icons and stronger
  active styling.
- `+ New` becomes selection-independent (parent picker in the dialog, pre-filled from
  context).

### Week 3 (8–12 Sep) — notifications that reach people
- Drain the pending email-channel notification queue through the proven Graph Mail.Send
  path (factor `graphToken`/send out of `app/api/mail/send/route.ts` into `lib/mail`), from
  the scheduled pass; stamp real delivered/failed outcomes. The access policy proven on
  22 Aug (Granted for OAPILCatalyst@, Denied for everything else) is what makes this safe.
- Assignment notifications from the reducer on owner change (reserved system ruleId).
- Inbox: mark-all-read, "N older not shown", and route `onOpen` through `requestTab` so each
  notification lands on its tab.
- A "Requests" surface (or a default-enabled `issue.created` rule) so intake arrivals are
  seen without hand-built automation.

### Week 4 (15–19 Sep) — the record, consolidated
- DetailPanel tabs 12 → ~8: merge Schedule + Lifecycle + Resolution Path; fold Data Source
  into a header link; group Relationships + Evidence.
- Compose where the thread lives: "Write a reply" in the Overview header and on NotesTab.
- Blueprints at the moment of need: "Start from a blueprint…" in the add-engagement flow,
  "Save as blueprint…" on the engagement row menu; 2–3 authored starter blueprints marked
  as shipped examples.
- Board cards get a keyboard/touch "Move to…" menu (reusing `dropOutcome` + reason dialog);
  Escape closes overlays via `useOverlay`; detail tab strip gets overflow handling.

### Week 5 (22–26 Sep) — the P1 debt the suite names
- SLA clock suspension for client-waiting statuses (scenario C): per-status entered/left
  timestamps, elapsed working time excludes them, paused state shown on the row.
- `updateTime` runs `timeEntryAllowed` against the destination exactly as `addTime` does.
- Small-viewport pass: clamp initial tree width to the window, one ~1100px breakpoint that
  stacks the panes and collapses secondary toolbar controls.

### Before phase 7 (guest access) — prerequisites, not features
- **Identity id migration**: `Issue.owner` / `TimeEntry.person` / notification recipients
  join on directory ids (id-first, name-fallback), unresolvable names refused loudly. Fixes
  My Work emptiness, daily-cap silence, and the Tarun class of incident before guests
  multiply identities.
- **Client-safe visibility boundary** (scenario RP2): a field on records/notes plus a read
  grant withheld from the payload — phase 7 cannot ship without it, and the weekly client
  pack builds on it.

### Operator agenda (one sitting, this week)
1. G7: narrow Engagement Leader (move `change.approve` to Project Manager) — live security
   cost, goes first.
2. Store the OAPIL blueprint (choose the repeatable tiers of the 111 entries).
3. Client-filter default (what "stakeholder" computes from) and the discipline taxonomy.
4. E1/E2 design reversals: confirm or overrule.
5. Book the two-person verification session for checklist sections 2–10 and 14b/c.

## Deliberately skipped (so it is not re-litigated per phase)
- **Native chat** — competes with Teams inside Microsoft-shop customers; notes remain the
  auditable record.
- **Start/stop timers** — a second source of hours; the default-to-today entry already
  targets recording-late.
- **Slack/Drive integrations** — wrong ecosystem; a Teams incoming-webhook channel after the
  email drain is the one integration worth having.
- **HiveMind-parity drafting** — except possibly a propose-only "draft from record" seed for
  the compose, later.
- **Resourcing heatmaps** — lib/capacity already models this more honestly.

## What would reorder this
- A real user losing a typed client reply to the drawer-navigation bypass → week 1's guard
  fix jumps to today.
- Phase 6 (proofing) being requested first → weeks 2 and 4 compress; week 3 holds, because
  the notification drain is independent.
- The operator declining the My-Work-first landing → week 2 keeps the view promotion but
  drops the default change; nothing downstream depends on it.

## Status as of 2026-08-31 (re-checked against real code, not assumed from this doc)

Week 2's structural grammar is confirmed done — see `wiki/resources/platform/hive-comparison.md`
for the citations. Everything below is a fresh, code-verified pass over the rest of this plan;
"done" here means read in the actual file, not inferred from a task name.

**Week 3 — notifications that reach people**

| Item | Status | Evidence |
|---|---|---|
| Notification drain via Graph Mail.Send | **Done** | `lib/db/notifyDrain.ts:46-101`, `drainEmailNotifications()` — sends via `sendAsMailbox`, stamps `delivered`/`failed`/`pending`. A separate system from the report-pack delivery (`lib/delivery.ts`); both run from `app/api/schedule/run`. |
| Assignment notifications on owner change | **Done** | `lib/automation.ts:150-164`, `AUTO_OWNER_CHANGED`, `on: 'issue.owner'`, enabled by default. |
| Inbox mark-all-read / "N older" / `onOpen`→tab | **Done** | `components/Inbox.tsx:76,94,110`; routed via `setRequestTab` in `components/IssueWorkspace.tsx:2185-2209`. |
| "Requests" surface / default `issue.created` rule | **Partial** | `AUTO_HIGH_RAISED` (`lib/automation.ts:100-113`) is default-on but High-severity only — a Medium/Low intake arrival still notifies nobody by default. Unified Work Inbox (shipped this session) covers decisions/waiting, not "what just arrived." |

**Week 4 — the record, consolidated**

| Item | Status | Evidence |
|---|---|---|
| DetailPanel tabs 12 → ~8 | **Open** | `components/DetailPanel.tsx:61-76` still lists all 15 original tab kinds, unmerged. |
| "Write a reply" on Overview/Notes | **Done** | `components/OverviewTab.tsx`, `components/NotesTab.tsx`. |
| Blueprints at the moment of need | **Done** (mechanism) | "Start from a blueprint"/"Save as blueprint" in `components/ConfigWorkspace.tsx`, `components/Dialogs.tsx`, `components/RowMenu.tsx`. 2-3 starter blueprints not verified as authored content. |
| Board "Move to…" menu | **Done** | `components/BoardView.tsx:45,131-147`, reuses `dropOutcome`. |
| — Escape/outside-click closes it | **Done, 2026-08-31** (`4d2a378`) | Extracted into `MoveMenu` (`components/BoardView.tsx`), matching `RowMenu.tsx`'s own shape: `useOverlay` for background inert + Tab wrap, the reused `.row-menu-scrim` for outside-click, Escape handled locally. Previously the menu had no dismiss path at all except picking an item. |
| — Detail tab-strip overflow handling | **Open** | No matching CSS found. |

**Week 5 — the P1 debt the suite names**

All three done: SLA clock suspension (scenario `C`, `data/validation.json`: PASS, `pausedDays=10`); `updateTime` now runs `timeEntryAllowed` against the destination (`lib/workspace.ts:4053-4073`, cites TW1 by name); the ~1100px small-viewport breakpoint (`app/globals.css:1728`).

**Before phase 7 — prerequisites**

Client-safe visibility boundary is **done** (scenario `RP2`: PASS — internal records, internal notes, and rate amounts all confirmed absent from client packs). The identity id migration itself is **still open** — reconfirmed independently this session by Zero-Entry Timesheet's own finding that `TimeTab.tsx` had zero personId resolution before that feature added one locally; the systemic, workspace-wide migration this item asks for hasn't happened.

**Operator agenda**

Four of five still open: G7 (`ROLE_ENGAGEMENT_LEAD` still carries `change.approve`, `lib/access.ts:252` vs. `:259`), the OAPIL blueprint (no match in `lib/blueprint.ts`), the client-filter default (no "stakeholder" match in `components/`), and the two-person verification session (human action, presumed pending). E1/E2's design-reversal confirmation is outside what code can verify.

**Net**: the structural week (2) and the debt week (5) are both closed. Week 4 is **not** fully
closed — four of six items are done (reply-compose, blueprints, the Board menu itself, and now
its Escape/outside-click dismissal), but the two structural pieces remain open: the DetailPanel
tab consolidation (15 tabs, unmerged) and detail tab-strip overflow handling. Tab consolidation
specifically is a real refactor across a 1,531-line component, not a quick item — it's the
largest genuinely open piece of this whole plan. Week 3's gap is narrow (severity-gated default
notification, not the drain mechanism itself, which works).
