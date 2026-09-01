'use client'

import { useRef, useState } from 'react'
import type { WorkspaceView } from '@/lib/viewChoice'
import type { SavedView } from '@/lib/savedViews'

/**
 * The shell's one navigation surface (docs/plans/2026-08-31-clean-shell-design.md). Every
 * view is reached from here and only from here; the top bar keeps actions, this keeps
 * places. Grouped by whose question each place answers — yours, the workspace's, the
 * records' — rather than by how the code renders them.
 *
 * Deliberately dumb, the way FilterBar is: counts arrive computed, clicks hand back verbs.
 * The active item derives from `view` and never from local state, because notification
 * deep-links change the view from outside and the rail must follow.
 */

const GROUPS: readonly { title: string; items: readonly WorkspaceView[] }[] = [
  { title: 'Your work', items: ['mywork', 'mycalendar', 'inbox'] },
  { title: 'Workspace', items: ['tree', 'board', 'calendar', 'portfolio'] },
  { title: 'Records', items: ['timesheet', 'mail'] },
]

/**
 * Without `internal.view`, everything else here is either backed by data `clientView()` zeroes
 * (notifications, personal events, timesheets, mail, portfolio's own allocations) or is internal
 * machinery outright — a control that does nothing must not be shown, the same rule FilterBar's
 * own `filtersApply` already states. This is navigation relevance, not a disclosure fix: the
 * data behind a hidden item was never redacted for a client browser to begin with (`can()`
 * checks run against the real model client-side), so hiding the button narrows what a guest is
 * invited to click, not what left the server.
 */
const CLIENT_GROUPS: readonly { title: string; items: readonly WorkspaceView[] }[] = [
  { title: 'Workspace', items: ['tree', 'board', 'calendar'] },
]

const VIEW_LABEL: Record<WorkspaceView, string> = {
  mywork: 'My work',
  tree: 'Tree',
  board: 'Board',
  calendar: 'Calendar',
  portfolio: 'Portfolio',
  timesheet: 'Timesheets',
  inbox: 'Inbox',
  mycalendar: 'My calendar',
  mail: 'Mail',
}
const VIEW_TITLE: Record<WorkspaceView, string> = {
  mywork: 'Everything waiting on you, across every engagement',
  tree: 'The full structure with the timeline beside it',
  board: 'Status lanes — drag a card to move it',
  calendar: 'Due dates on a month, with the undated on a rail',
  portfolio: 'Every engagement at once — overdue, blocked, unowned, quiet',
  timesheet: 'Your week, gathered — and the approval queue, if you hold it',
  inbox: 'What needs a decision, what you’re waiting on, and what the rules have told you',
  mycalendar: 'Your own month — events, leave, allocation and your due dates, private to you',
  mail: 'Your inbox, and what arrived at the project mailbox',
}

interface Props {
  view: WorkspaceView
  setView: (v: WorkspaceView) => void
  /** Whether this viewer holds `internal.view`. Without it, the rail shows only what a client's own scoped data makes relevant. */
  mayInternal: boolean
  /** Badge counts, computed by the workspace: a queue whose size is invisible is a queue nobody opens. */
  myWorkCount: number
  /** null for a viewer without time.approve — the badge must not leak the queue's size. */
  timesheetQueue: number | null
  notificationsUnread: number
  savedViews: SavedView[]
  onApplySavedView: (v: SavedView) => void
  onDeleteSavedView: (id: string) => void
  onSaveCurrentView: (name: string) => void
  onOpenConfig: () => void
  /** How many records are archived. The entry hides itself when there are none. */
  archivedCount: number
  onOpenArchive: () => void
  /** Narrow-screen overlay state; ignored by CSS at desktop widths. */
  open: boolean
  /** Called after any pick, so the phone overlay closes behind a navigation. */
  onNavigate: () => void
}

export default function AppSidebar({
  view,
  setView,
  mayInternal,
  myWorkCount,
  timesheetQueue,
  notificationsUnread,
  savedViews,
  onApplySavedView,
  onDeleteSavedView,
  onSaveCurrentView,
  onOpenConfig,
  archivedCount,
  onOpenArchive,
  open,
  onNavigate,
}: Props) {
  const [viewName, setViewName] = useState('')
  const navRef = useRef<HTMLElement>(null)

  const badgeFor = (v: WorkspaceView): number | null =>
    v === 'mywork'
      ? myWorkCount || null
      : v === 'timesheet'
        ? timesheetQueue || null
        : v === 'inbox'
          ? notificationsUnread || null
          : null

  const pick = (v: WorkspaceView) => {
    setView(v)
    onNavigate()
  }

  const save = () => {
    if (!viewName.trim()) return
    onSaveCurrentView(viewName)
    setViewName('')
  }

  // Arrow keys walk the rail's entries; Tab still works as ever. Attached to each item (an
  // interactive element) rather than the nav container: these are ordinary buttons and
  // links, and Enter/Space keep their native meaning.
  const rove = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const nodes = Array.from(navRef.current?.querySelectorAll<HTMLElement>('.side-item') ?? [])
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    e.preventDefault()
    nodes[Math.max(0, Math.min(nodes.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  const groups = mayInternal ? GROUPS : CLIENT_GROUPS

  return (
    <nav className={`sidebar${open ? ' open' : ''}`} aria-label="Workspace navigation" ref={navRef}>
      {groups.map((g) => (
        <div className="side-group" key={g.title}>
          <div className="side-title">{g.title}</div>
          {g.items.map((v) => {
            const badge = badgeFor(v)
            return (
              <button
                key={v}
                className={`side-item${view === v ? ' active' : ''}`}
                aria-current={view === v ? 'page' : undefined}
                onClick={() => pick(v)}
                onKeyDown={rove}
                title={VIEW_TITLE[v]}
              >
                <span className="side-label">{VIEW_LABEL[v]}</span>
                {badge ? <span className="side-badge">{badge}</span> : null}
              </button>
            )
          })}
          {/* My week is a page of its own, not a workspace view — a first-class link at
              last, not the phone-only toolbar anchor it started as. */}
          {g.title === 'Your work' && (
            <a className="side-item" href="/my-week" onKeyDown={rove} title="Record and submit your week — works well on a phone">
              <span className="side-label">My week</span>
            </a>
          )}
        </div>
      ))}

      <div className="side-group">
        <div className="side-title">Saved views</div>
        {savedViews.length === 0 && (
          <p className="side-note">None yet. Set your filters, then save what you see under a name.</p>
        )}
        {savedViews.map((v) => (
          <div className="side-saved" key={v.id}>
            <button
              className="side-item"
              onClick={() => {
                onApplySavedView(v)
                onNavigate()
              }}
              onKeyDown={rove}
              title={`by ${v.createdBy}`}
            >
              <span className="side-label">{v.name}</span>
            </button>
            {/* The reducer is the gate — this is a courtesy, and a refused delete comes
                back as the teaching message. */}
            <button
              className="btn ghost side-del"
              aria-label={`Remove view ${v.name}`}
              onClick={() => onDeleteSavedView(v.id)}
            >
              ×
            </button>
          </div>
        ))}
        <div className="side-save">
          <input
            value={viewName}
            placeholder="Save current view as…"
            aria-label="Name for the saved view"
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
            }}
          />
          <button className="btn ghost" disabled={!viewName.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>

      <span className="grow" />

      <div className="side-group side-foot">
        {mayInternal && (
          <button
            className="side-item"
            onClick={() => {
              onOpenConfig()
              onNavigate()
            }}
            onKeyDown={rove}
            title="Terminology, roles, responsibilities, agents"
          >
            <span className="side-label">Configuration</span>
          </button>
        )}
        {archivedCount > 0 && (
          <button
            className="side-item"
            onClick={() => {
              onOpenArchive()
              onNavigate()
            }}
            onKeyDown={rove}
            title="Archived records, and the way to restore them"
          >
            <span className="side-label">Archive</span>
            <span className="side-badge muted">{archivedCount}</span>
          </button>
        )}
      </div>
    </nav>
  )
}
