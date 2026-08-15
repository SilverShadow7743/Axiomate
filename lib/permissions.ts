import type { Actor } from './actor'
import type { OperatingModel } from './config'
import type { IssueNote } from './notes'

/**
 * Who may change what.
 *
 * ---------------------------------------------------------------------------
 * Read this before trusting anything below
 *
 * **These checks do not currently restrict anybody, and they must not be mistaken for access
 * control.** There is no authentication in this application — no login, no session, no way to
 * tell two people apart (`lib/identity.ts`, and AXM-045 in the internal log). Every request
 * resolves to one configured operator. A permission model built on top of that would be
 * deciding what an unverified party may do, which is theatre: it would read as a security
 * boundary in every screen and every code review while enforcing nothing.
 *
 * So this module is the *seam*, not the mechanism. It exists because the alternative — UI
 * that calls no permission function at all — means every button becomes a site to remember
 * later, and some get missed. Every editing affordance in the workspace already asks these
 * questions; when there is a principal to answer them with, the answers change here and the
 * screens follow.
 *
 * What is genuinely missing, in order:
 *
 *   1. Authentication, so a request has a verified principal at all.
 *   2. A role binding on that principal. `OrgRole` records exist and `Person.roleIds` exists,
 *      but the seeded directory assigns no roles to anyone, because the imported log records
 *      who worked an issue and never records what they are.
 *   3. A role → permission map. Nothing of the sort exists yet; the operating model has no
 *      concept of a grant.
 *
 * Until (1), the honest answer to every question here is "this deployment has one operator and
 * they may act", and that is what these return. They take the model and actor as parameters
 * anyway, so the day that stops being true nothing above them has to change shape.
 */

export interface Permission {
  allowed: boolean
  /** Shown to the user when denied, so a disabled control explains itself. */
  reason?: string
}

const ALLOWED: Permission = { allowed: true }

/**
 * Whether this actor may change an issue's fields.
 *
 * Note the deliberate absence of a per-field or per-scope dimension. Adding one now would
 * invent a policy nobody has stated — which responsibilities may reassign an owner, whether a
 * client-side role may reclassify severity — and a guessed policy is worse than an absent one
 * because it looks considered.
 */
export function canEditIssue(_model: OperatingModel, _actor: Actor): Permission {
  return ALLOWED
}

/** Whether this actor may add a note to an issue. */
export function canAddNote(_model: OperatingModel, _actor: Actor): Permission {
  return ALLOWED
}

/**
 * Whether this actor may change an existing note.
 *
 * This one has a real rule already, and it does not need authentication to be worth applying:
 * a note is somebody's account of what they observed, and editing another person's account
 * under their name misrepresents them. So authorship is checked even though identity is not
 * yet verified — the check is weak, but it is pointed the right way, and it fails closed.
 *
 * Deleting is deliberately the same test rather than a looser one. A supervisor override is a
 * real requirement in delivery work, and it belongs with the role map rather than being
 * approximated now by letting everyone through.
 */
export function canEditNote(_model: OperatingModel, actor: Actor, note: IssueNote): Permission {
  if (note.createdBy === actor.name) return ALLOWED
  return {
    allowed: false,
    reason: `Written by ${note.createdBy}. A note is that person's account of what they saw, so it is theirs to correct.`,
  }
}
