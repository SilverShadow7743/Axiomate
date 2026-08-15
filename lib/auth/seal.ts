import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signing and checking a session cookie, with the key as a parameter.
 *
 * Split from the module that reads the secret so this half is testable. The separation is not
 * only for tests: a function that reaches into the environment can only be exercised by
 * arranging the environment, and the arrangement is usually what the test gets wrong. Here the
 * key is an argument, so a tampered cookie and an expired one can be checked directly.
 *
 * What is in a session cookie, and why it is signed rather than encrypted: it carries an object
 * id, a name, an address and an expiry — facts the person already knows about themselves.
 * Encrypting them would hide them from the one party entitled to read them while doing nothing
 * about the only real risk, which is somebody *writing* one.
 */

export interface SessionClaims {
  /** The provider's stable object id. The join key, and the thing that does not change. */
  oid: string
  name: string
  email: string
  /** Seconds since the epoch, checked here rather than trusted to the browser's own expiry. */
  exp: number
}

/** Shorter keys are the ones typed in as "changeme" and left. */
export const MIN_SECRET_LENGTH = 32

export function seal(claims: SessionClaims, key: string): string {
  if (key.length < MIN_SECRET_LENGTH) {
    throw new Error(`The session secret must be at least ${MIN_SECRET_LENGTH} characters.`)
  }
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return `${body}.${mac(body, key)}`
}

/**
 * Open a cookie, or say why not.
 *
 * A reason rather than null, so a caller can tell an expired session from a forged one — the
 * first is a person who needs to sign in again, and the second is worth noticing.
 */
export function open(
  value: string | undefined,
  key: string | null,
  now: number = Date.now(),
): { claims: SessionClaims } | { reason: string } {
  if (!value) return { reason: 'no cookie' }
  if (!key) return { reason: 'no signing secret configured' }

  const [body, signature] = value.split('.')
  if (!body || !signature) return { reason: 'malformed' }

  const a = Buffer.from(signature)
  const b = Buffer.from(mac(body, key))
  // Length first: `timingSafeEqual` throws on a mismatch rather than returning false.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { reason: 'bad signature' }

  let claims: SessionClaims
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionClaims
  } catch {
    return { reason: 'unreadable' }
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return { reason: 'expired' }
  return { claims }
}

function mac(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url')
}
