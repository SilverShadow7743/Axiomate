'use client'

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import { describeAction } from '@/lib/pendingActions'
import type { SubmittedAction } from '@/lib/idempotency'

/**
 * What was queued but never confirmed by the server — surfaced plainly, not left to a corner
 * badge and a reload to discover. See `docs/plans/2026-09-09-stuck-changes-recovery-design.md`
 * for why this exists: the autosave queue halts entirely on a genuine conflict
 * (`lib/queue.ts`'s `Halt: 'stopped'`), and everything queued after that point looks saved on
 * screen but never reaches the server — a reload discards it, silently, unless someone catches
 * it here first.
 *
 * Opened from two places in `IssueWorkspace.tsx`: a boot-time check (leftovers from a session
 * that ended without clearing them) and the same halt-transition that fires the toast fix
 * already shipped — this panel does not replace that toast, both fire.
 */
export default function StuckChangesPanel({
  actions,
  onReapply,
  onDiscard,
  onClose,
}: {
  actions: SubmittedAction[]
  onReapply: (action: SubmittedAction) => void
  onDiscard: (key: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, true, onClose)

  const body = (
    // Pointer-only dismissal; Escape via useOverlay is the keyboard path, and the target guard
    // means clicks inside the dialog never bubble into a close.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal is Escape (useOverlay)
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal stuck-changes-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stuck-changes-title"
      >
        <div className="modal-head">
          <span id="stuck-changes-title">
            {actions.length} change{actions.length === 1 ? '' : 's'} could not be saved
          </span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="panel-note">
            These reached this browser but never reached the server — usually because somebody
            else changed the same record around the same time. Nothing here is lost yet, but
            closing this without acting on it will be: review each one, then reapply it against
            what is actually there now, or discard it if it is no longer wanted.
          </p>

          <ul className="stuck-changes-list">
            {actions.map((a) => (
              <li key={a.key} className="stuck-change-row">
                <span className="stuck-change-desc">{describeAction(a)}</span>
                <span className="stuck-change-actions">
                  <button className="btn primary" onClick={() => onReapply(a)}>
                    Reapply
                  </button>
                  <button className="btn ghost" onClick={() => a.key && onDiscard(a.key)}>
                    Discard
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
