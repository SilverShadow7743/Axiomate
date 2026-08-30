'use client'

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import type { DependencyType, IssueStatus, ScheduleRow, Severity } from '@/lib/types'
import { ISSUE_STATUSES } from '@/lib/types'
import {
  canParent,
  childrenOf,
  descendantsOf,
  kindOf,
  nameOf,
  type CreatableKind,
  type WorkspaceState,
} from '@/lib/workspace'
import { formatIso } from '@/lib/dates'
import { classificationsOf } from '@/lib/tree'
import { isExternalPartyKind, isTierKind, kindLabel, liveDisciplines, liveWorkTypes, tiersOf } from '@/lib/config'
import { useLabels } from './labels'

export type DialogState =
  | { t: 'add'; parentId: string; kind: CreatableKind }
  | { t: 'edit'; id: string }
  | { t: 'move'; id: string }
  | { t: 'link'; issueId: string }
  | { t: 'dependency'; activityId: string }
  | { t: 'delete'; id: string }
  | null

interface Props {
  dialog: DialogState
  state: WorkspaceState
  rows: ScheduleRow[]
  onClose: () => void
  onSubmit: (payload: Record<string, string>) => void
}

export default function Dialogs({ dialog, state, rows, onClose, onSubmit }: Props) {
  const labels = useLabels()
  if (!dialog) return null
  const title =
    dialog.t === 'add'
      ? `Add ${kindLabel(labels, dialog.kind)}`
      : dialog.t === 'edit'
        ? `Edit ${nameOf(state, dialog.id)}`
        : dialog.t === 'move'
          ? `Move ${nameOf(state, dialog.id)}`
          : dialog.t === 'link'
            ? `Link ${dialog.issueId}`
            : dialog.t === 'dependency'
              ? 'Add dependency'
              : `Archive ${nameOf(state, dialog.id)}`

  const form = (
    <>
      {dialog.t === 'add' && <AddForm dialog={dialog} state={state} onSubmit={onSubmit} onClose={onClose} />}
      {dialog.t === 'edit' && <EditForm id={dialog.id} state={state} onSubmit={onSubmit} onClose={onClose} />}
      {dialog.t === 'move' && (
        <MoveForm id={dialog.id} state={state} rows={rows} onSubmit={onSubmit} onClose={onClose} />
      )}
      {dialog.t === 'link' && (
        <LinkForm issueId={dialog.issueId} state={state} onSubmit={onSubmit} onClose={onClose} />
      )}
      {dialog.t === 'dependency' && (
        <DependencyForm
          activityId={dialog.activityId}
          state={state}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      )}
      {dialog.t === 'delete' && (
        <DeleteForm id={dialog.id} state={state} onSubmit={onSubmit} onClose={onClose} />
      )}
    </>
  )

  return (
    <DialogShell title={title} onClose={onClose}>
      {form}
    </DialogShell>
  )
}

/**
 * Modal shell.
 *
 * Split out from `Dialogs` so the overlay hooks always run: `Dialogs` returns null when
 * nothing is open, and hooks cannot sit behind that early return.
 */
function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, true, onClose)

  const shell = (
    // Pointer-only dismissal; Escape via useOverlay is the keyboard path, and the target
    // guard means clicks inside the dialog never bubble into a close.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal is Escape (useOverlay)
    <div
        className="modal-scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
      <div
        className="modal"
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-head">
          <span id="modal-title">{title}</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )

  return typeof document === 'undefined' ? shell : createPortal(shell, document.body)
}

/* ------------------------------------------------------------------ */

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="fld">
      <span className="fld-label">{label}</span>
      {children}
      {hint && <span className="fld-hint">{hint}</span>}
    </label>
  )
}

function Actions({ onClose, submitLabel, danger }: { onClose: () => void; submitLabel: string; danger?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className={`btn ${danger ? 'danger-solid' : 'primary'}`}>
        {submitLabel}
      </button>
    </div>
  )
}

/* ---------------- Add ---------------- */

function AddForm({
  dialog,
  state,
  onSubmit,
  onClose,
}: {
  dialog: { parentId: string; kind: CreatableKind }
  state: WorkspaceState
  onSubmit: (p: Record<string, string>) => void
  onClose: () => void
}) {
  const [f, setF] = useState<Record<string, string>>({ name: '', severity: 'Medium', status: 'Open' })
  const labels = useLabels()
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const isIssue = dialog.kind === 'issue' || dialog.kind === 'sub-issue'
  // A tier that is not an external party — derived from the tier list and its flags rather
  // than named, so a new tier gets the structural form instead of silently falling into the
  // named-party branch, whatever this organisation calls its client tier.
  const isStructural =
    isTierKind(tiersOf(state.model), dialog.kind) &&
    !isExternalPartyKind(tiersOf(state.model), dialog.kind)
  // Read from the operating model, so a type or party added in configuration is selectable
  // here without a code change — which is the entire premise of the configuration plane.
  const workTypes = liveWorkTypes(state.model).map((t) => t.label)
  const disciplines = liveDisciplines(state.model)
  const parties = state.model.parties
  const blueprints = Object.values(state.model.blueprints ?? {})

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(f)
      }}
    >
      <div className="panel-note">
        Adding under <b>{nameOf(state, dialog.parentId)}</b> — the parent is taken from your
        selection.
      </div>

      {/* Templates surface at the moment of need: an engagement being created is the one
          moment a stored shape helps, and Configuration is not where anyone is standing. */}
      {dialog.kind === 'engagement' && blueprints.length > 0 && (
        <Field
          label="Start from a blueprint"
          hint="The stored shape is created under the new engagement, dated from today. Undated entries stay undated."
        >
          <select value={f.blueprintId ?? ''} onChange={(e) => set('blueprintId', e.target.value)}>
            <option value="">— none —</option>
            {blueprints.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · v{b.version}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={isIssue ? 'Subject' : 'Name'}>
        <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} required />
      </Field>

      {isStructural && (
        <Field label={labels.ISSUE_OWNER}>
          <input value={f.owner ?? ''} onChange={(e) => set('owner', e.target.value)} />
        </Field>
      )}

      {isIssue && (
        <>
          <Field label="Issue ID" hint="Leave blank to generate one automatically.">
            <input value={f.id ?? ''} onChange={(e) => set('id', e.target.value)} placeholder="auto" />
          </Field>
          <div className="fld-row">
            <Field label="Severity">
              <select value={f.severity} onChange={(e) => set('severity', e.target.value)}>
                {['High', 'Medium', 'Low'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={f.status} onChange={(e) => set('status', e.target.value)}>
                {ISSUE_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="fld-row">
            <Field label="Type">
              {/* The configured registry, not a copy of it. The literal that used to be here
                  listed nine of the ten types this workspace actually uses — Limitation was
                  missing, so eleven existing records carried a type no form could produce. */}
              <select value={f.type ?? workTypes[0] ?? ''} onChange={(e) => set('type', e.target.value)}>
                {workTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label={labels.TIER_MODULE} hint="Where it's filed supplies this if left blank.">
              {/* Datalist, not select: the vocabulary is what work carries, not a registry,
                  and blank legitimately means "derive from the parent chain". */}
              <input
                list="add-classifications"
                value={f.module ?? ''}
                onChange={(e) => set('module', e.target.value)}
              />
              <datalist id="add-classifications">
                {classificationsOf(state).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Discipline">
              {/* Blank first, and it is the default — unlike Type, which falls back to the first
                  configured value. Type is something every record has; discipline answers "who
                  resolves this", which is frequently not known when a client reports something.
                  Preselecting one would route work on the strength of list order. */}
              <select value={f.discipline ?? ''} onChange={(e) => set('discipline', e.target.value)}>
                <option value="">Not yet classified</option>
                {disciplines.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Accountable party">
              <select
                value={f.accountable ?? 'Unassigned'}
                onChange={(e) => set('accountable', e.target.value)}
              >
                {parties.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={labels.ISSUE_OWNER}>
            <input value={f.owner ?? ''} onChange={(e) => set('owner', e.target.value)} />
          </Field>
          <Field label="Next action">
            <input value={f.nextAction ?? ''} onChange={(e) => set('nextAction', e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea
              rows={3}
              value={f.description ?? ''}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <div className="fld-row">
            <Field label="Planned start" hint="Optional">
              <input type="date" value={f.plannedStart ?? ''} onChange={(e) => set('plannedStart', e.target.value)} />
            </Field>
            <Field label="Due date" hint="Optional">
              <input type="date" value={f.plannedEnd ?? ''} onChange={(e) => set('plannedEnd', e.target.value)} />
            </Field>
          </div>
        </>
      )}

      {!isIssue && !isStructural && (
        <div className="fld-row">
          <Field label="Start">
            <input type="date" value={f.plannedStart ?? ''} onChange={(e) => set('plannedStart', e.target.value)} />
          </Field>
          <Field label={dialog.kind === 'Milestone' ? 'Date' : 'End'}>
            <input
              type="date"
              value={f.plannedEnd ?? ''}
              onChange={(e) => set('plannedEnd', e.target.value)}
              disabled={dialog.kind === 'Milestone'}
            />
          </Field>
        </div>
      )}

      <Actions onClose={onClose} submitLabel="Create" />
    </form>
  )
}

/* ---------------- Edit ---------------- */

function EditForm({
  id,
  state,
  onSubmit,
  onClose,
}: {
  id: string
  state: WorkspaceState
  onSubmit: (p: Record<string, string>) => void
  onClose: () => void
}) {
  const node = state.nodes[id]
  const act = state.activities[id]
  const labels = useLabels()

  // Issues are edited through the canonical detail panel (OverviewTab), not here — this form
  // now handles hierarchy nodes and activities only. See docs/plans/2026-08-27-issue-detail-
  // consolidation-plan.md Step 3: this branch was already unreachable for issues before that
  // plan (issueForm always intercepted an issue edit first) and stays that way after it.
  const [f, setF] = useState<Record<string, string>>((): Record<string, string> => {
    if (node) return { name: node.name, owner: node.owner ?? '' }
    if (act)
      return {
        name: String(act.phase),
        owner: act.owner,
        plannedStart: act.plannedStartDate,
        plannedEnd: act.plannedEndDate,
        percent: String(act.percentComplete),
      }
    return {}
  })
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(f)
      }}
    >
      {node && (
        <>
          <Field label="Name">
            <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label={labels.ISSUE_OWNER}>
            <input value={f.owner} onChange={(e) => set('owner', e.target.value)} />
          </Field>
        </>
      )}

      {act && (
        <>
          <Field label="Name">
            <input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label={labels.ISSUE_OWNER}>
            <input value={f.owner} onChange={(e) => set('owner', e.target.value)} />
          </Field>
          <div className="fld-row">
            <Field label="Start">
              <input type="date" value={f.plannedStart} onChange={(e) => set('plannedStart', e.target.value)} />
            </Field>
            <Field label={act.isMilestone ? 'Date' : 'End'}>
              <input
                type="date"
                value={f.plannedEnd}
                onChange={(e) => set('plannedEnd', e.target.value)}
                disabled={act.isMilestone}
              />
            </Field>
          </div>
          <Field label="% complete">
            <input
              type="number"
              min={0}
              max={100}
              value={f.percent}
              onChange={(e) => set('percent', e.target.value)}
            />
          </Field>
        </>
      )}

      <Actions onClose={onClose} submitLabel="Save" />
    </form>
  )
}

/* ---------------- Move ---------------- */

function MoveForm({
  id,
  state,
  rows,
  onSubmit,
  onClose,
}: {
  id: string
  state: WorkspaceState
  rows: ScheduleRow[]
  onSubmit: (p: Record<string, string>) => void
  onClose: () => void
}) {
  const kind = kindOf(state, id) ?? ''
  const currentParent = state.nodes[id]?.parentId ?? state.issues[id]?.parentId ?? null
  const blocked = useMemo(() => new Set([id, ...descendantsOf(state, id)]), [state, id])

  // Only offer parents that are structurally legal and would not create a cycle.
  const candidates = useMemo(
    () =>
      rows
        .filter((r) => !blocked.has(r.id))
        .filter((r) => {
          const k = kindOf(state, r.id)
          return !!k && canParent(kind, k)
        })
        .map((r) => ({ id: r.id, label: `${'— '.repeat(r.depth)}${r.displayId || r.name}` })),
    [rows, blocked, kind, state],
  )

  const [target, setTarget] = useState('')
  const childCount = childrenOf(state, id).length

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ newParentId: target })
      }}
    >
      <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
        <dt>Record</dt>
        <dd>
          {nameOf(state, id)} <span style={{ color: 'var(--text-faint)' }}>({kind})</span>
        </dd>
        <dt>Current parent</dt>
        <dd>{currentParent ? nameOf(state, currentParent) : '(root)'}</dd>
        {childCount > 0 && (
          <>
            <dt>Children</dt>
            <dd>{childCount} record(s) will move with it</dd>
          </>
        )}
      </dl>

      <Field label="New parent" hint="Only positions valid for this record type are listed.">
        <select value={target} onChange={(e) => setTarget(e.target.value)} required autoFocus>
          <option value="">Select a parent…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      {candidates.length === 0 && (
        <div className="panel-note warn">
          There is no valid destination for this record. Create a suitable parent first.
        </div>
      )}

      <div className="panel-note">
        Moving is validated for invalid parent types, circular hierarchy and impact on roll-up
        before it is saved, and the change is written to history.
      </div>

      <Actions onClose={onClose} submitLabel="Move" />
    </form>
  )
}

/* ---------------- Link (business relationship) ---------------- */

function LinkForm({
  issueId,
  state,
  onSubmit,
  onClose,
}: {
  issueId: string
  state: WorkspaceState
  onSubmit: (p: Record<string, string>) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState('')
  const [type, setType] = useState('RELATED_TO')
  const [note, setNote] = useState('')

  const options = useMemo(
    () =>
      Object.values(state.issues)
        .filter((i) => !i.deletedAt && i.id !== issueId)
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    [state.issues, issueId],
  )

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ targetIssueId: target, relationshipType: type, note })
      }}
    >
      <div className="panel-note">
        A relationship is a <b>business</b> link. It records how two issues relate and has no
        effect on dates. To constrain timing, add a schedule dependency between activities
        instead.
      </div>
      <Field label="Relationship">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="RELATED_TO">Related to</option>
          <option value="DUPLICATE_OF">Duplicate of</option>
          <option value="CAUSED_BY">Caused by</option>
          <option value="BLOCKS">Blocks</option>
        </select>
      </Field>
      <Field label="Target issue">
        <select value={target} onChange={(e) => setTarget(e.target.value)} required autoFocus>
          <option value="">Select an issue…</option>
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              {i.id} — {i.subject.slice(0, 60)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Actions onClose={onClose} submitLabel="Link" />
    </form>
  )
}

/* ---------------- Dependency (schedule constraint) ---------------- */

function DependencyForm({
  activityId,
  state,
  onSubmit,
  onClose,
}: {
  activityId: string
  state: WorkspaceState
  onSubmit: (p: Record<string, string>) => void
  onClose: () => void
}) {
  const act = state.activities[activityId]
  const siblings = useMemo(
    () =>
      Object.values(state.activities)
        .filter((a) => !a.deletedAt && a.id !== activityId && a.issueId === act?.issueId)
        .sort((a, b) => a.order - b.order),
    [state.activities, activityId, act],
  )
  const [pred, setPred] = useState('')
  const [type, setType] = useState<DependencyType>('FS')
  const [lag, setLag] = useState('0')

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ predecessorId: pred, dependencyType: type, lagDays: lag })
      }}
    >
      <div className="panel-note">
        A dependency is a <b>scheduling</b> constraint on <b>{String(act?.phase)}</b>. It is
        validated for cycles and is what the Critical Resolution Path is computed from.
      </div>
      <Field label="Predecessor">
        <select value={pred} onChange={(e) => setPred(e.target.value)} required autoFocus>
          <option value="">Select an activity…</option>
          {siblings.map((s) => (
            <option key={s.id} value={s.id}>
              {String(s.phase)} ({formatIso(s.plannedStartDate)} → {formatIso(s.plannedEndDate)})
            </option>
          ))}
        </select>
      </Field>
      <div className="fld-row">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as DependencyType)}>
            <option value="FS">FS — Finish to Start</option>
            <option value="SS">SS — Start to Start</option>
            <option value="FF">FF — Finish to Finish</option>
            <option value="SF">SF — Start to Finish</option>
          </select>
        </Field>
        <Field label="Lag (days)">
          <input type="number" value={lag} onChange={(e) => setLag(e.target.value)} />
        </Field>
      </div>
      {siblings.length === 0 && (
        <div className="panel-note warn">
          This issue has no other activities to depend on.
        </div>
      )}
      <Actions onClose={onClose} submitLabel="Create dependency" />
    </form>
  )
}

/* ---------------- Delete (soft) ---------------- */

function DeleteForm({
  id,
  state,
  onSubmit,
  onClose,
}: {
  id: string
  state: WorkspaceState
  onSubmit: (p: Record<string, string>) => void
  onClose: () => void
}) {
  const kids = childrenOf(state, id)
  const all = descendantsOf(state, id)
  const [mode, setMode] = useState<'reparent' | 'cascade'>('reparent')

  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ mode })
      }}
    >
      <div className="panel-note">
        This record will be removed from the active Issue Tree but <b>retained in audit
        history</b>, and can be restored.
      </div>

      {kids.length > 0 ? (
        <>
          <div className="panel-note warn">
            <b>
              {nameOf(state, id)} has {kids.length} direct child record
              {kids.length === 1 ? '' : 's'}
            </b>
            {all.length !== kids.length && ` (${all.length} in total beneath it)`}. Choose what
            happens to them — children are never silently cascade-deleted.
          </div>
          <label className="radio">
            <input
              type="radio"
              checked={mode === 'reparent'}
              onChange={() => setMode('reparent')}
            />
            <span>
              <b>Archive only this record</b> and move its children up one level.
            </span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'cascade'} onChange={() => setMode('cascade')} />
            <span>
              <b>Archive this record and all {all.length} records beneath it.</b>
            </span>
          </label>
        </>
      ) : (
        <div style={{ fontSize: 12.5 }}>
          <b>{nameOf(state, id)}</b> has no child records.
        </div>
      )}

      <Actions onClose={onClose} submitLabel="Archive" danger />
    </form>
  )
}
