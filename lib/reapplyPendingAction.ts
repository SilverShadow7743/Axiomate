import type { Action } from './workspace'
import type { SubmittedAction } from './idempotency'

/**
 * Turn a stored, stuck action back into something safe to `dispatch` fresh.
 *
 * The one thing this has to do, and the only reason it exists rather than just calling
 * `dispatch(storedAction)` directly: `withExpectation` (`components/IssueWorkspace.tsx`) only
 * re-stamps `expected` when the action does not already carry one — `if (action.t !==
 * 'updateIssue' || action.expected) return action`. A stored action still carries whatever
 * `expected` it had when it was first queued, frozen at that moment. Dispatched as-is, it would
 * resend the exact stale comparison that failed before and conflict identically again, even if
 * the underlying data is now perfectly fine to write. Stripping `expected` here is what makes
 * "reapply" mean "check against what is true right now" rather than "resend what failed before".
 *
 * `key` is stripped too, for a smaller reason: `dispatch` → `persist` → `enqueueAll` mints a
 * fresh key for every action it queues (`mintKey()`, `components/useAutosave.ts`), so a reapply
 * becomes its own new pending entry, tracked and cleared exactly like any other edit. Carrying
 * the old key forward would just be dead data `dispatch` ignores.
 */
export function reapplyable(stored: SubmittedAction): Action {
  const { key: _key, expected: _expected, ...rest } = stored as SubmittedAction & { expected?: unknown }
  return rest as Action
}
