# Global search — implementation plan

Executes `docs/plans/2026-08-30-global-search-design.md` (approved 2026-08-30). Ordering:
the pure module and its scenario land before the daily-driven toolbar is touched; the deploy
and a production-fluidity check come last. The plan exists to stop the details below being
got wrong — chiefly that the search box already does a job every user relies on every day.

Ground truth verified while writing:

- The toolbar box is `filters.search` (IssueWorkspace.tsx:1899–1902), part of `FilterState`,
  feeding `matchesFilters`/`visibleRows` — the LIVE row-filter path. The dropdown is
  additive; this path is not edited.
- Row opening goes through the dirty-checking select handler around IssueWorkspace.tsx:649
  (`setSelectedId` guarded by unsaved-changes) — hits use THAT handler, never raw state.
- `DetailPanel` owns its tab as internal `useState<Tab>('Overview')` (DetailPanel.tsx:296) —
  no preselection prop exists. **V1 opens the anchor record on its default tab**; tab
  targeting is not invented for this phase.
- `redactForReader` (lib/db/boot.ts:287) is NOT exported and lib/db is `server-only` — the
  suite runs plain `tsx` and would crash importing it (the persistence proof needs
  `--conditions=react-server` for exactly this). GS1 therefore composes the SAME pure
  primitives boot composes — `clientView` (lib/clientBoundary.ts) + `redactLeaveReasons`
  (lib/availability.ts) + a rates/skills strip — and states that boot's own composition stays
  pinned by inspection. Extracting a pure `redactForReader` for both callers is a worthwhile
  follow-up REFACTOR, deliberately not smuggled into a search phase.
- Corpus shapes: `InboundMail {from, subject, body, receivedAt, issueId}` (lib/intake.ts:61);
  `DocumentRecord {name, subjectKind, subjectId}` (lib/documents.ts:53); `Meeting {title}`
  (lib/meetings.ts:21); issues/notes/people as already catalogued.
- `clientView` zeroes `inboundMail` WHOLESALE (clientBoundary.ts:129) and filters documents
  to visible ones — so for a client-seated reader, mail hits are impossible structurally and
  the GS1 mail check asserts exactly that.

Standing gates per commit: `npx tsc --noEmit` → `npm run validate:scenarios` (188 → **189**,
0 FAIL) → `npm run audit:a11y` (0 errors) → `npm run build` before deploy. No server code, no
tables, no reducer arms — the four data audits stay untouched by construction. Scenario
splice via temp file + python at the section-10 banner marker; `data/validation.json` rides
the scenario commit.

---

## Step 1 — `lib/search.ts` (pure)

New file. Exports:

```ts
export type SearchKind = 'issue' | 'note' | 'mail' | 'document' | 'person' | 'meeting'
export interface SearchHit {
  kind: SearchKind
  id: string
  /** What the UI opens: the issue for note/mail/document-on-issue hits, the record itself otherwise. */
  anchorId: string | null
  title: string
  /** ~90 chars around the first match; [matchStart, matchEnd) offsets into snippet for highlighting. */
  snippet: string
  matchStart: number
  matchEnd: number
  score: number
}
export function searchWorkspace(state: WorkspaceState, query: string, today: string): SearchHit[]
```

Rules, in the order the code applies them:

1. Tokenize the query (lowercase, split on whitespace, drop empties). Fewer than 1 token or
   every token under 2 chars → `[]` (no one-letter scans).
2. Corpus per record kind, with field weights — issue: id (10) subject (8) owner/nextAction
   (4) evidence/clientImpact/reference/source (2); note: body (3), anchored to its issue;
   mail: subject (4) from (3) body (2), anchored via `issueId` (null anchor = unfiled mail —
   still listed, opens nothing); document: name (4), anchor = `subjectId` when
   `subjectKind === 'issue'`; person: name (6) email (4), anchor null; meeting: title (4).
3. **ALL tokens must match somewhere on the record** (across its fields); score = sum of the
   best field weight per token + a recency tilt (`lastActivity`/`receivedAt`/`date` within
   14 days of `today` adds 2, within 60 adds 1). Deleted rows (`deletedAt`) excluded
   everywhere.
4. Sort by score desc then recency desc; cap 50. Snippet from the highest-weight matched
   field, ~90 chars centred on the first match, offsets carried for highlighting.

Verify: `npx tsc --noEmit` clean. (Functional verification is Step 2 — the module has no
caller yet, which is the point.)

## Step 2 — GS1 (same commit)

Splice `scenario('GS1', ...)` before the section-10 banner. Two halves:

**Relevance:** on a fixture built from BASE plus planted notes/mail/documents/meetings —
an id query ranks the issue above a note whose body also matches; a two-token query matches
only records carrying both; a deleted issue and a deleted entry never appear; a broad query
caps at 50; a one-letter query returns nothing.

**Boundary composition — the design's whole point, refined from its sketch:**

- Plant sentinels REACHABLE by the corpus: an internal note body (`SENTINEL-NOTE-GS`) on a
  client-visible issue, an internal-only record subject (`SENTINEL-REC-GS`), a mail body
  (`SENTINEL-MAIL-GS`), an internal document name (`SENTINEL-DOC-GS`).
- Search the RAW state: all four found (proves the corpus reaches them).
- Apply the reader cut a client seat gets — `clientView(state, scopeId)` — and search again:
  **all four absent** (note filtered, record dropped, inboundMail zeroed wholesale,
  document filtered). Then `redactLeaveReasons` + rates/skills strip and assert a rate
  amount and a leave reason are absent too — with the honest structural note that rates and
  commitments are not corpus stores at all, so this half is a one-line invariant, not a
  near-miss.

Verify: `npx tsc --noEmit && npm run validate:scenarios` → **189 scenarios, 0 FAIL**, GS1
PASS with a driven actual.

**Commit 1**: `lib/search.ts` + GS1 + `data/validation.json`.

## Step 3 — ⚠ the toolbar dropdown (most regression risk)

**This step carries the phase's regression risk, and here is why: the search box drives live
row-filtering for the whole grid and is used every day. The box's existing semantics —
`filters.search` → `setFilters` → `matchesFilters` — must be byte-identical after this
change; the dropdown is purely additive. A keystroke regression here lands on every user on
every workday. The guard: the input's `value`/`onChange` lines are not edited at all; the
dropdown reads `filters.search` and renders beside it.**

- `components/SearchResults.tsx` (new): takes `hits` grouped by kind + the highlight offsets;
  `role="listbox"`/`role="option"` + `aria-selected` (the mention-list pattern that passed
  the a11y gate), arrow keys move, Enter opens, Escape closes.
- IssueWorkspace wiring: debounce `filters.search` ~150 ms into `searchWorkspace(state,
  query, today)` via `useMemo` + deferred value; dropdown shows when the box has ≥2 chars
  and focus; opening a hit calls the EXISTING dirty-checked select handler with `anchorId`
  (and closes the dropdown); hits with null anchor (people, unfiled mail) render
  non-interactive with their snippet. `aria-expanded` on the search container. The empty
  state names the corpora searched and says discussion messages are server-side and not yet
  included (the design's honesty line).

Verify: `npx tsc --noEmit && npm run validate:scenarios` (189 — UI cannot move a verdict)
`&& npm run audit:a11y` (0 errors) `&& npm run build`.

**Commit 2**: SearchResults + IssueWorkspace wiring.

## Step 4 — staged deploy + live verification

The staged FOREGROUND recipe (archive → ci → generate → build → package-release → migrate
status "up to date" → `az webapp deploy` → health `"database":"connected"`).

Live, in order:

1. Row-filtering unchanged: type a term, confirm the grid narrows exactly as before, with
   the dropdown open AND after Escape closes it.
2. Cross-entity reach: search a known subject fragment, a note body phrase, a mail-log
   sender, a person's name, a document name (if the store has any) — each appears in its
   group; Enter opens the anchored record.
3. Fluidity on production data: typing stays smooth over the full ~260-issue state (the
   design's send-back trigger; the 34 ms buildTree baseline says a linear scan will not lag,
   but this is where it is measured, not assumed).
4. Read-only feature — nothing to clean up.

**Commit 3**: live-found fixes only, each through the full gate.

---

## Details most likely to be got wrong

1. The input's `value={filters.search}` / `onChange` lines are NOT edited — the dropdown is
   additive, and the row-filter path stays byte-identical.
2. Opening a hit goes through the dirty-checking select handler (~IssueWorkspace:649), never
   raw `setSelectedId` — or unsaved detail edits get silently dropped.
3. ALL query tokens must match per record (across fields), or multi-word queries degrade
   into noise.
4. Deleted rows excluded in every corpus, not just issues.
5. GS1's boundary half applies the PURE primitives (`clientView`, `redactLeaveReasons`,
   strip) — importing lib/db/boot.ts crashes the plain-tsx suite on `server-only`.
6. Mail hits anchor via `issueId` which is nullable — a null anchor renders, but opens
   nothing rather than throwing.
7. DetailPanel has no tab preselection — v1 opens the record's default tab; do not invent
   the prop mid-phase.
8. Debounce the SEARCH computation, not the filter write — the grid must keep narrowing at
   full keystroke speed.
9. The a11y roles copy the mention-list listbox pattern that already passes the gate — no
   `eslint-disable`, and no comment in an expression slot (the parse error from last time).
10. Scenario splice via temp file + python; `data/validation.json` rides commit 1;
    timestamp-only audit-output diffs reverted.

## Commit boundaries

| Commit | Contents | Gate |
|---|---|---|
| 1 | lib/search.ts + GS1 + validation.json | tsc; scenarios 189/0 FAIL |
| 2 | SearchResults.tsx + IssueWorkspace wiring | tsc; scenarios; a11y 0; build |
| 3 | live-found fixes only | full gate + live checks |

## What would send the design back (with where each surfaces)

- Typing measurably lags over production state → a memoized per-boot index (a refactor
  inside lib/search.ts), not a server move. Surfaces at Step 4.3.
- The thing people actually search for is discussion messages → the v2 server-side design
  opens properly with its own redaction proof. Surfaces in use, not in this plan.
- The follow-up refactor worth doing on its own: extract boot's `redactForReader` into a
  pure module imported by both boot and the suite, so GS1's composition and boot's are the
  same code path. Noted, not smuggled in here.
