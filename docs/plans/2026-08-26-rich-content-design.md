# Rich content in descriptions and notes

## Problem

The request: "add table, Image, emoji and reference other ticket with its status in the
description of the issue. Similarly for notes, and comments." Investigation settled
"comments" as meaning Notes (no distinct comment feature exists) — the request is really
two fields: `IssueRecord.description` (`lib/workspace.ts:229`) and `IssueNote.body`
(`lib/notes.ts:49`), both plain strings today. The note field's own doc comment is a
standing decision this design directly reverses: *"Plain text. Structured prose beats a
rich-text editor nobody asked for yet."*

## Editor and storage format

[Tiptap](https://tiptap.dev) (ProseMirror-based) is the editor. It supports custom inline
node types, which the ticket-reference feature below requires, and has first-class React
bindings.

Content is stored as **Tiptap's JSON document format, not HTML**. This is close to a
forced choice, not a preference: the codebase has zero HTML-sanitization precedent
anywhere — no DOMPurify, no `sanitize-html`, no `dangerouslySetInnerHTML` — and its one
existing posture toward untrusted HTML (`lib/intake.ts`'s `htmlToText`, which strips
inbound mail HTML down to plain text rather than rendering it) is refusal, not
sanitization. A JSON document constrained to a defined Tiptap schema (paragraph, table,
image, a small set of text marks, and the custom reference node below) cannot carry a
`<script>` tag the way an HTML string can: rendering it is walking a typed tree with a
known, closed set of node kinds, not parsing markup. This avoids building this
codebase's first sanitizer rather than adding one.

`IssueRecord.description` and `IssueNote.body` both change type from `string` to the
Tiptap JSON document shape (a `JSON` column, matching the pattern `EstimateStep`'s
`steps: Json` already uses elsewhere in this schema).

## Tables, images, emoji

- **Tables**: `@tiptap/extension-table` (with `table-row`, `table-cell`, `table-header`)
  — the standard, maintained extension, not a custom build.
- **Images**: pasted or dropped images upload through the *existing* document pipeline
  (`lib/documents.ts` — 25MB cap via `MAX_UPLOAD_BYTES`, extension blocklist, already
  proven in production). The editor stores a reference to the resulting `Document`
  record, not a raw blob — an embedded image stays visible in the issue's own Documents
  list too, rather than living in a second, editor-only store nothing else can see.
- **Emoji**: no dedicated infrastructure needed. Once real rich-text editing exists,
  literal unicode emoji types and pastes into it like any other text (no different from
  typing an emoji into today's plain `<textarea>`). A picker button is a small,
  independently addable UI convenience, not a data-model or storage concern, and is
  deliberately left out of this design's scope — nothing about it is blocked by
  anything else here, so it can be added later without touching storage, migration, or
  any of the consumers below.

## Ticket references

A custom Tiptap inline node, `issueReference`, whose only stored attribute is
`{issueId}` — never a cached subject or status, for the same reason `@mention`
(`lib/mentions.ts`) never bakes in a resolved name: a stored copy of a fact that changes
is a copy that goes wrong.

Typing `#` opens a suggestion popup (`@tiptap/suggestion`, the extension mechanism this
already exists for) searching real issues by id/subject, so nobody has to type an exact
id from memory. Selecting one inserts the node. At render time — every time, not once at
save — the chip resolves the current issue's live status by looking it up in workspace
state, the same "resolved fresh, never stale" principle `mentionSegments` already
established for `@mentions` in `NotesTab.tsx`.

### The client-boundary interaction — a real, easy-to-miss risk

`lib/clientBoundary.ts`'s `clientView()` already filters *whole* notes by
`clientVisible` (`lib/clientBoundary.ts:77-79`). That filtering happens at the note
level. A reference chip embedded *inside* a client-visible note, pointing at an issue
that is **not** itself part of what that client may see, would leak that issue's live
status to the client if the chip resolved naively — a new, narrow but real hole in a
boundary this project has otherwise been careful about.

The rule this design commits to: **in any client-facing render path (currently the
weekly/monthly client packs; any future client portal), a reference chip resolves live
status only if the referenced issue is itself in that client's visible set for the
relevant scope.** If it is not, the chip renders inert — the bare id, no status, no
link — rather than resolving. This check reuses `clientView()`'s own visibility logic
rather than reimplementing a second copy of it, for the same reason the rest of this
project keeps one source of truth per rule.

## Migration

Every existing plain-text `description` and note `body` — 216+ issues' worth in the real
production register, plus however many existing notes — is converted in one migration to
a trivial single-paragraph rich document carrying that exact text. One shape going
forward; no dual plain-string/rich-document rendering path anywhere afterward.

## Downstream consumers — five, not one

These currently read `description`/note `body` as plain strings and will break silently,
not loudly, if hand-fed a JSON object instead. All five route through one shared
`richTextToPlainText()` extractor (walks the document tree, concatenates text-bearing
nodes, represents an image as a bracketed placeholder and a reference node as its plain
issue id) rather than five separate, drifting hacks:

1. **`lib/estimator.ts:242`** — `proposeEstimate` text-matches
   `` `${subject} ${description} ${module}`.toLowerCase() `` against its rule set. Needs
   the extractor in place of raw string interpolation.
2. **`lib/tree.ts:380`** — the Tree view's own search/filter box concatenates
   `description` into its match string. Same fix.
3. **`lib/outbound.ts:110`** — `outboundNoteBody` composes a note's body directly into an
   **outbound client email**, today as plain text. This design keeps outbound mail
   plain text — the extractor renders the rich note down to text, rather than the app
   growing an HTML-email rendering path, which would be a second new rendering/security
   surface on top of the first.
4. **`app/api/intake/route.ts`** (mail intake) and **`app/api/intake/form/route.ts`**
   (the client-facing intake form) both currently set `description` from plain email or
   form text. Both need to wrap that plain text into a trivial rich document on the way
   in — the mirror image of the migration, applied to every new record from here on
   rather than a one-time backfill.
5. **`lib/chat.ts:362-364`** — the assistant's issue-creation draft flow reads/writes
   `draft.description` as a plain string today. Needs the same wrap-on-the-way-in
   treatment as intake, since the assistant produces plain text, not a rich document.

## Explicit scope note

This is substantially larger than any other feature built this session: a new
dependency, a new stored format replacing a plain string on two widely-read fields, a
real production data migration, and coordinated changes across five existing consumers
plus the two edited fields' own read/write paths. It will need a correspondingly large
phased implementation plan, not a two- or three-step one.
