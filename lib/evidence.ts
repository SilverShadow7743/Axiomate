/**
 * Evidence and documents.
 *
 * Three concepts that look similar and are deliberately kept apart:
 *
 *   DATA SOURCE  where the issue record itself came from (the import), and the artifact it
 *                was raised from — traceability back to a file, sheet and row.
 *   EVIDENCE     material deliberately attached to support the issue: snapshots, data files,
 *                documents, links.
 *   HISTORY      what has happened to the issue.
 *
 * Collapsing them would lose the distinction between "this issue was extracted from row 117
 * of a spreadsheet" and "someone attached a screenshot proving the fix worked".
 */

/** A snapshot is point-in-time proof; a document is a supporting artifact. Not the same. */
export type EvidenceKind = 'snapshot' | 'data' | 'document' | 'link'

/**
 * Why a snapshot was taken. This is what makes a screenshot auditable rather than just an
 * image: "what did this look like before, and what does it look like now".
 */
export const SNAPSHOT_PURPOSES = [
  'Before fix',
  'Investigation evidence',
  'Resolution evidence',
  'Client confirmation',
  'Other',
] as const
export type SnapshotPurpose = (typeof SNAPSHOT_PURPOSES)[number]

export interface EvidenceItem {
  id: string
  issueId: string
  kind: EvidenceKind
  /** File name, or link title. */
  name: string
  /** Snapshots only. */
  purpose: SnapshotPurpose | null
  /** External URL for links; object URL for files held this session. */
  url: string | null
  mimeType: string | null
  sizeBytes: number | null
  note: string
  /**
   * The stored file this row describes, when the app actually holds one.
   *
   * Null is the honest and still-common case: an `imported` row describes material reconstructed
   * from the issue log, and a `link` points at somewhere else entirely. Evidence says WHY
   * something is attached; a `Document` IS the thing. Keeping them as two records preserves the
   * distinction this file opens by drawing — "this issue came from row 117 of a spreadsheet"
   * versus "somebody attached a screenshot proving the fix worked" — and lets one specification
   * be attached to two issues without duplicating either description.
   */
  documentId: string | null
  addedAt: string
  addedBy: string
  /**
   * `imported` items were reconstructed from the issue log and are read-only descriptions of
   * material we do not hold. `user` items were attached in this app.
   */
  origin: 'imported' | 'user'
  deletedAt: string | null
}

export const KIND_LABEL: Record<EvidenceKind, string> = {
  snapshot: 'Snapshots',
  data: 'Excel / Data',
  document: 'Documents',
  link: 'Links',
}

export const KIND_ICON: Record<EvidenceKind, string> = {
  snapshot: '🖼',
  data: '📊',
  document: '📄',
  link: '🔗',
}

const DATA_EXT = ['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods']
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic']
const DOC_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'msg', 'eml', 'log', 'rtf']

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/** Route a file to a category from its extension; images become snapshots. */
export function categorise(name: string, mimeType?: string | null): EvidenceKind {
  const ext = extensionOf(name)
  if (IMAGE_EXT.includes(ext) || (mimeType ?? '').startsWith('image/')) return 'snapshot'
  if (DATA_EXT.includes(ext)) return 'data'
  if (DOC_EXT.includes(ext)) return 'document'
  return 'document'
}

export function isPreviewableImage(item: EvidenceItem): boolean {
  return (
    !!item.url &&
    (IMAGE_EXT.includes(extensionOf(item.name)) || (item.mimeType ?? '').startsWith('image/'))
  )
}

export function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/* ------------------------------------------------------------------ *
 * Source document traceability
 * ------------------------------------------------------------------ */

export interface SourceRef {
  fileName: string
  /** Where the filename was found, so a detected reference is never shown as a recorded one. */
  detectedIn: 'subject' | 'reference'
}

const FILENAME_RE = /([A-Za-z0-9][\w \-.()&]*\.(?:xlsx|xlsm|xls|csv|pdf|docx|doc|pptx|ppt|msg|eml|png|jpg|jpeg))/

/**
 * Find the artifact an issue was raised from.
 *
 * Some rows in this log name their originating file in the subject — e.g. "Template for Roles
 * and Security for OAPIL_09_AUG_2026.xlsx". That is a real, checkable string in the source
 * data, so surfacing it gives genuine traceability.
 *
 * It is still *detected*, not recorded: the log has no attachment field, and we do not hold
 * the file. Callers must label it as detected and must not offer to open something that does
 * not exist.
 */
export function detectSourceDocument(issue: {
  subject: string
  reference: string
}): SourceRef | null {
  const fromRef = issue.reference?.match(FILENAME_RE)
  if (fromRef) return { fileName: fromRef[1].trim(), detectedIn: 'reference' }
  const fromSubject = issue.subject?.match(FILENAME_RE)
  if (fromSubject) return { fileName: fromSubject[1].trim(), detectedIn: 'subject' }
  return null
}

/** Tally per category for the compact strip in the editor. */
export function tallyByKind(items: EvidenceItem[]): Record<EvidenceKind, number> {
  const out: Record<EvidenceKind, number> = { snapshot: 0, data: 0, document: 0, link: 0 }
  for (const i of items) if (!i.deletedAt) out[i.kind]++
  return out
}

export function latestOf(items: EvidenceItem[]): EvidenceItem | null {
  const live = items.filter((i) => !i.deletedAt)
  if (!live.length) return null
  return live.reduce((a, b) => (a.addedAt >= b.addedAt ? a : b))
}
