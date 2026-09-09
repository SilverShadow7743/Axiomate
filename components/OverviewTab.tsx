'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can, directoryIdByName, isUnresolvedOwnerName } from '@/lib/access'
import { ownerLeaveCaveat } from '@/lib/availability'
import { canEditIssue } from '@/lib/permissions'
import { isOutboundRefusal, sendingMailboxFor } from '@/lib/outbound'
import type { IssueNote } from '@/lib/notes'
import { ISSUE_STATUSES, type IssueStatus, type ScheduleRow, type Severity } from '@/lib/types'
import { allowedNext } from '@/lib/statusPolicy'
import { blockingRule } from '@/lib/approval'
import type { ApprovalDecision } from '@/lib/approval'
import ApprovalsBlock from './ApprovalsBlock'
import { liveWorkTypes } from '@/lib/config'
import { classificationsOf } from '@/lib/tree'
import { moduleOf, projectOf, type IssueRecord, type WorkspaceState } from '@/lib/workspace'
import { exposure, raidKindOf, RAID_SCALE_MAX } from '@/lib/raid'
import { formatIso } from '@/lib/dates'
import { useLabels } from './labels'
import { isEmptyRichDoc, richDocsEqual, type RichDoc } from '@/lib/richText'
import RichTextEditor from './RichTextEditor'
import {
  KIND_ICON,
  KIND_LABEL,
  detectSourceDocument,
  latestOf,
  tallyByKind,
  type EvidenceKind,
} from '@/lib/evidence'

/**
 * The current state of an issue, and where it is changed.
 *
 * This was a read-only summary with a separate full-page editor behind it, which meant the
 * commonest action in a delivery tool — read a row, change one field, move on — cost a screen
 * transition each way and lost the surrounding context every time.
 *
 * Two things it deliberately does not do:
 *
 *  - **Save on blur.** The rest of this panel commits per field, which is right for a single
 *    cell but wrong here: an explicit Save is what makes Cancel meaningful, and a form of
 *    twelve fields that writes as you tab through it cannot be abandoned.
 *  - **Edit what the tree owns.** Client and Process Area are read-only below. They are not
 *    stored opinions, they are where the record *sits*; the reducer keeps them in step with
 *    the record's position on Move. A text box here would let an issue claim OAPIL while
 *    living under SLG, and nothing would notice.
 */

export interface IssueDraft {
  subject: string
  /** The classification label — Process Area during the container-to-label transition. */
  module: string
  description: RichDoc
  type: string
  status: IssueStatus
  severity: Severity
  owner: string
  accountable: string
  nextAction: string
  plannedStart: string
  plannedEnd: string
  /** A decision's recorded outcome — meaningful on Decision-typed records. */
  decisionOutcome: string
  /** A person's manual figure, overriding whatever the schedule would otherwise derive. */
  percentOverride: number | null
}

/**
 * `moduleDefault` is the nearest `module`-ancestor's name, shown when the record carries no
 * label of its own yet — an issue imported before the container-to-label transition (E0 step
 * 8b). Shown, never silently stored: it only becomes the saved value if Save is pressed with it
 * still showing, exactly as the field's own hint already implies.
 */
function draftOf(i: IssueRecord, moduleDefault: string | null): IssueDraft {
  return {
    subject: i.subject,
    module: i.module || moduleDefault || '',
    description: i.description,
    type: i.type,
    status: i.status,
    severity: i.severity,
    owner: i.owner,
    accountable: i.accountable,
    nextAction: i.nextAction,
    plannedStart: i.plannedStart ?? '',
    plannedEnd: i.plannedEnd ?? '',
    decisionOutcome: i.decisionOutcome ?? '',
    percentOverride: i.percentOverride,
  }
}

export default function OverviewTab({
  row,
  issue,
  state,
  today,
  actor,
  customResponsibilities,
  onSetAssignment,
  onSave,
  onDirtyChange,
  onRequestApproval,
  onDecideApproval,
  onMailSent,
  mailEnabled,
  editing,
  setEditing,
  onUploadImage,
  onManageEvidence,
  onMove,
}: {
  row: ScheduleRow
  issue: NonNullable<ScheduleRow['issue']>
  state: WorkspaceState
  today: string
  actor: Actor
  customResponsibilities: { id: string; label: string; requiredHere: boolean; values: string[] }[]
  onSetAssignment: (responsibilityId: string, values: string[]) => void
  onSave: (
    patch: Partial<IssueRecord>,
    dates: { start: string; end: string } | null,
    reason?: string,
  ) => boolean
  onDirtyChange: (dirty: boolean) => void
  onRequestApproval: (ruleId: string, note: string) => void
  onDecideApproval: (id: string, decision: ApprovalDecision, note: string) => void
  /** A reply the server sent and recorded — merged into this browser's copy, never re-dispatched. */
  onMailSent: (note: IssueNote) => void
  /** False when no database backs the workspace — a send that can never be recorded is not offered. */
  mailEnabled: boolean
  editing: boolean
  setEditing: (v: boolean) => void
  onUploadImage: (file: File) => Promise<{ documentId: string; alt: string } | null>
  /** Opens the evidence manager; kept out of this form so it stays a form. */
  onManageEvidence: (issueId: string) => void
  /** Opens the Move dialog for this record. Optional so callers that have not been updated
   *  still compile — the hint text next to Process Area is the only thing that needs it. */
  onMove?: () => void
}) {
  const labels = useLabels()
  const record = state.issues[issue.id]
  const may = canEditIssue(state.model, actor)
  const workTypes = useMemo(() => liveWorkTypes(state.model).map((t) => t.label), [state.model])
  /** `issue.type` is the stored value — an id on older/discovered records, a label on records
   *  created since (`upsertIssue`'s `type` write already uses the label). Resolving both
   *  through the same map means the read-only display never shows a raw `WT_*` code, whichever
   *  shape this particular record happens to carry. */
  const workTypeLabelById = useMemo(
    () => new Map(liveWorkTypes(state.model).map((t) => [t.id, t.label])),
    [state.model],
  )
  const displayType = workTypeLabelById.get(issue.type) ?? issue.type
  const classifications = useMemo(() => classificationsOf(state), [state])
  const rtePeople = useMemo(
    () => Object.values(state.model.people).map((p) => ({ id: p.id, name: p.name })),
    [state.model.people],
  )
  const rteIssues = useMemo(
    () => Object.values(state.issues).map((i) => ({ id: i.id, subject: i.subject, status: i.status })),
    [state.issues],
  )
  /** A visible caveat beside the due date when the owner is on approved leave inside the
   *  window — never a rewrite of the date itself. See
   *  docs/plans/2026-09-08-leave-aware-due-date-design.md. */
  const leaveCaveat = useMemo(() => {
    if (!row.plannedEndDate) return null
    const ownerId = directoryIdByName(state.model, issue.owner)
    return ownerLeaveCaveat(ownerId, Object.values(state.commitments), today, row.plannedEndDate)
  }, [state.model, state.commitments, issue.owner, today, row.plannedEndDate])
  const moduleDefault = useMemo(() => moduleOf(state, issue.id), [state, issue.id])
  const projectId = useMemo(() => projectOf(state, issue.id), [state, issue.id])
  /** Suggestions for Owner — who this issue's project actually has staffed, per `ProjectMember`.
   *  A datalist, not a hard `<select>`: staffing is sparse today, and an owner already recorded
   *  who is not (yet) a formal member must still show and stay editable. */
  const projectMembers = useMemo(
    () =>
      projectId
        ? Object.values(state.projectMembers).filter((m) => m.projectId === projectId && !m.removedAt)
        : [],
    [state.projectMembers, projectId],
  )
  const [draft, setDraft] = useState<IssueDraft>(() =>
    record ? draftOf(record, moduleDefault) : draftOf(issue as IssueRecord, moduleDefault),
  )
  /** Held outside the draft: it explains a change rather than being part of the record. */
  const [reason, setReason] = useState('')
  /** Against the WHOLE directory, not just `projectMembers` above — plenty of valid owners
   *  (a functional lead, a client contact) are real people who simply are not staffed to this
   *  particular project, and must never be flagged as though they were a typo. */
  const ownerMismatch = useMemo(
    () => isUnresolvedOwnerName(state.model, draft.owner),
    [state.model, draft.owner],
  )

  const policy = state.model.statusPolicy
  const current = record?.status ?? issue.status
  const routes = useMemo(() => allowedNext(policy, current), [policy, current])
  /** What the graph rules out from here — shown, so the absence is explained rather than odd. */
  const blocked = useMemo(
    () => ISSUE_STATUSES.filter((s) => !routes.includes(s)),
    [routes],
  )
  const movingTo = draft.status !== current ? draft.status : null
  const needsReason = Boolean(movingTo && policy.enforced && policy.requireReason.includes(movingTo))
  const needsEvidence = Boolean(
    movingTo &&
      policy.enforced &&
      policy.requireEvidence.includes(movingTo) &&
      !Object.values(state.evidence).some((e) => e.issueId === issue.id && !e.deletedAt),
  )

  // Re-seed when the underlying record changes identity or is saved from elsewhere. Keyed on
  // the id so switching issues never carries one record's draft onto another.
  useEffect(() => {
    if (record && !editing) setDraft(draftOf(record, moduleDefault))
  }, [record, editing, issue.id, moduleDefault])

  const dirty = useMemo(() => {
    if (!record) return false
    const base = draftOf(record, moduleDefault)
    return (Object.keys(base) as (keyof IssueDraft)[]).some((k) =>
      k === 'description' ? !richDocsEqual(base.description, draft.description) : base[k] !== draft[k],
    )
  }, [record, draft, moduleDefault])

  // The unsaved-work signal lives below the compose state it also reads — see after sendMail.

  const set = <K extends keyof IssueDraft>(k: K, v: IssueDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const cancel = () => {
    if (record) setDraft(draftOf(record, moduleDefault))
    setReason('')
    setEditing(false)
  }

  const save = () => {
    if (!record) return
    const base = draftOf(record, moduleDefault)
    const patch: Partial<IssueRecord> = {}
    for (const k of Object.keys(base) as (keyof IssueDraft)[]) {
      if (k === 'plannedStart' || k === 'plannedEnd') continue
      // `description` is IssueDraft's one non-primitive field — compared and copied by
      // content, never by the generic `!==`/cast below, so a structurally-unchanged RichDoc
      // (a fresh object from the same edit) is never mistaken for a real change.
      if (k === 'description') {
        if (!richDocsEqual(base.description, draft.description)) patch.description = draft.description
        continue
      }
      if (base[k] !== draft[k]) {
        // An emptied outcome is "no outcome recorded", which is null — not the empty string.
        ;(patch as Record<string, unknown>)[k] =
          k === 'decisionOutcome' && draft[k] === '' ? null : draft[k]
      }
    }
    // Dates go through their own action so the schedule's validation and reason-tracking
    // apply — writing them as plain fields would bypass both.
    const datesChanged =
      base.plannedStart !== draft.plannedStart || base.plannedEnd !== draft.plannedEnd
    const dates =
      datesChanged && draft.plannedStart && draft.plannedEnd
        ? { start: draft.plannedStart, end: draft.plannedEnd }
        : null
    if (onSave(patch, dates, reason.trim() || undefined)) {
      setReason('')
      setEditing(false)
    }
  }

  /* ---------------- reply to client ---------------- */

  /**
   * Both halves of the same gate: the button hides without `mail.send`, and the endpoint
   * refuses without it. Resolution comes from the one place that owns it — the same
   * `sendingMailboxFor` the endpoint asks — so the From and To shown here are the From and To
   * the send will actually use, never a second opinion.
   */
  const outbound = useMemo(() => sendingMailboxFor(state, issue.id), [state, issue.id])
  const maySendMail = can(state.model, actor, 'mail.send').allowed

  /* Which RAID kind this record is, by stable id through the live registry — a renamed
     label keeps its semantics. Null for ordinary work, and every RAID surface below hides. */
  const raidKind = raidKindOf(state.model, record?.type ?? issue.type)
  const judged = exposure(record?.riskLikelihood, record?.riskImpact)

  /* ---------------- supplementary context (ported from IssueFocus) ---------------- */

  const activityCount = useMemo(
    () => Object.values(state.activities).filter((a) => a.issueId === issue.id && !a.deletedAt).length,
    [state.activities, issue.id],
  )
  const relationshipCount = useMemo(
    () =>
      state.relationships.filter((r) => r.sourceIssueId === issue.id || r.targetIssueId === issue.id)
        .length,
    [state.relationships, issue.id],
  )
  const evidenceItems = useMemo(
    () => Object.values(state.evidence).filter((e) => e.issueId === issue.id && !e.deletedAt),
    [state.evidence, issue.id],
  )
  const evidenceTally = useMemo(() => tallyByKind(evidenceItems), [evidenceItems])
  const latestEvidence = useMemo(() => latestOf(evidenceItems), [evidenceItems])
  const sourceDoc = useMemo(() => detectSourceDocument(issue), [issue])

  /** Read-only render only — editing already opens the full form, where truncation would be
      actively wrong. Reset per issue so switching rows never carries the last one's expansion
      state onto a description that hasn't been read yet. */
  const [descExpanded, setDescExpanded] = useState(false)
  useEffect(() => setDescExpanded(false), [issue.id])
  const descRef = useRef<HTMLDivElement>(null)
  /** Whether the clamped description actually hides anything — measured, not assumed, so
      "Show more" never appears on a description that already fits in three lines. Depends on
      `descExpanded` so a short description's stale `true` reading (measured before the reset
      effect above re-renders it clamped) self-corrects on the very next pass rather than
      sticking. */
  const [descOverflows, setDescOverflows] = useState(false)
  useEffect(() => {
    const el = descRef.current
    setDescOverflows(el ? el.scrollHeight > el.clientHeight + 1 : false)
  }, [issue.id, issue.description, descExpanded])

  const [composing, setComposing] = useState(false)
  const [mailBody, setMailBody] = useState('')
  const [sending, setSending] = useState(false)
  const [mailError, setMailError] = useState<string | null>(null)
  const [sentLine, setSentLine] = useState<string | null>(null)
  /** The mail went but the note did not — the one state where Send must NOT be offered again. */
  const [sentUnrecorded, setSentUnrecorded] = useState(false)

  /* ---------------- schedule a meeting (personal — see personalGraph.ts) ---------------- */

  const [scheduling, setScheduling] = useState(false)
  const [meetSubject, setMeetSubject] = useState('')
  const [meetStart, setMeetStart] = useState('')
  const [meetEnd, setMeetEnd] = useState('')
  const [meetAttendees, setMeetAttendees] = useState('')
  const [meetBusy, setMeetBusy] = useState(false)
  const [meetError, setMeetError] = useState<string | null>(null)
  const [meetResult, setMeetResult] = useState<{ webLink: string; onlineMeetingUrl: string | null } | null>(
    null,
  )

  /* ---------------- message on Teams (personal) ---------------- */

  const [messaging, setMessaging] = useState(false)
  const [chatTo, setChatTo] = useState('')
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatSent, setChatSent] = useState(false)

  /*
   * The compose belongs to one record. Without this, the component instance survives an issue
   * switch (nothing keys it on issue.id) and a reply typed to client A would sit in the box
   * while From/To silently recompute to client B — one click from sending A's words to B.
   * The generation counter makes an in-flight send's continuation stale the moment the issue
   * changes, so its success line, error, or button state cannot land on the wrong record.
   */
  // A primitive, not `outbound` itself: `outbound` is a fresh object every render `state`
  // changes at all, and depending on the object would reset a half-typed meeting form on any
  // unrelated edit elsewhere in the workspace, not just on switching issues.
  const defaultAttendee = !isOutboundRefusal(outbound) ? outbound.recipient : ''

  const composeGen = useRef(0)
  useEffect(() => {
    composeGen.current += 1
    setComposing(false)
    setMailBody('')
    setSending(false)
    setMailError(null)
    setSentLine(null)
    setSentUnrecorded(false)
    // Same reasoning as the client reply above, for the same class of bug: a half-filled
    // meeting form must not survive a switch to another issue and get scheduled against it.
    setScheduling(false)
    setMeetSubject('')
    setMeetStart('')
    setMeetEnd('')
    setMeetAttendees(defaultAttendee)
    setMeetBusy(false)
    setMeetError(null)
    setMeetResult(null)
    setMessaging(false)
    setChatTo(defaultAttendee)
    setChatText('')
    setChatBusy(false)
    setChatError(null)
    setChatSent(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultAttendee deliberately
    // excluded: it must seed the field on an issue switch, not re-seed it on every recompute.
  }, [issue.id])

  const sendMail = async () => {
    if (isOutboundRefusal(outbound)) return
    const gen = composeGen.current
    setSending(true)
    setMailError(null)
    try {
      const res = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id, text: mailBody }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        to?: string
        noteRecorded?: boolean
        note?: IssueNote | null
        replayed?: boolean
      } | null
      if (composeGen.current !== gen) {
        // The person moved to another record while this was in flight. The note merge below
        // is still safe (it carries its own issueId), but nothing else here may touch state.
        if (data?.ok && data.note) onMailSent(data.note)
        return
      }
      if (!res.ok || !data?.ok) {
        // The typed body stays in the box — a client email is not something to retype.
        setMailError(
          data?.error ?? 'The message could not be sent. Nothing was recorded, and your text is still in the box.',
        )
        return
      }
      if (data.note) onMailSent(data.note)
      if (data.noteRecorded === false) {
        // The mail went; only the record failed. Keep the text on screen for copying into a
        // note by hand — and take Send away, because pressing it again would mail the client twice.
        setSentUnrecorded(true)
        return
      }
      setSentLine(
        data.replayed
          ? `This exact message was already sent to ${data.to} — nothing new was sent.`
          : `Sent to ${data.to} and recorded in Notes.`,
      )
      setMailBody('')
      setComposing(false)
    } catch {
      if (composeGen.current === gen)
        setMailError('The message could not be sent. Check the connection — your text is still in the box.')
    } finally {
      if (composeGen.current === gen) setSending(false)
    }
  }

  const scheduleOnMyCalendar = async (): Promise<boolean> => {
    const gen = composeGen.current
    // Read the fallback here, not from a setState just issued by the caller — a state update
    // is not visible to the next line that reads it, only to the next render.
    const subject = meetSubject.trim() || issue.subject
    const attendees = meetAttendees
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    setMeetBusy(true)
    setMeetError(null)
    try {
      const res = await fetch('/api/calendar/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject,
          startIso: meetStart ? new Date(meetStart).toISOString() : '',
          endIso: meetEnd ? new Date(meetEnd).toISOString() : '',
          attendees,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        reconnect?: boolean
        webLink?: string
        onlineMeetingUrl?: string | null
      } | null
      if (composeGen.current !== gen) return false // moved to another issue while this was in flight
      if (!res.ok || !data?.ok) {
        setMeetError(
          data?.reconnect
            ? 'Your calendar connection is not active — sign in once to connect it.'
            : (data?.error ?? 'The meeting could not be scheduled.'),
        )
        return false
      }
      setMeetResult({ webLink: data.webLink ?? '', onlineMeetingUrl: data.onlineMeetingUrl ?? null })
      return true
    } catch {
      if (composeGen.current === gen)
        setMeetError('The meeting could not be scheduled. Check the connection and try again.')
      return false
    } finally {
      if (composeGen.current === gen) setMeetBusy(false)
    }
  }

  const sendTeamsMessage = async (): Promise<boolean> => {
    const gen = composeGen.current
    const to = chatTo.trim()
    const text = chatText.trim()
    if (!to || !text) return false
    setChatBusy(true)
    setChatError(null)
    try {
      const res = await fetch('/api/teams/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to, text }),
      })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        reconnect?: boolean
      } | null
      if (composeGen.current !== gen) return false
      if (!res.ok || !data?.ok) {
        setChatError(
          data?.reconnect
            ? 'Your inbox connection is not active — sign in once to connect it.'
            : (data?.error ?? 'The message could not be sent.'),
        )
        return false
      }
      setChatSent(true)
      setChatText('')
      return true
    } catch {
      if (composeGen.current === gen)
        setChatError('The message could not be sent. Check the connection and try again.')
      return false
    } finally {
      if (composeGen.current === gen) setChatBusy(false)
    }
  }

  useEffect(() => {
    // A part-typed client reply counts as unsaved work exactly like a half-edited form:
    // leaving the row would discard it silently, and the workspace's guard stops that.
    onDirtyChange(
      (editing && dirty) ||
        (composing && mailBody.trim() !== '') ||
        (scheduling && (meetSubject.trim() !== '' || meetStart !== '' || meetEnd !== '')) ||
        (messaging && chatText.trim() !== ''),
    )
  }, [
    editing,
    dirty,
    composing,
    mailBody,
    scheduling,
    meetSubject,
    meetStart,
    meetEnd,
    messaging,
    chatText,
    onDirtyChange,
  ])

  /* ---------------- view ---------------- */


  if (!editing) {
    return (
      <>
        <div className="ov-actions">
          {may.allowed ? (
            <button className="btn primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : (
            <span className="prov">{may.reason ?? 'Read only.'}</span>
          )}
          <span className="grow" />
          {/* The boundary, legible at a glance: every record says which side it is on. The
              toggle is both-halves gated — hidden without work.edit, refused by the arm. */}
          <span className={`cv-chip${(record?.clientVisible ?? false) ? ' on' : ''}`}>
            {(record?.clientVisible ?? false) ? 'Client-visible' : 'Internal'}
          </span>
          {may.allowed && record && (
            <button
              className="btn ghost"
              onClick={() => onSave({ clientVisible: !(record.clientVisible ?? false) }, null)}
              title={
                (record.clientVisible ?? false)
                  ? 'Make this record internal again. Its notes and files keep their own flags.'
                  : 'Let client seats see this record. Notes and files stay internal until marked themselves.'
              }
            >
              {(record.clientVisible ?? false) ? 'Make internal' : 'Show to client'}
            </button>
          )}
        </div>

        {/* Reply, Schedule and Teams collapse to one row when idle instead of three stacked
            `appr-block` sections each paying for its own header before anything happens — the
            forms below (unchanged) still open in full on a click. Reply's own visibility rule
            carries over unchanged: absent entirely without the grant, the same choice
            ApprovalsBlock makes about self-approval, and absent too with no database backing
            the workspace, where a send could never be recorded. Schedule and Teams need no such
            gate — neither writes to the workspace (see /api/calendar/schedule and
            connected-workspace-design.md §4), so both are always offered. */}
        <div className="ov-comms-row">
          {mailEnabled && maySendMail && (
            isOutboundRefusal(outbound) ? (
              <span className="prov">{outbound.reason}</span>
            ) : (
              <>
                <button className="btn" onClick={() => { setSentLine(null); setComposing(true) }}>
                  {mailBody.trim() ? 'Continue the reply…' : 'Reply'}
                </button>
                {sentLine && <span className="prov">{sentLine}</span>}
              </>
            )
          )}
          <button className="btn" onClick={() => { setMeetResult(null); setScheduling(true) }}>
            Schedule
          </button>
          {meetResult && (
            <span className="prov">
              Scheduled —{' '}
              <a href={meetResult.onlineMeetingUrl ?? meetResult.webLink} target="_blank" rel="noreferrer">
                {meetResult.onlineMeetingUrl ? 'join link' : 'view in Outlook'}
              </a>
            </span>
          )}
          <button className="btn" onClick={() => { setChatSent(false); setChatError(null); setMessaging(true) }}>
            Teams
          </button>
          {chatSent && <span className="prov">Sent.</span>}
        </div>

        {/* `composing` can only be set true from the non-refusal branch above, but the guard is
            repeated here rather than assumed — it's what lets TypeScript narrow `outbound` to
            `OutboundResolution` for the fields below, not just a runtime nicety. */}
        {composing && !isOutboundRefusal(outbound) && (
          <section className="appr-block">
            <h4 className="est-h">Reply to client</h4>
            <dl className="kv">
              <dt>From</dt>
              <dd className="mono">
                {outbound.mailbox.address}
                <span className="prov"> · the intake mailbox that covers this record</span>
              </dd>
              <dt>To</dt>
              <dd className="mono">
                {outbound.recipient}
                <span className="prov"> · whoever raised it, as they stated</span>
              </dd>
              <dt>Subject</dt>
              <dd>
                {outbound.subject}
                <span className="prov"> · the reference threads their answer back here</span>
              </dd>
              <dt>Message</dt>
              <dd>
                <textarea
                  rows={6}
                  value={mailBody}
                  onChange={(e) => setMailBody(e.target.value)}
                  aria-label="Message to the client"
                  placeholder="Sent as plain text, exactly as written here."
                  readOnly={sentUnrecorded}
                />
                {mailError && <p className="ov-gate">{mailError}</p>}
                {sentUnrecorded && (
                  <p className="ov-gate">
                    This message DID reach {outbound.recipient} — do not send it again. Only
                    the note failed to write: copy the text above into a note on the Notes
                    tab, then discard it here.
                  </p>
                )}
              </dd>
            </dl>
            <div className="ov-actions">
              {sentUnrecorded ? (
                /* Send is gone, not disabled: pressing it again would mail the client twice. */
                <button
                  className="btn"
                  onClick={() => {
                    setSentUnrecorded(false)
                    setMailBody('')
                    setComposing(false)
                  }}
                >
                  Done — discard text
                </button>
              ) : (
                <>
                  {/* Close keeps the draft; only a successful send clears it. */}
                  <button className="btn" disabled={sending} onClick={() => setComposing(false)}>
                    Close
                  </button>
                  <button
                    className="btn primary"
                    disabled={sending || !mailBody.trim()}
                    onClick={sendMail}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {scheduling && (
          <section className="appr-block">
            <h4 className="est-h">Schedule a meeting</h4>
            <p className="prov">
              Personal — goes on your own Outlook calendar with a Teams link, not recorded on
              this record.
            </p>
            <dl className="kv">
              <dt>Subject</dt>
              <dd>
                <input
                  value={meetSubject}
                  onChange={(e) => setMeetSubject(e.target.value)}
                  aria-label="Meeting subject"
                  placeholder={issue.subject}
                />
              </dd>
              <dt>Starts</dt>
              <dd>
                <input
                  type="datetime-local"
                  value={meetStart}
                  onChange={(e) => setMeetStart(e.target.value)}
                  aria-label="Meeting start"
                />
              </dd>
              <dt>Ends</dt>
              <dd>
                <input
                  type="datetime-local"
                  value={meetEnd}
                  onChange={(e) => setMeetEnd(e.target.value)}
                  aria-label="Meeting end"
                />
              </dd>
              <dt>Attendees</dt>
              <dd>
                <input
                  value={meetAttendees}
                  onChange={(e) => setMeetAttendees(e.target.value)}
                  aria-label="Attendee email addresses, comma-separated"
                  placeholder="name@client.com, name@axiocloudsolutions.com"
                />
                <span className="prov"> · comma-separated addresses</span>
              </dd>
            </dl>
            {meetError && <p className="ov-gate">{meetError}</p>}
            <div className="ov-actions">
              <button className="btn" disabled={meetBusy} onClick={() => setScheduling(false)}>
                Close
              </button>
              <button
                className="btn primary"
                disabled={
                  meetBusy ||
                  !(meetSubject.trim() || issue.subject) ||
                  !meetStart ||
                  !meetEnd ||
                  !meetAttendees.trim()
                }
                onClick={async () => {
                  // Close only on success — a failure must leave the form (and meetError)
                  // visible, not vanish it the instant the person needs to read why.
                  if (await scheduleOnMyCalendar()) setScheduling(false)
                }}
              >
                {meetBusy ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          </section>
        )}

        {messaging && (
          <section className="appr-block">
            <h4 className="est-h">Message on Teams</h4>
            {/* The most sensitive of the three — see connected-workspace-design.md §4. No
                default recipient beyond the same client contact the mail action defaults to;
                nothing here is offered pre-filled toward a colleague. */}
            <p className="prov">Personal — sent from your own Teams as you, not recorded here.</p>
            <dl className="kv">
              <dt>To</dt>
              <dd>
                <input
                  value={chatTo}
                  onChange={(e) => setChatTo(e.target.value)}
                  aria-label="Recipient's work address"
                  placeholder="name@axiocloudsolutions.com"
                />
              </dd>
              <dt>Message</dt>
              <dd>
                <textarea
                  rows={4}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  aria-label="Teams message"
                  readOnly={chatBusy}
                />
              </dd>
            </dl>
            {chatError && <p className="ov-gate">{chatError}</p>}
            <div className="ov-actions">
              <button className="btn" disabled={chatBusy} onClick={() => setMessaging(false)}>
                Close
              </button>
              <button
                className="btn primary"
                disabled={chatBusy || !chatTo.trim() || !chatText.trim()}
                onClick={async () => {
                  if (await sendTeamsMessage()) setMessaging(false)
                }}
              >
                {chatBusy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </section>
        )}

        {/*
          * Subject, Severity, Status and Owner used to repeat here — the exact duplication I24
          * flagged (9 Sep) against the header strip and never resolved. Now that the panel has
          * a real title (Subject) and `FieldStrip` carries Status/Severity/Owner above every
          * tab, these four rows would say nothing the reader hasn't already seen one scroll up.
          * Removed rather than restyled — see `docs/plans/2026-09-09-issue-workspace-redesign-
          * design.md` Tier 1 item 3 for the row-by-row accounting of what stays and why (Start/
          * Due stays because it also carries Start Date, which the strip doesn't; Raised by and
          * Accountable stay because neither appears in the strip at all).
          *
          * Each column is now two named groups instead of one long list — the same fields,
          * split where they were already conceptually split (record identity vs.
          * classification; ownership/timeline vs. progress/state).
          */}
        <div className="cols-2">
          <div className="kv-col">
            <h5 className="kv-heading">Record</h5>
            <dl className="kv">
              <dt>Issue</dt>
              <dd className="mono">{issue.id}</dd>
              <dt>Description</dt>
              <dd className="ov-prose">
                {isEmptyRichDoc(issue.description) ? (
                  '—'
                ) : (
                  <>
                    <div ref={descRef} className={descExpanded ? undefined : 'ov-desc-clamp'}>
                      <RichTextEditor
                        value={issue.description}
                        onChange={() => {}}
                        editable={false}
                        people={rtePeople}
                        issues={rteIssues}
                        onUploadImage={async () => null}
                      />
                    </div>
                    {descExpanded ? (
                      <button type="button" className="btn-link ov-desc-toggle" onClick={() => setDescExpanded(false)}>
                        Show less
                      </button>
                    ) : (
                      descOverflows && (
                        <button type="button" className="btn-link ov-desc-toggle" onClick={() => setDescExpanded(true)}>
                          Show more
                        </button>
                      )
                    )}
                  </>
                )}
              </dd>
              {sourceDoc && (
                <>
                  <dt>Source artifact</dt>
                  <dd>
                    {sourceDoc.fileName}
                    <span className="prov">
                      {' '}
                      · detected in the issue {sourceDoc.detectedIn} · file not held by this app
                    </span>
                  </dd>
                </>
              )}
            </dl>
            <h5 className="kv-heading">Classification</h5>
            <dl className="kv">
              <dt>{labels.TIER_ORGANIZATION} / {labels.TIER_MODULE}</dt>
              <dd>
                {issue.client} · {issue.module || moduleDefault || '—'}
                <span className="prov"> · follows its place in the tree</span>
                {onMove && (
                  <>
                    {' '}
                    <button type="button" className="btn-link" onClick={onMove}>
                      Move…
                    </button>
                  </>
                )}
              </dd>
              <dt>Type</dt>
              <dd>
                {displayType}
                {issue.sourceType && issue.sourceType !== displayType && (
                  <span className="prov"> · recorded in the log as “{issue.sourceType}”</span>
                )}
              </dd>
              {raidKind === 'risk' && record && (
                <>
                  <dt>Exposure</dt>
                  <dd>
                    {may.allowed ? (
                      <>
                        <select
                          value={record.riskLikelihood ?? ''}
                          aria-label="Likelihood, 1 to 5"
                          onChange={(e) =>
                            onSave(
                              { riskLikelihood: e.target.value === '' ? null : Number(e.target.value) },
                              null,
                            )
                          }
                        >
                          <option value="">not judged</option>
                          {Array.from({ length: RAID_SCALE_MAX }, (_, n) => (
                            <option key={n + 1} value={n + 1}>
                              L{n + 1}
                            </option>
                          ))}
                        </select>{' '}
                        ×{' '}
                        <select
                          value={record.riskImpact ?? ''}
                          aria-label="Impact, 1 to 5"
                          onChange={(e) =>
                            onSave(
                              { riskImpact: e.target.value === '' ? null : Number(e.target.value) },
                              null,
                            )
                          }
                        >
                          <option value="">not judged</option>
                          {Array.from({ length: RAID_SCALE_MAX }, (_, n) => (
                            <option key={n + 1} value={n + 1}>
                              I{n + 1}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span>
                        {record.riskLikelihood ?? '—'} × {record.riskImpact ?? '—'}
                      </span>
                    )}{' '}
                    {judged ? (
                      <b className={`raid-band raid-${judged.band.toLowerCase()}`}>
                        = {judged.score} · {judged.band}
                      </b>
                    ) : (
                      <span className="prov">not yet judged — exposure is computed, never stored</span>
                    )}
                  </dd>
                </>
              )}
              {raidKind === 'decision' && (
                <>
                  <dt>Outcome</dt>
                  <dd className="ov-prose">
                    {record?.decisionOutcome || (
                      <span className="prov">no outcome recorded yet — Edit to record it</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </div>
          <div className="kv-col">
            <h5 className="kv-heading">Ownership &amp; timeline</h5>
            <dl className="kv">
              <dt>{labels.ISSUE_RAISED_BY}</dt>
              <dd>{issue.raisedBy || '—'}</dd>
              <dt>{labels.ISSUE_ACCOUNTABLE}</dt>
              <dd>{issue.accountable}</dd>
              <dt>{labels.FIELD_NEXT_ACTION}</dt>
              <dd className="ov-prose">{issue.nextAction || '—'}</dd>
              <dt>{labels.FIELD_START_DATE} / {labels.FIELD_DUE_DATE}</dt>
              <dd className="mono">
                {row.plannedStartDate ? formatIso(row.plannedStartDate) : '—'} ·{' '}
                {row.plannedEndDate ? formatIso(row.plannedEndDate) : '—'}
                {row.plannedOrigin === 'derived' && (
                  <span className="prov"> · rolled up from its lifecycle</span>
                )}
                {leaveCaveat && (
                  <span className="prov">
                    {' '}
                    · {issue.owner} is on leave {formatIso(leaveCaveat.startDate)}–
                    {formatIso(leaveCaveat.endDate)}, inside this window
                  </span>
                )}
              </dd>
              <dt>Raised</dt>
              <dd className="mono">
                {formatIso(issue.raised)}{' '}
                <span style={{ color: 'var(--text-faint)' }}>({issue.age}d ago)</span>
              </dd>
              <dt>Last activity</dt>
              <dd className="mono">
                {formatIso(issue.lastActivity)}{' '}
                <span style={{ color: 'var(--text-faint)' }}>({issue.daysSinceActivity}d ago)</span>
              </dd>
            </dl>
            <h5 className="kv-heading">Progress</h5>
            <dl className="kv">
              <dt>Progress</dt>
              <dd>
                {row.percentComplete}%
                <span className="prov">
                  {' '}
                  ·{' '}
                  {row.progressOrigin === 'user'
                    ? 'manually overridden'
                    : row.progressOrigin === 'rolled-up'
                      ? `rolled up from ${activityCount} lifecycle ${activityCount === 1 ? 'activity' : 'activities'}`
                      : `derived from status`}
                </span>
              </dd>
              <dt>Lifecycle</dt>
              <dd>{activityCount ? `${activityCount} activities` : 'Not planned'}</dd>
              <dt>Relationships</dt>
              <dd>{relationshipCount ? `${relationshipCount} linked` : 'None'}</dd>
              {customResponsibilities.map((t) => (
                <Fragment key={t.id}>
                  <dt>
                    {t.label}
                    {t.requiredHere && <span style={{ color: 'var(--h-overdue)' }}> *</span>}
                  </dt>
                  <dd>
                    <input
                      className="resp-input"
                      defaultValue={t.values.join(', ')}
                      onBlur={(e) => {
                        const next = e.target.value
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean)
                        if (next.join(', ') !== t.values.join(', ')) onSetAssignment(t.id, next)
                      }}
                    />
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
        </div>

        {/* A summary and a way in, not a document library — managing files happens in the
            evidence manager this launches, not in a growing section here. */}
        <section className="appr-block">
          <h4 className="est-h">
            Evidence &amp; documents
            <button
              type="button"
              className="btn ghost"
              style={{ marginLeft: 8 }}
              onClick={() => onManageEvidence(issue.id)}
            >
              Manage evidence →
            </button>
          </h4>
          <div className="evi-strip">
            {(['snapshot', 'data', 'document', 'link'] as EvidenceKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`evi-cat${evidenceTally[k] === 0 ? ' empty' : ''}`}
                onClick={() => onManageEvidence(issue.id)}
              >
                <span className="evi-cat-top">
                  {KIND_ICON[k]} {KIND_LABEL[k]}
                </span>
                <span className="evi-cat-n">{evidenceTally[k]}</span>
              </button>
            ))}
          </div>
          {latestEvidence ? (
            <div className="evi-latest">
              <span className="ctx-label">Latest</span>
              <span>
                {KIND_ICON[latestEvidence.kind]} {latestEvidence.name}
              </span>
              {latestEvidence.purpose && <span className="evi-purpose">{latestEvidence.purpose}</span>}
              <span className="mono" style={{ color: 'var(--text-faint)' }}>
                {formatIso(latestEvidence.addedAt.slice(0, 10))}
              </span>
            </div>
          ) : (
            <p className="zone-note">
              Nothing attached yet. The imported log records evidence only as quoted text, never
              as files — attach snapshots, data files or documents to build an auditable record.
            </p>
          )}
        </section>

        {/* Under the record rather than on a tab of its own: an approval here is never an
            abstract fact, it is the reason a particular move is blocked. */}
        {record && (
          <ApprovalsBlock
            issue={record}
            state={state}
            actor={actor}
            onRequest={onRequestApproval}
            onDecide={onDecideApproval}
          />
        )}

      </>
    )
  }

  /* ---------------- edit ---------------- */

  return (
    <>
      <div className="ov-actions">
        <span className={`ov-dirty${dirty ? ' on' : ''}`}>
          {dirty ? 'Unsaved changes' : 'No changes yet'}
        </span>
        <span className="grow" />
        <button className="btn" onClick={cancel}>
          {dirty ? 'Discard changes' : 'Cancel'}
        </button>
        <button className="btn primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>

      <div className="cols-2">
        <dl className="kv">
          <dt>Issue</dt>
          <dd className="mono">
            {issue.id} <span className="prov">· not editable</span>
          </dd>
          <dt>Subject</dt>
          <dd>
            <input value={draft.subject} onChange={(e) => set('subject', e.target.value)} aria-label="Subject" />
          </dd>
          <dt>Description</dt>
          <dd>
            <RichTextEditor
              value={draft.description}
              onChange={(doc) => set('description', doc)}
              editable
              people={rtePeople}
              issues={rteIssues}
              onUploadImage={onUploadImage}
            />
          </dd>
          {raidKind === 'decision' && (
            <>
              <dt>Outcome</dt>
              <dd>
                <textarea
                  rows={3}
                  value={draft.decisionOutcome}
                  onChange={(e) => set('decisionOutcome', e.target.value)}
                  aria-label="Decision outcome"
                  placeholder="What was decided, and on what basis — the sentence people ask for months later."
                />
              </dd>
            </>
          )}
          {/* Client only, since the classification became its own editable field below (E0
              step 8a). This line used to show both with "not editable here" — true of the
              client, which really does follow where the record sits, but a contradiction the
              moment the classification grew its own control two rows down. */}
          <dt>{labels.TIER_ORGANIZATION}</dt>
          <dd>
            {issue.client}
            <span className="prov"> · follows where the record sits; Move changes it</span>
          </dd>
          <dt>Type</dt>
          <dd>
            <select value={draft.type} onChange={(e) => set('type', e.target.value)} aria-label="Type">
              {/* A record can carry a type since archived from the registry; keep it selectable
                  rather than silently reclassifying the record on the next save. */}
              {(workTypes.includes(draft.type) ? workTypes : [draft.type, ...workTypes]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </dd>
          <dt>{labels.FIELD_SEVERITY}</dt>
          <dd>
            <select
              value={draft.severity}
              onChange={(e) => set('severity', e.target.value as Severity)}
              aria-label={labels.FIELD_SEVERITY}
            >
              {(['High', 'Medium', 'Low'] as Severity[]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </dd>
          <dt>{labels.FIELD_STATUS}</dt>
          <dd>
            <select
              value={draft.status}
              onChange={(e) => set('status', e.target.value as IssueStatus)}
              aria-label={labels.FIELD_STATUS}
            >
              {routes.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            {policy.enforced && blocked.length > 0 && (
              <p className="prov ov-routes">
                Not reachable from “{current}”: {blocked.join(', ')}.
              </p>
            )}
            {movingTo && record && (() => {
              const blocked = blockingRule(
                state.model.approvalRules,
                state.approvals,
                issue.id,
                record.type,
                movingTo,
              )
              return blocked ? (
                <p className="ov-gate">
                  {blocked.label} is needed before this can move to “{movingTo}”. Ask for it
                  below, and somebody other than you has to answer.
                </p>
              ) : null
            })()}
            {needsEvidence && (
              <p className="ov-gate">
                “{movingTo}” needs at least one piece of evidence on the record first — that is
                what makes the closure producible later.{' '}
                <button type="button" className="link-btn" onClick={() => onManageEvidence(issue.id)}>
                  Attach evidence
                </button>
                .
              </p>
            )}
          </dd>
          {needsReason && (
            <>
              <dt>Reason</dt>
              <dd>
                <input
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                  aria-label="Reason for this status change"
                  placeholder={`Why is this “${movingTo}”?`}
                />
                <p className="prov">
                  Kept on the audit entry. This is the outcome people ask about months later.
                </p>
              </dd>
            </>
          )}
          <dt>Progress</dt>
          <dd>
            {draft.percentOverride !== null ? (
              <>
                <div className="progress-slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={draft.percentOverride}
                    onChange={(e) => set('percentOverride', Number(e.target.value))}
                    aria-label="Progress override"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.percentOverride}
                    onChange={(e) => set('percentOverride', Number(e.target.value))}
                    className="progress-num"
                    aria-label="Progress override, percent"
                  />
                  <span className="mono">%</span>
                </div>
                <button type="button" className="link-btn" onClick={() => set('percentOverride', null)}>
                  Use automatic progress instead
                </button>
              </>
            ) : (
              <div className="progress-auto">
                <span className="fld-hint">
                  {row.percentComplete}% ·{' '}
                  {row.progressOrigin === 'rolled-up'
                    ? `rolled up from ${activityCount} lifecycle ${activityCount === 1 ? 'activity' : 'activities'}`
                    : `derived from status “${draft.status}”`}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => set('percentOverride', row.percentComplete)}
                >
                  Override manually
                </button>
              </div>
            )}
          </dd>
        </dl>

        <dl className="kv">
          <dt>{labels.ISSUE_OWNER}</dt>
          <dd>
            <input
              list="overview-owners"
              value={draft.owner}
              onChange={(e) => set('owner', e.target.value)}
              aria-label={labels.ISSUE_OWNER}
            />
            <datalist id="overview-owners">
              {projectMembers.map((m) => (
                <option key={m.id} value={m.person} />
              ))}
            </datalist>
            {ownerMismatch ? (
              <span className="prov"> · “{draft.owner.trim()}” isn't in the directory — this will save as a name nobody can find</span>
            ) : projectMembers.length === 0 ? (
              <span className="prov"> · nobody is staffed to this project yet — type a name</span>
            ) : null}
          </dd>
          <dt>{labels.ISSUE_RAISED_BY}</dt>
          <dd>
            {issue.raisedBy || '—'} <span className="prov">· recorded once, not reassigned</span>
          </dd>
          <dt>{labels.ISSUE_ACCOUNTABLE}</dt>
          <dd>
            <select
              value={draft.accountable}
              onChange={(e) => set('accountable', e.target.value)}
              aria-label={labels.ISSUE_ACCOUNTABLE}
            >
              {state.model.parties.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </dd>
          <dt>{labels.TIER_MODULE}</dt>
          <dd>
            {/* The classification is a label on the work, editable in its own right — once the
                Process Area containers convert to labels (E0 step 8b), this control is where a
                record's classification comes from; until then the ancestor walk supplies the
                default and this overrides it. Datalist rather than select: the vocabulary is
                what work carries, not a registry, and a new label is legitimately typed. */}
            <input
              list="overview-classifications"
              value={draft.module}
              onChange={(e) => set('module', e.target.value)}
              aria-label={labels.TIER_MODULE}
            />
            <datalist id="overview-classifications">
              {classifications.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </dd>
          <dt>{labels.FIELD_NEXT_ACTION}</dt>
          <dd>
            <textarea
              rows={2}
              value={draft.nextAction}
              onChange={(e) => set('nextAction', e.target.value)}
              aria-label={labels.FIELD_NEXT_ACTION}
            />
          </dd>
          <dt>{labels.FIELD_START_DATE}</dt>
          <dd>
            <input
              type="date"
              value={draft.plannedStart}
              onChange={(e) => set('plannedStart', e.target.value)}
              aria-label={labels.FIELD_START_DATE}
            />
          </dd>
          <dt>{labels.FIELD_DUE_DATE}</dt>
          <dd>
            <input
              type="date"
              value={draft.plannedEnd}
              onChange={(e) => set('plannedEnd', e.target.value)}
              aria-label={labels.FIELD_DUE_DATE}
            />
            {row.plannedOrigin === 'derived' && (
              <span className="prov"> · currently rolled up from its lifecycle; setting a date here overrides that</span>
            )}
          </dd>
          <dt>Raised</dt>
          <dd className="mono">
            {formatIso(issue.raised)} <span className="prov">· recorded</span>
          </dd>
          <dt>Last activity</dt>
          <dd className="mono">
            {formatIso(issue.lastActivity)} <span className="prov">· maintained by the system</span>
          </dd>
        </dl>
      </div>
    </>
  )
}
