import { EMPTY_FILTERS, type FilterState } from './types'
import { WORKSPACE_VIEWS, type WorkspaceView } from './viewChoice'

/**
 * Saved views — the team's views, not the browser's. See
 * `docs/plans/2026-08-31-saved-views-design.md`.
 *
 * A view is a workspace record on the operating model: named, visible to everyone, stamped
 * with its creator, audited on every save and delete. Hive's tabs die with a browser profile;
 * these survive machines and answer "who changed this view" like everything else here.
 *
 * Parsing fails CLOSED: a stored view whose `filters` predate a FilterState change loads with
 * unknown keys dropped and missing keys defaulted, so old views degrade to broader ones
 * rather than crashing or filtering wrongly.
 */

export interface SavedView {
  /** `view-12`, minted from the workspace counter. */
  id: string
  name: string
  filters: FilterState
  view: WorkspaceView
  /** Who first saved it — ownership for update/delete, display beside the name. */
  createdBy: string
  createdAt: string
}

export function parseSavedFilters(raw: unknown): FilterState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const out = { ...EMPTY_FILTERS }
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof FilterState)[]) {
    const v = r[key]
    if (typeof out[key] === 'boolean') {
      if (typeof v === 'boolean') (out as Record<string, unknown>)[key] = v
    } else if (typeof v === 'string') {
      ;(out as Record<string, unknown>)[key] = v
    }
  }
  return out
}

export function parseWorkspaceView(raw: unknown): WorkspaceView {
  return (WORKSPACE_VIEWS as readonly string[]).includes(raw as string)
    ? (raw as WorkspaceView)
    : 'tree'
}

/** A stored entry, re-validated on load. Null drops the entry rather than guessing. */
export function parseSavedView(raw: unknown): SavedView | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim()) return null
  return {
    id: r.id,
    name: r.name.trim(),
    filters: parseSavedFilters(r.filters),
    view: parseWorkspaceView(r.view),
    createdBy: typeof r.createdBy === 'string' ? r.createdBy : '',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
  }
}
