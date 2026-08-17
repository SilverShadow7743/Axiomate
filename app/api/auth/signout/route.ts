import { NextResponse } from 'next/server'
import { SESSION_COOKIE, publicOrigin } from '@/lib/auth/cookie'

/**
 * Sign out.
 *
 * Clears this application's cookie and nothing else. It deliberately does not send the browser
 * to Entra's own logout: signing out of Axiomate should not sign somebody out of Outlook and
 * Teams as a side effect, and a person who wants that can do it from the account they signed in
 * with.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // `publicOrigin(req)`, not `req.url` — behind App Service the latter is the container's own
  // address and the browser was being redirected to `https://cd04369db00c:8080/`.
  const res = NextResponse.redirect(new URL('/', publicOrigin(req)), { status: 303 })
  // Cleared through the same helper that sets it, so the attributes cannot drift apart. A
  // cookie is not identified by `Secure`, so an overwrite lands either way — but "the
  // attributes in one place" stops being true the moment one caller writes its own.
  res.headers.append('set-cookie', `${SESSION_COOKIE}=; ${expiredAttributes(req)}`)
  return res
}

/** The set attributes, with the lifetime replaced by an immediate expiry. */
function expiredAttributes(req: Request): string {
  const secure = publicOrigin(req).startsWith('https:')
  return ['Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : '', 'Max-Age=0']
    .filter(Boolean)
    .join('; ')
}
