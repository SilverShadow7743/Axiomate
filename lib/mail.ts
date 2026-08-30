import 'server-only'
import { entraConfig } from './auth/entra'

/**
 * The one Graph mail client, shared by the outward door and the notification drain.
 *
 * App-only, and safe to be so only because the tenant carries an Exchange Application Access
 * Policy restricting this application to the intake mailbox group — proven Granted-and-Denied
 * before the first send (checklist section 20). Nothing here relaxes that: the policy is what
 * makes "send as the firm" mean "send as the mailbox that speaks for this work".
 */

let cached: { token: string; expiresAt: number } | null = null

export async function graphToken(): Promise<string> {
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
    throw new Error(
      `Microsoft rejected this application's credentials (${res.status}). An administrator should check the client secret and that admin consent for Mail.Send is still granted.`,
    )
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: json.access_token, expiresAt: now + json.expires_in * 1000 }
  return json.access_token
}

/**
 * One plain-text message, sent as the given mailbox. Returns the refusal rather than throwing
 * for it, so callers can report honestly without a try/catch per send — a thrown error still
 * means credentials or network, which IS exceptional.
 *
 * A refused token may reflect consent fixed after it was minted, so 401/403 drops the cache:
 * the next attempt asks for a fresh token instead of replaying the stale claim for an hour.
 */
export async function sendAsMailbox(
  mailbox: string,
  to: string,
  subject: string,
  text: string,
  /** Optional and TRAILING: when absent the wire body is byte-identical to every send this
   *  function has ever made. `contentBytes` is base64. Used by report delivery for its PDFs. */
  attachments?: { name: string; contentType: string; contentBytes: string }[],
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const token = await graphToken()
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: text },
          toRecipients: [{ emailAddress: { address: to } }],
          ...(attachments?.length
            ? {
                attachments: attachments.map((a) => ({
                  '@odata.type': '#microsoft.graph.fileAttachment',
                  name: a.name,
                  contentType: a.contentType,
                  contentBytes: a.contentBytes,
                })),
              }
            : {}),
        },
        saveToSentItems: true,
      }),
    },
  )
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) cached = null
    return { ok: false, status: res.status, detail: await res.text() }
  }
  return { ok: true }
}
