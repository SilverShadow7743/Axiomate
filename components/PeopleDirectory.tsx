'use client'

import { useMemo, useRef, useState } from 'react'
import { useOverlay } from './useOverlay'
import { useQuickFilterFocus } from './useQuickFilterFocus'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Every colleague, in one browsable list — the front door `ProfilePanel` never had.
 *
 * `ProfilePanel.tsx` (2026-08-24) already holds identity, career and skills, readable for any
 * `internal.view` holder — but it was reachable only from the admin-gated People config card or
 * another profile's own reports-to/direct-reports links. This adds the missing discovery layer;
 * it reads `state.model.people` exactly as the config card already does and adds no new data or
 * redaction. See `docs/plans/2026-09-08-people-directory-onboarding-design.md`.
 */
export default function PeopleDirectory({
  state,
  onOpenProfile,
  docked = false,
  onClose,
}: {
  state: WorkspaceState
  onOpenProfile: (personId: string) => void
  docked?: boolean
  onClose?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)
  const [filter, setFilter] = useState('')
  // The list's quick filter (F&O page grammar §4): focused on open, so the first keystroke
  // narrows. This panel remounts per open, so mount is the only key it needs.
  const quick = useRef<HTMLInputElement>(null)
  useQuickFilterFocus(quick)

  const model = state.model
  const people = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const all = Object.values(model.people).filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.roleIds.some((r) => model.roles[r]?.label.toLowerCase().includes(q)),
    )
    // Active first, each group alphabetical — a departed colleague is still findable, just not
    // first in a list most visits are about who's here now.
    return all.sort((a, b) => {
      const da = a.status === 'Departed' ? 1 : 0
      const db = b.status === 'Departed' ? 1 : 0
      return da !== db ? da - db : a.name.localeCompare(b.name)
    })
  }, [model.people, model.roles, filter])

  const activeCount = people.filter((p) => p.status !== 'Departed').length

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="people-dir-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="people-dir-title">People</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close people directory">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">
            {activeCount} active{people.length !== activeCount ? `, ${people.length - activeCount} departed` : ''} — open a name for the full profile.
          </div>
        </header>

        <div className="evi-list">
          <div className="cfg-inline">
            <input
              ref={quick}
              type="search"
              value={filter}
              placeholder={`Filter ${people.length} people…`}
              aria-label="Filter people"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          {people.length === 0 ? (
            <p className="evi-empty">Nobody matches that filter.</p>
          ) : (
            <table className="cfg-table est-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roles</th>
                  <th>Grade / track</th>
                  <th>Reports to</th>
                  <th>Joined</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const manager = p.managerId ? model.people[p.managerId] : null
                  return (
                    <tr key={p.id} className={p.status === 'Departed' ? 'pdir-row-departed' : undefined}>
                      <td>
                        <button className="btn-link" onClick={() => onOpenProfile(p.id)}>
                          {p.name}
                        </button>
                      </td>
                      <td>{p.roleIds.length ? p.roleIds.map((r) => model.roles[r]?.label ?? r).join(', ') : <span className="prov">no role</span>}</td>
                      <td>
                        {p.grade || p.track ? (
                          [p.grade, p.track].filter(Boolean).join(' · ')
                        ) : (
                          <span className="prov">none recorded</span>
                        )}
                      </td>
                      <td>{manager ? manager.name : <span className="prov">none recorded</span>}</td>
                      <td className="mono">{p.joinedOn ?? <span className="prov">none recorded</span>}</td>
                      <td>
                        {p.status === 'Departed' ? (
                          <span>Departed{p.departedOn ? ` ${p.departedOn}` : ''}</span>
                        ) : (
                          'Active'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  )
}
