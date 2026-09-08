'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceState } from '@/lib/workspace'
import type { Actor } from '@/lib/actor'
import { adminFirstRunState, adminFirstRunVisible } from '@/lib/firstRun'

/**
 * A second, narrower first-run checklist — for a config.manage holder on a genuinely fresh
 * tenant, not the daily consultant loop `FirstRunCard` teaches. See
 * `docs/plans/2026-09-08-admin-first-run-design.md`. Own dismissal key on purpose: the two
 * cards are shown to disjoint audiences for different reasons, and a shared flag would make
 * one silently answer for the other.
 */

const DISMISS_KEY = 'axiomate.adminFirstRun.dismissed'

export default function AdminFirstRunCard({ state, actor }: { state: WorkspaceState; actor: Actor }) {
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  const s = adminFirstRunState(state, actor)
  if (dismissed || !adminFirstRunVisible(s)) return null

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
    <section className="fr-card" aria-label="Set up your workspace">
      <div className="fr-head">
        <h3>Set up your workspace</h3>
        <button className="btn" onClick={dismiss} aria-label="Dismiss the setup guide">
          ×
        </button>
      </div>
      <ol className="fr-steps">
        {step(
          s.invitedSomeone,
          'Invite a second person',
          'Configuration → Roles & people adds them to the directory.',
        )}
        {step(
          s.assignedARole,
          'Give them a role',
          'the same screen — a role is what turns a directory entry into a seat that can do something.',
        )}
        {step(
          s.createdFirstProject,
          'Create the first project',
          'from an engagement in the Tree — everything else this workspace tracks hangs off a project.',
        )}
      </ol>
    </section>
  )
}
