import { NextResponse } from 'next/server'
import { completeSignIn, entraConfig } from '@/lib/auth/entra'
import { storeMailTokens } from '@/lib/db/mailTokens'
import { SESSION_COOKIE, SESSION_SECONDS, cookieAttributes, publicOrigin, sign } from '@/lib/auth/cookie'

/**
 * Where Entra sends the browser back.
 *
 * Everything here is a check, and each one fails closed with a reason the operator can act on.
 * A sign-in that goes wrong silently and lands on a working-looking page is how somebody ends
 * up believing they are authenticated when they are not.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return undefined
}

/**
 * Errors land on the app with something a person can act on, and nothing more.
 *
 * A query parameter carrying the provider's own message was the obvious thing and the wrong
 * one: App Service logs the full request line, so every failed sign-in wrote Entra's diagnostic
 * text — which can name the tenant, the application and the account — into a log with a wider
 * audience than the person who saw the page. The detail now goes to the server log, where it is
 * still available to whoever is debugging, and the redirect carries a short code.
 */
function back(req: Request, message: string, code = 'failed') {
  console.warn('[auth] sign-in failed:', message)
  // To the sign-in page, which is where somebody who failed to sign in belongs and where the
  // notice is rendered. It was '/', which now redirects them here anyway — dropping the code on
  // the way, so the failure would have gone silent again.
  // `publicOrigin`, not `req.url` — see the note on that helper. Behind App Service this was
  // sending a failed sign-in to the container's internal address, so the one page written to
  // explain the failure was the page nobody could reach.
  const url = new URL('/signin', publicOrigin(req))
  url.searchParams.set('auth_error', code)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const config = entraConfig()
  if (!config) return back(req, 'Entra is not configured on this server.', 'not-configured')

  const url = new URL(req.url)
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  // Entra's own text goes to the log, not into another URL.
  if (error) return back(req, error, 'provider-refused')

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return back(req, 'Entra returned no authorisation code.', 'no-code')

  // The state cookie is what ties this response to the request this browser started.
  if (state !== cookie(req, 'axiomate_state')) {
    return back(req, 'This sign-in did not start in this browser.', 'wrong-browser')
  }
  const verifier = cookie(req, 'axiomate_verifier')
  const nonce = cookie(req, 'axiomate_nonce')
  if (!verifier || !nonce) return back(req, 'The sign-in took too long. Try again.', 'expired')

  try {
    const { identity, tokens } = await completeSignIn(config, code, verifier, nonce)
    /*
     * The mail-token cache is a bonus on top of identity, never a dependency of it: a
     * failure to store must not fail the sign-in. RAM-only by design — see
     * docs/plans/2026-08-31-in-mail-design.md.
     */
    if (tokens) {
      try {
        storeMailTokens(identity.oid, tokens)
      } catch {
        /* the Mail panel will simply say "reconnect" */
      }
    }
    /*
     * Both of these read the PUBLIC origin rather than `req.url`, and each was wrong in its own
     * way behind App Service.
     *
     * The redirect sent the browser to `https://cd04369db00c:8080/` — the container's own
     * address — so a sign-in that had completely succeeded ended on a browser error page. That
     * is the reported fault, and sign-out shared the same line.
     *
     * `secure` decided whether the session cookie carries the `Secure` flag from the protocol of
     * that same internal URL. Getting it from the address the browser actually used is the point
     * of the flag; deriving it from an internal one is deciding it by accident.
     */
    const origin = publicOrigin(req)
    const secure = origin.startsWith('https:')
    const res = NextResponse.redirect(new URL('/', origin))
    res.headers.append(
      'set-cookie',
      `${SESSION_COOKIE}=${sign({
        oid: identity.oid,
        name: identity.name,
        email: identity.email,
        exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
      })}; ${cookieAttributes(secure)}`,
    )
    // The one-shot cookies have done their job; leaving them is a value sitting in a browser
    // for no reason.
    for (const name of ['axiomate_state', 'axiomate_nonce', 'axiomate_verifier']) {
      res.headers.append('set-cookie', `${name}=; Path=/; HttpOnly; Max-Age=0`)
    }
    return res
  } catch (err) {
    return back(req, err instanceof Error ? err.message : 'Sign-in failed.', 'failed')
  }
}
