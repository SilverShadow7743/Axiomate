import { NextResponse } from 'next/server'
import { getSession, identityEstablished } from '@/lib/principal'
import { logAuthRefusal } from '@/lib/authLog'
import { getPersonalGraphToken } from '@/lib/db/personalGraphTokens'
import { describeGraphRefusal, scheduleMeeting } from '@/lib/personalGraph'

export const dynamic = 'force-dynamic'

/**
 * Place an event on the SIGNED-IN PERSON'S OWN Outlook calendar, with a Teams meeting link.
 * See `docs/plans/2026-09-07-personal-connect-write-design.md`.
 *
 * This is not the tenant-stored `Meeting` model (`components/*Calendar*`, `lib/capacity`'s
 * `meetingHours`) and does not touch it, its capacity math, or its notification fan-out — that
 * model's own design named Graph calendar sync a non-goal and this route does not reopen it.
 * What this does: create a real Outlook event, through the caller's own delegated token, and
 * tell the caller whether it worked. Nothing is read from or written to the workspace — no
 * issueId is accepted here, deliberately, so a caller cannot use an invalid or unauthorized one
 * to imply a link this route does not actually check. Any "scheduled for issue X" framing is
 * the UI's own client-side convenience (pre-filling a subject line), not a server-verified fact.
 */
export async function POST(req: Request) {
  const session = getSession(req)
  if (identityEstablished() && !session.verified) {
    logAuthRefusal('POST /api/calendar/schedule', 'not signed in', session.actor)
    return NextResponse.json({ ok: false, error: 'Sign in to schedule a meeting.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as {
    subject?: string
    startIso?: string
    endIso?: string
    attendees?: string[]
    body?: string
  } | null

  const subject = (body?.subject ?? '').trim()
  const startIso = (body?.startIso ?? '').trim()
  const endIso = (body?.endIso ?? '').trim()
  const attendees = (body?.attendees ?? []).map((a) => a.trim()).filter(Boolean)

  if (!subject) {
    return NextResponse.json({ ok: false, error: 'A subject is needed.' }, { status: 422 })
  }
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return NextResponse.json({ ok: false, error: 'A start and end time are needed.' }, { status: 422 })
  }
  if (end <= start) {
    return NextResponse.json({ ok: false, error: 'The meeting must end after it starts.' }, { status: 422 })
  }
  if (!attendees.length) {
    return NextResponse.json({ ok: false, error: 'At least one attendee is needed.' }, { status: 422 })
  }

  const token = await getPersonalGraphToken(session.actor.id)
  if (!token) {
    return NextResponse.json(
      { ok: false, reconnect: true, error: 'Reconnect your inbox first.' },
      { status: 401 },
    )
  }

  const res = await scheduleMeeting(token, {
    subject,
    startIso,
    endIso,
    attendees,
    body: (body?.body ?? '').trim() || undefined,
  })
  if (!res.ok) {
    console.error(`calendar schedule refused for ${session.actor.id}: ${res.status} ${res.detail}`)
    return NextResponse.json(
      { ok: false, error: describeGraphRefusal(res, 'meeting') },
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    webLink: res.data.webLink,
    onlineMeetingUrl: res.data.onlineMeetingUrl,
  })
}
