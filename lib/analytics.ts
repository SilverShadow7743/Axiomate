/**
 * Firm-wide cross-tabs over the live issue register.
 *
 * Pure — no clock beyond the `today` every caller already threads through this codebase, no I/O.
 * See `docs/plans/2026-09-07-analytics-design.md` for why this is cross-tabs of counts computed
 * on every read rather than a trend over time: nothing in this codebase captures a period
 * snapshot on a schedule, so a trend line would be invented, not read.
 */

import { isTerminal } from './schedule'
import { workingDaysBetween } from './dates'
import type { IssueRecord } from './workspace'
import type { Severity, IssueStatus } from './types'

interface LiveIssue {
  severity: Severity
  status: IssueStatus
  client: string
  owner: string
  raised: string
  deletedAt: string | null
}

function liveOnly(issues: Record<string, IssueRecord>): LiveIssue[] {
  return Object.values(issues).filter((i) => !i.deletedAt)
}

export interface SeverityStatusCell {
  severity: Severity
  status: IssueStatus
  count: number
}

/** Every severity/status combination that has at least one issue — empty combinations are not
 *  rows, the same "absence is the honest answer" rule `lib/commercial/engagement.ts`'s own summaries use. */
export function bySeverityAndStatus(issues: Record<string, IssueRecord>): SeverityStatusCell[] {
  const counts = new Map<string, number>()
  for (const i of liveOnly(issues)) {
    const key = `${i.severity}${i.status}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [severity, status] = key.split('')
      return { severity: severity as Severity, status: status as IssueStatus, count }
    })
    .sort((a, b) => b.count - a.count)
}

export interface ClientCell {
  client: string
  open: number
  openHigh: number
}

/** Every client with at least one live issue, worst (most open High) first. */
export function byClient(issues: Record<string, IssueRecord>): ClientCell[] {
  const open = liveOnly(issues).filter((i) => !isTerminal(i.status))
  const counts = new Map<string, ClientCell>()
  for (const i of open) {
    const key = i.client || 'Unassigned'
    const cell = counts.get(key) ?? { client: key, open: 0, openHigh: 0 }
    cell.open += 1
    if (i.severity === 'High') cell.openHigh += 1
    counts.set(key, cell)
  }
  return [...counts.values()].sort((a, b) => b.openHigh - a.openHigh || b.open - a.open)
}

export const AGE_BUCKETS = ['0-7', '8-30', '31-90', '90+'] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]

export interface AgeBucketCell {
  bucket: AgeBucket
  count: number
}

function bucketFor(workingDays: number): AgeBucket {
  if (workingDays <= 7) return '0-7'
  if (workingDays <= 30) return '8-30'
  if (workingDays <= 90) return '31-90'
  return '90+'
}

/** Open issues only, bucketed by working days since raised — computed against `today`, never
 *  read off a stored age. A bucket with nothing in it is still a row, at 0: the four buckets are
 *  the whole picture, and a missing row would read as "no data" rather than "none this old." */
export function byAgeBucket(
  issues: Record<string, IssueRecord>,
  today: string,
  holidays?: ReadonlySet<string>,
): AgeBucketCell[] {
  const open = liveOnly(issues).filter((i) => !isTerminal(i.status))
  const counts = new Map<AgeBucket, number>(AGE_BUCKETS.map((b) => [b, 0]))
  for (const i of open) {
    const bucket = bucketFor(workingDaysBetween(i.raised, today, holidays))
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  return AGE_BUCKETS.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 }))
}

export interface OwnerCell {
  owner: string
  open: number
}

/** Every owner with at least one open issue, busiest first. "Unassigned" is a real row, not
 *  filtered out — an unowned pile of work is exactly the kind of thing this view exists to show. */
export function byOwner(issues: Record<string, IssueRecord>): OwnerCell[] {
  const open = liveOnly(issues).filter((i) => !isTerminal(i.status))
  const counts = new Map<string, number>()
  for (const i of open) {
    const key = i.owner || 'Unassigned'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([owner, open]) => ({ owner, open }))
    .sort((a, b) => b.open - a.open)
}
