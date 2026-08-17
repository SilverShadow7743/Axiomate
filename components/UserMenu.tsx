'use client'

import { useEffect, useRef, useState } from 'react'
import type { Actor } from '@/lib/actor'

/**
 * Who is signed in, and the way out.
 *
 * The header carried a Sign in button and nothing else, so a signed-in session showed no sign
 * of whose it was and offered no way to end it. On a shared machine that is the whole of the
 * problem: the next person to sit down inherits the last person's session and every change they
 * make is attributed to somebody who has gone home.
 *
 * ---------------------------------------------------------------------------
 * Three states, not two
 *
 * This codebase draws a hard line between "signed out" and "no identity provider", and the
 * distinction has to survive into the interface. A deployment with no provider has one operator
 * by design; offering it a Sign out button would invite somebody to end a session that does not
 * exist and cannot be restarted, leaving them staring at a workspace they can no longer name
 * themselves in.
 *
 *   verified            the provider vouched for this person  → name, address, Sign out
 *   signInRequired      a provider exists, nobody signed in    → Sign in
 *   neither             no provider is configured              → the operator's name, stated as
 *                                                                unverified, and no control
 *
 * ---------------------------------------------------------------------------
 * Why sign-out is a form and not a link
 *
 * `/api/auth/signout` is a POST. That is not an accident of implementation: a GET that destroys
 * a session can be triggered by any page that can persuade a browser to fetch an image, and a
 * link can be prefetched. The form keeps the method honest, and the browser handles the
 * redirect the route already returns.
 */
export default function UserMenu({
  actor,
  verified,
  signInRequired,
}: {
  actor: Actor
  verified: boolean
  signInRequired: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)

  // Closing on an outside click rather than on blur: blur fires before the menu's own buttons
  // receive their click, so Sign out would never run.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (signInRequired) {
    /**
     * To the sign-in page, not straight to `/api/auth/signin`.
     *
     * The route bounces to Microsoft immediately, so linking to it means the first thing
     * somebody sees is a Microsoft prompt naming an application nobody introduced — the shape
     * of a phishing page, and a habit worth not teaching. `/signin` says who is asking, and it
     * is also where a failed attempt can land and explain itself.
     */
    return (
      <a className="btn primary signin-btn" href="/signin">
        Sign in
      </a>
    )
  }

  /**
   * Initials from the name, and only from the name.
   *
   * Deriving them from the address instead reads better for "SekharN@…" and worse for every
   * shared mailbox, and the name is the thing already written into the audit trail.
   */
  const initials =
    actor.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'

  return (
    <div className="user-menu" ref={wrap}>
      <button
        className="user-chip"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={
          verified
            ? `Signed in as ${actor.name}${actor.email ? ` (${actor.email})` : ''}`
            : `Working as ${actor.name}. No identity provider is configured, so nobody signed in.`
        }
      >
        <span className={`user-avatar${verified ? '' : ' unverified'}`} aria-hidden="true">
          {initials}
        </span>
        <span className="user-name">{actor.name}</span>
      </button>

      {open && (
        <div className="menu user-panel" role="menu">
          <div className="user-head">
            <span className={`user-avatar lg${verified ? '' : ' unverified'}`} aria-hidden="true">
              {initials}
            </span>
            <span className="user-id">
              <strong>{actor.name}</strong>
              {/* The address is the join to the people directory, so showing it is not
                  decoration: it is how somebody checks they are the person the roles were
                  granted to. Absent on a deployment with no provider, and said so rather than
                  left as an empty line. */}
              <span className="user-mail">{actor.email ?? 'No work address on this session'}</span>
            </span>
          </div>

          <div className="user-state">
            {verified
              ? 'Verified by Microsoft Entra. Changes are recorded under this name.'
              : 'No identity provider is configured, so this session is unverified. Changes are still recorded under this name.'}
          </div>

          {verified ? (
            <form method="POST" action="/api/auth/signout">
              <button className="menu-item danger" type="submit" role="menuitem">
                Sign out
                <span className="menu-sub">Ends this session on this browser</span>
              </button>
            </form>
          ) : (
            <div className="menu-note">
              Sign-out is unavailable because there is no session to end.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
