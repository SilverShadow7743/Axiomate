# Owner is exactly the firm's own people — implementation plan

Follows `docs/plans/2026-09-14-owner-org-only-design.md`. One function's policy plus mechanical
call-site cleanup — no reducer or data-shape change, so this is a single commit, ordered so the
pure logic and its test prove themselves before the UI call sites that depend on it are touched.

## 1. `lib/ownerChoices.ts` — drop the client group and `anchorId`

- Delete `clientNodeOf` entirely (its only caller outside this file, `IssueWorkspace.tsx`'s
  `bulkOwnerOptions`, stops needing it in step 3).
- `OwnerChoices` interface: remove `client: Person[]`, keep `team: Person[]` and
  `unlisted: string | null`.
- `ownerChoicesFor(state, current)`: drop the `anchorId` parameter. Body becomes: filter active
  people, `team = active.filter((p) => !isClientSeat(p)).sort(byName)`, `unlisted` computed
  exactly as today against `team` only (drop the `[...team, ...client]` union — it's just `team`
  now). Return `{ team, unlisted }`.
- `ownerOptionValues`: drop `...choices.client.map((p) => p.name)`.
- Rewrite the file's doc comment (5-29): keep the dated 12 Sep history as-is, add a closing
  paragraph recording the 14 Sep reversal — the Client group existed to let a client contact be
  named as owner; Nishant reversed that ("owner field will be exactly people from our
  organization"), so `ownerChoicesFor` is single-group from 14 Sep on, and `client` is not a
  degenerate always-empty field kept for shape parity, it's gone.

**Verified by:** `npx tsc --noEmit` will now fail loudly at every call site still passing three
arguments or reading `.client` — that failure list is step 2/3's checklist, not a surprise.

## 2. `scripts/scenario-validation.ts` — rewrite the OWN1-area scenario

- Update the `ownerChoicesFor` calls (2448, 2454, 2455, 2458, 2462) to the two-argument form.
- Remove the second client node setup (2431-2434, `'Other Co'`) — it existed solely to prove
  cross-client seats aren't offered, which is moot once no client seats are ever offered.
- Rewrite the `expected` string (2427) and the assertion body: assert `team` names only
  non-client active people (reuse the existing team-membership check), assert a client-seat
  person's name is never present in `ownerOptionValues(...)`'s flat list regardless of anchor,
  and keep the dual-owner (`unlisted`) assertions — `dual.unlisted` still carries "Michael Thomas
  (POS) / Amolak (D365)", `settled`/`unassigned` still resolve to `null` — since that behavior is
  unchanged and is the one edge this change must not regress.
- Run `npm run validate:scenarios`. Confirm `data/validation.json`'s diff touches only this one
  scenario's row (`expected`/`actual` text) — per the design, this is the one time the diff is
  not required to be empty/additive, so review it by eye rather than trusting `--stat`.

**Verified by:** `npm run validate:scenarios` passes; `git diff data/validation.json` read in
full, confirmed to touch only the one scenario row.

## 3. Call sites — mechanical two-argument update

- `components/Dialogs.tsx:44` — `ownerChoicesFor(state, value)`; delete the dead
  `{choices.client.length > 0 && (...)}` optgroup block (~61-63) and its surrounding client-only
  JSX.
- `components/DetailPanel.tsx:1497` — `ownerChoicesFor(state, issue.owner)`; delete the matching
  optgroup block (~1635-1637); update the doc comment at 1493 that names `ownerChoicesFor`'s
  client resolution.
- `components/IssueWorkspace.tsx`:
  - Line 10: drop `clientNodeOf` from the import.
  - `bulkOwnerOptions` (1070-1081): replace the whole block with
    `const bulkOwnerOptions = useMemo(() => ownerOptionValues(ownerChoicesFor(state, null)), [state])`
    and delete the doc comment above it describing the old client-agreement logic (replace with
    a one-line note if the "why null" still needs saying — a bulk reassign has no single row to
    scope by, so it always resolves the org-wide list).
  - Line 1114 (per-row `ownerOptionsFor`): `ownerOptionValues(ownerChoicesFor(state, row.owner))`.
- `components/QuickEditPopover.tsx` and `components/SelectionToolbar.tsx`: update whichever
  passes an anchor id into `ownerChoicesFor` (found via the same `tsc` failure list); their doc
  comments referencing `ownerChoicesFor`'s shape get the one-line correction if they name
  `client` specifically.

**Verified by:** `npx tsc --noEmit` clean; `npx eslint components/Dialogs.tsx
components/DetailPanel.tsx components/IssueWorkspace.tsx components/QuickEditPopover.tsx
components/SelectionToolbar.tsx lib/ownerChoices.ts scripts/scenario-validation.ts` clean.

## The detail most likely to be got wrong

`bulkOwnerOptions`'s `useMemo` dependency array currently includes `selectedRows` (needed only
for the old client-agreement check). Dropping it to `[state]` is correct here — but if a future
edit re-adds any per-row logic to this function without also re-adding `selectedRows` to the
deps, that's a stale-closure bug waiting to happen. Worth a one-line comment at the `useMemo`
saying the dependency list must grow back the day this function reads anything per-row again.

## Commit

One commit — `lib/ownerChoices.ts`, the scenario rewrite, and every call site are one indivisible
unit; a partial version (e.g. the lib change without the call-site updates) doesn't compile.

## Manual verification

No scenario reaches JSX. After the commit: open Add Work — Owner shows only the firm's people,
no "Client" heading anywhere in the list. Open an existing issue that sits under a client node
(any OAPIL record) — the field-strip Owner select shows the same: team only. Select several rows
and use the bulk-reassign toolbar's Owner control — same list, no client names, works regardless
of whether the selection spans multiple clients (the exact case the old `sharedAnchor`/team-only
fallback used to special-case — now there's nothing to special-case, it's always team-only).

## What would send the design back

- If `tsc` surfaces a caller of `ownerChoicesFor`, `clientNodeOf`, or `.client` this plan's grep
  didn't find — stop and re-read the design's "not touched" list before deciding whether it's in
  scope; don't silently widen the change to cover it without checking it isn't one of the
  deliberately-untouched local re-declarations (`ProfilePanel.tsx`, `resolutionNotice.ts`).
- If the scenario rewrite can't cleanly assert "never offered regardless of anchor" without
  reintroducing a second client node — would mean the design's claim that anchor is now
  meaningless was wrong, and needs revisiting before this ships, not worked around in the test.
