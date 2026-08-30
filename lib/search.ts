import type { WorkspaceState } from './workspace'
import { richTextToPlainText } from './richText'

/**
 * Global search — one scan over everything the reader may see, and nothing else. See
 * `docs/plans/2026-08-30-global-search-design.md`.
 *
 * Pure and CLIENT-SIDE by design: the state this runs over is the boot payload, which is
 * already redacted per reader (rates, skills, leave reasons, and the whole client-visibility
 * cut). Search therefore inherits every one of those guarantees by construction — there is no
 * second egress surface here to prove. GS1 makes the composition executable: sentinels found
 * on the raw state are absent after the same reader cut the boot applies.
 *
 * Discussion messages are server-queried and deliberately NOT in this corpus; the UI's empty
 * state says so rather than implying completeness.
 */

export type SearchKind = 'issue' | 'note' | 'mail' | 'document' | 'person' | 'meeting'

export interface SearchHit {
  kind: SearchKind
  id: string
  /** What the UI opens: the parent issue for note/mail/issue-document hits, the record itself
   *  for issues, null where there is nothing to open (people, unfiled mail). */
  anchorId: string | null
  title: string
  /** ~90 chars around the first match, with the match's offsets carried for highlighting. */
  snippet: string
  matchStart: number
  matchEnd: number
  score: number
}

const CAP = 50

interface Field {
  text: string
  weight: number
}

/** All tokens must land somewhere on the record; the score is the best field weight per token. */
function scoreFields(fields: Field[], tokens: string[]): { score: number; first: Field } | null {
  let score = 0
  let first: Field | null = null
  for (const token of tokens) {
    let best = 0
    for (const f of fields) {
      if (f.weight > best && f.text.toLowerCase().includes(token)) {
        best = f.weight
        if (!first || f.weight > first.weight) first = f
      }
    }
    if (best === 0) return null
    score += best
  }
  return first ? { score, first } : null
}

function snippetOf(field: Field, token: string): { snippet: string; matchStart: number; matchEnd: number } {
  const lower = field.text.toLowerCase()
  const at = Math.max(0, lower.indexOf(token))
  const start = Math.max(0, at - 30)
  const end = Math.min(field.text.length, at + token.length + 60)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < field.text.length ? '…' : ''
  const snippet = prefix + field.text.slice(start, end) + suffix
  const matchStart = prefix.length + (at - start)
  return { snippet, matchStart, matchEnd: matchStart + token.length }
}

/** Recency tilt: activity in the last fortnight beats equal matches from last quarter. */
function recency(date: string | null | undefined, today: string): number {
  if (!date) return 0
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date.slice(0, 10)}T00:00:00Z`)) / 86_400_000
  if (Number.isNaN(days) || days < 0) return 0
  if (days <= 14) return 2
  if (days <= 60) return 1
  return 0
}

export function searchWorkspace(state: WorkspaceState, query: string, today: string): SearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2)
  if (!tokens.length) return []

  const hits: SearchHit[] = []
  const add = (
    kind: SearchKind,
    id: string,
    anchorId: string | null,
    title: string,
    fields: Field[],
    date: string | null | undefined,
  ) => {
    const m = scoreFields(fields.filter((f) => f.text), tokens)
    if (!m) return
    const s = snippetOf(m.first, tokens.find((t) => m.first.text.toLowerCase().includes(t)) ?? tokens[0])
    hits.push({ kind, id, anchorId, title, score: m.score + recency(date, today), ...s })
  }

  for (const i of Object.values(state.issues)) {
    if (i.deletedAt) continue
    add('issue', i.id, i.id, `${i.id} — ${i.subject}`, [
      { text: i.id, weight: 10 },
      { text: i.subject, weight: 8 },
      { text: i.owner, weight: 4 },
      { text: i.nextAction, weight: 4 },
      { text: i.evidence, weight: 2 },
      { text: i.clientImpact, weight: 2 },
      { text: i.reference, weight: 2 },
      { text: i.source, weight: 2 },
    ], i.lastActivity)
  }

  for (const n of Object.values(state.notes)) {
    if (n.deletedAt) continue
    const issue = state.issues[n.issueId]
    if (!issue || issue.deletedAt) continue
    add('note', n.id, n.issueId, `Note on ${n.issueId} — ${issue.subject}`, [
      { text: richTextToPlainText(n.body), weight: 3 },
    ], n.createdAt)
  }

  for (const m of Object.values(state.inboundMail)) {
    add('mail', m.id, m.issueId ?? null, `Mail — ${m.subject || '(no subject)'}`, [
      { text: m.subject, weight: 4 },
      { text: m.from, weight: 3 },
      { text: m.body, weight: 2 },
    ], m.receivedAt)
  }

  for (const d of Object.values(state.documents)) {
    if (d.deletedAt) continue
    add('document', d.id, d.subjectKind === 'issue' ? d.subjectId : null, d.name, [
      { text: d.name, weight: 4 },
    ], d.uploadedAt)
  }

  for (const p of Object.values(state.model.people)) {
    /* A name query intends the person, not every record naming them in an owner field — the
     * name outweighs owner mentions (4) while ids and subjects still come first. */
    add('person', p.id, null, p.name, [
      { text: p.name, weight: 7 },
      { text: p.email ?? '', weight: 4 },
    ], null)
  }

  for (const m of Object.values(state.meetings)) {
    if (m.deletedAt) continue
    add('meeting', m.id, null, m.title, [{ text: m.title, weight: 4 }], m.startAt)
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, CAP)
}
