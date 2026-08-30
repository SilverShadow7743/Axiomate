'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { directoryPersonFor } from '@/lib/access'
import { issueMailTimeline, type DiscussionMessage, type DiscussionScopeKind } from '@/lib/discussion'
import { mentionSegments } from '@/lib/mentions'
import { richTextToPlainText } from '@/lib/richText'
import { formatIso } from '@/lib/dates'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * One scope's discussion — E3's server-queried surface. Everything here is fetched, never
 * boot-shipped: the thread loads when the tab opens, refreshes on a ~15s tick while it stays
 * mounted, and a send round-trips through /api/discussion. The refresh REPLACES the list only
 * after a successful fetch and never touches the compose box or the follow toggle's local
 * intent — a failed poll leaves what is rendered standing, with a quiet note.
 *
 * The same component serves an issue's thread and a project's; the mail exchange section is
 * the one issue-only extra (mail deepened — the record's inbound rows and recorded outbound
 * reply notes as one timeline, read-only).
 */

const POLL_MS = 15000

interface View {
  thread: { id: string } | null
  messages: DiscussionMessage[]
  following: boolean
  followerCount: number
}

export default function DiscussionTab({
  state,
  actor,
  scopeKind,
  scopeId,
  ownerName,
}: {
  state: WorkspaceState
  actor: Actor
  scopeKind: DiscussionScopeKind
  scopeId: string
  /** The record owner's name on issue scope — the birth auto-follow needs it server-side. */
  ownerName?: string | null
}) {
  const meId = directoryPersonFor(state.model, actor)?.id ?? null
  const [view, setView] = useState<View | null>(null)
  const [stale, setStale] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/discussion?scopeKind=${encodeURIComponent(scopeKind)}&scopeId=${encodeURIComponent(scopeId)}`,
        { cache: 'no-store' },
      )
      const data = (await res.json()) as { ok?: boolean; error?: string } & View
      if (!alive.current) return
      if (!res.ok || !data.ok) {
        setProblem(data.error ?? 'The discussion could not be read.')
        return
      }
      setProblem(null)
      setStale(false)
      setView({ thread: data.thread, messages: data.messages, following: data.following, followerCount: data.followerCount })
    } catch {
      if (alive.current) setStale(true)
    }
  }, [scopeKind, scopeId])

  useEffect(() => {
    alive.current = true
    setView(null)
    setProblem(null)
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => {
      alive.current = false
      clearInterval(t)
    }
  }, [refresh])

  const post = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/discussion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'post', scopeKind, scopeId, text, ownerName: ownerName ?? undefined }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!data.ok) {
        // The draft stays in the box — a failed send is not a lost thought.
        setProblem(data.error ?? 'The message was not sent.')
        return
      }
      setDraft('')
      setProblem(null)
      await refresh()
    } finally {
      setSending(false)
    }
  }

  const setFollowing = async (follow: boolean) => {
    const res = await fetch('/api/discussion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: follow ? 'follow' : 'unfollow', scopeKind, scopeId }),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (data.ok) await refresh()
    else setProblem(data.error ?? 'The follow could not be changed.')
  }

  const remove = async (messageId: string) => {
    const res = await fetch('/api/discussion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'remove', messageId }),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (data.ok) await refresh()
    else setProblem(data.error ?? 'The message could not be removed.')
  }

  const people = Object.values(state.model.people).map((p) => ({ id: p.id, name: p.name }))
  const mine = (m: DiscussionMessage) =>
    m.authorId ? m.authorId === meId : m.author.trim().toLowerCase() === actor.name.trim().toLowerCase()

  const mail =
    scopeKind === 'issue'
      ? issueMailTimeline(
          Object.values(state.inboundMail),
          Object.values(state.notes).map((n) => ({
            id: n.id,
            issueId: n.issueId,
            noteType: n.noteType,
            plainText: richTextToPlainText(n.body),
            createdAt: n.createdAt,
          })),
          scopeId,
        )
      : []

  return (
    <div className="discussion">
      <div className="ts-week-bar">
        <b>Discussion</b>
        <span className="prov">
          internal — clients never see this
          {view && view.followerCount > 0 && ` · ${view.followerCount} following`}
        </span>
        <span className="grow" />
        {stale && <span className="prov">refresh failed — showing what was loaded</span>}
        {view && view.thread && meId && (
          <button className="btn ghost" onClick={() => setFollowing(!view.following)}>
            {view.following ? 'Unfollow' : 'Follow'}
          </button>
        )}
      </div>

      {problem && <p className="panel-note warn">{problem}</p>}

      {!view ? (
        <p className="prov">Loading…</p>
      ) : !view.thread ? (
        <p className="panel-note">
          Nothing has been said here yet. The first message starts the thread — whoever posts
          follows it, {scopeKind === 'issue' ? 'and so does the record’s owner' : 'and others can join'}.
        </p>
      ) : (
        <ul className="inbox-list">
          {view.messages.map((m) => (
            <li key={m.id}>
              <div className="board-card">
                <span className="prov">
                  <b>{m.author}</b> · {formatIso(m.createdAt.slice(0, 10))}{' '}
                  {m.createdAt.slice(11, 16)}
                  {!m.deletedAt && mine(m) && (
                    <>
                      {' · '}
                      <button className="btn-link" onClick={() => remove(m.id)}>
                        Remove
                      </button>
                    </>
                  )}
                </span>
                <span className="inbox-body">
                  {m.deletedAt ? (
                    <i className="prov">removed</i>
                  ) : (
                    mentionSegments(m.body, people).map((s, i) =>
                      s.kind === 'mention' ? (
                        <b key={i} className="mention">{s.text}</b>
                      ) : (
                        <span key={i}>{s.text}</span>
                      ),
                    )
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="time-row">
        <input
          className="fld-input grow"
          placeholder={`Message this ${scopeKind === 'issue' ? 'record' : 'project'}’s discussion — @name to summon somebody`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void post()
            }
          }}
        />
        <button className="btn primary" disabled={!draft.trim() || sending} onClick={() => void post()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {scopeKind === 'issue' && mail.length > 0 && (
        <div className="discussion-mail">
          <div className="ts-week-bar">
            <b>Mail with the client</b>
            <span className="prov">
              {mail.length} message{mail.length === 1 ? '' : 's'} · read-only — replies are sent
              from the Notes tab
            </span>
          </div>
          {mail.map((e) => (
            <div key={e.id} className="board-card">
              <span className="prov">
                {e.kind === 'inbound' ? `From ${e.from}` : e.from} ·{' '}
                {formatIso(e.at.slice(0, 10))} · {e.subject}
              </span>
              <span className="inbox-body">{e.body.length > 400 ? `${e.body.slice(0, 397)}…` : e.body}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
