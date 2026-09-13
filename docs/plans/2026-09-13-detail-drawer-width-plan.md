# Detail drawer width — implementation plan

Follows `docs/plans/2026-09-13-detail-drawer-width-design.md`. No pure-logic-first ordering
here — unlike Resourcing/Commercial/Client Milestones, there is no data shape or reducer path
to prove with a scenario; this is component state and CSS width classes, verified by reading
the change and then confirming it in a browser. The four touched files are tightly coupled
(a shared prop's shape changes across all of them at once), so this is one implementation
step, not several independently-provable ones.

## 1. The width plumbing, across all four touched files together

- **`components/DetailDrawer.tsx`**: define and export `export type DrawerWidth = 'standard'
  | 'wide' | 'full'`. Replace the `wide: boolean` prop with `width?: DrawerWidth` (default
  `'standard'` via a default parameter, not `?? 'standard'` scattered at call sites). Class
  string becomes `` `drawer${width !== 'standard' ? ` ${width}` : ''}${bladeOpen ? ' blade-open' : ''}` ``
  — `wide`/`full` are mutually exclusive by construction (one `width` value, not two
  booleans), so there is no combined-class case to worry about, unlike `blade-open` which can
  still combine with either.
- **`app/globals.css`**: add `.drawer.full { width: 100vw; }` immediately after the existing
  `.drawer.wide` rule (~line 1536) — later in source order than `.drawer.blade-open`
  (~1508) and `.drawer.wide`, matching the file's own existing convention for which rule wins
  when a future change ever does combine two of these classes on one element.
- **`components/IssueWorkspace.tsx`**:
  - `drawerWide`'s `useState(false)` (~2048) becomes `useState(() => typeof window !==
    'undefined' && window.innerWidth >= 900)` — lazy initializer, evaluated once on mount,
    matching the app's existing 900px desktop line (`app/globals.css` mobile-nav breakpoint).
  - New `const [drawerFull, setDrawerFull] = useState(false)`.
  - Inside `requestSelect` (~820-834): add `if (id !== selectedId) setDrawerFull(false)` —
    the single funnel every selection change already passes through, so this covers opening
    a different record and closing without a second effect.
  - `DetailDrawer` call site (~2898): `wide={drawerWide}` becomes `width={drawerFull ? 'full'
    : drawerWide ? 'wide' : 'standard'}`.
  - `SnapshotDrawer` call site (~3301): `wide={false}` becomes `width="standard"` — mechanical,
    no new capability offered there (unchanged from the design's own note).
  - `DetailPanel` call site (~2971-2974): add `full={drawerFull}` and `onToggleFull={() =>
    setDrawerFull((v) => !v)}`.
- **`components/DetailPanel.tsx`**: add `full: boolean` and `onToggleFull: () => void` to
  `Props` (beside `panelState`/`onSetPanel`, ~102-109). Add a third button in
  `.panel-controls` (~611-625), after the existing ⤢/⤡ button, same shape (`btn ghost`,
  `disabled={panelLocked}`, `⛶` glyph both states — a filled/outline pair isn't available in
  the existing icon vocabulary, so title/aria-label carry the state instead of the glyph):
  ```tsx
  <button
    className="btn ghost"
    onClick={onToggleFull}
    disabled={panelLocked}
    title={panelLocked ? 'The detail pane is not shown on this tab' : full ? 'Exit full-screen' : 'Full-screen this issue'}
    aria-label={full ? 'Exit full-screen detail' : 'Full-screen detail'}
  >
    ⛶
  </button>
  ```
  Also fix the existing ⤢ button's tooltip text in the same edit (design doc's own copy
  note): `'Restore normal height'` → `'Restore normal width'`, `'Expand the detail pane'` →
  `'Widen the detail pane'`.

**Verified by:** `npx tsc --noEmit` (catches every remaining `wide=` call site the type
change missed — the compiler, not a grep, is the real check here since a missed site fails
to compile rather than silently rendering wrong) and `npx eslint` on the four files, both
clean; `npm run validate:scenarios` re-run, byte-identical `data/validation.json` (no reducer
or lib logic touched, confirmed rather than assumed).

**The detail most likely to be got wrong:** the `requestSelect` reset must check `id !==
selectedId`, not just `id !== null` — closing (`id === null`) should also reset `full`
(nothing is open to be full-screen), but the naive `if (id) setDrawerFull(false)` would skip
resetting on close and leave a stale `true` waiting for the next open. The design's own
"reset on record change, not persisted" line is only actually true if this check covers
close as well as switch.

**Manual verification (no scenario possible for pure CSS state):** in a browser, at a
genuine ≥900px width — open a record, confirm it opens wide (92vw) without needing to click
anything; click ⛶, confirm it goes to 100vw and Tree/Board is still there underneath
(unaffected, not unmounted); click ⛶ again, confirm it returns to wide, not standard: `wide`
was never touched by the `full` excursion. At a genuine <900px width — open a record, confirm
it opens standard-width, exactly as it does today (no regression for the case the design
didn't change). Switch to a different record while wide or full — confirm `full` resets,
`wide` does not.

## Commit

One commit — the type/prop change and the CSS rule are one indivisible unit; there is no
meaningful halfway point between them (the app would not compile with only one side done).

## What would send the design back

- If the 900px desktop check reads wrong on a real device this app is actually used on (a
  tablet in landscape, say, where "wide by default" might feel cramped rather than roomy) —
  would mean the breakpoint itself needs revisiting, not the mechanism. Not expected: 900px is
  already this app's own established line for "not a phone," used by the nav-burger fix.
- If `full` turns out to want its own persisted preference after real use (a person who
  always wants full-screen, every issue) — the design's "reset per record" call was made from
  the request's own wording ("when the user needs to focus," read as situational), not from
  a preference-persistence conversation; if that reading is wrong, `full` gains a stored
  preference the same shape as `wide` could have but doesn't need today.
