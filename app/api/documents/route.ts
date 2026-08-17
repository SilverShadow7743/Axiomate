/**
 * The upload endpoint.
 *
 * ---------------------------------------------------------------------------
 * Why this is a second door, and what that costs
 *
 * `/api/workspace` takes JSON and validates it against `SHAPES`. Multipart cannot travel through
 * it, so bytes need their own entrance — and a new entrance re-derives every guard that one
 * accumulated, each of which was added because something went wrong once.
 *
 * They are enumerated here rather than remembered:
 *
 *   validate before the database   a malformed request is a client bug whether or not a database
 *                                  exists, and answering it with "no database is configured"
 *                                  reports the wrong fault.
 *   a verified session             `identityEstablished() && !verified` → 401. The read gate on
 *                                  `boot()` was added late, after an anonymous visitor was being
 *                                  served the whole workspace; a byte-accepting door without it
 *                                  would be worse — it would take input as well as give it.
 *   the tenant, resolved server-side  `currentTenantId()`, never a field on the request.
 *   the permission, checked HERE   and again in the reducer. Not belt and braces: the bytes are
 *                                  stored before the reducer runs, so a check only there would
 *                                  mean writing somebody's file into the firm's document library
 *                                  and then refusing to record it — an object nothing lists and
 *                                  nobody can delete.
 *   a size limit from the actual bytes  `Content-Length` is supplied by the client. It is used
 *                                  only for the cheap early refusal; the limit that counts is
 *                                  measured after reading.
 *
 * ---------------------------------------------------------------------------
 * Store first, record second, and compensate
 *
 * The ordering is argued in `lib/documents.ts`: a row pointing at nothing is a screen offering a
 * document nobody can open, which is the fault this entity exists to fix. An orphaned object is
 * invisible and costs pennies.
 *
 * "Invisible" is still not "fine", so a refused record deletes the object it just wrote. That
 * compensation is best-effort by nature — if it fails, the object stays and this says so in the
 * log rather than pretending the system is clean.
 */

import { NextResponse } from 'next/server'
import { can } from '@/lib/access'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { loadWorkspace } from '@/lib/db/repo'
import { persistActions } from '@/lib/db/persist'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'
import { documentStore } from '@/lib/storage/graph'
import { MAX_UPLOAD_BYTES, formatBytes, subjectProblem, uploadProblem } from '@/lib/documents'
import type { Action } from '@/lib/workspace'
import type { SubmittedAction } from '@/lib/idempotency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json(
      { ok: false, error: 'A file has to be sent as multipart/form-data.' },
      { status: 400 },
    )
  }

  /*
   * The cheap refusal first, from the header, so an over-sized upload is stopped before it
   * crosses the wire rather than after. This is NOT the limit — a client can send any
   * `Content-Length` it likes, or none — it is the courtesy version of it.
   */
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES * 1.1) {
    return NextResponse.json(
      { ok: false, error: `That file is larger than the ${formatBytes(MAX_UPLOAD_BYTES)} limit.` },
      { status: 413 },
    )
  }

  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to attach a file.', signInRequired: true },
      { status: 401 },
    )
  }

  if (!databaseConfigured()) {
    // Refused rather than stored. Without a database the record cannot be written, and storing
    // the bytes anyway would put a file in the firm's library that nothing in the app can find.
    return NextResponse.json(
      { ok: false, disabled: true, error: 'No database is configured, so an attachment could not be recorded.' },
      { status: 503 },
    )
  }

  const store = documentStore()
  const unavailable = store.unavailable()
  if (unavailable) {
    // Verbatim. The store's sentence names which of two very different jobs is somebody's —
    // grant a consent, or set a drive id — and paraphrasing it here would lose that.
    return NextResponse.json({ ok: false, error: unavailable }, { status: 503 })
  }

  const tenantId = currentTenantId()

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'That upload could not be read.' }, { status: 400 })
  }

  const file = form.get('file')
  const subjectKind = String(form.get('subjectKind') ?? '')
  const subjectId = String(form.get('subjectId') ?? '')
  const note = String(form.get('note') ?? '')
  const evidenceId = form.get('evidenceId') ? String(form.get('evidenceId')) : null

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file was sent.' }, { status: 400 })
  }
  const badSubject = subjectProblem(subjectKind, subjectId)
  if (badSubject) return NextResponse.json({ ok: false, error: badSubject }, { status: 400 })

  const mimeType = file.type || 'application/octet-stream'
  const named = uploadProblem({ name: file.name, sizeBytes: file.size, mimeType })
  if (named) return NextResponse.json({ ok: false, error: named }, { status: 400 })

  try {
    /*
     * The permission, before a byte is stored.
     *
     * `loadWorkspace` for the model alone is a real cost on a page that is about to do it again
     * inside `persistActions`. It is paid deliberately: the alternative is discovering somebody
     * may not attach a file only after their file is in the firm's document library.
     */
    const { state } = await loadWorkspace(tenantId)
    const may = can(state.model, session.actor, 'document.upload')
    if (!may.allowed) {
      return NextResponse.json({ ok: false, error: may.reason ?? 'Not permitted.' }, { status: 403 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    // The limit that counts, from what actually arrived rather than what was announced.
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: `That file is ${formatBytes(bytes.byteLength)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` },
        { status: 413 },
      )
    }
    if (!bytes.byteLength) {
      return NextResponse.json({ ok: false, error: 'That file is empty.' }, { status: 400 })
    }

    const stored = await store.put({ tenantId, name: file.name, mimeType, bytes })

    const action: SubmittedAction = {
      t: 'recordDocument',
      subjectKind,
      subjectId,
      name: file.name,
      mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      locator: stored.locator,
      store: store.kind,
      note,
      evidenceId,
      now: new Date().toISOString(),
    } as unknown as SubmittedAction

    const result = await persistActions(tenantId, session.actor, [action])

    if (!result.ok) {
      /*
       * The compensation. The reducer refused — a duplicate, a subject that has since been
       * archived — so the object it wrote has nothing pointing at it.
       *
       * Failure here is swallowed to a log rather than surfaced: the user's request already has
       * its real answer, which is the reducer's refusal, and replacing it with a storage error
       * would report the wrong fault. What is left behind is one orphaned file in the library,
       * which an administrator can see and this line explains.
       */
      await store.remove(stored.locator).catch((e) => {
        console.error(
          `[documents] Orphaned object left in the library: ${stored.locator} — the record was refused (${result.error}) and the cleanup also failed:`,
          e,
        )
      })
      return NextResponse.json(result, { status: 409 })
    }

    /*
     * The record travels back, with the locator stripped.
     *
     * Necessary rather than convenient: the browser holds the workspace in memory and there is
     * no refetch path in this application — `/api/workspace` describes one in a comment and
     * nothing implements it. So a document the client cannot see would stay invisible until the
     * page was reloaded, and the person who just attached it would conclude it had not worked.
     *
     * `locator: null`, by the same absolute rule `boot()` applies. This is a second exit from
     * the server and it obeys the same rule, which is the point of the rule having no exceptions.
     */
    return NextResponse.json(
      {
        ...result,
        document: {
          id: result.createdId,
          subjectKind,
          subjectId,
          name: file.name,
          mimeType,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          locator: null,
          store: store.kind,
          note,
          uploadedBy: session.actor.name,
          uploadedById: session.actor.id,
          uploadedAt: (action as unknown as { now: string }).now,
          deletedAt: null,
        },
        evidenceId,
      },
      { status: 200 },
    )
  } catch (err) {
    // The store's own sentences are already written for a person — see `putFailure` — so they
    // travel. Anything else is a database fault and is described as one.
    const message = err instanceof Error ? err.message : describeDbError(err)
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
