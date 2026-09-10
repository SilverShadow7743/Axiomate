'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * F&O's list-page rule: the quick filter has focus the moment a list opens, so the first
 * keystroke narrows the list (docs/plans/2026-09-10-fno-page-grammar-design.md §4).
 *
 * `key` is whatever "the list opened" means to the caller — the workspace view for the grids
 * the FiltersHeader serves (Tree → Board is a new list on the same mount), nothing for a
 * panel that remounts per open. Focus is withheld in two cases, both deliberate:
 *
 *   - `suppressed` — a record drawer is up. It is `aria-modal`, and the drawer's own effect
 *     restores focus to the row that opened it on close; a filter that grabbed focus on a view
 *     switch behind it would pull the keyboard out of the dialog. Read through a ref so a
 *     change in suppression never itself re-fires the focus — the drawer closing must return
 *     focus to the row, not to this input.
 *   - a coarse pointer — on touch, focusing an input raises the keyboard over the list the
 *     person came to read.
 */
export function useQuickFilterFocus(
  ref: RefObject<HTMLInputElement | null>,
  key: unknown = null,
  suppressed = false,
) {
  const suppressedRef = useRef(suppressed)
  useEffect(() => {
    suppressedRef.current = suppressed
  })
  useEffect(() => {
    if (suppressedRef.current) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return
    ref.current?.focus()
  }, [ref, key])
}
