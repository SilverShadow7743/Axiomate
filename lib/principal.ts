import 'server-only'
import type { Actor } from './actor'
import { currentActor } from './identity'

/**
 * The boundary a login plugs into.
 *
 * Named for the principal rather than the session, because `lib/session.ts` already exists and
 * holds something else entirely — how the viewer wants dates rendered. Those two were one
 * record once, and separating them is what made attribution trustworthy; putting them back
 * together under one filename would undo the distinction in the reader's head if not in the
 * code.
 *
 * ---------------------------------------------------------------------------
 * Why this exists before authentication does
 *
 * Every server path that needs to know who is acting now asks *one* function, and that
 * function takes the request. Today it ignores the request and returns the configured
 * operator — which is exactly what `currentActor` already did — so nothing behaves
 * differently. What changes is the shape: the day a provider is chosen, a session is read
 * here, and no route, no reducer call and no write path is touched.
 *
 * Building the seam early is cheap and building it late is not, because the alternative is
 * threading a request parameter through every call site under time pressure, at the exact
 * moment somebody is also trying to get an OAuth redirect working.
 *
 * ---------------------------------------------------------------------------
 * What it is honest about
 *
 * `verified` is false and stays false until there is something to verify against. It is
 * returned rather than assumed so that a caller which genuinely must not act on an unverified
 * claim — a client-facing endpoint, say — can check rather than trusting the shape of the
 * object it was handed. Nothing checks it yet, and that is a true statement about this
 * deployment rather than an oversight: with one configured operator, refusing unverified
 * requests would refuse all of them.
 *
 * The intended provider is Microsoft Entra ID, because that is what the firm this is built for
 * already runs. That is a decision for whoever operates it, not one this file should make by
 * shipping a credential store: passwords, hashing, session expiry, lockout and recovery are a
 * security subsystem in their own right, and building one that an identity provider then
 * replaces is the expensive way to arrive in the same place.
 */

export interface Session {
  actor: Actor
  /**
   * Whether the actor proved who they are.
   *
   * Always false today. When it becomes true it will be because a provider said so, and the
   * permission model — which is already enforced — will finally be resting on something.
   */
  verified: boolean
  /** How the actor was established, for the operator reading a log and wondering. */
  source: 'configured-operator' | 'session'
}

/**
 * Who is making this request.
 *
 * The request is a parameter and is currently unused. That is deliberate and is the whole
 * point: a signature that already carries the request can start reading a cookie without
 * changing a single caller.
 */
export function getSession(_req?: Request): Session {
  return { actor: currentActor(), verified: false, source: 'configured-operator' }
}

/**
 * Whether this deployment can tell two people apart.
 *
 * Exported so a screen can say so plainly rather than implying a security boundary that does
 * not exist. The permissions screen uses it; anything else that describes access control
 * should too.
 */
export function identityEstablished(): boolean {
  return getSession().verified
}
