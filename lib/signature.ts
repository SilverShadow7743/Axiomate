/**
 * Fills the firm's editable signature template with a sender's own values — see
 * `docs/plans/2026-09-08-email-signature-design.md` and its 10 Sep implementation plan.
 *
 * `{{name}}`/`{{org}}` always render; a line carrying `{{title}}` or `{{phone}}` is dropped
 * entirely when that value is absent, rather than showing a blank line or the literal
 * placeholder text — the same "absent means unrecorded, never a visible gap" convention every
 * other optional `Person` field (`grade`, `track`) already follows. The logo is composed here
 * as an `<img>`, not a `{{}}` token — it is not text, so a template cannot mis-type it away.
 */

export interface SignatureValues {
  name: string
  title?: string
  org: string
  phone?: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A person's own typed Compose/Reply/firm-route text, made safe to embed in an HTML body. */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text).split('\n').join('<br>')
}

export function buildSignatureHtml(template: string, values: SignatureValues, logoDataUri?: string): string {
  const name = escapeHtml(values.name)
  const org = escapeHtml(values.org)
  const title = values.title?.trim() ? escapeHtml(values.title.trim()) : null
  const phone = values.phone?.trim() ? escapeHtml(values.phone.trim()) : null

  const lines = template
    .split('\n')
    .filter((line) => !(line.includes('{{title}}') && !title) && !(line.includes('{{phone}}') && !phone))
    .map((line) =>
      line
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{org\}\}/g, org)
        .replace(/\{\{title\}\}/g, title ?? '')
        .replace(/\{\{phone\}\}/g, phone ?? ''),
    )

  const logo = logoDataUri
    ? `<br><img src="${logoDataUri}" alt="${org}" style="max-height:40px;max-width:160px;margin-top:8px;">`
    : ''

  // A blank line before the block: every caller appends this straight after the person's own
  // typed text, and without the gap the last line of the message runs directly into "Thanks,".
  // Found by rendering the live profile's output during I19's verification, not by reasoning.
  return `<br><br><div>${lines.join('<br>')}${logo}</div>`
}
