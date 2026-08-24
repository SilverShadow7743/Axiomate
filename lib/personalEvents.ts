/**
 * A person's own calendar entry — typed in, not synced from anywhere. See the personal-
 * calendar design: no meeting/calendar integration exists in this app, so this is the honest
 * "declared, no runtime"-avoiding alternative — a minimal manual record rather than a fake
 * integration.
 *
 * Private to its owner, unconditionally — see `lib/db/boot.ts`'s `redactForReader`. Not even
 * `ADMIN` is exempt from that filter, which is why `personId` is resolved from the actor at
 * write time rather than carried as a field: see `lib/workspace.ts`'s `addPersonalEvent` arm.
 */

export interface PersonalEvent {
  id: string
  personId: string
  title: string
  startAt: string
  endAt: string
  allDay: boolean
  note: string
  /** Free text, not a directory reference — a note to yourself about who else is involved,
   *  not an invitation. Nothing here is validated against, or notifies, anybody named. */
  attendees: string
  createdAt: string
  deletedAt: string | null
}

export interface EventProblem {
  field: 'title' | 'dates'
  message: string
}

export function eventProblem(
  a: Pick<PersonalEvent, 'title' | 'startAt' | 'endAt'>,
): EventProblem | null {
  if (!a.title.trim()) return { field: 'title', message: 'An event needs a title.' }
  if (!a.startAt || !a.endAt) return { field: 'dates', message: 'An event needs a start and an end.' }
  if (a.endAt < a.startAt) return { field: 'dates', message: 'The end falls before the start.' }
  return null
}
