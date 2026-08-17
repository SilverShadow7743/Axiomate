/**
 * The address a person actually typed, as opposed to the one this process answers on.
 *
 * Deliberately NOT marked `server-only`, unlike the rest of `lib/auth`. It reads request headers
 * and an environment variable and touches no secret, and the scenario harness has to be able to
 * import it — a redirect is only correct relative to something outside the process, so the check
 * that it is right is exactly the check that must not be hard to run.
 */

/**
 * Where the browser should be sent back to — the address a person typed, not the one this
 * process answers on.
 *
 * `new URL('/', req.url)` is the obvious way to build a same-site redirect and it is wrong
 * behind App Service. TLS terminates at the front end and the request reaches the container on
 * its internal address, so `req.url` carries that, and the browser was being told:
 *
 *     Location: https://cd04369db00c:8080/
 *
 * which resolves to nothing. Sign-in and sign-out both ended on a browser error page, for
 * everyone, and the two symptoms were reported together because they share this one line.
 *
 * The order is most-authoritative first:
 *
 *  1. `x-forwarded-host` / `x-forwarded-proto` — what the proxy in front of us says the public
 *     address is. This is the general answer and works on any reverse proxy that sets them.
 *  2. `AXIOMATE_ENTRA_REDIRECT_URI` — configured, already required for sign-in to work at all,
 *     and known to be the public origin because Entra refuses any redirect that is not
 *     registered. A deployment where this is wrong cannot sign anybody in, so it cannot be
 *     quietly wrong here either.
 *  3. `req.url` — the previous behaviour, kept for local development where there is no proxy
 *     and no Entra configuration, and where it is correct.
 *
 * Only the host and protocol are taken. Any path, query or fragment on the forwarded value is
 * discarded, because this returns an origin to build on and not a destination.
 */
export function publicOrigin(req: Request): string {
  const headerOrigin = forwardedOrigin(req)
  if (headerOrigin) return headerOrigin

  const configured = process.env.AXIOMATE_ENTRA_REDIRECT_URI?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // A malformed redirect URI is a sign-in problem and is reported as one where sign-in is
      // configured. It must not also take out sign-out, so this falls through rather than throws.
    }
  }

  return new URL(req.url).origin
}

function forwardedOrigin(req: Request): string | null {
  // Comma-separated when a request crossed more than one proxy; the first entry is the client's
  // own view, which is the one a browser has to be able to reach.
  const first = (value: string | null) => value?.split(',')[0]?.trim() || null
  const host = first(req.headers.get('x-forwarded-host'))
  if (!host) return null
  const proto = first(req.headers.get('x-forwarded-proto')) ?? 'https'
  try {
    return new URL(`${proto}://${host}`).origin
  } catch {
    return null
  }
}
