import type { WorkspaceState } from './workspace'

/**
 * One person's month, four kinds of things gathered onto it. Reuses only the SHAPE of
 * `calendarMonth`'s padding algorithm (Monday-first weeks, padded to whole weeks —
 * `./calendar.ts`), not its signature: that module is typed to `ScheduleRow[]`, a homogeneous
 * collection where every row has (or lacks) one planned end. This aggregates four heterogeneous
 * kinds into one grid, which is a different enough question to be its own module — the same
 * reasoning `projectView` is a separate function from `clientView` rather than one function
 * doing both.
 *
 * A deliberate correction from the design's own sketch: `IssueRecord`'s planned-date fields are
 * `plannedStart`/`plannedEnd`, not `plannedStartDate`/`plannedEndDate` — that naming belongs to
 * `ScheduleRow`, a derived type the full tree-building pipeline produces. Reading `state.issues`
 * directly avoids needing that pipeline inside a function with no I/O and no framework.
 */

export type MyCalendarEntry =
  | { kind: 'event'; id: string; title: string; date: string; allDay: boolean }
  | { kind: 'commitment'; id: string; label: string; date: string }
  | { kind: 'allocation'; id: string; label: string; date: string }
  | { kind: 'work'; id: string; issueId: string; title: string; date: string }

export interface MyCalendarDay {
  date: string
  entries: MyCalendarEntry[]
}

export interface MyCalendarMonth {
  monthStart: string
  weeks: MyCalendarDay[][]
  /** Owned work with no planned end — cannot be on any calendar. Listed, not dropped, the same
   *  honesty `calendarMonth`'s own `undated` list already established. */
  unscheduled: { issueId: string; title: string }[]
}

/** Every day, inclusive, a span covers — clipped to nothing here; clipping happens at the grid. */
function daysOf(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = new Date(`${start}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10)
    out.push(iso)
    if (iso >= end) break
  }
  return out
}

/** `monthIso` is any ISO date inside the wanted month. `personId` is the reader's own — this
 *  is called only after `redactForReader` has already narrowed `state` to their own rows, so
 *  no further ownership filtering happens here for events/commitments/allocations; the work
 *  join is the one case that still needs an explicit "is this mine" check, since issues are
 *  not owner-redacted the way personal events are. */
export function myCalendarMonth(
  state: WorkspaceState,
  personId: string | null,
  monthIso: string,
): MyCalendarMonth {
  const anchor = monthIso.slice(0, 7)
  const first = `${anchor}-01`
  const firstDate = new Date(`${first}T00:00:00Z`)
  const daysInMonth = new Date(Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + 1, 0)).getUTCDate()
  const last = `${anchor}-${String(daysInMonth).padStart(2, '0')}`

  const byDay = new Map<string, MyCalendarEntry[]>()
  const push = (date: string, entry: MyCalendarEntry) => {
    if (date < first || date > last) return
    const list = byDay.get(date) ?? []
    list.push(entry)
    byDay.set(date, list)
  }

  for (const e of Object.values(state.personalEvents)) {
    if (e.deletedAt || e.personId !== personId) continue
    for (const d of daysOf(e.startAt.slice(0, 10), e.endAt.slice(0, 10))) {
      push(d, { kind: 'event', id: e.id, title: e.title, date: d, allDay: e.allDay })
    }
  }

  for (const c of Object.values(state.commitments)) {
    if (c.deletedAt || c.personId !== personId) continue
    for (const d of daysOf(c.startDate, c.endDate)) {
      // A leave request that is not yet a fact says so — shown, never hidden, per the E1
      // design's conflict posture; a returned one says that instead of quietly vanishing.
      push(d, {
        kind: 'commitment',
        id: c.id,
        label:
          c.kind === 'Leave' && c.status === 'Requested'
            ? 'Leave (requested)'
            : c.kind === 'Leave' && c.status === 'Returned'
              ? 'Leave (returned)'
              : c.kind,
        date: d,
      })
    }
  }

  for (const a of Object.values(state.allocations)) {
    if (a.deletedAt || a.personId !== personId) continue
    for (const d of daysOf(a.startDate, a.endDate)) {
      push(d, { kind: 'allocation', id: a.id, label: `${a.percentage}% allocated`, date: d })
    }
  }

  // The same id-aware, name-fallback join `lib/mywork.ts`'s `isMine` already uses: the id wins
  // the moment both sides have one, and the name fallback exists only for rows written before
  // the identity-id migration — it must not silently exclude everyone whose issues predate it.
  const myName = personId ? (state.model.people[personId]?.name.trim().toLowerCase() ?? null) : null
  const isMine = (owner: string, ownerId?: string | null): boolean =>
    ownerId ? ownerId === personId : Boolean(myName) && owner.trim().toLowerCase() === myName

  const unscheduled: { issueId: string; title: string }[] = []
  for (const i of Object.values(state.issues)) {
    if (i.deletedAt) continue
    if (!isMine(i.owner, i.ownerId)) continue
    if (!i.plannedEnd) {
      unscheduled.push({ issueId: i.id, title: i.subject })
      continue
    }
    const start = i.plannedStart && i.plannedStart <= i.plannedEnd ? i.plannedStart : i.plannedEnd
    for (const d of daysOf(start, i.plannedEnd)) {
      push(d, { kind: 'work', id: `work:${i.id}:${d}`, issueId: i.id, title: i.subject, date: d })
    }
  }

  const lead = (firstDate.getUTCDay() + 6) % 7
  const cells: MyCalendarDay[] = []
  for (let n = 0; n < lead; n++) {
    const d = new Date(firstDate)
    d.setUTCDate(d.getUTCDate() - (lead - n))
    const iso = d.toISOString().slice(0, 10)
    cells.push({ date: iso, entries: [] })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${anchor}-${String(day).padStart(2, '0')}`
    cells.push({ date: iso, entries: byDay.get(iso) ?? [] })
  }
  while (cells.length % 7) {
    const prev = new Date(`${cells[cells.length - 1].date}T00:00:00Z`)
    prev.setUTCDate(prev.getUTCDate() + 1)
    cells.push({ date: prev.toISOString().slice(0, 10), entries: [] })
  }
  const weeks: MyCalendarDay[][] = []
  for (let n = 0; n < cells.length; n += 7) weeks.push(cells.slice(n, n + 7))

  return { monthStart: first, weeks, unscheduled }
}
