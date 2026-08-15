import 'server-only'
import { MIN_SECRET_LENGTH, open, seal, type SessionClaims } from './seal'

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

function secret(): string | null {
  const value = process.env.AXIOMATE_SESSION_SECRET?.trim()
  return value && value.length >= MIN_SECRET_LENGTH ? value : null
}

export function signingConfigured(): boolean {
  return secret() !== null
}

export function sign(claims: SessionClaims): string {
  const key = secret()
  if (!key) {
    throw new Error(
      `AXIOMATE_SESSION_SECRET is not set, or is shorter than ${MIN_SECRET_LENGTH} characters.`,
    )
  }
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
