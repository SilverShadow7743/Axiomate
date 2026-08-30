'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceState } from '@/lib/workspace'
import type { Actor } from '@/lib/actor'
import { firstRunState, firstRunVisible } from '@/lib/firstRun'

/**
 * The first-run checklist — computes itself from state and retires on evidence. See
 * `docs/plans/2026-08-31-first-run-design.md`. Thin render over `lib/firstRun.ts`; the
 * dismissal is per-browser on purpose (UI state does not belong on the model).
 */

const DISMISS_KEY = 'axiomate.firstRun.dismissed'

export default function FirstRunCard({ state, actor }: { state: WorkspaceState; actor: Actor }) {
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  const s = firstRunState(state, actor)
  if (dismissed || !firstRunVisible(s)) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* a browser that blocks storage just sees the card again — harmless */
    }
    setDismissed(true)
  }

  const step = (done: boolean, title: string, body: React.ReactNode) => (
    <li className={done ? 'done' : ''}>
      <span className="fr-mark" aria-hidden="true">{done ? '✓' : '○'}</span>
      <span>
        <b>{title}</b> — {body}
      </span>
    </li>
  )

  return (
    <section className="fr-card" aria-label="Your first week here">
      <div className="fr-head">
        <h3>Your first week here</h3>
        <button className="btn" onClick={dismiss} aria-label="Dismiss the first-week guide">
          ×
        </button>
      </div>
      <ol className="fr-steps">
        {step(
          true,
          'Find your work',
          'this list is already yours — ranked by why it wants you, then severity, then age; the reasoning is printed under it.',
        )}
        {step(
          s.recordedFirstHours,
          'Record your first hours',
          <>
            <a href="/my-week">My week</a> works on a phone too. If an entry needs a reason —
            it was late, or the work is closed — the box appears and your approver reads it.
          </>,
        )}
        {step(
          s.submittedFirstWeek,
          'Submit the week',
          'a timesheet is your own attestation — only you can submit yours, and somebody else decides it. A returned week comes back with the reason, editable again.',
        )}
        {step(
          s.recordedFirstHours && s.submittedFirstWeek,
          'Know where things live',
          'the search box reaches notes and mail, Views ▾ holds the team’s saved views, and the Tree is the whole record.',
        )}
      </ol>
    </section>
  )
}
