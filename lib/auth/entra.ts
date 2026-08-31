import 'server-only'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

/**
 * Signing in with Microsoft Entra ID.
 *
 * ---------------------------------------------------------------------------
 * Why this rather than a login form
 *
 * A username and password kept in this application would mean owning hashing, session expiry,
 * lockout, rotation and recovery — a security subsystem in its own right, built to be replaced
 * the moment the firm points at the directory it already runs. Entra is that directory. It also
 * already knows who has left, which is the fact a delivery tool most needs and is worst at
 * being told.
 *
 * ---------------------------------------------------------------------------
 * It activates only when configured
 *
 * With no tenant and client id in the environment, `configured()` is false and nothing here
 * runs: the application keeps resolving the single configured operator exactly as before. That
 * is deliberate. A deployment without credentials should keep working rather than present a
 * sign-in screen it cannot satisfy, and an integration that only half-exists is the thing this
 * codebase keeps finding and deleting.
 *
 * ---------------------------------------------------------------------------
 * What is verified, and what that is worth
 *
 * The authorization-code flow with PKCE. The code is exchanged server to server over TLS, and
 * the id token that comes back is verified against Entra's published keys — issuer, audience,
 * expiry, and the nonce this server generated. Verifying the signature when the token arrived
 * over a direct TLS channel is belt and braces; it is done anyway, because the cost is one
 * library call and the failure mode of skipping it is the one nobody notices until it matters.
 */

export interface EntraConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  redirectUri: string
}

/** Read once per call rather than at module load, so a restart is all it takes to change it. */
export function entraConfig(): EntraConfig | null {
  const tenantId = process.env.AXIOMATE_ENTRA_TENANT_ID?.trim()
  const clientId = process.env.AXIOMATE_ENTRA_CLIENT_ID?.trim()
  const clientSecret = process.env.AXIOMATE_ENTRA_CLIENT_SECRET?.trim()
  const redirectUri = process.env.AXIOMATE_ENTRA_REDIRECT_URI?.trim()
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null
  return { tenantId, clientId, clientSecret, redirectUri }
}

export function configured(): boolean {
  return entraConfig() !== null
}

const authority = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`

/**
 * The claims this application uses, and no more.
 *
 * Named explicitly rather than passing the whole token around: a payload that travels as
 * `JWTPayload` invites somebody to read a claim the firm never agreed to collect.
 */
export interface EntraIdentity {
  /** The stable object id. This is the real key — an email can change, this does not. */
  oid: string
  name: string
  email: string
}

/* ================================================================== *
 * The redirect out
 * ================================================================== */

export interface PendingAuth {
  url: string
  /** Held in a cookie until the callback, and checked there. */
  state: string
  nonce: string
  codeVerifier: string
}

export async function beginSignIn(config: EntraConfig): Promise<PendingAuth> {
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = randomToken(64)
  const challenge = await pkceChallenge(codeVerifier)

  const url = new URL(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_mode', 'query')
  // openid and profile identify the person; email gives the address the directory is joined
  // on. Mail.Read + offline_access power the in-mail panel — DELEGATED, so each token reads
  // only its own person's mailbox, and admin consent covers the tenant so no user sees an
  // extra consent screen. See docs/plans/2026-08-31-in-mail-design.md.
  url.searchParams.set('scope', 'openid profile email offline_access Mail.Read')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  return { url: url.toString(), state, nonce, codeVerifier }
}

/* ================================================================== *
 * The redirect back
 * ================================================================== */

export interface ExchangeResult {
  identity: EntraIdentity
  /** Present when the token response carried them (offline_access granted). Handed to the
   *  RAM-only mail-token cache; identity never depends on them. */
  tokens?: { access: string; refresh: string; expiresAt: number }
}

export async function completeSignIn(
  config: EntraConfig,
  code: string,
  codeVerifier: string,
  expectedNonce: string,
): Promise<ExchangeResult> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
    scope: 'openid profile email offline_access Mail.Read',
  })

  const res = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const detail = await res.text()
    // The provider's own message is passed through: "AADSTS50011: redirect URI mismatch" is
    // the answer somebody needs, and "sign-in failed" is not.
    throw new Error(`Entra refused the code exchange (${res.status}). ${firstLine(detail)}`)
  }

  const token = (await res.json()) as {
    id_token?: string
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!token.id_token) throw new Error('Entra returned no id token.')

  const jwks = keysFor(config.tenantId)
  const { payload } = await jwtVerify(token.id_token, jwks, {
    issuer: authority(config.tenantId),
    audience: config.clientId,
  })

  if (payload.nonce !== expectedNonce) {
    // A replayed token from another sign-in would otherwise be accepted here.
    throw new Error('The sign-in could not be matched to this browser. Try again.')
  }

  return {
    identity: readIdentity(payload),
    tokens:
      token.access_token && token.refresh_token
        ? {
            access: token.access_token,
            refresh: token.refresh_token,
            expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
          }
        : undefined,
  }
}

/** Cached per tenant: fetching the key set on every callback would be a request per sign-in. */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function keysFor(tenantId: string) {
  const existing = jwksCache.get(tenantId)
  if (existing) return existing
  const set = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  )
  jwksCache.set(tenantId, set)
  return set
}

function readIdentity(payload: JWTPayload): EntraIdentity {
  const oid = typeof payload.oid === 'string' ? payload.oid : (payload.sub ?? '')
  const name = typeof payload.name === 'string' ? payload.name : ''
  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : ''
  if (!oid) throw new Error('Entra returned a token with no subject.')
  return { oid, name: name || email || oid, email }
}

/* ================================================================== *
 * Small pieces
 * ================================================================== */

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function firstLine(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error_description?: string; error?: string }
    return parsed.error_description?.split('\n')[0] ?? parsed.error ?? ''
  } catch {
    return text.slice(0, 200)
  }
}
