import { redirect } from 'next/navigation'
import { configured } from '@/lib/auth/entra'
import { getSessionFromCookies } from '@/lib/principal'
import AuthNotice from '@/components/AuthNotice'

/**
 * The front door, and the only page an unauthenticated visitor can reach.
 *
 * `/` redirects here when a provider is configured and nobody has signed in, so this is not a
 * courtesy screen in front of an otherwise-open application — it is the boundary. Everything
 * behind it is a client's issue log, their contracted values, their people and their hours.
 *
 * Two things it deliberately does not do.
 *
 * It does not bounce straight to Microsoft. That was the previous behaviour and it meant the
 * first thing anybody saw of this application was a Microsoft prompt naming an application
 * nobody had introduced — the shape of a phishing page, and a habit worth not teaching.
 *
 * It does not describe the workspace. No client names, no counts, no "264 issues across three
 * engagements". A sign-in page is read by everyone who finds the URL, and what it says about
 * the data behind it is said to all of them.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in — Axiomate',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const raw = params.auth_error
  const authError = Array.isArray(raw) ? raw[0] : raw

  const session = await getSessionFromCookies()
  const hasProvider = configured()

  /**
   * Somebody already signed in has no business here, and sending them on beats showing a
   * button that would start a second round trip to the same place.
   *
   * Only when there is a provider: without one `verified` is false for everybody forever, and
   * redirecting on it would redirect on a flag that never changes.
   */
  if (hasProvider && session.verified) redirect('/')

  return (
    <main className="auth">
      {/* The left half carries the product; the right half carries the one action. On a narrow
          screen the panel collapses away rather than stacking into a scroll — somebody signing
          in on a phone wants the button, not the prose. */}
      <section className="auth-panel" aria-hidden="true">
        <div className="auth-panel-inner">
          <span className="auth-mark">
            axiomate<i>.</i>
          </span>
          <p className="auth-claim">
            Delivery management for consulting practices.
          </p>
          <ul className="auth-points">
            <li>
              <strong>One record of the work</strong>
              <span>Issues, dependencies and the schedule they drive, in one tree.</span>
            </li>
            <li>
              <strong>Capacity that reflects reality</strong>
              <span>Allocations, leave and working patterns, against what was committed.</span>
            </li>
            <li>
              <strong>An answer you can trace</strong>
              <span>Every change attributed, every derived figure recomputed, never stored as fact.</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="auth-mark compact">
            axiomate<i>.</i>
          </span>

          <h1>Sign in</h1>
          <p className="auth-sub">
            {hasProvider
              ? 'Use your work account to continue.'
              : 'This deployment has no sign-in configured.'}
          </p>

          {authError && <AuthNotice code={authError} />}

          {hasProvider ? (
            <>
              {/* A link rather than a form: starting a sign-in is a read, it is idempotent, and
                  the route is what sets the one-time values tying the round trip to this
                  browser. */}
              <a className="auth-action" href="/api/auth/signin">
                <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="10" fill="#f25022" />
                  <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
                  <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
                  <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
                </svg>
                Continue with Microsoft
              </a>
              <p className="auth-fine">
                You will be returned here once Microsoft has confirmed who you are. Nothing in
                this workspace is visible until then.
              </p>
            </>
          ) : (
            <>
              <div className="auth-none">
                <strong>No identity provider is configured.</strong>
                <span>
                  Everyone who opens this deployment works as the same operator, and every
                  change is recorded under that name. An administrator sets the Entra tenant,
                  client, secret and redirect URI to change that.
                </span>
              </div>
              <a className="auth-action plain" href="/">
                Continue to the workspace
              </a>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
