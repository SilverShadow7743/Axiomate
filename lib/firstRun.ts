import type { WorkspaceState } from './workspace'
import type { Actor } from './actor'
import { can, directoryPersonFor } from './access'

/**
 * First-run — the checklist that computes itself. See
 * `docs/plans/2026-08-31-first-run-design.md`.
 *
 * Pure over state and actor: no clock, no storage. The card cannot claim a step happened
 * when the state says it did not, which is the whole difference from a tour. Dismissal is
 * the CALLER's concern (localStorage) — UI state does not belong on the model.
 */

export interface FirstRunState {
  /** A directory-matched delivery seat with no config.manage and no recorded hours yet. */
  eligible: boolean
  recordedFirstHours: boolean
  submittedFirstWeek: boolean
}

export function firstRunState(state: WorkspaceState, actor: Actor): FirstRunState {
  const person = directoryPersonFor(state.model, actor)
  const none: FirstRunState = { eligible: false, recordedFirstHours: false, submittedFirstWeek: false }
  if (!person) return none
  // Operators and admins configure the platform; onboarding them to their own product would
  // be noise. A seat that cannot record time has no loop to learn here either.
  if (can(state.model, actor, 'config.manage').allowed) return none
  if (!can(state.model, actor, 'time.record').allowed) return none

  const who = person.name.trim().toLowerCase()
  const mine = Object.values(state.timeEntries).filter(
    (e) => !e.deletedAt && ((e.personId && e.personId === person.id) || e.person.trim().toLowerCase() === who),
  )
  const sheets = Object.values(state.timesheets).filter(
    (t) => (t.personId && t.personId === person.id) || t.person.trim().toLowerCase() === who,
  )
  return {
    eligible: mine.length === 0,
    recordedFirstHours: mine.length > 0,
    submittedFirstWeek: sheets.length > 0,
  }
}

/** Show the card while the loop is unlearned — from first sight until week one is submitted. */
export function firstRunVisible(s: FirstRunState): boolean {
  return s.eligible || (s.recordedFirstHours && !s.submittedFirstWeek)
}
