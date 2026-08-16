import type { SaveStatus } from './autosave'

/**
 * When the autosave queue stops, and whether it ever starts again.
 *
 * The queue had one flag: halted. It was set in four places and cleared in none, so every
 * failure was the same failure and all of them were permanent. A ten-second outage — a laptop
 * lid, a lift, a wifi handover — ended persistence for the rest of the session. The user was
 * told once, kept working, and everything after that lived only in React state.
 *
 * The distinction that fixes it is not "was there an error" but **will trying again ever
 * produce a different answer**:
 *
 *   paused    The request never landed, or landed on a server having a bad moment. Nothing is
 *             wrong with the work. Trying again later is the whole remedy.
 *   stopped   Trying again cannot help. Either there is no database to write to, or the server
 *             refused the change on its merits and will refuse it identically forever.
 *
 * A stopped queue is not a lost queue: it keeps what it holds so the unload beacon can still
 * deliver it and so the count of unsaved work can be shown honestly. The one exception is a
 * deployment with no database at all, where there is nothing to deliver to and holding the
 * actions would only misreport them as pending.
 *
 * This module is the policy alone — no fetch, no timers, no browser. `useAutosave` supplies
 * the failure and the signals and does what it is told, which is what lets the rule be driven
 * without a network to take away.
 */

export type Halt = 'running' | 'paused' | 'stopped'

/** What came back, or did not. */
export interface Failure {
  /** `network` when the request produced no response at all. */
  kind: 'network' | 'response'
  /** HTTP status, when there was one. */
  status?: number
  /** The server saying it has no database — an answer, not a failure. */
  disabled?: boolean
  /** The server's own words, which are more specific than anything invented here. */
  serverError?: string
  /** Attempts already spent on this batch, including the one that just failed. */
  attempts: number
}

export interface Verdict {
  halt: Halt
  /** Whether the queued actions are worth keeping. */
  keepQueue: boolean
  status: SaveStatus
  /** What to tell the person. Absent when there is nothing worth saying. */
  message?: string
}

/** Attempts spent inline, with backoff, before a batch is set aside. */
export const MAX_ATTEMPTS = 4

export function verdictFor(f: Failure, maxAttempts: number = MAX_ATTEMPTS): Verdict {
  if (f.kind === 'response') {
    /**
     * No database configured. Not an error and not retryable: this deployment saves in the
     * browser, the mirror is already carrying the session, and the queue is redundant.
     */
    if (f.disabled) {
      return { halt: 'stopped', keepQueue: false, status: 'local' }
    }

    /**
     * Unauthenticated. Paused rather than stopped because a session cookie can be renewed in
     * another tab and this one will find it on the next attempt.
     *
     * Signing in from *here* does not resume anything — it redirects, the page reloads and
     * this hook is destroyed — so the message says what actually recovers the work rather
     * than implying the queue survives the trip.
     */
    if (f.status === 401) {
      return {
        halt: 'paused',
        keepQueue: true,
        status: 'error',
        message:
          'Sign in to save. Your work is still here — signing in and reloading will send it.',
      }
    }

    /**
     * The server's reducer refused the change, or the request was malformed. Replaying it
     * produces the same refusal forever, so the queue stops.
     *
     * Stopped for the whole session rather than for the one action, and that is a decision
     * rather than an oversight. A refusal means the browser and the server now disagree about
     * a record; every action queued after it was computed against the version that lost, so
     * sending them would write more changes derived from a state the server never had. The
     * remedy is to reload and look at what is actually stored.
     *
     * What must not happen — and used to — is the queue quietly filling up behind this while
     * the indicator shows a single stale error. The count travels with the message so the
     * person can see how much is unsaved before deciding to reload.
     */
    /**
     * A batch the endpoint considers too large, which no amount of waiting shrinks.
     *
     * Unreachable today — the client chunks at fifty and the endpoint refuses at two hundred —
     * and listed anyway, because the alternative is a status that falls through to the retry
     * path and is then retried for the life of the session. A permanent refusal treated as an
     * outage is precisely the failure this module exists to stop, and it should not depend on
     * two constants in different files continuing to disagree in the right direction.
     */
    if (f.status === 413) {
      return {
        halt: 'stopped',
        keepQueue: true,
        status: 'error',
        message: f.serverError ?? 'That batch was too large to save.',
      }
    }

    if (f.status === 409 || f.status === 400) {
      return {
        halt: 'stopped',
        keepQueue: true,
        status: 'error',
        message: f.serverError ?? 'The server rejected a change.',
      }
    }
  }

  /**
   * Everything else — a dropped connection, a 500, a cold start that outlasted the backoff.
   * Retried inline while attempts remain, and set aside rather than abandoned once they run
   * out.
   */
  if (f.attempts > maxAttempts) {
    return {
      halt: 'paused',
      keepQueue: true,
      status: 'paused',
      message: f.serverError ?? 'The server is unreachable.',
    }
  }
  return { halt: 'running', keepQueue: true, status: 'retrying' }
}

/**
 * How long a paused queue waits before trying again on its own.
 *
 * Escalating and capped. The first retry is soon because most outages are brief; the cap
 * exists because a queue that has been failing for an hour is not going to be rescued by
 * asking more often, and a tab left open overnight should not spend the night retrying every
 * thirty seconds.
 *
 * The timer is the fallback, not the main path — `online` and a tab regaining focus are both
 * faster and more informative than any interval.
 */
export function resumeDelayMs(pauses: number): number {
  const ladder = [30_000, 60_000, 120_000, 240_000]
  return ladder[Math.min(pauses, ladder.length - 1)] ?? 300_000
}

export type ResumeTrigger = 'timer' | 'online' | 'visible'

/**
 * Whether a paused queue should try again now.
 *
 * The signals are passed in rather than read from `navigator` and `document`, so both branches
 * can be driven without a browser — and so the rule cannot quietly depend on something the
 * caller did not think it was providing.
 *
 * `online` gates every trigger. The flag is famously optimistic — it reports a connection to a
 * router that reaches nothing — but a false is trustworthy, and declining to retry while the
 * machine knows it is offline costs nothing.
 */
export function shouldResume(s: {
  halt: Halt
  trigger: ResumeTrigger
  /** Milliseconds since the queue paused. */
  pausedForMs: number
  /** How many times it has paused, for the delay ladder. */
  pauses: number
  online: boolean
  visible: boolean
}): boolean {
  if (s.halt !== 'paused') return false
  if (!s.online) return false
  // Connectivity returning is the event this is waiting for; there is nothing to wait out.
  if (s.trigger === 'online') return true
  // Somebody looking at the tab again is worth a try, but only if they are actually looking.
  if (s.trigger === 'visible') return s.visible
  return s.pausedForMs >= resumeDelayMs(s.pauses)
}
