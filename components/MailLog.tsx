'use client'

import { useState } from 'react'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * What actually arrived — read-only. See the mail-log design: no triage, no reclassify, no reply
 * from here (that already exists, on the issue itself). This screen answers "what did we
 * receive," nothing more.
 *
 * A first-class nav view rather than a corner of Configuration — it was first built as a section
 * inside the Automation tab, which meant reaching it required opening Configuration and knowing
 * to look there. Nothing about it needs config.manage: it is org-wide readable, the same class
 * of fact `internal.view` already covers, and Configuration's own gate has nothing to do with it.
 */
export default function MailLog({ state }: { state: WorkspaceState }) {
  const [query, setQuery] = useState('')
  const entries = Object.values(state.inboundMail)
    .filter((m) => {
      if (!query.trim()) return true
      const q = query.trim().toLowerCase()
      return (
        m.subject.toLowerCase().includes(q) ||
        m.from.toLowerCase().includes(q) ||
        m.mailbox.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))

  return (
    <div className="view-dock">
      <section className="cfg-section">
        <h3 className="cfg-h">Mail log</h3>
        <p className="cfg-note">
          Every message intake has seen, accepted or refused. Read-only — a message that became an
          issue links to it; a refused one shows why.
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by subject, sender or mailbox"
          aria-label="Search the mail log"
        />
        {entries.length === 0 ? (
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
              {entries.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.receivedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="mono">{m.mailbox}</td>
                  <td>{m.from}</td>
                  <td>{m.subject}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
