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
  todaysMeetings,
  type WorkReason,
} from '@/lib/mywork'
import type { Actor } from '@/lib/actor'
import type { ScheduleHealth } from '@/lib/types'
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
 * A single blended number would not be — which is also the condition the engagement health
 * score was admitted on (10 Sep, `lib/portfolio.ts`): its terms print beside it, always.
 */
export default function MyWorkPanel({
  state,
  actor,
  today,
  onSelect,
  onClose,
  docked = false,
  counts,
  onShowInTree,
}: {
  state: WorkspaceState
  actor: Actor
  today: string
  /** Select a record in the tree. The drawer stays open — picking one thing is not finishing. */
  onSelect: (id: string) => void
  onClose?: () => void
  /**
   * The workspace's own tally (the same object FilterBar's count strip reads), for the summary
   * tiles — F&O's workspace pattern, a tile being a count with a query behind it. Nothing is
   * counted here; a tile that disagreed with the strip would be the hidden number this panel
   * refuses. Optional so the undocked drawer, which has no tree beneath it, shows no tiles.
   */
  counts?: { shown: number; overdue: number; atRisk: number; blocked: number; unscheduled: number }
  /** The tile's query: set the schedule-health facet (or clear it) and open the Tree. */
  onShowInTree?: (health: ScheduleHealth | null) => void
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
  const meetings = useMemo(() => todaysMeetings(state, actor, today), [state, actor, today])

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

        {/* The workspace's summary row (F&O page grammar §5). Two labelled sets, because they
            count different things and one row of unlabelled numbers would invite adding them:
            the workspace tiles are the count strip's own figures and open the Tree narrowed
            to that schedule health; the "waiting on you" tiles are this list's group sizes and
            scroll to the group. */}
        {counts && onShowInTree && !list.unrecognised && (
          <div className="tiles-block">
            <div className="tiles-eyebrow">Across the workspace</div>
            <div className="tiles" aria-label="Workspace counts">
              <button type="button" className="tile" onClick={() => onShowInTree(null)} title="Open the Tree">
                <span className="tile-n">{counts.shown}</span>
                <span className="tile-l">Showing</span>
              </button>
              <button type="button" className="tile band-red" onClick={() => onShowInTree('Overdue')} title="Open the Tree narrowed to Overdue">
                <span className="tile-n">{counts.overdue}</span>
                <span className="tile-l">Overdue</span>
              </button>
              <button type="button" className="tile band-blocked" onClick={() => onShowInTree('Blocked')} title="Open the Tree narrowed to Blocked">
                <span className="tile-n">{counts.blocked}</span>
                <span className="tile-l">Blocked</span>
              </button>
              <button type="button" className="tile band-amber" onClick={() => onShowInTree('At Risk')} title="Open the Tree narrowed to At Risk">
                <span className="tile-n">{counts.atRisk}</span>
                <span className="tile-l">At risk</span>
              </button>
              <button type="button" className="tile" onClick={() => onShowInTree('Unscheduled')} title="Open the Tree narrowed to Unscheduled">
                <span className="tile-n">{counts.unscheduled}</span>
                <span className="tile-l">Unscheduled</span>
              </button>
            </div>
            {groups.length > 0 && (
              <>
                <div className="tiles-eyebrow">Waiting on you</div>
                <div className="tiles" aria-label="Your work by reason">
                  {groups.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      className={`tile tile-r-${reason}`}
                      onClick={() =>
                        document.getElementById(`mywork-${reason}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                      }
                      title={REASON_WHY[reason]}
                    >
                      <span className="tile-n">{list.counts[reason]}</span>
                      <span className="tile-l">{REASON_LABEL[reason]}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Calendar, not a ranked reason — meetings sit above the reason-grouped list rather
            than inside it. Due-today work is not duplicated here; it already has its own
            group below (`due`), so this section is meetings only. */}
        {!list.unrecognised && (
          <section className="mywork-group mywork-today">
            <div className="mywork-head">
              <span className="mywork-tag r-today">Today</span>
              <span className="mono">{meetings.length}</span>
            </div>
            {meetings.length === 0 ? (
              <p className="evi-source-meta">No meetings today.</p>
            ) : (
              meetings.map((m) => (
                <div key={m.id} className="evi-item">
                  <div className="evi-item-body">
                    {m.scopeId ? (
                      <button
                        className="btn-link mywork-title"
                        onClick={() => onSelect(m.scopeId!)}
                        title="Open this in the tree"
                      >
                        {m.title}
                      </button>
                    ) : (
                      <div className="evi-item-name">{m.title}</div>
                    )}
                    <div className="evi-item-meta">
                      {/* startAt is stored as entered, single-timezone firm (lib/meetings.ts) —
                          sliced as a string, matching todaysMeetings' own date comparison,
                          never parsed through a Date. */}
                      <span className="mono">{m.startAt.slice(11, 16)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        <div className="evi-list">
          {!list.items.length && !list.unrecognised && (
            <p className="evi-empty">
              Nothing is waiting for you. That includes decisions other people are blocked on, so
              it is a real answer rather than an unconfigured one.
            </p>
          )}

          {groups.map((reason: WorkReason) => (
            <section key={reason} id={`mywork-${reason}`} className="mywork-group">
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
