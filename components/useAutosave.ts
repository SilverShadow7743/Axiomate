'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '@/lib/workspace'
import type { SubmittedAction } from '@/lib/idempotency'
import type { SaveState } from '@/lib/autosave'

/**
 * The autosave queue.
 *
 * One request in flight at a time, actions drained in the order they were dispatched. That
 * ordering is the whole point rather than a nicety: the server replays each action against
 * stored state, so two requests in parallel would both read the same pre-change snapshot and
 * the second would either be rejected or silently overwrite the first. The workspace is edited
 * faster than a round trip completes — inline cell edits, a drag, an assistant proposal — so
 * this is the normal case, not a race that needs contriving.
 *
 * Failures are separated by kind, because they need different answers:
 *
 *   Network / 5xx    transient. Retried with backoff, queue intact, user told nothing yet.
 *   Rejected (409)   the server's reducer disagreed. Not retryable — retrying replays the
 *                    same rejected action forever — so the queue stops and says so.
 */

/**
 * A key for one action, minted once when it is queued.
 *
 * `randomUUID` needs a secure context, which every deployment of this app is — localhost
 * counts. The fallback exists for the one case that is not worth losing the protection over:
 * an older browser, where two independent sources of entropy still collide far less often
 * than the redelivery this is guarding against.
 */
function mintKey(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * Remove the actions a request carried, identified by key rather than by position.
 *
 * By position is what this did, in both the drain and the unload flush, and the two race
 * against each other. A drain captures twenty actions and waits; the user types five more;
 * the tab is switched away — `visibilitychange`, so the page is still running — and the flush
 * sends the first twenty and drops twenty from the front, leaving five. The fetch then returns
 * and drops twenty *again*, from a queue that now holds five. The five are gone, and the
 * indicator says "Saved".
 *
 * Identity is what makes both removals idempotent and order-preserving, and it is available
 * only because every queued action now carries a key. An action with no key is kept: nothing
 * queues one today — `enqueueAll` stamps every action it accepts — and if some later path
 * does, holding an unacknowledged change is the safe way to be wrong.
 */
function withoutKeys(queued: SubmittedAction[], sent: SubmittedAction[]): SubmittedAction[] {
  const keys = new Set(sent.map((a) => a.key).filter(Boolean))
  return queued.filter((a) => !a.key || !keys.has(a.key))
}

const MAX_ATTEMPTS = 4
/** 0.5s, 1s, 2s, 4s. Long enough to ride out a restart, short enough to feel responsive. */
const BACKOFF_MS = (attempt: number) => 500 * 2 ** attempt
/** Beyond this the queue is drained in chunks, so one request never carries a whole session. */
const MAX_BATCH = 50

export interface Autosave {
  state: SaveState
  /** Queue an action for persistence. Returns immediately. */
  enqueue: (action: Action) => void
  /** Queue several, preserving order. */
  enqueueAll: (actions: Action[]) => void
}

export function useAutosave(enabled: boolean): Autosave {
  const [state, setState] = useState<SaveState>({ status: 'idle', pending: 0, savedAt: null })

  const queue = useRef<SubmittedAction[]>([])
  const draining = useRef(false)
  /** Set when the server rejects: the queue is stopped and nothing further is attempted. */
  const halted = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const drain = useCallback(async () => {
    if (draining.current || halted.current || !enabled) return
    draining.current = true

    try {
      while (queue.current.length && !halted.current) {
        const batch = queue.current.slice(0, MAX_BATCH)
        if (alive.current) {
          setState((s) => ({ ...s, status: 'saving', pending: queue.current.length }))
        }

        let attempt = 0
        let done = false

        while (!done) {
          try {
            const res = await fetch('/api/workspace', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ actions: batch }),
            })
            const data = (await res.json()) as { ok: boolean; error?: string; disabled?: boolean }

            if (data.disabled) {
              // The server has no database. Nothing to retry and nothing to warn about — the
              // local mirror is already carrying this session.
              queue.current = []
              halted.current = true
              done = true
              break
            }

            if (data.ok) {
              queue.current = withoutKeys(queue.current, batch)
              if (alive.current) {
                setState({
                  status: queue.current.length ? 'saving' : 'saved',
                  pending: queue.current.length,
                  savedAt: new Date().toISOString(),
                })
              }
              done = true
              break
            }

            // A reducer rejection is a disagreement about state, not a hiccup. Replaying it
            // would fail identically every time, so the queue stops and the user is told.
            // 401 is terminal for the same reason: retrying an unauthenticated request four
            // times produces four failures and one unhelpful message. It differs in the answer
            // — this one is fixable by the person reading it.
            if (res.status === 401) {
              halted.current = true
              if (alive.current) {
                setState((s) => ({
                  ...s,
                  status: 'error',
                  pending: queue.current.length,
                  error: 'Sign in to save. Your work is still here — signing in and reloading will send it.',
                }))
              }
              done = true
              break
            }

            if (res.status === 409 || res.status === 400) {
              halted.current = true
              if (alive.current) {
                setState((s) => ({
                  ...s,
                  status: 'error',
                  pending: queue.current.length,
                  error: data.error ?? 'The server rejected a change.',
                }))
              }
              done = true
              break
            }

            throw new Error(data.error ?? `Server returned ${res.status}.`)
          } catch (err) {
            attempt += 1
            /**
             * `>` rather than `>=`, because the last tier never ran.
             *
             * With four attempts and the check ahead of the sleep, the sequence was 0.5s, 1s,
             * 2s and then a halt — a budget of three and a half seconds, not the seven and a
             * half the constant above describes. A cold start on a small App Service plan takes
             * longer than either, so the retry gave up before the thing it was waiting for had
             * finished happening.
             */
            if (attempt > MAX_ATTEMPTS) {
              halted.current = true
              if (alive.current) {
                setState((s) => ({
                  ...s,
                  status: 'error',
                  pending: queue.current.length,
                  error: err instanceof Error ? err.message : 'The server is unreachable.',
                }))
              }
              done = true
              break
            }
            if (alive.current) setState((s) => ({ ...s, status: 'retrying' }))
            await new Promise((r) => setTimeout(r, BACKOFF_MS(attempt - 1)))
          }
        }
      }
    } finally {
      draining.current = false
    }
  }, [enabled])

  const enqueueAll = useCallback(
    (actions: Action[]) => {
      if (!enabled || !actions.length) return
      /**
       * Queued even when the drain has halted, and this is the whole point.
       *
       * It used to return here, so after a halt the person kept editing, the reducer kept
       * accepting, and nothing was recorded anywhere — with a database configured the browser
       * mirror is deliberately off, so the queue in this ref was the only copy. An afternoon of
       * work could exist solely as React state, and the message on screen advised a reload.
       *
       * Holding the actions instead costs nothing and keeps two ways out: the unload beacon can
       * still deliver them, and a resumed drain sends them in order.
       */
      /**
       * The idempotency key is stamped here, once, as the action enters the queue.
       *
       * Here rather than at send time, because an action can legitimately be sent twice and
       * a key minted per request would differ each time — which is exactly the case that
       * needs catching. The unload beacon below can carry a slice a live request is already
       * carrying, and a retry after an ambiguous timeout re-sends a batch the server may
       * already have committed. Stamped at enqueue, both deliveries carry the same key and
       * the server applies the action once.
       */
      queue.current.push(...actions.map((action) => ({ ...action, key: mintKey() })))
      setState((s) => ({ ...s, status: 'saving', pending: queue.current.length }))
      void drain()
    },
    [enabled, drain],
  )

  const enqueue = useCallback((action: Action) => enqueueAll([action]), [enqueueAll])

  /**
   * A tab being closed mid-drain would otherwise drop whatever is still queued. `fetch` is
   * cancelled on unload; `sendBeacon` is the one transport the browser guarantees to deliver
   * after the page is gone.
   */
  useEffect(() => {
    if (!enabled) return
    /**
     * Deliberately not checking `draining.current`.
     *
     * The beacon can carry actions a live request is already carrying, and that overlap is
     * correct: `fetch` is cancelled when the page goes away, so a request in flight at that
     * moment has no guarantee of arriving, and holding its actions back to avoid sending them
     * twice would trade a duplicate for a silent loss. Each action carries a key, so the
     * server applies it once — the double send is safe, and it is the reason the key exists.
     */
    const flush = () => {
      if (!queue.current.length || halted.current) return
      const batch = queue.current.slice(0, MAX_BATCH)
      const payload = JSON.stringify({ actions: batch })
      const sent = navigator.sendBeacon?.(
        '/api/workspace',
        new Blob([payload], { type: 'application/json' }),
      )
      // Only what the beacon actually carried. Clearing the whole queue discarded everything
      // past the batch limit — on a queue of sixty, ten changes were dropped on the floor with
      // nothing said, which is the failure the beacon was added to prevent.
      if (sent) queue.current = withoutKeys(queue.current, batch)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [enabled])

  /** Warn before leaving with work still in flight — the one case a prompt is warranted. */
  useEffect(() => {
    if (!enabled) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!queue.current.length && state.status !== 'error') return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [enabled, state.status])

  return { state, enqueue, enqueueAll }
}
