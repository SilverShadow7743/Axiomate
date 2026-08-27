# Consolidating the two issue-detail editors

## Problem

Every place a user can open an issue in Axiomate currently resolves to one of three components,
though only two are actually reachable:

- **`components/DetailPanel.tsx`** (+ its Overview tab, `components/OverviewTab.tsx`) — a tabbed
  drawer (Overview, Notes, Estimation, Time, Schedule, Links, History), docked beside the grid.
- **`components/IssueFocus.tsx`** — a standalone full-viewport modal with a flat form (Subject,
  Description, Status, Severity, Owner, Accountable, Next action, dates, percent).
- **`components/Dialogs.tsx`'s `EditForm`** — has a live `if (issue) {...}` branch with a
  near-complete issue form, but is confirmed **unreachable for issues**: `IssueWorkspace.tsx`'s
  routing (the `issueForm` memo, lines 1348–1355) always intercepts an issue edit before
  `Dialogs` ever renders for one.

This is two real, independently-maintained editors doing the same job, plus one that looks live
in source but never runs. The user asked for one canonical component, reachable from every entry
point, plus a scope-capped inline Quick Edit for fast triage.

## Entry points and current routing

All "open for viewing" paths already converge on one function — `revealIssue`/`requestSelect` →
`setSelectedId` in `IssueWorkspace.tsx` — which renders `DetailPanel` whenever `selectedId` is
non-null: Tree row select, Board, Calendar, My work, Portfolio, My calendar, the Timesheet panel,
Notifications, and the Assistant all already go there. Only a few corners still reach
`IssueFocus`: Row-menu "Edit", the toolbar "Edit" button, a Tree double-click on a column with no
inline cell editor, and "+ New Issue". Mail log passes no `onOpen` at all today — it doesn't open
an issue on click, and fixing that is out of scope here.

## Decision: `DetailPanel`/`OverviewTab` is canonical; `IssueFocus` is deleted

It is already the majority path and already has the richer functionality — RAID risk exposure,
decision outcome, the client-visible toggle, the full "reply to client" mail-compose flow,
`ApprovalsBlock`, and (as of this session's rich-content work) the Tiptap editor with tables,
images, mentions and `#issue` references. `IssueFocus` still edits a flattened plain-text
description. The two share no code today — independent `draft`/`f` state, independent dirty
checks, independent submit paths — so this is a port-then-delete, not a merge.

**Issue creation stays separate**, through `Dialogs.tsx`'s `CreateForm`. It already has a full
`isIssue` branch (`Dialogs.tsx:176–306` — parent/type picker, subject, description, status,
severity, owner, accountable, next action, dates) that is *also* currently unreachable, for the
same routing reason as `EditForm`'s. Creating an issue is a different job from editing one
(different starting state, a parent/type picker with nothing yet to be dirty against), and
forcing it through the tabbed drawer would mean giving `OverviewTab` a "new record" mode it does
not have and does not need.

## The routing change

`IssueWorkspace.tsx`'s `issueForm` memo is deleted outright. Its two branches only ever existed
to select `IssueFocus`:

```ts
const issueForm = useMemo((): { mode: 'edit' | 'add'; targetId: string } | null => {
  if (!dialog) return null
  if (dialog.t === 'edit' && state.issues[dialog.id]) return { mode: 'edit', targetId: dialog.id }
  if (dialog.t === 'add' && (dialog.kind === 'issue' || dialog.kind === 'sub-issue')) {
    return { mode: 'add', targetId: dialog.parentId }
  }
  return null
}, [dialog, state.issues])
```

With it gone, `{issueForm ? <IssueFocus/> : <Dialogs/>}` (line 2424) collapses to always
rendering `Dialogs` — which is exactly right for `dialog.t === 'add'` on an issue kind (falls
through to `CreateForm`'s already-built `isIssue` branch, no new fields needed) and irrelevant
for `dialog.t === 'edit'` on an issue, because that path stops setting `dialog` at all — see
below.

`rowActions.edit` (`IssueWorkspace.tsx:1293`), currently `(row) => setDialog({ t: 'edit', id:
row.id })` for every row kind, becomes kind-aware: for an issue row it calls `revealIssue(row.id)`
plus the new edit-mode request described next; for a hierarchy node it is unchanged
(`setDialog({t:'edit', id})`, still handled by `Dialogs`).

## Preserving one-click-into-edit-mode

Today, Row-menu "Edit", toolbar "Edit", and the Tree's double-click fallback open `IssueFocus`
*already in edit mode* — one click, no second step. `DetailPanel.editing` is local state
(`DetailPanel.tsx:410`), reset to `false` whenever `issue?.id` changes, and not currently
settable from outside the component.

This project already has the identical shape of problem solved once: `requestTab`/
`onTabRequestHandled`, used today by the Timesheet panel and Notifications to force `DetailPanel`
to a specific tab on open. The fix mirrors it exactly rather than inventing a new pattern:

- `IssueWorkspace.tsx` gains `requestEdit: string | null` state (an issue id) alongside the
  existing `requestTab`.
- `DetailPanel` gains `requestEdit`/`onEditRequestHandled` props and a second `useEffect`,
  alongside its existing tab-reset effect:

```ts
useEffect(() => {
  setEditing(false)
}, [issue?.id])

useEffect(() => {
  if (requestEdit && issue?.id === requestEdit) {
    setEditing(true)
    onEditRequestHandled()
  }
}, [requestEdit, issue?.id, onEditRequestHandled])
```

- `rowActions.edit` for an issue calls `revealIssue(row.id)` and sets `requestEdit` to the row's
  id in the same gesture.

## What moves from `IssueFocus` into `OverviewTab`

**Edit mode gains:** the manual progress-percent override slider — the one editable field
`IssueFocus` has that `OverviewTab` does not.

**View mode gains**, placed near the existing Raised/Last activity facts:
- Source-document detection (`detectSourceDocument`) — traceability to the artifact an issue was
  raised from, unique to `IssueFocus`, no equivalent anywhere in `OverviewTab` today.
- Lifecycle activity count ("N activities" / "Not planned") and relationship count ("N linked" /
  "None") — cheap at-a-glance facts, kept so nothing `IssueFocus` showed disappears from the
  canonical view even though the real detail lives a tab away (Schedule, Links).

**Dropped as exact duplicates, already on `OverviewTab`:** Raised (`formatIso(issue.raised)`),
Last activity, and Raised-by/raised context — `OverviewTab` already shows all three under their
existing labels.

**Evidence:** `DetailPanel` already threads `onManageEvidence: (issueId: string) => void` (used
to open the existing standalone `EvidencePanel` overlay) but does not currently pass it to
`OverviewTab`. This is threading, not new plumbing — `OverviewTab` gains the prop and a small
evidence-summary line + "Manage evidence" button matching `IssueFocus`'s.

## Dead code removed

- `components/IssueFocus.tsx` — deleted entirely, once the above is ported and nothing routes to
  it.
- `Dialogs.tsx`'s `EditForm`'s `if (issue) {...}` branch — confirmed unreachable both before this
  change (intercepted by the now-deleted `issueForm`) and after (issue edits never reach
  `dialog.t === 'edit'` at all anymore). Removed as part of the same cleanup.
- `Dialogs.tsx`'s `CreateForm`'s `isIssue` branch is **not** removed — it goes from dead to
  load-bearing, and needs real interactive testing for the first time as part of verifying this
  change, not just a read-through.

## Quick Edit

`lib/editing.ts`'s `editorFor` already backs inline per-cell editors for Status, Severity and
Owner in `TreeGrid` — double-click a cell with a spec opens the inline editor; falls back to
`rowActions.edit` only when no spec exists for that column. Subject has no inline editor today,
confirmed by grep — the one real gap against the requested scope (Status, Owner, Severity,
Subject). Quick Edit is a Subject entry added to `editorFor`, in the same shape as the other
three — not a new component, and not scoped narrowly to any one node in the tree: "unfiled-intake
issues" (the motivating case) are ordinary rows under the real, already-existing `Unfiled intake`
module node (`scripts/intake-mailbox.ts:63`), visible in the normal Tree wherever that node is
expanded — the affordance applies everywhere the existing three already do, not to a special
subset of rows.

## What would send this back

- If porting the percent-slider or evidence-summary into `OverviewTab` turns out to collide with
  its existing `dirty`/`draft` mechanism in a way that isn't a clean field addition (e.g., percent
  interacting with the existing schedule-derived-vs-manual-override logic already on `OverviewTab`
  in a way `IssueFocus` didn't have to reconcile).
- If the `requestEdit` effect and the existing tab-reset effect race in practice once actually
  wired up (both depend on `issue?.id`; the design assumes effect declaration order is enough,
  which needs confirming against React's actual batching once written, not just reasoned about).
- If `CreateForm`'s `isIssue` branch, once actually live, turns out to be missing something
  `IssueFocus`'s create mode depended on that wasn't visible from a read-through (it has never
  been exercised in production, per the routing that made it dead).
