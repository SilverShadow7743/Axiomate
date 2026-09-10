import 'server-only'

/**
 * The write-side personal Graph calls — schedule a meeting, reply, compose, start a Teams
 * chat message. See `docs/plans/2026-09-07-personal-connect-write-design.md`.
 *
 * Every function here takes the CALLER's own delegated token (from
 * `lib/db/personalGraphTokens.ts`) and does nothing else: no workspace read, no persistence,
 * no attribution logic. That belongs in the route, which knows why the call was made; this
 * file only knows how to make it. Mirrors `lib/mail.ts`'s shape (one thin wrapper per Graph
 * call, refusal returned rather than thrown) but is delegated throughout, never app-only —
 * see `AXIOMATE_DELEGATED_SCOPES`'s own comment on why `Calendars.ReadWrite` here does not
 * reopen `2026-08-30-e4-meetings-design.md`'s "Graph client stays mail-only" non-goal.
 */

type GraphResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string }

async function graphCall<T>(
  token: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
): Promise<GraphResult<T>> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await res.text() }
  }
  // A few Graph writes (e.g. reply) return 202 with no body.
  const text = await res.text()
  return { ok: true, data: (text ? JSON.parse(text) : {}) as T }
}

/** One honest sentence for a refused write, without naming tenant internals to the caller. */
export function describeGraphRefusal(res: { status: number; detail: string }, action: string): string {
  if (res.status === 401 || res.status === 403) {
    return `Microsoft refused the ${action} — reconnect your inbox, or ask an administrator to check the consent for this permission.`
  }
  if (res.status === 429) {
    return 'Microsoft is throttling this request — try again in a moment.'
  }
  return `The ${action} could not be completed (${res.status}).`
}

/* ================================================================== *
 * Calendar — place an event on the person's OWN calendar
 * ================================================================== */

export interface ScheduleMeetingInput {
  subject: string
  /** ISO 8601, the firm's single timezone — see e4's own non-goal on timezones. */
  startIso: string
  endIso: string
  attendees: string[]
  body?: string
  /** True by default: a Teams meeting link is attached via `isOnlineMeeting`. */
  online?: boolean
}

export async function scheduleMeeting(
  token: string,
  input: ScheduleMeetingInput,
): Promise<GraphResult<{ id: string; webLink: string; onlineMeetingUrl: string | null }>> {
  const res = await graphCall<{
    id: string
    webLink: string
    onlineMeeting?: { joinUrl?: string } | null
  }>(token, '/me/events', {
    method: 'POST',
    body: {
      subject: input.subject,
      start: { dateTime: input.startIso, timeZone: 'UTC' },
      end: { dateTime: input.endIso, timeZone: 'UTC' },
      attendees: input.attendees.map((address) => ({
        emailAddress: { address },
        type: 'required',
      })),
      ...(input.body ? { body: { contentType: 'Text', content: input.body } } : {}),
      isOnlineMeeting: input.online ?? true,
      onlineMeetingProvider: 'teamsForBusiness',
    },
  })
  if (!res.ok) return res
  return {
    ok: true,
    data: {
      id: res.data.id,
      webLink: res.data.webLink,
      onlineMeetingUrl: res.data.onlineMeeting?.joinUrl ?? null,
    },
  }
}

/* ================================================================== *
 * Mail — reply, reply-all, compose. Each dispatches from the person's OWN mailbox and
 * `saveToSentItems` is Graph's default (true) — the sent copy lives where it always would.
 * ================================================================== */

/**
 * Reply or reply-all, carrying the signed HTML the caller built. NOT the single-call
 * `POST .../reply` action: Graph's own docs say `comment` and `message.body` are mutually
 * exclusive on that endpoint, and whether `comment` renders embedded HTML tags as HTML or shows
 * them as literal text is undocumented — not worth risking on a client-visible email. Instead,
 * the three-call sequence Graph's own docs name as the alternative: `createReply`/
 * `createReplyAll` returns a draft whose `body.content` already holds the correctly quoted,
 * threaded original in HTML; the signed content is prepended to that (never replacing it, so
 * the thread survives exactly as an ordinary reply would show it); then the edited draft is
 * sent. See `docs/plans/2026-09-10-email-signature-plan.md`'s "Two things the design doc didn't
 * need to settle" section.
 */
export async function replyToMessage(
  token: string,
  messageId: string,
  htmlContent: string,
  replyAll: boolean,
): Promise<GraphResult<Record<string, never>>> {
  const created = await graphCall<{ id: string; body: { content: string } }>(
    token,
    `/me/messages/${encodeURIComponent(messageId)}/${replyAll ? 'createReplyAll' : 'createReply'}`,
    { method: 'POST' },
  )
  if (!created.ok) return created

  const draftId = created.data.id
  const patched = await graphCall<Record<string, never>>(
    token,
    `/me/messages/${encodeURIComponent(draftId)}`,
    { method: 'PATCH', body: { body: { contentType: 'HTML', content: htmlContent + created.data.body.content } } },
  )
  if (!patched.ok) return patched

  return graphCall(token, `/me/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST' })
}

export interface ComposeMailInput {
  to: string[]
  subject: string
  body: string
}

export async function sendNewMail(
  token: string,
  input: ComposeMailInput,
  contentType: 'Text' | 'HTML',
): Promise<GraphResult<Record<string, never>>> {
  return graphCall(token, '/me/sendMail', {
    method: 'POST',
    body: {
      message: {
        subject: input.subject,
        body: { contentType, content: input.body },
        toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    },
  })
}

/* ================================================================== *
 * Teams — a chat message, as the person
 * ================================================================== */

/**
 * Chat.Create is the least-privileged scope for starting a 1:1 chat (Graph returns the
 * existing chat rather than a duplicate if one already exists between the same two people —
 * `Create chat` in Microsoft's own reference). `/users('{id}')` in `user@odata.bind` accepts
 * either an object id or a userPrincipalName — used here because the directory (`Person.email`)
 * has no stored Entra object id for anyone but the signed-in caller, and adding one is its own
 * migration this design does not take on. The caller's own oid is used for their own side
 * because the session already carries it; the other side is their work address, which the
 * directory already has for every internal person (`RolesAndPeople`'s "Work address" field).
 */
export async function startOneOnOneChat(
  token: string,
  meOid: string,
  otherEmailOrUpn: string,
): Promise<GraphResult<{ id: string }>> {
  return graphCall<{ id: string }>(token, '/chats', {
    method: 'POST',
    body: {
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${meOid}')`,
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${encodeURIComponent(otherEmailOrUpn)}')`,
        },
      ],
    },
  })
}

export async function sendChatMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<GraphResult<{ id: string }>> {
  return graphCall<{ id: string }>(token, `/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: { body: { contentType: 'text', content: text } },
  })
}
