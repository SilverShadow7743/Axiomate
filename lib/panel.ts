/**
 * Sizing rules for the bottom detail pane.
 *
 * The pane is a third workspace region, not a footer: its height is derived from the
 * viewport and from whether anything is selected, so the common path (select a row, read its
 * detail) never requires dragging a divider first. Dragging refines the layout; it is not
 * what makes the layout usable.
 */

export type PanelState = 'compact' | 'standard' | 'expanded'
/** `auto` defers to the rules below; anything else is an explicit user choice we honour. */
export type PanelPref = 'auto' | PanelState

/** Tabs-only strip. Tall enough to click, short enough to stay out of the way. */
export const COMPACT_H = 46

/** Never leave less than this for the tree and timeline — they are the primary surface. */
const MIN_WORKSPACE_H = 200
const MIN_STANDARD_H = 150
const MIN_EXPANDED_H = 240

/**
 * What the pane should do when the user has expressed no preference.
 *
 * Two inputs, not just screen size: a short viewport keeps the pane out of the way, and with
 * nothing selected there is nothing to show anyway.
 */
export function autoStateFor(hasSelection: boolean, viewportH: number): PanelState {
  if (!hasSelection) return 'compact'
  if (viewportH < 700) return 'compact'
  return 'standard'
}

/** Share of the available height a standard pane takes, before any user preference. */
export function defaultFraction(viewportH: number): number {
  if (viewportH >= 850) return 0.32
  if (viewportH >= 700) return 0.24
  return 0.2
}

/**
 * Resolve a pixel height.
 *
 * The stored preference is a *fraction*, so the same choice scales sensibly when the user
 * moves between a laptop and an external display rather than being a pixel value that is
 * wrong on both.
 */
export function panelHeight(
  state: PanelState,
  fraction: number,
  availableH: number,
): number {
  if (state === 'compact') return COMPACT_H
  const ceiling = Math.max(MIN_STANDARD_H, availableH - MIN_WORKSPACE_H)
  if (state === 'expanded') {
    return clamp(Math.round(availableH * 0.55), Math.min(MIN_EXPANDED_H, ceiling), ceiling)
  }
  return clamp(Math.round(availableH * fraction), Math.min(MIN_STANDARD_H, ceiling), ceiling)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Tabs whose content is a table, a chain or a list rather than a few key/value pairs.
 * Opening one of these from a collapsed pane should reveal it — otherwise the click appears
 * to do nothing.
 */
export const CONTENT_HEAVY_TABS = new Set([
  'Lifecycle',
  'Relationships',
  'Resolution Path',
  'History',
  'Data Source',
])

const STORE_KEY = 'axiomate.tms.detailPanel'

export interface PanelPrefs {
  pref: PanelPref
  fraction: number | null
}

export function loadPrefs(): PanelPrefs {
  if (typeof window === 'undefined') return { pref: 'auto', fraction: null }
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return { pref: 'auto', fraction: null }
    const p = JSON.parse(raw) as PanelPrefs
    const fraction =
      typeof p.fraction === 'number' && p.fraction > 0.05 && p.fraction < 0.9 ? p.fraction : null
    const pref: PanelPref =
      p.pref === 'compact' || p.pref === 'standard' || p.pref === 'expanded' ? p.pref : 'auto'
    return { pref, fraction }
  } catch {
    return { pref: 'auto', fraction: null }
  }
}

export function savePrefs(prefs: PanelPrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs))
  } catch {
    // A full or blocked storage quota must not break the layout.
  }
}
