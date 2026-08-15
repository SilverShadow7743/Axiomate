'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '@/lib/workspace'
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

  const queue = useRef<Action[]>([])
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
              queue.current = queue.current.slice(batch.length)
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
            if (attempt >= MAX_ATTEMPTS) {
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
      if (!enabled || halted.current || !actions.length) return
      queue.current.push(...actions)
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
    const flush = () => {
      if (!queue.current.length || halted.current) return
      const payload = JSON.stringify({ actions: queue.current.slice(0, MAX_BATCH) })
      const sent = navigator.sendBeacon?.(
        '/api/workspace',
        new Blob([payload], { type: 'application/json' }),
      )
      if (sent) queue.current = []
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
