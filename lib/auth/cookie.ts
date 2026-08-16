import 'server-only'
import { MIN_SECRET_LENGTH, open, seal, type SessionClaims } from './seal'
import { readSecret, secretProblem } from '../secrets'

/**
 * The session cookie, and where its key comes from.
 *
 * All this adds to `./seal` is the secret and the cookie's attributes — both of which are
 * server concerns, which is why the marker is on this file and not on the arithmetic. No
 * secret means no sessions, deliberately: a signing key with a default is a key everybody has.
 */

export type { SessionClaims }

export const SESSION_COOKIE = 'axiomate_session'
/** Eight hours: a working day, after which somebody signs in again. */
export const SESSION_SECONDS = 8 * 60 * 60

/**
 * The signing key, or nothing.
 *
 * The length test alone was not enough. An unresolved Key Vault reference is passed through
 * literally by App Service and is about seventy characters, so it sailed past a check for
 * thirty-two and became the key — one derivable by anyone who can read the vault name and the
 * secret name, both of which are in this repository's deployment templates. Every first
 * deployment starts in exactly that state, because the vault needs the application's identity
 * and so the application is created first with its references already in place.
 */
function secret(): string | null {
  const result = readSecret('AXIOMATE_SESSION_SECRET', MIN_SECRET_LENGTH)
  return 'value' in result ? result.value : null
}

/** Why there are no sessions, for an operator who can act on it. Null when there is no problem. */
export function signingProblem(): string | null {
  return secretProblem('AXIOMATE_SESSION_SECRET', MIN_SECRET_LENGTH)
}

export function signingConfigured(): boolean {
  return secret() !== null
}

export function sign(claims: SessionClaims): string {
  const key = secret()
  if (!key) throw new Error(signingProblem() ?? 'The session signing key is unusable.')
  return seal(claims, key)
}

export function verify(value: string | undefined): { claims: SessionClaims } | { reason: string } {
  return open(value, secret())
}

/** The attributes in one place, because getting one wrong is how a session cookie leaks. */
export function cookieAttributes(secure: boolean): string {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${SESSION_SECONDS}`,
  ]
    .filter(Boolean)
    .join('; ')
}
