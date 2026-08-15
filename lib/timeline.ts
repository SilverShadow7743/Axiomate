import type { ZoomLevel } from './types'
import { DAY_PX } from './layout'
import {
  addDays,
  addMonths,
  fromUtc,
  isWeekend,
  monthLabel,
  quarterLabel,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  toUtc,
} from './dates'

const DAY_MS = 86_400_000

export interface Tick {
  key: string
  label: string
  start: string
  /** Pixel offset from the domain start. */
  x: number
  width: number
  weekend?: boolean
}

export interface Scale {
  domainStart: string
  domainEnd: string
  dayPx: number
  totalWidth: number
  major: Tick[]
  minor: Tick[]
  /** Weekend bands, only produced at zoom levels where a day is wide enough to see. */
  weekends: { x: number; width: number }[]
  x: (iso: string) => number
  /** Inclusive span width: a single-day task is exactly one day wide. */
  spanWidth: (startIso: string, endIso: string) => number
  /** Inverse mapping, for drag interactions. */
  dateAt: (px: number) => string
}

export function buildScale(
  domainStart: string,
  domainEnd: string,
  zoom: ZoomLevel,
  /**
   * Width the timeline has to fill, in pixels. Optional so callers that only need the tick
   * maths — and tests — can leave it out.
   */
  availableWidth = 0,
): Scale {
  const t0 = toUtc(domainStart)
  const totalDays = Math.round((toUtc(domainEnd) - t0) / DAY_MS) + 1

  /**
   * Pixels per day, never less than what it takes to fill the pane.
   *
   * `DAY_PX` is a fixed rate per zoom level, which is right while the domain is wider than the
   * pane: Day and Week overflow and the timeline scrolls, as they should. It is wrong the
   * moment the whole domain fits. This log spans about 118 days, so Quarter produced
   * 118 × 1.5 = 177px of timeline inside a 667px pane — more than half of it blank, with every
   * bar crushed into the left third and the grid lines stopping in mid-air. Month did the same
   * thing less severely.
   *
   * Clamping up rather than switching to a fit-always rate keeps the zoom levels meaningful
   * where they differ: with a long enough domain each still resolves to its own scale. Where
   * the domain is short they converge, which is the honest outcome — once everything fits,
   * zooming out further has nothing left to reveal, and the header still changes granularity.
   */
  const fitPx = availableWidth > 0 ? availableWidth / totalDays : 0
  const dayPx = Math.max(DAY_PX[zoom], fitPx)
  const totalWidth = totalDays * dayPx

  const x = (iso: string) => ((toUtc(iso) - t0) / DAY_MS) * dayPx
  const spanWidth = (s: string, e: string) => Math.max(dayPx, (x(addDays(e, 1)) - x(s)))
  const dateAt = (px: number) => fromUtc(t0 + Math.round(px / dayPx) * DAY_MS)

  const major: Tick[] = []
  const minor: Tick[] = []
  const weekends: { x: number; width: number }[] = []

  const clampEnd = (next: string) => (next > domainEnd ? addDays(domainEnd, 1) : next)

  if (zoom === 'Day') {
    // major = month, minor = day
    let m = startOfMonth(domainStart)
    while (m <= domainEnd) {
      const next = addMonths(m, 1)
      const from = m < domainStart ? domainStart : m
      const to = clampEnd(next)
      major.push({ key: m, label: monthLabel(m), start: from, x: x(from), width: x(to) - x(from) })
      m = next
    }
    for (let t = t0; t <= toUtc(domainEnd); t += DAY_MS) {
      const iso = fromUtc(t)
      minor.push({
        key: iso,
        label: String(new Date(t).getUTCDate()),
        start: iso,
        x: x(iso),
        width: dayPx,
        weekend: isWeekend(iso),
      })
    }
  } else if (zoom === 'Week') {
    let m = startOfMonth(domainStart)
    while (m <= domainEnd) {
      const next = addMonths(m, 1)
      const from = m < domainStart ? domainStart : m
      const to = clampEnd(next)
      major.push({ key: m, label: monthLabel(m), start: from, x: x(from), width: x(to) - x(from) })
      m = next
    }
    let w = startOfWeek(domainStart)
    while (w <= domainEnd) {
      const next = addDays(w, 7)
      const from = w < domainStart ? domainStart : w
      const to = clampEnd(next)
      minor.push({
        key: w,
        label: String(new Date(toUtc(w)).getUTCDate()),
        start: from,
        x: x(from),
        width: x(to) - x(from),
      })
      w = next
    }
  } else if (zoom === 'Month') {
    let q = startOfQuarter(domainStart)
    while (q <= domainEnd) {
      const next = addMonths(q, 3)
      const from = q < domainStart ? domainStart : q
      const to = clampEnd(next)
      major.push({ key: q, label: quarterLabel(q), start: from, x: x(from), width: x(to) - x(from) })
      q = next
    }
    let m = startOfMonth(domainStart)
    while (m <= domainEnd) {
      const next = addMonths(m, 1)
      const from = m < domainStart ? domainStart : m
      const to = clampEnd(next)
      minor.push({
        key: m,
        label: monthLabel(m).slice(0, 3),
        start: from,
        x: x(from),
        width: x(to) - x(from),
      })
      m = next
    }
  } else {
    // Quarter zoom: major = year, minor = quarter
    let y = startOfYear(domainStart)
    while (y <= domainEnd) {
      const next = addMonths(y, 12)
      const from = y < domainStart ? domainStart : y
      const to = clampEnd(next)
      major.push({ key: y, label: y.slice(0, 4), start: from, x: x(from), width: x(to) - x(from) })
      y = next
    }
    let q = startOfQuarter(domainStart)
    while (q <= domainEnd) {
      const next = addMonths(q, 3)
      const from = q < domainStart ? domainStart : q
      const to = clampEnd(next)
      minor.push({
        key: q,
        label: quarterLabel(q).split(' ')[0],
        start: from,
        x: x(from),
        width: x(to) - x(from),
      })
      q = next
    }
  }

  // Weekend shading only reads at Day/Week zoom; below that it turns into noise.
  if (zoom === 'Day' || zoom === 'Week') {
    for (let t = t0; t <= toUtc(domainEnd); t += DAY_MS) {
      const iso = fromUtc(t)
      if (isWeekend(iso)) weekends.push({ x: x(iso), width: dayPx })
    }
  }

  return { domainStart, domainEnd, dayPx, totalWidth, major, minor, weekends, x, spanWidth, dateAt }
}
