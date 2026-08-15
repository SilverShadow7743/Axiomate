/**
 * The workspace write endpoint.
 *
 * Takes one `Action` — the exact value the browser dispatched — and replays it against stored
 * state through the same reducer. The client has already applied it optimistically, so this
 * is a confirmation, not a round trip the UI waits on. What it can still do is disagree: if
 * the reducer rejects the action here (because stored state moved on), the response says so
 * and the client refetches rather than drifting.
 */

import { NextResponse } from 'next/server'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { currentTenantId } from '@/lib/tenant'
import { currentActor } from '@/lib/identity'
import type { Action } from '@/lib/workspace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A queue drain should never be unbounded; anything larger is a client bug, not a workload. */
const MAX_BATCH = 200

/** Action kinds the endpoint will replay. Anything else is refused rather than guessed at. */
const KINDS = new Set([
  'create',
  'updateNode',
  'updateIssue',
  'updateActivity',
  'softDelete',
  'restore',
  'move',
  'link',
  'unlink',
  'setDates',
  'addDependency',
  'removeDependency',
  'addEvidence',
  'updateEvidence',
  'removeEvidence',
  'addNote',
  'updateNote',
  'removeNote',
  'setEstimate',
  'baselineEstimate',
  'addTime',
  'updateTime',
  'removeTime',
  'requestApproval',
  'decideApproval',
  'markNotificationRead',
  'upsertSow',
  'archiveSow',
  'attributeToSow',
  'upsertAllocation',
  'removeAllocation',
  'upsertCommitment',
  'removeCommitment',
  // `notify` is deliberately absent. Notifications are raised by rules, and the server plans
  // the same rules the browser does — so a notify action arriving over the wire could only be
  // one the client invented.
  'buildLifecycle',
  'clearLifecycle',
  'config',
  'setAssignment',
  'updateEngagement',
])

export async function POST(req: Request) {
  // The request is validated BEFORE the database is considered.
  //
  // Reversing these reads better but is wrong: a malformed body is a client bug whether or not
  // a database exists, and answering it with "no database is configured" reports the wrong
  // fault. It also makes the validation unreachable — and therefore untestable — on any
  // deployment without a database, which is the mode this app ships in by default.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  // Accepts one action or an ordered batch. The client autosaves through a serial queue and
  // sends whatever has accumulated, so a batch is the normal case rather than the exception.
  const raw = body as { action?: unknown; actions?: unknown }
  const list = Array.isArray(raw.actions) ? raw.actions : raw.action ? [raw.action] : []

  if (!list.length) {
    return NextResponse.json({ ok: false, error: 'No action was sent.' }, { status: 400 })
  }
  if (list.length > MAX_BATCH) {
    return NextResponse.json({ ok: false, error: 'Too many actions in one request.' }, { status: 413 })
  }
  if (!list.every((a) => a && typeof a === 'object' && KINDS.has((a as Action).t))) {
    return NextResponse.json({ ok: false, error: 'Unrecognised action.' }, { status: 400 })
  }

  if (!databaseConfigured()) {
    // Not an error: running from the seed file with no database is a supported mode, and the
    // client is already keeping this session in its own mirror. Saying so lets the queue stop
    // rather than retrying something that cannot work.
    return NextResponse.json({ ok: false, disabled: true, error: 'No database is configured.' })
  }

  try {
    /**
     * Both the tenant and the actor are resolved here, from the server's own configuration —
     * never from the request body.
     *
     * That is the whole point of the seam. A client-supplied tenant id would let anyone read
     * and write any firm's workspace by changing one field, which is worse than having no
     * tenancy at all: it would look like isolation while being an open door. The same
     * argument applies to attribution, and `Action` has no actor field precisely so that the
     * browser has nothing to forge. When authentication arrives, both calls learn to read the
     * session; the request body still never gets a say.
     */
    const result = await persistActions(currentTenantId(), currentActor(), list as Action[])
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (err) {
    return NextResponse.json({ ok: false, error: describeDbError(err) }, { status: 500 })
  }
}
