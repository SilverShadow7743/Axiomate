import type { ScheduleRow } from './types'
import type { LabelKey } from './config'

export interface ColumnDef {
  key: string
  /** Shipped heading. Used when the column carries no configurable term. */
  label: string
  /**
   * The system key whose configured label overrides `label`.
   *
   * Columns naming an operating-model concept — who owns the work, who is answerable — must
   * follow the terminology configured for the workspace. Columns naming a mechanic of this
   * app (ID, Duration, Sched. Mode) have no key: renaming those is a code change, not a
   * configuration one.
   */
  labelKey?: LabelKey
  /** Prepended before the resolved term, for headings that name something else plus a term. */
  labelPrefix?: string
  /** Appended after the resolved term, for headings that name a term plus something else. */
  labelSuffix?: string
  width: number
  minWidth: number
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center'
  sortable: boolean
  /** Sort key; grouping rows always sort by tree position, never by this. */
  sortValue?: (r: ScheduleRow) => string | number
  /** Columns that cannot be hidden — the name column anchors the tree. */
  required?: boolean
}

export const COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'ID', width: 96, minWidth: 60, sortable: true, sortValue: (r) => r.displayId },
  {
    key: 'name',
    labelKey: 'RECORD_ISSUE',
    // The column shows every row kind the tree carries — the structural tiers (now including
    // a literal Outcome tier) render here too, and "Outcome" names that group; "Task" names
    // the lifecycle/milestone rows under a work item. Only the middle term is configurable —
    // a firm can rename what it calls its work records; the other two describe this app's own
    // row kinds and are not a business term.
    labelPrefix: 'Outcome / ',
    labelSuffix: ' / Task',
    label: 'Outcome / Work / Task',
    // Widened when the tree gained the Company and Engagement tiers: five levels of indent
    // plus rollup badges left the name itself with almost nothing at the old 320.
    width: 392,
    minWidth: 180,
    sortable: true,
    sortValue: (r) => r.name.toLowerCase(),
    required: true,
  },
  { key: 'type', label: 'Type', width: 120, minWidth: 70, sortable: true, sortValue: (r) => r.type },
  {
    key: 'discipline',
    label: 'Discipline',
    width: 132,
    minWidth: 80,
    sortable: true,
    // Sorted on the stored id rather than the label, deliberately: the id is stable and the
    // label is a firm's wording, which can be edited under a sort the user is looking at.
    sortValue: (r) => r.discipline ?? '',
  },
  {
    key: 'status',
    labelKey: 'FIELD_STATUS',
    label: 'Status',
    width: 168,
    minWidth: 90,
    sortable: true,
    sortValue: (r) => r.status ?? '',
  },
  {
    key: 'severity',
    labelKey: 'FIELD_SEVERITY',
    label: 'Severity',
    width: 88,
    minWidth: 60,
    sortable: true,
    sortValue: (r) => ({ High: 0, Medium: 1, Low: 2 })[r.severity ?? 'Low'] ?? 3,
  },
  {
    key: 'health',
    labelKey: 'FIELD_SCHEDULE_HEALTH',
    label: 'Schedule Health',
    width: 120,
    minWidth: 80,
    sortable: true,
    sortValue: (r) => r.scheduleHealth,
  },
  { key: 'owner', labelKey: 'ISSUE_OWNER', label: 'Owner', width: 150, minWidth: 80, sortable: true, sortValue: (r) => r.owner ?? '' },
  {
    key: 'accountable',
    labelKey: 'ISSUE_ACCOUNTABLE',
    label: 'Accountable Party',
    width: 132,
    minWidth: 80,
    sortable: true,
    sortValue: (r) => r.accountable ?? '',
  },
  {
    key: 'start',
    labelKey: 'FIELD_START_DATE',
    label: 'Start Date',
    width: 104,
    minWidth: 80,
    sortable: true,
    sortValue: (r) => r.plannedStartDate ?? r.actualStartDate ?? '',
  },
  {
    key: 'due',
    labelKey: 'FIELD_DUE_DATE',
    label: 'Due Date',
    width: 104,
    minWidth: 80,
    sortable: true,
    sortValue: (r) => r.plannedEndDate ?? '',
  },
  {
    key: 'duration',
    label: 'Duration',
    width: 84,
    minWidth: 60,
    align: 'right',
    sortable: true,
    sortValue: (r) => r.duration ?? -1,
  },
  {
    key: 'pct',
    label: '% Complete',
    width: 108,
    minWidth: 80,
    sortable: true,
    sortValue: (r) => r.percentComplete,
  },
  { key: 'mode', label: 'Sched. Mode', width: 96, minWidth: 70, sortable: true, sortValue: (r) => r.scheduleMode },
  {
    key: 'next',
    labelKey: 'FIELD_NEXT_ACTION',
    label: 'Next Action',
    width: 300,
    minWidth: 120,
    sortable: false,
  },
  { key: 'dependency', label: 'Dependency', width: 140, minWidth: 80, sortable: false },
]

/** Columns shown before the user customises anything. */
export const DEFAULT_VISIBLE = [
  'id',
  'name',
  'type',
  'status',
  'severity',
  'health',
  'owner',
  'accountable',
  'start',
  'due',
  'duration',
  'pct',
  'mode',
  'next',
  'dependency',
]

/** Number of leading columns frozen during horizontal scroll (spec §2). */
export const DEFAULT_FROZEN = 2

/**
 * Apply configured terminology to a column heading.
 *
 * Columns keep their shipped `label` as the fallback, so a column whose term has never been
 * renamed reads exactly as it always did.
 */
export function labelColumn(c: ColumnDef, labels: Record<LabelKey, string>): string {
  if (!c.labelKey) return c.label
  return `${c.labelPrefix ?? ''}${labels[c.labelKey] ?? c.label}${c.labelSuffix ?? ''}`
}
