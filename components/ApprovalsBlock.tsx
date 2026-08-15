'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can, rolesFor } from '@/lib/access'
import {
  approvalsFor,
  describeApproval,
  rulesFor,
  type ApprovalDecision,
} from '@/lib/approval'
import type { IssueRecord, WorkspaceState } from '@/lib/workspace'
import { ISSUE_STATUSES } from '@/lib/types'
import { formatIso } from '@/lib/dates'

/**
 * What this record is waiting on somebody to decide.
 *
 * Sits under the status field rather than on a tab of its own, because an approval here is
 * never an abstract fact — it is the reason a particular move is blocked, and the person
 * looking at a status they cannot select needs the explanation in the same glance.
 *
 * The block shows three things a reader needs and one they do not get: what has been asked,
 * what was decided and by whom, and which moves are currently gated. What it does not offer is
 * a way to approve your own request — that control is absent rather than disabled, because a
 * greyed button invites somebody to look for the way around it.
 */
export default function ApprovalsBlock({
  issue,
  state,
  actor,
  onRequest,
  onDecide,
}: {
  issue: IssueRecord
  state: WorkspaceState
  actor: Actor
  onRequest: (ruleId: string, note: string) => void
  onDecide: (id: string, decision: ApprovalDecision, note: string) => void
}) {
  const approvals = useMemo(
    () => approvalsFor(state.approvals, issue.id),
    [state.approvals, issue.id],
  )

  /** Every rule that could ever gate this record, whichever status it is heading for. */
  const applicable = useMemo(
    () => ISSUE_STATUSES.flatMap((s) => rulesFor(state.model.approvalRules, issue.type, s)),
    [state.model.approvalRules, issue.type],
  )

  const held = useMemo(() => rolesFor(state.model, actor), [state.model, actor])
  const mayRequest = can(state.model, actor, 'approval.request')
  const mayDecide = can(state.model, actor, 'approval.decide')

  const [note, setNote] = useState('')
  const [deciding, setDeciding] = useState<string | null>(null)
  const [decisionNote, setDecisionNote] = useState('')

  if (!applicable.length && !approvals.length) return null

  return (
    <section className="appr-block">
      <h4 className="est-h">Approvals</h4>

      {applicable.map((rule) => {
        const mine = approvals.filter((a) => a.ruleId === rule.id)
        const open = mine.find((a) => !a.decision)
        const settled = mine.find((a) => a.decision)
        const canDecideThis =
          mayDecide.allowed &&
          (!rule.deciderRoleIds.length || rule.deciderRoleIds.some((r) => held.includes(r)))

        return (
          <div className="appr-rule" key={rule.id}>
            <div className="appr-head">
              <span className="appr-label">{rule.label}</span>
              <span className="prov">
                gates “{rule.status}” ·{' '}
                {rule.deciderRoleIds.length
                  ? rule.deciderRoleIds.map((r) => state.model.roles[r]?.label ?? r).join(' or ')
                  : 'nobody'}
              </span>
            </div>
            <p className="appr-question">{rule.question}</p>

            {mine.map((a) => (
              <div className={`appr-entry appr-${a.decision ?? 'open'}`} key={a.id}>
                <div>
                  <b>{describeApproval(a)}</b>
                  {a.note && <span className="prov"> · asked: {a.note}</span>}
                  {a.decisionNote && <span className="prov"> · {a.decisionNote}</span>}
                </div>
                <div className="prov">{formatIso(a.requestedAt.slice(0, 10))}</div>

                {!a.decision && canDecideThis && a.requestedBy !== actor.name && (
                  <div className="appr-decide">
                    {deciding === a.id ? (
                      <>
                        <input
                          value={decisionNote}
                          placeholder="A note on the decision — kept on the record"
                          onChange={(e) => setDecisionNote(e.target.value)}
                          aria-label="Decision note"
                        />
                        <button
                          className="btn primary"
                          onClick={() => {
                            onDecide(a.id, 'approved', decisionNote)
                            setDeciding(null)
                            setDecisionNote('')
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            onDecide(a.id, 'rejected', decisionNote)
                            setDeciding(null)
                            setDecisionNote('')
                          }}
                        >
                          Reject
                        </button>
                        <button className="btn-link" onClick={() => setDeciding(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="btn" onClick={() => setDeciding(a.id)}>
                        Decide
                      </button>
                    )}
                  </div>
                )}

                {!a.decision && a.requestedBy === actor.name && (
                  <p className="prov">
                    You asked for this, so somebody else has to answer it.
                  </p>
                )}
              </div>
            ))}

            {!open && (
              <div className="appr-request">
                {settled && settled.decision === 'rejected' && (
                  <p className="prov">
                    Rejected once. Asking again is allowed — the refusal stays on the record, so
                    a reader can see the change was declined rather than never considered.
                  </p>
                )}
                {mayRequest.allowed ? (
                  <>
                    <input
                      value={note}
                      placeholder="What are you asking them to agree to?"
                      onChange={(e) => setNote(e.target.value)}
                      aria-label={`Note for ${rule.label}`}
                    />
                    <button
                      className="btn"
                      onClick={() => {
                        onRequest(rule.id, note)
                        setNote('')
                      }}
                    >
                      Ask for approval
                    </button>
                  </>
                ) : (
                  <p className="prov">{mayRequest.reason}</p>
                )}
              </div>
            )}
          </div>
        )
      })}

      {approvals
        .filter((a) => !applicable.some((r) => r.id === a.ruleId))
        .map((a) => (
          <div className="appr-entry" key={a.id}>
            <b>{describeApproval(a)}</b>
            <span className="prov">
              {' '}
              · under a rule that no longer applies to this record. Kept, because it happened.
            </span>
          </div>
        ))}
    </section>
  )
}
