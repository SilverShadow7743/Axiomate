import { NextResponse } from 'next/server'
import { completeSignIn, entraConfig } from '@/lib/auth/entra'
import { SESSION_COOKIE, SESSION_SECONDS, cookieAttributes, sign } from '@/lib/auth/cookie'

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

/** Errors land on the app with a message rather than as raw JSON nobody can read. */
function back(req: Request, message: string) {
  const url = new URL('/', req.url)
  url.searchParams.set('auth_error', message)
  return NextResponse.redirect(url)
}

export async function GET(req: Request) {
  const config = entraConfig()
  if (!config) return back(req, 'Entra is not configured on this server.')

  const url = new URL(req.url)
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (error) return back(req, error)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return back(req, 'Entra returned no authorisation code.')

  // The state cookie is what ties this response to the request this browser started.
  if (state !== cookie(req, 'axiomate_state')) {
    return back(req, 'This sign-in did not start in this browser.')
  }
  const verifier = cookie(req, 'axiomate_verifier')
  const nonce = cookie(req, 'axiomate_nonce')
  if (!verifier || !nonce) return back(req, 'The sign-in took too long. Try again.')

  try {
    const { identity } = await completeSignIn(config, code, verifier, nonce)
    const secure = url.protocol === 'https:'
    const res = NextResponse.redirect(new URL('/', req.url))
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
    return back(req, err instanceof Error ? err.message : 'Sign-in failed.')
  }
}
