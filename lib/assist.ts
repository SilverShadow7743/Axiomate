import { portfolio } from './portfolio'
import { forecastFor, describeForecast } from './forecast'
import { availabilityFor } from './availability'
import { profileAt } from './capacity'
import { directoryIdByName } from './access'
import { holidaySetOf } from './config'
import { addDays } from './dates'
import type { DiscussionMessage, DiscussionScopeKind } from './discussion'
import type { WorkspaceState } from './workspace'

/**
 * What the model gets shown — E5 (`2026-08-30-e5-ai-design.md`), the pure half.
 *
 * Both builders run in the BROWSER against the state the reader already holds, which is the
 * whole safety argument: `boot()` redacted that state for this reader before it arrived, so
 * a payload derived from it cannot carry what the reader may not see. Neither builder
 * touches `state.rates`, a commitment's private `reason`, or anything `clientView` empties —
 * and scenario E5A does not take that on faith: it plants sentinel values in a fixture and
 * scans the SERIALIZED payload for them, because a field-name check misses a value smuggled
 * under another key.
 *
 * Caps are stated, never silent — the same posture as MAX_INDEX_ROWS: a truncated payload
 * says it was truncated, so the model's answer can say so too.
 */

/* ================================================================== *
 * Narration — the Portfolio's figures as one structure
 * ================================================================== */

export interface NarrationFigures {
  today: string
  /** Workspace-level counts, from the same rows every screen derives. */
  totals: { open: number; overdue: number; blocked: number; done: number }
  /** One entry per portfolio line: the concern phrases exactly as the panel shows them. */
  lines: {
    name: string
    client: string
    status: string
    open: number
    high: number
    concerns: string[]
  }[]
  /** Forecast sentences for open records carrying an estimate and a future date. */
  forecasts: string[]
  /** Availability headlines for people with allocations, next four weeks. */
  availability: string[]
  /** Stated truncation, when any list was cut. */
  truncated: string[]
}

const MAX_LINES = 30
const MAX_FORECASTS = 20
const MAX_AVAILABILITY = 15

export function narrationFigures(state: WorkspaceState, today: string): NarrationFigures {
  const truncated: string[] = []
  const openIssues = Object.values(state.issues).filter((i) => !i.deletedAt && !i.actualEnd)

  const allLines = portfolio(state, today)
  const lines = allLines.slice(0, MAX_LINES).map((l) => ({
    name: l.name,
    client: l.client,
    status: l.status,
    open: l.open,
    high: l.high,
    concerns: l.concerns.map((c) => c.phrase),
  }))
  if (allLines.length > MAX_LINES) truncated.push(`${allLines.length - MAX_LINES} portfolio lines not shown`)

  const holidays = holidaySetOf(state.model)
  const forecasts: string[] = []
  for (const i of openIssues) {
    if (forecasts.length >= MAX_FORECASTS) {
      truncated.push('further forecasts not shown')
      break
    }
    if (!state.estimates[i.id] || !i.plannedEnd || i.plannedEnd <= today) continue
    const ownerId = directoryIdByName(state.model, i.owner)
    const f = forecastFor({
      issueId: i.id,
      owner: i.owner,
      ownerId,
      plannedEnd: i.plannedEnd,
      estimate: state.estimates[i.id],
      bands: state.model.sizeBands,
      timeEntries: state.timeEntries,
      profile: profileAt(Object.values(state.versions), state.model.resourceProfiles, ownerId ?? '', today),
      commitments: Object.values(state.commitments),
      allocations: Object.values(state.allocations),
      today,
      holidays,
      meetings: Object.values(state.meetings),
    })
    forecasts.push(`${i.id} “${i.subject}”: ${describeForecast(f, i.owner)}`)
  }

  const availability: string[] = []
  const windowTo = addDays(today, 27)
  const allocatedNames = [...new Set(Object.values(state.allocations).filter((a) => !a.deletedAt).map((a) => a.person))]
  for (const name of allocatedNames.slice(0, MAX_AVAILABILITY)) {
    const pid = directoryIdByName(state.model, name)
    const p = availabilityFor(
      name,
      profileAt(Object.values(state.versions), state.model.resourceProfiles, pid ?? '', today),
      Object.values(state.commitments),
      Object.values(state.allocations),
      today,
      windowTo,
      pid,
      holidays,
      Object.values(state.meetings),
    )
    availability.push(
      `${name}: ${p.remainingHours}h remaining of ${p.availableHours}h available over four weeks` +
        (p.meetingHours ? ` (${p.meetingHours}h in meetings)` : '') +
        (p.pendingLeave.length ? `; ${p.pendingLeave.length} leave request(s) undecided` : ''),
    )
  }
  if (allocatedNames.length > MAX_AVAILABILITY) truncated.push(`${allocatedNames.length - MAX_AVAILABILITY} people not shown`)

  return {
    today,
    totals: {
      open: openIssues.length,
      overdue: openIssues.filter((i) => i.plannedEnd && i.plannedEnd < today).length,
      blocked: openIssues.filter((i) => i.status === 'Needs clarification').length,
      done: Object.values(state.issues).filter((i) => !i.deletedAt && Boolean(i.actualEnd)).length,
    },
    lines,
    forecasts,
    availability,
    truncated,
  }
}

/* ================================================================== *
 * Thread→work — the messages as a bounded request
 * ================================================================== */

export interface SuggestRequest {
  scopeKind: DiscussionScopeKind
  scopeId: string
  /** The record's or project's display name — context, not authority. */
  scopeName: string
  /** Author-attributed lines, stubs excluded, caps stated. */
  messages: { author: string; text: string }[]
  truncated: boolean
}

const MAX_SUGGEST_MESSAGES = 40
const MAX_SUGGEST_CHARS = 800

export function suggestRequest(
  messages: DiscussionMessage[],
  scope: { kind: DiscussionScopeKind; id: string; name: string },
): SuggestRequest {
  const live = messages.filter((m) => !m.deletedAt)
  const kept = live.slice(-MAX_SUGGEST_MESSAGES)
  return {
    scopeKind: scope.kind,
    scopeId: scope.id,
    scopeName: scope.name,
    messages: kept.map((m) => ({
      author: m.author,
      text: m.body.length > MAX_SUGGEST_CHARS ? `${m.body.slice(0, MAX_SUGGEST_CHARS - 1)}…` : m.body,
    })),
    truncated: live.length > kept.length || live.some((m) => m.body.length > MAX_SUGGEST_CHARS),
  }
}
