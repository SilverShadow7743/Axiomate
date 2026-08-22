/**
 * Which presentation of the register is showing — my work, tree, board, calendar or portfolio.
 *
 * Same discipline as `lib/panel.ts`: a localStorage preference with a validating loader, so a
 * corrupted or foreign value falls back to the default rather than rendering nothing. The tree
 * is the structural default; My work can be the *landing* view for a person with work waiting,
 * which is why the loader distinguishes "nothing stored" from "stored: tree" — only the first
 * may be overridden by that rule.
 */

export const WORKSPACE_VIEWS = ['mywork', 'tree', 'board', 'calendar', 'portfolio'] as const
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]

const STORE_KEY = 'axiomate.tms.view'

/** The stored choice, or null when the person has never made one (or storage is unusable). */
export function loadStoredView(): WorkspaceView | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    return (WORKSPACE_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as WorkspaceView) : null
  } catch {
    return null
  }
}

export function loadView(): WorkspaceView {
  return loadStoredView() ?? 'tree'
}

export function saveView(view: WorkspaceView): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORE_KEY, view)
  } catch {
    // A blocked storage quota must not break the toolbar.
  }
}
