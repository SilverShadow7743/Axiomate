/**
 * Producing a stored file.
 *
 * ---------------------------------------------------------------------------
 * Why the bytes come through here rather than from a URL
 *
 * The obvious design is to hand the browser a pre-authenticated link — a SAS URL, or Graph's own
 * short-lived download URL — and let it fetch directly. It is faster and it is wrong here.
 *
 * Such a URL is a bearer credential. It works for anybody who has it, it outlives the session
 * that produced it, and it keeps working after the grant that produced it is taken away. Putting
 * one in the page payload would be the rates leak with a longer fuse, and this file's siblings
 * have now been caught by the payload-leak class three times. `boot()` therefore strips
 * `locator` from every copy of every document, unconditionally, and the only way to the bytes is
 * a request that is authorised when it is made.
 *
 * The cost is real and accepted: every download crosses this B1 instance twice. Slower and right.
 *
 * ---------------------------------------------------------------------------
 * What a signed-in person may fetch
 *
 * Any live document in their tenant. There is deliberately no `document.view` grant — the
 * reasoning is in `lib/access.ts` beside the two keys that do exist — and per-record
 * confidentiality is a different feature (row-level security) that the audit lists as an open
 * decision. Pretending otherwise here would be worse than the honest position.
 *
 * The tenant boundary is not optional and is not taken from the request: `currentTenantId()`
 * resolves it server-side, and the document is looked up within that tenant's workspace only.
 */

import { NextResponse } from 'next/server'
import { databaseConfigured } from '@/lib/db/client'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'
import { documentStore } from '@/lib/storage/graph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Types a browser may be told to render.
 *
 * Everything else is served as `application/octet-stream`. Combined with the attachment
 * disposition and `nosniff` below, this is what actually makes holding an arbitrary upload safe:
 * an HTML file attached to an issue must never render in the app's own origin, where it would
 * run with the session cookie in scope.
 *
 * PDFs are on the list because refusing to preview a PDF would make the feature useless for the
 * documents consultancies actually attach, and browsers render them in a sandboxed viewer.
 */
const INLINE_SAFE = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
])

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  /*
   * `getSession` needs the request, and the one handed to a route handler is the one to use —
   * `publicOrigin`'s lesson was that a request object behind App Service does not describe the
   * outside world, but its cookies are still the caller's.
   */
  const session = getSession(_req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json({ ok: false, error: 'Sign in to open this file.' }, { status: 401 })
  }
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: 'No database is configured.' }, { status: 503 })
  }

  const store = documentStore()
  const unavailable = store.unavailable()
  if (unavailable) return NextResponse.json({ ok: false, error: unavailable }, { status: 503 })

  try {
    const { state } = await loadWorkspace(currentTenantId())
    const doc = state.documents[id]
    /*
     * A withdrawn document is a 404, not a 403.
     *
     * Both are true and 404 is the right one: the file is no longer attached to anything, so
     * there is nothing here to be refused access to. Answering 403 would also confirm that a
     * document with this id exists, which is more than the question deserves.
     */
    if (!doc || doc.deletedAt) {
      return NextResponse.json({ ok: false, error: 'That file is not attached here.' }, { status: 404 })
    }
    if (!doc.locator) {
      // Only reachable if a redacted copy were ever persisted, which `documentToRow` refuses.
      // Reported rather than assumed impossible.
      return NextResponse.json(
        { ok: false, error: 'That record has no stored location. Nothing can be produced for it.' },
        { status: 500 },
      )
    }

    const body = await store.get(doc.locator)
    if (!body) {
      // The library no longer holds it — somebody deleted it in SharePoint. Said plainly,
      // because the alternative is a generic failure that reads like an outage.
      return NextResponse.json(
        {
          ok: false,
          error: 'The document library no longer holds this file. It was removed there rather than here, and this record is the only trace left.',
        },
        { status: 410 },
      )
    }

    const type = INLINE_SAFE.has(doc.mimeType) ? doc.mimeType : 'application/octet-stream'
    return new Response(body, {
      headers: {
        'content-type': type,
        'content-length': String(doc.sizeBytes),
        /*
         * `attachment`, and the filename encoded rather than interpolated. A name containing a
         * quote or a newline would otherwise let the uploader write their own response headers.
         * `uploadProblem` already refuses control characters; this is the second of the two.
         */
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        'x-content-type-options': 'nosniff',
        // A document is somebody's evidence, not a public asset. No shared cache holds it.
        'cache-control': 'private, no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'That file could not be produced.'
    return NextResponse.json({ ok: false, error: message }, { status: 502 })
  }
}
