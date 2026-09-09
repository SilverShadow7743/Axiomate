/**
 * Who may see and act on a project — a fact about access, not about capacity.
 *
 * `Allocation` (`./capacity`) already answers "how much of this person's time is committed to
 * this project", keyed to the same `'project'` hierarchy node. This answers a sibling question
 * about the same node: "may this person be here at all". Shaped like `Allocation` on purpose —
 * the migration backfill reads one to seed the other — with one deliberate divergence: `personId`
 * is required. An `Allocation` with an unresolved name is still useful to a capacity report; a
 * `ProjectMember` row with one is an access-control fact nothing will ever match against a
 * signed-in session's `directoryPersonFor` lookup, so it is refused at creation rather than
 * stored silently useless.
 */

export interface ProjectMember {
  id: string
  /** The project node. Same unit as `Allocation.projectId` and a SOW's node attribution. */
  projectId: string
  /** Display name, for the same reason `Allocation` carries one. */
  person: string
  /** The resolved directory id. Required — see the module comment. */
  personId: string
  /** Descriptive only. Does not drive permission resolution — see `ProjectRole` in `./config`. */
  projectRoleId: string
  addedBy: string
  addedAt: string
  /** Soft-ended, not destroyed: who was staffed where is itself worth keeping, the same reason
   *  `Allocation` and `Commitment` never hard-delete. */
  removedAt: string | null
}

export interface ProjectRole {
  id: string
  label: string
  description: string
  /** Seeded roles cannot be deleted, only relabelled — mirrors `OrgRole`. */
  seeded: boolean
  deletedAt: string | null
}

/**
 * The shipped project-role vocabulary.
 *
 * Descriptive labels, not permission grants — see the module comment and the design's "what
 * this is not" section. A firm relabels or adds to these the same way it relabels `OrgRole`s.
 */
export const DEFAULT_PROJECT_ROLES: Record<string, ProjectRole> = Object.fromEntries(
  [
    ['PROJROLE_SPONSOR', 'Sponsor'],
    ['PROJROLE_PM', 'Project Manager'],
    ['PROJROLE_ENGAGEMENT_MANAGER', 'Engagement Manager'],
    ['PROJROLE_SOLUTION_ARCHITECT', 'Solution Architect'],
    ['PROJROLE_TECHNICAL_ARCHITECT', 'Technical Architect'],
    ['PROJROLE_FUNCTIONAL_LEAD', 'Functional Lead'],
    ['PROJROLE_TECHNICAL_LEAD', 'Technical Lead'],
    ['PROJROLE_CONSULTANT', 'Consultant'],
    ['PROJROLE_DEVELOPER', 'Developer'],
    ['PROJROLE_TESTER', 'Tester'],
    ['PROJROLE_REVIEWER', 'Reviewer'],
    ['PROJROLE_CUSTOMER', 'Customer'],
    ['PROJROLE_STAKEHOLDER', 'Stakeholder'],
  ].map(([id, label]) => [
    id,
    { id, label, description: '', seeded: true, deletedAt: null } as ProjectRole,
  ]),
)

/**
 * The project-facing roles that put someone on the client's side of a project rather than the
 * delivery team's — Sponsor/Customer/Stakeholder, the three seeded roles that read as "the
 * client is here", not "the firm is here". A firm-added custom role is not classified either
 * way; this only sorts the shipped vocabulary.
 */
export const CLIENT_PROJECT_ROLES = ['PROJROLE_SPONSOR', 'PROJROLE_CUSTOMER', 'PROJROLE_STAKEHOLDER']

export interface OwnerCandidates {
  team: ProjectMember[]
  client: ProjectMember[]
}

/**
 * Active members of one project, split into delivery team and client-facing roles — for an
 * owner picker that wants to offer both groups distinctly (I25 Tier 3, the owner dropdown).
 * Empty on both sides when `projectId` is null (a record with no project ancestor) or the
 * project has no staffing recorded yet — a picker built on this degrades to showing whatever
 * is already set, the same "empty state, not a missing control" convention `Fields`/`Skills`
 * already follow for an issue whose project has nothing configured.
 */
export function ownerCandidatesFor(
  members: Record<string, ProjectMember>,
  projectId: string | null,
): OwnerCandidates {
  if (!projectId) return { team: [], client: [] }
  const active = Object.values(members).filter((m) => m.projectId === projectId && !m.removedAt)
  return {
    team: active.filter((m) => !CLIENT_PROJECT_ROLES.includes(m.projectRoleId)),
    client: active.filter((m) => CLIENT_PROJECT_ROLES.includes(m.projectRoleId)),
  }
}

export interface MemberProblem {
  field: 'person' | 'projectRoleId'
  message: string
}

/** Shape-level checks only — name resolution to a directory id happens in the reducer arm,
 *  which is the one place that holds the model to resolve against. */
export function memberProblem(
  a: Pick<ProjectMember, 'person' | 'projectRoleId'>,
): MemberProblem | null {
  if (!a.person.trim()) return { field: 'person', message: 'A project member is somebody.' }
  if (!a.projectRoleId.trim()) {
    return { field: 'projectRoleId', message: 'Say what they are on this project.' }
  }
  return null
}
