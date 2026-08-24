'use client'

import { useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import type { ScheduleRow } from '@/lib/types'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * Who may see and act on this project — the access fact, not a capacity one. See
 * `lib/staffing.ts` and the project-membership design.
 *
 * The role shown here is a label, not an authority: it drives what a person's badge says and
 * nothing about what they may do — their global role decides that, unchanged, everywhere. That
 * distinction is worth saying on the screen itself, not only in a design document nobody using
 * this panel will ever read.
 */
export default function ProjectMembersPanel({
  row,
  state,
  actor,
  onAdd,
  onUpdateRole,
  onRemove,
}: {
  row: ScheduleRow
  state: WorkspaceState
  actor: Actor
  onAdd: (person: string, projectRoleId: string) => boolean
  onUpdateRole: (id: string, projectRoleId: string) => void
  onRemove: (id: string) => void
}) {
  const may = can(state.model, actor, 'project.staff')
  const members = Object.values(state.projectMembers)
    .filter((m) => m.projectId === row.id && !m.removedAt)
    .sort((a, b) => a.person.localeCompare(b.person))
  const roles = Object.values(state.model.projectRoles).filter((r) => !r.deletedAt)
  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? id

  return (
    <div className="cap-panel">
      <h4 className="est-h">Who is staffed on this</h4>
      <p className="prov">
        A person here can see this project and act on it, whatever else is true of their role.
        The badge beside their name is descriptive — it does not change what they may do.
      </p>

      {members.length === 0 ? (
        <div className="panel-note">Nobody is staffed on this project yet.</div>
      ) : (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Project role</th>
              <th>Since</th>
              {may.allowed && <th></th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.person}</td>
                <td>
                  {may.allowed ? (
                    <select
                      value={m.projectRoleId}
                      onChange={(e) => onUpdateRole(m.id, e.target.value)}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    roleLabel(m.projectRoleId)
                  )}
                </td>
                <td className="mono">{m.addedAt.slice(0, 10)}</td>
                {may.allowed && (
                  <td className="mono">
                    <button className="btn-link" onClick={() => onRemove(m.id)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {may.allowed ? (
        <AddMemberForm
          people={Object.values(state.model.people).map((p) => p.name)}
          roles={roles}
          onAdd={onAdd}
        />
      ) : (
        <p className="prov">{may.reason}</p>
      )}
    </div>
  )
}

function AddMemberForm({
  people,
  roles,
  onAdd,
}: {
  people: string[]
  roles: { id: string; label: string }[]
  onAdd: (person: string, projectRoleId: string) => boolean
}) {
  const [person, setPerson] = useState('')
  const [projectRoleId, setRole] = useState(roles[0]?.id ?? '')
  const [refused, setRefused] = useState(false)

  const submit = () => {
    if (!person.trim() || !projectRoleId) return
    const ok = onAdd(person, projectRoleId)
    if (ok) {
      setPerson('')
      setRefused(false)
    } else {
      setRefused(true)
    }
  }

  return (
    <div className="time-form">
      <div className="time-row">
        <label className="fld time-fld-person">
          <span className="fld-label">Who</span>
          <input
            value={person}
            onChange={(e) => {
              setPerson(e.target.value)
              setRefused(false)
            }}
            list="projmem-people"
            placeholder="Name from the directory"
          />
          <datalist id="projmem-people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="fld">
          <span className="fld-label">Project role</span>
          <select value={projectRoleId} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" onClick={submit} disabled={!person.trim()}>
          Add
        </button>
      </div>
      {refused && <p className="panel-note">Not added — check the name matches exactly one person in the directory.</p>}
    </div>
  )
}
