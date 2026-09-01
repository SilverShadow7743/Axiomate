import type { WorkspaceState } from '../workspace'
import { scopeChainOf } from '../workspace'
import type { AuditEntry } from '../types'

/**
 * An internal prompt that a status change owes the client a reply — never the reply itself.
 *
 * `sendAsMailbox` is called from exactly two places today: a user-composed reply, and the
 * scheduled batch pass. This is the first live-triggered send tied to a state transition, and it
 * follows the client-pack feature's own caution (`lib/reports/clientPack.ts`): the message
 * reaches an internal reviewer, never the client directly. See
 * `docs/plans/2026-09-01-resolution-notice-design.md`.
 *
 * Pure on purpose, and kept in its own file for it: `resolutionNotices` has no clock, no I/O and
 * no environment read, so it is driven directly by scenario RN1 — including by `scripts/
 * scenario-validation.ts` itself, a plain Node script. `lib/identity.ts`'s `currentActor()`
 * carries `import 'server-only'`, which throws unconditionally outside a bundler-aware context,
 * not just when actually bundled for the browser — so anything that needs it (see
 * `./notifyBundle.ts`) has to live somewhere this file never imports, or the scenario script
 * itself fails at import time. Found by running the gate, not by guessing.
 */

export interface ResolutionNotice {
  /** == IssueRecord.id, already the display string (e.g. `OAPIL-42`) — see lib/tree.ts:122. */
  issueId: string
  subject: string
  clientName: string
  /** A directory contact who might be the one to tell, when one resolves. Never guessed. */
  suggestedContact: string | null
}

/** The `'client'` ancestor of a record, or null — the same shape as `projectOf` in workspace.ts. */
function clientNodeOf(state: WorkspaceState, id: string): string | null {
  for (const scopeId of scopeChainOf(state, id)) {
    if (state.nodes[scopeId]?.kind === 'client') return scopeId
  }
  return null
}

/**
 * Which issues just moved to `Awaiting client confirmation`, read off this request's own new
 * audit rows — `updateIssue`'s per-field diff loop already writes `{ field: 'status', to, rowId }`
 * for exactly this transition, so no new audit convention is needed here.
 */
export function resolutionNotices(state: WorkspaceState, newAudit: AuditEntry[]): ResolutionNotice[] {
  const out: ResolutionNotice[] = []
  for (const entry of newAudit) {
    if (entry.field !== 'status' || entry.to !== 'Awaiting client confirmation') continue
    const issue = state.issues[entry.rowId]
    if (!issue || issue.deletedAt) continue
    const clientId = clientNodeOf(state, issue.id)
    if (!clientId) continue
    const client = state.nodes[clientId]
    const contact = Object.values(state.model.people).find(
      (p) =>
        p.clientScopeId === clientId &&
        p.email &&
        p.roleIds.some((r) => r === 'ROLE_CLIENT_SPONSOR' || r === 'ROLE_CLIENT_LEAD' || r === 'ROLE_CLIENT_USER'),
    )
    out.push({
      issueId: issue.id,
      subject: issue.subject,
      clientName: client?.name ?? clientId,
      suggestedContact: contact?.email ?? null,
    })
  }
  return out
}
