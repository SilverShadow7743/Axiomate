'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ScheduleRow } from '@/lib/types'
import { isGroupRow } from '@/lib/types'
import type { ColumnDef } from '@/lib/columns'
import { formatIso } from '@/lib/dates'
import { ROW_H } from '@/lib/layout'
import { editableColumns, editorFor, type EditorSpec } from '@/lib/editing'
import { severityGlyph } from '@/lib/severity'
import { exposure } from '@/lib/raid'
import type { StatusPolicy } from '@/lib/statusPolicy'
import RowMenu, { type RowActions } from './RowMenu'
import StatusCellEditor from './StatusCellEditor'
import QuickEditPopover from './QuickEditPopover'

interface Props {
  rows: ScheduleRow[]
  columns: ColumnDef[]
  colWidths: Record<string, number>
  setColWidths: (fn: (prev: Record<string, number>) => Record<string, number>) => void
  colOrder: string[]
  setColOrder: (fn: (prev: string[]) => string[]) => void
  frozenCount: number
  collapsed: Set<string>
  hasChildren: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
  sort: { key: string; dir: 'asc' | 'desc' } | null
  setSort: (s: { key: string; dir: 'asc' | 'desc' } | null) => void
  bodyRef: RefObject<HTMLDivElement | null>
  headRef: RefObject<HTMLDivElement | null>
  onScroll: () => void
  criticalIds: Set<string>
  /**
   * Commit an in-place cell edit. Returns false if the change was rejected.
   *
   * `reason` is carried for the one field that demands one — status — and is left undefined
   * everywhere else rather than defaulted to an empty string, because the reducer writes it
   * onto the audit entry and a blank reason there reads as a question that was answered.
   */
  onCellCommit: (rowId: string, colKey: string, value: string, reason?: string) => boolean
  /** Known owner names, offered as suggestions when editing an owner cell. */
  ownerOptions: string[]
  statusPolicy: StatusPolicy
  /**
   * The row verbs, shared with `SelectionToolbar`.
   *
   * The same object reaches both surfaces, so the `⋮` menu and the toolbar cannot end up
   * doing different things under the same word — see `RowActions`.
   */
  actions: RowActions
}

export default function TreeGrid({
  rows,
  columns,
  colWidths,
  setColWidths,
  colOrder,
  setColOrder,
  frozenCount,
  collapsed,
  hasChildren,
  onToggle,
  selectedId,
  onSelect,
  sort,
  setSort,
  bodyRef,
  headRef,
  onScroll,
  criticalIds,
  onCellCommit,
  ownerOptions,
  statusPolicy,
  actions,
}: Props) {
  const widthOf = useCallback((c: ColumnDef) => colWidths[c.key] ?? c.width, [colWidths])

  /**
   * The single row that carries `tabIndex={0}`.
   *
   * Falls back to the first visible row whenever the selection is not on screen — a filter
   * or a collapsed ancestor can hide the selected row while `selectedId` stays set, and
   * keying the tab stop directly off `selectedId` would then leave the grid with NO tab stop
   * at all, making it unreachable by keyboard.
   */
  const tabStopId = useMemo(() => {
    if (selectedId && rows.some((r) => r.id === selectedId)) return selectedId
    return rows[0]?.id ?? null
  }, [selectedId, rows])

  /**
   * Which column carries the `⋮`.
   *
   * The name column, because it is `required` and therefore always on screen, and because a
   * trigger that moves about as columns are shown and hidden is one people stop looking for.
   * `columns[0]` is the fallback for the same reason the tab stop has one: the column set is
   * user-configurable and this must not depend on a particular key existing.
   */
  const anchorKey = useMemo(
    () => (columns.some((c) => c.key === 'name') ? 'name' : (columns[0]?.key ?? null)),
    [columns],
  )

  /* ---- inline cell editing ---- */
  const [editing, setEditing] = useState<{ rowId: string; colKey: string } | null>(null)
  /** The row whose Subject cell was double-clicked into Quick Edit — see QuickEditPopover. */
  const [quickEditId, setQuickEditId] = useState<string | null>(null)

  /**
   * Scroll a column clear of the frozen region and the right edge.
   *
   * Needed both when an edit starts and when Tab advances — a frozen column always paints
   * over the editor, so landing on a cell hidden beneath one would leave the user typing
   * into something they cannot see.
   */
  const ensureColumnVisible = useCallback(
    (colKey: string) => {
      const body = bodyRef.current
      if (!body) return
      let left = 0
      let width = 0
      let frozenWidth = 0
      columns.forEach((c, i) => {
        const w = colWidths[c.key] ?? c.width
        if (i < frozenCount) frozenWidth += w
        if (c.key === colKey) width = w
        else if (!width) left += w
      })
      const min = left - frozenWidth
      const max = left + width - body.clientWidth
      if (body.scrollLeft > min) body.scrollLeft = Math.max(0, min)
      else if (body.scrollLeft < max) body.scrollLeft = max
    },
    [columns, colWidths, frozenCount, bodyRef],
  )

  const beginEdit = useCallback(
    (row: ScheduleRow, colKey: string) => {
      if (!editorFor(row, colKey, ownerOptions, statusPolicy)) return
      setEditing({ rowId: row.id, colKey })
      ensureColumnVisible(colKey)
    },
    [ownerOptions, statusPolicy, ensureColumnVisible],
  )

  /* ---- the ⋮ row menu ---- */

  /**
   * Which row's menu is open, and where the menu goes.
   *
   * Viewport coordinates, taken from the trigger when it is pressed. They are held in state
   * rather than recomputed on render because the background goes `inert` while the menu is up,
   * so nothing can scroll underneath it and there is nothing to re-measure against.
   */
  const [menu, setMenu] = useState<{ rowId: string; top: number; left: number } | null>(null)
  const menuRow = useMemo(
    () => (menu ? (rows.find((r) => r.id === menu.rowId) ?? null) : null),
    [menu, rows],
  )

  const openMenu = useCallback((rowId: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect()
    // Clamped here rather than in the menu, because this is the side that knows the trigger.
    setMenu({
      rowId,
      top: Math.max(8, Math.min(r.bottom + 2, window.innerHeight - 320)),
      left: Math.max(8, Math.min(r.left, window.innerWidth - 248)),
    })
  }, [])

  /**
   * "Close…" is a status change, so it goes through the editor that asks for a reason rather
   * than writing a terminal status straight to the record. One route to a closure, and it is
   * the one that collects the sentence somebody will be asked for months later.
   */
  const closeRow = useCallback(
    (row: ScheduleRow) => {
      const hasStatusColumn = columns.some((c) => c.key === 'status')
      if (hasStatusColumn && editorFor(row, 'status', ownerOptions, statusPolicy)) {
        beginEdit(row, 'status')
        return
      }
      // The status column is hidden, so there is no cell to open. The full editor is the other
      // route to the same field, and its own rules decide what it asks for.
      actions.edit(row)
    },
    [columns, ownerOptions, statusPolicy, beginEdit, actions],
  )

  /**
   * Keyboard navigation, bound to the grid rather than to `window`.
   *
   * On `window` it fired regardless of where focus actually was, and — more importantly —
   * nothing could put focus on the grid in the first place, so a keyboard user could never
   * select a row. Selection gates every toolbar action, so this was the gate in front of the
   * whole app.
   */
  const focusRow = useCallback(
    (id: string) => {
      bodyRef.current
        ?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)
        ?.focus()
    },
    [bodyRef],
  )

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cell editors own the keyboard while one is open.
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return
      if (!rows.length) return

      const idx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1
      const go = (nextIdx: number) => {
        const next = rows[Math.max(0, Math.min(rows.length - 1, nextIdx))]
        if (!next) return
        e.preventDefault()
        onSelect(next.id)
        focusRow(next.id)
      }

      switch (e.key) {
        case 'ArrowDown':
          return go(idx < 0 ? 0 : idx + 1)
        case 'ArrowUp':
          return go(idx < 0 ? 0 : idx - 1)
        case 'Home':
          return go(0)
        case 'End':
          return go(rows.length - 1)
        case 'ArrowRight': {
          if (idx < 0) return
          const row = rows[idx]
          if (hasChildren.has(row.id) && collapsed.has(row.id)) {
            e.preventDefault()
            onToggle(row.id)
          } else if (hasChildren.has(row.id)) {
            // Already open: step into the first child, as a tree is expected to.
            return go(idx + 1)
          }
          return
        }
        case 'ArrowLeft': {
          if (idx < 0) return
          const row = rows[idx]
          if (hasChildren.has(row.id) && !collapsed.has(row.id)) {
            e.preventDefault()
            onToggle(row.id)
          } else if (row.parentId) {
            const parentIdx = rows.findIndex((r) => r.id === row.parentId)
            if (parentIdx >= 0) return go(parentIdx)
          }
          return
        }
        case 'Enter':
        case 'F2': {
          if (idx < 0) return
          const row = rows[idx]
          const keys = editableColumns(row, columns.map((c) => c.key), ownerOptions)
          if (keys.length) {
            e.preventDefault()
            beginEdit(row, keys[0])
          }
          return
        }
        case ' ': {
          if (idx < 0) return
          e.preventDefault()
          onSelect(rows[idx].id)
          return
        }
        /**
         * The row menu, from the keyboard.
         *
         * `ContextMenu` and Shift+F10 are the two keys that already mean "act on this thing"
         * everywhere else, so they are what a keyboard user tries first. The `⋮` is reachable
         * by Tab as well — it shares the row's roving tab stop — but that only works while the
         * row happens to be the tab stop, and this works from wherever the selection is.
         */
        case 'ContextMenu':
        case 'F10': {
          if (e.key === 'F10' && !e.shiftKey) return
          if (idx < 0) return
          const el = bodyRef.current?.querySelector<HTMLElement>(
            `[data-row-id="${CSS.escape(rows[idx].id)}"]`,
          )
          if (!el) return
          e.preventDefault()
          openMenu(rows[idx].id, el)
          return
        }
      }
    },
    [
      rows,
      selectedId,
      onSelect,
      focusRow,
      hasChildren,
      collapsed,
      onToggle,
      columns,
      ownerOptions,
      beginEdit,
      openMenu,
      bodyRef,
    ],
  )

  /**
   * Commit, then optionally step to the next editable cell on the same row (Tab).
   * Returns whether the commit was accepted, so the editor can re-arm itself after a
   * rejection instead of latching shut with the user's value stranded in it.
   */
  const finishEdit = useCallback(
    (row: ScheduleRow, colKey: string, value: string, advance: 1 | -1 | 0): boolean => {
      const ok = onCellCommit(row.id, colKey, value)
      if (!ok) return false // keep the editor open so the value isn't silently lost
      if (advance === 0) {
        setEditing(null)
        // The editor unmounts here; without this focus lands on <body> and the keyboard
        // user loses their place in the grid entirely.
        focusRow(row.id)
        return true
      }
      const keys = editableColumns(row, columns.map((c) => c.key), ownerOptions)
      const at = keys.indexOf(colKey)
      const next = keys[at + advance]
      setEditing(next ? { rowId: row.id, colKey: next } : null)
      if (next) ensureColumnVisible(next)
      else focusRow(row.id) // ran off the end of the row — return focus to the row itself
      return true
    },
    [onCellCommit, columns, ownerOptions, ensureColumnVisible, focusRow],
  )

  /**
   * Commit a status change and its reason.
   *
   * Separate from `finishEdit` because status does not Tab onwards: the reason belongs to the
   * status that was just picked, so stepping into the next cell mid-edit would carry a
   * sentence typed about one field into a commit about another.
   */
  const finishStatus = useCallback(
    (row: ScheduleRow, status: string, reason: string): boolean => {
      const ok = onCellCommit(row.id, 'status', status, reason)
      if (!ok) return false // refused — the popover stays open with the typed reason intact
      setEditing(null)
      focusRow(row.id)
      return true
    },
    [onCellCommit, focusRow],
  )

  /** Left offset for each frozen column, so they stack correctly while scrolling. */
  const stickyLeft = useMemo(() => {
    const map: Record<string, number> = {}
    let acc = 0
    columns.forEach((c, i) => {
      if (i < frozenCount) {
        map[c.key] = acc
        acc += widthOf(c)
      }
    })
    return map
  }, [columns, frozenCount, widthOf])

  const totalWidth = useMemo(
    () => columns.reduce((s, c) => s + widthOf(c), 0),
    [columns, widthOf],
  )

  /* ---- column resize ---- */
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizing.current
      if (!r) return
      const col = columns.find((c) => c.key === r.key)
      const min = col?.minWidth ?? 60
      const next = Math.max(min, r.startW + (e.clientX - r.startX))
      setColWidths((prev) => ({ ...prev, [r.key]: next }))
    }
    const up = () => {
      resizing.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [columns, setColWidths])

  /* ---- column reorder (drag a header onto another) ---- */
  const [dragKey, setDragKey] = useState<string | null>(null)

  const onHeaderDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return
    setColOrder((prev) => {
      const next = prev.filter((k) => k !== dragKey)
      const at = next.indexOf(targetKey)
      next.splice(at < 0 ? next.length : at, 0, dragKey)
      return next
    })
    setDragKey(null)
  }

  const toggleSort = (c: ColumnDef) => {
    if (!c.sortable) return
    setSort(
      sort?.key === c.key
        ? sort.dir === 'asc'
          ? { key: c.key, dir: 'desc' }
          : null
        : { key: c.key, dir: 'asc' },
    )
  }

  return (
    <>
      {/* header — scrolled horizontally in step with the body */}
      <div className="scroll-x" ref={headRef}>
        <div className="grid-header" style={{ width: totalWidth }}>
          {columns.map((c, i) => {
            const frozen = i < frozenCount
            return (
              <div
                key={c.key}
                role="columnheader"
                tabIndex={c.sortable ? 0 : -1}
                className={`gh-cell${c.sortable ? ' sortable' : ''}${frozen ? ' sticky-col' : ''}`}
                style={{
                  width: widthOf(c),
                  ...(frozen ? { position: 'sticky', left: stickyLeft[c.key] } : {}),
                  justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
                }}
                onClick={() => toggleSort(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleSort(c)
                  }
                }}
                draggable
                onDragStart={() => setDragKey(c.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onHeaderDrop(c.key)}
                title={`${c.label}${c.sortable ? ' — click to sort, drag to reorder' : ''}`}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                {sort?.key === c.key && (
                  <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                )}
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- drag-resize is pointer-only; column widths are also managed from the Columns menu */}
                <span
                  className="resize"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    resizing.current = { key: c.key, startX: e.clientX, startW: widthOf(c) }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* body */}
      <div className="scroll-body" ref={bodyRef} onScroll={onScroll}>
        {rows.length === 0 ? (
          <div className="empty">No issues match the current filters.</div>
        ) : (
          <div
            style={{ width: totalWidth }}
            role="treegrid"
            tabIndex={0}
            aria-label="Issue tree"
            aria-rowcount={rows.length}
            aria-colcount={columns.length}
            onKeyDown={onGridKeyDown}
          >
            {rows.map((r, rowIdx) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- the treegrid container owns keyboard navigation (onGridKeyDown); the row click is its pointer twin
              <div
                key={r.id}
                data-row-id={r.id}
                role="row"
                aria-level={r.depth + 1}
                aria-selected={selectedId === r.id}
                aria-rowindex={rowIdx + 1}
                aria-expanded={hasChildren.has(r.id) ? !collapsed.has(r.id) : undefined}
                // Roving tabindex: one stop for the whole grid, not one per row.
                tabIndex={r.id === tabStopId ? 0 : -1}
                className={`grid-row kind-${r.kind}${selectedId === r.id ? ' selected' : ''}`}
                style={{ height: ROW_H }}
                onClick={() => onSelect(r.id)}
              >
                {columns.map((c, i) => {
                  const frozen = i < frozenCount
                  const spec = editorFor(r, c.key, ownerOptions, statusPolicy)
                  const isEditing = editing?.rowId === r.id && editing.colKey === c.key
                  /**
                   * The second tier of §6: a cell with no inline editor that still has a way in.
                   *
                   * Subject itself is deliberately not a plain inline cell editor (lib/editing.ts
                   * excludes it on purpose — a lone 392px cell divorces it from Description).
                   * The double-click that opens an editor everywhere else opens Quick Edit here
                   * instead: a small popover with room for a sentence, not the full record.
                   */
                  const opensEditor = !spec && c.key === 'name' && r.kind === 'issue'
                  return (
                    <div
                      key={c.key}
                      role="gridcell"
                      tabIndex={-1}
                      aria-colindex={i + 1}
                      className={`gc${frozen ? ' sticky-col' : ''}${spec || opensEditor ? ' editable' : ''}${isEditing ? ' editing' : ''}`}
                      style={{
                        width: widthOf(c),
                        ...(frozen ? { position: 'sticky', left: stickyLeft[c.key] } : {}),
                        justifyContent:
                          isEditing || c.align !== 'right'
                            ? c.align === 'center'
                              ? 'center'
                              : 'flex-start'
                            : 'flex-end',
                      }}
                      onDoubleClick={(e) => {
                        if (opensEditor) {
                          e.stopPropagation()
                          setQuickEditId(r.id)
                          return
                        }
                        if (!spec) return
                        e.stopPropagation()
                        beginEdit(r, c.key)
                      }}
                      title={
                        isEditing
                          ? undefined
                          : opensEditor
                            ? 'Double-click to quick-edit'
                            : spec
                              ? 'Double-click to edit'
                              : undefined
                      }
                    >
                      {opensEditor && quickEditId === r.id ? (
                        <QuickEditPopover
                          row={r}
                          statusOptions={editorFor(r, 'status', ownerOptions, statusPolicy)?.options ?? []}
                          ownerOptions={ownerOptions}
                          onCommit={(colKey, value, reason) => onCellCommit(r.id, colKey, value, reason)}
                          onClose={() => {
                            setQuickEditId(null)
                            focusRow(r.id)
                          }}
                        />
                      ) : isEditing && spec && c.key === 'status' ? (
                        <StatusCellEditor
                          options={spec.options ?? []}
                          value={spec.value}
                          onCommit={(status, reason) => finishStatus(r, status, reason)}
                          onCancel={() => {
                            setEditing(null)
                            focusRow(r.id)
                          }}
                        />
                      ) : isEditing && spec ? (
                        <CellEditor
                          spec={spec}
                          onCommit={(v, advance) => finishEdit(r, c.key, v, advance)}
                          onCancel={() => {
                            setEditing(null)
                            // Escape must return focus to the row, not drop it on <body>.
                            focusRow(r.id)
                          }}
                        />
                      ) : (
                        <>
                          <Cell
                            col={c.key}
                            row={r}
                            collapsed={collapsed}
                            hasChildren={hasChildren}
                            onToggle={onToggle}
                            critical={criticalIds.has(r.id)}
                          />
                          {c.key === anchorKey && (
                            <button
                              type="button"
                              className="row-actions"
                              // Shares the row's roving tab stop rather than adding one per
                              // row: a grid of two hundred lines would otherwise be two
                              // hundred Tab presses deep.
                              tabIndex={r.id === tabStopId ? 0 : -1}
                              aria-haspopup="menu"
                              aria-expanded={menu?.rowId === r.id}
                              aria-label={`Actions for ${r.displayId || r.name}`}
                              title="Row actions"
                              onMouseDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                // The cell would start an edit and the row would change the
                                // selection; opening a menu is neither.
                                e.stopPropagation()
                                openMenu(r.id, e.currentTarget)
                              }}
                            >
                              ⋮
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rendered from the grid rather than from each row: one menu can be open at a time, and
          a row that scrolls out from under an open menu takes the menu with it. */}
      {menu && menuRow && (
        <RowMenu
          row={menuRow}
          at={{ top: menu.top, left: menu.left }}
          actions={actions}
          onCloseRow={closeRow}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

/**
 * In-place editor for one cell.
 *
 * Enter commits, Escape abandons, Tab commits and steps to the next editable cell, and
 * blurring commits too — leaving a half-typed value on screen that was never saved is worse
 * than saving it, since every change is audited and reversible.
 */
function CellEditor({
  spec,
  onCommit,
  onCancel,
}: {
  spec: EditorSpec
  /** Returns false when the commit was rejected, so the editor stays open and re-armed. */
  onCommit: (value: string, advance: 1 | -1 | 0) => boolean
  onCancel: () => void
}) {
  const [value, setValue] = useState(spec.value)
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const settled = useRef(false)
  const listId = useRef(`dl-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    if (el instanceof HTMLInputElement && spec.kind === 'text') el.select()
  }, [spec.kind])

  const commit = (advance: 1 | -1 | 0, next = value) => {
    if (settled.current) return
    settled.current = true
    // A rejected commit leaves the editor open, so it must be re-armed — otherwise the
    // latch would block every further attempt and the typed value could never be saved.
    const accepted = onCommit(next, advance)
    if (!accepted) settled.current = false
  }
  const cancel = () => {
    settled.current = true
    onCancel()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(0)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit(e.shiftKey ? -1 : 1)
    }
  }

  const common = {
    onKeyDown,
    onBlur: () => commit(0),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    className: 'cell-editor',
  }

  if (spec.kind === 'select') {
    return (
      <select
        {...common}
        ref={ref as RefObject<HTMLSelectElement>}
        value={value}
        // A dropdown has no "typing" state — pick and commit in one action.
        onChange={(e) => {
          setValue(e.target.value)
          commit(0, e.target.value)
        }}
      >
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  return (
    <>
      <input
        {...common}
        ref={ref as RefObject<HTMLInputElement>}
        type={spec.kind === 'date' ? 'date' : spec.kind === 'number' ? 'number' : 'text'}
        value={value}
        min={spec.min}
        max={spec.max}
        placeholder={spec.placeholder}
        list={spec.suggestions?.length ? listId.current : undefined}
        onChange={(e) => setValue(e.target.value)}
      />
      {spec.suggestions?.length ? (
        <datalist id={listId.current}>
          {spec.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}

function Cell({
  col,
  row,
  collapsed,
  hasChildren,
  onToggle,
  critical,
}: {
  col: string
  row: ScheduleRow
  collapsed: Set<string>
  hasChildren: Set<string>
  onToggle: (id: string) => void
  critical: boolean
}) {
  switch (col) {
    case 'id':
      return <span className="idtag">{row.displayId}</span>

    case 'name': {
      const expandable = hasChildren.has(row.id)
      const isOpen = !collapsed.has(row.id)
      /**
       * Four treatments, and every kind must land on the right one.
       *
       * This named `client` and `module` and let everything else fall through to
       * `lvl-activity` — so Company, Engagement and Project rows, which every workspace has,
       * rendered in the muted italic reserved for lifecycle steps. The two group treatments
       * are a banner for the top of the tree and a lighter one for the tiers beneath it.
       */
      const levelClass =
        // Literal default kinds, deliberately: this is styling, not a boundary decision. The
        // banner treatment belongs to the top of the DEFAULT chain; an org-defined tier falls
        // through to the ordinary group treatment below, which is the right look for a
        // mid-chain tier and a harmless one for any other.
        row.kind === 'company' || row.kind === 'client'
          ? 'lvl-client'
          : isGroupRow(row.kind)
            ? 'lvl-module'
            : row.kind === 'issue'
              ? 'lvl-issue'
              : 'lvl-activity'
      return (
        <div className="name-cell">
          {/* One guide per ancestor level, so depth is readable without counting pixels. */}
          {Array.from({ length: row.depth }, (_, i) => (
            <span key={i} className="indent-guide" style={{ width: 14 }} />
          ))}
          {expandable ? (
            // A real button, not a role="button" span: the span had no keyboard handler, so
            // Enter and Space did nothing. The row itself already exposes aria-expanded, so
            // this is hidden from assistive tech to avoid announcing the state twice.
            <button
              type="button"
              className="twisty"
              tabIndex={-1}
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation()
                onToggle(row.id)
              }}
              title={isOpen ? 'Collapse' : 'Expand'}
            >
              {isOpen ? '▼' : '▶'}
            </button>
          ) : (
            <span className="twisty spacer" aria-hidden="true">
              ▼
            </span>
          )}
          {(row.kind === 'activity' || row.kind === 'milestone') && (
            <span className="branch">└</span>
          )}
          <span className={`label ${levelClass}`} title={row.name}>
            {row.name}
          </span>
          {critical && (
            <span className="chip" style={{ color: 'var(--accent)' }} title="On the Critical Resolution Path">
              ◆
            </span>
          )}
          {row.rollup && row.rollup.issues > 0 && (
            <span className="rollup">
              <span className="rc" title={`${row.rollup.issues} issues beneath this row, ${row.rollup.open} still open`}>
                {row.rollup.issues} · {row.rollup.open} open
              </span>
              {row.rollup.overdue > 0 && (
                <span className="rc warn" title={`${row.rollup.overdue} overdue`}>
                  {row.rollup.overdue} overdue
                </span>
              )}
              {row.rollup.atRisk > 0 && (
                <span className="rc risk" title={`${row.rollup.atRisk} at risk`}>
                  {row.rollup.atRisk} at risk
                </span>
              )}
              {row.rollup.blocked > 0 && (
                <span className="rc blocked" title={`${row.rollup.blocked} blocked`}>
                  {row.rollup.blocked} blocked
                </span>
              )}
            </span>
          )}
        </div>
      )
    }

    case 'type':
      return <span style={{ color: 'var(--text-muted)' }}>{row.type}</span>

    case 'discipline':
      // An em dash for a tier, which has none, and for an issue nobody has classified. They
      // read the same because they mean the same thing to somebody scanning the column:
      // there is no answer here. The difference is recoverable from the row's kind.
      return row.discipline ? (
        <span style={{ color: 'var(--text-muted)' }}>{row.discipline}</span>
      ) : (
        <span style={{ color: 'var(--text-faint)' }}>—</span>
      )

    case 'status':
      return row.status ? <span>{row.status}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span>

    case 'severity':
      return row.severity ? (
        <span className={`chip sev-${row.severity}`}>
          {/* A shape, not just the dot's color, carries the level — see lib/severity.ts. */}
          <span className="sev-glyph" aria-hidden="true">{severityGlyph(row.severity)}</span>
          {row.severity}
        </span>
      ) : (
        <span style={{ color: 'var(--text-faint)' }}>—</span>
      )

    case 'exposure': {
      // Three states, not two: a Risk judged (the band, colored like schedule health), a Risk
      // not yet judged (an honest sentence, never a fabricated band), and a row that isn't a
      // Risk at all (an em dash, the same "nothing to say here" convention `discipline` and
      // `owner` already use).
      const judged = exposure(row.riskLikelihood, row.riskImpact)
      if (judged) {
        const slug = judged.band.toLowerCase()
        return (
          <span className={`chip hl-${slug}`}>
            <span className={`dot bg-${slug}`} />
            {judged.band}
          </span>
        )
      }
      return row.raidKind === 'risk' ? (
        <span style={{ color: 'var(--text-faint)' }}>not yet judged</span>
      ) : (
        <span style={{ color: 'var(--text-faint)' }}>—</span>
      )
    }

    case 'decisionOutcome':
      return row.raidKind === 'decision' ? (
        row.decisionOutcome ? (
          <span>{row.decisionOutcome}</span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>not yet decided</span>
        )
      ) : (
        <span style={{ color: 'var(--text-faint)' }}>—</span>
      )

    case 'health': {
      const slug = row.scheduleHealth.toLowerCase().replace(/\s+/g, '')
      return (
        <span className={`chip hl-${slug}`} title={healthHint(row.scheduleHealth)}>
          <span className={`dot bg-${slug}`} />
          {row.scheduleHealth}
        </span>
      )
    }

    case 'owner':
      return <span title={row.owner ?? ''}>{row.owner ?? '—'}</span>

    case 'accountable':
      return <span>{row.accountable ?? '—'}</span>

    case 'start': {
      const d = row.plannedStartDate ?? row.actualStartDate
      const isActualOnly = !row.plannedStartDate && !!row.actualStartDate
      return (
        <span
          className="mono"
          style={{ fontSize: 11, color: isActualOnly ? 'var(--text-muted)' : 'inherit' }}
          title={isActualOnly ? 'Date raised (recorded in the issue log) — no planned start set' : ''}
        >
          {formatIso(d)}
        </span>
      )
    }

    case 'due':
      return row.plannedEndDate ? (
        <span className="mono" style={{ fontSize: 11 }}>
          {formatIso(row.plannedEndDate)}
        </span>
      ) : (
        <span style={{ color: 'var(--text-faint)', fontSize: 11 }} title="No due date exists in the source issue log">
          not set
        </span>
      )

    case 'duration':
      return row.duration != null ? (
        <span className="mono" style={{ fontSize: 11 }} title={`${row.workingDuration} working days`}>
          {row.duration}d
        </span>
      ) : (
        <span style={{ color: 'var(--text-faint)' }}>—</span>
      )

    case 'pct':
      return (
        <div className="pct">
          <div className="track">
            <div className="fill" style={{ width: `${row.percentComplete}%` }} />
          </div>
          <span
            className={`val${row.progressOrigin === 'status-derived' ? ' derived' : ''}`}
            title={
              row.progressOrigin === 'status-derived'
                ? 'Derived from the issue status — the log records no progress figure'
                : row.progressOrigin === 'rolled-up'
                  ? 'Rolled up from child rows'
                  : 'Entered by a user'
            }
          >
            {row.percentComplete}%
          </span>
        </div>
      )

    case 'mode':
      return (
        <span
          style={{ fontSize: 11, color: row.scheduleMode === 'MANUAL' ? 'var(--accent)' : 'var(--text-muted)' }}
          title={
            row.scheduleMode === 'MANUAL'
              ? 'Manually scheduled — roll-up will not overwrite these dates'
              : 'Auto roll-up from children'
          }
        >
          {row.scheduleMode === 'MANUAL' ? 'Manual' : 'Auto'}
        </span>
      )

    case 'next':
      return (
        <span title={row.nextAction ?? ''} style={{ color: 'var(--text-muted)' }}>
          {row.nextAction || '—'}
        </span>
      )

    case 'dependency':
      return row.predecessorIds.length ? (
        <span className="mono" style={{ fontSize: 10.5 }} title={row.predecessorIds.join(', ')}>
          {row.predecessorIds.map((p) => p.split('#')[1] ?? p).join(', ')} FS
        </span>
      ) : (
        <span style={{ color: 'var(--text-faint)' }}>—</span>
      )

    default:
      return null
  }
}

function healthHint(h: string): string {
  switch (h) {
    case 'On Track':
      return 'Inside the planned window with progress keeping pace.'
    case 'At Risk':
      return 'Approaching the due date with progress behind elapsed time.'
    case 'Overdue':
      return 'Due date has passed and the work is not complete.'
    case 'Blocked':
      return 'Waiting on a client decision, a clarification, or an incomplete predecessor.'
    case 'Completed':
      return 'Closed or superseded.'
    default:
      return 'No planned dates — the source issue log carries no due date for this issue.'
  }
}
