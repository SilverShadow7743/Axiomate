import { EMPTY_FILTERS, NO_CLIENT_CHOSEN, type FilterState } from './types'
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
 * unknown keys dropped and missing keys defaulted to `EMPTY_FILTERS`, and a missing client
 * defaults to the person's own choice rather than to All — a view never widens what a person
 * sees because a key was absent. The client's fate specifically (BR14, AC12):
 *
 *   - absent, not a string, or `NO_CLIENT_CHOSEN` itself → `NO_CLIENT_CHOSEN`. For a saved
 *     view the sentinel means "no client stored: keep the person's own" — a view captured at
 *     rest stores no client, and `applySavedFilters` puts the person's own back on apply.
 *   - 'All' → 'All', read on apply as the person-relative All (the scope narrows it).
 *   - any other string → kept as the client name; it matches what it matches, so an unknown
 *     name lists nothing, never unscoped All.
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
  /*
   * The client is stated, not left to the spread: anything that is not a client name or 'All'
   * lands on the one canonical resting value, so a hand-built action carrying junk, an absent
   * client, or the sentinel itself all store the same thing with the same defined apply.
   */
  out.client = typeof r.client === 'string' && r.client !== NO_CLIENT_CHOSEN ? r.client : NO_CLIENT_CHOSEN
  return out
}

/**
 * The apply side of the sentinel: a view stored with no client takes the person's own client
 * when applied, so applying a view never rests the grid by accident and leaves the person's
 * choice in place (BR14). A view stored with 'All' or a name applies that value as-is.
 */
export function applySavedFilters(saved: FilterState, personsClient: string): FilterState {
  return { ...saved, client: saved.client === NO_CLIENT_CHOSEN ? personsClient : saved.client }
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
