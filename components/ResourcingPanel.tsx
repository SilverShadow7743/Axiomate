'use client'

import { useMemo, useRef, useState } from 'react'
import { useOverlay } from './useOverlay'
import { useQuickFilterFocus } from './useQuickFilterFocus'
import { addDays } from '@/lib/dates'
import { capacityFor, profilesAt, actualHoursByPerson } from '@/lib/capacity'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Who is allocated where, against actual hours logged — across every project at once.
 *
 * The single most-repeated finding across the 12 Sep business-process review: every
 * allocation action requires opening one project's Capacity tab, and nothing shows who is
 * free across the practice. `capacityFor` already computes the firm-wide figure this page
 * needs — `CapacityPanel`'s own `positions` call passes it the UNFILTERED `state.allocations`,
 * every project, not just the one whose tab is open — so this is a new caller of an existing
 * computation, not a new one (proven directly by scenario `RSC1`). `actualHoursByPerson` is
 * the one genuinely new figure: allocation-vs-actual, the number nothing computed before.
 *
 * v1 is read-only by design (docs/plans/2026-09-13-resourcing-workspace-design.md): a row
 * links to the person's Profile; allocating still happens on the project's own Capacity tab.
 * `AllocateForm` is built around a known project picking a person, and inverting that
 * cleanly is a separate design, not a one-line reuse.
 */
type StatusFilter = 'staffed' | 'under' | 'over' | 'bench' | null

export default function ResourcingPanel({
  state,
  today,
  onOpenProfile,
  docked = false,
  onClose,
}: {
  state: WorkspaceState
  today: string
  onOpenProfile: (personId: string) => void
  docked?: boolean
  onClose?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDays(today, 90))
  const quick = useRef<HTMLInputElement>(null)
  useQuickFilterFocus(quick)

  const model = state.model

  const rows = useMemo(() => {
    const profiles = profilesAt(Object.values(state.versions), model.resourceProfiles, from)
    const actual = actualHoursByPerson(state.timeEntries, from, to)
    const commitments = Object.values(state.commitments)
    const allocations = Object.values(state.allocations).filter((a) => !a.deletedAt)

    return Object.values(model.people)
      .filter((p) => p.status !== 'Departed')
      .map((p) => {
        const live = allocations.filter(
          (a) =>
            (a.personId ? a.personId === p.id : a.person.trim().toLowerCase() === p.name.trim().toLowerCase()) &&
            a.startDate <= to &&
            a.endDate >= from,
        )
        const projects = [...new Set(live.map((a) => state.nodes[a.projectId]?.name).filter((n): n is string => !!n))]
        const position = capacityFor(p.name, profiles[p.id], commitments, allocations, from, to, p.id)
        return {
          personId: p.id,
          person: p.name,
          position,
          actualHours: actual[p.id] ?? actual[p.name.trim().toLowerCase()] ?? 0,
          projects,
          bench: live.length === 0,
        }
      })
      .sort((a, b) => a.person.localeCompare(b.person))
  }, [state, model, from, to])

  const counts = useMemo(() => {
    let staffed = 0, under = 0, over = 0, bench = 0
    for (const r of rows) {
      if (r.bench) bench++
      else if (r.position.overallocated) over++
      else if (r.position.remainingHours > 0) under++
      else staffed++
    }
    return { staffed, under, over, bench }
  }, [rows])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.person.toLowerCase().includes(q) && !r.projects.some((p) => p.toLowerCase().includes(q))) return false
      if (statusFilter === 'bench' && !r.bench) return false
      if (statusFilter === 'over' && !r.position.overallocated) return false
      if (statusFilter === 'under' && (r.bench || r.position.overallocated || r.position.remainingHours <= 0)) return false
      if (statusFilter === 'staffed' && (r.bench || r.position.overallocated || r.position.remainingHours > 0)) return false
      return true
    })
  }, [rows, filter, statusFilter])

  const toggleStatus = (s: StatusFilter) => setStatusFilter((cur) => (cur === s ? null : s))

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="resourcing-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="resourcing-title">Resourcing</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close resourcing">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">Allocation and actual hours, against every project at once.</div>
        </header>

        <div className="evi-list">
          <div className="time-row">
            <label className="fld">
              <span className="fld-label">From</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="fld">
              <span className="fld-label">To</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>

          <div className="tiles-block">
            <div className="tiles" aria-label="Resourcing counts">
              <button type="button" className="tile band-green" onClick={() => toggleStatus('staffed')} title="Fully staffed, not overallocated">
                <span className="tile-n">{counts.staffed}</span>
                <span className="tile-l">Fully staffed</span>
              </button>
              <button type="button" className="tile band-amber" onClick={() => toggleStatus('under')} title="Time remaining in the window">
                <span className="tile-n">{counts.under}</span>
                <span className="tile-l">Under-allocated</span>
              </button>
              <button type="button" className="tile band-red" onClick={() => toggleStatus('over')} title="Allocated beyond available capacity">
                <span className="tile-n">{counts.over}</span>
                <span className="tile-l">Over-allocated</span>
              </button>
              <button type="button" className="tile" onClick={() => toggleStatus('bench')} title="No live allocation in this window">
                <span className="tile-n">{counts.bench}</span>
                <span className="tile-l">Bench</span>
              </button>
            </div>
          </div>

          <div className="cfg-inline">
            <input
              ref={quick}
              type="search"
              value={filter}
              placeholder="Filter by name or project…"
              aria-label="Filter resourcing"
              onChange={(e) => setFilter(e.target.value)}
            />
            {(filter || statusFilter) && (
              <span className="prov">
                {visible.length} of {rows.length}
                {statusFilter && (
                  <>
                    {' · '}
                    <button className="btn-link" onClick={() => setStatusFilter(null)}>
                      clear filter
                    </button>
                  </>
                )}
              </span>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="evi-empty">Nobody matches.</p>
          ) : (
            <table className="cfg-table est-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Allocated %</th>
                  <th>Actual hrs</th>
                  <th>Variance</th>
                  <th>Projects</th>
                  <th>Bench?</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const variance = round1(r.actualHours - r.position.allocatedHours)
                  return (
                    <tr key={r.personId}>
                      <td>
                        <button className="btn-link" onClick={() => onOpenProfile(r.personId)}>
                          {r.person}
                        </button>
                      </td>
                      <td className="mono">
                        {r.position.utilisationPct === null ? <span className="prov">—</span> : `${r.position.utilisationPct}%`}
                      </td>
                      <td className="mono">{r.actualHours}h</td>
                      <td className="mono" style={variance < 0 ? { color: 'var(--h-overdue)' } : undefined}>
                        {variance === 0 ? '—' : `${variance > 0 ? '+' : ''}${variance}h`}
                      </td>
                      <td>{r.projects.length ? r.projects.join(', ') : <span className="prov">—</span>}</td>
                      <td>{r.bench ? <span className="prov">bench</span> : <span className="prov">—</span>}</td>
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

const round1 = (n: number) => Math.round(n * 10) / 10
