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

function haltedKey(tenantId: string): string {
  return `axiomate.pending-actions-halted.v1:${tenantId}`
}

/**
 * Marked the moment a queue actually stops (`Halt: 'stopped'`, `lib/queue.ts`) — never on a
 * merely paused or still-running one, and never just because an entry exists in the log below.
 * An entry existing only means "queued, not yet confirmed", which is the ordinary state of
 * every action between being dispatched and the response landing a moment later — most sessions
 * that end (reload, tab close) end during exactly that ordinary gap, not during a real halt, and
 * showing THAT as a loss would be a false alarm on a change that in fact saved fine.
 *
 * Read together with `loadPendingActions`, never alone: an entry with no halt ever recorded for
 * this tenant is in flight, not stuck.
 */
export function markHalted(tenantId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(haltedKey(tenantId), '1')
  } catch {
    /* Best-effort marker — a failure here just means a leftover entry reads as in-flight
     * rather than stuck, the same as if no halt had been recorded at all. */
  }
}

export function wasHalted(tenantId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(haltedKey(tenantId)) === '1'
  } catch {
    return false
  }
}

/**
 * Reset once the log is actually clear — otherwise a stale marker from a halt that was already
 * resolved would misclassify the next ordinary in-flight gap as a stuck change all over again.
 */
export function clearHalted(tenantId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(haltedKey(tenantId))
  } catch {
    /* best-effort, same as markHalted */
  }
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

/**
 * One plain-language line for a stuck action — the same shape `History` already renders an
 * `AuditEntry` in (`lib/types.ts`'s `rowId`/`field`/`from`/`to`, rendered by
 * `components/DetailPanel.tsx`'s `History`), so a stuck change reads like any other change in
 * this app rather than like raw queued data.
 *
 * `updateIssue` is the only action shape this app's write paths route a field edit through
 * (`onCommitCell`, the FieldStrip/Overview commit funnel), so it is the only one described
 * field-by-field; `expected` — the value the browser last saw — becomes the "from" half exactly
 * as `AuditEntry.from` would. Everything else this app can dispatch has no per-field shape to
 * describe this way, so it is named by its own action type and whichever id it carries, rather
 * than guessed at.
 */
export function describeAction(action: SubmittedAction): string {
  if (action.t === 'updateIssue') {
    const expected = action.expected as Record<string, unknown> | undefined
    const parts = Object.entries(action.patch as Record<string, unknown>).map(([field, to]) => {
      const from = expected?.[field]
      return from !== undefined ? `${field}: ${String(from)} → ${String(to)}` : `${field} → ${String(to)}`
    })
    return `${action.id} — ${parts.join(', ')}`
  }
  const rest = action as unknown as Record<string, unknown>
  const id = typeof rest.id === 'string' ? rest.id : typeof rest.issueId === 'string' ? rest.issueId : ''
  return id ? `${action.t} — ${id}` : action.t
}
