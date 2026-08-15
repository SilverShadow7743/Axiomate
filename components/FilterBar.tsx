'use client'

import { useEffect, useRef, useState } from 'react'
import type { FilterState, SlaPolicy, ZoomLevel } from '@/lib/types'
import { EMPTY_FILTERS } from '@/lib/types'
import type { ColumnDef } from '@/lib/columns'
import UserContext from './UserContext'
import type { Actor } from '@/lib/actor'
import { useLabels } from './labels'

const ZOOMS: ZoomLevel[] = ['Day', 'Week', 'Month', 'Quarter']

/**
 * Declared at module scope on purpose.
 *
 * A component defined inside a render body gets a fresh identity on every render, so React
 * unmounts and remounts it each time — which for these seven selects meant losing focus and
 * closing any open menu on every keystroke typed into the search box.
 */
function FilterDropdown({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string
  name: keyof FilterState
  options: string[]
  value: string
  onChange: (k: keyof FilterState, v: string) => void
}) {
  return (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      <select
        id={`f-${name}`}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        className={value !== 'All' ? 'on' : ''}
      >
        <option value="All">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

interface Props {
  /** Who is operating, for the header chip. Resolved on the server; see lib/identity.ts. */
  actor: Actor
  filters: FilterState
  setFilters: (f: FilterState) => void
  facets: {
    clients: string[]
    modules: string[]
    statuses: string[]
    severities: string[]
    owners: string[]
    accountables: string[]
    healths: string[]
  }
  zoom: ZoomLevel
  setZoom: (z: ZoomLevel) => void
  counts: {
    total: number
    shown: number
    overdue: number
    atRisk: number
    blocked: number
    completed: number
    unscheduled: number
  }
  onExpandAll: () => void
  onCollapseAll: () => void
  onToday: () => void
  columns: ColumnDef[]
  visibleCols: string[]
  setVisibleCols: (v: string[]) => void
  frozenCount: number
  setFrozenCount: (n: number) => void
  showProposed: boolean
  setShowProposed: (v: boolean) => void
  sla: SlaPolicy
}

export default function FilterBar({
  actor,
  filters,
  setFilters,
  facets,
  zoom,
  setZoom,
  counts,
  onExpandAll,
  onCollapseAll,
  onToday,
  columns,
  visibleCols,
  setVisibleCols,
  frozenCount,
  setFrozenCount,
  showProposed,
  setShowProposed,
  sla,
}: Props) {
  const labels = useLabels()
  const [colMenu, setColMenu] = useState(false)
  const menuWrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!colMenu) return
    const away = (e: MouseEvent) => {
      if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setColMenu(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [colMenu])

  const set = (k: keyof FilterState, v: string) => setFilters({ ...filters, [k]: v })
  const active = Object.entries(filters).some(
    ([k, v]) => (k === 'search' ? v !== '' : v !== 'All'),
  )

  return (
    <div className="filterbar">
      <FilterDropdown label={labels.TIER_ORGANIZATION} name="client" options={facets.clients} value={filters.client} onChange={set} />
      <FilterDropdown label={labels.TIER_MODULE} name="module" options={facets.modules} value={filters.module} onChange={set} />
      <FilterDropdown label={labels.FIELD_STATUS} name="status" options={facets.statuses} value={filters.status} onChange={set} />
      <FilterDropdown label={labels.FIELD_SEVERITY} name="severity" options={facets.severities} value={filters.severity} onChange={set} />
      <FilterDropdown label={labels.ISSUE_OWNER} name="owner" options={facets.owners} value={filters.owner} onChange={set} />
      <FilterDropdown label={labels.ISSUE_ACCOUNTABLE} name="accountable" options={facets.accountables} value={filters.accountable} onChange={set} />
      <FilterDropdown label={labels.FIELD_SCHEDULE_HEALTH} name="health" options={facets.healths} value={filters.health} onChange={set} />

      {active && (
        <button className="btn ghost" onClick={() => setFilters(EMPTY_FILTERS)} title="Clear all filters">
          Clear
        </button>
      )}

      <span className="sep" />

      <button className="btn ghost" onClick={onExpandAll}>
        Expand all
      </button>
      <button className="btn ghost" onClick={onCollapseAll}>
        Collapse all
      </button>
      <button className="btn ghost" onClick={onToday}>
        Today
      </button>

      <div className="segmented" role="group" aria-label="Timeline zoom">
        {ZOOMS.map((z) => (
          <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>
            {z}
          </button>
        ))}
      </div>

      <div ref={menuWrap} style={{ position: 'relative' }}>
        <button className="btn ghost" onClick={() => setColMenu((v) => !v)}>
          Columns ▾
        </button>
        {colMenu && (
          <div className="menu" style={{ top: 30, left: 0 }}>
            <div className="menu-title">Show columns</div>
            {columns.map((c) => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  checked={visibleCols.includes(c.key)}
                  disabled={c.required}
                  onChange={(e) =>
                    setVisibleCols(
                      e.target.checked
                        ? [...visibleCols, c.key]
                        : visibleCols.filter((k) => k !== c.key),
                    )
                  }
                />
                {c.label}
                {c.required && <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>fixed</span>}
              </label>
            ))}
            <div className="menu-title" style={{ marginTop: 6 }}>
              Freeze first columns
            </div>
            <label>
              <input
                type="range"
                min={0}
                max={4}
                value={frozenCount}
                onChange={(e) => setFrozenCount(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="mono" style={{ width: 14 }}>
                {frozenCount}
              </span>
            </label>
            <div className="menu-title" style={{ marginTop: 6 }}>
              Timeline
            </div>
            <label title={`Draws a dashed target window from the SLA policy: High ${sla.High}, Medium ${sla.Medium}, Low ${sla.Low} working days from the raised date. Suggestions only — nothing is saved until you accept it.`}>
              <input
                type="checkbox"
                checked={showProposed}
                onChange={(e) => setShowProposed(e.target.checked)}
              />
              Show proposed SLA targets
            </label>
          </div>
        )}
      </div>

      <Legend />

      <span className="grow" />

      <div className="counts">
        <span>
          <b>{counts.shown}</b>
          {counts.shown !== counts.total && <span style={{ color: 'var(--text-faint)' }}> / {counts.total}</span>} issues
        </span>
        {counts.overdue > 0 && (
          <span className="hl-overdue">
            <b>{counts.overdue}</b> overdue
          </span>
        )}
        {counts.atRisk > 0 && (
          <span className="hl-atrisk">
            <b>{counts.atRisk}</b> at risk
          </span>
        )}
        <span className="hl-blocked">
          <b>{counts.blocked}</b> blocked
        </span>
        <span className="hl-completed">
          <b>{counts.completed}</b> done
        </span>
        <span className="hl-unscheduled" title="No due date recorded in the source issue log">
          <b>{counts.unscheduled}</b> unscheduled
        </span>
      </div>

      <span className="sep" />
      <UserContext actor={actor} />
    </div>
  )
}

/** Explains what the timeline shapes mean, so bar semantics are learnable rather than guessed. */
function Legend() {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  const shapes: [string, string][] = [
    ['lg-summary', 'Summary roll-up (client / process area)'],
    ['lg-issue', 'Primary issue — taller, saturated'],
    ['lg-activity', 'Lifecycle activity — shorter, lighter'],
    ['lg-milestone', 'Milestone'],
    ['lg-proposed', 'Proposed SLA target — not committed'],
  ]

  const healths: [string, string][] = [
    ['ontrack', 'On Track'],
    ['atrisk', 'At Risk'],
    ['overdue', 'Overdue — marked !'],
    ['blocked', 'Blocked — hatched, marked ⌧'],
    ['completed', 'Completed — marked ✓'],
    ['unscheduled', 'Unscheduled — no due date in the log'],
  ]

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button className="btn ghost" onClick={() => setOpen((v) => !v)}>
        Legend
      </button>
      {open && (
        <div className="menu" style={{ top: 30, left: 0, minWidth: 300 }}>
          <div className="menu-title">Bar shapes</div>
          {shapes.map(([cls, label]) => (
            <div className="lg" key={cls}>
              <span className="lg-swatch">
                <i className={cls} />
              </span>
              <span>{label}</span>
            </div>
          ))}
          <div className="menu-title" style={{ marginTop: 6 }}>
            Schedule health
          </div>
          {healths.map(([slug, label]) => (
            <div className="lg" key={slug}>
              <span className="lg-swatch">
                <i className={`lg-bar bg-${slug}`} />
              </span>
              <span>{label}</span>
            </div>
          ))}
          <div className="lg-note">
            Solid bars are recorded elapsed time (raised → last activity). Dashed bars are
            suggestions, not commitments.
          </div>
        </div>
      )}
    </div>
  )
}
