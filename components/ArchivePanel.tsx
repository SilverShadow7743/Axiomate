'use client'

import { useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import { kindLabel } from '@/lib/config'
import { nameOf, parentOf, type WorkspaceState } from '@/lib/workspace'
import { useLabels } from './labels'

/**
 * What has been archived, and the way back.
 *
 * The schema has always said records are "archived, never destroyed", and the audit entry
 * written by every archive says it "can be restored". Neither was true in practice: every list
 * in the app filters `deletedAt` out, so an archived record left the interface completely and
 * the reducer's restore was reachable from nothing. This is the surface that makes the promise
 * good.
 *
 * Deliberately its own overlay rather than a mode of the tree. Mixing archived rows back into
 * the grid would put them into rollups, health and the critical path, where they would quietly
 * change every number on screen — and the whole point of archiving is that they no longer count.
 */

interface Archived {
  id: string
  name: string
  kind: string
  at: string
  /** The record it sits under, when that record is itself still archived. */
  blockedBy: string | null
}

export default function ArchivePanel({
  state,
  onRestore,
  onClose,
}: {
  state: WorkspaceState
  onRestore: (id: string) => void
  onClose: () => void
}) {
  const labels = useLabels()
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, true, onClose)

  const items = useMemo<Archived[]>(() => {
    const isArchived = (id: string) =>
      Boolean(
        state.nodes[id]?.deletedAt ?? state.issues[id]?.deletedAt ?? state.activities[id]?.deletedAt,
      )

    /**
     * The nearest archived ancestor, if there is one.
     *
     * Restoring a record under one is refused by the reducer, because it would land somewhere
     * nothing can see. Saying so here — rather than letting the user click and read an error —
     * is the difference between a list and a list you can act on.
     */
    const blockerFor = (id: string): string | null => {
      let cursor = parentOf(state, id)
      while (cursor) {
        if (isArchived(cursor)) return nameOf(state, cursor)
        cursor = parentOf(state, cursor)
      }
      return null
    }

    const out: Archived[] = []
    for (const n of Object.values(state.nodes)) {
      if (n.deletedAt) out.push({ id: n.id, name: n.name, kind: n.kind, at: n.deletedAt, blockedBy: blockerFor(n.id) })
    }
    for (const i of Object.values(state.issues)) {
      if (i.deletedAt) out.push({ id: i.id, name: i.subject, kind: 'issue', at: i.deletedAt, blockedBy: blockerFor(i.id) })
    }
    for (const a of Object.values(state.activities)) {
      if (a.deletedAt) {
        out.push({ id: a.id, name: String(a.phase), kind: a.isMilestone ? 'milestone' : 'activity', at: a.deletedAt, blockedBy: blockerFor(a.id) })
      }
    }
    // Most recently archived first — the thing someone wants back is usually the last one gone.
    return out.sort((x, y) => y.at.localeCompare(x.at))
  }, [state])

  /** Records archived in one action share a timestamp, and restore brings the group back. */
  const groups = useMemo(() => {
    const by = new Map<string, Archived[]>()
    for (const it of items) {
      if (!by.has(it.at)) by.set(it.at, [])
      by.get(it.at)!.push(it)
    }
    return [...by.entries()]
  }, [items])

  const body = (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal archive-modal"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-title"
      >
        <div className="modal-head">
          <span id="archive-title">Archived records</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {items.length === 0 ? (
            <div className="cfg-empty">Nothing is archived.</div>
          ) : (
            <>
              <div className="panel-note">
                Archived records are kept, not deleted. Restoring one undoes the whole action
                it belonged to: records archived alongside it come back, and records moved up a
                level to get out of its way move back into it.
                {/* Both halves are conditional, and saying so matters more than brevity: a
                    user who has since reorganised should not have that quietly reversed. */}
                <br />
                Anything archived separately, or moved somewhere else since, is left where it
                is — those were decisions of their own.
              </div>
              {groups.map(([at, rows]) => (
                <section className="archive-group" key={at}>
                  <div className="archive-when">
                    {new Date(at).toLocaleString()}
                    {rows.length > 1 && <span className="prov"> · {rows.length} records in one action</span>}
                  </div>
                  {rows.map((it) => (
                    <div className="archive-row" key={it.id}>
                      <span className="cfg-key">{kindLabel(labels, it.kind)}</span>
                      <span className="archive-name" title={it.name}>
                        {it.name}
                      </span>
                      <span className="grow" />
                      {it.blockedBy ? (
                        <span className="prov">under archived “{it.blockedBy}”</span>
                      ) : (
                        <button className="btn" onClick={() => onRestore(it.id)}>
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
