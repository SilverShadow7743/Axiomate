# Status rollup — implementation plan

Follows `docs/plans/2026-09-02-status-rollup-design.md` (approved 2026-09-02, revised d23200e —
`statusRollup` ships in `DEFAULT_VISIBLE`, not opt-in). Ordering principle: pure logic first,
independently provable before anything depends on it; then the caller that assembles every row;
then the two UI surfaces, which have no test harness and are verified by eye and by build.

## Grounding corrections found while planning (not in the design doc)

Two things the design doc's illustrative code got wrong, caught by reading the real files rather
than trusting the sketch:

1. **The CSS class derivation would have broken.** The design doc's snippet did
   `hl-${value.toLowerCase()}` directly on `statusRollup`. `'In Progress'.toLowerCase()` is
   `'in progress'` — a space in a CSS class name, which never matches. `health`'s own real
   rendering (`TreeGrid.tsx` ~line 921) strips whitespace first
   (`.replace(/\s+/g, '')`) for exactly this reason.
2. **No new CSS is needed at all**, once the right existing tokens are reused. `app/globals.css`
   already defines `--h-blocked` (light `#6b4ead`), `--h-ontrack` (light `#157f5c`), and
   `--h-complete` (light `#5a6b7a`), each with matching `.hl-*`/`.bg-*` classes (~lines 1040–1076,
   three theme blocks: bare `:root`, `@media (prefers-color-scheme: dark)`, and
   `[data-theme="dark"]`). `statusRollup`'s three real values map cleanly onto three of
   Schedule Health's existing semantics — Blocked→blocked, In Progress→on-track (actively
   moving, nothing stalled), Closed→completed — so the render code maps the value to the
   **existing** slug (`blocked`/`ontrack`/`completed`) instead of deriving a new one. This
   removes `app/globals.css` from this plan's touched files entirely.

## Step 1 — `leafRollupStatus` in `lib/schedule.ts`, provable alone

Add, beside `TERMINAL_STATUSES`/`BLOCKED_STATUSES` (~line 41):

```ts
export const ROLLUP_SLUG: Record<'Blocked' | 'In Progress' | 'Closed', string> = {
  Blocked: 'blocked',
  'In Progress': 'ontrack',
  Closed: 'completed',
}

export function leafRollupStatus(
  issues: Record<string, IssueRecord>,
  issueId: string,
): 'Blocked' | 'In Progress' | 'Closed' | null {
  const leaves: IssueStatus[] = []
  function walk(id: string) {
    const children = Object.values(issues).filter((i) => i.parentId === id && !i.deletedAt)
    if (!children.length) return
    for (const c of children) {
      const grandchildren = Object.values(issues).some((i) => i.parentId === c.id && !i.deletedAt)
      if (grandchildren) walk(c.id)
      else leaves.push(c.status)
    }
  }
  walk(issueId)
  if (!leaves.length) return null
  if (leaves.some((s) => BLOCKED_STATUSES.includes(s))) return 'Blocked'
  if (leaves.some((s) => s === 'In Progress')) return 'In Progress'
  if (leaves.every((s) => TERMINAL_STATUSES.includes(s))) return 'Closed'
  return 'Open' as never // see "details most likely to be gotten wrong" — this arm needs a decision
}
```

(The `'Open'` fallback needs a real return type decision — see below. Signature takes
`Record<string, IssueRecord>`, not the full `WorkspaceState`, so this function's only dependency
is the issue map it's handed; `IssueRecord` is imported with `import type` from `./workspace`,
which is erased at compile time and does not create a real circular module dependency with
`workspace.ts`'s own value-import of `BLOCKED_STATUSES`/`STATUS_PROGRESS` from `schedule.ts`
(`lib/workspace.ts:175`).

**Verified this session, not assumed:** `TERMINAL_STATUSES` and `BLOCKED_STATUSES` are disjoint
from each other and from `'In Progress'`/`'Open'` across the real 7-value `IssueStatus` enum —
confirmed by reading both lists and `lib/types.ts:112`. This is what makes the priority order
safe regardless of which of Blocked/Closed is checked first (design doc's own note, re-verified
here against the real lists rather than re-trusted).

New scenario `SR1` in `scripts/scenario-validation.ts` (placed after `AA3`, ~line 10014 —
next unused two-letter id this session's naming convention has reached), calling
`leafRollupStatus` **directly** against a hand-built `Record<string, IssueRecord>` — no `state`,
no `buildTree`, nothing else exists yet for this to depend on:

- A leaf issue (no children) → `null`.
- One child, `Closed - confirmed` → `'Closed'`.
- Two children, one `In Progress` → `'In Progress'` (outranks the closed sibling).
- Two children, one `Awaiting client confirmation` → `'Blocked'` (outranks both siblings).
- A soft-deleted (`deletedAt` set) child excluded from an otherwise-all-closed set → `'Closed'`,
  not blocked by counting the deleted one as still open.
- A grandchild case: a child with no status worth reading (it has its own child) is walked
  through, not read as a leaf itself — proves "leaf" means "no sub-issues of its own," not
  "direct child."

**Verify:** `npx tsc --noEmit` (this step alone doesn't compile against real state, so this also
catches the `IssueRecord` import working correctly) → `npm run validate:scenarios` — exact
current PASS count (192, confirmed this session) plus one, `SR1` reaching PASS.

## Step 2 — wire into `ScheduleRow` and `buildTree()`

`lib/types.ts`'s `ScheduleRow` interface gains one field, placed directly after `scheduleHealth`
(line 274) since that's where it renders beside it in the drawer:

```ts
scheduleHealth: ScheduleHealth
statusRollup: 'Blocked' | 'In Progress' | 'Closed' | null
```

Two real construction sites in `lib/tree.ts`, confirmed by reading the file rather than assuming
the RAID log's own count carried over unchanged:

1. `blank()` (~lines 307–341) — the shared default-row seed every row starts from. Add
   `statusRollup: null` beside `raidKind: null` (line 318). This is what makes a structural node
   row (module/project/client, built by `walkNode`) and an activity/milestone row correctly show
   nothing — only `walkIssue` ever overwrites it.
2. `walkIssue()` (~line 63–219) — add `row.statusRollup = leafRollupStatus(state.issues, issue.id)`
   directly after `row.status = issue.status` (line 139), so it reads next to the field it
   summarizes. `state.issues` is already in scope (`buildTree`'s own parameter).

Import `leafRollupStatus` by adding it to the existing `from './schedule'` import in `lib/tree.ts`
(line 6), which already pulls `computeDurations`, `computeHealth`, `isTerminal`,
`pausedCalendarDays`, `rollUp`, `STATUS_PROGRESS` — one more name, no new import line.

Extend `SR1` (same scenario, not a new one) with a second half that goes through the real
reducer and `buildTree()`, matching the design doc's own stated intent ("pinning `leafRollupStatus`
and `buildTree()` together, not testing the pure function in isolation") for the part that
actually needs the two pinned together:

- Build a real 3-level chain with `t: 'create'` actions (the same shape `RA1` and this session's
  WBS import both already use): an Epic, a Deliverable under it left at `Open`, a Task under the
  *Deliverable* set to `Closed - confirmed`. Assert the Epic's row (`buildTree(state,
  TODAY)`) carries `statusRollup: 'Closed'` — proving the rollup reads the Task, not the
  Deliverable's stale `Open` status, which is the entire reason recursive-over-direct-children
  was chosen over the simpler alternative.
- Assert a structural node row (any module/project row already in `BASE`) carries
  `statusRollup: null` from `blank()`, never a fabricated value.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios` — PASS count holds, `SR1`'s
extended assertions still PASS.

**Commits 1 and 2 merge into one.** `leafRollupStatus` un-wired into `buildTree` has no real
value on its own — nothing calls it — so splitting the commit here would leave a step that
compiles but does nothing, the same call the RAID log design's own execution made (`ScheduleRow`
field, `buildTree` wiring, and its scenario shipped as one single step, not two).

## Step 3 — UI: `DetailPanel.tsx`, `TreeGrid.tsx`, `lib/columns.ts`

No test harness exists for either component in this codebase — verified by reading, not
inherited as a given: neither file has a scenario or a component test today. This step is
provable only by `npm run build` succeeding, `npm run audit:a11y` passing, and a manual check in
the browser (both surfaces, both a leaf issue and a multi-level parent).

**`components/DetailPanel.tsx`** — one more `<dt>/<dd>` pair in the Schedule tab, directly after
"Schedule health" (currently lines 763–766):

```tsx
{issueRow!.statusRollup && (
  <>
    <dt>Status rollup</dt>
    <dd className={`hl-${ROLLUP_SLUG[issueRow!.statusRollup]}`}>{issueRow!.statusRollup}</dd>
  </>
)}
```

Import `ROLLUP_SLUG` from `./lib/schedule` (or the relative path this file already uses for its
other `lib/schedule` imports — check the existing import block rather than guessing the path
style). Wrapped in a fragment gated on non-null, matching the design doc's "shown only when not
null" requirement — a leaf issue's Schedule tab renders exactly as it does today.

**`components/TreeGrid.tsx`** — new `case 'statusRollup':` directly after `case 'health':`
(currently ends at line 928), same chip-plus-dot pattern, same slug mapping:

```tsx
case 'statusRollup':
  return row.statusRollup ? (
    <span className={`chip hl-${ROLLUP_SLUG[row.statusRollup]}`}>
      <span className={`dot bg-${ROLLUP_SLUG[row.statusRollup]}`} />
      {row.statusRollup}
    </span>
  ) : (
    <span style={{ color: 'var(--text-faint)' }}>—</span>
  )
```

**`lib/columns.ts`** — new `ColumnDef`, placed directly after `'health'` (currently ends line
91), matching its neighbor's shape and **its** `sortValue` convention specifically — `health`
sorts on the raw string value (`sortValue: (r) => r.scheduleHealth`), not a numeric score the
way `exposure` does. `statusRollup` is the same shape of thing (a small fixed-vocabulary label,
not a judged score), so it follows `health`'s convention, not `exposure`'s:

```ts
{
  key: 'statusRollup',
  label: 'Status Rollup',
  width: 120,
  minWidth: 80,
  sortable: true,
  sortValue: (r) => r.statusRollup ?? '',
}
```

Added to **both** `COLUMNS` and `DEFAULT_VISIBLE` (line ~175, directly after `'health'`) — the
approved revision from the design doc's default-visible decision.

**Verify:** `npx tsc --noEmit` → `npm run validate:scenarios` (PASS count holds — nothing here
is scenario-tested) → `npm run audit:a11y` (`eslint components app` — required because both
touched components render a new colored indicator; confirm the chip's text-plus-dot shape,
already proven compliant by the identical `health`/`exposure` chips, doesn't trip a rule the
existing ones don't) → `npm run build`. Then a manual check in the browser: open a leaf issue
(no Status rollup row/chip appears), open `OAPIL-091` specifically (Status rollup should read
`Closed`, since `OAPIL-092` is already `Closed - confirmed`), and confirm the Tree grid's default
column set doesn't visually crowd on the "OAPIL open work" saved view already in daily use.

**This is the step carrying the most regression risk.** `DEFAULT_VISIBLE` is read by every Tree
grid render for every user the moment this deploys — unlike the RAID log's opt-in columns, there
is no toggle standing between this change and what everybody sees immediately. If the column is
too wide, or the chip text wraps awkwardly at `minWidth: 80`, it lands in front of every user at
once, on every existing Saved View that doesn't override the default column set. The manual
browser check above is not optional for this reason.

## Details most likely to be gotten wrong

1. **The `'Open'` return arm's type.** The sketch above wrote `'Open' as never` as a placeholder
   — `leafRollupStatus`'s declared return type is `'Blocked' | 'In Progress' | 'Closed' | null`,
   which has **no `'Open'` member**. This is a real decision the design doc didn't resolve: an
   issue with children, none of them blocked, none in progress, and not all closed (i.e., all
   leaves are `Open`) needs an actual return value. Two honest choices: extend the return type to
   include `'Open'` as a fourth real tier (matches the design doc's own four-tier table, which
   *does* list "Open" as tier 4 — the design doc's prose already settled this, the code sketch in
   this plan just didn't carry it through). **Resolution: the return type is
   `'Blocked' | 'In Progress' | 'Closed' | 'Open' | null`**, `ROLLUP_SLUG` gets a fourth entry
   (`Open: 'unscheduled'`, reusing `--h-unsched`'s existing muted-gray token — the closest
   existing semantic to "nothing has started"), and every signature/scenario assertion above
   that only lists three values needs the fourth added when this step is actually implemented.
2. **"Leaf" means "no sub-issues," not "no children of any kind."** `leafRollupStatus` only ever
   looks at `Issue.parentId` chains — never activities, never hierarchy nodes. An issue with
   lifecycle activities but no sub-issues is still a leaf for this feature's purposes; its own
   `status` is what gets collected, not anything derived from its activities' progress.
3. **`deletedAt` filtering applies at every level of the walk, not just the leaves.** A
   soft-deleted intermediate issue (a Deliverable, say) must not be walked into at all — its own
   live children become effectively unreachable through it, which matches how `childIssues()` in
   `lib/tree.ts` (line 46–49) already treats archived issues everywhere else in this file.
4. **Both UI surfaces must import the same `ROLLUP_SLUG`, never re-derive their own.** Two
   independent `.toLowerCase()`-style mappings in `DetailPanel.tsx` and `TreeGrid.tsx` would be
   exactly the kind of forked reading of the same fact the RAID log design's own "what would send
   this back" section warned against for `raidKind`. One export, two call sites.

## What would send this design back

Carried forward from the design doc, restated against what grounding actually found:

- If the four-tier (now confirmed five-value-including-null) collapse loses a distinction
  somebody genuinely needs — that's a real gap in the mapping, not something to patch around
  with a fifth ad hoc tier.
- If a real workflow later needs the rollup to *drive* something (block a parent's status
  transition, auto-request an approval) — that's a live-enforcement design this plan's scope
  never included, and needs its own approval-gate interaction design first.

New, found during this planning pass:

- If `audit:a11y` (`eslint components app`) actually flags the reused chip pattern once a
  concrete `statusRollup` case exists — that would mean the borrowed `health`/`exposure` pattern
  isn't as safely reusable as this plan assumes, and the color/dot/text shape needs its own look
  before shipping, not a silent suppression.
