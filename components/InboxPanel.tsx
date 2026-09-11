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
 *
 * Folders, priority and search — `docs/plans/2026-09-08-in-mail-outlook-parity-design.md` —
 * are the same live passthrough, one call further: a folder picker scopes which mailbox
 * folder is read, a search box hands `q` straight to Graph's own `$search`, and `focused` is
 * Microsoft's Focused Inbox classification, read and split into two headed sections rather
 * than recomputed here.
 */

interface InboxMessage {
  id: string
  subject: string
  fromName: string
  fromAddress: string
  preview: string
  receivedAt: string
  internetMessageId: string
  focused: boolean
  categories: string[]
}

interface MailFolder {
  id: string
  name: string
  unreadCount: number
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

  /* ---------------- open — full content, fetched on demand, see the message route's own doc */
  const [opened, setOpened] = useState<InboxMessage | null>(null)
  const [openedContent, setOpenedContent] = useState<{
    contentType: 'html' | 'text'
    content: string
  } | null>(null)
  const [openedBusy, setOpenedBusy] = useState(false)
  const [openedError, setOpenedError] = useState<string | null>(null)

  const openMessage = async (m: InboxMessage) => {
    setOpened(m)
    setOpenedContent(null)
    setOpenedError(null)
    setOpenedBusy(true)
    try {
      const res = await fetch(`/api/mail/message/${encodeURIComponent(m.id)}`)
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        reconnect?: boolean
        error?: string
        contentType?: 'html' | 'text'
        content?: string
      } | null
      if (!res.ok || !data?.ok) {
        setOpenedError(data?.error ?? 'The message could not be read.')
        return
      }
      if (data.reconnect) {
        setOpenedError('Your inbox connection is not active — sign in once to connect it.')
        return
      }
      setOpenedContent({ contentType: data.contentType ?? 'text', content: data.content ?? '' })
    } catch {
      setOpenedError('The message could not be read. Check the connection and try again.')
    } finally {
      setOpenedBusy(false)
    }
  }

  /* ---------------- reply / reply-all — personal, see lib/personalGraph.ts ---------------- */
  const [replying, setReplying] = useState<{ message: InboxMessage; all: boolean } | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replied, setReplied] = useState<Record<string, true>>({})
  /** Message id → the draft's Outlook link ('' when Graph gave none). "Reply and schedule",
      Option C: the reply is left in the person's own Drafts and Outlook owns it from there. */
  const [drafted, setDrafted] = useState<Record<string, string>>({})

  /**
   * One request shape, two outcomes: `'send'` sends as before; `'draft'` leaves the signed
   * reply in the person's own Outlook Drafts (`docs/plans/2026-09-08-scheduled-reply-design.md`,
   * decided 11 Sep) — nothing is stored on this side and no token has to outlive this click.
   */
  const submitReply = async (mode: 'send' | 'draft') => {
    if (!replying || !replyText.trim()) return
    setReplyBusy(true)
    setReplyError(null)
    const verb = mode === 'draft' ? 'saved' : 'sent'
    try {
      const res = await fetch('/api/mail/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messageId: replying.message.id,
          comment: replyText,
          replyAll: replying.all,
          mode,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        reconnect?: boolean
        draft?: { id: string; webLink: string | null }
      } | null
      if (!res.ok || !data?.ok) {
        setReplyError(
          data?.reconnect
            ? 'Your inbox connection is not active — sign in once to connect it.'
            : (data?.error ?? `The reply could not be ${verb}.`),
        )
        return
      }
      if (mode === 'draft') setDrafted((p) => ({ ...p, [replying.message.id]: data.draft?.webLink ?? '' }))
      else setReplied((p) => ({ ...p, [replying.message.id]: true }))
      setReplying(null)
      setReplyText('')
    } catch {
      setReplyError(`The reply could not be ${verb}. Check the connection and try again.`)
    } finally {
      setReplyBusy(false)
    }
  }
  const sendReply = () => submitReply('send')

  /* ---------------- compose new — personal ---------------- */
  const [composingNew, setComposingNew] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeBusy, setComposeBusy] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [composeSent, setComposeSent] = useState(false)

  const sendCompose = async () => {
    setComposeBusy(true)
    setComposeError(null)
    try {
      const to = composeTo.split(',').map((a) => a.trim()).filter(Boolean)
      const res = await fetch('/api/mail/compose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, subject: composeSubject, body: composeBody }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        reconnect?: boolean
      } | null
      if (!res.ok || !data?.ok) {
        setComposeError(
          data?.reconnect
            ? 'Your inbox connection is not active — sign in once to connect it.'
            : (data?.error ?? 'The message could not be sent.'),
        )
        return
      }
      setComposeSent(true)
      setComposeTo('')
      setComposeSubject('')
      setComposeBody('')
    } catch {
      setComposeError('The message could not be sent. Check the connection and try again.')
    } finally {
      setComposeBusy(false)
    }
  }

  /* ---------------- folders, priority, search — personal, same passthrough ---------------- */
  const [folders, setFolders] = useState<MailFolder[] | null>(null)
  const [folderId, setFolderId] = useState('inbox')
  const [searchBox, setSearchBox] = useState('')
  const [activeQuery, setActiveQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/mail/inbox?listFolders=1')
        const data = (await res.json()) as { ok: boolean; folders?: MailFolder[] }
        if (!cancelled && data.ok) setFolders(data.folders ?? [])
      } catch {
        // The folder picker just stays empty — messages still load against the default folder.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = activeQuery
        ? `?q=${encodeURIComponent(activeQuery)}`
        : `?folderId=${encodeURIComponent(folderId)}`
      const res = await fetch(`/api/mail/inbox${params}`)
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
  }, [folderId, activeQuery])
  useEffect(() => {
    void load()
  }, [load])

  const focusedMessages = useMemo(() => (messages ?? []).filter((m) => m.focused), [messages])
  const otherMessages = useMemo(() => (messages ?? []).filter((m) => !m.focused), [messages])

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

  const messageRow = (m: InboxMessage) => (
    <div key={m.id} className="ibx-row">
      <div className="ibx-row-main">
        <span className="ibx-from">{m.fromName || m.fromAddress}</span>
        <button className="ibx-subject ibx-subject-btn" onClick={() => void openMessage(m)}>
          {m.subject}
        </button>
        {m.categories.map((c) => (
          <span key={c} className="ibx-category">{c}</span>
        ))}
        <span className="ibx-preview">{m.preview}</span>
      </div>
      <div className="ibx-row-side">
        <span className="ibx-date">{m.receivedAt ? formatIso(m.receivedAt.slice(0, 10)) : ''}</span>
        {replied[m.id] && <span className="ibx-filed">replied</span>}
        {drafted[m.id] !== undefined &&
          (drafted[m.id] ? (
            <a className="ibx-filed" href={drafted[m.id]} target="_blank" rel="noreferrer" title="Open the draft in Outlook">
              drafted · open in Outlook
            </a>
          ) : (
            <span className="ibx-filed">drafted</span>
          ))}
        <button className="btn" onClick={() => void openMessage(m)}>
          Open…
        </button>
        <button
          className="btn"
          onClick={() => { setReplyError(null); setReplyText(''); setReplying({ message: m, all: false }) }}
        >
          Reply…
        </button>
        <button
          className="btn"
          onClick={() => { setReplyError(null); setReplyText(''); setReplying({ message: m, all: true }) }}
        >
          Reply all…
        </button>
        {filed[m.id] ? (
          <span className="ibx-filed">filed · {filed[m.id]}</span>
        ) : (
          <button className="btn" onClick={() => { setFiling(m); setMode('create') }}>
            File…
          </button>
        )}
      </div>
    </div>
  )

  return (
    <section className="ibx" aria-label="Your inbox">
      <div className="ibx-head">
        <h3>Your inbox</h3>
        <span className="ibx-note">
          Read through your own sign-in, shown only to you, stored nowhere.
        </span>
        <span className="grow" />
        <button className="btn" onClick={() => { setComposeSent(false); setComposeError(null); setComposingNew(true) }}>
          Compose new…
        </button>
      </div>

      <div className="ibx-toolbar">
        <select
          aria-label="Folder"
          value={folderId}
          disabled={Boolean(activeQuery)}
          onChange={(e) => { setActiveQuery(''); setSearchBox(''); setFolderId(e.target.value) }}
        >
          {(folders?.length ? folders : [{ id: 'inbox', name: 'Inbox', unreadCount: 0 }]).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.unreadCount ? ` (${f.unreadCount})` : ''}
            </option>
          ))}
        </select>
        <input
          value={searchBox}
          onChange={(e) => setSearchBox(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setActiveQuery(searchBox.trim()) }}
          placeholder="Search your mail…"
          aria-label="Search your mail"
        />
        <button className="btn" onClick={() => setActiveQuery(searchBox.trim())} disabled={!searchBox.trim()}>
          Search
        </button>
        {activeQuery && (
          <button className="btn" onClick={() => { setActiveQuery(''); setSearchBox('') }}>
            Clear search
          </button>
        )}
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

      {messages?.length === 0 && !reconnect && messages !== null && (
        <p className="ibx-note">{activeQuery ? 'Nothing matches.' : 'Nothing in this folder.'}</p>
      )}

      {focusedMessages.length > 0 && otherMessages.length > 0 && <h4 className="ibx-section">Focused</h4>}
      {focusedMessages.map(messageRow)}
      {otherMessages.length > 0 && (
        <>
          {focusedMessages.length > 0 && <h4 className="ibx-section">Other</h4>}
          {otherMessages.map(messageRow)}
        </>
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

      {opened && (
        <div className="modal-scrim" role="dialog" aria-label="Message">
          <div className="modal ibx-open-modal">
            <div className="modal-head">
              <span>{opened.subject}</span>
              <button className="btn" onClick={() => { setOpened(null); setOpenedContent(null) }}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <p className="ibx-note">
                {opened.fromName || opened.fromAddress}
                {opened.receivedAt ? ` · ${formatIso(opened.receivedAt.slice(0, 10))}` : ''}
              </p>
              {openedBusy && <p className="ibx-note">Loading…</p>}
              {openedError && <p className="ibx-error">{openedError}</p>}
              {openedContent?.contentType === 'html' && (
                <iframe
                  className="ibx-open-frame"
                  title={opened.subject}
                  sandbox=""
                  srcDoc={openedContent.content}
                />
              )}
              {openedContent?.contentType === 'text' && (
                <pre className="ibx-open-text">{openedContent.content}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {replying && (
        <div className="modal-scrim" role="dialog" aria-label={replying.all ? 'Reply all' : 'Reply'}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <h3>{replying.all ? 'Reply all to' : 'Reply to'} “{replying.message.subject}”</h3>
            <p className="ibx-note">
              Sent from your own mailbox, as you — not recorded on any record. Or save it to your
              Outlook Drafts to finish later or schedule with Outlook&rsquo;s own Schedule send.
            </p>
            <textarea
              rows={6}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              aria-label="Reply text"
              placeholder="Sent as plain text, exactly as written here."
              readOnly={replyBusy}
            />
            {replyError && <p className="ov-gate">{replyError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" disabled={replyBusy} onClick={() => setReplying(null)}>
                Close
              </button>
              {/* Secondary on purpose: Send stays the dialog's one primary (F&O's one-primary
                  rule); a draft is the alternative outcome, not the ordinary next move. */}
              <button
                className="btn"
                disabled={replyBusy || !replyText.trim()}
                onClick={() => void submitReply('draft')}
                title="Leave the reply in your Outlook Drafts — finish it there, or use Outlook's Schedule send"
              >
                Save to Outlook Drafts
              </button>
              <button className="btn primary" disabled={replyBusy || !replyText.trim()} onClick={sendReply}>
                {replyBusy ? 'Working…' : replying.all ? 'Send to all' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {composingNew && (
        <div className="modal-scrim" role="dialog" aria-label="Compose new mail">
          <div className="modal" style={{ maxWidth: 520 }}>
            <h3>New message</h3>
            <p className="ibx-note">Sent from your own mailbox, as you.</p>
            {composeSent ? (
              <>
                <p className="ibx-note">Sent.</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="btn" onClick={() => setComposingNew(false)}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="cfg-fld">
                  <span>To</span>
                  <input
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    placeholder="name@client.com, name@axiocloudsolutions.com"
                    aria-label="Recipient email addresses, comma-separated"
                  />
                </label>
                <label className="cfg-fld">
                  <span>Subject</span>
                  <input
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    aria-label="Subject"
                  />
                </label>
                <textarea
                  rows={6}
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  aria-label="Message"
                  readOnly={composeBusy}
                />
                {composeError && <p className="ov-gate">{composeError}</p>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="btn" disabled={composeBusy} onClick={() => setComposingNew(false)}>
                    Close
                  </button>
                  <button
                    className="btn primary"
                    disabled={composeBusy || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}
                    onClick={sendCompose}
                  >
                    {composeBusy ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
