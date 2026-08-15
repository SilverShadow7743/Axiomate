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

/*
 * There is deliberately no `SYSTEM_ACTOR` constant.
 *
 * One was written here and then removed, because nothing legitimately needed it and an
 * exported value with no call sites is the "declared, with no runtime" pattern this codebase
 * keeps finding and deleting.
 *
 * The two candidates both turned out to be already handled, and better:
 *
 *  - **The assistant.** It only ever *proposes*; a person applies. The change belongs to the
 *    person who approved it, and that is who the reducer records — attributing it to the
 *    machine would hide a human decision behind a system name.
 *
 *  - **The lifecycle builder.** It stamps `createdBy: 'lifecycle-generator'` on the activities
 *    it synthesises. That is more specific than a single system identity: it says *which*
 *    process produced the row. A shared constant would have made every machine-written record
 *    indistinguishable, which is a loss, not a tidy-up.
 *
 * So the convention for machine-originated records is a descriptive name at the point of
 * origin. If a second such process appears, it gets its own name for the same reason.
 */
