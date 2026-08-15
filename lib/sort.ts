import type { ScheduleRow } from './types'
import type { ColumnDef } from './columns'

/**
 * Sort the tree without breaking it.
 *
 * Sorting is applied to siblings within each parent, so a row never escapes its client /
 * module / issue. Sorting the flat list instead would scatter activities away from their
 * issue and destroy the hierarchy the whole view depends on.
 */
export function sortTree(
  all: ScheduleRow[],
  col: ColumnDef | undefined,
  dir: 'asc' | 'desc',
): ScheduleRow[] {
  if (!col?.sortValue) return all

  const byParent = new Map<string | null, ScheduleRow[]>()
  for (const r of all) {
    const k = r.parentId
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(r)
  }

  const cmp = (a: ScheduleRow, b: ScheduleRow) => {
    // Lifecycle activities keep their lifecycle order — Investigation always precedes
    // Verification, whatever column the user sorted by.
    if (a.kind === 'activity' || a.kind === 'milestone') return 0
    const va = col.sortValue!(a)
    const vb = col.sortValue!(b)
    let n = 0
    if (typeof va === 'number' && typeof vb === 'number') n = va - vb
    else n = String(va).localeCompare(String(vb), undefined, { numeric: true })
    return dir === 'asc' ? n : -n
  }

  for (const list of byParent.values()) list.sort(cmp)

  const out: ScheduleRow[] = []
  const walk = (parentId: string | null) => {
    for (const r of byParent.get(parentId) ?? []) {
      out.push(r)
      walk(r.id)
    }
  }
  walk(null)
  return out
}
