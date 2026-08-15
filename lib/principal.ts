import 'server-only'
import type { Actor } from './actor'
import { currentActor } from './identity'
import { SESSION_COOKIE, verify } from './auth/cookie'
import { configured as entraConfigured } from './auth/entra'
import { cookies } from 'next/headers'

/**
 * Who is making this request.
 *
 * ---------------------------------------------------------------------------
 * Two modes, and the deployment decides which
 *
 * With Entra configured, this reads the signed session cookie and returns a *verified*
 * principal — the person who signed in, identified by the object id their directory gave them.
 * With Entra absent it returns the single configured operator, unverified, exactly as before.
 *
 * Both are honest states and the difference is reported rather than hidden. A deployment
 * without credentials keeps working; a deployment with them stops accepting a claim on trust.
 * What does not happen in either mode is the middle case — a login screen that cannot be
 * satisfied, or a verified flag set because the shape of the code implies one.
 *
 * ---------------------------------------------------------------------------
 * Why the actor id becomes the object id
 *
 * Because it is the only identifier that survives somebody changing their name or their email
 * address, and attribution has to outlive both. The display name still goes in the trail — a
 * reader needs to know who, not which GUID — but the id underneath is the directory's own.
 */

export interface Session {
  actor: Actor
  /** Whether the actor proved who they are. False is a real answer, not a placeholder. */
  verified: boolean
  source: 'entra' | 'configured-operator'
  /** The address the directory can be joined on, when a provider supplied one. */
  email: string | null
  /** Why there is no verified principal, when there could have been one. */
  reason?: string
}

/**
 * The session, from a value already in hand.
 *
 * Split from `getSession` because the two callers get the cookie in different ways and only one
 * of them can await: a route handler has the `Request`, and a server component has to ask
 * Next for the cookie store, which is asynchronous. Sharing this keeps the *decisions* — what
 * counts as verified, what happens when a provider is configured and nobody signed in — in one
 * place, which is the part that must not diverge.
 */
function sessionFrom(cookie: string | undefined): Session {
  if (!entraConfigured()) {
    return {
      actor: currentActor(),
      verified: false,
      source: 'configured-operator',
      email: null,
    }
  }

  const result = verify(cookie)
  if ('claims' in result) {
    const { oid, name, email } = result.claims
    return {
      actor: { id: oid, name: name || email || oid },
      verified: true,
      source: 'entra',
      email: email || null,
    }
  }

  /**
   * Configured but not signed in.
   *
   * The configured operator is *not* returned here. Falling back to it on a deployment that has
   * chosen an identity provider would mean every unauthenticated request quietly acting as
   * whoever that operator is — which is the exact hole switching Entra on was meant to close.
   */
  return {
    actor: { id: 'anonymous', name: 'Not signed in' },
    verified: false,
    source: 'entra',
    email: null,
    reason: result.reason,
  }
}

/** Whether this deployment can tell two people apart at all. */
export function identityEstablished(): boolean {
  return entraConfigured()
}

/** For a route handler, which has the request. */
export function getSession(req?: Request): Session {
  return sessionFrom(cookieValue(req, SESSION_COOKIE))
}

/**
 * For a server component, which does not.
 *
 * `boot()` is already asynchronous, so this costs nothing there — and skipping it was why an
 * Entra deployment rendered every page as "Not signed in" immediately after a successful
 * sign-in: the cookie was in the browser and the server never looked at it.
 */
export async function getSessionFromCookies(): Promise<Session> {
  const store = await cookies()
  return sessionFrom(store.get(SESSION_COOKIE)?.value)
}

function cookieValue(req: Request | undefined, name: string): string | undefined {
  const header = req?.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return undefined
}
