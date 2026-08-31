'use client'

import { useMemo } from 'react'
import type { Actor } from '@/lib/actor'
import { directoryPersonFor } from '@/lib/access'
import { unifiedInbox } from '@/lib/inbox'
import type {
  Notification,
  NotificationKind,
  NotificationMode,
} from '@/lib/notifications'
import type { WorkItem } from '@/lib/mywork'
import type { WorkspaceState } from '@/lib/workspace'
import Inbox from './Inbox'

/**
 * One place for what needs a decision, what's waiting on somebody else, and what the rules
 * have told this person — replacing the standalone Notifications view
 * (docs/plans/2026-08-31-unified-inbox-design.md).
 *
 * Needs Action and Waiting are read straight from `unifiedInbox`, reusing the exact row idiom
 * `MyWorkPanel` already uses for its own reason-grouped list — click-to-select, `.mono`
 * dates, the same tag styling. FYI mounts the existing `Inbox` component WHOLE and
 * unmodified — not an extracted sub-component — so preferences, the undelivered banner, and
 * mark-all-read all keep working exactly as they did as the standalone Notifications view.
 *
 * Needs Action deliberately overlaps with My Work's own `decide` group — a named, accepted
 * tradeoff (see the design), not a bug to deduplicate here.
 */
export default function UnifiedInbox({
  state,
  actor,
  onSelect,
  onRead,
  onReadAll,
  onOpen,
  onSetPref,
}: {
  state: WorkspaceState
  actor: Actor
  /** Select a record in the tree, for Needs Action / Waiting rows. */
  onSelect: (id: string) => void
  onRead: (id: string) => void
  onReadAll: (ids: string[]) => void
  onOpen: (issueId: string, notification: Notification) => void
  onSetPref: (personId: string, kind: NotificationKind, mode: NotificationMode) => void
}) {
  const person = useMemo(() => directoryPersonFor(state.model, actor), [state.model, actor])
  const lists = useMemo(() => unifiedInbox(state, actor), [state, actor])

  return (
    <div className="view-dock">
      <aside className="evi unified-inbox docked">
        <header className="evi-head">
          <div className="evi-head-top">
            <h2>Inbox</h2>
          </div>
        </header>

        {!person && (
          <p className="cfg-readonly" role="status">
            Work is found by name, and “{actor.name}” is not in the directory. This is an
            empty list because the join failed, not because there is nothing to do.
          </p>
        )}

        {person && (
          <div className="evi-list">
            <InboxSection
              label="Needs action"
              why="Somebody — including you — cannot proceed until this is decided."
              items={lists.needsAction}
              onSelect={onSelect}
            />
            <InboxSection
              label="Waiting"
              why="Raised or submitted by you, and still somebody else's to decide."
              items={lists.waiting}
              onSelect={onSelect}
            />
          </div>
        )}

        <div className="unified-inbox-fyi">
          <Inbox
            state={state}
            actor={actor}
            onRead={onRead}
            onReadAll={onReadAll}
            onOpen={onOpen}
            onSetPref={onSetPref}
            docked
          />
        </div>
      </aside>
    </div>
  )
}

function InboxSection({
  label,
  why,
  items,
  onSelect,
}: {
  label: string
  why: string
  items: WorkItem[]
  onSelect: (id: string) => void
}) {
  return (
    <section className="mywork-group">
      <div className="mywork-head">
        <span className="mywork-tag r-decide">{label}</span>
        <span className="mono">{items.length}</span>
      </div>
      <p className="evi-source-meta">{why}</p>
      {items.length === 0 ? (
        <p className="evi-empty">Nothing here.</p>
      ) : (
        items.map((item) => (
          <div key={item.key} className="evi-item">
            <div className="evi-item-body">
              {item.subjectId ? (
                <button
                  className="btn-link mywork-title"
                  onClick={() => onSelect(item.subjectId!)}
                  title="Open this in the tree"
                >
                  {item.title}
                </button>
              ) : (
                <div className="evi-item-name">{item.title}</div>
              )}
              <div className="evi-item-meta">
                <span>{item.why}</span>
                {item.when && <span className="mono">{item.when}</span>}
              </div>
            </div>
          </div>
        ))
      )}
    </section>
  )
}
