import 'server-only'
import { AXIOMATE_DELEGATED_SCOPES, entraConfig } from '../auth/entra'
import { MIN_SECRET_LENGTH } from '../auth/seal'
import { secretValue } from '../secrets'
import { currentTenantId } from '../tenant'
import { decryptSecret, deriveTokenKey, encryptSecret } from '../tokenCrypto'
import { databaseConfigured, withTenant } from './client'

/**
 * The personal-Graph-token cache — one person's own delegated Graph access, read by the
 * inbox/file routes and by schedule/reply/compose/chat. One sign-in carries every scope in
 * `AXIOMATE_DELEGATED_SCOPES` in the SAME token, so this is one entry per person, keyed by
 * their Entra oid — the claim every session cookie already carries.
 *
 * **Posture, revised 11 September 2026** (`docs/plans/2026-09-11-durable-personal-graph-tokens-
 * design.md`, at Nishant's direction: "there should be a way to connect to your inbox without
 * reconnecting"). From 31 Aug to 11 Sep this map was the ONLY place tokens lived, and the
 * stated cost was that every app restart — which App Service does routinely — emptied it and
 * every personal feature said "reconnect". That cost was paid on every deploy. Now:
 *
 *   - Access tokens are still RAM-only. They live an hour and are never written anywhere.
 *   - The REFRESH token is also written to `PersonalGraphToken`, sealed with AES-256-GCM under
 *     a key derived from the session secret (`lib/tokenCrypto.ts`) — so a restart, or a second
 *     instance, re-acquires access on the first cache miss with no one signing in again.
 *   - Nothing here is a dependency of anything: with no database, or no session secret, the
 *     behaviour is exactly the RAM-only one it replaced; a database error on store or load is
 *     logged and the caller sees "reconnect", never an error page.
 *   - A refresh Entra refuses (revoked, expired, consent withdrawn) deletes the row: a token
 *     that no longer works is not kept at rest waiting to be found.
 *
 * What a database backup now contains: ciphertexts that open only with the session secret,
 * which is not in the database. Rotating that secret turns every stored token into one
 * reconnect per person, by design. The single-instance assumption this file used to carry is
 * gone with the map's monopoly.
 */

interface CachedTokens {
  access: string
  refresh: string
  expiresAt: number
}

const cache = new Map<string, CachedTokens>()

function tokenKey(): Buffer | null {
  const secret = secretValue('AXIOMATE_SESSION_SECRET', MIN_SECRET_LENGTH)
  return secret ? deriveTokenKey(secret) : null
}

function durable(): boolean {
  return databaseConfigured() && tokenKey() !== null
}

function report(what: string, oid: string, err: unknown): void {
  console.error(`personal graph token ${what} skipped for ${oid}: ${err instanceof Error ? err.message : String(err)}`)
}

async function persistRefresh(oid: string, refresh: string): Promise<void> {
  if (!durable()) return
  const key = tokenKey()!
  const tenantId = currentTenantId()
  const refreshCiphertext = encryptSecret(refresh, key)
  const updatedAt = new Date()
  await withTenant(tenantId, (tx) =>
    tx.personalGraphToken.upsert({
      where: { tenantId_oid: { tenantId, oid } },
      create: { tenantId, oid, refreshCiphertext, updatedAt },
      update: { refreshCiphertext, updatedAt },
    }),
  )
}

async function loadRefresh(oid: string): Promise<string | null> {
  if (!durable()) return null
  const key = tokenKey()!
  const tenantId = currentTenantId()
  const row = await withTenant(tenantId, (tx) =>
    tx.personalGraphToken.findUnique({ where: { tenantId_oid: { tenantId, oid } } }),
  )
  return row ? decryptSecret(row.refreshCiphertext, key) : null
}

async function forgetRefresh(oid: string): Promise<void> {
  if (!databaseConfigured()) return
  const tenantId = currentTenantId()
  await withTenant(tenantId, (tx) => tx.personalGraphToken.deleteMany({ where: { tenantId, oid } }))
}

/** Cache the sign-in's tokens and seal the refresh token at rest. Never throws: storage is a bonus on top of identity. */
export async function storePersonalGraphTokens(oid: string, tokens: CachedTokens): Promise<void> {
  cache.set(oid, tokens)
  try {
    await persistRefresh(oid, tokens.refresh)
  } catch (err) {
    report('store', oid, err)
  }
}

export async function dropPersonalGraphTokens(oid: string): Promise<void> {
  cache.delete(oid)
  try {
    await forgetRefresh(oid)
  } catch (err) {
    report('drop', oid, err)
  }
}

/**
 * A live access token for this person, or null — which every caller renders as "reconnect",
 * never as an error page. Refreshed when within five minutes of expiry. On a cache miss the
 * sealed refresh token is loaded and exchanged first, which is the whole of the 11 Sep change
 * from a caller's point of view: the miss that used to mean "reconnect" now means one round
 * trip to Entra.
 */
export async function getPersonalGraphToken(oid: string): Promise<string | null> {
  let entry = cache.get(oid)
  if (!entry) {
    let refresh: string | null = null
    try {
      refresh = await loadRefresh(oid)
    } catch (err) {
      report('load', oid, err)
    }
    if (!refresh) return null
    // An entry with no access token and an expiry in the past: the refresh below is forced.
    entry = { access: '', refresh, expiresAt: 0 }
    cache.set(oid, entry)
  }
  if (entry.expiresAt - Date.now() > 5 * 60_000) return entry.access

  const config = entraConfig()
  if (!config) return null
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: entry.refresh,
    scope: AXIOMATE_DELEGATED_SCOPES,
  })
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
    )
    if (!res.ok) {
      cache.delete(oid)
      // 400 is Entra's `invalid_grant`: the refresh token itself is dead (revoked, expired,
      // consent withdrawn). A dead token is not kept at rest. Anything else — a 5xx, a
      // throttle — keeps the row for the next attempt.
      if (res.status === 400) {
        try {
          await forgetRefresh(oid)
        } catch (err) {
          report('forget', oid, err)
        }
      }
      return null
    }
    const token = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    if (!token.access_token) {
      cache.delete(oid)
      return null
    }
    const next: CachedTokens = {
      access: token.access_token,
      // Entra rotates refresh tokens; keep the new one, fall back to the old if absent.
      refresh: token.refresh_token ?? entry.refresh,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    }
    cache.set(oid, next)
    if (next.refresh !== entry.refresh) {
      try {
        await persistRefresh(oid, next.refresh)
      } catch (err) {
        report('rotate', oid, err)
      }
    }
    return next.access
  } catch {
    // Network trouble is "try again", not "sign out" — the entry stays for the next attempt.
    return null
  }
}
