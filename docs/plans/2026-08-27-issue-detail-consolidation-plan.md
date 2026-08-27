# Consolidating the two issue-detail editors — implementation plan

Follows `docs/plans/2026-08-27-issue-detail-consolidation-design.md`, approved by the user
through two rounds of questions during the design conversation, plus one correction (Quick Edit's
Subject field needs a popover, not a fourth `editorFor` case — found while grounding this plan,
folded into the design doc before this was written, see its own "Quick Edit" section).

This branch also carries unrelated, uncommitted, in-progress work (a rich-text-editor feature).
Every step below stages only the files this design touches — never a bare `git add -A` — so
nothing here sweeps in or conflicts with that other work.

No scenario coverage exists for any of this today: `rowActions.edit`, the `issueForm` routing,
and `Dialogs.tsx`'s `CreateForm`/`EditForm` branches are all component-level UI wiring, and
`scripts/scenario-validation.ts` only drives `lib/workspace.ts`'s reducer directly — confirmed by
grep, zero matches for any of these names. Every step touching routing relies on interactive
browser verification alone; there is no harness to catch a wrong wire-up here before a person
does.

## Step 1 — Port `IssueFocus`'s remaining fields into `OverviewTab`

**Files:** `components/OverviewTab.tsx`, `components/DetailPanel.tsx` (prop threading only).

Done first and alone, so that at every later commit `OverviewTab` is already a strict superset of
what `IssueFocus` offered — nothing routes away from a capability that's briefly unavailable
nowhere.

- **Percent-override slider** (edit mode). `IssueFocus`'s only editable field `OverviewTab` lacks.
  Added as a `IssueDraft` field the same way the existing ones are — read from
  `record.percentOverride`, written through the same `save()` patch-diff loop already there.
  Reconcile against `OverviewTab`'s own schedule-derived-vs-manual-override display (`row.*`
  fields it already reads) rather than assuming `IssueFocus`'s handling transfers untouched —
  this is the one porting step the design doc's own "what would send this back" names as a real
  risk.
- **Evidence summary + launcher** (view mode). `DetailPanel` already threads
  `onManageEvidence: (issueId: string) => void` to open the existing `EvidencePanel` overlay
  (used today by `IssueFocus`'s own "Manage evidence" button) but does not pass it to
  `OverviewTab`. Add the prop to both components' signatures, thread it through
  `DetailPanel.tsx`'s existing `<OverviewTab .../>` call, and add a summary line + button matching
  `IssueFocus`'s (`evidenceTally`/`latestEvidence`, both already computed in `IssueFocus.tsx` and
  portable as-is — same `tallyByKind`/`latestOf` helpers from `lib/evidence.ts`).
- **View-mode context facts.** Source-document detection (`detectSourceDocument`, from
  `lib/evidence.ts` — already imported by `IssueFocus.tsx`), lifecycle activity count, and
  relationship count. Placed near `OverviewTab`'s existing Raised/Last activity facts. Raised,
  Last activity, and Raised-by are **not** ported — `OverviewTab` already shows all three under
  its own labels; porting them again would duplicate, not add.

**Verify:** `npx tsc --noEmit` clean. `npm run build` clean. Interactive: open a real issue's
Overview tab (dev server, Service-Worker unregistered/caches cleared per this project's own
established checklist), confirm the percent slider round-trips a real save, the evidence line
shows real counts and the launcher opens the same `EvidencePanel` `IssueFocus` did, and the three
new context facts render for an issue that actually has a detected source document and a built
lifecycle (not every issue will — pick one that does, from `state.issues`/`state.documents`
directly if the UI doesn't make one obvious).

One commit — the three additions are independent in code but are one unit of work ("`OverviewTab`
now offers everything `IssueFocus` did"), and splitting them further buys nothing since none of
them is independently shippable as a user-facing change on its own.

## Step 2 — The routing change

**Files:** `components/IssueWorkspace.tsx`, `components/DetailPanel.tsx`.

One connected unit — splitting it would leave a dangling reference (e.g. `issueForm` deleted
before `rowActions.edit` stops assuming `IssueFocus` exists, or vice versa).

- **Delete the `issueForm` memo** (`IssueWorkspace.tsx:1348–1355`). Its two branches only ever
  selected `IssueFocus` or `Dialogs`; with it gone, `{issueForm ? <IssueFocus/> : <Dialogs/>}`
  (line 2424) collapses to rendering `<Dialogs/>` unconditionally — done in this step, not left
  as a literal dead ternary, since `IssueFocus` itself is not deleted until Step 3 and the
  component still needs to compile in between.
- **`requestEdit`/`onEditRequestHandled`**, mirroring the existing `requestTab`/
  `onTabRequestHandled` pair exactly (`IssueWorkspace.tsx:648`, `2249–2250`):
  - `IssueWorkspace.tsx` gains `const [requestEdit, setRequestEdit] = useState<string | null>(null)`
    beside the existing `requestTab` state, and passes `requestEdit={requestEdit}
    onEditRequestHandled={() => setRequestEdit(null)}` to `<DetailPanel>` beside its existing
    `requestTab`/`onTabRequestHandled` props.
  - `DetailPanel.tsx` gains both props on its interface, and a second `useEffect` beside the
    existing tab-reset one (`DetailPanel.tsx:410–413`):
    ```ts
    useEffect(() => {
      if (requestEdit && issue?.id === requestEdit) {
        setEditing(true)
        onEditRequestHandled()
      }
    }, [requestEdit, issue?.id, onEditRequestHandled])
    ```
    Declared *after* the existing `setEditing(false)` effect in source order — both depend on
    `issue?.id`, and effect order matches declaration order within one commit, so the reset runs
    first and this one's `setEditing(true)` is the value that sticks. This ordering assumption is
    exactly what the design doc's "what would send this back" flags as needing confirmation once
    written, not just reasoned about — the browser check below is what confirms it, not this
    comment.
- **`rowActions.edit`** (`IssueWorkspace.tsx:1293`) becomes kind-aware: for an issue row, call
  `revealIssue(row.id)` then `setRequestEdit(row.id)`; for every other row kind, unchanged
  (`setDialog({t:'edit', id: row.id})`, still handled by `Dialogs`).

**Verify:** `npx tsc --noEmit` clean (this alone will not catch a routing mistake — nothing here
is typed narrowly enough to fail on a wrong wire-up). `npm run build` clean. Interactive, all
against the dev server with the Service Worker unregistered:
1. Row-menu "Edit" on a real issue → `DetailPanel` opens, already in edit mode, on the Overview
   tab, with `OverviewTab`'s edit form pre-filled from that issue.
2. Toolbar "Edit" with an issue selected → same.
3. Tree double-click on the Subject cell of an issue row → same (this is `TreeGrid.tsx:511`'s
   `opensEditor` branch, currently calling `actions.edit(r)` — unaffected by this step, since
   Quick Edit's popover is Step 4's separate change to that same branch; confirm it still opens
   the full editor correctly here, before Step 4 changes what it opens to).
4. Row-menu "Edit" on a hierarchy node (client/engagement/project/module) → still opens `Dialogs`'
   `EditForm`, unaffected.
5. Switch to the Notes tab, then trigger Row-menu "Edit" on a *different* issue → confirm the
   panel switches to that issue's Overview tab in edit mode (proves the effect fires on a fresh
   `issue?.id`, not just on first mount).
6. Open an issue, start editing (dirty the form), then trigger Row-menu "Edit" on the *same*
   issue again → confirm this doesn't stomp in-progress edits in some unexpected way (the effect
   should be a no-op here since `editing` is already `true`).

This is the step carrying the most regression risk in this plan. `rowActions.edit` and the
render at `IssueWorkspace.tsx:2424` are code paths that currently always succeed, for every
active user of the app, on every row kind — a mistake here is not a new feature failing to work,
it is Row-menu "Edit" silently breaking for every issue in production, discovered by whoever
clicks it next rather than by anything that ran first.

One commit — `issueForm`'s deletion, the `requestEdit` wiring, and `rowActions.edit`'s change are
one behavior (issue edits reach `DetailPanel`, not `IssueFocus`) split across two files;
committing them separately would mean an intermediate state where `rowActions.edit` still opens
nothing for an issue (if wired first) or `issueForm`'s deletion breaks the build (if deleted
first without `rowActions.edit` updated).

## Step 3 — Delete `IssueFocus`, clean up `Dialogs`

**Files:** `components/IssueFocus.tsx` (deleted), `components/IssueWorkspace.tsx`,
`components/Dialogs.tsx`.

Only after Step 2 is verified to have zero remaining paths into `IssueFocus` — Step 2's own
interactive checks already prove this, so this step is cleanup, not a functional change.

- `grep -rn "IssueFocus" --include="*.tsx" --include="*.ts" .` (excluding `node_modules`) before
  touching anything, to catch any reference this plan's own grounding missed. Known references
  going in: `IssueWorkspace.tsx:94` (`const IssueFocus = dynamic(...)`) and the JSX block at
  `IssueWorkspace.tsx:2424–2434` (now unreachable dead code since Step 2 made `issueForm` always
  absent) — remove both, and delete `components/IssueFocus.tsx` itself.
- `Dialogs.tsx`'s `EditForm`'s `if (issue) {...}` branch — confirmed unreachable before this plan
  (intercepted by the now-gone `issueForm`) and unreachable after (issue edits no longer produce
  `dialog.t === 'edit'` at all, per Step 2). Pure deletion, zero behavior change. Remove the
  `issue` parameter/prop plumbing that only existed to feed this branch, if any is left dangling
  once the branch is gone — check rather than assume.
- `Dialogs.tsx`'s `CreateForm`'s `isIssue` branch is **not** touched here — it goes from
  unreachable to load-bearing as a direct consequence of Step 2 deleting `issueForm` (its `add`
  branch no longer intercepts an issue-kind creation), with no code change of its own. Flagged in
  this step only as: do not delete it along with `EditForm`'s dead branch just because both
  currently read as unreachable — they stop being equivalent the moment Step 2 lands.

**Verify:** `npx tsc --noEmit` clean (deleting `IssueFocus.tsx` while a reference remains is a
compile error, which is real signal here — if this step's `tsc` run is anything other than clean,
the grep above missed something). `npm run build` clean. Interactive: "+ New Issue" from the
toolbar → confirm `Dialogs`' `CreateForm` opens (not a blank screen, not an error) with the
`isIssue` branch's fields (parent/type picker, subject, description, status, severity, owner,
accountable, next action, dates), create a real test issue, confirm it appears correctly in the
Tree, then remove it through the app's own delete/archive action — this is the step that most
needs real interaction, since "the code already exists and reads correctly" is not evidence it
has ever actually run; it has not, until this check.

One commit — the `IssueFocus` deletion and the `EditForm` dead-branch removal are two edits to
two different concerns (a whole component going away; a few dozen lines in a shared file) but
both are pure removal with the same precondition (Step 2 verified), and neither is meaningful
half-done.

## Step 4 — Quick Edit: the Subject popover

**Files:** new `components/QuickEditPopover.tsx` (or similar name), `components/TreeGrid.tsx`.

Functionally independent of Steps 1–3 — touches neither `IssueFocus`, `DetailPanel`, nor the
`issueForm` routing. Ordered last because it is the most purely additive piece here and shares no
code path with the consolidation, not because anything upstream blocks it; it could equally be
pulled into its own smaller plan if that reads more cleanly at execution time.

Per the design doc's correction: not a fourth `lib/editing.ts` `editorFor` case (Subject is
deliberately excluded there, `lib/editing.ts:57–73`, for a real reason — a lone 392px cell
divorces Subject from Description). Instead:

- A new popover component modeled directly on `components/StatusCellEditor.tsx`'s existing
  pattern: `createPortal`, a `useLayoutEffect` measuring the host cell's `parentElement` bounding
  rect before paint (so it never flashes at the top-left corner for a frame), `useOverlay` for
  focus-trap and Escape-to-close. Carries all four Quick Edit fields — Status, Owner, Severity,
  Subject — each committing independently and immediately on change, the same "no independent
  save/cancel lifecycle" every other inline editor already has; this is four fields shown
  together, not a form with a submit button.
- `TreeGrid.tsx:511`'s `opensEditor` branch (currently `actions.edit(r)` on double-click, for the
  Subject column of an issue row with no `editorFor` spec) changes to open this popover instead.
  Row-menu "Edit" and toolbar "Edit" are untouched by this step — they already open the full
  `DetailPanel` as of Step 2, and stay that way. Double-click keeps meaning "fast inline edit";
  the menu keeps meaning "the full editor" — the same split every other column already has.
- Reuses `lib/editing.ts`'s existing `editorFor` specs for Status/Owner/Severity (already correct,
  already used by the other three inline editors) rather than re-deriving their options/values;
  Subject's own value/commit path is new, matching `OverviewTab`'s `subject` field handling for
  what counts as a valid write.

**Verify:** `npx tsc --noEmit` clean. `npm run build` clean. Interactive: double-click a real
issue's Subject cell in the Tree → popover opens anchored to that cell; change each of the four
fields independently and confirm each commits on its own (not batched behind a single save);
confirm Escape closes it without committing a field left mid-edit; confirm it stays within the
viewport for a row near the bottom or right edge of the grid (the reason `StatusCellEditor`
tracks `POPOVER_W`/`POPOVER_H` at all). Clean up any test edits afterward through the app's own
actions, confirmed by reopening the row — this dev server points at the real production database.

One commit — the popover component and its one call-site change are meaningless split further.

## What would send the design back

- **Step 1**: if the percent-override slider's semantics turn out not to transfer cleanly onto
  `OverviewTab`'s existing schedule-derived-vs-manual-override display — i.e. `IssueFocus` and
  `OverviewTab` disagree about what "derived" progress means in a way that isn't a clean field
  addition. Surfaces immediately, the first time a real save is tried against an issue with
  rolled-up progress.
- **Step 2**: if the `requestEdit` effect and the existing tab-reset effect do not resolve in the
  order this plan assumes once actually run in a browser (both depend on `issue?.id`; declaration
  order is the whole argument, and React's actual batching is what decides it, not this document).
  Surfaces in Step 2's own interactive check #5 (switching tabs, then triggering Edit on a
  different issue) — if edit mode doesn't stick, this is the finding, and it means rethinking the
  mechanism (e.g. a single combined effect, or deriving `editing` from `requestEdit` directly
  instead of two effects racing), not patching around a timing issue.
- **Step 3**: if `Dialogs`' `CreateForm`'s `isIssue` branch, now live for the first time, is
  missing something `IssueFocus`'s create mode depended on that a read-through didn't surface —
  it has never actually run in production before this step. Surfaces in Step 3's own interactive
  check; if the created issue is wrong or the form is missing a field the log/reducer actually
  needs, this is a design gap in what was assumed to be a like-for-like swap, not an
  implementation bug in this plan's own new code (there is none in this branch of Step 3).
