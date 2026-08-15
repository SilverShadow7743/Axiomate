'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { isGroupRow } from '@/lib/types'
import type { IssueDependency, ScheduleRow, ZoomLevel } from '@/lib/types'
import type { Scale } from '@/lib/timeline'
import { HEADER_H, ROW_H } from '@/lib/layout'
import { addDays, daysBetween, formatIso } from '@/lib/dates'

interface Props {
  rows: ScheduleRow[]
  scale: Scale
  zoom: ZoomLevel
  today: string
  selectedId: string | null
  onSelect: (id: string) => void
  dependencies: IssueDependency[]
  criticalIds: Set<string>
  bodyRef: RefObject<HTMLDivElement | null>
  headRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  onCommitDrag: (rowId: string, start: string, end: string) => void
  showProposed: boolean
  proposalFor: (row: ScheduleRow) => { start: string; end: string } | null
}

interface DragState {
  rowId: string
  mode: 'move' | 'resize-end'
  startX: number
  origStart: string
  origEnd: string
  deltaDays: number
}

export default function GanttChart({
  rows,
  scale,
  zoom,
  today,
  selectedId,
  onSelect,
  dependencies,
  criticalIds,
  bodyRef,
  headRef,
  onScroll,
  onCommitDrag,
  showProposed,
  proposalFor,
}: Props) {
  const canvasHeight = rows.length * ROW_H
  const [drag, setDrag] = useState<DragState | null>(null)

  /**
   * Which row's bar is the pane's single tab stop.
   *
   * Same hazard as the grid: if the selected row is filtered or collapsed away, keying this
   * off `selectedId` alone would leave the timeline with no tab stop and no keyboard route
   * to any bar.
   */
  const tabStopId = useMemo(() => {
    if (selectedId && rows.some((r) => r.id === selectedId)) return selectedId
    return rows[0]?.id ?? null
  }, [selectedId, rows])

  const rowIndex = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r, i) => m.set(r.id, i))
    return m
  }, [rows])

  /* ---- drag scheduling (spec §8) ---- */
  const beginDrag = useCallback(
    (e: React.MouseEvent, row: ScheduleRow, mode: 'move' | 'resize-end') => {
      if (isGroupRow(row.kind)) return
      const start = row.plannedStartDate
      const end = row.plannedEndDate
      if (!start || !end) return
      e.stopPropagation()
      e.preventDefault()
      setDrag({ rowId: row.id, mode, startX: e.clientX, origStart: start, origEnd: end, deltaDays: 0 })
    },
    [],
  )

  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => {
      const deltaDays = Math.round((e.clientX - drag.startX) / scale.dayPx)
      setDrag((d) => (d && d.deltaDays !== deltaDays ? { ...d, deltaDays } : d))
    }
    const up = () => {
      if (drag.deltaDays !== 0) {
        const start =
          drag.mode === 'move' ? addDays(drag.origStart, drag.deltaDays) : drag.origStart
        let end = addDays(drag.origEnd, drag.deltaDays)
        if (drag.mode === 'resize-end' && end < start) end = start
        onCommitDrag(drag.rowId, start, end)
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag, scale.dayPx, onCommitDrag])

  /**
   * Keyboard scheduling for the focused bar: Arrow moves it, Shift+Arrow changes duration.
   * Routed through the same commit path as dragging, so validation and audit still apply.
   */
  const onNudge = useCallback(
    (row: ScheduleRow, days: number, resize: boolean) => {
      const start = row.plannedStartDate
      const end = row.plannedEndDate
      if (!start || !end) return
      if (resize) {
        const nextEnd = addDays(end, days)
        onCommitDrag(row.id, start, nextEnd < start ? start : nextEnd)
      } else {
        onCommitDrag(row.id, addDays(start, days), addDays(end, days))
      }
    },
    [onCommitDrag],
  )

  /** Apply the in-flight drag offset so the bar tracks the cursor before it is committed. */
  const previewDates = useCallback(
    (row: ScheduleRow): { start: string | null; end: string | null } => {
      if (!drag || drag.rowId !== row.id) {
        return { start: row.plannedStartDate, end: row.plannedEndDate }
      }
      const start = drag.mode === 'move' ? addDays(drag.origStart, drag.deltaDays) : drag.origStart
      let end = addDays(drag.origEnd, drag.deltaDays)
      if (drag.mode === 'resize-end' && end < start) end = start
      return { start, end }
    },
    [drag],
  )

  const todayX = scale.x(today)
  const inDomain = today >= scale.domainStart && today <= scale.domainEnd

  /* ---- dependency connectors (spec §6) ---- */
  const connectors = useMemo(() => {
    const out: { d: string; critical: boolean; arrow: string; key: string }[] = []
    for (const dep of dependencies) {
      const pi = rowIndex.get(dep.predecessorId)
      const si = rowIndex.get(dep.successorId)
      if (pi == null || si == null) continue
      const p = rows[pi]
      const s = rows[si]
      if (!p.plannedEndDate || !s.plannedStartDate) continue

      const py = pi * ROW_H + ROW_H / 2
      const sy = si * ROW_H + ROW_H / 2
      const px = scale.x(addDays(p.plannedEndDate, 1))
      const sx = scale.x(s.plannedStartDate)

      // Standard MS Project elbow: out of the predecessor's finish, down, into the
      // successor's start.
      const gap = 7
      let d: string
      if (sx >= px + gap) {
        const midX = sx - gap
        d = `M ${px} ${py} H ${midX} V ${sy} H ${sx}`
      } else {
        // Successor starts before the predecessor finishes — route around.
        const back = px + gap
        const midY = (py + sy) / 2
        d = `M ${px} ${py} H ${back} V ${midY} H ${sx - gap} V ${sy} H ${sx}`
      }
      const critical = criticalIds.has(dep.predecessorId) && criticalIds.has(dep.successorId)
      const arrow = `${sx - 4},${sy - 3.5} ${sx},${sy} ${sx - 4},${sy + 3.5}`
      out.push({ d, critical, arrow, key: dep.id })
    }
    return out
  }, [dependencies, rowIndex, rows, scale, criticalIds])

  return (
    <>
      {/* ---- timeline header ---- */}
      <div className="scroll-x" ref={headRef}>
        <div className="tl-header" style={{ width: scale.totalWidth, height: HEADER_H }}>
          <div className="tl-band major">
            {scale.major.map((t) => (
              <div
                key={t.key}
                className="tl-cell"
                style={{ position: 'absolute', left: t.x, width: t.width }}
              >
                {t.label}
              </div>
            ))}
          </div>
          <div className="tl-band minor">
            {scale.minor.map((t) => (
              <div
                key={t.key}
                className={`tl-cell${t.weekend ? ' weekend' : ''}`}
                style={{ position: 'absolute', left: t.x, width: t.width }}
              >
                {t.width > 13 ? t.label : ''}
              </div>
            ))}
          </div>
          {inDomain && (
            <>
              <div className="today-line" style={{ left: todayX }} />
              <div className="today-flag" style={{ left: todayX }}>
                TODAY
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---- timeline body ---- */}
      <div className="scroll-body" ref={bodyRef} onScroll={onScroll}>
        {rows.length === 0 ? (
          <div className="empty">Nothing to plot.</div>
        ) : (
          <div
            className="tl-canvas"
            style={{ width: scale.totalWidth, height: Math.max(canvasHeight, 1) }}
          >
            {/* weekend shading */}
            {scale.weekends.map((w, i) => (
              <div key={i} className="tl-weekend" style={{ left: w.x, width: w.width }} />
            ))}

            {/* vertical grid */}
            {scale.minor.map((t) => (
              <div key={t.key} className="tl-colline" style={{ left: t.x }} />
            ))}
            {scale.major.map((t) => (
              <div key={t.key} className="tl-colline strong" style={{ left: t.x }} />
            ))}

            {/* row bands */}
            {rows.map((r, i) => (
              <div
                key={r.id}
                className={`tl-rowline kind-${r.kind}${selectedId === r.id ? ' selected' : ''}`}
                style={{ top: i * ROW_H, height: ROW_H, width: scale.totalWidth }}
                onClick={() => onSelect(r.id)}
              />
            ))}

            {/* today marker */}
            {inDomain && <div className="today-line" style={{ left: todayX }} />}

            {/* dependency connectors */}
            {connectors.length > 0 && (
              <svg className="dep-layer" width={scale.totalWidth} height={canvasHeight}>
                {connectors.map((c) => (
                  <g key={c.key}>
                    <path className={`dep-path${c.critical ? ' critical' : ''}`} d={c.d} />
                    <polygon className={`dep-arrow${c.critical ? ' critical' : ''}`} points={c.arrow} />
                  </g>
                ))}
              </svg>
            )}

            {/* bars */}
            {rows.map((r, i) => (
              <RowBars
                key={r.id}
                row={r}
                y={i * ROW_H}
                scale={scale}
                today={today}
                dates={previewDates(r)}
                onSelect={onSelect}
                onBeginDrag={beginDrag}
                dragging={drag?.rowId === r.id}
                critical={criticalIds.has(r.id)}
                proposal={showProposed ? proposalFor(r) : null}
                zoom={zoom}
                // Only one bar is a tab stop. 200+ rows × 3 elements would otherwise be
                // hundreds of stops between the grid and anything else.
                isSelected={r.id === tabStopId}
                onNudge={onNudge}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function RowBars({
  row,
  y,
  scale,
  today,
  dates,
  onSelect,
  onBeginDrag,
  dragging,
  critical,
  proposal,
  zoom,
  isSelected,
  onNudge,
}: {
  row: ScheduleRow
  y: number
  scale: Scale
  today: string
  dates: { start: string | null; end: string | null }
  onSelect: (id: string) => void
  onBeginDrag: (e: React.MouseEvent, row: ScheduleRow, mode: 'move' | 'resize-end') => void
  dragging: boolean
  critical: boolean
  proposal: { start: string; end: string } | null
  zoom: ZoomLevel
  isSelected: boolean
  onNudge: (row: ScheduleRow, days: number, resize: boolean) => void
}) {
  const isGroup = isGroupRow(row.kind)
  const clamp = (iso: string) =>
    iso < scale.domainStart ? scale.domainStart : iso > scale.domainEnd ? scale.domainEnd : iso

  /** Arrow keys reschedule the focused bar; Shift+Arrow changes its duration. */
  const onBarKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    onNudge(row, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey)
  }

  /* ---- milestone (spec §7) ---- */
  if (row.isMilestone && row.milestoneDate) {
    const x = scale.x(clamp(row.milestoneDate)) + scale.dayPx / 2
    const done = row.percentComplete >= 100
    return (
      <>
        <button
          type="button"
          className={`milestone ${done ? 'done' : 'pending'}`}
          style={{ left: x - 5.5, top: y + (ROW_H - 11) / 2 }}
          tabIndex={isSelected ? 0 : -1}
          aria-label={`Milestone ${row.name}, ${formatIso(row.milestoneDate)}, ${done ? 'reached' : 'pending'}. Arrow keys move it.`}
          title={`${row.name} — ${formatIso(row.milestoneDate)}${done ? ' (reached)' : ' (pending)'}`}
          onKeyDown={onBarKeyDown}
          onClick={() => onSelect(row.id)}
        />
        <div
          className="bar-label"
          aria-hidden="true"
          style={{ left: x + 10, top: y + (ROW_H - 13) / 2 }}
        >
          {row.name}
        </div>
      </>
    )
  }

  /* ---- summary bars for grouping rows ---- */
  if (isGroup) {
    const s = dates.start ?? row.actualStartDate
    const e = dates.end ?? row.actualEndDate ?? today
    if (!s) return null
    const left = scale.x(clamp(s))
    const width = Math.max(2, scale.spanWidth(clamp(s), clamp(e)))
    return (
      <>
        <button
          type="button"
          className="summary-bar"
          tabIndex={isSelected ? 0 : -1}
          // Summary rows roll up from their children and are not directly schedulable, so
          // this is a selection control, not a scheduling one.
          aria-label={`${row.name} summary, ${formatIso(s)} to ${formatIso(e)}, ${row.percentComplete}% complete${
            row.rollup ? `, ${row.rollup.issues} issues, ${row.rollup.open} open` : ''
          }`}
          style={{
            left,
            width,
            top: y + 9,
            background: row.kind === 'client' ? 'var(--text-muted)' : 'var(--bar-group)',
          }}
          // `e` falls back to today when nothing beneath has a rolled-up end date. Saying
          // "rolled up … → <today>" would present today as a schedule the data never had.
          title={`${row.name} — ${
            dates.end
              ? `rolled up ${formatIso(s)} → ${formatIso(e)}`
              : `elapsed from ${formatIso(s)} (earliest raised) to today — no rolled-up end date`
          } · ${row.percentComplete}% complete${
            row.rollup ? ` · ${row.rollup.issues} issues, ${row.rollup.open} open` : ''
          }`}
          onClick={() => onSelect(row.id)}
        />
        <div className="summary-cap" aria-hidden="true" style={{ left: left - 1, top: y + 15 }} />
        <div className="summary-cap" aria-hidden="true" style={{ left: left + width - 7, top: y + 15 }} />
        {scale.dayPx > 2 && (
          <div className="bar-label" style={{ left: left + width + 7, top: y + 7 }}>
            {row.percentComplete}%
            {row.rollup && row.rollup.overdue > 0 && (
              <b style={{ color: 'var(--h-overdue)', marginLeft: 6 }}>{row.rollup.overdue} overdue</b>
            )}
          </div>
        )}
      </>
    )
  }

  const hasPlan = !!dates.start && !!dates.end
  const out: React.ReactNode[] = []

  /* ---- planned bar with progress fill ----
     An issue bar is taller and saturated; a lifecycle activity is shorter and lighter, so a
     primary issue never reads the same as the work beneath it. Health then recolours the bar
     and, for the two states that need to interrupt the eye, adds a texture or a glyph. */
  if (hasPlan) {
    const left = scale.x(clamp(dates.start!))
    const width = Math.max(3, scale.spanWidth(clamp(dates.start!), clamp(dates.end!)))
    const isIssueBar = row.kind === 'issue'
    const h = isIssueBar ? 14 : 9
    const barY = isIssueBar && row.actualStartDate ? y + 3 : y + (ROW_H - h) / 2
    const color =
      row.scheduleHealth === 'Overdue'
        ? 'var(--h-overdue)'
        : row.scheduleHealth === 'At Risk'
          ? 'var(--h-atrisk)'
          : row.scheduleHealth === 'Blocked'
            ? 'var(--h-blocked)'
            : row.scheduleHealth === 'Completed'
              ? 'var(--h-complete)'
              : isIssueBar
                ? 'var(--bar-issue)'
                : 'var(--bar-activity)'

    const summary = `${row.name}: ${formatIso(dates.start)} to ${formatIso(dates.end)}, ${daysBetween(dates.start!, dates.end!)} days, ${row.percentComplete}% complete, ${row.scheduleHealth}`
    out.push(
      // A real button so the bar is reachable and operable without a mouse. The description
      // lives in aria-label rather than only in `title`, which screen readers may not read.
      <button
        key="track"
        type="button"
        className="bar-track"
        style={{
          left,
          width,
          height: h,
          top: barY,
          background: color,
          opacity: 0.28,
          outline: critical
            ? '1.5px solid var(--accent)'
            : dragging
              ? '1.5px solid var(--accent)'
              : undefined,
          cursor: 'grab',
        }}
        tabIndex={isSelected ? 0 : -1}
        aria-label={`${summary}. Arrow keys reschedule, Shift plus arrow keys change duration.`}
        title={`${row.name}\n${formatIso(dates.start)} → ${formatIso(dates.end)} · ${daysBetween(dates.start!, dates.end!)}d · ${row.percentComplete}% · ${row.scheduleHealth}`}
        onKeyDown={onBarKeyDown}
        onMouseDown={(e) => onBeginDrag(e, row, 'move')}
        onClick={() => onSelect(row.id)}
      />,
    )
    out.push(
      <div
        key="prog"
        aria-hidden="true"
        className="bar-prog"
        style={{
          left,
          width: (width * Math.min(100, row.percentComplete)) / 100,
          height: h,
          top: barY,
          background: color,
          pointerEvents: 'none',
        }}
      />,
    )
    // Blocked work gets a texture — colour alone is too easy to miss in a dense grid.
    if (row.scheduleHealth === 'Blocked') {
      out.push(
        <div
          key="hatch"
        aria-hidden="true"
          className="bar-hatch"
          style={{ left, width, height: h, top: barY }}
        />,
      )
    }
    out.push(
      // Mouse affordance only — the keyboard equivalent is Shift+Arrow on the bar itself.
      <div
        key="handle"
        className="drag-handle"
        aria-hidden="true"
        style={{ left: left + width - 3, top: barY, height: h }}
        onMouseDown={(e) => onBeginDrag(e, row, 'resize-end')}
        title="Drag to change duration"
      />,
    )
    if (scale.dayPx > 2) {
      const glyph =
        row.scheduleHealth === 'Completed'
          ? '✓'
          : row.scheduleHealth === 'Overdue'
            ? '!'
            : row.scheduleHealth === 'Blocked'
              ? '⌧'
              : ''
      out.push(
        <div
          key="lbl"
        aria-hidden="true"
          className="bar-label"
          style={{ left: left + width + 7, top: barY + (h - 13) / 2, color: glyph ? color : undefined }}
        >
          {glyph && <b style={{ marginRight: 4 }}>{glyph}</b>}
          {row.percentComplete}%
        </div>,
      )
    }
  }

  /* ---- actual elapsed bar (always real: raised → last activity / today) ---- */
  if (row.kind === 'issue' && row.actualStartDate) {
    const s = clamp(row.actualStartDate)
    const e = clamp(row.actualEndDate ?? today)
    const left = scale.x(s)
    const width = Math.max(2, scale.spanWidth(s, e))
    const thin = hasPlan
    out.push(
      // Informational, not operable: the elapsed span is recorded fact and cannot be
      // rescheduled, so it is exposed as an image with a description rather than a control.
      <div
        key="actual"
        role="img"
        aria-label={
          row.actualEndDate
            ? `Actual elapsed: raised ${formatIso(row.actualStartDate)}, last activity ${formatIso(row.actualEndDate)}, closed`
            : `Open ${daysBetween(row.actualStartDate, today)} days since ${formatIso(row.actualStartDate)}`
        }
        style={{
          position: 'absolute',
          left,
          width,
          top: thin ? y + 18 : y + (ROW_H - 13) / 2,
          height: thin ? 5 : 13,
          borderRadius: 2,
          background: row.actualEndDate ? 'var(--bar-issue-done)' : 'var(--bar-issue)',
          opacity: thin ? 0.85 : 1,
          cursor: 'pointer',
        }}
        title={
          row.actualEndDate
            ? `Actual: raised ${formatIso(row.actualStartDate)} → last activity ${formatIso(row.actualEndDate)} (issue is closed)`
            : `Open ${daysBetween(row.actualStartDate, today)} days — raised ${formatIso(row.actualStartDate)}, last activity ${formatIso(row.issue?.lastActivity ?? null)}`
        }
        onClick={() => onSelect(row.id)}
      />,
    )
    if (!hasPlan && scale.dayPx > 2) {
      out.push(
        <div
          key="unsched"
        aria-hidden="true"
          className="unscheduled-mark"
          style={{ left: left + width + 7, top: y + (ROW_H - 13) / 2 }}
        >
          no due date in log
        </div>,
      )
    }
  }

  /* ---- SLA proposal: a suggestion, drawn hollow so it reads as unconfirmed ---- */
  if (proposal && !hasPlan) {
    const left = scale.x(clamp(proposal.start))
    const width = Math.max(3, scale.spanWidth(clamp(proposal.start), clamp(proposal.end)))
    out.push(
      <div
        key="proposed"
        aria-hidden="true"
        className="bar-proposed"
        style={{ left, width, top: y + (ROW_H - 13) / 2 }}
        title={`Proposed target ${formatIso(proposal.end)} from the SLA policy — not a commitment recorded in the issue log. Accept it in the details pane to make it a planned date.`}
        onClick={() => onSelect(row.id)}
      />,
    )
  }

  return <>{out}</>
}
