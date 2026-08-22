import type { DocumentRecord } from './documents'

/**
 * Deliverable review — proofing, translated for a firm that ships documents.
 *
 * ---------------------------------------------------------------------------
 * The checksum's second job
 *
 * `DocumentRecord.checksum` was built with two stated jobs, and until now only one ever ran.
 * A review pins the checksum at the moment it is asked, so "is this still the document that
 * was approved" is answered by comparison rather than memory: a re-upload changes the bytes,
 * `coversDocument` goes false, and the screen says *approved — an earlier version*. Nothing
 * is voided or rewritten; the review remains true about the bytes it reviewed.
 *
 * ---------------------------------------------------------------------------
 * One verdict per reviewer, and the asker is not one
 *
 * A review addresses named people and wants an answer from each. A second answer by the same
 * reviewer REPLACES the first — changing your mind is normal, and both are audited — and the
 * asker cannot answer at all, the same rule `lib/approval.ts` states for approvals. These are
 * enforced by the reducer arm; the functions here only read.
 */

export type ReviewVerdict = 'approved' | 'changes'

export interface DocumentReviewAnswer {
  by: string
  verdict: ReviewVerdict
  /** Required for 'changes' — a change request that names no change is noise. */
  note: string
  at: string
}

export interface DocumentReview {
  /** `rev-12`, minted from the workspace counter. */
  id: string
  documentId: string
  /** The bytes under review, pinned from the STORED document at the moment of asking. */
  checksum: string
  /** Where the review surfaces and is audited. */
  issueId: string
  /** What the asker wants judged, shown to every reviewer. */
  question: string
  askedBy: string
  askedAt: string
  /** Directory names. The asker may not appear here — the arm refuses the ask. */
  reviewers: string[]
  verdicts: DocumentReviewAnswer[]
  withdrawnAt: string | null
  deletedAt: string | null
}

export type ReviewOutcome = 'awaiting' | 'changes' | 'approved'

/**
 * Where a review stands. `changes` wins the moment anyone asks for them — a change request
 * is actionable immediately, not after the stragglers answer — and `approved` requires every
 * named reviewer to have said so. Counted by distinct reviewer, defensively: the arm already
 * enforces one verdict per reviewer, but a counting function that TRUSTS an invariant it
 * could cheaply re-derive turns any future arm bug into a wrong completion.
 */
export function reviewStateOf(review: DocumentReview): {
  answered: number
  total: number
  outcome: ReviewOutcome
} {
  const byReviewer = new Map<string, DocumentReviewAnswer>()
  for (const v of review.verdicts) byReviewer.set(v.by.trim().toLowerCase(), v)
  const answered = review.reviewers.filter((r) => byReviewer.has(r.trim().toLowerCase())).length
  const total = review.reviewers.length
  const anyChanges = review.reviewers.some(
    (r) => byReviewer.get(r.trim().toLowerCase())?.verdict === 'changes',
  )
  const outcome: ReviewOutcome = anyChanges ? 'changes' : answered === total ? 'approved' : 'awaiting'
  return { answered, total, outcome: outcome === 'approved' && total === 0 ? 'awaiting' : outcome }
}

/** Whether this review is about these bytes — the *approved, an earlier version* test. */
export function coversDocument(review: DocumentReview, doc: DocumentRecord): boolean {
  return review.checksum === doc.checksum
}

/**
 * The version chain a document belongs to, newest first.
 *
 * Walks `supersedesId` back from the given document, then forward by scanning for successors
 * — the chain is the version history, and positions in it are displayed, never stored.
 */
export function versionChainOf(
  documents: Record<string, DocumentRecord>,
  docId: string,
): DocumentRecord[] {
  const doc = documents[docId]
  if (!doc) return []
  const chain: DocumentRecord[] = [doc]
  // Backwards to the original…
  let cur: DocumentRecord | undefined = doc
  while (cur?.supersedesId && documents[cur.supersedesId]) {
    cur = documents[cur.supersedesId]
    chain.push(cur)
  }
  // …and forwards to the newest. Linear by construction (the arm refuses a second successor).
  cur = doc
  for (;;) {
    const successor = Object.values(documents).find((d) => d.supersedesId === cur!.id && !d.deletedAt)
    if (!successor) break
    chain.unshift(successor)
    cur = successor
  }
  return chain
}

/** Every review asked about a document, newest first. */
export function reviewsForDocument(
  reviews: Record<string, DocumentReview>,
  documentId: string,
): DocumentReview[] {
  return Object.values(reviews)
    .filter((r) => r.documentId === documentId && !r.deletedAt)
    .sort((a, b) => b.askedAt.localeCompare(a.askedAt))
}

/** The chip. One phrase, honest about partial states rather than a traffic light. */
export function describeReview(review: DocumentReview, doc: DocumentRecord): string {
  if (review.withdrawnAt) return 'review withdrawn'
  const s = reviewStateOf(review)
  if (s.outcome === 'changes') return 'changes requested'
  if (s.outcome === 'awaiting') return `awaiting ${s.total - s.answered} of ${s.total}`
  return coversDocument(review, doc) ? 'approved' : 'approved — an earlier version'
}
