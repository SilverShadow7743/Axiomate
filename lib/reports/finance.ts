import type { HierarchyNode, WorkspaceState } from '../workspace'
import { sheetFor, weekStarting, weekLabel } from '../timesheet'
import { externalPartyKinds, tiersOf } from '../config'
import type { TimeEntry } from '../time'

/**
 * The finance timesheet report — approved hours over a chosen period, gathered for the user to
 * hand to finance. See `docs/plans/2026-08-30-reporting-design.md`.
 *
 * Like the other reports in this directory, everything is computed live from state already
 * loaded; nothing is stored, scheduled or emailed. The user's eyes stay on everything that
 * leaves.
 *
 * ---------------------------------------------------------------------------
 * The inclusion rule
 *
 * Hours are included per person-WEEK, never per entry: a week counts only when its timesheet
 * (`sheetFor`) is `Approved`. An approved week straddling the period edge contributes only its
 * in-range days. Every person-week with in-range hours that is NOT approved lands in
 * `exceptions` with a wording naming which of the three non-approved states it is in — finance
 * sees what is missing rather than assuming completeness.
 *
 * ---------------------------------------------------------------------------
 * What never appears
 *
 * No rates, no amounts, no note text, nothing from leave. Finance applies their own rates;
 * rate rows never leave the system. Hours, names, projects, dates — nothing else. The RF1
 * scenario's sentinel scan pins this.
 */

export interface FinanceSummaryRow {
  client: string
  engagement: string
  project: string
  person: string
  billable: number
  nonBillable: number
  total: number
}

export interface FinanceDetailRow {
  date: string
  person: string
  issueId: string
  project: string
  activity: string
  billable: boolean
  hours: number
}

export interface FinanceException {
  person: string
  /** Always a Monday — the sheet's own key. */
  weekStarting: string
  /** "week of 17 Aug" — the label a reader acts on. */
  week: string
  status: string
  hours: number
}

export interface FinanceReport {
  period: { from: string; to: string }
  summary: FinanceSummaryRow[]
  dailyDetail: FinanceDetailRow[]
  exceptions: FinanceException[]
  /** True when no approved hours fall in the period. Exceptions still populate — the caller
   *  renders "No approved hours between …", never an empty file. */
  empty: boolean
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Resolve an entry's issue to the named scopes a finance row groups by, walking the same
 * ancestor chain config resolution walks. Client is found by the externalParty flag rather
 * than a literal kind — the same choice `clientPack.ts` makes — so a renamed tier still
 * resolves. A record with no such ancestor is internal work; one with no project ancestor is
 * unfiled rather than silently dropped.
 */
function scopesOf(
  state: WorkspaceState,
  issueId: string,
  external: ReadonlySet<string>,
): { client: string; engagement: string; project: string } {
  let client = '(internal)'
  let engagement = '—'
  let project = '(unfiled)'
  // Inline ancestor walk from the issue's parent — `scopeChainOf` lives in workspace.ts but
  // starts from the record itself; the fields we need are on the node ancestors only.
  let cur: string | null = state.issues[issueId]?.parentId ?? null
  const guard = new Set<string>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    const node: HierarchyNode | undefined = state.nodes[cur]
    if (!node) break
    if (node.kind === 'project' && project === '(unfiled)') project = node.name
    if (node.kind === 'engagement' && engagement === '—') engagement = node.name
    if (external.has(node.kind) && client === '(internal)') client = node.name
    cur = node.parentId ?? null
  }
  return { client, engagement, project }
}

export function buildFinanceReport(state: WorkspaceState, from: string, to: string): FinanceReport {
  const external = externalPartyKinds(tiersOf(state.model))
  const sheets = Object.values(state.timesheets)

  // Every live entry in range, grouped into the person-weeks that hold them. The person key is
  // id-first with a name fallback — the same join rule `entriesInWeek`/`sheetFor` apply — so a
  // renamed person's id-carrying rows stay one person.
  const inRange = Object.values(state.timeEntries).filter(
    (e) => !e.deletedAt && e.date >= from && e.date <= to,
  )

  interface PersonWeek {
    person: string
    personId: string | null
    week: string
    entries: TimeEntry[]
  }
  const weeks = new Map<string, PersonWeek>()
  for (const e of inRange) {
    const week = weekStarting(e.date)
    const key = `${e.personId ?? e.person.trim().toLowerCase()}|${week}`
    const pw = weeks.get(key) ?? { person: e.person, personId: e.personId ?? null, week, entries: [] }
    pw.entries.push(e)
    weeks.set(key, pw)
  }

  const included: TimeEntry[] = []
  const exceptions: FinanceException[] = []
  for (const pw of weeks.values()) {
    const sheet = sheetFor(sheets, pw.person, pw.week, pw.personId)
    if (sheet?.status === 'Approved') {
      included.push(...pw.entries)
      continue
    }
    const status =
      sheet == null
        ? 'not submitted'
        : sheet.status === 'Submitted'
          ? 'Submitted — awaiting decision'
          : 'Rejected — returned, not re-submitted'
    exceptions.push({
      person: pw.person,
      weekStarting: pw.week,
      week: weekLabel(pw.week),
      status,
      hours: round(pw.entries.reduce((t, e) => t + e.hours, 0)),
    })
  }
  exceptions.sort((a, b) =>
    a.person === b.person ? a.weekStarting.localeCompare(b.weekStarting) : a.person.localeCompare(b.person),
  )

  const byGroup = new Map<string, FinanceSummaryRow & { rawBillable: number; rawNonBillable: number }>()
  const dailyDetail: FinanceDetailRow[] = []
  for (const e of included) {
    const scopes = scopesOf(state, e.issueId, external)
    dailyDetail.push({
      date: e.date,
      person: e.person,
      issueId: e.issueId,
      project: scopes.project,
      activity: e.activity,
      billable: e.billable,
      hours: e.hours,
    })
    const key = [scopes.client, scopes.engagement, scopes.project, e.personId ?? e.person.trim().toLowerCase()].join('|')
    const row =
      byGroup.get(key) ??
      { ...scopes, person: e.person, billable: 0, nonBillable: 0, total: 0, rawBillable: 0, rawNonBillable: 0 }
    if (e.billable) row.rawBillable += e.hours
    else row.rawNonBillable += e.hours
    byGroup.set(key, row)
  }
  const summary: FinanceSummaryRow[] = [...byGroup.values()]
    .map(({ rawBillable, rawNonBillable, ...row }) => ({
      ...row,
      billable: round(rawBillable),
      nonBillable: round(rawNonBillable),
      total: round(rawBillable + rawNonBillable),
    }))
    .sort(
      (a, b) =>
        a.client.localeCompare(b.client) ||
        a.engagement.localeCompare(b.engagement) ||
        a.project.localeCompare(b.project) ||
        a.person.localeCompare(b.person),
    )
  dailyDetail.sort(
    (a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person) || a.issueId.localeCompare(b.issueId),
  )

  return { period: { from, to }, summary, dailyDetail, exceptions, empty: included.length === 0 }
}
