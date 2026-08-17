'use client'

import { useMemo, useState } from 'react'
import type { Actor } from '@/lib/actor'
import { can } from '@/lib/access'
import {
  capacityFor,
  describeCapacity,
  planCheck,
  type Allocation,
  profilesAt,
} from '@/lib/capacity'
import { summarise } from '@/lib/estimation'
import type { ScheduleRow } from '@/lib/types'
import type { WorkspaceState } from '@/lib/workspace'
import { addDays } from '@/lib/dates'

/**
 * Who is committed to this project, and whether the plan can be delivered by them.
 *
 * Two numbers sit at the bottom of this panel that come from opposite ends of the product and
 * are never otherwise compared: what the work is estimated to need, and what has actually been
 * set aside for it. A firm discovers the gap between them in week six. It was visible in week
 * one, and this is where.
 *
 * The window matters and is therefore explicit rather than inferred. Capacity is always
 * "between these dates" — a person is not over-committed in the abstract — so the panel picks
 * the project's own span where it has one and offers the next quarter where it does not, and
 * says which it used.
 */
export default function CapacityPanel({
  row,
  state,
  actor,
  allRows,
  today,
  onAllocate,
  onRelease,
}: {
  row: ScheduleRow
  state: WorkspaceState
  actor: Actor
  allRows: ScheduleRow[]
  today: string
  onAllocate: (a: {
    person: string
    startDate: string
    endDate: string
    percentage: number
    note: string
    acceptOverallocation?: boolean
  }) => boolean
  onRelease: (id: string) => void
}) {
  const may = can(state.model, actor, 'capacity.allocate')

  const [from, setFrom] = useState(row.plannedStartDate ?? today)
  const [to, setTo] = useState(row.plannedEndDate ?? addDays(today, 90))

  const allocations = useMemo(
    () => Object.values(state.allocations).filter((a) => a.projectId === row.id && !a.deletedAt),
    [state.allocations, row.id],
  )

  /** Everything filed beneath this project, however many tiers down. */
  const issueIds = useMemo(() => {
    const wanted = new Set<string>([row.id])
    let grew = true
    while (grew) {
      grew = false
      for (const n of Object.values(state.nodes)) {
        if (!n.deletedAt && n.parentId && wanted.has(n.parentId) && !wanted.has(n.id)) {
          wanted.add(n.id)
          grew = true
        }
      }
    }
    return Object.values(state.issues)
      .filter((i) => !i.deletedAt && wanted.has(i.parentId))
      .map((i) => i.id)
  }, [state.nodes, state.issues, row.id])

  const { plannedHours, unestimated } = useMemo(() => {
    let hours = 0
    let missing = 0
    for (const id of issueIds) {
      const estimate = state.estimates[id]
      const h = estimate ? summarise(estimate, state.model.sizeBands).effortHours : null
      if (h === null) missing += 1
      else hours += h
    }
    return { plannedHours: hours, unestimated: missing }
  }, [issueIds, state.estimates, state.model.sizeBands])

  const peopleByName = useMemo(() => {
    const out: Record<string, string> = {}
    for (const p of Object.values(state.model.people)) out[p.name.toLowerCase()] = p.id
    return out
  }, [state.model.people])

  const check = useMemo(
    () =>
      planCheck(
        plannedHours,
        unestimated,
        Object.values(state.allocations),
        state.model.resourceProfiles,
        peopleByName,
        row.id,
        from,
        to,
      ),
    [plannedHours, unestimated, state.allocations, state.model.resourceProfiles, state.versions, peopleByName, row.id, from, to],
  )

  const positions = useMemo(() => {
    const names = [...new Set(allocations.map((a) => a.person))]
    return names.map((person) => {
      const personId = peopleByName[person.toLowerCase()]
      return capacityFor(
        person,
        profilesAt(Object.values(state.versions), state.model.resourceProfiles, from)[personId],
        Object.values(state.commitments),
        Object.values(state.allocations),
        from,
        to,
      )
    })
  }, [allocations, peopleByName, state.model.resourceProfiles, state.commitments, state.allocations, from, to])

  return (
    <div className="cap-panel">
      <div className="comm-head">
        <h4 className="est-h">Who is committed to this</h4>
        <label className="fld">
          <span className="fld-label">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="fld">
          <span className="fld-label">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="prov">
        {row.plannedStartDate && row.plannedEndDate
          ? "The project's own dates. Change them here to ask a different question."
          : 'This project has no dates, so the next ninety days are used.'}
      </p>

      {allocations.length === 0 ? (
        <p className="panel-note">
          Nobody is committed to this project. Whatever is planned here is planned against
          nobody&rsquo;s time.
        </p>
      ) : (
        <table className="cfg-table est-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Share</th>
              <th>From</th>
              <th>To</th>
              <th>Where that leaves them</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {allocations.map((a) => {
              const position = positions.find((p) => p.person === a.person)
              return (
                <tr key={a.id}>
                  <td>{a.person}</td>
                  <td className="mono">{a.percentage}%</td>
                  <td className="mono">{a.startDate}</td>
                  <td className="mono">{a.endDate}</td>
                  <td className={position?.overallocated ? 'est-over' : ''}>
                    {position ? describeCapacity(position) : '—'}
                  </td>
                  <td>
                    {may.allowed && (
                      <button className="btn-link" onClick={() => onRelease(a.id)}>
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {may.allowed ? (
        <AllocateForm
          people={Object.values(state.model.people).map((p) => p.name)}
          defaultFrom={from}
          defaultTo={to}
          onAllocate={onAllocate}
        />
      ) : (
        <p className="prov">{may.reason}</p>
      )}

      <h4 className="est-h">Can this be delivered?</h4>
      <div className="comm-figures">
        <div>
          <span className="est-block-label">Plan needs</span>
          <span className="mono">{check.plannedHours}h</span>
        </div>
        <div>
          <span className="est-block-label">Committed</span>
          <span className="mono">{check.allocatedHours}h</span>
        </div>
        <div>
          <span className="est-block-label">Shortfall</span>
          <span className={`mono${check.possible ? '' : ' est-over'}`}>
            {check.shortfallHours > 0 ? `${check.shortfallHours}h` : 'none'}
          </span>
        </div>
      </div>
      <p className={`comm-position${check.possible ? '' : ' warn'}`}>
        {check.possible
          ? `The people committed to this project have enough time between ${from} and ${to} for what is planned.`
          : `The plan needs ${check.shortfallHours}h more than has been committed to it between ${from} and ${to}.`}
        {check.unestimatedCount > 0 &&
          ` ${check.unestimatedCount} record${check.unestimatedCount === 1 ? ' has' : 's have'} no estimate, so the figure cannot see ${check.unestimatedCount === 1 ? 'it' : 'them'}.`}
      </p>
      <p className="panel-note">
        Nothing here schedules anybody. It answers whether what has been decided is possible —
        an optimiser that reassigned work on capacity grounds would be making delivery decisions
        from a model that cannot see skill, client relationship, or who was on the call last week.
      </p>
    </div>
  )
}

function AllocateForm({
  people,
  defaultFrom,
  defaultTo,
  onAllocate,
}: {
  people: string[]
  defaultFrom: string
  defaultTo: string
  onAllocate: (a: {
    person: string
    startDate: string
    endDate: string
    percentage: number
    note: string
    acceptOverallocation?: boolean
  }) => boolean
}) {
  const [person, setPerson] = useState('')
  const [startDate, setStart] = useState(defaultFrom)
  const [endDate, setEnd] = useState(defaultTo)
  const [percentage, setPct] = useState('50')
  const [note, setNote] = useState('')
  /**
   * Only offered after a refusal.
   *
   * Showing "commit anyway" before anybody has been told there is a problem invites it to be
   * ticked as a matter of course, which turns a control into a formality.
   */
  const [refused, setRefused] = useState(false)

  const submit = (acceptOverallocation?: boolean) => {
    if (!person.trim()) return
    const ok = onAllocate({
      person,
      startDate,
      endDate,
      percentage: Number(percentage) || 0,
      note,
      acceptOverallocation,
    })
    if (ok) {
      setPerson('')
      setNote('')
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
            list="cap-people"
            placeholder="Name from the directory"
          />
          <datalist id="cap-people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label className="fld">
          <span className="fld-label">From</span>
          <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="fld">
          <span className="fld-label">To</span>
          <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="fld time-fld-hours">
          <span className="fld-label">Share %</span>
          <input type="number" min={1} max={100} value={percentage} onChange={(e) => setPct(e.target.value)} />
        </label>
        <label className="fld time-fld-note">
          <span className="fld-label">Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </label>
        <button className="btn primary" onClick={() => submit()} disabled={!person.trim()}>
          Commit
        </button>
      </div>
      {refused && (
        <div className="time-row">
          <p className="ov-gate" style={{ flex: 1 }}>
            That is more time than they have. If it is the decision, say so — it will be recorded
            as one, with the numbers.
          </p>
          <button className="btn" onClick={() => submit(true)}>
            Commit anyway
          </button>
        </div>
      )}
    </div>
  )
}
