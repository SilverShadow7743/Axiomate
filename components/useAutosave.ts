'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '@/lib/workspace'
import type { SubmittedAction } from '@/lib/idempotency'
import type { SaveState } from '@/lib/autosave'
import { shouldResume, verdictFor, type Halt, type ResumeTrigger, type Verdict } from '@/lib/queue'

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
 * Failures are separated by whether trying again could ever produce a different answer, which
 * `lib/queue.ts` decides and this hook obeys:
 *
 *   Network / 5xx    Retried inline with backoff. Once those run out the queue *pauses* —
 *                    holding its work, saying so, and starting itself again when connectivity
 *                    returns, when the tab is looked at, or on an escalating timer.
 *   Rejected (409)   The server's reducer disagreed, so the browser and the server no longer
 *                    agree about a record. Retrying replays the same refusal forever and every
 *                    action queued behind it was computed from the version that lost, so the
 *                    queue stops until a reload.
 *   No database      An answer rather than a failure. The queue is redundant and cleared.
 *
 * The distinction is the whole point. There was one `halted` flag, set in four places and
 * cleared in none, so a ten-second outage was indistinguishable from a permanent refusal and
 * ended persistence for the rest of the session.
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

/** 0.5s, 1s, 2s, 4s. Long enough to ride out a restart, short enough to feel responsive. */
const BACKOFF_MS = (attempt: number) => 500 * 2 ** attempt
/**
 * How long one request may hang before it is abandoned.
 *
 * Generous, because a cold start on a small App Service plan is slow and a batch opens a
 * twenty-second transaction server-side. Finite, because every transition in the halt policy
 * runs when a request settles — a socket that never answers leaves the queue running, draining
 * and unreachable by all three resume triggers.
 */
const REQUEST_TIMEOUT_MS = 30_000

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
  /**
   * Running, paused or stopped — never a single boolean again.
   *
   * `lib/queue.ts` decides which, and the whole point of the split is that a paused queue is
   * one the resume triggers below can start again. It used to be one flag, set in four places
   * and cleared in none.
   */
  const halt = useRef<Halt>('running')
  /** When it paused, and how many times, for the retry ladder. */
  const pausedAt = useRef(0)
  const pauses = useRef(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /**
   * Put the queue into the state the policy asked for.
   *
   * One place, so a halt can never again be set without its bookkeeping: the pause clock and
   * the ladder counter are what the resume triggers read, and setting `halt` without them
   * would produce a queue that is paused and never eligible to resume — which is the bug this
   * whole change exists to remove.
   */
  const settle = useCallback((verdict: Verdict) => {
    halt.current = verdict.halt
    if (!verdict.keepQueue) queue.current = []
    if (verdict.halt === 'paused') {
      pausedAt.current = Date.now()
      pauses.current += 1
    }
    if (!alive.current) return
    setState((s) => ({
      ...s,
      status: verdict.status,
      pending: queue.current.length,
      error: verdict.message,
    }))
  }, [])

  const drain = useCallback(async () => {
    if (draining.current || halt.current !== 'running' || !enabled) return
    draining.current = true

    try {
      while (queue.current.length && halt.current === 'running') {
        const batch = queue.current.slice(0, MAX_BATCH)
        if (alive.current) {
          setState((s) => ({ ...s, status: 'saving', pending: queue.current.length }))
        }

        let attempt = 0
        let done = false

        while (!done) {
          try {
            /**
             * A request that never answers is worse than one that fails.
             *
             * Every transition in the halt policy runs when a fetch settles, so a socket
             * blackholed by a wifi handover or a suspended laptop leaves the queue `running`
             * and `draining` forever: all three resume triggers decline because nothing is
             * paused, every new edit returns immediately because a drain is in progress, and
             * the indicator says "Saving" while the count climbs. The recovery window would
             * otherwise be whatever the operating system decides, which this app neither sets
             * nor knows.
             */
            const abort = new AbortController()
            const cutoff = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
            let res: Response
            try {
              res = await fetch('/api/workspace', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ actions: batch }),
                signal: abort.signal,
              })
            } finally {
              window.clearTimeout(cutoff)
            }

            /**
             * The status is read before the body is parsed.
             *
             * Parsing first meant anything answering with something other than JSON — a
             * gateway's HTML 403, a proxy's own 413, a login page where the API used to be —
             * threw before its status was ever examined, and was then classified as a network
             * outage and retried for the life of the session. The status is the part that is
             * always there.
             */
            let data: {
              ok?: boolean
              error?: string
              disabled?: boolean
              permanent?: boolean
              committedKeys?: string[]
            } = {}
            try {
              data = await res.json()
            } catch {
              data = {}
            }

            if (data.ok) {
              queue.current = withoutKeys(queue.current, batch)
              // A batch that got through means whatever was wrong is over. The ladder resets
              // so the next outage waits thirty seconds rather than four minutes.
              pauses.current = 0
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

            /**
             * Every non-success goes through the same policy, including the ones that are not
             * failures — a deployment with no database answers `disabled`, which is an answer.
             *
             * A 5xx returns `halt: 'running'`, which falls through to the retry below rather
             * than settling anything.
             */
            const verdict = verdictFor({
              kind: 'response',
              status: res.status,
              disabled: data.disabled,
              permanent: data.permanent,
              serverError: data.error,
              attempts: attempt + 1,
            })

            if (verdict.halt === 'running') {
              throw new Error(data.error ?? `Server returned ${res.status}.`)
            }

            /**
             * A refused batch still committed everything before the refusal, and those are
             * durable. Dropping them stops the count claiming work is held here when Postgres
             * already has it — and stops a reload being described as costing more than it does.
             */
            if (data.committedKeys?.length) {
              queue.current = withoutKeys(
                queue.current,
                data.committedKeys.map((key) => ({ key }) as SubmittedAction),
              )
            }

            settle(verdict)
            done = true
            break
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
            const verdict = verdictFor({
              kind: 'network',
              serverError: err instanceof Error ? err.message : undefined,
              attempts: attempt,
            })
            if (verdict.halt !== 'running') {
              settle(verdict)
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

  /**
   * Start a paused queue again, if the policy agrees this is the moment.
   *
   * Deliberately not called from `enqueueAll`. Making a keystroke consult the clock and
   * possibly fire a request would put retry policy in the typing path, and the three triggers
   * below are both better signals and none of them are driven by the user's hands.
   */
  const tryResume = useCallback(
    (trigger: ResumeTrigger) => {
      if (
        !shouldResume({
          halt: halt.current,
          trigger,
          pausedForMs: Date.now() - pausedAt.current,
          pauses: pauses.current - 1,
          online: navigator.onLine !== false,
          visible: document.visibilityState === 'visible',
        })
      ) {
        return
      }
      halt.current = 'running'
      if (alive.current) {
        // An empty queue resumes to `saved`, not to `saving`. Saying "Saving…" and then
        // calling a drain whose loop body never runs leaves the indicator claiming progress
        // for work that does not exist, until the next successful edit clears it.
        setState((s) =>
          queue.current.length
            ? { ...s, status: 'saving', pending: 0 + queue.current.length }
            : { ...s, status: 'saved', pending: 0, error: undefined },
        )
      }
      void drain()
    },
    [drain],
  )

  /**
   * The three ways a paused queue starts again.
   *
   * `online` is the event this is actually waiting for — connectivity returning. A tab
   * regaining focus is the next best thing, and covers the laptop that slept. The interval is
   * the fallback for a tab left open and untouched, escalating so an outage that has lasted an
   * hour is not asked about every thirty seconds.
   *
   * The timer is cleared on unmount rather than merely checked, because a callback that fires
   * after the hook is gone would drain a queue nothing is watching.
   */
  useEffect(() => {
    if (!enabled) return
    const onOnline = () => tryResume('online')
    const onVisible = () => tryResume('visible')
    const timer = window.setInterval(() => tryResume('timer'), 15_000)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, tryResume])

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
      /**
       * "Saving" only if something is actually going to be sent.
       *
       * It said so unconditionally, which meant one keystroke after any halt repainted the
       * indicator as progress: `drain()` returns immediately while the queue is stopped or
       * paused, so the screen read "Saving 12 changes…" and the tooltip "12 changes in
       * flight" with nothing in flight and nothing ever going to be. The error that had been
       * displayed a moment earlier was still in state and unreachable, because no branch
       * reads it for a saving status.
       *
       * That is the exact failure this file was rewritten to remove — a queue that has
       * stopped persisting while the interface reports progress — reachable by typing one
       * character.
       */
      setState((s) =>
        halt.current === 'running'
          ? { ...s, status: 'saving', pending: queue.current.length }
          : { ...s, pending: queue.current.length },
      )
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
      /**
       * Sent whatever the halt state is, provided there is something to send.
       *
       * It used to skip a halted queue, which meant the case where the beacon matters most —
       * a paused queue holding an outage's worth of work, on a tab about to close — was the
       * one case it declined to try. The outage may well be over by now, and this is the last
       * opportunity to find out. A stopped queue sends too: the head will be refused again and
       * nothing is lost by asking.
       */
      if (!queue.current.length) return
      const batch = queue.current.slice(0, MAX_BATCH)
      const payload = JSON.stringify({ actions: batch })
      const sent = navigator.sendBeacon?.(
        '/api/workspace',
        new Blob([payload], { type: 'application/json' }),
      )
      /**
       * The queue is NOT cleared, and that is the whole correction.
       *
       * `sendBeacon` returns true when the browser has accepted the payload for transfer —
       * not when the server accepted the writes. It is true while offline and true for a
       * request that will be answered 401, 409 or 500. Nothing here ever sees the response,
       * so treating that boolean as an acknowledgement deleted work on the strength of a
       * promise to try.
       *
       * It mattered because this fires on `visibilitychange`, not only on unload: a tab
       * switch or a phone locking runs it while the page keeps going. Mid-outage that meant
       * fifty actions removed from the only copy that exists — with a database configured the
       * browser mirror is deliberately off — while the indicator went on describing a queue
       * of ten and promising to keep trying.
       *
       * Keeping them costs a possible duplicate delivery, which is exactly what every action
       * carries a key to make safe. The drain remains the only thing that removes an action,
       * and it removes it on an answer rather than on a send.
       */
      void sent
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
      if (!queue.current.length && state.status !== 'error' && state.status !== 'paused') return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [enabled, state.status])

  return { state, enqueue, enqueueAll }
}
