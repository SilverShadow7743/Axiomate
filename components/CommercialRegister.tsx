'use client'

import { useMemo, useRef, useState } from 'react'
import { useOverlay } from './useOverlay'
import { useQuickFilterFocus } from './useQuickFilterFocus'
import { issuesUnder } from '@/lib/engagement'
import { sowPosition } from '@/lib/sow'
import { sowCostOf } from '@/lib/rates'
import { formatIso } from '@/lib/dates'
import type { Milestone } from '@/lib/milestone'
import type { Invoice } from '@/lib/invoice'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Every statement of work at once — a finder, not a replacement for `CommercialPanel`'s own
 * detail screen (docs/plans/2026-09-13-commercial-register-design.md). `CommercialPanel` already
 * computes exactly what this needs, scoped to one engagement; the one new step is per SOW,
 * finding every project that names it (wherever it sits) and unioning `issuesUnder` across all
 * of them — proven firm-wide by scenario `COM1`, the same discipline `RSC1` gave Resourcing.
 *
 * Gated on `rate.view` at the workspace level (the same grant `CommercialPanel`'s own cost
 * figures already require) — the whole page, not per column, so a reader who reaches it is never
 * shown SOW value or status while margin alone is withheld.
 *
 * v1 is read-only, same reasoning as Resourcing: a row names its engagement so the user can find
 * and open it the existing way; a direct deep link to that SOW's own tab is a fast-follow.
 */
type SubTab = 'all' | 'overdue' | 'unpaid' | 'atrisk'

export default function CommercialRegister({
  state,
  today,
  docked = false,
  onClose,
}: {
  state: WorkspaceState
  today: string
  docked?: boolean
  onClose?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)
  const [tab, setTab] = useState<SubTab>('all')
  const [filter, setFilter] = useState('')
  const [threshold, setThreshold] = useState(20)
  const quick = useRef<HTMLInputElement>(null)
  useQuickFilterFocus(quick)

  const rows = useMemo(() => {
    const rates = Object.values(state.rates)
    return Object.values(state.sows)
      .filter((sow) => !sow.deletedAt)
      .map((sow) => {
        const sowProjects = Object.values(state.nodes).filter(
          (n) => n.kind === 'project' && !n.deletedAt && n.sowId === sow.id,
        )
        const issueIds = [...new Set(sowProjects.flatMap((p) => issuesUnder(state, p.id).map((i) => i.id)))]
        const position = sowPosition(sow, issueIds, state.estimates, state.timeEntries, state.model.sizeBands, Object.values(state.changes))
        const cost = sowCostOf(rates, issueIds, state.timeEntries)
        const milestones = Object.values(state.milestones).filter((m) => m.sowId === sow.id && !m.deletedAt)
        const invoices = Object.values(state.invoices).filter((inv) => inv.sowId === sow.id && !inv.deletedAt)
        const openMilestones = milestones.filter((m) => m.acceptance !== 'Accepted' && m.plannedDate)
        const nextMilestone =
          openMilestones.slice().sort((a, b) => a.plannedDate!.localeCompare(b.plannedDate!))[0] ?? null
        const overdueMilestones = openMilestones.filter((m) => m.plannedDate! < today)
        const unpaidInvoices = invoices.filter((inv) => inv.status === 'Sent')
        const engagement = state.nodes[sow.engagementId]
        return { sow, position, cost, nextMilestone, overdueMilestones, unpaidInvoices, engagement }
      })
      .sort((a, b) => a.sow.reference.localeCompare(b.sow.reference))
  }, [state, today])

  const visibleAll = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.sow.reference.toLowerCase().includes(q) ||
        r.sow.title.toLowerCase().includes(q) ||
        (r.engagement?.name ?? '').toLowerCase().includes(q),
    )
  }, [rows, filter])

  const overdueRows = useMemo(
    () => visibleAll.flatMap((r) => r.overdueMilestones.map((m) => ({ r, milestone: m }))),
    [visibleAll],
  )
  const unpaidRows = useMemo(
    () => visibleAll.flatMap((r) => r.unpaidInvoices.map((inv) => ({ r, invoice: inv }))),
    [visibleAll],
  )
  const atRiskRows = useMemo(
    () => visibleAll.filter((r) => r.cost.marginPct !== null && r.cost.marginPct < threshold),
    [visibleAll, threshold],
  )

  const daysOverdue = (plannedDate: string) => Math.round((Date.parse(today) - Date.parse(plannedDate)) / 86_400_000)

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="commercial-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="commercial-title">Commercial</h2>
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close commercial register">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">Every statement of work at once — reference, value, margin and what's next.</div>
        </header>

        <div className="evi-tabs" role="tablist" aria-label="Commercial views">
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            All SOWs {visibleAll.length}
          </button>
          <button role="tab" aria-selected={tab === 'overdue'} className={tab === 'overdue' ? 'on' : ''} onClick={() => setTab('overdue')}>
            Overdue milestones {overdueRows.length}
          </button>
          <button role="tab" aria-selected={tab === 'unpaid'} className={tab === 'unpaid' ? 'on' : ''} onClick={() => setTab('unpaid')}>
            Unpaid invoices {unpaidRows.length}
          </button>
          <button role="tab" aria-selected={tab === 'atrisk'} className={tab === 'atrisk' ? 'on' : ''} onClick={() => setTab('atrisk')}>
            At-risk margin {atRiskRows.length}
          </button>
        </div>

        <div className="evi-list">
          <div className="cfg-inline">
            <input
              ref={quick}
              type="search"
              value={filter}
              placeholder="Filter by reference, title or engagement…"
              aria-label="Filter statements of work"
              onChange={(e) => setFilter(e.target.value)}
            />
            {tab === 'atrisk' && (
              <label className="fld" style={{ marginLeft: 'auto' }}>
                <span className="fld-label">Margin below</span>
                <input
                  type="number"
                  className="mono"
                  style={{ width: '5em' }}
                  value={threshold}
                  min={0}
                  max={100}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </label>
            )}
          </div>

          {tab === 'all' &&
            (visibleAll.length === 0 ? (
              <p className="evi-empty">No statements of work match.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Engagement</th>
                    <th>Value</th>
                    <th>Margin</th>
                    <th>Status</th>
                    <th>Next milestone</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAll.map((r) => (
                    <tr key={r.sow.id}>
                      <td>
                        {r.sow.reference}
                        <div className="prov">{r.sow.title}</div>
                      </td>
                      <td>{r.engagement?.name ?? <span className="prov">—</span>}</td>
                      <td className="mono">
                        {r.sow.currency} {r.sow.value.toLocaleString()}
                      </td>
                      <td className="mono">{r.cost.marginPct === null ? <span className="prov">—</span> : `${r.cost.marginPct}%`}</td>
                      <td>
                        <span className={`comm-status st-${r.sow.status.toLowerCase()}`}>{r.sow.status}</span>
                      </td>
                      <td>
                        {r.nextMilestone ? (
                          <>
                            {r.nextMilestone.name} <span className="prov mono">{formatIso(r.nextMilestone.plannedDate!)}</span>
                          </>
                        ) : (
                          <span className="prov">—</span>
                        )}
                      </td>
                      <td>{r.engagement?.owner ?? <span className="prov">Unassigned</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}

          {tab === 'overdue' &&
            (overdueRows.length === 0 ? (
              <p className="evi-empty">No milestone is overdue.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Milestone</th>
                    <th>SOW</th>
                    <th>Engagement</th>
                    <th>Planned</th>
                    <th>Days overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRows
                    .slice()
                    .sort((a, b) => a.milestone.plannedDate!.localeCompare(b.milestone.plannedDate!))
                    .map(({ r, milestone }: { r: (typeof visibleAll)[number]; milestone: Milestone }) => (
                      <tr key={milestone.id}>
                        <td>{milestone.name}</td>
                        <td>{r.sow.reference}</td>
                        <td>{r.engagement?.name ?? <span className="prov">—</span>}</td>
                        <td className="mono">{formatIso(milestone.plannedDate!)}</td>
                        <td className="mono" style={{ color: 'var(--h-overdue)' }}>
                          {daysOverdue(milestone.plannedDate!)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ))}

          {tab === 'unpaid' &&
            (unpaidRows.length === 0 ? (
              <p className="evi-empty">No invoice is sent and unpaid.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>SOW</th>
                    <th>Engagement</th>
                    <th>Status</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {unpaidRows
                    .slice()
                    .sort((a, b) => a.invoice.raisedAt.localeCompare(b.invoice.raisedAt))
                    .map(({ r, invoice }: { r: (typeof visibleAll)[number]; invoice: Invoice }) => (
                      <tr key={invoice.id}>
                        <td>{invoice.reference || invoice.id}</td>
                        <td>{r.sow.reference}</td>
                        <td>{r.engagement?.name ?? <span className="prov">—</span>}</td>
                        <td>
                          <span className={`comm-status st-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                        </td>
                        <td className="mono">{formatIso(invoice.raisedAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ))}

          {tab === 'atrisk' &&
            (atRiskRows.length === 0 ? (
              <p className="evi-empty">No SOW is below {threshold}% margin.</p>
            ) : (
              <table className="cfg-table est-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Engagement</th>
                    <th>Margin</th>
                    <th>Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskRows
                    .slice()
                    .sort((a, b) => (a.cost.marginPct ?? 0) - (b.cost.marginPct ?? 0))
                    .map((r) => (
                      <tr key={r.sow.id}>
                        <td>{r.sow.reference}</td>
                        <td>{r.engagement?.name ?? <span className="prov">—</span>}</td>
                        <td className="mono" style={{ color: 'var(--h-overdue)' }}>
                          {r.cost.marginPct}%
                        </td>
                        <td className="mono">
                          {r.sow.currency} {r.sow.value.toLocaleString()}
                        </td>
                        <td>
                          <span className={`comm-status st-${r.sow.status.toLowerCase()}`}>{r.sow.status}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ))}
        </div>
      </aside>
    </>
  )
}
