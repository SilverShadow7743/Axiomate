'use client'

import { useState } from 'react'
import { groupByConversation, type MailEntry } from '@/lib/discussion'
import type { WorkspaceState } from '@/lib/workspace'
import InboxPanel from './InboxPanel'

/**
 * What actually arrived — read-only. See the mail-log design: no triage, no reclassify, no reply
 * from here (that already exists, on the issue itself). This screen answers "what did we
 * receive," nothing more.
 *
 * E3 deepens the reading, not the machinery: rows sharing Exchange's conversationId group into
 * one exchange, newest exchange first; a row with no conversationId (the intake form writes
 * none) stays its own line rather than being threaded with strangers. `groupByConversation`
 * (lib/discussion.ts, scenario E3C) owns the rule.
 */
export default function MailLog({ state }: { state: WorkspaceState }) {
  const [query, setQuery] = useState('')
  const rows = Object.values(state.inboundMail).filter((m) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (
      m.subject.toLowerCase().includes(q) ||
      m.from.toLowerCase().includes(q) ||
      m.mailbox.toLowerCase().includes(q)
    )
  })
  const entries: MailEntry[] = rows.map((m) => ({
    kind: 'inbound',
    id: m.id,
    at: m.receivedAt,
    from: m.from,
    subject: m.subject,
    body: m.body,
    conversationId: m.conversationId,
  }))
  const byId = new Map(rows.map((m) => [m.id, m]))
  const conversations = groupByConversation(entries)

  return (
    <div className="view-dock">
      <InboxPanel state={state} />
      <section className="cfg-section">
        <h3 className="cfg-h">Mail log</h3>
        <p className="cfg-note">
          Every message intake has seen, accepted or refused, grouped by conversation. Read-only
          — a message that became an issue links to it; a refused one shows why.
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by subject, sender or mailbox"
          aria-label="Search the mail log"
        />
        {conversations.length === 0 ? (
          <p className="panel-note">
            {query.trim() ? 'Nothing matches.' : 'No mail has arrived yet.'}
          </p>
        ) : (
          <table className="cfg-table est-table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Mailbox</th>
                <th>From</th>
                <th>Subject</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((c, ci) =>
                c.entries.map((e, ei) => {
                  const m = byId.get(e.id)
                  if (!m) return null
                  return (
                    <tr key={e.id} className={ei > 0 ? 'mail-thread-row' : undefined}>
                      <td className="mono">
                        {/* A follow-up in the same exchange is indented under its opener. */}
                        {ei > 0 && <span className="prov">↳ </span>}
                        {m.receivedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="mono">{m.mailbox}</td>
                      <td>{m.from}</td>
                      <td>
                        {m.subject}
                        {ei === 0 && c.entries.length > 1 && (
                          <span className="prov"> · {c.entries.length} in this exchange</span>
                        )}
                      </td>
                      <td>
                        {m.issueId ? (
                          <span className="cfg-chip">{m.issueId}</span>
                        ) : (
                          <span className="prov" title={m.refusalReason ?? ''}>
                            Refused — {m.refusalReason}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
