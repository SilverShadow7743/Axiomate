# Rich content in descriptions and notes — implementation plan

Follows `docs/plans/2026-08-26-rich-content-design.md`, approved by the user. Quotes
below are that design's constraints, not restated from memory.

## A correction found while grounding this plan

The design doc's downstream-consumer list names `lib/outbound.ts:110`
(`outboundNoteBody`) as reading an existing rich note's body to compose a client email —
that's wrong, checked directly rather than carried forward. `outboundNoteBody(resolved,
text)`'s `text` parameter is fresh plain text typed into the separate "reply to client"
box (`app/api/mail/send/route.ts:49`, `const text = (body.text ?? '').trim()`), never a
stored `IssueNote.body`. What actually happens: the route composes a plain string
(`noteBody`) and constructs an `addNote` **action** directly with `body: noteBody`
(line 155) — bypassing the UI form entirely. `lib/outbound.ts` itself needs no change;
`app/api/mail/send/route.ts` does, because it writes a note with a plain string in a
field that is about to stop being one. This is folded into Step 3 below, not treated as
a downstream reader.

Grounding also found four more direct `addNote`/`updateIssue` action-construction sites
the design doc didn't know about, all with plain-string `body`/`description` literals
that will fail to typecheck once the field types change:

- `scripts/persistence-proof.ts` (lines 289, 694-695, 1032-1033, 1067, 1100, 1146, 1163)
  and `scripts/attribution-proof.ts` (line 56) — this project's own persistence and
  attribution proof scripts (`npm run audit:persistence`, `npm run audit:attribution`),
  real verification infrastructure this session's QA report cites (27/27, 3/3). These
  are fixed in Step 3, not left broken — a broken proof script is a false "still
  passing" the next time someone runs it without reading the output closely.
- `scripts/repair-markup.ts:163` and `scripts/stop-personal-intake.ts:132` (plus a
  `.length` read on `issue.description` at `stop-personal-intake.ts:126`) — both read as
  one-time remediation utilities already run against production (an HTML-markup cleanup
  and a specific OTP-redaction incident response), not scripts anyone re-runs routinely.
  Step 3 confirms which with the user rather than guessing, and only fixes them if
  they're still live tooling — no point maintaining a script that already did its job.

## Step 1 — Pure rich-doc utilities

**Files:** new `lib/richText.ts`, `scripts/scenario-validation.ts`.

A closed TypeScript type for the document shape — not an open `any`-shaped Tiptap JSON,
a specific union covering exactly what this design needs and nothing speculative:

```ts
export type RichNode =
  | { type: 'doc'; content: RichNode[] }
  | { type: 'paragraph'; content: RichNode[] }
  | { type: 'text'; text: string; marks?: ('bold' | 'italic')[] }
  | { type: 'table'; content: RichNode[] /* tableRow[] */ }
  | { type: 'tableRow'; content: RichNode[] /* tableCell | tableHeader */ }
  | { type: 'tableCell' | 'tableHeader'; content: RichNode[] }
  | { type: 'image'; attrs: { documentId: string; alt?: string } }
  | { type: 'mention'; attrs: { personId: string } }
  | { type: 'issueReference'; attrs: { issueId: string } }
export type RichDoc = { type: 'doc'; content: RichNode[] }
```

Functions, all pure:

- `emptyRichDoc(): RichDoc` — `{ type: 'doc', content: [{ type: 'paragraph', content: [] }] }`.
  **Empty content array, not a text node with `text: ''`** — ProseMirror's schema
  disallows zero-length text nodes; a doc built the second way is one Tiptap refuses to
  load, not merely a cosmetic difference. This exact shape is also what Step 2's
  migration SQL must produce for an originally-empty string.
- `wrapPlainText(text: string): RichDoc` — one paragraph, one text node, unless `text`
  is empty, in which case the same empty-content-array rule applies.
- `isEmptyRichDoc(doc: RichDoc): boolean` — true when there is no text content and no
  image/mention/reference node anywhere in the tree. Replaces every `!body.trim()` /
  `!description.trim()` check.
- `richDocsEqual(a: RichDoc, b: RichDoc): boolean` — structural equality
  (`JSON.stringify(a) === JSON.stringify(b)` is sufficient; these are small
  user-authored documents, not a case needing a diff algorithm). Replaces every
  `a !== b` field-diff check on these two fields specifically.
- `richTextToPlainText(doc: RichDoc): string` — walks the tree; text nodes concatenate;
  `image` renders as `[image: <name looked up from the Document, or "attachment" if
  unresolved>]`; `mention` renders as `@<person name, looked up, or "someone" if
  unresolved>`; `issueReference` renders as the bare issue id; a `tableRow`'s cells join
  with " | ". Used by every plain-text consumer in Step 4, and by Step 3's audit-reason
  truncation and mail-send composition.
- `mentionedPeopleIn(doc: RichDoc): string[]` — collects every `mention` node's
  `personId`, deduplicated. Replaces `mentionsIn(body, people)`'s role in `addNote`/
  `updateNote` for notification-minting. `lib/mentions.ts`'s existing string-based
  `mentionsIn`/`mentionSegments` are untouched — they may still serve other plain-string
  fields elsewhere in the app; this is a new, parallel function, not a replacement of
  the old one everywhere.

New scenarios (id prefix check first — `grep -n "^  'RC[0-9]'" scripts/scenario-validation.ts`
to confirm `RC` is free, the same discipline that caught the `TG`/`TK` collision earlier
this session):

- **RC1** — `emptyRichDoc()` and `wrapPlainText('')` both produce a paragraph with an
  empty content array, not a zero-length text node; `isEmptyRichDoc` reports both as
  empty.
- **RC2** — `wrapPlainText('hello')` round-trips through `richTextToPlainText` back to
  `'hello'`; a hand-built doc mixing text, an `image` node, a `mention` node, and an
  `issueReference` node produces the exact expected concatenated plain-text rendering
  (proves the extractor's per-node-kind behavior, not just the trivial case).
- **RC3** — `richDocsEqual`: two structurally-identical-but-distinct-object docs compare
  equal; a one-character text difference compares unequal; a hand-built doc containing a
  table with two rows produces the expected `" | "`-joined plain text.
- **RC4** — `mentionedPeopleIn`: a doc with two distinct `mention` nodes for the same
  `personId` returns that id once (dedup, matching `mentionsIn`'s own existing
  once-however-often-repeated behavior); a doc with no mention nodes returns `[]`.

**Verify:** `npx tsc --noEmit`, then `npm run validate:scenarios` — `RC1`-`RC4` new and
`PASS`, full suite still `0 FAIL`. Stands alone as one commit — a type and its utilities
with no caller yet, exactly the "provable before anything depends on it" case this
project's own plans keep front-loading.

## Step 2 — Schema migration

**Files:** `prisma/schema.prisma`, a new migration under `prisma/migrations/`.

`Issue.description` (`prisma/schema.prisma:212`, currently `String @db.Text`) and
`IssueNote.body` (`prisma/schema.prisma:484`, currently `String @db.Text`) become
`Json`. **Touch only these two columns** — `prisma/schema.prisma` has an unrelated
`body String @db.Text` at lines 702 and 817 (different models) and an unrelated
`description String @db.Text` at line 1426 (different model); the migration SQL must
name `Issue` and `IssueNote` explicitly, not rely on a column-name-only match.

This is a genuine content transform, not a type-nullability change like the estimation
migration — `ALTER COLUMN ... TYPE jsonb USING to_jsonb(description)` would wrap the raw
string as a JSON *string value* (`"the original text"`), not the paragraph-doc structure
every reader now expects. The migration builds the real structure in SQL:

```sql
ALTER TABLE "Issue" ADD COLUMN "description_new" JSONB;
UPDATE "Issue" SET "description_new" = jsonb_build_object(
  'type', 'doc',
  'content', jsonb_build_array(
    jsonb_build_object(
      'type', 'paragraph',
      'content', CASE WHEN description = '' THEN jsonb_build_array()
                 ELSE jsonb_build_array(jsonb_build_object('type', 'text', 'text', description))
                 END
    )
  )
);
ALTER TABLE "Issue" DROP COLUMN "description";
ALTER TABLE "Issue" RENAME COLUMN "description_new" TO "description";
ALTER TABLE "Issue" ALTER COLUMN "description" SET NOT NULL;
-- repeat the same four statements for "IssueNote"."body"
```

`jsonb_build_object`/`jsonb_build_array` handle the JSON string-escaping (quotes,
newlines, unicode) correctly with no manual escaping to get wrong — the same reason this
project's other migrations lean on real SQL doing the transform rather than a
side-script. The `CASE WHEN description = ''` branch is what keeps the empty-content-
array rule from Step 1 true in the migrated data too, not just in freshly-created docs.

**Before running:** count `Issue` and `IssueNote` rows, and — because the estimation
migration's safety argument rested on "every existing 0 could only ever mean one thing,"
this one needs its own version of that check — sample a handful of `description`/`body`
values directly and confirm they really are plain human-authored text, not something
already-JSON-shaped or corrupted that a blind string-wrap would mangle. Verify counts
and a content spot-check *after* the migration too, the same direct-database discipline
used for both the timesheet-grid and estimation migrations this session, not a
trust-the-migration-tool assumption.

**Verify:** `npx tsc --noEmit` will show new errors after this step — expected, and not
this step's concern to fix (every direct string-literal `body`/`description` write goes
red until Step 3). This step's own verification is the row-count/spot-check discipline
above, plus confirming the migration applies cleanly via `npx prisma migrate deploy`.

Stands alone as its own commit — real production schema and data, never bundled with
application code, matching this session's established convention for every prior
migration.

## Step 3 — The write path

**Files:** `lib/workspace.ts` (`addNote` at 3217, `updateNote` at 3344, `updateIssue` at
2217), `components/OverviewTab.tsx` (`save()` ~154-176), `components/NotesTab.tsx` (the
two guard conditions), `app/api/intake/route.ts` (lines 200, 242, 273),
`app/api/intake/form/route.ts` (lines 56, 91, 112), `lib/chat.ts` (362-364),
`app/api/mail/send/route.ts` (line 155), `scripts/persistence-proof.ts`,
`scripts/attribution-proof.ts`.

- **`addNote`** (3217): `a.body.trim()` → `isEmptyRichDoc(a.body)` for the empty-check;
  the audit-reason truncation (`body.length > 120 ? ... : body`, line 3253) truncates
  `richTextToPlainText(a.body)`, not the doc itself; `mentionsIn(body, people)` (3257)
  →`mentionedPeopleIn(a.body)`.
- **`updateNote`** (3344): same `.trim()`/empty-check swap; the changed-fields diff
  (3366-3368, `note[k] !== next[k]`) needs a per-field comparator — `richDocsEqual` for
  `body`, `!==` unchanged for every other field. Do not switch the whole diff to a deep
  comparator; only `body` needs it, and a blanket change risks quietly altering
  behavior for fields that were correctly using reference/primitive equality before.
- **`updateIssue`** (2217): no field-specific validation exists today (confirmed —
  generic patch merge), so this arm needs no logic change. `components/OverviewTab.tsx`'s
  `save()` is where the equivalent bug actually lives (`base[k] !== draft[k]`,
  ~line 158) — same fix as `updateNote`'s diff, scoped to the `description` key only.
- **`components/NotesTab.tsx`**: `disabled={!draft.trim()}` → `disabled={isEmptyRichDoc(draft)}`;
  `disabled={!editBody.trim() || editBody === n.body}` →
  `disabled={isEmptyRichDoc(editBody) || richDocsEqual(editBody, n.body)}`.
- **Both intake routes**: wrap plain email/form text into a rich doc via
  `wrapPlainText()` on the way in. `app/api/intake/form/route.ts` specifically: the one
  plain `description` string (line 56) is currently used **twice** — as a note body
  (line 91) and as the issue's description (line 112). Wrap it **once**, into one
  `RichDoc` value, and feed both destinations from that single value — two independent
  `wrapPlainText()` calls would still be correct today (both would produce
  identical output) but would silently drift the moment either call site's wrapping
  logic changes without the other, which is exactly the kind of duplication this
  project's own patterns (see `outboundNoteBody`'s own doc comment: "one function...
  so the two can never drift into comparing against a string the record was never
  actually written with") argue against.
- **`lib/chat.ts:362-364`**: the assistant's draft flow wraps whatever plain
  `description` it produces the same way, at the same two lines.
- **`app/api/mail/send/route.ts:155`**: `body: noteBody` → `body: wrapPlainText(noteBody)`.
  `noteBody` itself (`outboundNoteBody`'s output, composed at line 113) stays a plain
  string — only the value handed to the `addNote` action changes shape.
- **`scripts/persistence-proof.ts`, `scripts/attribution-proof.ts`**: every literal
  string `body:`/`description:`/`patch: { description: ... }` fixture becomes
  `wrapPlainText('...')`. These are real verification tooling
  (`npm run audit:persistence`, `npm run audit:attribution`), not throwaway scripts —
  fixed here, not left to bit-rot.
- **`scripts/repair-markup.ts`, `scripts/stop-personal-intake.ts`**: confirm with the
  user before this step whether either is still expected to run again (both read as
  completed one-time remediations against specific past incidents). Fix only if still
  live; a maintained fix for a script that will never run again is wasted precision.

**Verify:** `npx tsc --noEmit` clean across the whole tree (this is the step where every
error Step 2 introduced gets resolved — the count going to zero here is real signal, not
assumed), then `npm run validate:scenarios` — full suite `0 FAIL`, and specifically
confirm by name that `TV1`-`TV6` (fed by `lib/tree.ts`'s search string, itself fed by
`description`), any existing note/mention scenarios, and `EZ5` (estimator, which reads
`description`) still pass rather than silently stop exercising what they did before.

### The regression-risk step, named

This one. `addNote`, `updateNote`, and `updateIssue` are the reducer arms every note and
every issue edit in the live application already runs through today, correctly, and this
step changes their validation logic directly — not a new code path nobody has exercised
yet. The specific failure mode worth naming: `mentionedPeopleIn` replacing
`mentionsIn(body, people)` for notification-minting is a behavior change to something
that already works. If the new doc-walking version finds mention nodes the old
string-parser would have found (or the reverse — misses one, or finds a stale one a UI
bug left behind after an edit), the result is either somebody spammed with a ping that
means nothing, or somebody who should have been told about something on their issue
never finding out — and neither failure announces itself. Nobody sees an error message;
they just don't get pinged, or they get pinged wrong, and it surfaces days later as "why
didn't anyone tell me" rather than as a test failure. `RC4` covers the mechanism in
isolation; it cannot cover whether the *editor* (Step 5) reliably produces real
`mention` nodes for every case a person would expect a mention to register — that only
becomes checkable once the editor exists, which is one more reason this step's own
scenario coverage needs to be trusted as thoroughly as it can be before Step 5 adds the
one part that can't be scenario-tested at all.

This step is one commit — `addNote`/`updateNote`/`updateIssue`/both intake
routes/`chat.ts`/mail-send/the two proof scripts are all "the write path agreeing on
what these two fields now are," and splitting them further would leave some write paths
still expecting a string while others already expect a doc, which is a broken
intermediate state, not a smaller safe one.

## Step 4 — Downstream read consumers

**Files:** `lib/estimator.ts:242`, `lib/tree.ts:380`.

- `lib/estimator.ts`: `` `${issue.subject} ${issue.description} ${issue.module}`.toLowerCase() ``
  → `` `${issue.subject} ${richTextToPlainText(issue.description)} ${issue.module}`.toLowerCase() ``.
- `lib/tree.ts`: the same swap in the search-string builder (line 380).

Small and mechanical once Step 1's extractor exists — the only reason this is its own
step rather than folded into Step 3 is that Step 3 is already large enough to be its own
unit of regression risk, and these two are genuine *readers*, unlike everything in
Step 3, which is the *write* path.

**Verify:** `npx tsc --noEmit`, `npm run validate:scenarios` — confirm `TV1`-`TV6` and
`EZ5` specifically, plus any scenario that already exercises search-by-description-text,
still pass with description now round-tripping through the extractor rather than being
interpolated raw.

One commit — both are the same one-line-per-file fix, and there is nothing to gain by
separating them.

## Step 5 — The Tiptap editor UI

**Files:** new `components/RichTextEditor.tsx` (or similar), `components/OverviewTab.tsx`
(swap the description `<textarea>` for the new editor), `components/NotesTab.tsx` (swap
both the add and edit `<textarea>`s).

Last, and the only step requiring a browser — nothing else in this plan depends on it,
and it is the one part no scenario harness can verify. Covers: installing Tiptap and
confirming real React 19 compatibility (package.json currently pins `react: ^19.2.7`;
version numbers suggesting compatibility is not the same as it working once actually
wired up — this is exactly `EstimationTab.tsx`-style "confirmed by using it," not
assumed from a changelog); the base editor with paragraph/text/bold/italic; the table
extension (`@tiptap/extension-table` + row/cell/header); the `mention` and
`issueReference` custom inline nodes, each with a `#`/`@`-triggered suggestion popup
(`@tiptap/suggestion`) and each resolved live at render (status for `issueReference`,
name for `mention`) rather than baked in at save time; image paste/drop calling the
*existing* `uploadDocument(file, 'issue', subjectId, evidenceId)` path
(`components/IssueWorkspace.tsx:346`, the same call shape `components/EvidencePanel.tsx`
already uses at its own `<input type="file">` sites) rather than a second upload
mechanism.

**Verify:** `npx tsc --noEmit`, `npm run build`, then interactive browser verification
against the dev server, following this session's now-established checklist for this
codebase specifically:
1. `next dev` with `AXIOMATE_ENTRA_CLIENT_ID=` blanked for that process only.
2. **Unregister the Service Worker and clear `caches` before testing anything** —
   `navigator.serviceWorker.getRegistrations()` → `unregister()`, `caches.keys()` →
   `delete()`. This cost real time during the timesheet-grid work; do it first.
3. On a real issue: type a table, paste/drop an image and confirm it appears in the
   issue's own Documents list (not just inline), type `@` and confirm a real person
   resolves and renders live, type `#` and confirm a real issue resolves and renders its
   live status, confirm typing emoji (literal unicode) works with no special handling
   needed, save, reload, and confirm everything round-trips through Step 2's storage
   format unchanged.
4. Confirm the client-boundary rule from the design's own dedicated section: a
   reference chip inside a client-visible note, pointing at an issue that is *not*
   itself client-visible, renders inert (bare id, no live status) when viewed through
   `clientView()` — this needs an actual client-pack render to check, not just the
   normal internal view, since that is precisely the code path the design identifies as
   the risk.
5. **This dev server points at the real production database.** Any issue/note touched
   during this verification is real production data — clean up afterward through the
   app's own actions (edit back to original content, or withdraw a test note), confirmed
   by direct database query, the same discipline used for both the timesheet-grid and
   estimation features' test data this session.

## What would send the design back

- **If Tiptap's real React 19 compatibility breaks in practice once wired up in Step 5**
  (not just theoretically fine per version numbers, which is all that's confirmed as of
  writing this plan) — this would mean picking a different editor or a different
  version pin, a real architecture change, not a bug to patch around. Surfaces at the
  start of Step 5, as early as the editor renders anything at all.
- **If the `mention`/`issueReference` custom-node architecture turns out not to coexist
  cleanly in the same Tiptap schema** (e.g. a real conflict in how the two inline node
  types interact with suggestion-popup triggering, or with the table extension) — this
  would mean the "two parallel custom nodes" decision made while writing this plan was
  wrong, and needs to go back to design rather than be forced to work in Step 5.
- **If Step 2's pre-migration content spot-check finds `description`/`body` values that
  are not actually plain text** — already-JSON-shaped, corrupted, or otherwise not what
  the schema's own type claims — the "every existing value is safely wrappable plain
  text" assumption this migration rests on is wrong, and the migration needs new
  handling for whatever was actually found, not just more SQL bolted onto the same
  assumption.
