/**
 * Which presentation of the register is showing — tree, board or calendar.
 *
 * Same discipline as `lib/panel.ts`: a localStorage preference with a validating loader, so a
 * corrupted or foreign value falls back to the default rather than rendering nothing. The tree
 * is the default because it is the only view that shows structure; the others are angles on it.
 */

export const WORKSPACE_VIEWS = ['tree', 'board', 'calendar'] as const
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]

const STORE_KEY = 'axiomate.tms.view'

export function loadView(): WorkspaceView {
  if (typeof window === 'undefined') return 'tree'
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    return raw === 'board' || raw === 'calendar' ? raw : 'tree'
  } catch {
    return 'tree'
  }
}

export function saveView(view: WorkspaceView): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORE_KEY, view)
  } catch {
    // A blocked storage quota must not break the toolbar.
  }
}
