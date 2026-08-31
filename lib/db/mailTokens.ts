import 'server-only'
import { entraConfig } from '../auth/entra'

/**
 * The RAM-only mail-token cache — see `docs/plans/2026-08-31-in-mail-design.md`.
 *
 * Access and refresh tokens live in this process's memory and NOWHERE else: never in a
 * cookie, never in Postgres, nothing at rest to leak from a backup or rotate. The stated
 * cost: an app restart empties the map and the Mail panel says "reconnect your inbox",
 * refilled by one sign-in hop. Keyed by the person's Entra oid — the claim every existing
 * session cookie already carries, so no claims-shape change and no cookie migration; two
 * devices of one person share the latest token, which is harmless for reads.
 *
 * Single-instance by assumption (the B1). Scaling out invalidates this cache and forces the
 * stored-token-table decision the design records as a send-back — not a quiet workaround.
 */

interface CachedTokens {
  access: string
  refresh: string
  expiresAt: number
}

const cache = new Map<string, CachedTokens>()

export function storeMailTokens(oid: string, tokens: CachedTokens): void {
  cache.set(oid, tokens)
}

export function dropMailTokens(oid: string): void {
  cache.delete(oid)
}

/**
 * A live access token for this person, refreshed when within five minutes of expiry, or
 * null — absent entry and failed refresh both mean "reconnect", never an error page.
 */
export async function getMailToken(oid: string): Promise<string | null> {
  const entry = cache.get(oid)
  if (!entry) return null
  if (entry.expiresAt - Date.now() > 5 * 60_000) return entry.access

  const config = entraConfig()
  if (!config) return null
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: entry.refresh,
    scope: 'openid profile email offline_access Mail.Read',
  })
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
    )
    if (!res.ok) {
      cache.delete(oid)
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
    return next.access
  } catch {
    // Network trouble is "try again", not "sign out" — the entry stays for the next attempt.
    return null
  }
}
