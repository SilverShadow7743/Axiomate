import { boot } from '@/lib/db/boot'
import IssueWorkspace from '@/components/IssueWorkspace'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const { seed, state, persistence, tenantId, actor, signInRequired, verified } = await boot()
  // Resolved on the server so the Today marker and health calculations agree between
  // the initial render and hydration.
  const today = new Date().toISOString().slice(0, 10)

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
      meta={seed.meta}
      today={today}
    />
  )
}
