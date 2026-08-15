/**
 * Who performed a change.
 *
 * Deliberately narrow: an actor is the answer to "whose name goes in the audit trail", and
 * nothing else. It is not a session, not a principal, and not an authorisation subject —
 * see `lib/identity.ts` for what is and is not established about it.
 *
 * Kept apart from `SessionUser` in `lib/session.ts`, which carries timezone and locale. Those
 * are viewer preferences: they change how a date renders, never who did something. Folding
 * them together would make one record answer two unrelated questions, which is the shape of
 * defect this codebase has spent several rounds pulling apart.
 *
 * This module is importable from both sides. Resolution is not — it happens once, on the
 * server, and the answer is passed down.
 */
export interface Actor {
  /**
   * A stable key for the actor. Not a foreign key: there is no user table to point at, and
   * inventing one now would be a dangling reference dressed up as integrity. When identity
   * arrives, attribution becomes a real reference and this becomes that key.
   */
  id: string
  /** What is written to `AuditEntry.by` and to the `createdBy` / `addedBy` fields. */
  name: string
}

/**
 * Work this application did on its own behalf.
 *
 * Matches the convention already set by the lifecycle builder, which stamps
 * `createdBy: 'lifecycle-generator'` on the activities it synthesises: machine-originated
 * records say so in the same place a person's name would appear, rather than borrowing
 * whichever human happened to trigger them.
 */
export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Axiomate' }
