'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Make an overlay behave like a real modal for keyboard and screen-reader users.
 *
 * `aria-modal` is only a promise to assistive technology; on its own it changes nothing about
 * where Tab goes. Without the three behaviours below, Shift+Tab walks straight out of the
 * dialog and onto controls the user cannot see, and closing the dialog drops focus back to
 * `<body>` — losing the caller's place entirely.
 *
 *   1. `inert` on the app shell, so background controls leave the tab order and the
 *      accessibility tree while the overlay is up.
 *   2. A Tab/Shift+Tab wrap inside the overlay, as a backstop for browsers or nested
 *      portals where `inert` does not apply.
 *   3. Focus restoration to whatever was focused when the overlay opened.
 *
 * Overlays are portaled to `document.body` (see `Portal`), so they sit outside the inert
 * subtree and stay interactive.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

/**
 * Overlays can stack — the evidence panel opens from inside the focus editor — so this is
 * tracked as a stack rather than a boolean.
 *
 * Two things depend on it. `inert` must be released only when the LAST overlay closes, or
 * dismissing the inner one would hand the background back to the keyboard while the outer
 * one is still open. And only the TOPMOST overlay may trap Tab, or the outer trap fires for
 * focus sitting legitimately inside the inner overlay and drags it back out.
 */
const overlayStack: symbol[] = []

export function useOverlay(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return
    const token = Symbol('overlay')
    overlayStack.push(token)

    const restoreTo = document.activeElement as HTMLElement | null
    const shell = document.getElementById('app-shell')
    shell?.setAttribute('inert', '')

    // Focus the first control inside rather than leaving focus behind the overlay.
    const first = focusableWithin(containerRef.current)[0]
    first?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      // Defer to whichever overlay is on top.
      if (overlayStack[overlayStack.length - 1] !== token) return
      const items = focusableWithin(containerRef.current)
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const current = document.activeElement as HTMLElement | null

      if (e.shiftKey && (current === firstEl || !containerRef.current?.contains(current))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && current === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    // Capture phase so the wrap runs before anything inside handles Tab.
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const at = overlayStack.lastIndexOf(token)
      if (at !== -1) overlayStack.splice(at, 1)
      // Only the last overlay out restores the background.
      if (overlayStack.length === 0) shell?.removeAttribute('inert')
      // Guard: the trigger may have unmounted while the overlay was open.
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus()
    }
  }, [containerRef, active])
}
