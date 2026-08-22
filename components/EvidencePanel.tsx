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
import { formatBytes as formatDocBytes, type DocumentRecord } from '@/lib/documents'
import {
  coversDocument,
  describeReview,
  reviewStateOf,
  reviewsForDocument,
  versionChainOf,
  type DocumentReview,
  type ReviewVerdict,
} from '@/lib/proofing'
import type { Decision } from '@/lib/access'
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
  /**
   * What this actor may do, decided by the caller.
   *
   * Passed in rather than computed here, and the reason is proportion: this drawer takes neither
   * `state` nor `actor`, and widening it to take both so it could call `can()` three times would
   * be a larger change than the fault deserves. `Decision` carries the reason string, so a
   * disabled control still explains itself — which is the point of the fix. Every control below
   * was previously ungated on screen and refused only at dispatch, unlike Rates, Time, Capacity
   * and Commercial, which disable up front.
   */
  mayAttach: Decision
  mayAddEvidence: Decision
  mayRemove: Decision
  /** Files this app actually holds against the issue. */
  documents: DocumentRecord[]
  /**
   * Store a file. Resolves to an error sentence, or null when it worked.
   *
   * A promise rather than a fire-and-forget dispatch, because this is the one action in the
   * panel that can fail for reasons the person needs to read — the library is not configured,
   * the file is too large, the same bytes are already here. Everything else goes through the
   * reducer, which the client has already agreed with optimistically.
   */
  onUpload: (file: File, evidenceId: string | null) => Promise<string | null>
  onWithdrawDocument: (id: string) => void
  /** Flip whether client seats see a stored file — the one update a document record has. */
  onSetDocumentVisibility: (id: string, clientVisible: boolean) => void
  /* ---- proofing ---- */
  /** Every document in the workspace — a version chain can reach outside this panel's list. */
  allDocuments: Record<string, DocumentRecord>
  reviews: Record<string, DocumentReview>
  /** Directory names offered as reviewers. */
  people: string[]
  actorName: string
  mayReview: Decision
  onAskReview: (documentId: string, reviewers: string[], question: string) => void
  onDecideReview: (reviewId: string, verdict: ReviewVerdict, note: string) => void
  onWithdrawReview: (reviewId: string) => void
  /** A new version of an existing document — the same upload, chained. */
  onUploadVersion: (file: File, supersedesId: string) => Promise<string | null>
  onClose: () => void
}

const ORDER: EvidenceKind[] = ['snapshot', 'data', 'document', 'link']

export default function EvidencePanel({
  issue,
  items,
  onAdd,
  onUpdate,
  onRemove,
  mayAttach,
  mayAddEvidence,
  mayRemove,
  documents,
  onUpload,
  onWithdrawDocument,
  onSetDocumentVisibility,
  allDocuments,
  reviews,
  people,
  actorName,
  mayReview,
  onAskReview,
  onDecideReview,
  onWithdrawReview,
  onUploadVersion,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, true, onClose)

  const fileInput = useRef<HTMLInputElement>(null)
  const versionInput = useRef<HTMLInputElement>(null)
  /** Which document a chosen file will supersede — armed by its row's New version button. */
  const [versionFor, setVersionFor] = useState<string | null>(null)
  /** Which document's ask-for-review form is open. */
  const [askFor, setAskFor] = useState<string | null>(null)
  const [askWho, setAskWho] = useState<Set<string>>(new Set())
  const [askQuestion, setAskQuestion] = useState('')
  /** The verdict note, per review — required for Request changes, kept on refusal. */
  const [verdictNote, setVerdictNote] = useState('')
  const [filter, setFilter] = useState<EvidenceKind | 'all'>('all')
  const [preview, setPreview] = useState<EvidenceItem | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  /*
   * Which evidence row the next file should be joined to, or null for a file that stands on its
   * own. One file input serves both, because two hidden inputs that differ only in a callback
   * is the kind of duplication that ends with one of them silently doing the wrong thing.
   */
  const [attachTo, setAttachTo] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkName, setLinkName] = useState('')

  const live = useMemo(() => items.filter((i) => !i.deletedAt), [items])
  const shown = useMemo(
    () => (filter === 'all' ? live : live.filter((i) => i.kind === filter)),
    [live, filter],
  )
  const source = useMemo(() => detectSourceDocument(issue), [issue])

  /**
   * Store the files, one at a time.
   *
   * This used to mint a `blob:` URL and call `onAdd`, which created an evidence row describing a
   * file that existed only in this tab's memory — and `evidenceToRow` then nulled the URL on the
   * way to the database, so what survived was a record of an artefact nobody held. That is
   * exactly the fault scenario D calls P1, and it is now the thing being fixed rather than the
   * thing being done.
   *
   * Serially rather than in parallel: each upload is up to 25 MB through a B1 instance, and
   * three at once is how a drag-and-drop of a folder takes the site down. The first failure
   * stops the rest, because a partial result nobody was told about is worse than a short one.
   */
  const onFiles = async (files: FileList | null) => {
    if (!files) return
    const target = attachTo
    setFailed(null)
    for (const file of Array.from(files)) {
      setBusy(file.name)
      const error = await onUpload(file, target)
      if (error) {
        setFailed(`${file.name}: ${error}`)
        break
      }
    }
    setBusy(null)
    setAttachTo(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const liveDocs = documents.filter((d) => !d.deletedAt)

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
          <button
            className="btn primary"
            disabled={Boolean(busy) || !mayAttach.allowed}
            title={mayAttach.allowed ? 'Store a file against this record' : mayAttach.reason}
            onClick={() => {
              setAttachTo(null)
              fileInput.current?.click()
            }}
          >
            {busy ? `Storing ${busy}\u2026` : '+ Attach files'}
          </button>
          <button
            className="btn"
            disabled={!mayAddEvidence.allowed}
            title={mayAddEvidence.allowed ? 'Describe something held elsewhere' : mayAddEvidence.reason}
            onClick={() => setLinkOpen((v) => !v)}
          >
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

        {failed && (
          <p className="evi-failed" role="alert">
            {failed}
          </p>
        )}

        {/*
          * Files the app actually holds, listed apart from the evidence descriptions above them.
          *
          * `lib/evidence.ts` opens by explaining why "this issue came from row 117 of a
          * spreadsheet" and "somebody attached a screenshot proving the fix worked" are kept
          * apart. A stored file is a third thing again — it is the artefact itself — and folding
          * it into the evidence list would lose the distinction that makes the list honest about
          * what is merely described.
          */}
        <div className="evi-held">
          <div className="ctx-label">Held by this app</div>
          {liveDocs.length === 0 ? (
            <p className="evi-source-meta">
              No files are stored against this record yet. Attaching one puts it in the
              firm&rsquo;s document library, where it can be produced later.
            </p>
          ) : (
            liveDocs
              /* Chain heads only: an old version is reached through its successor's history
                 line, not listed as a sibling of the file that replaced it. */
              .filter((d) => !liveDocs.some((x) => x.supersedesId === d.id))
              .map((d) => {
                const chain = versionChainOf(allDocuments, d.id)
                const latest =
                  chain
                    .flatMap((c) => reviewsForDocument(reviews, c.id))
                    .sort((a, b) => b.askedAt.localeCompare(a.askedAt))[0] ?? null
                const iAmReviewer =
                  latest?.reviewers.some((r) => r.trim().toLowerCase() === actorName.trim().toLowerCase()) ?? false
                const iAsked = latest?.askedBy.trim().toLowerCase() === actorName.trim().toLowerCase()
                const outcome = latest ? reviewStateOf(latest).outcome : null
                return (
              <div key={d.id} className="evi-item evi-doc">
                <span className="evi-icon">{KIND_ICON[categorise(d.name, d.mimeType)]}</span>
                <div className="evi-item-body">
                  <div className="evi-item-name" title={d.name}>
                    {d.name}
                    {chain.length > 1 && <span className="prov"> · v{chain.length}</span>}
                  </div>
                  <div className="evi-item-meta">
                    <span>{formatDocBytes(d.sizeBytes)}</span>
                    <span className="mono">{formatIso(d.uploadedAt.slice(0, 10))}</span>
                    <span>{d.uploadedBy}</span>
                    {(d.clientVisible ?? false) && (
                      <span className="cv-chip on" title="Client seats see this file">
                        Client-visible
                      </span>
                    )}
                    {latest ? (
                      <span
                        className={`review-chip rc-${latest.withdrawnAt ? 'withdrawn' : outcome}${latest && !latest.withdrawnAt && outcome === 'approved' && !coversDocument(latest, d) ? ' rc-stale' : ''}`}
                        title={`“${latest.question}” — asked by ${latest.askedBy}`}
                      >
                        {describeReview(latest, d)}
                      </span>
                    ) : (
                      <span className="prov">unreviewed</span>
                    )}
                  </div>

                  {/* A named reviewer answers here. Request changes keeps its note rule: the
                      arm refuses a noteless one, so the box sits beside the buttons. */}
                  {latest && !latest.withdrawnAt && iAmReviewer && mayReview.allowed && (
                    <div className="evi-review-verdict">
                      <input
                        value={verdictNote}
                        onChange={(e) => setVerdictNote(e.target.value)}
                        placeholder="Note — required to request changes"
                        aria-label="Review note"
                      />
                      <button
                        className="btn"
                        onClick={() => {
                          onDecideReview(latest.id, 'approved', verdictNote)
                          setVerdictNote('')
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn ghost"
                        disabled={!verdictNote.trim()}
                        onClick={() => {
                          onDecideReview(latest.id, 'changes', verdictNote)
                          setVerdictNote('')
                        }}
                      >
                        Request changes
                      </button>
                    </div>
                  )}

                  {/* Asking. Absent without the grant to attach — the same both-halves rule
                      as everywhere: the arm refuses what the button hides. */}
                  {askFor === d.id ? (
                    <div className="evi-review-ask">
                      <div className="evi-review-people">
                        {people
                          .filter((p) => p.trim().toLowerCase() !== actorName.trim().toLowerCase())
                          .map((p) => (
                            <label key={p}>
                              <input
                                type="checkbox"
                                checked={askWho.has(p)}
                                onChange={(e) => {
                                  const next = new Set(askWho)
                                  if (e.target.checked) next.add(p)
                                  else next.delete(p)
                                  setAskWho(next)
                                }}
                              />
                              {p}
                            </label>
                          ))}
                      </div>
                      <input
                        value={askQuestion}
                        onChange={(e) => setAskQuestion(e.target.value)}
                        placeholder="What should they judge?"
                        aria-label="Review question"
                      />
                      <button
                        className="btn primary"
                        disabled={!askWho.size || !askQuestion.trim()}
                        onClick={() => {
                          onAskReview(d.id, [...askWho], askQuestion.trim())
                          setAskFor(null)
                          setAskWho(new Set())
                          setAskQuestion('')
                        }}
                      >
                        Ask
                      </button>
                      <button className="btn ghost" onClick={() => setAskFor(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="evi-item-actions">
                  {mayAttach.allowed && askFor !== d.id && (
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setAskFor(d.id)
                        setAskWho(new Set())
                        setAskQuestion('')
                      }}
                      title="Send this document to named colleagues for approve / request changes"
                    >
                      Ask for review…
                    </button>
                  )}
                  {latest && !latest.withdrawnAt && iAsked && (
                    <button
                      className="btn ghost"
                      onClick={() => onWithdrawReview(latest.id)}
                      title="Withdraw the review. Recorded verdicts stay recorded."
                    >
                      Withdraw review
                    </button>
                  )}
                  {mayAttach.allowed && (
                    <button
                      className="btn ghost"
                      onClick={() => onSetDocumentVisibility(d.id, !(d.clientVisible ?? false))}
                      title={
                        (d.clientVisible ?? false)
                          ? 'Make this file internal again'
                          : 'Let client seats see this file'
                      }
                    >
                      {(d.clientVisible ?? false) ? 'Make internal' : 'Show to client'}
                    </button>
                  )}
                  {mayAttach.allowed && (
                    <button
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => {
                        setVersionFor(d.id)
                        versionInput.current?.click()
                      }}
                      title="Upload a replacement. The old version stays downloadable; reviews stay with the bytes they judged."
                    >
                      New version
                    </button>
                  )}
                  {/*
                    * A normal link to our own endpoint, which authorises the request when it is
                    * made. Never a storage URL: one of those works for anybody holding it and
                    * outlives the grant that produced it.
                    */}
                  <a className="btn ghost" href={`/api/documents/${d.id}`} title="Download">
                    ⬇
                  </a>
                  <button
                    className="btn ghost"
                    onClick={() => onWithdrawDocument(d.id)}
                    aria-label={`Withdraw ${d.name}`}
                    title="Withdraw. The file stays in the document library."
                  >
                    ✕
                  </button>
                </div>
              </div>
                )
              })
          )}
          {/* The version chooser — armed per row, resolved through the same upload path. */}
          <input
            ref={versionInput}
            type="file"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file || !versionFor) return
              setBusy(file.name)
              setFailed(null)
              const err = await onUploadVersion(file, versionFor)
              setBusy(null)
              setVersionFor(null)
              if (err) setFailed(err)
            }}
          />
        </div>

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
                  {/*
                    * Joining a description to the artefact it describes. Offered only where the
                    * row does not already have one and is not a link — a link points somewhere
                    * else on purpose, and attaching a file to it would mean two different
                    * answers to "where is this".
                    */}
                  {!item.documentId && item.kind !== 'link' && (
                    <button
                      className="btn ghost"
                      disabled={Boolean(busy) || !mayAttach.allowed}
                      onClick={() => {
                        setAttachTo(item.id)
                        fileInput.current?.click()
                      }}
                      title={mayAttach.allowed ? 'Attach the actual file to this record' : mayAttach.reason}
                    >
                      ⤒
                    </button>
                  )}
                  {item.documentId && (
                    <a
                      className="btn ghost"
                      href={`/api/documents/${item.documentId}`}
                      title="Download the attached file"
                    >
                      ⬇
                    </a>
                  )}
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
                  {/*
                    * Imported evidence is never removable — the reducer refuses it outright,
                    * because it describes material reconstructed from the issue log rather than
                    * anything somebody attached. Hidden rather than disabled, because no grant
                    * would ever make it possible and a permanently grey button invites somebody
                    * to go looking for the permission that would ungrey it.
                    */}
                  {item.origin !== 'imported' && (
                    <button
                      className="btn ghost"
                      disabled={!mayRemove.allowed}
                      onClick={() => onRemove(item.id)}
                      aria-label={`Remove ${item.name}`}
                      title={mayRemove.allowed ? 'Remove' : mayRemove.reason}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <footer className="evi-foot">
          Attached files are stored in the firm&rsquo;s SharePoint document library and can be
          produced later. Withdrawing one removes it from this record and leaves the file in the
          library. Links point elsewhere and are not held here.
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
