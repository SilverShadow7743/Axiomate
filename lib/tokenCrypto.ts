import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Sealing one secret string for storage — the delegated Graph refresh token — and opening it
 * again. See `docs/plans/2026-09-11-durable-personal-graph-tokens-design.md`.
 *
 * Pure: no I/O, no clock, no environment. The key is handed in, so the scenario harness can
 * drive this with a fixed one and the server derives the real one from the session secret.
 *
 * AES-256-GCM: authenticated, so a row edited in the database opens as `null` rather than as
 * a token that is "almost right". A fresh 96-bit IV per seal, so two stores of the same token
 * never produce the same ciphertext. The version prefix is there so a later scheme can be told
 * apart from this one on read instead of guessed at.
 */

const VERSION = 'v1'
const TOKEN_KEY_INFO = 'axiomate personal-graph refresh token v1'
const TOKEN_KEY_SALT = 'axiomate'

/**
 * A 32-byte key derived from the session secret by HKDF-SHA256 with a purpose-specific info
 * string — a distinct key from the one that signs cookies, without a second secret for an
 * operator to provision. Rotating the session secret therefore rotates this key, which turns
 * every stored token into a "reconnect once"; that is the intended consequence, not a bug.
 */
export function deriveTokenKey(masterSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterSecret, TOKEN_KEY_SALT, TOKEN_KEY_INFO, 32))
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

/** The plaintext, or null for anything that does not open cleanly — wrong key, tampering, another version. */
export function decryptSecret(sealed: string, key: Buffer): string | null {
  const [version, ivPart, tagPart, ctPart] = sealed.split('.')
  if (version !== VERSION || !ivPart || !tagPart || !ctPart) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ctPart, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
