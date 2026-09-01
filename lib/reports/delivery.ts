import { weekStarting } from '../timesheet'
import { addDays } from '../dates'

/**
 * When each scheduled report is due — pure over dates and stamps, no clock, no I/O. Driven by
 * scenario RD1 before the scheduled pass calls it. See
 * `docs/plans/2026-08-30-report-delivery-design.md`.
 *
 * The clock is the PASS's clock: `runScheduledPass` derives `today` from the UTC instant it
 * started, and this module deliberately introduces no second date source and no timezone
 * conversion — weekday, Monday and the 1st all mean UTC.
 *
 * Off by default is load-bearing: a deploy must not start emailing by surprise, so
 * `DEFAULT_REPORT_DELIVERY` disables everything and `parseReportDelivery` fails CLOSED — a
 * stored blob that is missing, junk, or from a future shape parses to disabled, never to a
 * guess.
 */

export interface ReportDeliveryConfig {
  imsEnabled: boolean
  packsEnabled: boolean
  /** Prompt an internal reviewer when an issue moves to Awaiting client confirmation. */
  resolutionNoticeEnabled: boolean
  /** Internal addresses the daily IMS goes to. Empty means the IMS is not due — silence, not a crash. */
  imsRecipients: string[]
  /** Where the packs land for eyeballing. '' = resolve the operator's directory email at send time. */
  packDestination: string
}

export const DEFAULT_REPORT_DELIVERY: ReportDeliveryConfig = {
  imsEnabled: false,
  packsEnabled: false,
  resolutionNoticeEnabled: false,
  imsRecipients: [],
  packDestination: '',
}

export function parseReportDelivery(raw: unknown): ReportDeliveryConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_REPORT_DELIVERY }
  const r = raw as Record<string, unknown>
  return {
    imsEnabled: r.imsEnabled === true,
    packsEnabled: r.packsEnabled === true,
    resolutionNoticeEnabled: r.resolutionNoticeEnabled === true,
    imsRecipients: Array.isArray(r.imsRecipients)
      ? r.imsRecipients.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : [],
    packDestination: typeof r.packDestination === 'string' ? r.packDestination.trim() : '',
  }
}

/** What was last sent, riding the pass's observation memory. All optional — no memory is a first run. */
export interface DeliveryStamps {
  /** The `today` of the last IMS send. */
  imsSentOn?: string
  /** The weekStarting (a Monday) of the last weekly pack batch sent. */
  weeklySentFor?: string
  /** The 'YYYY-MM' of the last monthly pack batch sent. */
  monthlySentFor?: string
}

export interface DeliveryDue {
  ims: boolean
  /** The Monday of the PRIOR week — a complete period — or null when not due. */
  weeklyFor: string | null
  /** The PRIOR month as 'YYYY-MM' — or null when not due. */
  monthlyFor: string | null
}

const dayOfWeek = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay()

/** The prior month of an ISO date, as 'YYYY-MM'. */
function priorMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function deliveryDue(
  config: ReportDeliveryConfig,
  stamps: DeliveryStamps,
  today: string,
): DeliveryDue {
  const dow = dayOfWeek(today)
  const weekday = dow >= 1 && dow <= 5

  const ims =
    config.imsEnabled && config.imsRecipients.length > 0 && weekday && stamps.imsSentOn !== today

  /*
   * A Monday send covers the week that just FINISHED — the Monday seven days back — so what
   * lands is a complete period. Sending `weekStarting(today)` would mail a week one day old.
   */
  const lastWeek = weekStarting(addDays(today, -7))
  const weeklyFor =
    config.packsEnabled && dow === 1 && stamps.weeklySentFor !== lastWeek ? lastWeek : null

  const prior = priorMonth(today)
  const monthlyFor =
    config.packsEnabled && today.slice(8, 10) === '01' && stamps.monthlySentFor !== prior
      ? prior
      : null

  return { ims, weeklyFor, monthlyFor }
}
