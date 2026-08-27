/**
 * Rich content — a closed document shape for descriptions and notes, and what a caller can do
 * with one without a browser.
 *
 * ---------------------------------------------------------------------------
 * Why closed, not "whatever Tiptap happens to produce"
 *
 * `RichNode` names exactly the node and mark kinds this design needs — paragraph, text with
 * bold/italic, table and its three parts, image, mention, issueReference — and nothing else.
 * An open `Record<string, unknown>` shape would accept anything the editor ever emits, including
 * node kinds nobody has reviewed for what they can carry. Rendering a closed type is walking a
 * known tree; rendering arbitrary JSON is trusting whatever shipped in the client bundle that
 * produced it. See docs/plans/2026-08-26-rich-content-design.md for why this stands in for the
 * HTML-sanitization pipeline this codebase has never needed until now.
 *
 * ---------------------------------------------------------------------------
 * The empty-content-array rule
 *
 * ProseMirror's own schema refuses a text node with `text: ''` — ContentMatch has nothing to
 * match a zero-length text node against. `emptyRichDoc` and `wrapPlainText('')` both produce a
 * paragraph with an EMPTY content array, never a text node carrying an empty string. The
 * migration that backfills existing plain-text data has to keep this same rule, or it produces
 * documents Tiptap loads as broken rather than as blank.
 */

export type RichMark = 'bold' | 'italic'

/**
 * Node shapes here are the real output of `editor.getJSON()`, verified against the installed
 * Tiptap packages before this type was changed to match (see the spike this comment replaces
 * in git history) — not a guess. Two things a hand-authored schema would get wrong by default:
 *
 * - `paragraph.content` is optional, not a required empty array. ProseMirror omits the key
 *   entirely on a truly empty paragraph (`{"type":"paragraph"}`, no `content` at all) rather
 *   than emitting `content: []` — the two parse back to the identical document, but only one of
 *   them is what the editor actually writes.
 * - `text.marks` is an array of `{ type: 'bold' }` objects, never bare strings.
 * - `tableCell`/`tableHeader` always carry `attrs` (colspan, rowspan, colwidth, align) — this
 *   isn't cosmetic metadata to strip at the boundary, it's what a merged or resized column
 *   *is*; stripping it would silently undo a real edit on save.
 */
export type RichNode =
  | { type: 'paragraph'; content?: RichNode[] }
  | { type: 'text'; text: string; marks?: { type: RichMark }[] }
  | { type: 'table'; content: RichNode[] }
  | { type: 'tableRow'; content: RichNode[] }
  | {
      type: 'tableCell' | 'tableHeader'
      attrs?: { colspan: number; rowspan: number; colwidth: number[] | null; align: string | null }
      content?: RichNode[]
    }
  | { type: 'image'; attrs: { documentId: string; alt?: string } }
  | { type: 'mention'; attrs: { personId: string } }
  | { type: 'issueReference'; attrs: { issueId: string } }

export interface RichDoc {
  type: 'doc'
  content: RichNode[]
}

/** A blank document — the paragraph exists so there is somewhere to type, its content does not. */
export function emptyRichDoc(): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
}

/** One paragraph holding `text` verbatim, or a blank document when `text` is empty. */
export function wrapPlainText(text: string): RichDoc {
  if (!text) return emptyRichDoc()
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/**
 * Structural equality. `JSON.stringify` is enough here — these are small, user-authored
 * documents (a description, a note), not a case that needs a real diff algorithm, and object
 * key order is stable because every writer in this codebase builds these the same way (object
 * literals, never spread-reordered).
 */
export function richDocsEqual(a: RichDoc, b: RichDoc): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Tiptap's own JSON, normalised to this module's canonical empty-paragraph shape.
 *
 * `editor.getJSON()` omits `content` entirely on a truly empty paragraph — proven equivalent to
 * an empty content array once ProseMirror re-parses it, but not byte-equal, which matters for
 * `richDocsEqual`'s storage-vs-fresh-edit comparisons and for `emptyRichDoc`/`wrapPlainText('')`'s
 * own already-established shape (`content: []`). Applied once, at the point a document leaves the
 * editor and is about to be dispatched or compared, so every RichDoc that ever reaches storage
 * agrees on one shape regardless of which side — the editor or this module's own constructors —
 * produced it.
 */
export function normalizeRichDoc(doc: RichDoc): RichDoc {
  return { type: 'doc', content: doc.content.map(normalizeNode) }
}

function normalizeNode(n: RichNode): RichNode {
  switch (n.type) {
    case 'paragraph':
      return { type: 'paragraph', content: (n.content ?? []).map(normalizeNode) }
    case 'table':
    case 'tableRow':
      return { type: n.type, content: n.content.map(normalizeNode) }
    case 'tableCell':
    case 'tableHeader':
      return { type: n.type, attrs: n.attrs, content: (n.content ?? []).map(normalizeNode) }
    case 'text':
    case 'image':
    case 'mention':
    case 'issueReference':
      return n
  }
}

/**
 * A person lookup for rendering plain text. Optional and array-shaped, matching
 * `mentionSegments`'s own `{id, name}[]` convention in lib/mentions.ts — a caller that does not
 * care about resolving a real name (Step 4's search index, the auto-estimator) can omit it and
 * get the honest "unresolved" fallback instead of a lookup it would otherwise have to fake.
 */
export interface RichTextLookups {
  people?: { id: string; name: string }[]
}

/**
 * One node's plain-text rendering. Block nodes (paragraph, table, table cells) join their
 * children with no separator when the children are inline (a paragraph's words should run
 * together exactly as typed) — the separators that matter are between BLOCKS, handled by the
 * two callers that iterate a list of them (`table`, over its rows, and the top-level `doc`, over
 * its top-level content), each joining with a newline so adjacent paragraphs or rows don't fuse
 * into one unbroken word.
 */
function nodeText(n: RichNode, lookups: RichTextLookups): string {
  switch (n.type) {
    case 'text':
      return n.text
    case 'image':
      return `[image: ${n.attrs.alt ?? 'attachment'}]`
    case 'mention': {
      const person = lookups.people?.find((p) => p.id === n.attrs.personId)
      return `@${person?.name ?? 'someone'}`
    }
    case 'issueReference':
      return n.attrs.issueId
    case 'tableRow':
      return n.content.map((cell) => nodeText(cell, lookups)).join(' | ')
    case 'table':
      return n.content.map((row) => nodeText(row, lookups)).join('\n')
    case 'paragraph':
    case 'tableCell':
    case 'tableHeader':
      return (n.content ?? []).map((c) => nodeText(c, lookups)).join('')
  }
}

/**
 * The document, flattened to plain text. Every downstream reader that used to interpolate a
 * plain string directly — the auto-estimator, the tree search, the write path's own audit-reason
 * truncation — goes through this instead, so "what does this document say in words" is answered
 * once, not once per caller.
 */
export function richTextToPlainText(doc: RichDoc, lookups: RichTextLookups = {}): string {
  return doc.content
    .map((n) => nodeText(n, lookups))
    .join('\n')
    .trim()
}

/**
 * Whether a document has nothing worth showing — no text, no image, no mention, no reference.
 * Defined directly off `richTextToPlainText` rather than a second tree-walk: an image, a mention
 * and a reference all render as non-empty text (a bracketed placeholder, an "@name", a bare id),
 * so "does the plain-text rendering have any length" already answers "is there real content"
 * without re-deriving the same tree logic twice.
 */
export function isEmptyRichDoc(doc: RichDoc): boolean {
  return richTextToPlainText(doc).length === 0
}

/**
 * Every person named by a `mention` node, deduplicated — the doc-walking counterpart to
 * `mentionsIn` (lib/mentions.ts), which parses `@Name` out of a plain string. That function is
 * untouched: other plain-string fields in this codebase may still use it. This is a new,
 * parallel function for the two fields that stop being plain strings, not a replacement of the
 * old one everywhere.
 */
export function mentionedPeopleIn(doc: RichDoc): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (nodes: RichNode[]) => {
    for (const n of nodes) {
      if (n.type === 'mention') {
        if (!seen.has(n.attrs.personId)) {
          seen.add(n.attrs.personId)
          out.push(n.attrs.personId)
        }
      } else if ('content' in n && n.content) {
        walk(n.content)
      }
    }
  }
  walk(doc.content)
  return out
}
