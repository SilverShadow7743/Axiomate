'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import {
  KIND_ICON,
  KIND_LABEL,
  SNAPSHOT_PURPOSES,
  categorise,
  detectSourceDocument,
  formatBytes,
  isPreviewableImage,
  type EvidenceItem,
  type EvidenceKind,
  type SnapshotPurpose,
} from '@/lib/evidence'
import { formatIso } from '@/lib/dates'
import type { IssueRecord } from '@/lib/workspace'

/**
 * Evidence manager, anchored right.
 *
 * A side panel was the wrong shape for editing an issue — too narrow for a form. It is the
 * right shape for inspecting attachments: a list of items, a preview, and the issue still
 * visible behind it.
 */

export interface AddEvidenceInput {
  kind: EvidenceKind
  name: string
  purpose: SnapshotPurpose | null
  url: string | null
  mimeType: string | null
  sizeBytes: number | null
  note: string
}

interface Props {
  issue: IssueRecord
  items: EvidenceItem[]
  onAdd: (input: AddEvidenceInput) => void
  onUpdate: (id: string, patch: Partial<EvidenceItem>) => void
  onRemove: (id: string) => void
  onClose: () => void
}

const ORDER: EvidenceKind[] = ['snapshot', 'data', 'document', 'link']

export default function EvidencePanel({
  issue,
  items,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef)

  const fileInput = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<EvidenceKind | 'all'>('all')
  const [preview, setPreview] = useState<EvidenceItem | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')

  const live = useMemo(() => items.filter((i) => !i.deletedAt), [items])
  const shown = useMemo(
    () => (filter === 'all' ? live : live.filter((i) => i.kind === filter)),
    [live, filter],
  )
  const source = useMemo(() => detectSourceDocument(issue), [issue])

  const onFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      onAdd({
        kind: categorise(file.name, file.type),
        name: file.name,
        purpose: categorise(file.name, file.type) === 'snapshot' ? 'Investigation evidence' : null,
        // Held for this session only — see the note in the footer.
        url: URL.createObjectURL(file),
        mimeType: file.type || null,
        sizeBytes: file.size,
        note: '',
      })
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const panel = (
    <>
      <div className="drawer-scrim" onMouseDown={onClose} />
      <aside
        className="evi"
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evi-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="evi-title">Evidence &amp; Documents</h2>
            <button className="btn ghost" onClick={onClose} aria-label="Close evidence panel">
              ✕
            </button>
          </div>
          <div className="evi-sub">
            <span className="mono" style={{ color: 'var(--accent)' }}>
              {issue.id}
            </span>
            <span className="dot-sep">·</span>
            <span>{issue.subject.slice(0, 60)}</span>
          </div>
        </header>

        {/* Traceability: where the issue itself came from. Deliberately separate from the
            evidence list below — being extracted from a spreadsheet is not the same as
            someone attaching a screenshot. */}
        <div className="evi-source">
          <div className="ctx-label">Source</div>
          <div className="evi-source-body">
            <span className="evi-icon">{KIND_ICON.data}</span>
            <div style={{ minWidth: 0 }}>
              {source ? (
                <>
                  <div className="evi-source-name">{source.fileName}</div>
                  <div className="evi-source-meta">
                    Detected in the issue {source.detectedIn} · file not held by this app
                  </div>
                </>
              ) : (
                <>
                  <div className="evi-source-name">{issue.source || 'Consolidated register'}</div>
                  <div className="evi-source-meta">
                    {issue.verification} · no originating file named in this row
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Evidence recorded in the log itself: a quoted snippet, not an attachment. */}
        {issue.evidence && (
          <div className="evi-quote">
            <div className="ctx-label">Recorded in the issue log</div>
            <blockquote>{issue.evidence}</blockquote>
            {issue.evidenceDate && (
              <div className="evi-source-meta mono">{formatIso(issue.evidenceDate)}</div>
            )}
          </div>
        )}

        <div className="evi-actions">
          <button className="btn primary" onClick={() => fileInput.current?.click()}>
            + Attach files
          </button>
          <button className="btn" onClick={() => setLinkOpen((v) => !v)}>
            + Link
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {linkOpen && (
          <form
            className="evi-linkform"
            onSubmit={(e) => {
              e.preventDefault()
              onAdd({
                kind: 'link',
                name: linkName.trim() || linkUrl,
                purpose: null,
                url: linkUrl.trim(),
                mimeType: null,
                sizeBytes: null,
                note: '',
              })
              setLinkUrl('')
              setLinkName('')
              setLinkOpen(false)
            }}
          >
            <label className="fld">
              <span className="fld-label">URL</span>
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </label>
            <label className="fld">
              <span className="fld-label">Title</span>
              <input
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <button className="btn primary" type="submit">
              Add link
            </button>
          </form>
        )}

        <div className="evi-tabs" role="tablist" aria-label="Evidence categories">
          <button
            role="tab"
            aria-selected={filter === 'all'}
            className={filter === 'all' ? 'on' : ''}
            onClick={() => setFilter('all')}
          >
            All {live.length}
          </button>
          {ORDER.map((k) => {
            const n = live.filter((i) => i.kind === k).length
            return (
              <button
                key={k}
                role="tab"
                aria-selected={filter === k}
                className={filter === k ? 'on' : ''}
                onClick={() => setFilter(k)}
              >
                {KIND_ICON[k]} {n}
              </button>
            )
          })}
        </div>

        <div className="evi-list">
          {shown.length === 0 ? (
            <p className="evi-empty">
              {live.length === 0
                ? 'No evidence attached yet. Attach a snapshot, a data file, a document, or link to something external.'
                : `No ${KIND_LABEL[filter as EvidenceKind].toLowerCase()} attached.`}
            </p>
          ) : (
            shown.map((item) => (
              <div key={item.id} className="evi-item">
                <span className="evi-icon">{KIND_ICON[item.kind]}</span>
                <div className="evi-item-body">
                  <div className="evi-item-name" title={item.name}>
                    {item.name}
                  </div>
                  <div className="evi-item-meta">
                    {item.kind === 'snapshot' && item.purpose && (
                      <span className="evi-purpose">{item.purpose}</span>
                    )}
                    {item.sizeBytes != null && <span>{formatBytes(item.sizeBytes)}</span>}
                    <span className="mono">{formatIso(item.addedAt.slice(0, 10))}</span>
                  </div>
                  {item.kind === 'snapshot' && (
                    <select
                      className="evi-purpose-select"
                      value={item.purpose ?? 'Other'}
                      onChange={(e) =>
                        onUpdate(item.id, { purpose: e.target.value as SnapshotPurpose })
                      }
                      aria-label={`Purpose of ${item.name}`}
                    >
                      {SNAPSHOT_PURPOSES.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="evi-item-actions">
                  {isPreviewableImage(item) && (
                    <button className="btn ghost" onClick={() => setPreview(item)} title="Preview">
                      👁
                    </button>
                  )}
                  {item.url && (
                    <a
                      className="btn ghost"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Open"
                    >
                      ↗
                    </a>
                  )}
                  <button
                    className="btn ghost"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.name}`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <footer className="evi-foot">
          Files are held in this browser session only — there is no upload backend yet, so they
          are lost on reload. Links and the record of what was attached persist in History.
        </footer>
      </aside>

      {preview && <Lightbox item={preview} onClose={() => setPreview(null)} />}
    </>
  )

  return typeof document === 'undefined' ? panel : createPortal(panel, document.body)
}

/**
 * Snapshot preview.
 *
 * Closes on Escape and on an explicit button, not only on a click outside — a mouse-dismiss
 * lightbox is a keyboard trap, and a snapshot is precisely the evidence someone may need to
 * inspect without a mouse.
 */
function Lightbox({ item, onClose }: { item: EvidenceItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Capture so it beats the panel's own Escape handling.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="lightbox"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${item.name}`}
    >
      <button ref={closeRef} className="lightbox-close" onClick={onClose} aria-label="Close preview">
        ✕
      </button>
      <img src={item.url ?? ''} alt={item.name} onMouseDown={(e) => e.stopPropagation()} />
      <div className="lightbox-cap">
        {item.name}
        {item.purpose ? ` · ${item.purpose}` : ''}
      </div>
    </div>
  )
}
