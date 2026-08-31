'use client'

import { useEffect, useRef, useState } from 'react'
import type { FilterState, SlaPolicy, ZoomLevel } from '@/lib/types'
import type { WorkspaceView } from '@/lib/viewChoice'
import { EMPTY_FILTERS } from '@/lib/types'
import type { ColumnDef } from '@/lib/columns'
import UserContext from './UserContext'
import type { Actor } from '@/lib/actor'
import { useLabels } from './labels'
import { liveDisciplines } from '@/lib/config'
import type { OperatingModel } from '@/lib/config'

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
  /**
   * Plain strings where the stored value *is* what the user reads, and value/label pairs where
   * it is not. Discipline is the second kind: the row stores `DISC_TECHNICAL` and the person
   * needs to see "Technical". Filtering on the label instead would look identical and break
   * the moment a firm renames one.
   */
  options: readonly (string | { value: string; label: string })[]
  value: string
  onChange: (k: keyof FilterState, v: string) => void
}) {
  /**
   * The control labels itself, rather than carrying a caption beside it.
   *
   * Eight facets each with an uppercase caption — "ACCOUNTABLE PARTY", "SCHEDULE HEALTH" —
   * cost more horizontal space in captions than in controls, and pushed the bar onto a second
   * row. The unset option carries the name instead, so the resting state still reads
   * "Client: All" and nothing is hidden.
   *
   * When a filter *is* set the control shows the value alone, which is the one thing this
   * loses: "OAPIL" no longer says which dimension it belongs to. Three things carry that —
   * the accent border the value already gets, a stable position in the row, and the tooltip
   * and accessible name below, which stay the plain dimension name whatever is selected.
   */
  return (
    <div className="field">
      <select
        id={`f-${name}`}
        aria-label={label}
        title={label}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        className={value !== 'All' ? 'on' : ''}
      >
        <option value="All">{label}: All</option>
        {options.map((o) => {
          const value = typeof o === 'string' ? o : o.value
          const text = typeof o === 'string' ? o : o.label
          return (
            <option key={value} value={value}>
              {text}
            </option>
          )
        })}
      </select>
    </div>
  )
}

interface Props {
  /** Who is operating, for the header chip. Resolved on the server; see lib/identity.ts. */
  actor: Actor
  /** For the discipline names. The facet carries ids; only the model knows what they are called. */
  model: OperatingModel
  filters: FilterState
  setFilters: (f: FilterState) => void
  facets: {
    clients: string[]
    types: string[]
    /** Discipline **ids**, not labels — see `FilterDropdown`'s options. */
    disciplines: string[]
    modules: string[]
    statuses: string[]
    severities: string[]
    owners: string[]
    accountables: string[]
    healths: string[]
  }
  zoom: ZoomLevel
  setZoom: (z: ZoomLevel) => void
  /** Read-only: which controls apply depends on the view, but switching views is the
      sidebar's job now — this bar is about what the chosen view shows. */
  view: WorkspaceView
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
  /** How many open records would get a due date. The action hides itself at zero. */
  slaCandidates: number
  onPlanSla: () => void
}

export default function FilterBar({
  actor,
  model,
  filters,
  setFilters,
  facets,
  zoom,
  setZoom,
  view,
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
  slaCandidates,
  onPlanSla,
}: Props) {
  const labels = useLabels()
  /*
   * Every configured discipline, plus an explicit "Not yet classified" — and NOT
   * `facets.disciplines`, which lists only the ids already in use.
   *
   * The other facets describe the data, so listing what exists is right for them. This one
   * describes a vocabulary somebody is working through: with 216 records unclassified, the
   * useful selections are the fourteen that nothing is filed under yet and the "None" that
   * finds all 216. A facet built from the data would offer neither.
   */
  const disciplineOptions = [
    { value: 'None', label: 'Not yet classified' },
    ...liveDisciplines(model).map((d) => ({ value: d.id, label: d.label })),
  ]
  const [colMenu, setColMenu] = useState(false)
  const menuWrap = useRef<HTMLDivElement>(null)
  const [moreMenu, setMoreMenu] = useState(false)
  const moreWrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!colMenu) return
    const away = (e: MouseEvent) => {
      if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setColMenu(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [colMenu])

  useEffect(() => {
    if (!moreMenu) return
    const away = (e: MouseEvent) => {
      if (moreWrap.current && !moreWrap.current.contains(e.target as Node)) setMoreMenu(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [moreMenu])

  const set = (k: keyof FilterState, v: string) => setFilters({ ...filters, [k]: v })
  /** Set filters that live behind the More button, so it can report them. */
  const moreActive = (['module', 'severity', 'owner', 'accountable'] as const).filter(
    (k) => filters[k] !== 'All',
  ).length

  /**
   * Whether anything deviates from the resting view.
   *
   * Each key needs its own test now: the facets rest at 'All', search rests at empty, and
   * `showCompleted` rests at false. Comparing a boolean against 'All' would have made Clear
   * look permanently armed.
   */
  const active = Object.entries(filters).some(([k, v]) =>
    k === 'search' ? v !== '' : k === 'showCompleted' ? v === true : v !== 'All',
  )

  // My work and Portfolio compute their own lists; the record filters do nothing to them,
  // and a control that does nothing must not be shown — the same rule the tree-only
  // controls follow below.
  const filtersApply = view === 'tree' || view === 'board' || view === 'calendar'

  return (
    <div className="filterbar">
      {/* Four inline, four behind the button.
          The four kept inline are the small, stable, headline dimensions. The four moved are
          the long ones (23 process areas, 37 owners) and the two least reached for. None are
          hidden: the button counts how many of them are set, so a filter can never be active
          somewhere the user cannot see. (The view switcher that used to lead this row is the
          sidebar now — navigation left the bar with the clean shell.) */}
      {filtersApply && (
      <>
      <FilterDropdown label={labels.TIER_ORGANIZATION} name="client" options={facets.clients} value={filters.client} onChange={set} />
      <FilterDropdown label="Work Type" name="type" options={facets.types} value={filters.type} onChange={set} />
      <FilterDropdown
        label="Discipline"
        name="discipline"
        /*
         * Every configured discipline, not only the ones already in use, plus an explicit
         * "Not yet classified". The other facets list what exists because they are describing
         * the data; this one is describing a vocabulary somebody is working *through*, and a
         * discipline nobody has used yet is exactly the one they need to find nothing under.
         */
        options={disciplineOptions}
        value={filters.discipline}
        onChange={set}
      />
      <FilterDropdown label={labels.FIELD_STATUS} name="status" options={facets.statuses} value={filters.status} onChange={set} />
      <FilterDropdown label={labels.FIELD_SCHEDULE_HEALTH} name="health" options={facets.healths} value={filters.health} onChange={set} />

      <div ref={moreWrap} style={{ position: 'relative' }}>
        <button
          className={`btn ghost${moreActive ? ' on' : ''}`}
          onClick={() => setMoreMenu((v) => !v)}
          aria-expanded={moreMenu}
          title="Process area, severity, owner and accountable party"
        >
          More{moreActive > 0 ? ` · ${moreActive}` : ''} ▾
        </button>
        {moreMenu && (
          <div className="menu menu-filters" style={{ top: 30, left: 0 }}>
            <div className="menu-title">More filters</div>
            <FilterDropdown label={labels.TIER_MODULE} name="module" options={facets.modules} value={filters.module} onChange={set} />
            <FilterDropdown label={labels.FIELD_SEVERITY} name="severity" options={facets.severities} value={filters.severity} onChange={set} />
            <FilterDropdown label={labels.ISSUE_OWNER} name="owner" options={facets.owners} value={filters.owner} onChange={set} />
            <FilterDropdown label={labels.ISSUE_ACCOUNTABLE} name="accountable" options={facets.accountables} value={filters.accountable} onChange={set} />
          </div>
        )}
      </div>

      <button
        className={`btn ghost${filters.showCompleted ? ' on' : ''}`}
        onClick={() => setFilters({ ...filters, showCompleted: !filters.showCompleted })}
        aria-pressed={filters.showCompleted}
        title={
          filters.showCompleted
            ? 'Hide closed and superseded records'
            : 'Closed and superseded records are hidden. Rollups and counts still include them.'
        }
      >
        {/* Names the action, not the state. The accent border and aria-pressed carry the
            state; a button captioned with its own condition leaves the reader working out
            whether it describes what is happening or what will happen. */}
        {filters.showCompleted ? 'Hide completed' : 'Show completed'}
      </button>

      {active && (
        <button className="btn ghost" onClick={() => setFilters(EMPTY_FILTERS)} title="Reset filters to the default view">
          Clear
        </button>
      )}
      </>
      )}

      <span className="sep" />

      {/* Tree-only verbs, hidden with the tree. Rendered in Board or Calendar they acted on
          an unmounted grid — Today scrolled a null ref, Expand mutated a set nothing read —
          and a visible control that silently does nothing teaches people not to trust any. */}
      {view === 'tree' && (
        <>
          <button className="btn ghost" onClick={onExpandAll}>
            Expand all
          </button>
          <button className="btn ghost" onClick={onCollapseAll}>
            Collapse all
          </button>
          <button className="btn ghost" onClick={onToday}>
            Today
          </button>
        </>
      )}

      {view === 'tree' && (
      <div className="segmented" role="group" aria-label="Timeline zoom">
        {ZOOMS.map((z) => (
          <button key={z} className={zoom === z ? 'active' : ''} onClick={() => setZoom(z)}>
            {z}
          </button>
        ))}
      </div>
      )}

      {view === 'tree' && (
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
            {/* The commit lives beside the preview it commits, and only appears when there is
                something to set — the toggle's own tooltip promises nothing is saved until
                you accept, so this is where accepting belongs. */}
            {slaCandidates > 0 && (
              <button
                className="menu-item"
                onClick={onPlanSla}
                title="Review and apply the policy to open records that have no due date"
              >
                Set due dates from this policy…
                <span className="menu-sub">
                  {slaCandidates} open record{slaCandidates === 1 ? '' : 's'} in scope have none
                </span>
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {view === 'tree' && <Legend />}

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
