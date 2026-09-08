'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import { useOverlay } from './useOverlay'

/**
 * The one small affordance a curated screen carries — see
 * `docs/plans/2026-09-08-why-this-works-design.md`. `slug` names a file written by
 * `scripts/copy-help-docs.mjs` into `public/help/`; the allowlist there is the only place a
 * screen gets added or removed, on purpose — nothing here decides what is curated.
 */
export default function WhyThisWorks({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="link-btn why-link" onClick={() => setOpen(true)}>
        Why this works this way
      </button>
      {open && <WhyThisWorksDialog slug={slug} onClose={() => setOpen(false)} />}
    </>
  )
}

function WhyThisWorksDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, true, onClose)
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/help/${slug}.md`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setHtml(marked.parse(text, { async: false }) as string)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const shell = (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal is Escape (useOverlay)
    <div
      className="modal-scrim why-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal why-modal"
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="why-modal-title"
      >
        <div className="modal-head">
          <span id="why-modal-title">Why this works this way</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="why-body">
          {failed && <p className="cfg-note">Could not load this explanation.</p>}
          {!failed && html === null && <p className="cfg-note">Loading…</p>}
          {!failed && html !== null && (
            // Source is this repository's own docs/plans and lib/*.ts header comments, copied
            // in at build time (scripts/copy-help-docs.mjs) — not user input.
            <div className="why-doc" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? shell : createPortal(shell, document.body)
}
