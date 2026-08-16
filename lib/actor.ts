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
  /**
   * The work address the provider supplied, when there is one.
   *
   * Present reluctantly, and only because it is the join to the people directory: `id` holds a
   * provider's object id, which matches nothing a firm ever typed, and a display name is a
   * field two people can share. It is used for resolving roles and for nothing else — never
   * for attribution, which stays `name`, and never as proof of anything.
   */
  email?: string
}

/**
 * Actors that are not people.
 *
 * There was deliberately no such thing here for a long time, and the reasoning below is kept
 * because it was right: the two candidates at the time — the assistant and the lifecycle
 * generator — both turned out to belong to the person who triggered them, and an exported
 * constant with no honest call site is the pattern this codebase keeps deleting.
 *
 * Two things arrived since that genuinely have nobody behind them. A message that comes in on
 * the intake endpoint was not typed by anyone here, and the scheduled pass runs at seven in the
 * morning because a clock said so. Attributing either to a person would be a lie in the audit
 * trail of exactly the kind the actor parameter exists to prevent — so they are named, and
 * named as machines, so a reader of the trail can tell instantly.
 *
 * They are not people in the directory either, which is why `rolesFor` resolves them through
 * their own grant rather than through the fallback role. A machine that inherits Administrator
 * because nobody assigned it anything is the accident that mechanism exists to avoid.
 */
export const INTAKE_ACTOR: Actor = { id: 'machine:intake', name: 'Intake' }
export const SCHEDULE_ACTOR: Actor = { id: 'machine:schedule', name: 'Scheduled pass' }

/** Whether an actor is one of the above. Prefix-matched so a third does not need a new check. */
export function isMachineActor(actor: Actor): boolean {
  return actor.id.startsWith('machine:')
}

/*
 * The original note, kept because the reasoning still holds for what it covered.
 *
 * There is deliberately no general `SYSTEM_ACTOR` constant.
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
