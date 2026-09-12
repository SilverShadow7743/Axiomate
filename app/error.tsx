'use client'

import { useEffect, useState } from 'react'

/**
 * The route-level error boundary (12 Sep 2026 audit, H9). Until this file existed a render
 * crash anywhere in the workspace unmounted the whole tree — and with it the autosave queue,
 * which lives in a ref — leaving a blank page and no word about whether the last edits were
 * saved. What survives a crash is `lib/pendingActions.ts`'s localStorage log of queued,
 * unconfirmed actions; this page reads that and says the one thing the person needs to know
 * before they reload: how many changes were still on their way out.
 *
 * Reads localStorage directly rather than importing the workspace's modules: this boundary
 * must render when *those* are what crashed.
 */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [pending, setPending] = useState<number | null>(null)

  useEffect(() => {
    console.error('[workspace] render error', error)
    try {
      let n = 0
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i) ?? ''
        if (!key.startsWith('axiomate.pending-actions.v1:')) continue
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown
        if (Array.isArray(parsed)) n += parsed.length
      }
      setPending(n)
    } catch {
      setPending(null)
    }
  }, [error])

  return (
    <main className="crash">
      <h1>Something in this screen stopped working.</h1>
      <p>
        The rest of Axiomate is fine, and nothing you had already saved is affected.
        {pending === null
          ? ' Whether your very latest edits reached the server could not be checked from here.'
          : pending === 0
            ? ' Every change you made had already been saved.'
            : ` ${pending} change${pending === 1 ? ' was' : 's were'} still on the way to the server; they are kept in this browser and the workspace will offer to resend them.`}
      </p>
      <p className="crash-detail">
        {error.message}
        {error.digest ? ` (ref ${error.digest})` : ''}
      </p>
      <div className="crash-actions">
        <button type="button" className="btn primary" onClick={() => reset()}>
          Try again
        </button>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    </main>
  )
}
