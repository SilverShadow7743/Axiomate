import { redirect } from 'next/navigation'
import { configured } from '@/lib/auth/entra'
import { getSessionFromCookies } from '@/lib/principal'
import AuthNotice from '@/components/AuthNotice'

/**
 * The front door.
 *
 * Until now `Sign in` went straight to `/api/auth/signin`, which bounces to Microsoft without
 * the application ever showing a page of its own. That works, and it means the first thing
 * anybody sees of Axiomate is a Microsoft prompt naming an application they have not been told
 * anything about — which is exactly the shape of a phishing page, and teaches people to click
 * through prompts they arrived at sideways.
 *
 * This page exists so the round trip starts somewhere that says who is asking, and so a failed
 * sign-in has somewhere to land that is not a workspace it cannot show.
 *
 * Server-rendered on purpose. Whether a provider is configured is a fact about the deployment,
 * not about the browser, and asking the client to discover it would mean shipping a page that
 * offers a button it may have to withdraw.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in — Axiomate TMS',
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
   * Somebody already signed in has no business here, and sending them on is better than
   * showing a sign-in button that would start a second round trip to the same place.
   *
   * Only when there is a provider: without one, `verified` is false for everybody forever, and
   * redirecting on it would be redirecting on a flag that never changes.
   */
  if (hasProvider && session.verified) redirect('/')

  return (
    <main className="signin-page">
      <div className="signin-card">
        <div className="signin-brand">
          <span className="signin-mark">axiomate.</span>
        </div>

        {/* The product name is the heading. Naming the firm here told the reader something they
            already knew, and naming the page told them what they were about to see rather than
            what they had to do next. */}
        <h1>Sign in</h1>
        <p className="signin-lede">
          Delivery management for a consulting practice — the work, the schedule, and the
          capacity behind them.
        </p>

        {authError && <AuthNotice code={authError} />}

        {hasProvider ? (
          <>
            {/* A link rather than a form: starting a sign-in is a read, it is idempotent, and
                the route sets the one-time values that tie the round trip to this browser. */}
            <a className="btn primary signin-action" href="/api/auth/signin">
              Sign in with Microsoft
            </a>
            <p className="signin-foot">
              Uses your Axiocloud work account. You will be returned here afterwards.
            </p>
          </>
        ) : (
          /**
           * No provider, and this page says so rather than offering a button that cannot work.
           *
           * A deployment without Entra configured has one operator by design and the workspace
           * is open — so the honest thing is to send them to it, and to be clear that no
           * sign-in happened rather than letting an unlabelled session look like one.
           */
          <>
            <div className="signin-none">
              <strong>No sign-in is configured on this deployment.</strong>
              <span>
                Everyone who opens it works as the same operator, and every change is recorded
                under that name. An administrator sets the four Entra values to change that.
              </span>
            </div>
            <a className="btn primary signin-action" href="/">
              Continue to the workspace
            </a>
          </>
        )}
      </div>
    </main>
  )
}
