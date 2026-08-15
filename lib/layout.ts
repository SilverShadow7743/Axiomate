import type { ZoomLevel } from './types'

/**
 * The single source of truth for row geometry.
 *
 * The tree grid and the Gantt are separate scroll containers, so every row height in both
 * panes MUST come from these constants. If they ever diverge, rows stop lining up and the
 * whole split view is wrong.
 */
export const ROW_H = 30
/** Two-tier timeline header (major band + minor band). */
export const HEADER_H = 54

/** Pixels per calendar day at each zoom level. */
export const DAY_PX: Record<ZoomLevel, number> = {
  Day: 30,
  Week: 11,
  Month: 3.6,
  Quarter: 1.5,
}

/** Padding added around the data's date range so bars never touch the edge. */
export const DOMAIN_PAD_DAYS: Record<ZoomLevel, number> = {
  Day: 5,
  Week: 10,
  Month: 20,
  Quarter: 45,
}
