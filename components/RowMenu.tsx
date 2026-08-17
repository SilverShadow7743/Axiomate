'use client'

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import { useLabels } from './labels'
import { kindLabel } from '@/lib/config'
import type { ScheduleRow } from '@/lib/types'
import { isGroupRow } from '@/lib/types'
import type { CreatableKind } from '@/lib/workspace'

/**
 * Every verb a row can be acted on with, as one function each.
 *
 * The workspace owns these and hands the SAME object to this menu and — through the thin
 * adapters on its props — to `SelectionToolbar`. That is the whole point of the interface: the
 * toolbar's "Add a child" and the row menu's "Add a child" are not two implementations that
 * happen to agree today, they are one function called from two places, so there is nothing
 * left that could drift into meaning something different under the same word.
 *
 * The three questions (`childKinds`, `siblingKinds`, `convertTypes`) are here rather than in
 * the menu because answering them needs the workspace state — what a row's parent is, what the
 * operating model calls a work type — and a menu that computed them from the row alone would
 * be a second, poorer copy of `CREATE_MENU`.
 */
export interface RowActions {
  /** What may be created *under* this row. Empty hides the section. */
  childKinds: (row: ScheduleRow) => CreatableKind[]
  /** What may be created *beside* it — the same arm, with the parent of the selection. */
  siblingKinds: (row: ScheduleRow) => CreatableKind[]
  addChild: (row: ScheduleRow, kind: CreatableKind) => void
  addSibling: (row: ScheduleRow, kind: CreatableKind) => void
  edit: (row: ScheduleRow) => void
  move: (row: ScheduleRow) => void
  duplicate: (row: ScheduleRow) => void
  link: (row: ScheduleRow) => void
  logTime: (row: ScheduleRow) => void
  schedule: (row: ScheduleRow) => void
  archive: (row: ScheduleRow) => void
  /** Work types this issue could be reclassified as; empty for anything that is not an issue. */
  convertTypes: (row: ScheduleRow) => string[]
  convert: (row: ScheduleRow, type: string) => void
}

/**
 * The `⋮` menu on a tree line.
 *
 * Portaled to the body and positioned in viewport coordinates, because the grid body scrolls
 * in both directions and clips its own children: a menu opened on the last visible row would
 * otherwise be cut off at the fold, which is exactly the row a person is most likely to be
 * acting on after scrolling to it.
 *
 * `useOverlay` does the keyboard work — background `inert`, a Tab wrap, and focus back to the
 * `⋮` when it closes. It deliberately does not own Escape, so that is handled here; the
 * workspace's window-level Escape only claims the key while a dialog is open.
 */
export default function RowMenu({
  row,
  at,
  actions,
  onCloseRow,
  onClose,
}: {
  row: ScheduleRow
  /** Viewport coordinates of the trigger, already clamped by the caller. */
  at: { top: number; left: number }
  actions: RowActions
  /** Route "Close…" to the inline status editor, which is what asks for the reason. */
  onCloseRow: (row: ScheduleRow) => void
  onClose: () => void
}) {
  const labels = useLabels()
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref)

  const childKinds = actions.childKinds(row)
  const siblingKinds = actions.siblingKinds(row)
  const convertTypes = actions.convertTypes(row)
  const isIssue = row.kind === 'issue'
  const isActivity = row.kind === 'activity' || row.kind === 'milestone'
  // Structural rows are archived rather than deleted — the same distinction the toolbar makes,
  // and it has to read the same way here or the two would describe one action differently.
  const isStructural = isGroupRow(row.kind)

  /** Close first, then act: the action may open a dialog, which must end up with the focus. */
  const run = (fn: () => void) => {
    onClose()
    fn()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button.menu-item') ?? [])
    if (!items.length) return
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? idx + 1 : idx - 1
    items[(next + items.length) % items.length].focus()
  }

  const body = (
    <>
      {/* The background is `inert` while this is open, so a click out there reaches nothing.
          A scrim is what turns that into a dismissal instead of a dead click. */}
      <div className="row-menu-scrim" onMouseDown={onClose} />
      <div
        className="menu row-menu"
        ref={ref}
        role="menu"
        aria-label={`Actions for ${row.displayId || row.name}`}
        style={{ top: at.top, left: at.left }}
        onKeyDown={onKeyDown}
      >
        <div className="menu-title">{row.displayId || row.name}</div>

        {childKinds.length > 0 && (
          <>
            {childKinds.map((k) => (
              <button
                key={`child-${k}`}
                role="menuitem"
                className="menu-item"
                onClick={() => run(() => actions.addChild(row, k))}
              >
                Add {kindLabel(labels, k)}
                <span className="menu-sub">under this row</span>
              </button>
            ))}
          </>
        )}

        {siblingKinds.length > 0 && (
          <>
            {siblingKinds.map((k) => (
              <button
                key={`sibling-${k}`}
                role="menuitem"
                className="menu-item"
                onClick={() => run(() => actions.addSibling(row, k))}
              >
                Add {kindLabel(labels, k)}
                <span className="menu-sub">beside this row</span>
              </button>
            ))}
          </>
        )}

        <div className="menu-sep" />

        <button role="menuitem" className="menu-item" onClick={() => run(() => actions.edit(row))}>
          Edit…
        </button>

        {!isActivity && (
          <button role="menuitem" className="menu-item" onClick={() => run(() => actions.move(row))}>
            Move…
          </button>
        )}

        {isIssue && (
          <>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => run(() => actions.duplicate(row))}
            >
              Duplicate
              <span className="menu-sub">records what it was copied from</span>
            </button>
            <button role="menuitem" className="menu-item" onClick={() => run(() => actions.link(row))}>
              Link…
            </button>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => run(() => actions.logTime(row))}
            >
              Log time
            </button>
          </>
        )}

        <button role="menuitem" className="menu-item" onClick={() => run(() => actions.schedule(row))}>
          Schedule
          <span className="menu-sub">show it on the timeline</span>
        </button>

        <div className="menu-sep" />
        <div className="menu-title">More</div>

        {isIssue && (
          <button role="menuitem" className="menu-item" onClick={() => run(() => onCloseRow(row))}>
            Close…
            <span className="menu-sub">a status change, so it asks why</span>
          </button>
        )}

        {convertTypes.map((t) => (
          <button
            key={`convert-${t}`}
            role="menuitem"
            className="menu-item"
            onClick={() => run(() => actions.convert(row, t))}
          >
            Convert to {t}
          </button>
        ))}

        <button
          role="menuitem"
          className="menu-item danger"
          onClick={() => run(() => actions.archive(row))}
        >
          {isStructural ? 'Archive…' : 'Delete…'}
        </button>
      </div>
    </>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
