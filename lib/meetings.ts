/**
 * A meeting — the shared, visible sibling of the private PersonalEvent, and the record that
 * finally pays the availability engine's IOU (E4, `2026-08-30-e4-meetings-design.md`).
 *
 * Attendees are DIRECTORY IDS, never names: this is the one join in the product that starts
 * clean, and the design's own send-back clause says that if reality ever forces a name
 * fallback here, stop and take stock rather than quietly widening. The organizer is not
 * implicitly an attendee — the form defaults them into the list, but the record believes
 * the list.
 *
 * Boot-shipped like commitments, by explicit decision: every engine consumer runs
 * client-side, and a server-queried meeting store would leave them all blind. The design doc
 * records that trade and its escape hatch.
 */

export const MEETING_SCOPES = ['issue', 'project'] as const
export type MeetingScopeKind = (typeof MEETING_SCOPES)[number]

export interface Meeting {
  id: string
  title: string
  /** ISO datetimes, same day expected but not forced; stored as entered (single-timezone firm). */
  startAt: string
  endAt: string
  organizer: string
  organizerId: string | null
  /** Directory ids. Real invitations — each lands on that person's My calendar. */
  attendeeIds: string[]
  /** A meeting about work says so — the parent design's Work Context rule, optional. */
  scopeKind?: MeetingScopeKind | null
  scopeId?: string | null
  note: string
  createdAt: string
  createdBy: string
  /** Soft — a cancelled meeting stops subtracting immediately and keeps its trail. */
  deletedAt: string | null
}

export interface MeetingProblem {
  field: 'title' | 'times' | 'attendees'
  message: string
}

export function meetingProblem(
  m: Pick<Meeting, 'title' | 'startAt' | 'endAt' | 'attendeeIds'>,
  opts: { requireAttendees?: boolean } = {},
): MeetingProblem | null {
  if (!m.title.trim()) return { field: 'title', message: 'A meeting needs a title.' }
  if (!m.startAt || !m.endAt) return { field: 'times', message: 'A meeting needs a start and an end.' }
  if (Date.parse(m.endAt) <= Date.parse(m.startAt)) {
    return { field: 'times', message: 'The end falls before the start.' }
  }
  // Defaults to required — every ordinary caller (the UI's own meeting form) omits the option
  // and keeps today's rule. Only a historical import, whose owner names have not been resolved
  // to attendee ids yet, passes false; see the WBS import design/plan docs.
  if ((opts.requireAttendees ?? true) && !m.attendeeIds.length) {
    return { field: 'attendees', message: 'A meeting with nobody in it is a calendar note — name at least one attendee.' }
  }
  return null
}

/** Whether this person sits in this live meeting. Ids only — see the module comment. */
export function attends(m: Meeting, personId: string | null | undefined): boolean {
  return !m.deletedAt && Boolean(personId) && m.attendeeIds.includes(personId as string)
}
