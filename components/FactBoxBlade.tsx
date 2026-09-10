'use client'

import { useMemo } from 'react'
import { directoryIdByName, directoryPersonFor } from '@/lib/access'
import { ownerLeaveCaveat } from '@/lib/availability'
import { formatIso } from '@/lib/dates'
import { richTextToPlainText } from '@/lib/richText'
import type { ScheduleRow } from '@/lib/types'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * F&O's FactBox pane — "Related information" on the right edge of the details page, collapsed
 * to a labelled tab by default, opening to a column of FactBoxes for the selected record
 * (docs/plans/2026-09-10-fno-page-grammar-design.md §3). Two shapes, both F&O's: a card (a
 * set of related fields) and a grid (a child collection, capped at five, with a "More" that
 * points at the full list).
 *
 * The one rule this file keeps, checked at review: **every figure here is an existing record
 * or an existing pure function's output.** `ownerLeaveCaveat` is I14's; the schedule fields
 * are the row's own; related records and notes are selected, never computed. No `useMemo`
 * below produces a number `lib/` does not already produce — the same constraint the
 * dashboards design placed on widgets, for the same reason.
 *
 * Holds no edits, so closing it needs no `requestSelect` gate; it is a reading surface.
 */

const GRID_CAP = 5

export default function FactBoxBlade({
  row,
  state,
  allRows,
  today,
  open,
  onToggle,
  onOpenTab,
}: {
  row: ScheduleRow | null
  state: WorkspaceState
  allRows: ScheduleRow[]
  today: string
  open: boolean
  onToggle: () => void
  /** "More" on a grid opens the section that holds the full list. */
  onOpenTab?: (tab: 'Links' | 'Notes') => void
}) {
  const issue = row?.issue ?? null
  const issueId = issue?.id ?? null

  const nameOf = (id: string) => allRows.find((r) => r.id === id)?.name ?? id

  const owner = useMemo(() => {
    if (!issue) return null
    const person = directoryPersonFor(state.model, { id: '', name: issue.owner })
    const ownerId = directoryIdByName(state.model, issue.owner)
    const caveat =
      row?.plannedEndDate && ownerId
        ? ownerLeaveCaveat(ownerId, Object.values(state.commitments), today, row.plannedEndDate)
        : null
    return { name: issue.owner || null, title: person?.title ?? null, caveat }
  }, [issue, row?.plannedEndDate, state.model, state.commitments, today])

  const related = useMemo(() => {
    if (!issueId) return []
    const rels = state.relationships
      .filter((r) => r.sourceIssueId === issueId || r.targetIssueId === issueId)
      .map((r) => ({
        key: `rel-${r.sourceIssueId}-${r.targetIssueId}`,
        label: r.sourceIssueId === issueId ? nameOf(r.targetIssueId) : nameOf(r.sourceIssueId),
        kind: 'relationship' as const,
      }))
    const deps = state.dependencies
      .filter((d) => d.predecessorId.split('#')[0] === issueId || d.successorId.split('#')[0] === issueId)
      .map((d) => {
        const other = d.predecessorId.split('#')[0] === issueId ? d.successorId : d.predecessorId
        return { key: `dep-${d.predecessorId}-${d.successorId}`, label: nameOf(other.split('#')[0]), kind: 'dependency' as const }
      })
    return [...rels, ...deps]
    // nameOf closes over allRows; listing allRows is the honest dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId, state.relationships, state.dependencies, allRows])

  const recentNotes = useMemo(() => {
    if (!issueId) return []
    return Object.values(state.notes)
      .filter((n) => n.issueId === issueId && !n.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, GRID_CAP)
      .map((n) => ({ id: n.id, at: n.createdAt.slice(0, 10), text: richTextToPlainText(n.body).slice(0, 90) }))
  }, [issueId, state.notes])

  const totalNotes = issueId
    ? Object.values(state.notes).filter((n) => n.issueId === issueId && !n.deletedAt).length
    : 0

  if (!row) return null

  if (!open) {
    return (
      <button type="button" className="factbox-tab" onClick={onToggle} aria-expanded={false} title="Related information">
        <span>Related information</span>
      </button>
    )
  }

  return (
    <aside className="factbox-blade" aria-label="Related information">
      <div className="factbox-blade-head">
        <span>Related information</span>
        <span className="grow" />
        <button type="button" className="btn ghost" onClick={onToggle} aria-label="Collapse related information">
          ▸
        </button>
      </div>

      {issue ? (
        <>
          <section className="factbox">
            <h4 className="factbox-h">Owner</h4>
            <dl className="kv factbox-kv">
              <dt>Name</dt>
              <dd>{owner?.name ?? <span className="prov">Unassigned</span>}</dd>
              {owner?.title && (
                <>
                  <dt>Title</dt>
                  <dd>{owner.title}</dd>
                </>
              )}
              {owner?.caveat && (
                <>
                  <dt>On leave</dt>
                  <dd className="hl-atrisk">
                    {formatIso(owner.caveat.startDate)} – {formatIso(owner.caveat.endDate)}, inside the due window
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className="factbox">
            <h4 className="factbox-h">Schedule</h4>
            <dl className="kv factbox-kv">
              <dt>Planned end</dt>
              <dd className="mono">{formatIso(row.plannedEndDate)}</dd>
              <dt>Actual end</dt>
              <dd className="mono">{formatIso(row.actualEndDate)}</dd>
              <dt>Health</dt>
              <dd className={`hl-${row.scheduleHealth.toLowerCase().replace(/\s/g, '')}`}>{row.scheduleHealth}</dd>
              <dt>Complete</dt>
              <dd>{row.percentComplete}%</dd>
            </dl>
          </section>

          <section className="factbox">
            <h4 className="factbox-h">Related records</h4>
            {related.length === 0 ? (
              <p className="prov">None linked.</p>
            ) : (
              <ul className="factbox-grid">
                {related.slice(0, GRID_CAP).map((r) => (
                  <li key={r.key}>
                    <span className="prov">{r.kind === 'dependency' ? 'dep' : 'rel'}</span> {r.label}
                  </li>
                ))}
              </ul>
            )}
            {related.length > GRID_CAP && onOpenTab && (
              <button type="button" className="btn ghost" onClick={() => onOpenTab('Links')}>
                More ({related.length})
              </button>
            )}
          </section>

          <section className="factbox">
            <h4 className="factbox-h">Recent activity</h4>
            {recentNotes.length === 0 ? (
              <p className="prov">No notes yet.</p>
            ) : (
              <ul className="factbox-grid">
                {recentNotes.map((n) => (
                  <li key={n.id}>
                    <span className="mono prov">{formatIso(n.at)}</span> {n.text}
                  </li>
                ))}
              </ul>
            )}
            {totalNotes > GRID_CAP && onOpenTab && (
              <button type="button" className="btn ghost" onClick={() => onOpenTab('Notes')}>
                More ({totalNotes})
              </button>
            )}
          </section>
        </>
      ) : (
        <p className="prov factbox-empty">A {row.kind} row — select an issue for related information.</p>
      )}
    </aside>
  )
}
