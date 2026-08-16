import type { Action } from './workspace'

/**
 * Deciding what a re-delivered batch should still do.
 *
 * The write endpoint can be handed the same action twice, and neither cause is exotic:
 *
 *   The unload beacon   `fetch` is cancelled when a tab goes away, so the queue flushes over
 *                       `sendBeacon` instead. That beacon can carry a slice the in-flight
 *                       request is already carrying — the two overlap by design, because the
 *                       alternative is dropping work that was never acknowledged.
 *   An ambiguous retry  the connection drops after the server committed but before the
 *                       response arrives. The client cannot tell that apart from a request
 *                       that never landed, so it retries, correctly.
 *
 * Nothing in the reducer can prevent the resulting duplicate. It mints ids from the workspace
 * counter, so replaying `addNote` produces a *second* note rather than overwriting the first —
 * the write is legal, and the record is real. Only the transport knows the two deliveries were
 * the same intent, so the transport is what has to say so: each action is stamped with a key
 * when it enters the queue, and an action whose key has already been applied is skipped.
 *
 * Stamped per action rather than per request, which is the part that matters. A request-level
 * key would leave the beacon case wide open: an overlapping slice is a genuinely different
 * request carrying some of the same actions, so its key would differ and every action in the
 * overlap would apply twice.
 *
 * This module is the decision alone — no database, no transaction, no clock. `lib/db/persist`
 * supplies the set of keys already recorded and writes the new ones down. Splitting it that
 * way is what lets the rule be tested without a Postgres to connect to, the same split as
 * `secretRules.ts` against `secrets.ts`.
 */

/**
 * An action as it arrives over the wire.
 *
 * The key is transport metadata and the reducer never reads it: `apply()` takes the action
 * itself, and nothing in the workspace vocabulary knows a request exists. Keeping it optional
 * is deliberate too — intake and the scheduled pass call the same write path without one,
 * because a message id and a clock are already their own protection against repeating.
 */
export type SubmittedAction = Action & { key?: string }

/** An action to apply, and the key to record if the whole batch commits. */
export interface Planned {
  action: Action
  key: string | null
}

export interface Split {
  /** What to apply, in the order submitted. */
  planned: Planned[]
  /** Keys recognised as already applied, so the result can say so rather than stay silent. */
  skipped: string[]
  /** Keys to write down on success. Deduplicated by construction — see `split`. */
  record: string[]
}

/**
 * Long enough for a UUID and then some, short enough that a key cannot be used to store data.
 * The value becomes half of a primary key, so this is a storage bound as much as a sanity one.
 */
export const MAX_KEY_LENGTH = 128

/**
 * Short enough to type, long enough not to collide by accident.
 *
 * A minimum matters because a key is only worth having if two browsers cannot mint the same
 * one. `crypto.randomUUID()` clears this comfortably; a naive client numbering its actions
 * from one would not, and would silently suppress a colleague's writes as duplicates of its
 * own. Better to refuse that at the boundary than to honour it.
 */
export const MIN_KEY_LENGTH = 8

/** A UUID, or anything else built from characters that survive a URL and a column unaltered. */
const KEY_SHAPE = /^[A-Za-z0-9_.:-]+$/

/**
 * Whether a value can be used as an idempotency key.
 *
 * Called at the route boundary rather than here, because a malformed key is a client bug worth
 * reporting: ignoring it would leave the request working and its protection quietly switched
 * off, which is the failure mode this whole module exists to remove.
 */
export function keyProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null // Unkeyed is allowed; see above.
  if (typeof value !== 'string') return 'An action key must be a string.'
  if (value.length < MIN_KEY_LENGTH) {
    return `An action key must be at least ${MIN_KEY_LENGTH} characters.`
  }
  if (value.length > MAX_KEY_LENGTH) {
    return `An action key must be at most ${MAX_KEY_LENGTH} characters.`
  }
  if (!KEY_SHAPE.test(value)) return 'An action key may only contain letters, digits, . : - and _.'
  return null
}

/**
 * Split a submitted batch into what to apply and what has already been done.
 *
 * `seen` is the set of keys this tenant has recorded. Three rules, and the second is the one
 * that is easy to miss:
 *
 *   1. An action whose key is in `seen` is skipped. It has been applied and committed.
 *   2. An action whose key appeared *earlier in this same batch* is skipped as well. A client
 *      that stamps two actions identically is buggy, but the buggy case must not be the one
 *      that fails the insert — collapsing it here is what keeps `record` free of duplicates.
 *   3. An action with no key is always applied and never recorded. Absent means "not eligible
 *      for this protection", never "reject".
 *
 * Order is preserved, and skipping is safe with respect to it. Each surviving action is
 * replayed against the state the skipped one already produced, because a key is only in `seen`
 * once its transaction committed.
 */
export function split(submitted: readonly SubmittedAction[], seen: ReadonlySet<string>): Split {
  const planned: Planned[] = []
  const skipped: string[] = []
  const record: string[] = []
  const withinBatch = new Set<string>()

  for (const item of submitted) {
    const { key, ...rest } = item as SubmittedAction & Record<string, unknown>
    const action = rest as unknown as Action

    if (typeof key !== 'string' || !key) {
      planned.push({ action, key: null })
      continue
    }
    if (seen.has(key) || withinBatch.has(key)) {
      skipped.push(key)
      continue
    }
    withinBatch.add(key)
    planned.push({ action, key })
    record.push(key)
  }

  return { planned, skipped, record }
}

/** The keys worth looking up — what a caller needs before it can build `seen`. */
export function keysIn(submitted: readonly SubmittedAction[]): string[] {
  const out = new Set<string>()
  for (const a of submitted) if (typeof a.key === 'string' && a.key) out.add(a.key)
  return [...out]
}

/**
 * How long a key is worth remembering.
 *
 * A key protects against a redelivery, and every redelivery this endpoint can see happens
 * within seconds: a retry inside the queue's backoff budget, or a beacon fired as the tab
 * closes. Thirty days is far beyond any of that and is chosen for the operator rather than the
 * mechanism — it is long enough that "did this batch land?" can still be answered by hand a
 * month later.
 *
 * The table is pruned by the daily pass rather than by the write path. Deleting expired rows
 * inside every batch would put two concurrent writers in contention over the same old rows
 * under serializable isolation, which is a conflict invented by housekeeping — exactly the
 * kind of false conflict the field-level concurrency check was written to avoid.
 */
export const KEY_RETENTION_DAYS = 30
