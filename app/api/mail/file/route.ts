import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { can, isStaffedOn } from '@/lib/access'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { loadWorkspace } from '@/lib/db/repo'
import { persistActions } from '@/lib/db/persist'
import { currentTenantId } from '@/lib/tenant'
import { mapGraphMessage, type GraphMessageLike } from '@/lib/mailFile'
import { projectOf, type Action } from '@/lib/workspace'
import type { SubmittedAction } from '@/lib/idempotency'

export const dynamic = 'force-dynamic'

/**
 * File a mail from the person's own inbox as tracked work — the OAPIL-153 pattern as a
 * product capability. Attributed to the SESSION actor (a mail filed by Tarun says Tarun),
 * deduped HERE by internetMessageId because `recordInboundMail` deliberately does not
 * dedupe (the intake endpoint owns that job on its own path).
 */
export async function POST(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    logAuthRefusal('POST /api/mail/file', 'not signed in', session.actor)
    return NextResponse.json({ ok: false, error: 'Sign in to file mail.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    messageId?: string
    mode?: 'create' | 'attach'
    parentId?: string
    module?: string
    issueId?: string
  } | null
  if (!body?.messageId || !body.mode) {
    return NextResponse.json({ ok: false, error: 'A message id and a mode are needed.' }, { status: 400 })
  }
  if (body.mode === 'create' && !body.parentId) {
    return NextResponse.json({ ok: false, error: 'Creating needs a parent scope.' }, { status: 400 })
  }
  if (body.mode === 'attach' && !body.issueId) {
    return NextResponse.json({ ok: false, error: 'Attaching needs an issue.' }, { status: 400 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    return NextResponse.json({ ok: false, reconnect: true, error: 'Reconnect your inbox first.' }, { status: 401 })
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(body.messageId)}?$select=subject,from,bodyPreview,body,receivedDateTime,internetMessageId,conversationId`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `Microsoft refused the message read (${res.status}).` },
      { status: 502 },
    )
  }
  const msg = (await res.json()) as GraphMessageLike

  const tenantId = currentTenantId()
  const { state } = await loadWorkspace(tenantId)

  const may = can(state.model, session.actor, 'evidence.add')
  if (!may.allowed) {
    logAuthRefusal('POST /api/mail/file', may.reason ?? 'evidence.add refused', session.actor)
    return NextResponse.json({ ok: false, error: may.reason ?? 'Not permitted.' }, { status: 403 })
  }

  /* The dedupe the arm deliberately lacks: a mail files once, however many clicks. */
  const already = msg.internetMessageId
    ? Object.values(state.inboundMail).find((m) => m.messageId === msg.internetMessageId)
    : undefined
  if (already) {
    return NextResponse.json(
      {
        ok: false,
        error: `This mail is already filed${already.issueId ? ` against ${already.issueId}` : ''}.`,
        issueId: already.issueId,
      },
      { status: 409 },
    )
  }

  const filer = {
    name: session.actor.name,
    email: session.email ?? session.actor.email ?? '',
  }
  const mapped = mapGraphMessage(msg, filer, { module: body.module ?? 'Inventory' }, state.model)
  const now = new Date().toISOString()

  if (body.mode === 'create') {
    /* A parent with no project ancestor (the tier chain permits an issue directly under a
     * client or engagement) has no staffing fact to check `recordInboundMail` against — see
     * the matching gate below on the attach path. Requiring `internal.view` here keeps a
     * client seat, who legitimately holds `evidence.add`, from filing mail on a structural
     * node outside any client's own scope (ART-20260906-030's F1). */
    if (!projectOf(state, body.parentId ?? '')) {
      const mayInternal = can(state.model, session.actor, 'internal.view')
      if (!mayInternal.allowed) {
        logAuthRefusal('POST /api/mail/file (create, no project)', 'internal.view refused', session.actor)
        return NextResponse.json(
          { ok: false, error: 'This scope has no project, so only an internal seat may file mail here.' },
          { status: 403 },
        )
      }
    }
    const made = await persistActions(tenantId, session.actor, [
      { t: 'create', parentId: body.parentId, kind: 'issue', draft: mapped.createDraft, now } as never as SubmittedAction,
    ])
    if (!made.ok || !made.createdId) {
      return NextResponse.json({ ok: false, error: made.error ?? 'The record was refused.' }, { status: 409 })
    }
    await persistActions(tenantId, session.actor, [
      { t: 'recordInboundMail', ...mapped.inboundMailFields, issueId: made.createdId, refusalReason: null, now } as never as Action,
    ])
    return NextResponse.json({ ok: true, issueId: made.createdId })
  }

  const target = state.issues[body.issueId ?? '']
  if (!target || target.deletedAt) {
    return NextResponse.json({ ok: false, error: 'That issue no longer exists.' }, { status: 404 })
  }
  const targetProject = projectOf(state, target.id)
  if (targetProject) {
    const members = Object.values(state.projectMembers)
    if (!isStaffedOn(state.model, session.actor, targetProject, members)) {
      logAuthRefusal('POST /api/mail/file (attach)', 'not staffed on target project', session.actor)
      return NextResponse.json(
        { ok: false, error: `${session.actor.name} is not staffed on this project.` },
        { status: 403 },
      )
    }
  } else if (!can(state.model, session.actor, 'internal.view').allowed) {
    /* No project to check staffing against (ART-20260906-030's F1) -- the same rule as the
     * create-mode branch above, so a client seat's `evidence.add` grant cannot reach a
     * structural issue outside any client's own scope. */
    logAuthRefusal('POST /api/mail/file (attach, no project)', 'internal.view refused', session.actor)
    return NextResponse.json(
      { ok: false, error: 'This issue has no project, so only an internal seat may file mail on it.' },
      { status: 403 },
    )
  }
  const attached = await persistActions(tenantId, session.actor, [
    { t: 'recordInboundMail', ...mapped.inboundMailFields, issueId: target.id, refusalReason: null, now } as never as Action,
  ])
  return attached.ok
    ? NextResponse.json({ ok: true, issueId: target.id })
    : NextResponse.json({ ok: false, error: attached.error ?? 'The attach was refused.' }, { status: 409 })
}
