import { boot } from '@/lib/db/boot'
import IssueWorkspace from '@/components/IssueWorkspace'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { seed, state, persistence, tenantId, actor, signInRequired, verified } = await boot()
  // Resolved on the server so the Today marker and health calculations agree between
  // the initial render and hydration.
  const today = new Date().toISOString().slice(0, 10)

  /**
   * Why the sign-in failure code is read here rather than in the browser.
   *
   * It only exists on the request that the auth callback redirected to, and reading it on the
   * server puts the notice in the first paint — a person coming back from Microsoft sees why
   * immediately, instead of after hydration. `useSearchParams` in the client tree would have
   * needed a Suspense boundary around the whole workspace to say the same thing later.
   *
   * A repeated `?auth_error=a&auth_error=b` arrives as an array; the first value is taken
   * rather than joined, because the value is a lookup key and not text (see `AuthNotice`).
   */
  const authError = (await searchParams).auth_error

  return (
    <IssueWorkspace
      issues={seed.issues}
      relationships={seed.relationships}
      initialState={state}
      persistence={persistence}
      tenantId={tenantId}
      actor={actor}
      signInRequired={signInRequired}
      verified={verified}
      authError={Array.isArray(authError) ? authError[0] : authError}
      meta={seed.meta}
      today={today}
    />
  )
}
