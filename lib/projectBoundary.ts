import { projectOf, type WorkspaceState } from './workspace'

/**
 * The project boundary's withholding, as a pure function — what an internal reader who isn't
 * exempt receives, narrowed to the projects they're staffed on. Sibling to `clientView`
 * (`./clientBoundary`), applied along a different axis, and deliberately a separate function
 * rather than a shared one parameterised two ways: the two redact for different reasons —
 * content someone marked visible, versus work someone is staffed on — and a function that
 * happens to do both today is the kind of convenient collapse that breaks the day one of them
 * needs to change alone.
 *
 * The one property that makes this simpler than `clientView`: the default here is ALLOW, not
 * deny. A record with no `'project'` ancestor is never gated (see `projectOf` and the design's
 * "not every record" boundary), and `projectOf` is monotonic along the ancestor chain — every
 * node from the company down to a project shares the same answer as everything nested inside
 * it, and everything above a project always resolves to null. So one uniform `keep(id)` check
 * is structurally consistent on its own; nothing needs a separate ancestor re-walk the way
 * `clientView`'s deny-by-default redaction does.
 */
export function projectView(state: WorkspaceState, memberProjectIds: Set<string>): WorkspaceState {
  const keep = (id: string): boolean => {
    const projectId = projectOf(state, id)
    return !projectId || memberProjectIds.has(projectId)
  }

  const issues = Object.fromEntries(Object.entries(state.issues).filter(([id]) => keep(id)))
  const nodes = Object.fromEntries(Object.entries(state.nodes).filter(([id]) => keep(id)))
  const activities = Object.fromEntries(
    Object.entries(state.activities).filter(([, a]) => Boolean(issues[a.issueId])),
  )
  const dependencies = state.dependencies.filter(
    (d) => Boolean(issues[d.predecessorId]) && Boolean(issues[d.successorId]),
  )
  const relationships = state.relationships.filter(
    (r) => Boolean(issues[r.sourceIssueId]) && Boolean(issues[r.targetIssueId]),
  )
  const notes = Object.fromEntries(
    Object.entries(state.notes).filter(([, n]) => Boolean(issues[n.issueId])),
  )
  const evidence = Object.fromEntries(
    Object.entries(state.evidence).filter(([, e]) => Boolean(issues[e.issueId])),
  )
  const timeEntries = Object.fromEntries(
    Object.entries(state.timeEntries).filter(([, t]) => Boolean(issues[t.issueId])),
  )
  /* `Approval.subjectId` is an issue today, per its own doc comment — the same filter shape
   * as everything else keyed to an issue. */
  const approvals = Object.fromEntries(
    Object.entries(state.approvals).filter(([, a]) => Boolean(issues[a.subjectId])),
  )
  /* Subject-joined, like `clientView`'s document filter: a document on a non-issue subject
   * (a SOW, a node, a change request) is commercial machinery one level coarser than a
   * project — same reasoning step 4 applied to milestones and scope items — and is not
   * gated here. Only a document ON an issue that did not survive is dropped. */
  const documents = Object.fromEntries(
    Object.entries(state.documents).filter(
      ([, d]) => d.subjectKind !== 'issue' || Boolean(issues[d.subjectId]),
    ),
  )
  /*
   * `keep(a.rowId)` resolves correctly for the common case without special-casing: audit
   * entries about a note, an evidence item or a document carry the PARENT ISSUE's id as
   * `rowId` (the same fact `clientView`'s own redaction comment documents), so `projectOf`
   * already answers the right question. For a `rowId` that names something `projectOf` cannot
   * resolve at all — a SOW, an allocation, a config scope, a rate, a skill row — `keep` returns
   * true by its own ungated default, which is correct: those are not project-scoped facts, and
   * were visible to any `internal.view` holder before this feature existed.
   */
  const audit = state.audit.filter((a) => keep(a.rowId))

  return {
    ...state,
    issues,
    nodes,
    activities,
    dependencies,
    relationships,
    notes,
    evidence,
    timeEntries,
    approvals,
    documents,
    audit,
  }
}

/**
 * The set of project ids this actor is a live member of. Empty for someone staffed nowhere.
 *
 * This is the single stakeholder definition (ART-20260905-016 BR1, BR8; ADR 0002 decision 2): a
 * person is a stakeholder on a project if and only if they hold a live `ProjectMember` row on
 * it — `personId` matches and `removedAt` is null. `projectRoleId` is ignored; sponsor, customer
 * and stakeholder roles all count the same. An `Allocation`, an engagement name or a SOW name
 * confers nothing — allocation is a capacity fact, membership is an access fact (see the
 * resource-model note in `CLAUDE.md`). A null `personId` — an actor the directory could not
 * resolve — is the empty set, not everything (deny by default). The definition is not
 * date-bounded, which is why there is no `today` parameter.
 *
 * The project read gate and the boot banner (`lib/db/boot.ts`) read this function today; the
 * Client filter, its facets, `scopeLabel` and the `CD` scenarios read it as they land
 * (ART-20260905-017), never a second definition. Do not add another stakeholder function beside
 * it: if the Client filter and the payload ever disagree about which projects a person is on,
 * one of them has stopped calling this.
 */
export function memberProjectIdsFor(state: WorkspaceState, personId: string | null): Set<string> {
  if (!personId) return new Set()
  return new Set(
    Object.values(state.projectMembers)
      .filter((m) => m.personId === personId && !m.removedAt)
      .map((m) => m.projectId),
  )
}
