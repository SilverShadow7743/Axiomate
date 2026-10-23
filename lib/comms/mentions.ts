/**
 * Naming a colleague, and being sure the highlight and the ping agree.
 *
 * A mention is `@` followed by a directory person's name, matched case-insensitively and
 * LONGEST NAME FIRST — so `@Nishant Sekhar` resolves to that person even when somebody
 * named `Nishant` also exists, and never to a one-word prefix. A token matching nobody is
 * plain text: the parser refuses to guess, for the same reason `directoryIdByName` returns
 * null for an ambiguous name rather than picking one.
 *
 * One parser, two consumers: `mentionsIn` feeds the mint in `addNote`/`updateNote`, and
 * `mentionSegments` feeds the highlight in NotesTab. They share the match list, so what
 * glows on screen and who gets told cannot disagree.
 */

export interface Mention {
  /** The directory person's id. */
  id: string
  /** The name as the directory has it — not as typed. */
  name: string
  /** Offset of the `@` in the body. */
  start: number
  /** Length including the `@`. */
  length: number
}

export function mentionsIn(
  body: string,
  people: { id: string; name: string }[],
): Mention[] {
  /* Longest first, so a full name beats its own prefix. */
  const candidates = people
    .filter((p) => p.name.trim())
    .sort((a, b) => b.name.length - a.name.length)
  const out: Mention[] = []
  const lower = body.toLowerCase()
  let i = 0
  while (i < body.length) {
    const at = lower.indexOf('@', i)
    if (at < 0) break
    let matched: Mention | null = null
    for (const p of candidates) {
      const name = p.name.trim()
      const slice = lower.slice(at + 1, at + 1 + name.length)
      if (slice === name.toLowerCase()) {
        /* The character after the name must not continue a word — `@Sam` inside
           `@Samuel's` is Samuel's mention, which longest-first already took; this guard
           stops `@Sam` matching inside `@Sample`. */
        const after = body[at + 1 + name.length]
        if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) {
          matched = { id: p.id, name, start: at, length: name.length + 1 }
          break
        }
      }
    }
    if (matched) {
      out.push(matched)
      i = matched.start + matched.length
    } else {
      i = at + 1
    }
  }
  /* Distinct by person — the mint pings once however often a name is repeated. */
  const seen = new Set<string>()
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
}

/** Every match, offsets included, repeats and all — the highlight needs each occurrence. */
export function allMentionMatches(
  body: string,
  people: { id: string; name: string }[],
): Mention[] {
  const candidates = people
    .filter((p) => p.name.trim())
    .sort((a, b) => b.name.length - a.name.length)
  const out: Mention[] = []
  const lower = body.toLowerCase()
  let i = 0
  while (i < body.length) {
    const at = lower.indexOf('@', i)
    if (at < 0) break
    let matched: Mention | null = null
    for (const p of candidates) {
      const name = p.name.trim()
      if (lower.slice(at + 1, at + 1 + name.length) === name.toLowerCase()) {
        const after = body[at + 1 + name.length]
        if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) {
          matched = { id: p.id, name, start: at, length: name.length + 1 }
          break
        }
      }
    }
    if (matched) {
      out.push(matched)
      i = matched.start + matched.length
    } else {
      i = at + 1
    }
  }
  return out
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; personId: string }

/** The body split for rendering — same matches as the mint, every occurrence marked. */
export function mentionSegments(
  body: string,
  people: { id: string; name: string }[],
): MentionSegment[] {
  const matches = allMentionMatches(body, people)
  if (!matches.length) return [{ kind: 'text', text: body }]
  const out: MentionSegment[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start > cursor) out.push({ kind: 'text', text: body.slice(cursor, m.start) })
    out.push({ kind: 'mention', text: body.slice(m.start, m.start + m.length), personId: m.id })
    cursor = m.start + m.length
  }
  if (cursor < body.length) out.push({ kind: 'text', text: body.slice(cursor) })
  return out
}
