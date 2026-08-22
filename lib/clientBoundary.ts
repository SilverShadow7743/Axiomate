import type { WorkspaceState } from './workspace'

/**
 * The client boundary's withholding, as a pure function — what a reader WITHOUT
 * `internal.view` receives. Called by `boot()`'s redaction (which decides WHETHER, from the
 * verdict); pure here so the scenario suite can drive exactly what leaves the server.
 *
 * What survives: records, notes and documents a person marked client-visible, the ancestor
 * chain of surviving records (a record without its place is unreadable) and nothing else of
 * the tree, activities and links between survivors, and audit entries about them — dropped
 * whole otherwise, never redacted within. Everything commercial and everything about people
 * is withheld wholesale regardless of flags: record visibility is about content, not the
 * machinery. Counts recompute downstream from this subset — withholding the records and
 * shipping the summary of them is the same disclosure.
 */
export function clientView(state: WorkspaceState): WorkspaceState {
  const issues = Object.fromEntries(
    Object.entries(state.issues).filter(([, i]) => (i.clientVisible ?? false) && !i.deletedAt),
  )
  const keepNodes = new Set<string>()
  for (const i of Object.values(issues)) {
    let cur: string | null | undefined = i.parentId
    while (cur && !keepNodes.has(cur) && state.nodes[cur]) {
      keepNodes.add(cur)
      cur = state.nodes[cur].parentId
    }
  }
  const docsVisible = Object.fromEntries(
    Object.entries(state.documents).filter(([, d]) => (d.clientVisible ?? false) && !d.deletedAt),
  )
  return {
    ...state,
    issues,
    nodes: Object.fromEntries(Object.entries(state.nodes).filter(([id]) => keepNodes.has(id))),
    activities: Object.fromEntries(
      Object.entries(state.activities).filter(([, a]) => issues[a.issueId]),
    ),
    dependencies: state.dependencies.filter(
      (d) => issues[d.predecessorId.split('#')[0]] && issues[d.successorId.split('#')[0]],
    ),
    relationships: state.relationships.filter(
      (r) => issues[r.sourceIssueId] && issues[r.targetIssueId],
    ),
    notes: Object.fromEntries(
      Object.entries(state.notes).filter(
        ([, n]) => (n.clientVisible ?? false) && issues[n.issueId] && !n.deletedAt,
      ),
    ),
    evidence: Object.fromEntries(
      Object.entries(state.evidence).filter(
        ([, e]) => issues[e.issueId] && !e.deletedAt && (!e.documentId || docsVisible[e.documentId]),
      ),
    ),
    documents: docsVisible,
    /*
     * Two cuts, both dropping whole entries — never redacting a field inside one.
     *
     * The second cut is the payload proof's first catch: entries about a record's CHILDREN
     * (`note`, `evidence`, `document`) carry the child's content — a note's body rides
     * `reason`, a document's name rides `from`/`to` — while `rowId` names the parent issue.
     * An internal note on a client-visible issue therefore survived the rowId filter with
     * its body aboard. The entry does not say WHICH child it is about, so its visibility
     * cannot be tested; the only honest move is to withhold the class. Nothing is lost that
     * the client could have: visible children are delivered as the records themselves.
     */
    audit: state.audit.filter(
      (a) => Boolean(issues[a.rowId]) && !['note', 'evidence', 'document'].includes(a.field),
    ),
    estimates: {},
    estimateRevisions: {},
    timeEntries: {},
    timesheets: {},
    rates: {},
    changes: {},
    personSkills: {},
    documentReviews: {},
    milestones: {},
    scopeItems: {},
    approvals: {},
    notifications: {},
    sows: {},
    allocations: {},
    commitments: {},
    versions: {},
  }
}
