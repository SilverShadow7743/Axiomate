import { redirect } from 'next/navigation'
import { boot } from '@/lib/db/boot'
import MyWeek from '@/components/MyWeek'

export const dynamic = 'force-dynamic'

/**
 * The phone-first attestation page — see `docs/plans/2026-08-31-my-week-design.md`.
 *
 * Mirrors the root page's structural guarantee: nobody signed in sees this route at all, so
 * no field of the week can reach the payload whether or not anybody thought to empty it. The
 * state below is the SAME redacted boot the workspace gets — this page narrows the screen,
 * never the rules.
 */
export default async function MyWeekPage() {
  const { state, actor, signInRequired, persistence } = await boot()
  if (signInRequired) redirect('/signin')
  const today = new Date().toISOString().slice(0, 10)

  return <MyWeek initialState={state} actor={actor} today={today} canWrite={persistence.enabled} />
}
