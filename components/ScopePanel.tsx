'use client'

import type { ScheduleRow } from '@/lib/types'
import type { WorkspaceState } from '@/lib/workspace'
import {
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_TYPES,
  recordedCount,
  summariseScope,
  unassignedUnder,
  type EngagementDetail,
} from '@/lib/engagement'
import { formatIso } from '@/lib/dates'
import { isExternalPartyKind, tiersOf } from '@/lib/config'
import { useLabels } from './labels'

/**
 * What a client or engagement row shows.
 *
 * The split down the middle is the point.
 *
 * On the left: what somebody recorded. Where nobody has, it says "Not recorded" rather than a
 * blank that could be read as a value or a plausible name that could be read as a fact. The
 * issue log records issues, not contracts — there was nothing to import, so every field here
 * started empty and stays empty until someone who knows fills it in.
 *
 * On the right: what the log actually proves. Counts, spans, process areas, parties, status
 * spread — all recomputed on every render and never stored, so they cannot drift from the
 * issues they describe. This is the same rule that keeps `duration` and `scheduleHealth` out
 * of the database.
 */
export default function ScopePanel({
  row,
  state,
  onUpdateEngagement,
}: {
  row: ScheduleRow
  state: WorkspaceState
  onUpdateEngagement: (nodeId: string, patch: Partial<EngagementDetail>) => void
}) {
  const labels = useLabels()
  const isEngagement = row.kind === 'engagement'
  const detail = state.engagements[row.id] ?? null
  const scope = summariseScope(state, row.id)
  // An external party's node (by flag) is where unattributed work rolls up, whatever the
  // organisation calls that tier.
  const isParty = isExternalPartyKind(tiersOf(state.model), row.kind)
  const unassigned = isParty ? unassignedUnder(state, row.id) : 0
  const done = detail ? recordedCount(detail) : { filled: 0, total: 0 }

  const set = (patch: Partial<EngagementDetail>) => onUpdateEngagement(row.id, patch)

  return (
    <div className="cols-2">
      <div>
        <h4 className="scope-h">
          {isEngagement ? 'Engagement record' : `${labels.TIER_ORGANIZATION} record`}
          {isEngagement && (
            <span className="scope-count">
              {done.filled} of {done.total} recorded
            </span>
          )}
        </h4>

        {!isEngagement ? (
          <p className="scope-note">
            {row.name} is a {labels.TIER_ORGANIZATION.toLowerCase()}. Commercial and delivery
            details are recorded against an {labels.TIER_ENGAGEMENT.toLowerCase()} beneath it.
          </p>
        ) : !detail ? (
          <p className="scope-note">No record exists for this engagement yet.</p>
        ) : (
          <>
            <p className="scope-note">
              None of this comes from the issue log — the log records issues, not contracts.
            </p>
            <dl className="kv">
              <dt>Code</dt>
              <dd>
                <input
                  className="resp-input"
                  defaultValue={detail.code}
                  placeholder="Not recorded"
                  onBlur={(e) => e.target.value !== detail.code && set({ code: e.target.value })}
                />
              </dd>
              <dt>Type</dt>
              <dd>
                <select
                  className="resp-input"
                  value={detail.type}
                  onChange={(e) => set({ type: e.target.value as EngagementDetail['type'] })}
                >
                  <option value="">Not recorded</option>
                  {ENGAGEMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>Status</dt>
              <dd>
                <select
                  className="resp-input"
                  value={detail.status}
                  onChange={(e) => set({ status: e.target.value as EngagementDetail['status'] })}
                >
                  <option value="">Not recorded</option>
                  {ENGAGEMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>Start</dt>
              <dd>
                <input
                  className="resp-input"
                  type="date"
                  defaultValue={detail.startDate ?? ''}
                  onBlur={(e) => set({ startDate: e.target.value || null })}
                />
              </dd>
              <dt>End</dt>
              <dd>
                <input
                  className="resp-input"
                  type="date"
                  defaultValue={detail.endDate ?? ''}
                  onBlur={(e) => set({ endDate: e.target.value || null })}
                />
              </dd>
              <dt>Engagement leader</dt>
              <dd>
                <input
                  className="resp-input"
                  defaultValue={detail.engagementLeader}
                  placeholder="Not recorded"
                  onBlur={(e) =>
                    e.target.value !== detail.engagementLeader &&
                    set({ engagementLeader: e.target.value })
                  }
                />
              </dd>
              <dt>Project manager</dt>
              <dd>
                <input
                  className="resp-input"
                  defaultValue={detail.projectManager}
                  placeholder="Not recorded"
                  onBlur={(e) =>
                    e.target.value !== detail.projectManager &&
                    set({ projectManager: e.target.value })
                  }
                />
              </dd>
              <dt>Client sponsor</dt>
              <dd>
                <input
                  className="resp-input"
                  defaultValue={detail.clientSponsor}
                  placeholder="Not recorded"
                  onBlur={(e) =>
                    e.target.value !== detail.clientSponsor && set({ clientSponsor: e.target.value })
                  }
                />
              </dd>
              <dt>SOW reference</dt>
              <dd>
                <input
                  className="resp-input"
                  defaultValue={detail.sowReference}
                  placeholder="Not recorded"
                  onBlur={(e) =>
                    e.target.value !== detail.sowReference && set({ sowReference: e.target.value })
                  }
                />
              </dd>
            </dl>
            {detail.updatedAt && (
              <p className="scope-note">
                Last recorded {formatIso(detail.updatedAt.slice(0, 10))} by {detail.updatedBy}.
              </p>
            )}
          </>
        )}
      </div>

      <div>
        <h4 className="scope-h">
          From the issue log
          <span className="scope-count">derived, never stored</span>
        </h4>

        {scope.issues === 0 ? (
          <p className="scope-note">
            Nothing is assigned to this {row.kind} yet.
            {isEngagement &&
              ` The log says which ${labels.TIER_ORGANIZATION.toLowerCase()} an issue belongs to and never which ${labels.TIER_ENGAGEMENT.toLowerCase()}, so assigning scope is a decision for someone who knows it — use Move on a ${labels.TIER_MODULE.toLowerCase()}.`}
          </p>
        ) : (
          <dl className="kv">
            <dt>{labels.RECORD_ISSUE}s</dt>
            <dd>
              {scope.issues} · {scope.open} open · {scope.closed} closed
            </dd>
            <dt>Activity span</dt>
            <dd className="mono">
              {scope.firstRaised ? formatIso(scope.firstRaised) : '—'} →{' '}
              {scope.lastActivity ? formatIso(scope.lastActivity) : '—'}
            </dd>
            <dt>{labels.TIER_MODULE}s</dt>
            <dd>
              {scope.processAreas.length} — {scope.processAreas.join(', ')}
            </dd>
            <dt>{labels.ISSUE_OWNER}s</dt>
            <dd>{scope.owners}</dd>
            <dt>{labels.ISSUE_ACCOUNTABLE}</dt>
            <dd>{scope.parties.join(', ') || '—'}</dd>
            <dt>{labels.FIELD_STATUS}</dt>
            <dd className="scope-stats">
              {scope.statusCounts.map((s) => (
                <span key={s.status} className="scope-stat">
                  {s.status} <b>{s.count}</b>
                </span>
              ))}
            </dd>
          </dl>
        )}

        {isParty && unassigned > 0 && (
          <p className="scope-note">
            {unassigned} of these sit directly under the {labels.TIER_ORGANIZATION.toLowerCase()},
            not under any {labels.TIER_ENGAGEMENT.toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  )
}
