/**
 * Appearance: system, light or dark — same discipline as `lib/viewChoice.ts`.
 *
 * `app/globals.css` already keys off `data-theme` on `<html>` (`:root[data-theme='dark']`,
 * `:root:not([data-theme='light'])` for the OS-preference fallback) — that CSS existed with
 * nothing ever setting the attribute. This is the missing write side: a validating loader so a
 * corrupted or foreign stored value falls back to 'system' rather than rendering unthemed, and
 * an apply function that sets or clears the attribute rather than ever writing `'system'` onto
 * the DOM (there is no `data-theme='system'` rule — 'system' means "no attribute", not a third
 * CSS branch).
 */

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

const STORE_KEY = 'axiomate.tms.theme'

/** The stored choice, or null when the person has never made one (or storage is unusable). */
export function loadStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    return (THEMES as readonly string[]).includes(raw ?? '') ? (raw as Theme) : null
  } catch {
    return null
  }
}

export function loadTheme(): Theme {
  return loadStoredTheme() ?? 'system'
}

/** Sets `data-theme` on `<html>` to match — the one place anything writes that attribute. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

export function saveTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORE_KEY, theme)
  } catch {
    // A blocked storage quota must not break the toggle.
  }
  applyTheme(theme)
}
