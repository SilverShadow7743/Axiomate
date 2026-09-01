import 'server-only'
import type { WorkspaceState } from '../workspace'
import type { AuditEntry } from '../types'
import { currentActor } from '../identity'
import type { ReportDeliveryConfig } from './delivery'
import { resolutionNotices, type ResolutionNotice } from './resolutionNotice'

/**
 * The env-dependent half of the resolution notice — split from `./resolutionNotice.ts` because
 * `currentActor()` needs `lib/identity.ts`, which is genuinely server-only, and importing it
 * anywhere `resolutionNotices()` also lives would drag that requirement into the scenario harness
 * that drives `resolutionNotices()` directly. See that file's own header for why.
 */

/**
 * The same expression `lib/db/schedule.ts` used inline for the client-pack destination — one
 * copy, shared, not two.
 */
export function resolveOperatorAddress(state: WorkspaceState, config: ReportDeliveryConfig): string | null {
  return (
    config.packDestination ||
    Object.values(state.model.people).find(
      (p) => p.name.trim().toLowerCase() === currentActor().name.trim().toLowerCase() && p.email,
    )?.email ||
    null
  )
}

export interface NotifyBundle {
  notices: ResolutionNotice[]
  /** The address to send AS — the first enabled intake mailbox. */
  mailbox: string
  /** The address to send TO — an internal reviewer, never the client directly. */
  dest: string
}

/** Everything the caller needs to actually send, or null when any part of that isn't ready. */
export function notifyBundle(state: WorkspaceState, newAudit: AuditEntry[]): NotifyBundle | null {
  if (!state.model.reportDelivery.resolutionNoticeEnabled) return null
  const notices = resolutionNotices(state, newAudit)
  if (!notices.length) return null
  const mailbox = state.model.intake.find((m) => m.enabled)?.address
  if (!mailbox) return null
  const dest = resolveOperatorAddress(state, state.model.reportDelivery)
  if (!dest) return null
  return { notices, mailbox, dest }
}
