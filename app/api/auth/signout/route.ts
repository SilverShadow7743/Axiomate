import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/cookie'

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
  const res = NextResponse.redirect(new URL('/', req.url), { status: 303 })
  res.headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  return res
}
