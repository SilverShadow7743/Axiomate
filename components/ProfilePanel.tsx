'use client'

import { useEffect, useMemo, useState } from 'react'
import DetailDrawer from './DetailDrawer'
import { directReportsOf, isExternalPartyKind, liveRoles, liveSkills, skillName, tiersOf } from '@/lib/config'
import { can, directoryPersonFor } from '@/lib/access'
import { formatIso } from '@/lib/dates'
import { isTerminal } from '@/lib/schedule'
import { isStale, levelLabel, sourceLabel } from '@/lib/skills'
import type { ConfigOp, WorkspaceState } from '@/lib/workspace'
import type { Actor } from '@/lib/actor'

/**
 * A person's page — F&O's details page for a directory entry (12 Sep 2026), in the same
 * grammar the record drawer speaks: the name as the title, the status pinned upper-right, a
 * record action pane with at most one primary, and single-open FastTabs beneath.
 *
 * It replaces the modal of 24 Aug (`docs/plans/2026-08-24-profile-screen-design.md`), and it
 * is still the ONE place a person is read: opened from the People list, from a reports-to or
 * direct-report link, and from the People configuration card. What changed:
 *
 *   - Identity fields (address, title, phone, joined, manager, roles, client scope, status)
 *     are editable HERE for a `config.manage` holder — the same `upsertPerson` op the
 *     configuration card dispatches, the same absent-versus-cleared rules, no new permission.
 *     Everyone else reads them. The people-directory design's decision that these stay
 *     admin-only edits is kept; only where the admin edits them moved.
 *   - Career (grade, track, developing toward) stays the person's own to state.
 *   - Two sections that did not exist: Work (open records they own, live allocations) and
 *     History (what this person changed, newest first). Both are selections over state the
 *     reader already holds; nothing here computes a number `lib/` does not.
 *
 * Departing is a status change, never a deletion — `deletePerson` stays the separate hard
 * tool on the configuration card for a mistaken entry, and it is deliberately not offered here.
 */

type Section = 'Overview' | 'Career' | 'Skills' | 'Work' | 'History'
const SECTIONS: Section[] = ['Overview', 'Career', 'Skills', 'Work', 'History']

export default function ProfilePanel({
  state,
  actor,
  personId,
  onNavigate,
  onUpdateCareer,
  onConfig,
  onOpenIssue,
  onClose,
}: {
  state: WorkspaceState
  actor: Actor
  personId: string
  /** Re-point this same page at a different person — reports-to and direct-report rows use this. */
  onNavigate: (id: string) => void
  onUpdateCareer: (id: string, patch: { grade?: string; track?: string; developingToward?: string }) => boolean
  /** The configuration funnel. Absent means read-only, whatever the actor holds. */
  onConfig?: (op: ConfigOp) => boolean
  /** Open one of the records listed under Work in the tree. */
  onOpenIssue?: (issueId: string) => void
  onClose: () => void
}) {
  const model = state.model
  const person = model.people[personId]
  const isSelf = directoryPersonFor(model, actor)?.id === personId
  const mayConfigure = Boolean(onConfig) && can(model, actor, 'config.manage').allowed
  const today = new Date().toISOString().slice(0, 10)

  const [section, setSection] = useState<Section>('Overview')
  const [grade, setGrade] = useState(person?.grade ?? '')
  const [track, setTrack] = useState(person?.track ?? '')
  const [developingToward, setDevelopingToward] = useState(person?.developingToward ?? '')

  // Escape closes, deferring to a focused input the way the record drawer does — the page has
  // inline editors, and Escape inside one is "leave this field", not "leave this person".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const manager = person?.managerId ? model.people[person.managerId] : null
  const reports = person ? directReportsOf(model.people, person.id) : []
  const skills = Object.values(state.personSkills).filter((s) => s.personId === personId && !s.deletedAt)
  const roles = liveRoles(model)
  const isClientSeat = (person?.roleIds ?? []).some((r) => ['ROLE_CLIENT_SPONSOR', 'ROLE_CLIENT_LEAD', 'ROLE_CLIENT_USER'].includes(r))
  const clientNodes = useMemo(() => {
    const kinds = tiersOf(model)
    return Object.values(state.nodes)
      .filter((n) => !n.deletedAt && isExternalPartyKind(kinds, n.kind))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [model, state.nodes])

  const openWork = useMemo(
    () =>
      person
        ? Object.values(state.issues)
            .filter((i) => !i.deletedAt && !isTerminal(i.status) && i.owner.trim().toLowerCase() === person.name.trim().toLowerCase())
            .sort((a, b) => (a.plannedEnd ?? '9999').localeCompare(b.plannedEnd ?? '9999'))
        : [],
    [state.issues, person],
  )
  const allocations = useMemo(
    () =>
      person
        ? Object.values(state.allocations)
            .filter((a) => (a.personId ? a.personId === person.id : a.person === person.name) && a.endDate >= today)
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
        : [],
    [state.allocations, person, today],
  )
  const history = useMemo(
    () =>
      person
        ? state.audit
            .filter((a) => (a.byId ? a.byId === person.id : a.by === person.name))
            .slice(-20)
            .reverse()
        : [],
    [state.audit, person],
  )

  const summaries: Partial<Record<Section, string>> = person
    ? {
        Overview: person.roleIds.length ? person.roleIds.map((r) => model.roles[r]?.label ?? r).join(', ') : 'no role',
        Career: [person.grade, person.track].filter(Boolean).join(' · ') || undefined,
        Skills: skills.length ? `${skills.length} recorded` : undefined,
        Work: openWork.length ? `${openWork.length} open` : undefined,
        History: history[0] ? `Last ${formatIso(history[0].at.slice(0, 10))}` : undefined,
      }
    : {}

  /** One upsert carrying the person's current name and roles, plus the patch — what every field editor sends. */
  const save = (patch: Partial<Parameters<typeof upsertOf>[1]>) => (person && onConfig ? onConfig(upsertOf(person, patch)) : false)

  return (
    <DetailDrawer wide={false} onClose={onClose} className="above-overlay">
      {!person ? (
        <div className="cfg-empty" style={{ padding: 16 }}>That person is no longer in the directory.</div>
      ) : (
        <>
          <div className="detail-title">
            <h2 className="dt-name">{person.name}</h2>
            <span className="grow" />
            <span className={`dt-status${person.status === 'Departed' ? ' departed' : ''}`} title="Status">
              {person.status === 'Departed' ? `Departed${person.departedOn ? ` ${formatIso(person.departedOn)}` : ''}` : 'Active'}
            </span>
          </div>

          {/* The record action pane: whole-record verbs, at most one primary. Marking someone
              departed is the ordinary next move nobody wants to make by accident, so it is
              secondary with a confirm; reactivating is the reverse. */}
          <div className="detail-head person-actions">
            {person.title && <span className="prov">{person.title}</span>}
            <span className="grow" />
            {mayConfigure &&
              (person.status === 'Departed' ? (
                <button className="btn" onClick={() => save({ status: 'Active' })} title="Back to Active; the departure date clears">
                  Reactivate
                </button>
              ) : (
                <button
                  className="btn"
                  onClick={() => {
                    if (window.confirm(`Mark ${person.name} as departed today? Their history and assignments stay where they are.`)) {
                      save({ status: 'Departed', departedOn: today })
                    }
                  }}
                  title="A status change, never a deletion"
                >
                  Mark departed…
                </button>
              ))}
            <button className="btn ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="panel-body">
            <div className="fasttabs">
              {SECTIONS.map((s) => {
                const open = s === section
                return (
                  <section key={s} className={`fasttab${open ? ' open' : ''}`}>
                    <button type="button" className="fasttab-head" aria-expanded={open} onClick={() => setSection(s)}>
                      <span className="fasttab-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                      <span className="fasttab-name">{s}</span>
                      <span className="grow" />
                      {summaries[s] && <span className="fasttab-sum">{summaries[s]}</span>}
                    </button>
                    {open && (
                      <div className="fasttab-body">
                        {s === 'Overview' && (
                          <div className="profile-facts">
                            <Fact label="Work address" editable={mayConfigure} value={person.email ?? ''} type="email" onSave={(v) => save({ email: v })} />
                            <Fact label="Title" editable={mayConfigure} value={person.title ?? ''} onSave={(v) => save({ title: v })} />
                            <Fact label="Phone" editable={mayConfigure} value={person.phone ?? ''} type="tel" onSave={(v) => save({ phone: v })} />
                            <Fact label="Joined" editable={mayConfigure} value={person.joinedOn ?? ''} type="date" display={person.joinedOn ? formatIso(person.joinedOn) : ''} onSave={(v) => save({ joinedOn: v })} />
                            <div>
                              <span className="cfg-key">Reports to</span>
                              {mayConfigure ? (
                                <select value={person.managerId ?? ''} aria-label={`Manager for ${person.name}`} onChange={(e) => save({ managerId: e.target.value || null })}>
                                  <option value="">none recorded</option>
                                  {Object.values(model.people)
                                    .filter((m) => m.id !== person.id && (m.status !== 'Departed' || m.id === person.managerId))
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.name}
                                        {m.status === 'Departed' ? ' (departed)' : ''}
                                      </option>
                                    ))}
                                </select>
                              ) : manager ? (
                                <button className="btn-link" onClick={() => onNavigate(manager.id)}>
                                  {manager.name}
                                </button>
                              ) : (
                                <span className="prov">none recorded</span>
                              )}
                            </div>
                            <div>
                              <span className="cfg-key">Direct reports</span>
                              <span>
                                {reports.length ? (
                                  reports.map((r, i) => (
                                    <span key={r.id}>
                                      {i > 0 && ', '}
                                      <button className="btn-link" onClick={() => onNavigate(r.id)}>
                                        {r.name}
                                      </button>
                                    </span>
                                  ))
                                ) : (
                                  <span className="prov">nobody</span>
                                )}
                              </span>
                            </div>
                            <div className="profile-wide">
                              <span className="cfg-key">Roles</span>
                              {mayConfigure ? (
                                <span className="role-picks">
                                  {roles.map((r) => (
                                    <label key={r.id} className="role-pick">
                                      <input
                                        type="checkbox"
                                        checked={person.roleIds.includes(r.id)}
                                        onChange={(e) =>
                                          save({ roleIds: e.target.checked ? [...person.roleIds, r.id] : person.roleIds.filter((x) => x !== r.id) })
                                        }
                                      />
                                      {r.label}
                                    </label>
                                  ))}
                                </span>
                              ) : (
                                <span>{person.roleIds.length ? person.roleIds.map((r) => model.roles[r]?.label ?? r).join(', ') : 'no role'}</span>
                              )}
                            </div>
                            {isClientSeat && (
                              <div>
                                <span className="cfg-key">Client</span>
                                {mayConfigure ? (
                                  <select value={person.clientScopeId ?? ''} aria-label={`Client for ${person.name}`} onChange={(e) => save({ clientScopeId: e.target.value || null })}>
                                    <option value="">not attached — sees nothing</option>
                                    {clientNodes.map((n) => (
                                      <option key={n.id} value={n.id}>
                                        {n.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span>{person.clientScopeId ? (state.nodes[person.clientScopeId]?.name ?? person.clientScopeId) : <span className="prov">not attached</span>}</span>
                                )}
                              </div>
                            )}
                            {person.status === 'Departed' && (
                              <Fact label="Departed" editable={mayConfigure} value={person.departedOn ?? ''} type="date" display={person.departedOn ? formatIso(person.departedOn) : ''} onSave={(v) => save({ status: 'Departed', departedOn: v })} />
                            )}
                            {person.fromSource && (
                              <p className="prov profile-wide" style={{ margin: 0 }}>
                                Discovered in the imported log rather than entered here.
                              </p>
                            )}
                          </div>
                        )}

                        {s === 'Career' && (
                          <>
                            {!isSelf && (
                              <p className="cfg-note">
                                Grade, track and development are {person.name}&rsquo;s own to state — you can see them, not edit them.
                              </p>
                            )}
                            <div className="profile-facts">
                              <CareerField label="Grade" self={isSelf} value={grade} stored={person.grade ?? ''} setValue={setGrade} onSave={(v) => onUpdateCareer(person.id, { grade: v })} />
                              <CareerField label="Track" self={isSelf} value={track} stored={person.track ?? ''} setValue={setTrack} onSave={(v) => onUpdateCareer(person.id, { track: v })} />
                              <CareerField label="Developing toward" self={isSelf} value={developingToward} stored={person.developingToward ?? ''} setValue={setDevelopingToward} onSave={(v) => onUpdateCareer(person.id, { developingToward: v })} />
                            </div>
                          </>
                        )}

                        {s === 'Skills' &&
                          (skills.length === 0 ? (
                            <p className="cfg-note">Nothing recorded{liveSkills(model).length === 0 ? ' — the skill catalogue is empty (Configuration → Skills)' : ''}.</p>
                          ) : (
                            <table className="cfg-table est-table">
                              <thead>
                                <tr>
                                  <th>Skill</th>
                                  <th>Level</th>
                                  <th>Who says so</th>
                                  <th>Last used</th>
                                </tr>
                              </thead>
                              <tbody>
                                {skills
                                  .slice()
                                  .sort((a, b) => skillName(model, a.skillId).localeCompare(skillName(model, b.skillId)))
                                  .map((sk) => {
                                    const stale = isStale(sk.lastUsedOn, today)
                                    return (
                                      <tr key={sk.id}>
                                        <td>{skillName(model, sk.skillId)}</td>
                                        <td>{sk.level ? levelLabel(sk.level) : <span className="est-block-note">not shown at your access level</span>}</td>
                                        <td>
                                          {sk.source ? (
                                            <>
                                              {sourceLabel(sk.source)}
                                              {sk.assessedBy && <span className="est-block-note"> &mdash; {sk.assessedBy}</span>}
                                            </>
                                          ) : (
                                            <span className="est-block-note">&mdash;</span>
                                          )}
                                        </td>
                                        <td className="mono">
                                          {sk.lastUsedOn ?? <span className="est-block-note">not said</span>}
                                          {stale && <span className="est-block-note"> &middot; stale</span>}
                                        </td>
                                      </tr>
                                    )
                                  })}
                              </tbody>
                            </table>
                          ))}

                        {s === 'Work' && (
                          <>
                            <h4 className="est-h">Open records they own</h4>
                            {openWork.length === 0 ? (
                              <p className="cfg-note">Nothing open is owned by {person.name}.</p>
                            ) : (
                              <table className="cfg-table est-table">
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>Subject</th>
                                    <th>Status</th>
                                    <th>Due</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {openWork.slice(0, 25).map((i) => (
                                    <tr key={i.id}>
                                      <td className="mono">
                                        {onOpenIssue ? (
                                          <button className="btn-link" onClick={() => onOpenIssue(i.id)} title="Open in the tree">
                                            {i.id}
                                          </button>
                                        ) : (
                                          i.id
                                        )}
                                      </td>
                                      <td>{i.subject}</td>
                                      <td>{i.status}</td>
                                      <td className="mono">{i.plannedEnd ? formatIso(i.plannedEnd) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {openWork.length > 25 && <p className="prov">{openWork.length - 25} more — filter the Tree by owner to see them all.</p>}
                            <h4 className="est-h" style={{ marginTop: 12 }}>Allocations, today onward</h4>
                            {allocations.length === 0 ? (
                              <p className="cfg-note">No live allocation.</p>
                            ) : (
                              <ul className="compact-list">
                                {allocations.map((a) => (
                                  <li key={a.id}>
                                    <b>{state.nodes[a.projectId]?.name ?? a.projectId}</b> · {a.percentage}% · <span className="mono">{formatIso(a.startDate)} – {formatIso(a.endDate)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}

                        {s === 'History' &&
                          (history.length === 0 ? (
                            <p className="cfg-note">Nothing recorded as done by {person.name} yet.</p>
                          ) : (
                            <table className="cfg-table est-table">
                              <thead>
                                <tr>
                                  <th>When</th>
                                  <th>Record</th>
                                  <th>Field</th>
                                  <th>To</th>
                                </tr>
                              </thead>
                              <tbody>
                                {history.map((h) => (
                                  <tr key={h.id}>
                                    <td className="mono">{formatIso(h.at.slice(0, 10))}</td>
                                    <td className="mono">{h.rowId}</td>
                                    <td>{h.field}</td>
                                    <td>{(h.to ?? '').slice(0, 80)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </div>
        </>
      )}
    </DetailDrawer>
  )
}

/** The one upsert every editor here dispatches: the current name and roles plus the patch. */
function upsertOf(
  person: { id: string; name: string; roleIds: string[] },
  patch: {
    email?: string
    title?: string
    phone?: string
    joinedOn?: string
    departedOn?: string
    status?: 'Active' | 'Departed'
    managerId?: string | null
    clientScopeId?: string | null
    roleIds?: string[]
  },
): ConfigOp {
  const { roleIds, ...rest } = patch
  return { k: 'upsertPerson', id: person.id, name: person.name, roleIds: roleIds ?? person.roleIds, ...rest } as ConfigOp
}

/** A fact that is text for most readers and an input for a configurer; refused saves snap back. */
function Fact({
  label,
  value,
  display,
  editable,
  type = 'text',
  onSave,
}: {
  label: string
  value: string
  display?: string
  editable: boolean
  type?: 'text' | 'email' | 'tel' | 'date'
  onSave: (next: string) => boolean
}) {
  return (
    <div>
      <span className="cfg-key">{label}</span>
      {editable ? (
        <input
          className="resp-input"
          type={type}
          defaultValue={value}
          placeholder="none recorded"
          aria-label={label}
          onBlur={(e) => {
            const next = e.target.value.trim()
            if (next === value) return
            if (!onSave(next)) e.target.value = value
          }}
        />
      ) : (
        <span>{display ?? value ?? <span className="prov">none recorded</span>}{!(display ?? value) && <span className="prov">none recorded</span>}</span>
      )}
    </div>
  )
}

function CareerField({
  label,
  self,
  value,
  stored,
  setValue,
  onSave,
}: {
  label: string
  self: boolean
  value: string
  stored: string
  setValue: (v: string) => void
  onSave: (v: string) => boolean
}) {
  return (
    <label className="fld">
      <span className="fld-label">{label}</span>
      {self ? (
        <input
          value={value}
          placeholder="none recorded"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const next = value.trim()
            if (next === stored) return
            if (!onSave(next)) setValue(stored)
          }}
        />
      ) : (
        <span>{stored || <span className="prov">none recorded</span>}</span>
      )}
    </label>
  )
}
