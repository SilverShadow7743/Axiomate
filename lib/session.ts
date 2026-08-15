/**
 * How the viewer wants dates and times rendered.
 *
 * Preferences, not identity. Who is acting is an `Actor` (see `lib/actor.ts`), resolved on the
 * server and passed down; this record only decides how a moment is formatted for the person
 * looking at it. The two used to be one thing — `displayName` lived here and the reducer read
 * a constant derived from it — which made a viewer preference and a durable attribution the
 * same field, and meant every audited change in every workspace carried one hardcoded name.
 */
export interface SessionUser {
  /** IANA zone from the user's profile, when there is one to read. */
  timeZone: string | null
  /**
   * BCP-47 locale. Null follows the device.
   *
   * This controls the timezone abbreviation as much as the date format: browsers only emit
   * "IST" for locales where that is the convention. Under `en-US` the same zone renders as
   * "GMT+5:30" — both correct, neither invented. Set `'en-IN'` here for "14 Aug 2026, 4:19 PM
   * IST"; leave null to follow whatever the viewer's device reports.
   */
  locale: string | null
}

export const CURRENT_USER: SessionUser = {
  // Null means "use the device settings", the honest default without a profile to read.
  timeZone: null,
  locale: 'en-IN',
}

/**
 * Format the moment for the header.
 *
 * Resolved from the browser's own locale and zone rather than hardcoded, so the abbreviation
 * (IST, GMT, …) is whatever the device actually reports.
 */
export function formatSessionTime(
  d: Date,
  timeZone: string | null,
  locale: string | null,
): { date: string; time: string; zone: string } {
  const zone = timeZone ?? undefined
  const date = new Intl.DateTimeFormat(locale ?? undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: zone,
  }).format(d)

  const time = new Intl.DateTimeFormat(locale ?? undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: zone,
  }).format(d)

  // `timeZoneName: 'short'` yields the abbreviation; take only that part.
  const parts = new Intl.DateTimeFormat(locale ?? undefined, {
    timeZoneName: 'short',
    timeZone: zone,
  }).formatToParts(d)
  const zoneName = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''

  return { date, time, zone: zoneName }
}

/** Full weekday form, used for the tooltip when the compact form is shown. */
export function formatSessionLong(
  d: Date,
  timeZone: string | null,
  locale: string | null,
): string {
  return new Intl.DateTimeFormat(locale ?? undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'long',
    timeZone: timeZone ?? undefined,
  }).format(d)
}
