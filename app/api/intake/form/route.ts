import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { databaseConfigured, describeDbError } from '@/lib/db/client'
import { persistActions } from '@/lib/db/persist'
import { loadWorkspace } from '@/lib/db/repo'
import { currentTenantId } from '@/lib/tenant'
import { classifyForm, provenanceNote, type InboundMessage } from '@/lib/intake'
import type { Action } from '@/lib/workspace'
import { INTAKE_ACTOR } from '@/lib/actor'
import { wrapPlainText } from '@/lib/richText'

/**
 * The form's half of intake — the second door that creates records from the internet.
 *
 * The mailbox endpoint above this one is gated by a shared secret the connector holds; this
 * one is gated by the per-form token in the submission, which is the capability the firm
 * handed out when it shared the URL. Everything after the gate is the same pipeline: the
 * duplicate check, `classifyForm` → `draftFor` (one copy of the rules), `create` through the
 * reducer as the machine actor, and a pinned provenance note naming the form.
 *
 * One rule this endpoint holds that `classifyForm` deliberately does not: an unknown token and
 * a disabled form produce the SAME refusal — status, body and shape identical — so probing the
 * URL space reveals nothing about what exists. Configuration screens need the difference; the
 * wire must not have it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REFUSAL = NextResponse.json.bind(NextResponse)
const NOT_A_FORM = { ok: false, error: 'This form is not accepting submissions.' }

/** The same shape `upsertIntake` accepts for a mailbox address. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: {
    token?: string
    name?: string
    email?: string
    subject?: string
    description?: string
    urgency?: string
  }
  try {
    body = await req.json()
  } catch {
    return REFUSAL({ ok: false, error: 'The submission could not be read.' }, { status: 400 })
  }

  const token = (body.token ?? '').trim()
  if (!token) return REFUSAL(NOT_A_FORM, { status: 404 })

  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim()
  const subject = (body.subject ?? '').trim()
  const description = (body.description ?? '').trim()
  const urgency = body.urgency === 'urgent' || body.urgency === 'low' ? body.urgency : 'normal'

  if (!name || !subject || !description) {
    return REFUSAL(
      { ok: false, error: 'Your name, a subject and a description are all needed.' },
      { status: 422 },
    )
  }
  if (!EMAIL.test(email)) {
    return REFUSAL({ ok: false, error: 'That is not a valid email address.' }, { status: 422 })
  }

  if (!databaseConfigured()) {
    return REFUSAL(
      { ok: false, error: 'This form cannot accept submissions right now.' },
      { status: 503 },
    )
  }

  try {
    const tenantId = currentTenantId()
    const { state } = await loadWorkspace(tenantId)

    const form = state.model.intakeForms.find((f) => f.token === token)
    /*
     * Unknown and disabled are the same sentence on the wire. `classifyForm` distinguishes
     * them for configuration screens; here the difference would be a probe's answer.
     */
    if (!form || !form.enabled) return REFUSAL(NOT_A_FORM, { status: 404 })

    const message: InboundMessage = {
      to: `form:${form.id}`,
      from: `${name} <${email}>`,
      subject,
      body: description,
      // Server-minted: a form has no sender id, so every submission is its own message. Two
      // identical submissions create two records — stated in the checklist as expected.
      messageId: `form-${randomUUID()}`,
      receivedAt: new Date().toISOString(),
      // A form submission is never email — it has no Exchange thread to carry.
      conversationId: null,
    }

    const result = classifyForm(form, message, state.model, urgency)
    if ('refused' in result) return REFUSAL(NOT_A_FORM, { status: 404 })
    const { draft } = result

    const now = new Date().toISOString()
    const first = await persistActions(tenantId, INTAKE_ACTOR, [
      {
        t: 'create',
        parentId: draft.parentId,
        kind: 'issue',
        draft: {
          name: draft.subject,
          description: draft.description,
          type: draft.type,
          severity: draft.severity,
          raisedBy: draft.raisedBy,
          // The entry state: a machine may file work; it may not decide it is being worked on.
          status: 'Open',
        },
        now,
      } as Action,
    ])
    if (!first.ok) {
      // The scope moved or the graph refused: the submitter cannot fix that, and the detail
      // names workspace internals. One honest sentence, and the refusal is in the server log.
      console.error(`intake form ${form.id} refused: ${first.error}`)
      return REFUSAL(
        { ok: false, error: 'The submission could not be filed. The team has a record of the failure.' },
        { status: 500 },
      )
    }
    const issueId = first.createdId
    if (!issueId) {
      return REFUSAL({ ok: false, error: 'The submission could not be filed.' }, { status: 500 })
    }

    const follow: Action[] = [
      {
        t: 'addNote',
        issueId,
        body: wrapPlainText(`${provenanceNote(message, draft)}\n\nArrived via the “${form.name}” form.\nMessage id: ${message.messageId}`),
        noteType: 'Client Communication',
        pinned: true,
        now,
      },
      ...draft.assignments.map(
        (a): Action => ({
          t: 'setAssignment',
          issueId,
          responsibilityId: a.responsibilityTypeId,
          values: [a.value],
          now,
        }),
      ),
    ]
    const second = await persistActions(tenantId, INTAKE_ACTOR, follow)

    return NextResponse.json({
      ok: true,
      // The one workspace fact this page discloses: the reference the submitter quotes later.
      reference: issueId,
      noteRecorded: second.ok,
    })
  } catch (err) {
    console.error(describeDbError(err))
    return REFUSAL(
      { ok: false, error: 'This form cannot accept submissions right now.' },
      { status: 503 },
    )
  }
}
