import type { Person } from './config'

/**
 * The one join rule for person references.
 *
 * A record that points at a person carries a name (what was typed or displayed at the time)
 * and, since the identity-id migration, a directory id resolved at write time. The id wins:
 * once present, a rename cannot detach the record. The name fallback exists ONLY for rows
 * written before the migration (or whose name could not be uniquely resolved) — accepting a
 * name match alongside a mismatching id would let a recycled display name steal records.
 */

export interface PersonRef {
  name: string
  id?: string | null
}

export function samePerson(ref: PersonRef, person: Person): boolean {
  if (ref.id) return ref.id === person.id
  return ref.name.trim().toLowerCase() === person.name.trim().toLowerCase()
}
