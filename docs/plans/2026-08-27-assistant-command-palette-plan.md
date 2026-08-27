# Repositioning the Assistant as a command palette — implementation plan

Follows `docs/plans/2026-08-27-assistant-command-palette-design.md`, approved by the user through
several rounds of questions during the design conversation (engine-aware over a single reskin,
full command-palette reskin over a copy-only fix or a form-builder, overlay+`Ctrl/Cmd+K` over
keeping the docked panel, keep-scrollback over single-result, keep voice/drop TTS, extend search
to real facets).

No test runner exists for `lib/chat.ts` today. `npm run validate:scenarios`
(`scripts/scenario-validation.ts`) is a static source-inspection harness — it greps file text for
patterns ("mentions"/"absent" checks), it does not call `offlineReply`/`searchIndex` with real
input. Confirmed by grep: zero matches for `offlineReply`, `searchIndex`, or `chat` as a function
call anywhere in `scripts/scenario-validation.ts`. Every pure-logic step below is therefore
verified by a standalone `npx tsx` script, written against a stated test matrix, run once, and
deleted — the same throwaway-diagnostic-script pattern already used elsewhere this session
(`scripts/tmp-check-*.ts`). None of this plan's steps add real test coverage to the repo; that is
a gap in the codebase, not something in scope to fix here.

## Step 1 — Real facets in the search branch

**Files:** `lib/chat.ts` only.

Pure logic, no React, no callers yet — the design's own instruction to prove this before anything
depends on it.

- Add a new, small alias map distinct from `FIELD_ALIASES` (which is scoped to `PatchableField`,
  the update vocabulary — `module`/`client`/`health` are not patchable fields and have no place in
  it): `SEARCH_FACET_ALIASES: Record<string, keyof SearchArgs>` = `{ status: 'status', state:
  'status', severity: 'severity', priority: 'severity', owner: 'owner', assignee: 'owner',
  module: 'module', client: 'client', health: 'health', schedule: 'health' }`. Exactly the aliases
  the design doc names — do not invent additional synonyms it didn't approve.
- A new exported pure function, e.g. `parseSearchQuery(raw: string): { facets: SearchArgs; text:
  string }`, called from the search branch of `offlineReply` (the `else` arm, currently `const
  query = raw.replace(/^(?:find|search|show|list|look\s+up|get)\s+/i, ''); const hits =
  searchIndex(index, { text: query })`) in place of building `{ text: query }` directly.
- **The real open question, per the design doc's own "what would send this back":** whether
  scanning for `key=value` tokens anywhere in the string collides with genuine free text
  containing a bare `=` or `:`. The update branch never had to solve this because it only looks
  at text *after* a matched issue id, where the ambiguity doesn't arise — the search branch has no
  such anchor. Decide this here, not in the UI: write the test matrix below, run it, and if a
  plausible free-text query breaks, the resolution is narrowing the token pattern (e.g. requiring
  no surrounding whitespace inside the token, or requiring the value side to match a known enum
  for closed-vocabulary fields before consuming it) — a real design decision, made here with
  evidence rather than guessed at.

**Verify:** a temporary `scripts/tmp-verify-search-facets.ts` (`npx tsx
scripts/tmp-verify-search-facets.ts`, deleted after) exercising `parseSearchQuery` directly against
at least:
- `"status=Open severity=High"` → facets `{status:'Open', severity:'High'}`, text `''`.
- `"payroll status=Open"` → facets `{status:'Open'}`, text `'payroll'`.
- `"GRN posting fails"` (no facets) → facets `{}`, text unchanged — proves today's plain search is
  not regressed.
- `"foo=bar reconciliation"` (unrecognised key) → left as free text, not silently dropped and not
  an error — search never rejects the way update does.
- A free-text case chosen to stress the real risk named above, e.g. `find "ratio = 2:1" in the
  reconciliation notes` — record what the current design produces and confirm it is a deliberate
  decision, not an accident.
Then `npx tsc --noEmit` clean.

One commit. This changes `/api/chat`'s real search behavior for any caller today, including the
still-unmodified docked chat UI — it does not need Step 3's UI to be useful or shippable on its
own.

## Step 2 — Extract a shared command classifier

**Files:** `lib/chat.ts` only.

Second piece of pure logic, needed before Step 4's hint line can reuse `offlineReply`'s own
grammar rather than duplicating it — the design doc's other named risk.

Reading `offlineReply` closely turns up two near-duplicate create-verb regexes already: the
autonomy-gate check `looksLikeMutation` (`/^(?:new|create|log|raise|add)\s+(?:an?\s+)?(?:issue|ticket)\b/i`,
no capture) and the create branch's own match (`/^(?:new|create|log|raise|add)\s+(?:an?\s+)?(?:issue|ticket)\b(.*)$/i`,
capturing the rest). `ID_RE` (`/\b([A-Z]{2,10}-\d{1,4})\b/i`) is module-private today (`const
ID_RE`, no `export`).

- Export `ID_RE` as-is.
- Add one shared `export const CREATE_VERB_RE = /^(?:new|create|log|raise|add)\s+(?:an?\s+)?(?:issue|ticket)\b/i`
  (the non-capturing form). Both `looksLikeMutation` and the create branch's `raw.match(...)` are
  rewritten to use it — `looksLikeMutation` calls `CREATE_VERB_RE.test(raw)`, the create branch
  extracts the rest of the string separately (`raw.replace(CREATE_VERB_RE, '')`, since the
  original capture group is no longer available from a shared non-capturing pattern) rather than
  re-matching. This is a pure refactor: `offlineReply`'s branching behavior must be provably
  unchanged, not rewritten.
- Add `export function classifyCommand(raw: string): 'create' | 'update' | 'search' { ... }`
  containing exactly the three tests `offlineReply` already runs in order: `CREATE_VERB_RE.test(raw)`
  → `'create'`; else `ID_RE.test(raw) && /[=:]/.test(raw)` → `'update'`; else `'search'`. Empty
  input is the caller's concern (today's `if (!raw)` greeting branch), not the classifier's —
  it returns `'search'` for an empty string, and callers decide what to do with that.
- `offlineReply` calls `classifyCommand` for its own branch selection instead of re-testing the
  regexes inline, so there is exactly one place this grammar's shape is expressed.

**Verify:** extend the Step 1 script (or a new `scripts/tmp-verify-classifier.ts`, `npx tsx
scripts/tmp-verify-classifier.ts`) to run `classifyCommand` and full `offlineReply` side by side
against `examplesFor()`'s own real example strings from `components/ChatPanel.tsx` (`'find
overdue inventory issues'`, `'OAPIL-010 status = In Progress'`, `'new issue OAPIL/Inventory: GRN
posting fails'`) plus a few partial/incomplete strings the hint line will actually see keystroke
by keystroke — `'n'`, `'new'`, `'new i'`, `'OAPIL-'`, `'OAPIL-01'` — confirming `classifyCommand`
returns a sane value (never throws) at every partial length, since `offlineReply`'s regexes were
only ever exercised before against complete, submitted messages, not partial ones. Then `npx tsc
--noEmit` clean, and re-run Step 1's script to confirm the refactor didn't change its results.

One commit. Provably behavior-preserving for `offlineReply`; `classifyCommand` has no caller yet
outside the verification script until Step 4.

## Step 3 — Engine-aware branch, overlay shell, and the basic command loop

**Files:** `components/ChatPanel.tsx`, `components/IssueWorkspace.tsx`, `app/globals.css`.

This is the step carrying the most regression risk in this plan. `ChatPanel`'s existing render —
docked panel, bubbles, textarea, voice, TTS toggle — is a code path that works correctly today for
whatever this component's audience actually is; the branch condition being added
(`assistant.engine === 'claude'` vs `'offline'`) decides, per request, whether that exact JSX
renders unchanged or a brand-new presentation renders instead. Get the condition backwards and a
`'claude'` deployment silently gets the new offline-only command UI (with no facet-search
narrative, no tool loop, nothing that engine needs) or an `'offline'` deployment keeps seeing the
old chat UI this whole project exists to replace — either way, nothing throws, nothing errors, it
is just wrong, and it is wrong in a way a tester unfamiliar with this change might read as "the
redesign looks unfinished" rather than "the routing is inverted."

- `ChatPanel`'s existing body (state, `send()`, `apply()`, and the full JSX return) is untouched
  and kept as the render path for `props.engine === 'claude'` — literally the component as it
  exists today, wrapped in that condition, not rewritten.
- A new sibling render path for `props.engine === 'offline'`: a centered overlay portaled to
  `document.body` (`typeof document === 'undefined' ? null : createPortal(...)`, the same guard
  `MyWorkPanel`/`PortfolioPanel` use), using `useOverlay(rootRef, true, onClose)`
  (`components/useOverlay.ts`) for focus-trap/Escape/inert-background — `ChatPanel` uses none of
  this today (today's `.chat` is `position: fixed; right: 16px; bottom: 16px`, a corner box with
  no scrim and no focus trap at all, confirmed at `app/globals.css:2966`). New CSS: a
  `.cmdk-scrim`/`.cmdk` pair modeled on `.modal-scrim`/`.modal`'s existing centered-overlay
  pattern, not on `.chat`'s fixed-corner one.
- The `send()`/`apply()` logic (the fetch to `/api/chat`, the client-side re-validation via
  `validateUpdate`/`validateCreate`, the `claimed` double-submit guard) is shared between both
  presentations, not duplicated — factor it out of the current single-return component into a
  hook or plain functions both branches call, so Step 1/2's grammar changes and the existing
  Claude-mode behavior both go through the identical apply path they do today.
- Minimum viable offline UI for this step only: single-line `<input>` (not the textarea) wired to
  the shared `send()`, a compact result log (command text + result, monospace, no bubbles — new
  `.cmdk-entry` styling, not `.chat-turn`/`.chat-bubble`), the syntax-reference onboarding in place
  of `greeting()` (reusing `examplesFor()`'s existing strings as clickable templates, same
  `send(e)` wiring already there today). Proposal cards keep the existing `.chat-card`/
  `.chat-diff` styling and `apply()`/`claimed` behavior verbatim — only their container changes.
  No hint line yet (Step 4), no autocomplete yet (Step 5) — those depend on this shell existing
  and are separable, testable additions on top of it.
- `IssueWorkspace.tsx`'s keyboard effect (`onKey`, currently handling only `Escape` for `dialog`)
  gains a `Ctrl/Cmd+K` branch that calls the same handler the "Assistant" button's `onClick` does
  (`setChatOpen((v) => !v)`), gated by the identical condition the button's own visibility already
  uses — `assistantOffered !== 'off'`. Wiring the shortcut to fire unconditionally, ignoring that
  gate, is the detail most likely to be gotten wrong here: the button already hides itself when
  the agent registry has the assistant off (`IssueWorkspace.tsx:1930`,
  `{assistantOffered !== 'off' && (...)}`), and a keyboard path that bypasses that check would be
  a real behavior divergence between mouse and keyboard, not a cosmetic one.

**Verify:** `npx tsc --noEmit` clean. `npm run build` clean. `npm run validate:scenarios` — confirm
167/167 unchanged (this change touches no reducer/scenario-covered path, but the run itself is the
check that nothing else broke). Then the full clean-room deploy this session has used for every
prior change (`git archive HEAD` to a scratch dir, copy `.env`, `npm ci`, `npx prisma generate`,
`tsc`, `build`, `scripts/package-release.py` with `--extra .next/static:.next/static --extra
public:public`, `npx prisma migrate status` to confirm nothing pending, `az webapp deploy`).
Live in the browser, against this deployment (confirmed `'offline'` in production already, per
the header badge from item #8):
1. Click "Assistant" → the new overlay opens, centered, with a scrim, not the old corner-docked
   panel.
2. Press `Ctrl/Cmd+K` from anywhere in the app (tree, board, an open detail panel) → same overlay
   opens.
3. Escape closes it; clicking the scrim closes it (via `useOverlay`'s existing Escape wiring and
   whatever click-away this step adds).
4. Run one command of each real verb: a plain search, a `<real-id> status=In Progress` update, and
   a `new issue <client>/<module>: <subject>` create — confirm each produces a result-log entry
   and that the update/create proposals still render as Apply/Dismiss cards that work.
5. Confirm the scrollback holds all of the above at once (per "keep scrollback," not
   single-most-recent).
**The Claude-mode branch cannot be exercised live on this deployment** — no `ANTHROPIC_API_KEY` is
set, confirmed this session. Verify it by code inspection only: confirm the branch condition is
`props.engine === 'claude'` (not `!== 'offline'`, not inverted), and diff the JSX under that branch
against `ChatPanel.tsx` as it existed immediately before this step to confirm it is byte-for-byte
unchanged. If a local dev override of `assistant.engine` (e.g. a temporary hardcoded value in
`app/page.tsx` while running `npm run dev` locally, reverted before committing) is practical to
force-render that branch for a manual look, do it — but this is not a substitute for the diff, and
it is not a real end-to-end Claude API call either way.

One commit. The engine branch, the shared `send()`/`apply()` extraction, and the minimum offline
shell are one connected change — splitting the extraction from the branch that uses it would leave
an intermediate state where the shared logic exists but nothing new consumes it, which verifies
nothing.

## Step 4 — The live hint line

**Files:** `components/ChatPanel.tsx`, `app/globals.css`.

Depends on Step 2's `classifyCommand` and Step 3's shell existing; adds to both without touching
either's tested behavior.

- The offline input's `onChange` calls `classifyCommand` (imported from `lib/chat.ts`) on every
  keystroke and renders its result as a small hint line below the input: `'create'` → "New issue",
  `'update'` → "Change `<ID>`" (only once `ID_RE` actually matches — before that, the neutral
  "this reads as a search" state), `'search'` → the same neutral state. Before any typing, the
  hint line is empty (the syntax reference above the input already documents the grammar — no
  redundant idle-state copy).
- No new parsing logic here — this step is purely `classifyCommand`'s result rendered live, per
  Step 2's own verification that it tolerates partial input without throwing.

**Verify:** `npx tsc --noEmit` clean, `npm run build` clean. Live in the browser: type each of the
three verb patterns character by character and confirm the hint updates correctly and never
flashes an incorrect state or throws a console error partway through typing (this is the one
behavior Step 2's script could only approximate — a real `onChange` firing on real keystrokes,
including fast typing/paste, is the actual check).

Stands alone — additive to Step 3's shell, independently meaningful (the hint is useful on its
own before autocomplete exists), and reverting it if wrong would not touch Step 3's basic loop.

## Step 5 — Autocomplete

**Files:** `components/ChatPanel.tsx`, `app/globals.css`.

- Trigger 1: once the input contains an uppercase-looking id fragment (reuse `ID_RE`, matched
  against a partial prefix), show a small dropdown of matching ids from `props.index` (already a
  client-side prop — no new plumbing, no server round-trip).
- Trigger 2: once the input matches `<ID> ... field=` where `field` resolves to a closed-vocabulary
  field (`status`, `severity`, or `accountable` when `props.config.parties` is non-empty), show its
  legal values from `enumsFor(props.config)` — also already available client-side.
- Both are keyboard-navigable (arrow keys to move, Tab/Enter to accept into the input at the
  cursor position), matching the interaction `TreeGrid`'s inline cell editors already use — not a
  new interaction pattern.
- Neither trigger can suggest a value `offlineReply`/`validateUpdate` would then reject, since both
  read from the exact same `enumsFor`/`index` the server-side validation uses — this is presenting
  values the grammar already accepts, not a second source of truth to keep in sync.

**Verify:** `npx tsc --noEmit` clean, `npm run build` clean. Live: type a real issue id prefix,
confirm the dropdown lists real matches and Tab/Enter accepts one; after a real id, type
`status=`, confirm the dropdown lists the real configured status values and accepting one produces
a value the eventual `Change` command actually applies (run it through to a real Apply, then
revert the test change through the app's own actions — this dev/prod-pointed session's standing
rule, since this points at the real production database).

Stands alone — additive to Step 4, no behavior of Steps 3/4 depends on it existing.

## Step 6 — Voice: keep input, drop read-aloud

**Files:** `components/ChatPanel.tsx`.

Most isolated step in this plan — touches neither the grammar (Steps 1–2) nor the shell/hint/
autocomplete (Steps 3–5) in any way that those depend on.

- The offline presentation's `VoiceInput` instance is wired to the single-line input's value
  (`onTranscript` sets it and calls the shared `send()`, same as today's wiring to the textarea).
- The "Read replies aloud" checkbox and its `speechSynthesis`/`speakableReply` call
  (`ChatPanel.tsx`'s `send()`, the `speakReplies` branch) are **not rendered** for the offline
  presentation — the Claude-mode branch (Step 3) keeps this exactly as it is today, since Step 3's
  own verification already confirmed that branch is untouched.

**Verify:** `npx tsc --noEmit` clean, `npm run build` clean. Live: dictate a search phrase via
voice in the offline overlay, confirm it populates the input and can be sent; confirm no "Read
replies aloud" control renders anywhere in the offline overlay.

Stands alone.

## What would send the design back

- **Step 1**: if the facet-token-stripping genuinely cannot be made to avoid colliding with
  plausible free-text queries containing `=`/`:` — the design doc names this as a real risk, not a
  formality, and the test matrix is what actually answers it. Surfaces immediately, before any
  other step depends on `parseSearchQuery`.
- **Step 2**: if `classifyCommand` cannot be written to run cleanly against partial, mid-typing
  input without a shape of special-casing that starts to look like a second grammar rather than an
  extraction of the existing one. Surfaces in Step 2's own partial-string test cases, before any UI
  is built against it.
- **Step 3**: if the shared `send()`/`apply()` extraction turns out not to be a clean lift — e.g.
  if the Claude-mode branch's behavior depends on some detail of the current single-component
  structure (closure state, render timing) that splitting the two presentations disturbs. Surfaces
  in Step 3's own Claude-mode code-inspection check: if the "byte-for-byte unchanged" diff isn't
  actually clean, that is the finding, and it means the extraction needs a different shape, not
  that the diff should be waved through.
- **Step 5**: if the two autocomplete triggers turn out to interact badly with `useOverlay`'s
  focus-trap (built for a handful of static controls, not a live-updating dropdown) — e.g. Tab
  landing on a suggestion instead of wrapping per the trap's existing Tab-wrap logic. Surfaces in
  Step 5's own interactive check; the design doc names this as worth confirming rather than
  assuming, and this is where it gets confirmed.
