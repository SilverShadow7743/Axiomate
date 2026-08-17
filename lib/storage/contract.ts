/**
 * Where the bytes go, expressed narrowly enough that the choice of backend is not load-bearing.
 *
 * Deliberately NOT `server-only`, so the scenario harness can drive the contract and the
 * not-configured behaviour without a network. The one implementation that actually moves bytes
 * lives in `./graph.ts`, which is.
 *
 * ---------------------------------------------------------------------------
 * Three outcomes, not two
 *
 * The same shape `lib/db/boot.ts` uses for the database, and for the same reason it was written
 * there: *"a tool that silently drops from 'your edits are saved' to 'your edits are not saved'
 * is worse than one that never offered saving."* A document store can be **working**,
 * **not configured**, or **configured and failing**, and a product that collapses the last two
 * into "upload failed" tells an administrator nothing about which of two very different jobs is
 * theirs.
 *
 * So `unavailable()` returns a sentence naming what is missing and who can supply it, and the
 * upload endpoint returns it verbatim rather than paraphrasing.
 *
 * ---------------------------------------------------------------------------
 * The interface is three calls
 *
 * `put`, `get`, `remove`. It stays this narrow on purpose: SharePoint via Graph was chosen over
 * Azure Blob, and the argument for either is a business one — where the firm already keeps its
 * documents, versus a resource nobody has to consent to. That argument should be settleable
 * without touching the reducer, the record, the endpoint or the screen, and at three calls it is.
 *
 * What a store never does: decide who may read a document, or return a URL a browser could use.
 * The first is `can(...)` at the endpoint; the second is refused outright — see
 * `DocumentRecord.locator`.
 */

export interface StoredObject {
  /** How this store finds the bytes again. Opaque to everything above. */
  locator: string
  /** SHA-256, hex, computed from the bytes that were actually written. */
  checksum: string
  sizeBytes: number
}

export interface PutRequest {
  /** Scopes the stored path. A tenant's documents can never be reached from another's. */
  tenantId: string
  /** The name as uploaded. A store may use it for readability and must not trust it as a path. */
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface DocumentStore {
  /** `graph` today. Recorded on each document so a half-finished migration stays legible. */
  readonly kind: 'graph'
  /**
   * Why this store cannot be used right now, or null when it can.
   *
   * A sentence for a human, naming the missing piece. Checked before bytes are read, so a
   * misconfigured deployment refuses an upload at the door rather than after a 25 MB body has
   * crossed the wire.
   */
  unavailable(): string | null
  put(req: PutRequest): Promise<StoredObject>
  /** The bytes, or null when the store no longer has them — which the caller must report as such. */
  get(locator: string): Promise<ReadableStream<Uint8Array> | null>
  remove(locator: string): Promise<void>
}

/**
 * The store used when nothing is configured.
 *
 * It refuses every call with the reason, rather than throwing something generic or — worse —
 * succeeding and dropping the bytes. An upload that reports success and stores nothing is the
 * failure this whole entity exists to prevent, and it would be very easy to write by accident
 * in a stub.
 */
export function unconfiguredStore(reason: string): DocumentStore {
  return {
    kind: 'graph',
    unavailable: () => reason,
    put: async () => {
      throw new Error(reason)
    },
    get: async () => {
      throw new Error(reason)
    },
    remove: async () => {
      throw new Error(reason)
    },
  }
}

/** One sentence for the settings screen, so the state of the store is visible without a test upload. */
export function describeStore(store: DocumentStore): string {
  const why = store.unavailable()
  return why
    ? `Files cannot be stored. ${why}`
    : 'Files are stored in the firm’s SharePoint document library, through Microsoft Graph.'
}
