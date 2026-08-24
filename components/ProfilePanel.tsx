'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlay } from './useOverlay'
import { directReportsOf, liveSkills, skillName } from '@/lib/config'
import { directoryPersonFor } from '@/lib/access'
import { isStale, levelLabel, sourceLabel } from '@/lib/skills'
import type { WorkspaceState } from '@/lib/workspace'
import type { Actor } from '@/lib/actor'

/**
 * A directory entry's own page: identity and org facts, plus recorded skills, readable for any
 * colleague. Grade, track and developingToward are editable, and only for the signed-in person's
 * own record — everything else here (name, email, roleIds, reports-to) is edited on the People
 * config card, not duplicated here.
 *
 * See docs/plans/2026-08-24-profile-screen-design.md. Deliberately not a `WorkspaceView` — a
 * profile needs a target person id, which that closed, parameterless enum doesn't carry.
 */
export default function ProfilePanel({
  state,
  actor,
  personId,
  onNavigate,
  onUpdateCareer,
  onClose,
}: {
  state: WorkspaceState
  actor: Actor
  personId: string
  /** Re-point this same panel at a different person — reports-to and direct-report rows use this. */
  onNavigate: (id: string) => void
  onUpdateCareer: (id: string, patch: { grade?: string; track?: string; developingToward?: string }) => boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(ref, true, onClose)

  const model = state.model
  const person = model.people[personId]
  const isSelf = directoryPersonFor(model, actor)?.id === personId

  const [grade, setGrade] = useState(person?.grade ?? '')
  const [track, setTrack] = useState(person?.track ?? '')
  const [developingToward, setDevelopingToward] = useState(person?.developingToward ?? '')

  const manager = person?.managerId ? model.people[person.managerId] : null
  const reports = person ? directReportsOf(model.people, person.id) : []
  const skills = Object.values(state.personSkills).filter((s) => s.personId === personId && !s.deletedAt)

  const body = (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-away; keyboard dismissal is Escape (useOverlay)
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal profile-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div className="modal-head">
          <span id="profile-title">{person ? person.name : 'Profile'}</span>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          {!person ? (
            <div className="cfg-empty">That person is no longer in the directory.</div>
          ) : (
            <>
              <section className="cfg-section">
                <div className="profile-facts">
                  <div>
                    <span className="cfg-key">Work address</span>
                    <span>{person.email ?? <span className="prov">none recorded</span>}</span>
                  </div>
                  <div>
                    <span className="cfg-key">Roles</span>
                    <span>
                      {person.roleIds.length
                        ? person.roleIds.map((r) => model.roles[r]?.label ?? r).join(', ')
                        : 'no role'}
                    </span>
                  </div>
                  <div>
                    <span className="cfg-key">Reports to</span>
                    <span>
                      {manager ? (
                        <button className="btn-link" onClick={() => onNavigate(manager.id)}>
                          {manager.name}
                        </button>
                      ) : (
                        <span className="prov">none recorded</span>
                      )}
                    </span>
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
                </div>
              </section>

              <section className="cfg-section">
                <h3 className="cfg-h">Career</h3>
                {!isSelf && (
                  <p className="cfg-note">
                    Grade, track and development are {person.name}&rsquo;s own to state — you can
                    see them, not edit them.
                  </p>
                )}
                <div className="profile-facts">
                  <label className="fld">
                    <span className="fld-label">Grade</span>
                    {isSelf ? (
                      <input
                        value={grade}
                        placeholder="none recorded"
                        onChange={(e) => setGrade(e.target.value)}
                        onBlur={() => {
                          const next = grade.trim()
                          if (next === (person.grade ?? '')) return
                          if (!onUpdateCareer(person.id, { grade: next })) setGrade(person.grade ?? '')
                        }}
                      />
                    ) : (
                      <span>{person.grade ?? <span className="prov">none recorded</span>}</span>
                    )}
                  </label>
                  <label className="fld">
                    <span className="fld-label">Track</span>
                    {isSelf ? (
                      <input
                        value={track}
                        placeholder="none recorded"
                        onChange={(e) => setTrack(e.target.value)}
                        onBlur={() => {
                          const next = track.trim()
                          if (next === (person.track ?? '')) return
                          if (!onUpdateCareer(person.id, { track: next })) setTrack(person.track ?? '')
                        }}
                      />
                    ) : (
                      <span>{person.track ?? <span className="prov">none recorded</span>}</span>
                    )}
                  </label>
                  <label className="fld">
                    <span className="fld-label">Developing toward</span>
                    {isSelf ? (
                      <input
                        value={developingToward}
                        placeholder="none recorded"
                        onChange={(e) => setDevelopingToward(e.target.value)}
                        onBlur={() => {
                          const next = developingToward.trim()
                          if (next === (person.developingToward ?? '')) return
                          if (!onUpdateCareer(person.id, { developingToward: next })) {
                            setDevelopingToward(person.developingToward ?? '')
                          }
                        }}
                      />
                    ) : (
                      <span>{person.developingToward ?? <span className="prov">none recorded</span>}</span>
                    )}
                  </label>
                </div>
              </section>

              <section className="cfg-section">
                <h3 className="cfg-h">Skills</h3>
                {skills.length === 0 ? (
                  <p className="cfg-note">Nothing recorded.</p>
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
                        .map((s) => {
                          const stale = isStale(s.lastUsedOn, new Date().toISOString().slice(0, 10))
                          return (
                            <tr key={s.id}>
                              <td>{skillName(model, s.skillId)}</td>
                              <td>
                                {s.level ? (
                                  levelLabel(s.level)
                                ) : (
                                  <span className="est-block-note">not shown at your access level</span>
                                )}
                              </td>
                              <td>
                                {s.source ? (
                                  <>
                                    {sourceLabel(s.source)}
                                    {s.assessedBy && <span className="est-block-note"> &mdash; {s.assessedBy}</span>}
                                  </>
                                ) : (
                                  <span className="est-block-note">&mdash;</span>
                                )}
                              </td>
                              <td className="mono">
                                {s.lastUsedOn ?? <span className="est-block-note">not said</span>}
                                {stale && <span className="est-block-note"> &middot; stale</span>}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? body : createPortal(body, document.body)
}
