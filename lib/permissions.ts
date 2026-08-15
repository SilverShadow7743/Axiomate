import type { Actor } from './actor'
import type { OperatingModel } from './config'
import type { IssueNote } from './notes'
import { can, type Decision } from './access'

/**
 * The questions the screens ask.
 *
 * Thin on purpose. The rules live in `./access`, which is also what the reducer consults, so
 * a control cannot be grey for one reason while the action it triggers is refused for another.
 * This module exists to give each affordance a name to call rather than a permission key to
 * remember, and to hold the one rule that is about authorship rather than about roles.
 *
 * What changed when `./access` arrived: these used to return ALLOWED unconditionally, because
 * a permission model over an unverified principal would have been theatre. Authorisation is
 * now real and enforced; authentication still is not. Read the module comment in `./access`
 * for exactly what that is worth.
 */

export type Permission = Decision

export function canEditIssue(model: OperatingModel, actor: Actor): Permission {
  return can(model, actor, 'work.edit')
}

export function canAddNote(model: OperatingModel, actor: Actor): Permission {
  return can(model, actor, 'note.add')
}

/**
 * Whether this actor may change an existing note.
 *
 * Authorship first, and it is not a role question: a note is somebody's account of what they
 * observed, and editing another person's account under their name misrepresents them. The
 * supervisor override is a real requirement in delivery work, so it exists — as an explicit
 * grant somebody has to hold, rather than as everybody being let through.
 */
export function canEditNote(model: OperatingModel, actor: Actor, note: IssueNote): Permission {
  if (note.createdBy === actor.name) return can(model, actor, 'note.add')
  const override = can(model, actor, 'note.editAny')
  if (override.allowed) return override
  return {
    allowed: false,
    reason: `Written by ${note.createdBy}. A note is that person's account of what they saw, so it is theirs to correct.`,
  }
}
