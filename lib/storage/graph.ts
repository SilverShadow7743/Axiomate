import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { entraConfig } from '../auth/entra'
import { unconfiguredStore, type DocumentStore, type PutRequest, type StoredObject } from './contract'
import { DEFAULT_DOCUMENT_FILING, type DocumentFiling } from '../config'

/**
 * Documents in the firm's own SharePoint library, through Microsoft Graph.
 *
 * Chosen over Azure Blob deliberately: no new resource, no new bill, and the files land where
 * Axiocloud already keeps documents — reachable in Teams and Office by people who will never
 * open this application. The cost of that choice is that it depends on a consent an
 * administrator has to grant, and on Graph being up. Both are stated rather than discovered.
 *
 * ---------------------------------------------------------------------------
 * App-only, not on behalf of the signed-in person
 *
 * The token is client credentials against the registration this app already has. That means
 * Graph sees one identity for every upload, and **SharePoint's own permissions are therefore not
 * a second line of defence** — everything in the configured drive is reachable by this
 * application, and who may read what is decided here, by `can(...)` at the endpoint, and nowhere
 * else.
 *
 * That is worth being blunt about because the alternative reads safer than it is: delegated
 * access would put a person's own SharePoint permissions in the path, but it also means a
 * document uploaded by a consultant who later leaves becomes unreachable when their account is
 * disabled — losing the acceptance evidence for a delivered milestone. A shared application
 * identity keeps the firm's records the firm's.
 *
 * ---------------------------------------------------------------------------
 * What an administrator has to do once
 *
 *   1. Grant the registration the **application** permission `Files.ReadWrite.All`
 *      (or `Sites.ReadWrite.All` if the library is on a site rather than a drive), with admin
 *      consent. Delegated will not work — see above.
 *   2. Set `AXIOMATE_DOCS_DRIVE_ID` to the target document library's drive id.
 *
 * Which library is deployment configuration and stays an environment variable — it names a
 * resource in a tenant, like the database URL beside it. Where documents sit INSIDE that library
 * is a filing convention, and that is workspace configuration: `model.documentFiling`, editable
 * on the configuration screen without a deploy.
 *
 * Until both are done, `unavailable()` says which is missing and the upload endpoint refuses at
 * the door. Nothing here half-works.
 */

/** Graph switches upload mechanism at 4 MB; below it a single PUT is one round trip. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024

/** Upload sessions want 320 KiB-aligned chunks. This is 5 MiB, which is a multiple of that. */
const CHUNK = 5 * 320 * 1024 * 4

function driveId(): string | undefined {
  return process.env.AXIOMATE_DOCS_DRIVE_ID?.trim() || undefined
}

/** Read per call, not at module load, so a restart is all it takes to point somewhere else. */
export function documentStore(filing: DocumentFiling = DEFAULT_DOCUMENT_FILING): DocumentStore {
  const entra = entraConfig()
  const drive = driveId()

  if (!entra) {
    return unconfiguredStore(
      'Microsoft Entra is not configured on this deployment, and the document library is reached with its credentials. Set AXIOMATE_ENTRA_TENANT_ID, AXIOMATE_ENTRA_CLIENT_ID and AXIOMATE_ENTRA_CLIENT_SECRET.',
    )
  }
  if (!drive) {
    return unconfiguredStore(
      'No document library has been chosen. An administrator needs to grant this application the Files.ReadWrite.All application permission in Entra, then set AXIOMATE_DOCS_DRIVE_ID to the library’s drive id.',
    )
  }

  return {
    kind: 'graph',
    unavailable: () => null,
    put: (req) => put(drive, filing, req),
    get: (locator) => get(drive, locator),
    remove: (locator) => remove(drive, locator),
  }
}

/* ================================================================== *
 * The token
 * ================================================================== */

let cached: { token: string; expiresAt: number } | null = null

/**
 * An app-only token, cached until shortly before it expires.
 *
 * The sixty-second margin is not superstition: a token that is valid when the request is built
 * and expired when Graph reads it fails as a 401, which is indistinguishable from a withdrawn
 * consent. One of those an administrator must act on and the other resolves itself, so they must
 * not look the same.
 */
async function token(): Promise<string> {
  const entra = entraConfig()
  if (!entra) throw new Error('Entra is not configured.')
  const now = Date.now()
  if (cached && cached.expiresAt > now + 60_000) return cached.token

  const res = await fetch(`https://login.microsoftonline.com/${entra.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: entra.clientId,
      client_secret: entra.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) {
    /*
     * The response body is NOT included. It is Entra's own error text and can name the
     * registration and the tenant; this string reaches a user through the upload endpoint, and
     * an error message is not a place to publish configuration.
     */
    throw new Error(
      `The document library could not be reached: Microsoft rejected this application’s credentials (${res.status}). An administrator should check the client secret has not expired and that admin consent for Files.ReadWrite.All is still granted.`,
    )
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return json.access_token
}

/* ================================================================== *
 * Paths
 * ================================================================== */

/**
 * Where a document is filed.
 *
 * `axiomate/<tenant>/<yyyy>/<uuid>-<name>`, and three of those four parts are deliberate:
 *
 *   - the **tenant** segment, so one firm's documents can never be reached under another's
 *     prefix — the same rule every composite primary key in this schema enforces;
 *   - the **uuid**, so the stored name can never collide and so a re-upload of the same filename
 *     never silently replaces the earlier one, which would rewrite evidence;
 *   - the **year**, purely so a human opening the library in SharePoint sees something ordered.
 *
 * The uploaded name is sanitised to a safe subset rather than trusted. `uploadProblem` already
 * refuses a name containing a path, and this is the second of the two — the one that holds even
 * if a future caller forgets the first.
 */
function pathFor(filing: DocumentFiling, req: PutRequest, on: Date): string {
  const segment = (v: string, max: number) =>
    v.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, max)

  const root = segment(filing.rootFolder, 80) || 'Axiomate'
  const tenant = segment(req.tenantId, 60)
  const job = filing.byEngagement && req.folder ? segment(req.folder, 80) : ''
  const safe = segment(req.name, 120) || 'file'

  return [root, tenant, job, `${on.getUTCFullYear()}`, `${randomUUID()}-${safe}`]
    .filter(Boolean)
    .join('/')
}

/* ================================================================== *
 * put / get / remove
 * ================================================================== */

async function put(drive: string, filing: DocumentFiling, req: PutRequest): Promise<StoredObject> {
  /*
   * Checksummed from the bytes about to be written, not from what the client claimed. The record
   * this produces is what "is this still the document that was approved" is answered from, so it
   * has to describe what was stored rather than what was offered.
   */
  const checksum = createHash('sha256').update(req.bytes).digest('hex')
  const path = pathFor(filing, req, new Date())
  const bearer = await token()
  const base = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}`
  const target = `${base}/root:/${path.split('/').map(encodeURIComponent).join('/')}`

  if (req.bytes.byteLength < SIMPLE_UPLOAD_LIMIT) {
    const res = await fetch(`${target}:/content`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': req.mimeType || 'application/octet-stream' },
      body: req.bytes as unknown as BodyInit,
    })
    if (!res.ok) throw new Error(await putFailure(res))
    const item = (await res.json()) as { id: string }
    return { locator: item.id, checksum, sizeBytes: req.bytes.byteLength }
  }

  /*
   * Above 4 MB Graph requires an upload session, and the chunks must be sent in order with an
   * exact `Content-Range`. An off-by-one here does not fail loudly — Graph accepts the session
   * and the assembled file is wrong — so the ranges are inclusive and computed once.
   */
  const session = await fetch(`${target}:/createUploadSession`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
  })
  if (!session.ok) throw new Error(await putFailure(session))
  const { uploadUrl } = (await session.json()) as { uploadUrl: string }

  const total = req.bytes.byteLength
  for (let from = 0; from < total; from += CHUNK) {
    const to = Math.min(from + CHUNK, total)
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'content-length': String(to - from),
        'content-range': `bytes ${from}-${to - 1}/${total}`,
      },
      body: req.bytes.slice(from, to) as unknown as BodyInit,
    })
    // 202 between chunks, 200/201 on the last. Anything else means the file is incomplete, and
    // the session is abandoned rather than retried — a half-written document must not get a row.
    if (res.status === 200 || res.status === 201) {
      const item = (await res.json()) as { id: string }
      return { locator: item.id, checksum, sizeBytes: total }
    }
    if (res.status !== 202) {
      await fetch(uploadUrl, { method: 'DELETE' }).catch(() => {})
      throw new Error(await putFailure(res))
    }
  }
  throw new Error('The document library accepted every part of the file and never confirmed it. Nothing has been recorded.')
}

async function get(drive: string, locator: string): Promise<ReadableStream<Uint8Array> | null> {
  const bearer = await token()
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(locator)}/content`,
    { headers: { authorization: `Bearer ${bearer}` } },
  )
  // 404 is not an error here: it means the library no longer holds something this app has a row
  // for — somebody deleted it in SharePoint. The caller reports that as what it is.
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`The document library returned ${res.status} for that file.`)
  return res.body
}

async function remove(drive: string, locator: string): Promise<void> {
  const bearer = await token()
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(locator)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${bearer}` } },
  )
  // Already gone is the outcome asked for. 404 is success.
  if (!res.ok && res.status !== 404) {
    throw new Error(`The document library refused to delete that file (${res.status}).`)
  }
}

/**
 * What to tell somebody when Graph refuses an upload.
 *
 * The status is mapped to the job that would fix it. Graph's own message is not passed through:
 * it names drives, sites and the registration, and this string is shown to whoever tried to
 * attach a file.
 */
async function putFailure(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    return 'The document library refused this application. An administrator needs to confirm the Files.ReadWrite.All application permission is still consented, and that the drive id is one this registration can reach.'
  }
  if (res.status === 404) {
    return 'The configured document library no longer exists, or this application cannot see it. Check AXIOMATE_DOCS_DRIVE_ID.'
  }
  if (res.status === 507) return 'The document library is out of space.'
  if (res.status === 429 || res.status >= 500) {
    return 'The document library is busy or unavailable. Nothing has been recorded — try again shortly.'
  }
  return `The document library refused the file (${res.status}). Nothing has been recorded.`
}
