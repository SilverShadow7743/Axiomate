# Status rollup — a computed "what's actually happening below this" indicator

**Status: approved 2026-09-02** (two AskUserQuestion decisions, recorded below). Prompted by
reviewing the live WBS import in the browser: `Issue.parentId` already builds a real sub-issue
hierarchy (134 issues just imported), but nothing today tells a reader what the *children* of a
parent issue are actually doing without opening each one. Checked against live data before
designing anything: among the 29 parent issues in production, there is exactly one case where a
parent's own status disagrees with what its children would suggest (`OAPIL-091`, status
`In Progress`, whose only child `OAPIL-092` is already `Closed - confirmed`) — this is not a
data-quality mess left by the import, it's a genuinely missing piece of the product.

## What's real today, and the actual gap

`Issue.status` (`lib/types.ts`'s `ISSUE_STATUSES`, 7 values) is set only by a person or the
source log — `case 'updateIssue':` in `lib/workspace.ts` runs every status change through
`checkTransition`'s graph and, where configured, an approval gate. Nothing propagates a status
between a parent issue and its children in either direction; the two records are independent.

The codebase already computes two other things this way — never stored, always derived, shown
alongside the real fields: `Progress %` (rolled up from lifecycle activities) and
`Schedule Health` (`lib/schedule.ts`'s `scheduleHealth()`, using `TERMINAL_STATUSES` and
`BLOCKED_STATUSES` — the same status-family lists this feature reuses). Both render in
`components/DetailPanel.tsx`'s Schedule tab and, for Schedule Health, as a colored chip in
`TreeGrid.tsx`. This feature is the same shape of thing, one level up the tree: a live-computed
reading of "what do the children say," not a new fact anyone attests to.

## The two decisions

1. **Computed indicator, never written to `Issue.status`.** The alternative — the reducer
   overwriting a parent's real status whenever a child changes — would put an inferred value in
   the same field as attested facts, the exact thing `ISSUE_STATUSES`'s own comment ("we do not
   invent new ones") and this codebase's "never invent a fact nobody stated" discipline argue
   against. It would also have to fight `checkTransition`'s graph and approval gates on every
   cascade. A computed field sidesteps both problems and matches the existing Progress/Schedule
   Health pattern exactly.
2. **Recursive over leaf descendants, not direct children only.** A parent's rollup reflects
   every non-deleted leaf issue underneath it, at any depth — not just its immediate children's
   own (possibly stale) status. In a 3-level Epic → Deliverable → Task hierarchy, this means the
   Epic's rollup reflects the Tasks, not an intermediate Deliverable that nobody's updated. Same
   reasoning as why Progress % rolls up from activities rather than from one intermediate layer.

## What's computed

A new pure function, `leafRollupStatus(state, issueId): 'Blocked' | 'In Progress' | 'Closed' | null`,
added to `lib/schedule.ts` beside `TERMINAL_STATUSES`/`BLOCKED_STATUSES`. It walks
`state.issues` recursively by `parentId`, collecting the real `status` of every non-deleted leaf
descendant (an issue with no sub-issues of its own), skipping soft-deleted (`deletedAt`) issues
the same way every other computed field in this app does. Returns `null` for a leaf issue itself
— there is nothing to roll up — so the UI can tell "no children" apart from "children all
closed," rather than collapsing both to an empty state.

The four tiers, checked in this priority order against the collected leaf statuses:

1. Any leaf's status is in `BLOCKED_STATUSES` → **Blocked**
2. Else any leaf's status is `In Progress` → **In Progress**
3. Else every leaf's status is in `TERMINAL_STATUSES` → **Closed**
4. Else → **Open**

This collapses the six-tier rule this was requested as (New/Planned/In Progress/In
Review/Blocked/Done/Closed) onto Axiomate's real seven-value status vocabulary, which has no
data to distinguish New from Planned or Done from Closed — there is nothing in the source log to
tell those apart, so inventing the distinction here would be exactly the kind of fact this
codebase doesn't invent.

The priority order above (Blocked, then In Progress, then all-Closed, then Open) reads
differently from the order originally given (all-Closed checked first, Blocked third) — this is
not a deviation. `TERMINAL_STATUSES` and `BLOCKED_STATUSES` are disjoint from each other and
from `In Progress`/`Open` (confirmed against the real `IssueStatus` enum), so a leaf's status
belongs to exactly one tier and the two orderings are provably equivalent; the order here just
matches the convention of surfacing the most urgent condition first, the same way a dashboard
leads with what needs attention.

`buildTree()` (`lib/tree.ts`) gains one more field per row, computed once, not re-derived per
render: `statusRollup: 'Blocked' | 'In Progress' | 'Closed' | null`, via
`leafRollupStatus(state, row.id)` at both of `buildTree`'s existing row-construction sites — the
same copy-through pattern `raidKind` and a dozen other fields already follow there.

## Detail drawer

`components/DetailPanel.tsx`'s Schedule tab gains one more `<dt>/<dd>` pair, directly after
"Schedule health" (currently lines 763–766), using the identical `hl-${value}` color-coded
convention:

```
<dt>Status rollup</dt>
<dd className={`hl-${issueRow!.statusRollup?.toLowerCase()}`}>
  {issueRow!.statusRollup ?? '—'}
</dd>
```

Shown only when `statusRollup` is not `null` — a leaf issue's Schedule tab looks exactly as it
does today.

## Tree grid

A new column in `lib/columns.ts`, following the `exposure`/`decisionOutcome` columns'
(`RAID log`, 2026-09-01) exact `ColumnDef` shape, but **default-visible** — added to both
`COLUMNS` and `DEFAULT_VISIBLE`, unlike the RAID columns. The whole point is seeing a mismatch
like `OAPIL-091` at a glance while scanning a hierarchy, not after opting in — so it ships on by
default. Existing Saved Views that captured a specific column set before this ships won't gain
it automatically (a saved column list is exactly that — saved), but anyone on the default view,
or building a new one, sees it without a toggle.

Rendered in `TreeGrid.tsx`'s Cell switch using the exact `Schedule Health` chip pattern
(`case 'health':`, ~line 920) — text label plus a colored dot, never color alone:

```
case 'statusRollup':
  return row.statusRollup ? (
    <span className={`chip hl-${row.statusRollup.toLowerCase()}`}>
      <span className={`dot bg-${row.statusRollup.toLowerCase()}`} />
      {row.statusRollup}
    </span>
  ) : (
    <span style={{ color: 'var(--text-faint)' }}>—</span>
  )
```

## Testing

One new scenario in `scripts/scenario-validation.ts`, pinning `leafRollupStatus` and
`buildTree()` together rather than testing the pure function in isolation:

- A 3-level chain (Epic → Deliverable → Task) where the Deliverable's own status is stale
  (`Open`) but its one Task is `Closed - confirmed` — proves the rollup reads the Task, not the
  Deliverable, which is the entire reason for choosing recursive-over-direct-children.
- A parent with one `Awaiting client confirmation` child among otherwise-closed siblings —
  proves Blocked outranks Closed.
- A leaf issue (no children) — proves `statusRollup` is `null`, not `'Open'` or empty string.
- A soft-deleted child excluded from an otherwise-all-closed set — proves the rollup doesn't
  read archived work as still open.

## What stays untouched

No schema change — nothing new is stored, `Issue.status` keeps meaning exactly what it means
today. No change to `case 'updateIssue':`, `checkTransition`, or any approval rule. No change to
Progress % or Schedule Health's own computation — this is a new, independent field alongside
them, not a replacement.

## What would send this back

- If a real workflow needs the rollup to actually *drive* something (block a parent's own status
  transition until children agree, or auto-request an approval) — that's a live-enforcement
  design this doc deliberately avoided, and would need its own approval-gate interaction design,
  not a bolt-on to a read-only computed field.
- If the four-tier collapse loses a distinction somebody genuinely needs (e.g., telling
  `Closed - confirmed` apart from `Superseded` at the parent level) — that's a real gap in the
  mapping, not something to route around by inventing a fifth ad hoc tier.
