'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The record detail's container: a right-hand overlay drawer, replacing the bottom dock
 * (docs/plans/2026-08-31-clean-shell-design.md). The Tree and Gantt keep every pixel of
 * width underneath; selecting a record slides its detail over them instead of shortening
 * them.
 *
 * Closing is not this component's decision. The scrim click hands off to `onClose`, which
 * the workspace wires to the same dirty-checking `requestSelect(null)` every row switch
 * passes through — a drawer that merely unmounted would silently discard a half-finished
 * edit. Escape is deliberately NOT handled here: DetailPanel's own document-level Escape
 * listener (which already defers to focused inputs, so Escape can still mean "cancel this
 * prompt" inside the panel) reaches the workspace through the same `onSetPanel('compact')`
 * verb it always used, now mapped to close. One listener, one confirm — two would double
 * the unsaved-changes dialog.
 *
 * Sits at --z-drawer, BELOW the modal layer and the assistant dock on purpose: Dialogs and
 * the evidence manager open from inside this drawer and must stack over it, and the
 * assistant stays usable beside an open record — its panel rides above the scrim.
 */
interface Props {
  /** Wide mode (92vw), driven by DetailPanel's own ⤢ control through the workspace. */
  wide: boolean
  /** Must route through the workspace's dirty-checking deselect, never a bare unmount. */
  onClose: () => void
  children: ReactNode
}

export default function DetailDrawer({ wide, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus lands in the drawer on open and returns to the element that opened it on close,
  // so a keyboard user is never dropped at the top of the document by a row click.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      if (prev && document.contains(prev)) prev.focus()
    }
  }, [])

  return (
    // mousedown, matching every away-listener in the app's menus — and checked against the
    // scrim itself, so nothing that starts inside the drawer can bubble into a close.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- the scrim is a pointer affordance; Escape (via DetailPanel) is the keyboard path to the same close
    <div
      className="record-drawer-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`drawer${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Record detail"
        tabIndex={-1}
        ref={panelRef}
      >
        {children}
      </div>
    </div>
  )
}
