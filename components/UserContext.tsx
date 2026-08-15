'use client'

import { useEffect, useState } from 'react'
import { CURRENT_USER, formatSessionLong, formatSessionTime } from '@/lib/session'
import type { Actor } from '@/lib/actor'

/**
 * Who is operating the system, and when.
 *
 * Rendered only after mount. The server has no idea what the viewer's clock or timezone say,
 * so formatting a time during SSR would produce markup that disagrees with the client and
 * trip a hydration mismatch — and would briefly show the server's time as if it were the
 * user's.
 *
 * The minute is the smallest unit displayed, so the tick aligns to the next minute boundary
 * rather than polling every second.
 */
export default function UserContext({ actor }: { actor: Actor }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    let timer: number
    const schedule = () => {
      const d = new Date()
      const msToNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds())
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, msToNextMinute)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])

  const { timeZone, locale } = CURRENT_USER
  // The name comes from the actor, so the header and the audit trail cannot disagree about
  // who is operating — they now read the same value rather than two copies of one string.
  const displayName = actor.name

  // Before mount, reserve the space with the name alone so the header does not jump.
  if (!now) {
    return (
      <div className="userctx" aria-live="off">
        <span className="userctx-name">{displayName}</span>
      </div>
    )
  }

  const { date, time, zone } = formatSessionTime(now, timeZone, locale)

  return (
    <div className="userctx" title={`${displayName} · ${formatSessionLong(now, timeZone, locale)}`}>
      <span className="userctx-name">{displayName}</span>
      <span className="userctx-sep">·</span>
      {/* Hidden first on narrow widths, leaving name · time. */}
      <span className="userctx-date mono">{date}</span>
      <span className="userctx-sep userctx-date">·</span>
      <time className="userctx-time mono" dateTime={now.toISOString()}>
        {time}
        {zone && <span className="userctx-zone"> {zone}</span>}
      </time>
    </div>
  )
}
