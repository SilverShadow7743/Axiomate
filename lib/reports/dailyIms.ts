import type { ScheduleRow } from '../types'
import type { WorkspaceState } from '../workspace'
import { isTerminal } from '../schedule'
import { formatIso } from '../dates'

/**
 * Daily IMS — Issue Management Status.
 *
 * ---------------------------------------------------------------------------
 * Assumptions, stated because they were decisions rather than requirements
 *
 * The requirement arrived as three words, so these are choices this file made and the reader
 * should be able to overturn them without archaeology:
 *
 *  - **IMS is read as Issue Management Status.** Nothing in the source log expands it.
 *  - **Scope follows the workspace.** The report covers exactly the rows the user is looking
 *    at, filters and all, and says so in its header. The alternative — a scope picker — asks
 *    a question the screen has already answered, and a report whose contents disagree with
 *    the grid behind it is the kind of thing people stop trusting after one occurrence.
 *  - **A day is the 24 hours before the report's date**, not "since the last export", because
 *    nothing records when the last export happened.
 *
 * ---------------------------------------------------------------------------
 * Provenance
 *
 * Every figure below is counted from records or from the audit trail; none is estimated, and
 * nothing is carried forward from a previous report because none is stored. Two limits are
 * therefore real and are printed *in the report itself* rather than left for someone to
 * discover:
 *
 *  - Movement is read from the audit trail, which is capped and — with no database — lives in
 *    one browser. A quiet day and an unavailable trail look identical from the outside, so the
 *    report distinguishes them explicitly.
 *  - The imported log records no due dates, so "overdue" can only ever describe records
 *    somebody has scheduled here. That is a property of the source, not a gap in the report.
 */

export interface ImsLine {
  id: string
  subject: string
  owner: string
  status: string
  severity: string
  health: string
  due: string
  lastActivity: string
  nextAction: string
}

export interface ImsSection {
  title: string
  /** Why this section exists, printed under the heading. */
  note: string
  lines: ImsLine[]
}

export interface DailyIms {
  scope: string
  asAt: string
  /** Counted, not estimated — see the module comment. */
  position: {
    total: number
    open: number
    closed: number
    high: number
    medium: number
    low: number
    overdue: number
    atRisk: number
    blocked: number
    unscheduled: number
  }
  movement: {
    /** False when the trail holds nothing at all for the window, which is not the same as a quiet day. */
    trailAvailable: boolean
    raised: string[]
    closed: string[]
    statusChanges: { id: string; from: string; to: string; by: string }[]
    notesAdded: { id: string; by: string }[]
    otherEdits: number
  }
  sections: ImsSection[]
  /** Every open row, for the CSV companion. */
  open: ImsLine[]
}

const lineOf = (r: ScheduleRow): ImsLine => ({
  id: r.displayId || r.id,
  subject: r.name,
  owner: r.owner ?? '',
  status: r.status ?? '',
  severity: r.severity ?? '',
  health: r.scheduleHealth,
  due: r.plannedEndDate ?? '',
  lastActivity: r.issue?.lastActivity ?? '',
  nextAction: r.nextAction ?? '',
})

/** Days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

export function buildDailyIms(
  state: WorkspaceState,
  /** The issue rows currently in view — already filtered and sorted by the workspace. */
  rows: ScheduleRow[],
  asAt: string,
  scope: string,
): DailyIms {
  const issues = rows.filter((r) => r.kind === 'issue')
  const open = issues.filter((r) => !isTerminal(r.status))

  const count = (p: (r: ScheduleRow) => boolean) => issues.filter(p).length
  const openCount = (p: (r: ScheduleRow) => boolean) => open.filter(p).length

  /* ---- movement, from the audit trail ---- */

  const since = Date.parse(`${asAt}T00:00:00Z`) - 86_400_000
  const inWindow = state.audit.filter((e) => {
    const t = Date.parse(e.at)
    return !Number.isNaN(t) && t >= since
  })
  const ids = new Set(issues.map((r) => r.id))
  const mine = inWindow.filter((e) => ids.has(e.rowId))

  const statusChanges = mine
    .filter((e) => e.field === 'status')
    .map((e) => ({ id: e.rowId, from: e.from ?? '', to: e.to ?? '', by: e.by }))
  const notesAdded = mine
    .filter((e) => e.field === 'note' && e.from === null)
    .map((e) => ({ id: e.rowId, by: e.by }))
  const closed = statusChanges.filter((c) => isTerminal(c.to as never)).map((c) => c.id)
  const raised = mine.filter((e) => e.field === 'created').map((e) => e.rowId)
  const otherEdits = mine.length - statusChanges.length - notesAdded.length - raised.length

  /* ---- what needs a person ---- */

  const sections: ImsSection[] = []

  const overdue = open.filter((r) => r.scheduleHealth === 'Overdue')
  if (overdue.length) {
    sections.push({
      title: 'Overdue',
      // Worded to survive the change that made this section possible. It once read "the log
      // carries no due dates, so nothing can appear here", which was true until the SLA policy
      // was applied and then quietly wrong — a report explaining why it is empty while listing
      // sixty-nine rows is worse than one that says nothing.
      note: 'Past a due date recorded in this workspace. The imported log carries none, so every date here was either set by hand or applied from the SLA policy.',
      lines: overdue.map(lineOf),
    })
  }

  const blocked = open.filter((r) => r.scheduleHealth === 'Blocked')
  if (blocked.length) {
    sections.push({
      title: 'Blocked',
      note: 'Waiting on a predecessor that is not finished.',
      lines: blocked.map(lineOf),
    })
  }

  const atRisk = open.filter((r) => r.scheduleHealth === 'At Risk')
  if (atRisk.length) {
    sections.push({
      title: 'At risk',
      note: 'Due within the SLA warning window and not yet complete.',
      lines: atRisk.map(lineOf),
    })
  }

  const unowned = open.filter((r) => !r.owner || r.owner === 'Unassigned')
  if (unowned.length) {
    sections.push({
      title: 'No owner',
      note: 'Open with nobody answerable. These do not move on their own.',
      lines: unowned.map(lineOf),
    })
  }

  const noNext = open.filter((r) => r.owner && r.owner !== 'Unassigned' && !r.nextAction?.trim())
  if (noNext.length) {
    sections.push({
      title: 'No next action recorded',
      note: 'Owned, but nothing says what happens next.',
      lines: noNext.map(lineOf),
    })
  }

  const stale = open
    .filter((r) => r.issue?.lastActivity)
    .map((r) => ({ r, idle: daysBetween(r.issue!.lastActivity, asAt) }))
    .filter((x) => x.idle >= 14)
    .sort((a, b) => b.idle - a.idle)
    .slice(0, 15)
  if (stale.length) {
    sections.push({
      title: 'Quiet for two weeks or more',
      note: 'Ordered by how long since anything was recorded against them. Longest first.',
      lines: stale.map((x) => lineOf(x.r)),
    })
  }

  return {
    scope,
    asAt,
    position: {
      total: issues.length,
      open: open.length,
      closed: count((r) => isTerminal(r.status)),
      high: openCount((r) => r.severity === 'High'),
      medium: openCount((r) => r.severity === 'Medium'),
      low: openCount((r) => r.severity === 'Low'),
      overdue: overdue.length,
      atRisk: atRisk.length,
      blocked: blocked.length,
      unscheduled: openCount((r) => r.scheduleHealth === 'Unscheduled'),
    },
    movement: {
      trailAvailable: inWindow.length > 0,
      raised,
      closed,
      statusChanges,
      notesAdded,
      otherEdits: Math.max(0, otherEdits),
    },
    sections,
    open: open.map(lineOf),
  }
}

/* ================================================================== *
 * Rendering
 * ================================================================== */

/**
 * Plain text, because a daily status is pasted into an email or a chat far more often than it
 * is opened as a file. The CSV companion carries the rows for anyone who wants to sort them.
 */
/** Pad to a column width, truncating rather than overflowing it. */
function fit(v: string, n: number): string {
  return (v.length > n ? `${v.slice(0, n - 1)}…` : v).padEnd(n)
}

/**
 * How many rows of a section are printed.
 *
 * Forty-four blocked items is a real number here and printing all of them turns a daily
 * status into something nobody reads to the end. The most severe and least recently touched
 * are the ones a morning call acts on; the CSV alongside carries every row for anyone who
 * needs the rest.
 */
const SECTION_CAP = 12

const SEVERITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

function triage(lines: ImsLine[]): ImsLine[] {
  return [...lines].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
      a.lastActivity.localeCompare(b.lastActivity),
  )
}

export function renderImsText(r: DailyIms): string {
  const L: string[] = []
  const rule = '='.repeat(72)

  L.push(`DAILY IMS — ISSUE MANAGEMENT STATUS`)
  L.push(rule)
  L.push(`Scope    ${r.scope}`)
  L.push(`As at    ${formatIso(r.asAt)}`)
  L.push('')

  L.push('POSITION')
  L.push(`  Open ${r.position.open} of ${r.position.total}   (closed ${r.position.closed})`)
  L.push(`  Severity   High ${r.position.high} · Medium ${r.position.medium} · Low ${r.position.low}`)
  L.push(
    `  Schedule   Overdue ${r.position.overdue} · At risk ${r.position.atRisk} · Blocked ${r.position.blocked} · Unscheduled ${r.position.unscheduled}`,
  )
  L.push('')

  L.push('MOVEMENT IN THE LAST DAY')
  if (!r.movement.trailAvailable) {
    // A quiet day and an unavailable trail must not read the same.
    L.push('  Nothing recorded. Note that movement is read from the audit trail, which is')
    L.push('  capped and — with no database configured — held in one browser, so an empty')
    L.push('  section here means "nothing was recorded in this trail", not "nothing happened".')
  } else {
    L.push(`  Raised ${r.movement.raised.length} · Closed ${r.movement.closed.length} · Status changes ${r.movement.statusChanges.length} · Notes added ${r.movement.notesAdded.length} · Other edits ${r.movement.otherEdits}`)
    for (const c of r.movement.statusChanges.slice(0, 20)) {
      L.push(`    ${c.id}  ${c.from || '—'} → ${c.to}  (${c.by})`)
    }
    for (const n of r.movement.notesAdded.slice(0, 20)) {
      L.push(`    ${n.id}  note added by ${n.by}`)
    }
  }
  L.push('')

  for (const s of r.sections) {
    L.push(`${s.title.toUpperCase()} (${s.lines.length})`)
    L.push(`  ${s.note}`)
    const ordered = triage(s.lines)
    for (const l of ordered.slice(0, SECTION_CAP)) {
      L.push(`    ${fit(l.id, 12)} ${fit(l.severity, 7)} ${fit(l.owner, 20)} ${fit(l.subject, 58).trimEnd()}`)
      if (l.nextAction) L.push(`      next: ${l.nextAction.length > 110 ? `${l.nextAction.slice(0, 109)}…` : l.nextAction}`)
    }
    if (ordered.length > SECTION_CAP) {
      L.push(`    … and ${ordered.length - SECTION_CAP} more — most severe and least recently touched shown; all rows are in the CSV.`)
    }
    L.push('')
  }

  if (!r.sections.length) {
    L.push('NOTHING NEEDS ATTENTION')
    L.push('  No open record is overdue, blocked, at risk, unowned, without a next action, or')
    L.push('  quiet for two weeks.')
    L.push('')
  }

  L.push(rule)
  L.push(`Generated by Axiomate from ${r.position.total} records in scope. Every figure is`)
  L.push('counted from the records or the audit trail; none is estimated.')
  return L.join('\n')
}

/** The open rows, for anyone who wants to sort them. */
export function renderImsCsv(r: DailyIms): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const head = ['ID', 'Subject', 'Owner', 'Status', 'Severity', 'Schedule health', 'Due', 'Last activity', 'Next action']
  const lines = [head.join(',')]
  for (const l of r.open) {
    lines.push(
      [l.id, l.subject, l.owner, l.status, l.severity, l.health, l.due, l.lastActivity, l.nextAction]
        .map((v) => esc(String(v)))
        .join(','),
    )
  }
  return lines.join('\r\n')
}
