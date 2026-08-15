import type { ScheduleRow } from './types'
import { ISSUE_STATUSES, isGroupRow } from './types'
import { allowedNext, type StatusPolicy } from './statusPolicy'

/**
 * Which grid cells can be edited in place, and with what control.
 *
 * Kept out of the component so the rules live next to the domain: a summary row's dates and
 * progress are rolled up from its children, so they are deliberately NOT editable here —
 * letting someone type over a derived value would silently break the roll-up. Editing those
 * means editing the rows beneath, which is what the tree is for.
 */

export type EditorKind = 'text' | 'select' | 'date' | 'number'

export interface EditorSpec {
  kind: EditorKind
  /** Current value, as it should appear in the control. */
  value: string
  options?: readonly string[]
  min?: number
  max?: number
  placeholder?: string
  /** Suggestions for a free-text field (rendered as a datalist). */
  suggestions?: readonly string[]
}

export const SEVERITIES = ['High', 'Medium', 'Low'] as const
export const ACCOUNTABLES = ['Unassigned', 'Axiocloud', 'OAPIL', 'SLG', 'Shared'] as const

/** Columns that never accept a typed value — they are identifiers or computed. */
const READ_ONLY = new Set(['id', 'type', 'health', 'mode', 'dependency'])

export function editorFor(
  row: ScheduleRow,
  colKey: string,
  owners: readonly string[] = [],
  /**
   * The transition graph, when the caller has one.
   *
   * Optional so the two call sites that only ask *whether* a cell is editable do not have to
   * carry it. When it is absent the status editor offers the whole vocabulary — which is what
   * this function did for every caller until the graph existed, and is still correct for a
   * question about editability rather than about values.
   */
  policy?: StatusPolicy,
): EditorSpec | null {
  if (READ_ONLY.has(colKey)) return null

  const isIssue = row.kind === 'issue'
  const isActivity = row.kind === 'activity' || row.kind === 'milestone'
  // Every structural tier is a summary row, not just the two that existed when this was
  // written: an Engagement row was offering a Status and Severity editor for values that
  // roll up from its children and have nowhere to be stored.
  const isSummary = isGroupRow(row.kind)

  switch (colKey) {
    case 'name':
      return { kind: 'text', value: row.name, placeholder: 'Name' }

    case 'owner':
      return {
        kind: 'text',
        value: row.owner ?? '',
        placeholder: 'Unassigned',
        suggestions: owners,
      }

    case 'status':
      // Status belongs to an issue. Activities carry progress, not a lifecycle status.
      // Offering a status the reducer will refuse is worse than not offering it: the person
      // picks it, the grid appears to accept it, and the refusal arrives afterwards as an
      // error about something they have already stopped thinking about.
      return isIssue
        ? {
            kind: 'select',
            value: row.status ?? 'Open',
            options: policy ? allowedNext(policy, row.status) : ISSUE_STATUSES,
          }
        : null

    case 'severity':
      return isIssue ? { kind: 'select', value: row.severity ?? 'Medium', options: SEVERITIES } : null

    case 'accountable':
      return isIssue
        ? { kind: 'select', value: row.accountable ?? 'Unassigned', options: ACCOUNTABLES }
        : null

    case 'next':
      return isIssue ? { kind: 'text', value: row.nextAction ?? '', placeholder: '—' } : null

    case 'start':
      if (isSummary) return null
      return {
        kind: 'date',
        // An unscheduled issue falls back to the date it was raised, so typing a due date
        // does not have to be preceded by inventing a start.
        value: row.plannedStartDate ?? row.actualStartDate ?? '',
      }

    case 'due':
      if (isSummary) return null
      return { kind: 'date', value: row.plannedEndDate ?? '' }

    case 'duration':
      if (isSummary) return null
      return {
        kind: 'number',
        value: row.duration != null ? String(row.duration) : '',
        min: row.isMilestone ? 0 : 1,
        placeholder: 'days',
      }

    case 'pct':
      if (isSummary) return null
      return {
        kind: 'number',
        // Start EMPTY when the figure is derived rather than reported. Pre-filling the
        // derived number would mean a stray click-and-blur silently converts it into a user
        // override, freezing progress that should keep tracking the status.
        value: row.progressOrigin === 'user' ? String(row.percentComplete) : '',
        min: 0,
        max: 100,
        // Clearing the field hands progress back to the derivation rather than pinning zero.
        placeholder:
          row.progressOrigin === 'status-derived'
            ? 'from status'
            : row.progressOrigin === 'rolled-up'
              ? 'rolled up'
              : '0',
      }

    default:
      return null
  }
}

/** Ordered list of editable columns on a row, used for Tab-to-next-cell. */
export function editableColumns(
  row: ScheduleRow,
  colKeys: string[],
  owners: readonly string[] = [],
): string[] {
  return colKeys.filter((k) => editorFor(row, k, owners) !== null)
}
