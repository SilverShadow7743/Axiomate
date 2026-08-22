/**
 * Files the application actually holds.
 *
 * Pure — no clock, no I/O, no store. Every function is given what it needs to reason about.
 *
 * ---------------------------------------------------------------------------
 * A `DocumentRecord` exists only when the bytes exist
 *
 * There is no `storage: 'absent'` here, and its absence is the design. A record that could say
 * "we do not hold this file" would rebuild the exact fault scenario D calls P1 — *"the record
 * describes an artefact the system does not hold"* — inside the entity built to fix it.
 *
 * Material the firm does not hold already has an honest home: `Evidence` with
 * `origin: 'imported'`, which says so, and `detectSourceDocument`, which labels a filename found
 * in a subject line as *detected* rather than recorded. `lib/evidence.ts` opens by explaining why
 * those concepts are kept apart, and this does not merge them. `Evidence.documentId` is the join:
 * evidence says WHY something is attached, a document IS the thing.
 *
 * The order of operations follows from it, and it is the thing most likely to be got backwards:
 * **store the bytes, then write the record.** Record-first means a crash leaves a row pointing at
 * nothing and a screen offering a document nobody can open — which is the fault above, arrived at
 * by accident instead of by design. Bytes-first leaves an orphaned object nobody can see, costing
 * pennies and no credibility.
 *
 * ---------------------------------------------------------------------------
 * The locator never leaves the server
 *
 * `locator` is how the store finds the bytes. It is null in every copy that crosses the boundary,
 * unconditionally — not per permission, the way skill levels are, because there is no reader who
 * needs it. The browser downloads through `GET /api/documents/[id]`, which authorises the
 * request when it is made.
 *
 * An absolute rule rather than a grant-dependent one is deliberate. `WorkspaceState` is
 * serialised into the page, and the payload-leak class has caught this codebase three times —
 * `meta` on the sign-in gate, then rates, then skill levels. A rule with no exceptions is one
 * nobody has to re-derive when they add the fourth collection.
 */

/** What a document can be attached to. `Version` uses the same subjectKind/subjectId shape. */
export const DOCUMENT_SUBJECTS = ['issue', 'sow', 'node', 'change'] as const
export type DocumentSubject = (typeof DOCUMENT_SUBJECTS)[number]

/**
 * Which backend holds the bytes.
 *
 * Recorded per document rather than assumed from configuration, because a firm that moves from
 * one store to another has documents in both for as long as the migration takes, and a row that
 * does not say where it lives is a row nobody can fetch afterwards.
 */
export const STORE_KINDS = ['graph'] as const
export type StoreKind = (typeof STORE_KINDS)[number]

export interface DocumentRecord {
  /** `doc-12`, minted from the durable workspace counter. */
  id: string
  subjectKind: DocumentSubject
  subjectId: string
  /** The name as uploaded, for display and download. Never used to build a storage path. */
  name: string
  mimeType: string
  sizeBytes: number
  /**
   * SHA-256 of the bytes, hex.
   *
   * Two jobs: telling a re-upload of the same file from a genuinely new one, and answering
   * "is this still the document that was approved" without fetching it.
   *
   * Matched **within a tenant only**. A cross-tenant checksum match would answer "does that
   * other firm hold this exact file", which is a question nobody should be able to ask.
   */
  checksum: string
  /** How the store finds the bytes. **Null in every copy that leaves the server** — see above. */
  locator: string | null
  store: StoreKind
  note: string
  uploadedBy: string
  uploadedById?: string
  uploadedAt: string
  /**
   * The document this one replaces — the version chain, walked by `lib/proofing.ts`.
   * Optional because rows stored before phase 6 never carried it; absent reads as null.
   */
  supersedesId?: string | null
  /** Whether a client-facing surface may offer this file. Default false; absent reads as false. */
  clientVisible?: boolean
  deletedAt: string | null
}

/* ================================================================== *
 * What may be uploaded
 * ================================================================== */

/**
 * Twenty-five megabytes.
 *
 * Not a guess: this runs on a B1 App Service instance with 1.75 GB of memory, and the upload
 * path buffers in order to checksum before storing. A limit that lets four people upload a
 * 200 MB file at once is a limit that takes the site down, and the failure would land on
 * everybody rather than on the person who chose the file.
 *
 * It is enforced on the server from the actual byte count, not from `Content-Length`, which a
 * client supplies and can lie about.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * Extensions this will not accept.
 *
 * A deny list rather than an allow list, deliberately and with a stated cost: consultancies
 * attach things nobody predicts — `.bak`, `.axmodel`, `.dat`, a renamed export — and an allow
 * list would refuse real work weekly until somebody widened it, which is how a control gets
 * turned off entirely.
 *
 * So this refuses the narrow set whose whole purpose is to execute, and accepts the rest. It is
 * not virus scanning and must not be described as such. Files are served back with
 * `Content-Disposition: attachment` and a non-sniffing content type, so the browser never runs
 * one — that, rather than this list, is what actually makes an upload safe to hold.
 *
 * `js` is the one judgement call in it, and it is deliberate. In a D365 context a `.js` file is
 * sometimes a genuine extension sample rather than an attack, so this will refuse real work
 * occasionally — but on Windows a downloaded `.js` runs under Windows Script Host on a
 * double-click, exactly like `.vbs`, and "it was only a code sample" is not a distinction the
 * operating system makes. The refusal names the zip workaround for that reason. `.json` is a
 * different extension and is accepted.
 */
const REFUSED_EXTENSIONS = [
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'jar',
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'dll', 'sys', 'drv', 'hta', 'lnk', 'reg', 'inf', 'chm',
]

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/**
 * Why this upload cannot be accepted, or null.
 *
 * Every rule here is also a rule the endpoint applies, and that duplication is on purpose: this
 * is the version the scenario harness can drive, and a rule that exists only inside a route
 * handler is a rule nothing tests.
 */
export function uploadProblem(file: {
  name: string
  sizeBytes: number
  mimeType: string
}): string | null {
  const name = file.name.trim()
  if (!name) return 'A file needs a name.'
  if (name.length > 255) return 'That file name is too long to store.'

  /*
   * A name is display text and never a path. These characters are refused so that a name can
   * never be read as one — not because the store concatenates it (it does not; the locator comes
   * back from the store), but because a name containing `../` will eventually be handed to
   * something that does, and refusing it once here is cheaper than auditing every future caller.
   */
  if (/[\\/]|\.\./.test(name)) return 'A file name cannot contain a path.'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) return 'That file name contains characters that cannot be stored.'

  if (!(file.sizeBytes > 0)) return 'That file is empty.'
  if (file.sizeBytes > MAX_UPLOAD_BYTES) {
    return `That file is ${formatBytes(file.sizeBytes)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} — this runs on a small instance, and a larger one would take the site down for everybody rather than fail for you.`
  }

  const ext = extensionOf(name)
  if (REFUSED_EXTENSIONS.includes(ext)) {
    return `“.${ext}” files are not accepted — their purpose is to execute. Put it in a zip if it genuinely needs to travel with the record.`
  }
  return null
}

/** Why this document cannot be attached where it is being attached, or null. */
export function subjectProblem(subjectKind: string, subjectId: string): string | null {
  if (!(DOCUMENT_SUBJECTS as readonly string[]).includes(subjectKind)) {
    return 'That is not something a document can be attached to.'
  }
  if (!subjectId.trim()) return 'A document has to be attached to something.'
  return null
}

/* ================================================================== *
 * Reading
 * ================================================================== */

export function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Everything live attached to one subject, newest first. */
export function documentsFor(
  documents: DocumentRecord[],
  subjectKind: DocumentSubject,
  subjectId: string,
): DocumentRecord[] {
  return documents
    .filter((d) => !d.deletedAt && d.subjectKind === subjectKind && d.subjectId === subjectId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
}

/**
 * A live document with these exact bytes already on this subject, or null.
 *
 * Scoped to the subject rather than the whole tenant. The same specification attached to two
 * issues is two legitimate attachments; the same file attached twice to one issue is a
 * double-click. Only the second is worth refusing, and treating the first as a duplicate would
 * make the second attachment silently fail to appear where somebody put it.
 */
export function duplicateOf(
  documents: DocumentRecord[],
  candidate: { subjectKind: DocumentSubject; subjectId: string; checksum: string },
): DocumentRecord | null {
  return (
    documents.find(
      (d) =>
        !d.deletedAt &&
        d.subjectKind === candidate.subjectKind &&
        d.subjectId === candidate.subjectId &&
        d.checksum === candidate.checksum,
    ) ?? null
  )
}

/**
 * How the document set reads, and what it costs.
 *
 * The ceiling is stated rather than capped. Documents are the first collection here that grows
 * without bound — rates are bounded by people, changes by contracts, skills by both — and the
 * obvious defence, loading only the most recent N, is wrong for this collection specifically:
 * evidence exists to be produced at a governance meeting, and the piece somebody asks for is
 * usually the old one.
 *
 * So the whole set travels, and the number at which that stops being free is written down. A
 * metadata row is roughly 300 bytes in the payload, so ten thousand documents is about 3 MB on
 * every page load. The fix at that point is to scope the collection to the record being viewed,
 * which is a change to `boot()` and to nothing else — not a cap that quietly hides evidence.
 */
export function describeDocuments(documents: DocumentRecord[]): string {
  const live = documents.filter((d) => !d.deletedAt)
  if (!live.length) return 'No files are held.'
  const bytes = live.reduce((n, d) => n + d.sizeBytes, 0)
  return `${live.length} ${live.length === 1 ? 'file' : 'files'} held, ${formatBytes(bytes)} in total.`
}
