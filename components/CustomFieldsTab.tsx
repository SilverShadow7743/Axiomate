'use client'

import { useMemo } from 'react'
import type { Actor } from '@/lib/actor'
import { customFieldsFor } from '@/lib/config'
import { projectOf, type WorkspaceState } from '@/lib/workspace'

/**
 * A firm's own fields on this issue. See `docs/plans/2026-09-08-custom-fields-design.md`.
 *
 * Written through `updateIssue`'s existing patch path, same as `RequiredSkillsTab` — no new
 * action, no new permission, gated on `work.edit` like every other Overview field. Only fields
 * live on this issue's own project actually render; a field defined but not yet assigned to
 * this project is simply absent, not shown disabled.
 */
export default function CustomFieldsTab({
  issueId,
  state,
  onSave,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  onSave: (customFields: Record<string, string>) => void
}) {
  const issue = state.issues[issueId]
  const values = useMemo(() => issue?.customFields ?? {}, [issue])
  const projectId = useMemo(() => projectOf(state, issueId), [state, issueId])
  const fields = useMemo(() => customFieldsFor(state.model, projectId), [state.model, projectId])

  const set = (fieldId: string, value: string) => {
    if (value) onSave({ ...values, [fieldId]: value })
    else {
      const next = { ...values }
      delete next[fieldId]
      onSave(next)
    }
  }

  if (fields.length === 0) {
    return (
      <div className="cfg-empty">
        No custom fields are live on this project yet. Configuration → Custom fields defines
        them and opts them into a project.
      </div>
    )
  }

  return (
    <div className="notes">
      {fields.map((f) => {
        const value = values[f.id] ?? ''
        return (
          <label className="cfg-fld" key={f.id}>
            <span>{f.name}</span>
            {f.fieldType === 'select' ? (
              <select value={value} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">Not set</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : f.fieldType === 'date' ? (
              <input type="date" value={value} onChange={(e) => set(f.id, e.target.value)} />
            ) : f.fieldType === 'number' ? (
              <input type="number" value={value} onChange={(e) => set(f.id, e.target.value)} />
            ) : (
              <input value={value} onChange={(e) => set(f.id, e.target.value)} />
            )}
          </label>
        )
      })}
    </div>
  )
}
