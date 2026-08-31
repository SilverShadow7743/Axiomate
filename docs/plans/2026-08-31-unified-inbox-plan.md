# Unified Work Inbox — implementation plan

Follows `docs/plans/2026-08-31-unified-inbox-design.md` (approved 2026-08-31). Ordering
principle: pure logic first, and within "pure logic," the riskiest piece — `decisionItems`'s
extraction from `myWork()` — goes before the genuinely new `waitingItems` logic, even though
extraction sounds like the safer of the two. It isn't: `myWork()` is scenario-pinned (`MW1`,
`TD1`) and this project has a real, named precedent for a refactor silently changing behavior
(`axiomate-refactoring`'s own worked example). A wrong extraction is provable wrong immediately,
before `waitingItems`, the component, or the mount depend on it being right.

Verified against the current files while writing this — two things shifted from the design
doc's estimates, both confirmed by reading the actual code, not assumed:

- `lib/mywork.ts`'s decide block is now lines **203-289** inside `myWork()` (shifted +1 from the
  design doc's 202-288 estimate — the `todaysMeetings` addition earlier today added a line
  above it). Five sub-blocks: approvals 206-222, timesheets-to-approve 224-237,
  milestones-to-accept 239-255, changes-to-decide 257-270, scope-to-agree 272-289.
- **The Inbox.tsx reuse mechanism, unresolved in the design, is now decided**: mount `<Inbox
  ... docked />` WHOLE, unmodified, as the FYI section's content inside `UnifiedInbox` — not an
  extracted sub-component. `Inbox.tsx`'s `docked` branch (lines 148-154) already renders
  self-contained content (header, list, mark-all-read, the undelivered banner, preferences) in
  `<div className="view-dock"><div className="menu inbox-menu docked">{content}</div></div>` —
  reusing the whole component gets full functional parity (preferences, undelivered banner,
  mark-all-read) with zero risk of `Inbox.tsx`'s internals being "too entangled to extract,"
  because nothing is extracted. `UnifiedInbox` will NOT re-wrap this in its own `.view-dock` —
  that wrapper is `Inbox`'s own docked-mode chrome, and `UnifiedInbox` needs exactly one
  `.view-dock` at its own root, not two nested ones.

## Steps

### Step 1 — `decisionItems()` extraction, `lib/mywork.ts`

⚠ **The step carrying the most regression risk in this plan.** `myWork()`'s decide block
closes over `person`, `name`, `mine`, `isMe`, `isMine`, `holds`, and `roles` — all defined at
lines 187-201, ABOVE the decide block, and `isMine` is used again later in the file (line 294,
the own-work loop: `isMine(issue.owner, issue.ownerId)`). Extracting `decisionItems` as a
standalone exported function means it CANNOT close over `myWork()`'s local variables — it must
recompute `person`/`mine`/`isMe`/`isMine`/`holds`/`roles` internally (roughly the same 8 lines,
duplicated once). This is deliberate, not an oversight: sharing these via a third helper
function both callers pass around would touch more of `myWork()`'s structure than this feature
needs to. If the reducer's `today` handling changes here even slightly (e.g., resolving `person`
differently, or computing `roles` against different state), every `decide` item — the group
`myWork()`'s own docstring calls "the only thing here that is holding up another person,"
sorted first for that reason — silently changes for every user, in whoever's queue it appears.

Extract lines 203-289 into:

```ts
export function decisionItems(state: WorkspaceState, actor: Actor): WorkItem[] {
  const person = directoryPersonFor(state.model, actor)
  const name = (person?.name ?? actor.name ?? '').trim()
  const mine = name.toLowerCase()
  const holds = (key: Parameters<typeof can>[2]) => can(state.model, actor, key).allowed
  const isMe = (who: string | null | undefined) => (who ?? '').trim().toLowerCase() === mine
  const isMine = (who: string | null | undefined, whoId?: string | null): boolean =>
    whoId ? person?.id === whoId : isMe(who)
  const roles = new Set(rolesFor(state.model, actor))
  const items: WorkItem[] = []
  // ...the five sub-blocks, verbatim, pushing into `items` instead of `myWork`'s outer one...
  return items
}
```

(No `today` parameter — the decide block, read carefully, does not use `today` anywhere in its
five sub-blocks; every date shown is `requestedAt`/`submittedAt`/`deliveredAt`/`when: null`, not
a comparison against "now." Confirm this while extracting — if a `today`-dependent line is found
inside the block that wasn't visible in this reading, add the parameter rather than silently
dropping the comparison.)

`myWork()` itself changes to `const items: WorkItem[] = [...decisionItems(state, actor)]` at
the point the inline block sat, then continues unchanged (own-work loop, hours loop, sort).

**Verify:** `npx tsc --noEmit` → a new scenario (id following this file's convention, e.g. `UI1`)
asserting `decisionItems(state, actor)` — run standalone — produces exactly the item set
`MW1`'s existing fixture expects from `myWork()`'s decide group (same keys, same order within
the group, same `why` text) → `npm run validate:scenarios`: `MW1` and `TD1` must show
UNCHANGED verdicts (still `PASS`), and the new scenario shows `PASS` — this is the regression
proof. Total scenario count: 193 → 194.

**Commit 1** — this step alone, exactly per the ordering principle: provable correct in
isolation before `waitingItems`, the component, or the mount depend on `decisionItems` existing.

### Step 2 — `waitingItems()` and `unifiedInbox()`, new file `lib/inbox.ts`

```ts
export function waitingItems(state: WorkspaceState, actor: Actor): WorkItem[] {
  // person/mine/isMe/isMine, recomputed here too — this file has no access to mywork.ts's
  // internals either, and importing directoryPersonFor directly is correct, not a shortcut.
}

export function unifiedInbox(state: WorkspaceState, actor: Actor, today: string) {
  const person = directoryPersonFor(state.model, actor)
  return {
    needsAction: decisionItems(state, actor),
    waiting: waitingItems(state, actor),
    fyi: inboxFor(state.notifications, actor.name, person?.id ?? null),
  }
}
```

`waitingItems` mirrors four of `decisionItems`'s five sources with the exclusion flipped to an
inclusion (per the design's explicit table): approvals where `isMe(a.requestedBy) && !a.decision`;
timesheets where `isMine(t.person, t.personId) && t.status === 'Submitted'`; milestones where
`isMe(m.deliveredBy) && m.acceptance === 'Pending'`; changes where `isMe(c.requestedBy) &&
c.status === 'Submitted'`. Scope items are NOT included — no mirror, per the design's explicit,
honest exclusion (no requester field on `ScopeItem` to flip).

**Verify:** `npx tsc --noEmit` → a new scenario (e.g. `UI2`) covering, per source: an item the
actor raised/delivered/submitted and still pending appears in `waiting`; the same item does NOT
appear once decided/accepted/approved; a pending scope item is confirmed absent from `waiting`
regardless of who raised it (a `PASS` scenario documenting the honest exclusion, not a gap) →
`npm run validate:scenarios`: count 194 → 195, all prior verdicts unchanged, `UI2` `PASS`.

**Commit 2** — standalone. Depends on nothing from Step 1 except the `WorkItem` type and
`decisionItems` not needing to change; nothing after this step depends on `waitingItems`'s
internals beyond its return shape.

### Step 3 — `components/UnifiedInbox.tsx`

Three sections in one docked view:

```
UnifiedInbox
├── (own .view-dock wrapper — the only one; Inbox's own is not double-wrapped, see below)
├── Needs Action — .mywork-group-style rows (reuse .evi-item / .mywork-tag idiom, same as
│     MyWorkPanel's own rows), click-to-select via the existing requestSelect-style prop
├── Waiting — same row idiom, same click-to-select
└── FYI — <Inbox state={state} actor={actor} onRead={onRead} onReadAll={onReadAll}
           onOpen={onOpen} onSetPref={onSetPref} docked /> mounted directly, unmodified
```

Props: `state`, `actor`, `today`, `onSelect` (Needs Action / Waiting row clicks — same contract
`MyWorkPanel` already uses), plus every prop `Inbox` itself needs (`onRead`, `onReadAll`,
`onOpen`, `onSetPref`) passed straight through to the nested `<Inbox docked />` — `UnifiedInbox`
does not intercept or wrap these, it is a pass-through for the FYI section.

**The unresolved-actor case** (design's Error Handling section): reuse
`MyWorkPanel.tsx`'s exact banner text, confirmed verbatim at its current location —

```tsx
{unrecognised && (
  <p className="cfg-readonly" role="status">
    Work is found by name, and “{matchedName}” is not in the directory. This is an
    empty list because the join failed, not because there is nothing to do.
  </p>
)}
```

— rendered above Needs Action/Waiting when `decisionItems`/`waitingItems` resolve to nobody
(check via the same `directoryPersonFor(state.model, actor)` call `unifiedInbox` already makes,
not a third resolution). `Inbox`'s own FYI section handles its own unresolved-actor case
independently (it already does, via `meId`) — do not add a second banner for it.

**Verify:** `npx tsc --noEmit` → `npm run audit:a11y` (new markup: labeled regions for the three
sections, no color-only signal on Needs Action/Waiting rows — reuse `MyWorkPanel`'s existing
patterns exactly, which already pass this gate) → `npm run build`. `validate:scenarios` count
unchanged from Step 2 (195) — this step is pure UI, no new domain logic to pin.

**Commit 3** — standalone. Depends on Steps 1-2's functions existing; nothing depends on this
component's exact markup.

### Step 4 — mount swap + sidebar label, `components/IssueWorkspace.tsx` + `components/AppSidebar.tsx`

`IssueWorkspace.tsx:2158` — replace the `<Inbox state={...} actor={...} onRead={...}
onSetPref={...} onReadAll={...} onOpen={...} docked />` mount with `<UnifiedInbox state={...}
actor={...} today={...} onSelect={...} onRead={...} onSetPref={...} onReadAll={...}
onOpen={...} />` (same prop values, new component, plus `today` and `onSelect` which the
existing call site's surrounding scope already has — `requestSelect` or its equivalent is
already in scope at this point in the file, confirm the exact prop name in use).

`AppSidebar.tsx:31` — `inbox: 'Notifications'` → `inbox: 'Inbox'`.
`AppSidebar.tsx:42` — `inbox: 'What the rules have told you, and what never left the
building'` → a title reflecting the fuller view (e.g. "What needs you, what's waiting on
someone else, and what the rules have told you") — wording is an implementation-time
judgment call, not load-bearing; keep it short.

**Verify:** `npx tsc --noEmit` → `npm run audit:a11y` → `npm run build`. `validate:scenarios`
count unchanged (195) — a mount swap and a label string carry no domain logic.

**Commit 4** — standalone. Lower risk than "Today"'s landing-rule step (this doesn't change a
default for every user — it changes what's already-navigable content behind an existing sidebar
entry), but still isolated: if the FYI-nested-`<Inbox>` approach reads wrong once assembled,
this commit is the one to revert while Steps 1-3's real logic stays intact and usable from a
future retry at the component layer alone.

### Step 5 — staged deploy

This project's established recipe: `git archive` the combined commits → fresh dir → `npm ci` →
`npx prisma generate` → `npm run build` → package via `scripts/package-release.py` → `az webapp
deploy` → health poll until the response BODY shows `"database":"connected"`.

**Live walkthrough after deploy** (same constraint as the "Today" feature's Step 4 — signing in
requires the user's own Microsoft account, so this is the fallback checklist):

1. Sidebar shows "Inbox," not "Notifications."
2. Needs Action shows the same items that would appear in My Work's `decide` group for the
   signed-in account (the known, accepted overlap — confirm it's the SAME items, not a
   different set, which would indicate the extraction diverged).
3. Waiting shows anything the account has raised/delivered/submitted and is still pending —
   empty is a valid, expected result for an account that hasn't raised anything.
4. FYI section behaves exactly as the old Notifications view did — mark-all-read, preferences,
   the undelivered banner if applicable — since it's the same component, unmodified.
5. Clicking a Needs Action or Waiting row navigates correctly; clicking an FYI row still routes
   per `Inbox`'s existing `onOpen` logic (meeting → My calendar, discussion → Discussion tab,
   etc.).

**Commit boundary:** no code change in this step — deploy only, after Commits 1-4 all land.

## Details most likely to be gotten wrong

- **`decisionItems` must not take a `today` parameter it doesn't use** — confirmed by reading
  the block that none of the five sub-blocks compare against "now," but re-verify this exact
  claim while extracting; if wrong, the fix is adding the parameter, not silently dropping a
  needed comparison.
- **Don't double-wrap `.view-dock`** — `Inbox`'s own `docked` branch already renders one;
  `UnifiedInbox` needs exactly one at its own root, around all three sections, not a second one
  wrapping just the nested `<Inbox />`.
- **`Inbox`'s "Notifications" heading stays** — mounting it unmodified means its internal `<b>
  Notifications</b>` header renders inside the FYI section. This may read as a mildly redundant
  "FYI" / "Notifications" heading stack — a real, minor cosmetic detail, not a defect; resolve
  at implementation time by either accepting it or having `UnifiedInbox` skip its own FYI
  section label and let `Inbox`'s heading serve alone. Do not modify `Inbox.tsx` itself to
  remove its heading — that would break its now-orphaned non-docked (dropdown) call sites if any
  remain, and the design's whole point for this section is zero modification.
- **`isMine`/`isMe`/`holds`/`roles` recomputed, not shared** — both `decisionItems` and
  `waitingItems` independently call `directoryPersonFor` and rebuild these closures. This is
  correct, not accidental duplication to "clean up" — see Step 1's risk note.
- **The known overlap is a feature of this plan, not a bug to fix during implementation** — do
  not add code to deduplicate `decide` items between My Work and the new Inbox; the design
  explicitly chose Approach A over Approach B for this reason.

## What would send this back

- Everything the design doc's own "What would send this back" section already names (the
  overlap reading as confusing; the scope-item exclusion mattering in practice) — both surface
  only after Step 5's live walkthrough, since neither is checkable by the gate.
- If Step 1's extraction scenario (`UI1`) cannot be made to match `MW1`'s existing expectations
  exactly, that is not a bug to patch around — it means the decide block has a dependency on
  `myWork()`'s surrounding scope this plan didn't find, and the design's "extraction, not new
  logic" premise needs re-examining before proceeding to Step 2.
