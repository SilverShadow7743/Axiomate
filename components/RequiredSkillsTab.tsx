'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import { liveSkills } from '@/lib/config'
import { candidatesFor, levelLabel, SKILL_LEVELS, type Requirement, type SkillLevel } from '@/lib/skills'
import type { WorkspaceState } from '@/lib/workspace'

/**
 * What this piece of work needs, and who could do it.
 *
 * The requirement is typed here, once, by a person who knows the work — never inferred from
 * module or type. `candidatesFor` (`lib/skills.ts`) does the matching; this tab is the one place
 * that actually calls it, which until today nothing did. Candidates, never a recommendation —
 * see that module's own doctrine on why there is no ranking.
 */
export default function RequiredSkillsTab({
  issueId,
  state,
  actor,
  today,
  onSave,
}: {
  issueId: string
  state: WorkspaceState
  actor: Actor
  today: string
  onSave: (requiredSkills: Requirement[]) => void
}) {
  const issue = state.issues[issueId]
  const requirements = useMemo(() => issue?.requiredSkills ?? [], [issue])
  const skills = useMemo(() => liveSkills(state.model), [state.model])
  const mayEdit = can(state.model, actor, 'work.edit')

  const [skillId, setSkillId] = useState('')
  const [level, setLevel] = useState<SkillLevel>('working')

  const match = useMemo(
    () => candidatesFor(requirements, Object.values(state.personSkills), skills, today),
    [requirements, state.personSkills, skills, today],
  )

  const skillName = (id: string) => skills.find((s) => s.id === id)?.name ?? id

  const add = () => {
    if (!skillId) return
    if (requirements.some((r) => r.skillId === skillId)) return
    onSave([...requirements, { skillId, level }])
    setSkillId('')
  }

  const remove = (id: string) => {
    onSave(requirements.filter((r) => r.skillId !== id))
  }

  if (skills.length === 0) {
    return (
      <div className="cfg-empty">
        The skill catalogue is empty — Configuration → Skills has nothing to require yet. Once a
        firm's own skills are entered there, they become choosable here.
      </div>
    )
  }

  return (
    <div className="notes">
      {requirements.length === 0 ? (
        <div className="cfg-empty">
          Nothing required yet. Typing a requirement here is what lets "who could do this" be
          answered from the directory instead of from memory.
        </div>
      ) : (
        <ol className="note-list">
          {requirements.map((r) => (
            <li className="note" key={r.skillId}>
              <div className="note-head">
                <span style={{ flex: 1 }}>
                  {skillName(r.skillId)} <span className="prov">— at least {levelLabel(r.level)}</span>
                </span>
                {mayEdit.allowed && (
                  <button className="btn ghost" onClick={() => remove(r.skillId)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {mayEdit.allowed && (
        <div className="note-compose-row">
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)} aria-label="Skill">
            <option value="">Choose a skill…</option>
            {skills
              .filter((s) => !requirements.some((r) => r.skillId === s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value as SkillLevel)} aria-label="Minimum level">
            {SKILL_LEVELS.map((l) => (
              <option key={l.key} value={l.key}>At least {l.label}</option>
            ))}
          </select>
          <button className="btn primary" disabled={!skillId} onClick={add}>
            Add
          </button>
        </div>
      )}

      {requirements.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h5 className="est-h">Who could do this</h5>
          <p className="prov">
            Candidates, not a recommendation — this reads recorded skill only. It does not know
            who is available, who costs what, or who the client already trusts.
            {match.unreadable > 0 && ` ${match.unreadable} record${match.unreadable === 1 ? '' : 's'} could not be read.`}
          </p>
          {match.qualified.length === 0 && match.partial.length === 0 ? (
            <p className="cfg-empty">Nobody in the directory meets any of this yet.</p>
          ) : (
            <>
              {match.qualified.length > 0 && (
                <>
                  <p className="prov"><b>Meets every requirement</b></p>
                  <ul>
                    {match.qualified.map((c) => (
                      <li key={c.personId}>
                        {state.model.people[c.personId]?.name ?? c.personId} — {levelLabel(c.level)}
                        {c.stale && <span className="est-block-note"> · not used recently</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {match.partial.length > 0 && (
                <>
                  <p className="prov"><b>Meets some of it</b></p>
                  <ul>
                    {match.partial.map((c) => (
                      <li key={c.personId}>
                        {state.model.people[c.personId]?.name ?? c.personId}
                        {' — misses '}
                        {c.misses.map((m) => skillName(m.skillId)).join(', ')}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
