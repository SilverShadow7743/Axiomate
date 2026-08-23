'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import type { Actor } from '@/lib/actor'
import {
  inboxFor,
  modeFor,
  undelivered,
  unreadCount,
  type Notification,
  type NotificationKind,
  type NotificationMode,
} from '@/lib/notifications'
import { can, directoryPersonFor } from '@/lib/access'
import type { WorkspaceState } from '@/lib/workspace'
import { formatIso } from '@/lib/dates'

/**
 * What the rules have told this person, and what never left the building.
 *
 * The second half is the unusual one and the reason this is not just an unread badge. Every
 * message on a channel with no transport is recorded as pending, and the count of those is
 * shown to everybody rather than hidden behind a setting — because "the firm configured email
 * escalation and nothing has ever been sent" is precisely the state that is otherwise
 * discovered by a client asking why nobody called.
 */
export default function Inbox({
  state,
  actor,
  onRead,
  onReadAll,
  onOpen,
  onSetPref,
}: {
  state: WorkspaceState
  actor: Actor
  onRead: (id: string) => void
  /** Mark every unread notification read in one batch — see dispatchMany, not a loop of dispatches. */
  onReadAll: (ids: string[]) => void
  /** The whole notification rides along so the workspace can land on the right tab for it. */
  onOpen: (issueId: string, notification: Notification) => void
  /** The viewer's own preference for one kind — the reducer refuses anybody else's. */
  onSetPref: (personId: string, kind: NotificationKind, mode: NotificationMode) => void
}) {
  const [open, setOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, open)

  const meId = directoryPersonFor(state.model, actor)?.id ?? null
  const mine = useMemo(() => inboxFor(state.notifications, actor.name, meId), [state.notifications, actor.name, meId])
  const unread = useMemo(() => unreadCount(state.notifications, actor.name, meId), [state.notifications, actor.name, meId])
  const stuck = useMemo(() => undelivered(state.notifications), [state.notifications])

  return (
    <div className="inbox-wrap">
      <button
        className={`inbox-btn${unread ? ' has-unread' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={`Notifications — ${unread} unread`}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 2a4 4 0 0 0-4 4v3l-1 2h10l-1-2V6a4 4 0 0 0-4-4Z" strokeLinejoin="round" />
          <path d="M6.5 13a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="inbox-count">{unread}</span>}
      </button>

      {open &&
        createPortal(
          <div className="menu inbox-menu" ref={ref} role="dialog" aria-label="Notifications">
            <button className="menu-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
            <div className="menu-head">
              <b>Notifications</b>
              <span className="prov">for {actor.name}</span>
              {unread > 1 && (
                <button
                  className="btn ghost"
                  onClick={() => onReadAll(mine.filter((n) => !n.readAt).map((n) => n.id))}
                  title="Mark every notification here as read"
                >
                  Mark all read
                </button>
              )}
            </div>

            {mine.length === 0 ? (
              <p className="prov inbox-empty">
                Nothing yet. Rules raise these — see Configuration → Automation for which ones
                are firing.
              </p>
            ) : (
              <ul className="inbox-list">
                {mine.slice(0, 30).map((n) => (
                  <li key={n.id} className={n.readAt ? 'read' : 'unread'}>
                    <button
                      className="inbox-item"
                      onClick={() => {
                        if (!n.readAt) onRead(n.id)
                        onOpen(n.aboutId, n)
                        setOpen(false)
                      }}
                    >
                      <span className="inbox-body">{n.body}</span>
                      <span className="prov">
                        {formatIso(n.createdAt.slice(0, 10))} · {n.aboutId}
                        {n.delivery !== 'delivered' && ` · ${n.delivery}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {mine.length > 30 && (
              <p className="prov inbox-empty">
                {mine.length - 30} older not shown — the badge counts them, so the list says so
                rather than letting the numbers disagree.
              </p>
            )}

            {stuck.length > 0 && (
              <div className="inbox-stuck">
                <b>{stuck.length} not sent.</b> {stuck[0].deliveryNote} They are recorded here,
                and nowhere else.
              </div>
            )}

            {/* The person's own say. Absent entirely for a viewer the directory cannot
                place — there is no id to store a preference under, and the block says so. */}
            <div className="inbox-prefs">
              {meId ? (
                <>
                  <button className="btn ghost" onClick={() => setPrefsOpen((v) => !v)}>
                    {prefsOpen ? 'Hide preferences' : 'Preferences…'}
                  </button>
                  {prefsOpen && (
                    <PrefRows
                      state={state}
                      actor={actor}
                      meId={meId}
                      onSetPref={onSetPref}
                    />
                  )}
                </>
              ) : (
                <p className="prov">
                  Preferences need a directory entry, and this sign-in matches none.
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Three kinds, three modes each, in words. The intake row shows only to people the intake
 * mint can address — those holding work.assign — so nobody configures a notification they
 * can never receive. The email choice says out loud when the directory holds no address:
 * the record would queue and the drain would fail honestly, but saying so before the
 * choice beats a pending row after it.
 */
function PrefRows({
  state,
  actor,
  meId,
  onSetPref,
}: {
  state: WorkspaceState
  actor: Actor
  meId: string
  onSetPref: (personId: string, kind: NotificationKind, mode: NotificationMode) => void
}) {
  const prefs = state.model.notificationPrefs
  const hasEmail = Boolean(directoryPersonFor(state.model, actor)?.email)
  const rows: { kind: NotificationKind; label: string; show: boolean }[] = [
    { kind: 'assignment', label: 'When work is assigned to me', show: true },
    {
      kind: 'intake-arrival',
      label: 'When a new request arrives',
      show: can(state.model, actor, 'work.assign').allowed,
    },
    { kind: 'automation', label: 'When a watch rule fires for me', show: true },
    { kind: 'mention', label: 'When somebody mentions me', show: true },
  ]
  const MODES: { mode: NotificationMode; label: string }[] = [
    { mode: 'in-app', label: 'tell me here' },
    { mode: 'in-app+email', label: 'also email me' },
    { mode: 'mute', label: "don't tell me" },
  ]
  return (
    <div className="inbox-pref-rows">
      {rows
        .filter((r) => r.show)
        .map((r) => {
          const current = modeFor(prefs, meId, r.kind)
          return (
            <div key={r.kind} className="inbox-pref-row">
              <span className="inbox-pref-label">{r.label}</span>
              <span>
                {MODES.map((m) => (
                  <button
                    key={m.mode}
                    className={`btn ghost${current === m.mode ? ' inbox-pref-on' : ''}`}
                    onClick={() => onSetPref(meId, r.kind, m.mode)}
                    aria-pressed={current === m.mode}
                  >
                    {m.label}
                  </button>
                ))}
              </span>
            </div>
          )
        })}
      {!hasEmail && (
        <p className="prov">
          The directory holds no email address for you, so “also email me” would queue mail
          that cannot be sent until one is recorded.
        </p>
      )}
    </div>
  )
}
