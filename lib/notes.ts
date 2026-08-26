/**
 * Notes — the working record of how an issue actually progressed.
 *
 * The bottom panel already answered three questions and this is the fourth, which was the one
 * missing. Overview says what the issue *is* now. History says what the system recorded
 * changing. Evidence says what supports a claim. None of them say what someone tried, what the
 * client said on the phone, why an approach was abandoned, or what was decided in a meeting —
 * and that is most of what anyone needs when they pick an issue up three weeks later.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the audit trail
 *
 * They look similar and must not be merged. An audit entry is produced *by* a change and
 * nobody writes it; a note is written deliberately by a person and describes something the
 * system cannot observe. Putting them in one stream would mean either a trail full of prose
 * that no longer proves what changed, or notes that vanish when the audit cap trims the
 * oldest entries. `IssueRelationship` and `IssueDependency` are kept apart in this codebase
 * for the same reason.
 *
 * Notes are soft-deleted like every other record here: a working record that can be silently
 * removed is not a record of anything.
 */

import type { RichDoc } from './richText'

/**
 * What a note is for.
 *
 * A closed list, unlike work types, and deliberately so: this classifies the *shape* of a
 * remark rather than the shape of the firm's work. Nothing computes from it — it drives
 * filtering and a chip — so it is a vocabulary the code can own without constraining anybody.
 */
export const NOTE_TYPES = [
  'General Update',
  'Investigation',
  'Client Communication',
  'Internal Discussion',
  'Decision',
  'Resolution Update',
  'Blocker / Risk',
] as const
export type NoteType = (typeof NOTE_TYPES)[number]

export const DEFAULT_NOTE_TYPE: NoteType = 'General Update'

export interface IssueNote {
  /** `note-12`, minted from the workspace counter — unique within a tenant, not globally. */
  id: string
  issueId: string
  body: RichDoc
  noteType: NoteType
  /** Pinned notes sort above the rest, whatever their age. */
  pinned: boolean
  /**
   * Whether a client-facing surface may show this note. Default false — internal until a
   * person decides otherwise. The one auto-visible note is the sent client reply: what was
   * said to the client is client-visible by definition. Optional because rows stored before
   * the boundary shipped carry no value; absent reads as false.
   */
  clientVisible?: boolean

  /**
   * Creation is recorded once and never rewritten.
   *
   * Editing a note updates `updatedBy`/`updatedAt` and leaves these alone, so a note always
   * says who first wrote it and when — otherwise a correction three weeks later would silently
   * reassign authorship of the original observation.
   */
  createdBy: string
  createdAt: string
  updatedBy: string | null
  updatedAt: string | null

  deletedAt: string | null
}

/**
 * Reverse chronological, pinned first.
 *
 * "Latest update first" is by *last activity* on the note, not by creation: a note edited
 * today carries today's thinking, and burying it under newer but untouched entries would
 * defeat the point of reading top-down.
 */
export function sortNotes(notes: IssueNote[]): IssueNote[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
  })
}

/** Live notes for one issue, ordered for display. */
export function notesFor(
  notes: Record<string, IssueNote>,
  issueId: string,
): IssueNote[] {
  return sortNotes(Object.values(notes).filter((n) => n.issueId === issueId && !n.deletedAt))
}

/** Whether a note has been edited since it was written. */
export function wasEdited(n: IssueNote): boolean {
  return Boolean(n.updatedAt && n.updatedAt !== n.createdAt)
}
