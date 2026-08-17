'use client'

import { useState } from 'react'

/**
 * Why a failed sign-in gets a bar of its own.
 *
 * The callback at `app/api/auth/callback/route.ts` fails closed and sends the browser back to
 * `/?auth_error=<code>`. Nothing rendered that, so the whole of a failure was: click Sign in,
 * go to Microsoft, come back to a page that looks exactly as it did — with the Sign in button
 * still there, which reads as "the click did not register" rather than "you were refused".
 *
 * A toast is the wrong channel for it. Toasts here expire after 4.5 seconds and are for the
 * consequence of something the user just did in this tab; somebody returning from a Microsoft
 * round trip has not been looking at this page and may not be looking at it yet. This stays
 * until it is dismissed.
 */

/**
 * The failures this app is willing to describe, and the only text it will ever show.
 *
 * The code arrives in a query parameter, so it is whatever the last person to edit the address
 * bar decided it should be — a link mailed to a user can carry any value at all. React escapes
 * text, so markup is not the exposure; *words* are. Echoing the parameter would let a crafted
 * link put "call 0800 000 000 to restore your access" inside the app's own error bar, wearing
 * the app's own styling. So the value is never rendered: it is only ever a key into this table,
 * and anything not in the table falls through to `GENERIC` below with the value discarded.
 *
 * Each line follows the rule the save messages already follow (`lib/autosave.ts`,
 * `describeSaveDetail`): one sentence for what happened, one for what to do about it. The
 * detail Entra itself returned is deliberately absent — it stays in the server log, because it
 * can name the tenant, the application and the account, and a URL is read by more parties than
 * the person looking at the screen.
 */
const REASONS: Record<string, string> = {
  'not-configured':
    'This server has no Microsoft Entra sign-in configured, so there was nothing to complete the sign-in against. An administrator has to set the Entra tenant, client, secret and redirect URI before anyone can sign in here.',
  'provider-refused':
    'Microsoft refused this sign-in; the reason is in the server log rather than on this page, because it can name the tenant and the account. Ask whoever administers the tenant whether your account is assigned to this application.',
  'no-code':
    'Microsoft sent this browser back without an authorisation code, so there was nothing to exchange for a session. Nothing is signed in — start again with Sign in above.',
  'wrong-browser':
    'This sign-in was started somewhere other than this browser, so it could not be matched to the request that began it. Start again with Sign in above, in this window, rather than from a link that was copied or forwarded.',
  expired:
    'The sign-in took more than ten minutes, and the one-time values that tie it to this browser have expired. Sign in again and finish the Microsoft prompt without leaving it open.',
  failed:
    'The sign-in could not be completed; the reason is in the server log rather than on this page, because it can name the tenant and the account. Sign in again — if it keeps failing, that log is where an administrator will find why.',
}

/** Used for `failed` and for any code this build does not recognise, which are the same problem
 *  from the user's side: they are not signed in, and the answer is not in the browser. */
const GENERIC = REASONS.failed

export default function AuthNotice({ code }: { code?: string }) {
  const [dismissed, setDismissed] = useState(false)
  if (!code || dismissed) return null

  return (
    <div className="authbar" aria-live="polite">
      <p>{REASONS[code] ?? GENERIC}</p>
      <span className="grow" />
      <button
        className="btn ghost"
        onClick={() => {
          setDismissed(true)
          /**
           * The parameter goes with the bar, or it comes back on the next reload and reports a
           * failure that has since been resolved. `replaceState` rather than a router
           * navigation: this is a correction to the address, not a place in the history a
           * person should be able to press Back into. Only `auth_error` is removed, so
           * anything else on the URL survives.
           */
          const url = new URL(window.location.href)
          url.searchParams.delete('auth_error')
          window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
