'use client'

import { useRef, useState, type ReactNode } from 'react'
import type { FilterState } from '@/lib/types'
import type { WorkspaceView } from '@/lib/viewChoice'
import { activeFilterCount } from '@/lib/filterPresentation'
import { useLabels } from './labels'
import { useQuickFilterFocus } from './useQuickFilterFocus'

/**
 * The chip that owns the filter row (docs/plans/2026-08-31-clean-shell-design.md): mounted
 * only by views the filters actually narrow (Tree, Board, Calendar — they all receive the
 * filtered rows), it collapses the EXISTING FilterBar behind a count of what is set, so the
 * resting state costs one slim row instead of a bar of eleven controls.
 *
 * The count is `activeFilterCount` (`lib/filterPresentation.ts`), the same rule FilterBar's own
 * Clear affordance uses, so the chip and Clear never disagree about what "resting" means.
 * It excludes `search` — the search box lives in the top bar, globally — and the Client facet
 * rests at `NO_CLIENT_CHOSEN`, which is the absence of a choice rather than a filter (BR7 of
 * ART-20260905-016), so it does not count either — the chip reads "Filters" at rest even
 * though the grid below it lists nothing. Starts expanded exactly when something IS set,
 * because a hidden active filter is the one thing this must never create.
 *
 * The **quick filter** (F&O page grammar, §4) sits in this always-visible row rather than in
 * the collapsible bar beneath it, because a filter that hides at rest is not a quick filter.
 * It is bound to the same `filters.search` the top bar's global search feeds — one state, two
 * inputs, so they can never disagree — which is also why it stays outside the chip's count:
 * search already has a visible input, now two. What differs is the affordance: the global box
 * opens a results list on focus (`IssueWorkspace`'s search hits); this one only narrows the
 * grid, and takes focus when the view opens so the first keystroke narrows.
 */
export default function FiltersHeader({
  filters,
  onSearch,
  view,
  focusSuppressed = false,
  shown,
  total,
  children,
}: {
  filters: FilterState
  onSearch: (search: string) => void
  /** Which list this row is above — a change is "a list opened" for the quick filter's focus. */
  view: WorkspaceView
  /** True while a record drawer is up; see `useQuickFilterFocus`. */
  focusSuppressed?: boolean
  /** Rows the current filters leave visible, against everything they could show. */
  shown: number
  total: number
  children: ReactNode
}) {
  const labels = useLabels()
  const activeCount = activeFilterCount(filters)
  const [open, setOpen] = useState(() => activeCount > 0)
  const quick = useRef<HTMLInputElement>(null)
  useQuickFilterFocus(quick, view, focusSuppressed)

  // The configured collection name, in the caption's own case when it is a plain capitalised
  // word ("Issues" → "12 issues") and verbatim otherwise ("RFCs" stays "RFCs").
  const plural = labels.RECORD_ISSUE_PLURAL
  const term = /^[A-Z][a-z]+$/.test(plural) ? plural.toLowerCase() : plural

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
        <input
          ref={quick}
          type="search"
          className="fh-quick"
          value={filters.search}
          placeholder={`Filter ${term}…`}
          aria-label={`Filter ${term}`}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears before it leaves: a narrowed list with an empty box is the one
            // state this input must not be able to produce.
            if (e.key === 'Escape' && filters.search) {
              e.preventDefault()
              onSearch('')
            }
          }}
        />
        {/* The headline number survives the collapse — how much of the workspace the view
            is currently showing must never itself be hidden behind a click. */}
        <span className="fh-note">
          {shown === total ? `${total} ${term}` : `${shown} of ${total} ${term}`}
        </span>
      </div>
      {open && children}
    </div>
  )
}
