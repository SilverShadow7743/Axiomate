'use client'

import { useState, type ReactNode } from 'react'
import type { FilterState } from '@/lib/types'

/**
 * The chip that owns the filter row (docs/plans/2026-08-31-clean-shell-design.md): mounted
 * only by views the filters actually narrow (Tree, Board, Calendar — they all receive the
 * filtered rows), it collapses the EXISTING FilterBar behind a count of what is set, so the
 * resting state costs one slim row instead of a bar of eleven controls.
 *
 * The count excludes `search` — the search box lives in the top bar, globally — and counts
 * `showCompleted` the same way FilterBar's own Clear affordance does: any deviation from
 * the resting view. Starts expanded exactly when something IS set, because a hidden active
 * filter is the one thing this must never create.
 */
export default function FiltersHeader({
  filters,
  shown,
  total,
  children,
}: {
  filters: FilterState
  /** Rows the current filters leave visible, against everything they could show. */
  shown: number
  total: number
  children: ReactNode
}) {
  const activeCount = Object.entries(filters).filter(([k, v]) =>
    k === 'search' ? false : k === 'showCompleted' ? v === true : v !== 'All',
  ).length
  const [open, setOpen] = useState(() => activeCount > 0)

  return (
    <div className="fh">
      <div className="fh-row">
        <button
          className={`btn ghost fh-chip${activeCount ? ' on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? 'Hide the filter controls' : 'Show the filter controls'}
        >
          Filters{activeCount ? ` · ${activeCount}` : ''} {open ? '▴' : '▾'}
        </button>
        {/* The headline number survives the collapse — how much of the workspace the view
            is currently showing must never itself be hidden behind a click. */}
        <span className="fh-note">
          {shown === total ? `${total} issues` : `${shown} of ${total} issues`}
        </span>
      </div>
      {open && children}
    </div>
  )
}
