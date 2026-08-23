'use client'

import { useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import {
  REASON_LABEL,
  REASON_ORDER,
  REASON_WHY,
  describeWork,
  myWork,
  type WorkReason,
} from '@/lib/mywork'
import type { Actor } from '@/lib/actor'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * One person's work, gathered.
 *
 * A drawer rather than a tab, for the same reason the evidence panel is one: this is read
 * alongside the tree, not instead of it — somebody scans it, picks a row, and lands back in the
 * workspace on that record.
 *
 * **Ranked, and the rank is visible.** Reason, then severity, then age — see `lib/mywork.ts`,
 * which also records that this file once claimed to have no scoring function and was wrong about
 * it. The screen carries the reasoning rather than hiding it: each group states what it means and
 * each row shows the two components that placed it, so the order is arguable by whoever reads it.
 * A single blended number would not be.
 */
export default function MyWorkPanel({
  state,
  actor,
  today,
  onSelect,
  onClose,
  docked = false,
}: {
  state: WorkspaceState
  actor: Actor
  today: string
  /** Select a record in the tree. The drawer stays open — picking one thing is not finishing. */
  onSelect: (id: string) => void
  onClose?: () => void
  /**
   * Rendered as a first-class view in the main pane rather than an overlay: no scrim, no
   * focus trap, no Close — the view switcher is how you leave. Same content either way,
   * because "what needs me" must not depend on which door it was opened through.
   */
  docked?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)

  const list = useMemo(() => myWork(state, actor, today), [state, actor, today])
  const groups = REASON_ORDER.filter((r) => list.counts[r] > 0)

  const panel = (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="mywork-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="mywork-title">My work</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close my work">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">{describeWork(list)}</div>
        </header>

        {list.unrecognised && (
          <p className="cfg-readonly" role="status">
            Work is found by name, and “{list.matchedName}” is not in the directory. This is an
            empty list because the join failed, not because there is nothing to do.
          </p>
        )}

        <div className="evi-list">
          {!list.items.length && !list.unrecognised && (
            <p className="evi-empty">
              Nothing is waiting for you. That includes decisions other people are blocked on, so
              it is a real answer rather than an unconfigured one.
            </p>
          )}

          {groups.map((reason: WorkReason) => (
            <section key={reason} className="mywork-group">
              <div className="mywork-head">
                <span className={`mywork-tag r-${reason}`}>{REASON_LABEL[reason]}</span>
                <span className="mono">{list.counts[reason]}</span>
              </div>
              {/* The group's own argument, so the order can be disagreed with by a reader. */}
              <p className="evi-source-meta">{REASON_WHY[reason]}</p>

              {list.items
                .filter((i) => i.reason === reason)
                .map((item) => (
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
                ))}
            </section>
          ))}
        </div>

        <footer className="evi-foot">
          Ranked by three things in order: why it wants you, then how severe it is, then how long
          it has waited. Every row shows the last two, so the order explains itself. No blended
          number is shown or stored — a bare score is a judgement nobody can argue with, but
          pretending there is no judgement at all is how severity ended up weighted at zero.
        </footer>
      </aside>
    </>
  )

  if (docked) return <div className="view-dock">{panel}</div>
  return typeof document === 'undefined' ? panel : createPortal(panel, document.body)
}
