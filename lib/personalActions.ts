/**
 * A person's own to-do — converted from mail that turned out not to be project work, or typed
 * in on the My to-dos screen. See `docs/plans/2026-09-10-mail-triage-and-personal-actions-design.md`.
 *
 * Structurally `lib/personalEvents.ts` applied to a to-do, on purpose: private to its owner,
 * unconditionally — see `lib/db/boot.ts`'s `redactForReader`. Not even `ADMIN` is exempt from
 * that filter, which is why `personId` is resolved from the actor at write time rather than
 * carried as a field: see `lib/workspace.ts`'s `addPersonalAction` arm. Never on the tree, never
 * in a report, never in a client pack.
 *
 * Deliberately minimal — text, an optional due date, a to-do/done status, and where it came
 * from. No priority, no reminder: both were considered in design and cut for a first version.
 */

export interface PersonalAction {
  id: string
  personId: string
  text: string
  /** 'YYYY-MM-DD', like every other date-only field in this codebase; absent means undated. */
  dueDate?: string
  status: 'To do' | 'Done'
  /** The originating message's subject, kept for context after the issue it came from is gone. */
  sourceSubject?: string
  sourceMessageId?: string
  createdAt: string
  deletedAt: string | null
}

export interface ActionProblem {
  field: 'text'
  message: string
}

export function actionProblem(a: Pick<PersonalAction, 'text'>): ActionProblem | null {
  if (!a.text.trim()) return { field: 'text', message: 'A to-do needs some text.' }
  return null
}

/**
 * The redaction, as its own pure function for the same reason `personalEventsFor` is one: this
 * is a redaction with no exemption for anyone, including `ADMIN`, and a rule that important
 * needs to be drivable by the scenario harness on its own, not only inferable from `boot()`'s
 * behaviour. `mine: null` (no directory entry) correctly produces an empty map — there is no
 * "whose" for an unrecognised sign-in to own.
 */
export function personalActionsFor(
  all: Record<string, PersonalAction>,
  mine: string | null,
): Record<string, PersonalAction> {
  return Object.fromEntries(Object.entries(all).filter(([, a]) => a.personId === mine))
}
