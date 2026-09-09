import type { SubmittedAction } from './idempotency'

/**
 * A shadow copy of the autosave queue, held in local storage rather than only in React state.
 *
 * `components/useAutosave.ts`'s own queue is a ref: it lives exactly as long as the tab does,
 * which is the entire reason a halted queue's contents were unrecoverable after a reload — the
 * one place they existed was gone the moment the page was. This module exists to make "what is
 * still unconfirmed" durable, so a stuck-changes recovery view (see
 * `docs/plans/2026-09-09-stuck-changes-recovery-design.md`) has something to read back after
 * the tab that queued the work is gone.
 *
 * Deliberately narrow: this is not a second copy of the workspace (that is `lib/autosave.ts`'s
 * local mirror, and only exists for the no-database mode). It holds exactly the actions that
 * have been queued but not yet confirmed — nothing more — keyed by the same idempotency key
 * `useAutosave.ts` already mints per action (`mintKey()`), so nothing here can drift out of
 * sync with the identity scheme the server-side dedup already relies on.
 *
 * Same conventions as `lib/autosave.ts` throughout: `typeof window === 'undefined'` guarded,
 * every function returns rather than throws, a malformed value is discarded rather than trusted.
 */

function storeKey(tenantId: string): string {
  return `axiomate.pending-actions.v1:${tenantId}`
}

function readAll(tenantId: string): SubmittedAction[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storeKey(tenantId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Shape-checked rather than trusted, the same reasoning `loadWorkspaceLocally` gives for
    // the same check: this is JSON that has sat in a browser across app versions.
    return parsed.filter(
      (a): a is SubmittedAction => a && typeof a === 'object' && typeof a.key === 'string' && typeof a.t === 'string',
    )
  } catch {
    return []
  }
}

function writeAll(tenantId: string, actions: SubmittedAction[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storeKey(tenantId), JSON.stringify(actions))
  } catch {
    // A full or blocked quota just means this safety net is unavailable, not that the caller
    // (`enqueueAll`, mid-way through queuing a real edit) should see a failure over it.
  }
}

/**
 * Record one action as queued-but-unconfirmed.
 *
 * A missing key is a caller bug, not a case to handle: every action reaching this point was
 * just stamped one by `mintKey()`. Skipped silently rather than thrown, matching `split()`'s own
 * "absent means not eligible for this protection" stance (`lib/idempotency.ts:107-108`) instead
 * of inventing a new failure mode for something that should not happen.
 */
export function savePendingAction(tenantId: string, action: SubmittedAction): void {
  if (!action.key) return
  const all = readAll(tenantId)
  if (all.some((a) => a.key === action.key)) return
  writeAll(tenantId, [...all, action])
}

/** Remove one action once it is confirmed (saved, or explicitly discarded). */
export function clearPendingAction(tenantId: string, key: string): void {
  const all = readAll(tenantId)
  const next = all.filter((a) => a.key !== key)
  if (next.length !== all.length) writeAll(tenantId, next)
}

/** Everything currently held — what a recovery view has to show. */
export function loadPendingActions(tenantId: string): SubmittedAction[] {
  return readAll(tenantId)
}
