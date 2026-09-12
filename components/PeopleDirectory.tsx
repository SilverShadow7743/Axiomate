'use client'

import { useMemo, useRef, useState } from 'react'
import { useOverlay } from './useOverlay'
import { useQuickFilterFocus } from './useQuickFilterFocus'
import { can } from '@/lib/access'
import { formatIso } from '@/lib/dates'
import { liveRoles } from '@/lib/config'
import type { Actor } from '@/lib/actor'
import type { ConfigOp, WorkspaceState } from '@/lib/workspace'

/**
 * Every colleague, in one browsable list — the front door `ProfilePanel` never had, and since
 * 12 Sep 2026 an F&O list page in full: a quick filter that also matches address, title and
 * role; the name as the link; sortable columns; a status chip; and the list's one primary
 * action, **New person**, for a `config.manage` holder — the onboarding form the People
 * configuration card carries, brought to where people are looked for. Same `upsertPerson`
 * dispatch, same fields, no new permission.
 *
 * It reads `state.model.people` exactly as the config card already does and adds no new data
 * or redaction. See `docs/plans/2026-09-08-people-directory-onboarding-design.md`.
 */
type SortKey = 'name' | 'joined' | 'status' | 'title'

export default function PeopleDirectory({
  state,
  actor,
  onOpenProfile,
  onConfig,
  docked = false,
  onClose,
}: {
  state: WorkspaceState
  actor: Actor
  onOpenProfile: (personId: string) => void
  /** The configuration funnel; absent means the list is read-only whatever the actor holds. */
  onConfig?: (op: ConfigOp) => boolean
  docked?: boolean
  onClose?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  useOverlay(rootRef, !docked, onClose)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const quick = useRef<HTMLInputElement>(null)
  useQuickFilterFocus(quick)

  const model = state.model
  const mayConfigure = Boolean(onConfig) && can(model, actor, 'config.manage').allowed
  const roleLabel = (id: string) => model.roles[id]?.label ?? id

  const people = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const all = Object.values(model.people).filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q) ||
        (p.title ?? '').toLowerCase().includes(q) ||
        p.roleIds.some((r) => roleLabel(r).toLowerCase().includes(q)),
    )
    const dir = sort.dir
    const cmp = (a: (typeof all)[number], b: (typeof all)[number]) => {
      switch (sort.key) {
        case 'joined':
          return ((a.joinedOn ?? '') || '9999').localeCompare((b.joinedOn ?? '') || '9999') * dir
        case 'status':
          return ((a.status === 'Departed' ? 1 : 0) - (b.status === 'Departed' ? 1 : 0)) * dir
        case 'title':
          return (a.title ?? '').localeCompare(b.title ?? '') * dir
        default:
          return a.name.localeCompare(b.name) * dir
      }
    }
    // Active first, then the chosen order — a departed colleague is still findable, just not
    // first in a list most visits are about who's here now.
    return all.sort((a, b) => {
      if (sort.key !== 'status') {
        const da = a.status === 'Departed' ? 1 : 0
        const db = b.status === 'Departed' ? 1 : 0
        if (da !== db) return da - db
      }
      return cmp(a, b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roleLabel reads model.roles, which is listed
  }, [model.people, model.roles, filter, sort])

  const activeCount = Object.values(model.people).filter((p) => p.status !== 'Departed').length
  const total = Object.keys(model.people).length

  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className="th-sort"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )

  /* ---------------- New person ---------------- */
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', email: '', title: '', joinedOn: '', managerId: '', roleId: '' })
  const roles = liveRoles(model)
  const submitNew = () => {
    if (!onConfig || !draft.name.trim()) return
    const ok = onConfig({
      k: 'upsertPerson',
      id: null,
      name: draft.name,
      roleIds: draft.roleId ? [draft.roleId] : [],
      ...(draft.email.trim() ? { email: draft.email.trim() } : {}),
      ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
      ...(draft.joinedOn ? { joinedOn: draft.joinedOn } : {}),
      ...(draft.managerId ? { managerId: draft.managerId } : {}),
    })
    // Cleared only on success, so a refused name — one already in the directory, or an
    // address somebody else holds — is still in the box to correct rather than retyped.
    if (ok) {
      setDraft({ name: '', email: '', title: '', joinedOn: '', managerId: '', roleId: '' })
      setAdding(false)
      setFilter('')
    }
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only dismissal; keyboard path is Escape via useOverlay */}
      {!docked && <div className="drawer-scrim" onMouseDown={onClose} />}
      <aside
        className={`evi mywork${docked ? ' docked' : ''}`}
        ref={rootRef}
        role={docked ? undefined : 'dialog'}
        aria-modal={docked ? undefined : true}
        aria-labelledby="people-dir-title"
      >
        <header className="evi-head">
          <div className="evi-head-top">
            <h2 id="people-dir-title">People</h2>
            {mayConfigure && (
              <button className="btn primary" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
                + New person
              </button>
            )}
            {!docked && (
              <button className="btn ghost" onClick={onClose} aria-label="Close people directory">
                ✕
              </button>
            )}
          </div>
          <div className="evi-sub sentence">
            {activeCount} active{total !== activeCount ? `, ${total - activeCount} departed` : ''} — open a name for the full page.
          </div>
        </header>

        <div className="evi-list">
          {adding && mayConfigure && (
            <div className="cfg-card person-new" role="group" aria-label="New person">
              <div className="cfg-fld-row">
                <label className="cfg-fld">
                  <span>Full name</span>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submitNew()} />
                </label>
                <label className="cfg-fld">
                  <span>Work address</span>
                  <input type="email" value={draft.email} placeholder="optional" onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </label>
                <label className="cfg-fld">
                  <span>Title</span>
                  <input value={draft.title} placeholder="optional" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </label>
              </div>
              <div className="cfg-fld-row">
                <label className="cfg-fld">
                  <span>Joined</span>
                  <input type="date" value={draft.joinedOn} onChange={(e) => setDraft({ ...draft, joinedOn: e.target.value })} />
                </label>
                <label className="cfg-fld">
                  <span>Reports to</span>
                  <select value={draft.managerId} onChange={(e) => setDraft({ ...draft, managerId: e.target.value })}>
                    <option value="">optional</option>
                    {Object.values(model.people)
                      .filter((m) => m.status !== 'Departed')
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="cfg-fld">
                  <span>Initial role</span>
                  <select value={draft.roleId} onChange={(e) => setDraft({ ...draft, roleId: e.target.value })}>
                    <option value="">optional</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="est-actions">
                <button className="btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={!draft.name.trim()} onClick={submitNew}>
                  Add person
                </button>
              </div>
            </div>
          )}

          <div className="cfg-inline">
            <input
              ref={quick}
              type="search"
              value={filter}
              placeholder={`Filter ${total} people by name, address, title or role…`}
              aria-label="Filter people"
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <span className="prov">
                {people.length} of {total}
              </span>
            )}
          </div>

          {people.length === 0 ? (
            <p className="evi-empty">Nobody matches that filter.</p>
          ) : (
            <table className="cfg-table est-table people-list">
              <thead>
                <tr>
                  {header('name', 'Name')}
                  {header('title', 'Title')}
                  <th>Roles</th>
                  <th>Reports to</th>
                  {header('joined', 'Joined')}
                  {header('status', 'Status')}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const manager = p.managerId ? model.people[p.managerId] : null
                  return (
                    <tr key={p.id} className={p.status === 'Departed' ? 'pdir-row-departed' : undefined}>
                      <td>
                        <button className="btn-link" onClick={() => onOpenProfile(p.id)}>
                          {p.name}
                        </button>
                        {p.email && <div className="prov">{p.email}</div>}
                      </td>
                      <td>{p.title || <span className="prov">—</span>}</td>
                      <td>{p.roleIds.length ? p.roleIds.map(roleLabel).join(', ') : <span className="prov">no role</span>}</td>
                      <td>
                        {manager ? (
                          <button className="btn-link" onClick={() => onOpenProfile(manager.id)}>
                            {manager.name}
                          </button>
                        ) : (
                          <span className="prov">—</span>
                        )}
                      </td>
                      <td className="mono">{p.joinedOn ? formatIso(p.joinedOn) : <span className="prov">—</span>}</td>
                      <td>
                        <span className={`dt-status${p.status === 'Departed' ? ' departed' : ''}`}>
                          {p.status === 'Departed' ? `Departed${p.departedOn ? ` ${formatIso(p.departedOn)}` : ''}` : 'Active'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  )
}
