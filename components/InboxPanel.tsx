'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceState } from '@/lib/workspace'
import { searchWorkspace } from '@/lib/search'
import { formatIso } from '@/lib/dates'

/**
 * "Your inbox" — the person's own mail, fetched through their own delegated token and never
 * stored. See `docs/plans/2026-08-31-in-mail-design.md`. Filing dispatches server-side as
 * the session actor; a filed mail shows its issue id, and a second filing of the same mail
 * is refused by the route's messageId dedupe.
 */

interface InboxMessage {
  id: string
  subject: string
  fromName: string
  fromAddress: string
  preview: string
  receivedAt: string
  internetMessageId: string
}

export default function InboxPanel({ state }: { state: WorkspaceState }) {
  const [messages, setMessages] = useState<InboxMessage[] | null>(null)
  const [reconnect, setReconnect] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filing, setFiling] = useState<InboxMessage | null>(null)
  const [mode, setMode] = useState<'create' | 'attach'>('create')
  const [parentId, setParentId] = useState('')
  const [attachQuery, setAttachQuery] = useState('')
  const [attachId, setAttachId] = useState('')
  const [filed, setFiled] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/mail/inbox')
      const data = (await res.json()) as {
        ok: boolean
        reconnect?: boolean
        messages?: InboxMessage[]
        error?: string
      }
      if (!data.ok) throw new Error(data.error ?? 'The inbox could not be read.')
      setReconnect(Boolean(data.reconnect))
      setMessages(data.messages ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The inbox could not be read.')
      setMessages([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const moduleNodes = useMemo(
    () =>
      Object.values(state.nodes)
        .filter((n) => n.kind === 'module')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.nodes],
  )
  const attachHits = useMemo(
    () =>
      attachQuery.trim().length >= 2
        ? searchWorkspace(state, attachQuery, new Date().toISOString().slice(0, 10))
            .filter((h) => h.kind === 'issue')
            .slice(0, 8)
        : [],
    [state, attachQuery],
  )

  const file = async () => {
    if (!filing) return
    setBusy(true)
    setError(null)
    try {
      const chosen = moduleNodes.find((n) => n.id === parentId)
      const res = await fetch('/api/mail/file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'create'
            ? { messageId: filing.id, mode, parentId, module: chosen?.name }
            : { messageId: filing.id, mode, issueId: attachId },
        ),
      })
      const data = (await res.json()) as { ok: boolean; issueId?: string; error?: string }
      if (!data.ok) throw new Error(data.error ?? 'The filing was refused.')
      setFiled((p) => ({ ...p, [filing.id]: data.issueId ?? '' }))
      setFiling(null)
      setAttachQuery('')
      setAttachId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The filing was refused.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ibx" aria-label="Your inbox">
      <div className="ibx-head">
        <h3>Your inbox</h3>
        <span className="ibx-note">
          Read through your own sign-in, shown only to you, stored nowhere.
        </span>
      </div>

      {error && <p className="ibx-error">{error}</p>}
      {messages === null && <p className="ibx-note">Loading…</p>}
      {reconnect && (
        <p className="ibx-note">
          Your inbox connection is not active in this app session —{' '}
          <a href="/api/auth/signin">sign in once</a> to connect it. (It resets when the app
          restarts; nothing is stored.)
        </p>
      )}

      {messages?.map((m) => (
        <div key={m.id} className="ibx-row">
          <div className="ibx-row-main">
            <span className="ibx-from">{m.fromName || m.fromAddress}</span>
            <span className="ibx-subject">{m.subject}</span>
            <span className="ibx-preview">{m.preview}</span>
          </div>
          <div className="ibx-row-side">
            <span className="ibx-date">{m.receivedAt ? formatIso(m.receivedAt.slice(0, 10)) : ''}</span>
            {filed[m.id] ? (
              <span className="ibx-filed">filed · {filed[m.id]}</span>
            ) : (
              <button className="btn" onClick={() => { setFiling(m); setMode('create') }}>
                File…
              </button>
            )}
          </div>
        </div>
      ))}
      {messages?.length === 0 && !reconnect && messages !== null && (
        <p className="ibx-note">Nothing in the inbox.</p>
      )}

      {filing && (
        <div className="modal-scrim" role="dialog" aria-label="File this mail">
          <div className="modal" style={{ maxWidth: 520 }}>
            <h3>File “{filing.subject}”</h3>
            <p className="ibx-note">
              From {filing.fromName || filing.fromAddress}. Filing records the mail with your
              mailbox as its provenance and is attributed to you.
            </p>
            <div className="ibx-mode">
              <label>
                <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} />
                <span>New work item</span>
              </label>
              <label>
                <input type="radio" checked={mode === 'attach'} onChange={() => setMode('attach')} />
                <span>Attach to an existing issue</span>
              </label>
            </div>
            {mode === 'create' ? (
              <label className="cfg-fld">
                <span>Where it belongs</span>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">Choose a process area…</option>
                  {moduleNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.id.split(':')[1] ?? ''} · {n.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="cfg-fld">
                  <span>Find the issue</span>
                  <input
                    value={attachQuery}
                    placeholder="id, subject, owner…"
                    onChange={(e) => setAttachQuery(e.target.value)}
                  />
                </label>
                <div className="ibx-attach-hits">
                  {attachHits.map((h) => (
                    <label key={h.id}>
                      <input
                        type="radio"
                        checked={attachId === h.id}
                        onChange={() => setAttachId(h.id)}
                      />
                      <span>{h.title}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setFiling(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={busy || (mode === 'create' ? !parentId : !attachId)}
                onClick={file}
              >
                {mode === 'create' ? 'Create the work item' : 'Attach the mail'}
              </button>
            </div>
            <p className="ibx-note">A newly created item appears in the tree on the next reload.</p>
          </div>
        </div>
      )}
    </section>
  )
}
