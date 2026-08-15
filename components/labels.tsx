'use client'

import { createContext, useContext } from 'react'
import { LABEL_KEYS, type LabelKey } from '@/lib/config'

/**
 * Configured terminology, delivered by context.
 *
 * Context rather than props because terminology is ambient: the grid header, a filter
 * dropdown, a form field and a detail row all name the same concept, and threading a `labels`
 * prop through every one of them would make renaming "Owner" a twelve-file change — which is
 * exactly the coupling the system-key/label split exists to remove.
 *
 * Providers nest deliberately. The outer one carries organisation-wide terms for the chrome;
 * anything scoped to a single record wraps its subtree in a provider resolved against that
 * record's own scope chain, so a term redefined on one project shows there and nowhere else.
 *
 * The default value is the shipped label set, so a component rendered outside any provider
 * still reads correctly rather than showing raw system keys.
 */
export type LabelMap = Record<LabelKey, string>

const LabelContext = createContext<LabelMap>(LABEL_KEYS as LabelMap)

export const LabelProvider = LabelContext.Provider

export function useLabels(): LabelMap {
  return useContext(LabelContext)
}

export function useLabel(key: LabelKey): string {
  return useContext(LabelContext)[key]
}
