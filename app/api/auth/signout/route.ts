import { NextResponse } from 'next/server'
import { SESSION_COOKIE, publicOrigin } from '@/lib/auth/cookie'
import { getSession } from '@/lib/principal'
import { dropPersonalGraphTokens } from '@/lib/db/personalGraphTokens'

/**
 * Sign out.
 *
 * Clears this application's cookie and the person's delegated Graph tokens, and nothing else.
 * It deliberately does not send the browser to Entra's own logout: signing out of Axiomate
 * should not sign somebody out of Outlook and Teams as a side effect, and a person who wants
 * that can do it from the account they signed in with.
 *
 * The token drop is the 12 Sep audit's H5: `dropPersonalGraphTokens` existed with no caller,
 * so a sign-out left the sealed refresh token in Postgres and the access token in RAM, and the
 * next session for that oid regained mailbox, calendar and chat access without asking. Now the
 * row and the cache entry go with the cookie. What sign-out still cannot do is revoke the
 * session cookie itself server-side — a copied cookie stays valid to its expiry — which is the
 * audit's remaining H5 item and needs a session record to fix.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = getSession(req)
  if (session.verified) await dropPersonalGraphTokens(session.actor.id)

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
