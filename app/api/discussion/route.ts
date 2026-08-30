/**
 * The Discussion endpoint — E3's server-queried domain on the wire.
 *
 * `/api/discussion`, never `/api/chat`: that path is the assistant's. Tenant and actor
 * resolve exactly as `/api/workspace` resolves them — from the server's own configuration
 * and session, never from the request — and the same identity rule applies: with a provider
 * configured, an unverified request is refused.
 *
 * The body is validated by hand rather than through `lib/actionShape.ts`: these are not
 * workspace actions (they never reach the reducer), and four small kinds do not earn a
 * shape table.
 */
import { NextResponse } from 'next/server'
import { databaseConfigured } from '@/lib/db/client'
import { listThread, postMessage, removeOwn, setFollow } from '@/lib/db/discussion'
import { DISCUSSION_SCOPES, type DiscussionScopeKind } from '@/lib/discussion'
import { currentTenantId } from '@/lib/tenant'
import { getSession, identityEstablished } from '@/lib/principal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function refused(req: Request): NextResponse | null {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to take part.', signInRequired: true },
      { status: 401 },
    )
  }
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, disabled: true, error: 'No database is configured.' })
  }
  return null
}

function scopeOf(v: { scopeKind?: unknown; scopeId?: unknown }): { scopeKind: DiscussionScopeKind; scopeId: string } | null {
  const kind = typeof v.scopeKind === 'string' ? v.scopeKind : ''
  const id = typeof v.scopeId === 'string' ? v.scopeId.trim() : ''
  if (!(DISCUSSION_SCOPES as readonly string[]).includes(kind) || !id) return null
  return { scopeKind: kind as DiscussionScopeKind, scopeId: id }
}

export async function GET(req: Request) {
  const gate = refused(req)
  if (gate) return gate
  const url = new URL(req.url)
  const scope = scopeOf({ scopeKind: url.searchParams.get('scopeKind'), scopeId: url.searchParams.get('scopeId') })
  if (!scope) {
    return NextResponse.json({ ok: false, error: 'A discussion is asked for by its record: scopeKind and scopeId.' }, { status: 400 })
  }
  const before = url.searchParams.get('before') ?? undefined
  const view = await listThread(currentTenantId(), getSession(req).actor, scope.scopeKind, scope.scopeId, before)
  if ('error' in view) return NextResponse.json({ ok: false, error: view.error }, { status: 403 })
  return NextResponse.json({ ok: true, ...view })
}

export async function POST(req: Request) {
  const gate = refused(req)
  if (gate) return gate
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }
  const b = body as { kind?: unknown; scopeKind?: unknown; scopeId?: unknown; text?: unknown; follow?: unknown; messageId?: unknown; ownerName?: unknown }
  const tenantId = currentTenantId()
  const actor = getSession(req).actor

  if (b.kind === 'post') {
    const scope = scopeOf(b)
    if (!scope) return NextResponse.json({ ok: false, error: 'A message belongs somewhere: scopeKind and scopeId.' }, { status: 400 })
    if (typeof b.text !== 'string') return NextResponse.json({ ok: false, error: 'A message is text.' }, { status: 400 })
    const owner = typeof b.ownerName === 'string' ? b.ownerName : null
    const r = await postMessage(tenantId, actor, scope.scopeKind, scope.scopeId, b.text, owner)
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: 422 })
    return NextResponse.json({ ok: true, message: r.message })
  }
  if (b.kind === 'follow' || b.kind === 'unfollow') {
    const scope = scopeOf(b)
    if (!scope) return NextResponse.json({ ok: false, error: 'Following names the record: scopeKind and scopeId.' }, { status: 400 })
    const r = await setFollow(tenantId, actor, scope.scopeKind, scope.scopeId, b.kind === 'follow')
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: 422 })
    return NextResponse.json({ ok: true, following: r.following })
  }
  if (b.kind === 'remove') {
    if (typeof b.messageId !== 'string' || !b.messageId) {
      return NextResponse.json({ ok: false, error: 'Removing names the message.' }, { status: 400 })
    }
    const r = await removeOwn(tenantId, actor, b.messageId)
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: 422 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ ok: false, error: 'Unrecognised request.' }, { status: 400 })
}
