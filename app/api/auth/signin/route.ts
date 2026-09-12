import { NextResponse } from 'next/server'
import { beginSignIn, configured, entraConfig } from '@/lib/auth/entra'
import { publicOrigin, signingConfigured } from '@/lib/auth/cookie'

/**
 * Start a sign-in.
 *
 * The three values that have to survive the round trip — state, nonce and the PKCE verifier —
 * go into short-lived cookies rather than a server-side store. There is no session store to put
 * them in yet, and inventing one to hold a value for ninety seconds would be the larger
 * mistake; they are HttpOnly and expire on their own.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const config = entraConfig()
  if (!config || !configured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Entra is not configured. Set AXIOMATE_ENTRA_TENANT_ID, AXIOMATE_ENTRA_CLIENT_ID, AXIOMATE_ENTRA_CLIENT_SECRET and AXIOMATE_ENTRA_REDIRECT_URI.',
      },
      { status: 503 },
    )
  }
  if (!signingConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'AXIOMATE_SESSION_SECRET is not set, or is shorter than 32 characters.' },
      { status: 503 },
    )
  }

  const pending = await beginSignIn(config)
  /*
   * `publicOrigin`, not `req.url` (12 Sep audit, M1): behind App Service the request URL is the
   * container's own address, so `Secure` on these three cookies depended on the environment
   * while the session cookie derived it from the public origin. Twenty minutes rather than ten:
   * a first sign-in with a consent screen and an MFA prompt is exactly the flow that runs long,
   * and an expired state cookie used to be reported as "did not start in this browser".
   */
  const secure = publicOrigin(req).startsWith('https:')
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : '', 'Max-Age=1200']
    .filter(Boolean)
    .join('; ')

  const res = NextResponse.redirect(pending.url)
  res.headers.append('set-cookie', `axiomate_state=${pending.state}; ${attrs}`)
  res.headers.append('set-cookie', `axiomate_nonce=${pending.nonce}; ${attrs}`)
  res.headers.append('set-cookie', `axiomate_verifier=${pending.codeVerifier}; ${attrs}`)
  return res
}
